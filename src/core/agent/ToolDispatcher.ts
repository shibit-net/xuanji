// ============================================================
// M2 Agent — 工具调度器
// ============================================================

import type { ToolCall, ToolResult, IToolRegistry } from '@/core/types';
import { getConcurrencyConfig } from '@/core/config/RuntimeConfig';
import { logger } from '@/core/logger';

/**
 * 工具调度器接口
 */
export interface IToolDispatcher {
  execute(toolCall: ToolCall): Promise<ToolResult>;
  executeAll(toolCalls: ToolCall[]): Promise<Map<string, ToolResult>>;
}

/**
 * 工具调度器
 * 接收 LLM 的 tool_use，路由到 ToolRegistry 执行
 */
export class ToolDispatcher implements IToolDispatcher {
  private log = logger.child({ module: 'ToolDispatcher' });
  /** 最大并行工具执行数 */
  static readonly MAX_PARALLEL = 5;

  constructor(private registry: IToolRegistry) {}

  /**
   * 执行单个工具调用（保留向后兼容）
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    return this.registry.execute(toolCall.name, toolCall.input);
  }

  /**
   * 批量执行工具（分段并行策略）
   *
   * 执行策略：
   * 1. 保持 LLM 发出的工具调用原始顺序
   * 2. 连续的只读工具分为一组，并行执行（最多 MAX_PARALLEL 个）
   * 3. 遇到写工具时，先等待前面的并行组完成，再串行执行写工具
   * 4. 这样保证了 read → edit → read 的依赖顺序
   *
   * @returns Map<toolCallId, ToolResult> 保持原始调用顺序
   */
  async executeAll(toolCalls: ToolCall[]): Promise<Map<string, ToolResult>> {
    if (toolCalls.length === 0) {
      return new Map();
    }

    const resultsMap = new Map<string, ToolResult>();

    // 按原始顺序分段：连续的只读工具为一组，写工具单独为一组
    type Segment = { type: 'readonly'; calls: ToolCall[] } | { type: 'write'; call: ToolCall };
    const segments: Segment[] = [];

    for (const call of toolCalls) {
      const tool = this.registry.get(call.name);
      const isReadonly = tool?.readonly === true;

      if (isReadonly) {
        // 追加到当前只读段，或创建新只读段
        const lastSegment = segments[segments.length - 1];
        if (lastSegment && lastSegment.type === 'readonly') {
          lastSegment.calls.push(call);
        } else {
          segments.push({ type: 'readonly', calls: [call] });
        }
      } else {
        // 写工具独立为一段
        segments.push({ type: 'write', call });
      }
    }

    // 按分段顺序执行
    for (const segment of segments) {
      if (segment.type === 'readonly') {
        // 并行执行只读组（有并发限制）
        const results = await this.executeParallel(segment.calls);
        for (const { id, result } of results) {
          resultsMap.set(id, result);
        }
      } else {
        // 串行执行写工具
        try {
          const result = await this.execute(segment.call);
          resultsMap.set(segment.call.id, result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          resultsMap.set(segment.call.id, {
            content: `执行失败: ${message}`,
            isError: true,
          });
        }
      }
    }

    return resultsMap;
  }

  /**
   * 并行执行一组只读工具（限制并发数）
   */
  private async executeParallel(
    calls: ToolCall[],
    maxConcurrency = getConcurrencyConfig()?.maxParallel ?? ToolDispatcher.MAX_PARALLEL,
  ): Promise<Array<{ id: string; result: ToolResult }>> {
    const results: Array<{ id: string; result: ToolResult }> = [];

    // 分批执行，每批最多 maxConcurrency 个
    for (let i = 0; i < calls.length; i += maxConcurrency) {
      const batch = calls.slice(i, i + maxConcurrency);
      const batchPromises = batch.map(async (call) => {
        try {
          const result = await this.execute(call);
          return { id: call.id, result };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            id: call.id,
            result: { content: `并行执行失败: ${message}`, isError: true } as ToolResult,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }
}
