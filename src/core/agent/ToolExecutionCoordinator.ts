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
  /** 文件变更列表（从工具结果中收集） */
  fileChanges: import('@/core/types').FileChange[];
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

  /** 更新 HookRegistry 引用（避免重建整个实例） */
  setHookRegistry(hookRegistry: HookRegistry | null): void {
    this.hookRegistry = hookRegistry;
  }

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

    // 防御性检查：如果没有工具调用，直接返回空分组
    if (!result.toolCalls || result.toolCalls.length === 0) {
      return {
        parallelIds,
        serialIds,
        readonlyIds,
        blockedIds,
        mockResults,
        modifiedToolCalls,
      };
    }

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
   * 执行工具（使用 ToolDispatcher 的智能并行策略）
   */
  async executeTools(
    result: ProcessResult,
    grouping: ToolGrouping,
    callbacks: {
      onToolStart?: (id: string, name: string, input: Record<string, unknown>) => void;
      onToolDelta?: (id: string, name: string, receivedBytes: number) => void;
      onToolEnd?: (id: string, name: string, result: string, isError: boolean) => void;
    },
    signal?: AbortSignal, // 🔧 添加 AbortSignal 参数
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    const resultsMap = new Map<string, { content: string; isError: boolean }>();
    const fullResultsMap = new Map<string, import('@/core/types').ToolResult>(); // 存储完整的 ToolResult
    const statsUpdates = new Map<string, { count: number; durationMs: number; errorCount: number }>();

    // 防御性检查：如果没有工具调用，直接返回空结果
    if (!result.toolCalls || result.toolCalls.length === 0) {
      return {
        resultsMap,
        totalDurationMs: 0,
        statsUpdates,
        fileChanges: [],
      };
    }

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

    // 2. 处理幻觉工具调用（模型将自然语言误输出为 tool arguments）
    // 直接标记为错误，不实际执行，避免浪费资源
    for (const tc of result.toolCalls) {
      if ((tc.input as Record<string, unknown>)?._hallucinated) {
        const rawText = (tc.input as Record<string, unknown>)?._raw_text as string || '';
        const errorMsg = `[模型输出异常] 工具 "${tc.name}" 的参数不是合法 JSON，模型误将自然语言输出为工具参数: "${rawText.slice(0, 200)}"。请重新生成合法的 JSON 参数。`;
        resultsMap.set(tc.id, { content: errorMsg, isError: true });
        callbacks.onToolEnd?.(tc.id, tc.name, errorMsg, true);
        grouping.blockedIds.add(tc.id);
      }
    }

    // 3. 准备需要执行的工具（排除被阻止和 Mock 的）
    const toolsToExecute = result.toolCalls
      .filter(tc => !grouping.blockedIds.has(tc.id) && !grouping.mockResults.has(tc.id))
      .map(tc => {
        const mod = grouping.modifiedToolCalls.get(tc.id);
        return {
          id: tc.id,
          name: mod?.name || tc.name,
          input: mod?.input || (tc.input as Record<string, unknown>),
        };
      });

    // 4. 使用 ToolDispatcher.executeAll() 执行所有工具
    // ToolDispatcher 会自动处理只读工具的并行执行和写工具的串行执行
    if (toolsToExecute.length > 0) {
      const dispatcherResults = await this.toolDispatcher.executeAll(toolsToExecute, signal);

      // 合并结果并触发回调
      for (const [id, toolResult] of dispatcherResults) {
        fullResultsMap.set(id, toolResult); // 保存完整结果
        resultsMap.set(id, { content: toolResult.content, isError: toolResult.isError });
        const tc = result.toolCalls.find(t => t.id === id);
        if (tc) {
          callbacks.onToolEnd?.(id, tc.name, toolResult.content, toolResult.isError);
        }
      }
    }

    const totalDurationMs = Date.now() - startTime;

    // 5. 收集文件变更
    const fileChanges: import('@/core/types').FileChange[] = [];
    for (const [id, fullResult] of fullResultsMap) {
      if (fullResult.fileChanges && fullResult.fileChanges.length > 0) {
        fileChanges.push(...fullResult.fileChanges);
      }
    }

    // 6. 更新统计
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
      fileChanges,
    };
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
    if (!result.toolCalls || result.toolCalls.length === 0) return;

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
