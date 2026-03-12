// ============================================================
// ToolExecutionCoordinator — 工具执行协调
// ============================================================
//
// 负责工具分类、Hook 调用、并行/串行执行协调

import type { Message, ToolSchema } from '@/core/types';
import type { IToolRegistry } from '@/core/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import type { ToolDispatcher } from './ToolDispatcher';
import type { ProcessResult } from './StreamProcessor';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ToolExecutionCoordinator' });

/**
 * 工具调用结果
 */
export interface ToolExecutionResult {
  /** 工具结果 Map (id -> result) */
  resultsMap: Map<string, { content: string; isError: boolean }>;
  /** 工具执行总耗时 (ms) */
  totalDurationMs: number;
  /** 工具统计更新 */
  statsUpdates: Map<string, { count: number; durationMs: number; errorCount: number }>;
}

/**
 * 工具分组结果
 */
export interface ToolGrouping {
  /** 并行执行的工具 ID */
  parallelIds: string[];
  /** 串行执行的工具 ID */
  serialIds: string[];
  /** 只读工具 ID */
  readonlyIds: string[];
  /** Hook 阻止的工具 ID */
  blockedIds: Set<string>;
  /** Hook Mock 的结果 */
  mockResults: Map<string, { content: string; isError: boolean }>;
  /** Hook 修改的工具调用 */
  modifiedToolCalls: Map<string, { name: string; input: Record<string, unknown> }>;
}

/**
 * ToolExecutionCoordinator — 工具执行协调器
 */
export class ToolExecutionCoordinator {
  constructor(
    private registry: IToolRegistry,
    private toolDispatcher: ToolDispatcher,
    private hookRegistry: HookRegistry | null,
  ) {}

  /**
   * 分组工具并应用 Hook
   */
  async groupAndPrepareTools(
    result: ProcessResult,
  ): Promise<ToolGrouping> {
    const parallelIds: string[] = [];
    const serialIds: string[] = [];
    const readonlyIds: string[] = [];
    const blockedIds = new Set<string>();
    const mockResults = new Map<string, { content: string; isError: boolean }>();
    const modifiedToolCalls = new Map<string, { name: string; input: Record<string, unknown> }>();

    // 1. 分类工具（只读 vs 写入）
    for (const tc of result.toolCalls) {
      const tool = this.registry.get(tc.name);
      if (tool?.readonly === true) {
        readonlyIds.push(tc.id);
        parallelIds.push(tc.id);
      } else {
        serialIds.push(tc.id);
      }
    }

    // 2. 应用 PreToolUse Hook（使用 emitSync 同步执行）
    if (this.hookRegistry) {
      for (const tc of result.toolCalls) {
        try {
          const hookResult = await this.hookRegistry.emitSync('PreToolUse', {
            toolName: tc.name,
            toolInput: tc.input as Record<string, unknown>,
          });

          // 检查是否被阻止
          if (hookResult.blocked) {
            blockedIds.add(tc.id);
            log.warn(`Tool "${tc.name}" blocked by hook: ${hookResult.reason}`);
            continue;
          }

          // 检查是否有 Mock 结果
          const mockEntry = hookResult.results.find(r => r.mockResult);
          if (mockEntry?.mockResult) {
            mockResults.set(tc.id, {
              content: mockEntry.mockResult.content,
              isError: mockEntry.mockResult.isError ?? false,
            });
            blockedIds.add(tc.id); // 从真实执行列表中排除
            log.info(`Tool "${tc.name}" mocked by hook`);
            continue;
          }

          // 检查是否修改了工具调用
          const modEntry = hookResult.results.find(r => r.modifiedInput || r.replaceTool);
          if (modEntry) {
            modifiedToolCalls.set(tc.id, {
              name: modEntry.replaceTool ?? tc.name,
              input: modEntry.modifiedInput ?? (tc.input as Record<string, unknown>),
            });

            if (modEntry.replaceTool) {
              log.info(`Tool "${tc.name}" replaced with "${modEntry.replaceTool}" by hook`);
            }
          }
        } catch (hookErr) {
          log.debug(`PreToolUse hook error for ${tc.name}:`, hookErr);
        }
      }
    }

    return {
      parallelIds,
      serialIds,
      readonlyIds,
      blockedIds,
      mockResults,
      modifiedToolCalls,
    };
  }

  /**
   * 执行工具（并行 + 串行）
   */
  async executeTools(
    result: ProcessResult,
    grouping: ToolGrouping,
    callbacks: {
      onToolStart?: (id: string, name: string, input: Record<string, unknown>) => void;
      onToolDelta?: (id: string, name: string, receivedBytes: number) => void;
      onToolEnd?: (id: string, name: string, result: string, isError: boolean) => void;
    },
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const resultsMap = new Map<string, { content: string; isError: boolean }>();
    const statsUpdates = new Map<string, { count: number; durationMs: number; errorCount: number }>();

    // 1. 处理 Hook 阻止和 Mock 的工具
    for (const [id, mockResult] of grouping.mockResults) {
      resultsMap.set(id, mockResult);
      const tc = result.toolCalls.find(t => t.id === id);
      if (tc) {
        callbacks.onToolEnd?.(id, tc.name, mockResult.content, mockResult.isError);
      }
    }

    for (const id of grouping.blockedIds) {
      if (!grouping.mockResults.has(id)) {
        const tc = result.toolCalls.find(t => t.id === id);
        if (tc) {
          const blockedResult = {
            content: `[Blocked] Tool "${tc.name}" was blocked by hook`,
            isError: true,
          };
          resultsMap.set(id, blockedResult);
          callbacks.onToolEnd?.(id, tc.name, blockedResult.content, true);
        }
      }
    }

    // 2. 执行并行工具（只读工具）
    const parallelCalls = result.toolCalls.filter(tc =>
      grouping.parallelIds.includes(tc.id) &&
      !grouping.blockedIds.has(tc.id) &&
      !grouping.mockResults.has(tc.id)
    );

    if (parallelCalls.length > 0) {
      const parallelResults = await this.executeParallelTools(
        parallelCalls,
        grouping.modifiedToolCalls,
        callbacks,
      );
      for (const [id, result] of parallelResults) {
        resultsMap.set(id, result);
      }
    }

    // 3. 执行串行工具（写入工具）
    const serialCalls = result.toolCalls.filter(tc =>
      grouping.serialIds.includes(tc.id) &&
      !grouping.blockedIds.has(tc.id) &&
      !grouping.mockResults.has(tc.id)
    );

    for (const tc of serialCalls) {
      const mod = grouping.modifiedToolCalls.get(tc.id);
      const toolName = mod?.name || tc.name;
      const toolInput = mod?.input || (tc.input as Record<string, unknown>);

      // onToolStart 已在 StreamProcessor 中调用（tool_use_start 和 tool_use_end），不在此处重复调用

      try {
        const result = await this.toolDispatcher.execute(
          { id: tc.id, name: toolName, input: toolInput },
          undefined, // signal
        );

        resultsMap.set(tc.id, result);
        callbacks.onToolEnd?.(tc.id, toolName, result.content, result.isError);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errorResult = {
          content: `执行失败: ${message}`,
          isError: true,
        };
        resultsMap.set(tc.id, errorResult);
        callbacks.onToolEnd?.(tc.id, toolName, errorResult.content, true);
      }
    }

    const totalDurationMs = Date.now() - startTime;

    // 4. 更新统计
    for (const tc of result.toolCalls) {
      const toolResult = resultsMap.get(tc.id);
      if (toolResult) {
        const existing = statsUpdates.get(tc.name) ?? { count: 0, durationMs: 0, errorCount: 0 };
        existing.count++;
        existing.durationMs += Math.round(totalDurationMs / result.toolCalls.length);
        if (toolResult.isError) existing.errorCount++;
        statsUpdates.set(tc.name, existing);
      }
    }

    return {
      resultsMap,
      totalDurationMs,
      statsUpdates,
    };
  }

  /**
   * 并行执行工具
   */
  private async executeParallelTools(
    toolCalls: ProcessResult['toolCalls'],
    modifiedCalls: Map<string, { name: string; input: Record<string, unknown> }>,
    callbacks: {
      onToolStart?: (id: string, name: string, input: Record<string, unknown>) => void;
      onToolDelta?: (id: string, name: string, receivedBytes: number) => void;
      onToolEnd?: (id: string, name: string, result: string, isError: boolean) => void;
    },
  ): Promise<Map<string, { content: string; isError: boolean }>> {
    const results = new Map<string, { content: string; isError: boolean }>();

    const promises = toolCalls.map(async (tc) => {
      const mod = modifiedCalls.get(tc.id);
      const toolName = mod?.name || tc.name;
      const toolInput = mod?.input || (tc.input as Record<string, unknown>);

      // onToolStart 已在 StreamProcessor 中调用（tool_use_start 和 tool_use_end），不在此处重复调用

      try {
        const result = await this.toolDispatcher.execute(
          { id: tc.id, name: toolName, input: toolInput },
          undefined, // signal
        );

        results.set(tc.id, result);
        callbacks.onToolEnd?.(tc.id, toolName, result.content, result.isError);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errorResult = {
          content: `并行执行失败: ${message}`,
          isError: true,
        };
        results.set(tc.id, errorResult);
        callbacks.onToolEnd?.(tc.id, toolName, errorResult.content, true);
      }
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * 触发 PostToolUse Hook
   */
  async triggerPostToolUseHooks(
    result: ProcessResult,
    resultsMap: Map<string, { content: string; isError: boolean }>,
    toolExecDurationMs: number,
  ): Promise<void> {
    if (!this.hookRegistry) return;

    for (const toolCall of result.toolCalls) {
      const toolResult = resultsMap.get(toolCall.id);
      this.hookRegistry.emit('PostToolUse', {
        toolName: toolCall.name,
        toolInput: toolCall.input as Record<string, unknown>,
        toolResult: toolResult?.content?.slice(0, 2000),
        toolIsError: toolResult?.isError,
        toolDuration: Math.round(toolExecDurationMs / result.toolCalls.length),
      }).catch((err) => {
        log.debug('PostToolUse hook emit failed:', err);
      });
    }
  }
}
