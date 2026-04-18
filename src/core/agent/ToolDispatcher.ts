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
  abortAll(): void;
}

/**
 * 工具调度器
 * 接收 LLM 的 tool_use，路由到 ToolRegistry 执行
 *
 * 中止机制：
 * - 每个正在执行的工具关联一个 AbortController
 * - abortAll() 中止所有正在执行的工具
 * - 外部 signal（如 AgentLoop.stop()）可链式传递
 */
export class ToolDispatcher implements IToolDispatcher {
  private log = logger.child({ module: 'ToolDispatcher' });
  /** 最大并行工具执行数 */
  static readonly MAX_PARALLEL = 5;
  /** 正在执行的工具 → AbortController 映射 */
  private runningTools = new Map<string, AbortController>();

  constructor(private registry: IToolRegistry) {}

  /**
   * 执行单个工具调用
   * @param signal - 外部中止信号（可选），中止时自动终止该工具
   */
  async execute(toolCall: ToolCall, signal?: AbortSignal): Promise<ToolResult> {
    // 如果已被中止，直接返回
    if (signal?.aborted) {
      return { content: '[Aborted] Tool execution was cancelled.', isError: true };
    }

    const controller = new AbortController();
    this.runningTools.set(toolCall.id, controller);

    // 链式中止：外部 signal 中止时，自动中止此工具
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const result = await this.registry.execute(toolCall.name, toolCall.input, controller.signal);
      return result;
    } catch (err) {
      // 所有错误都转换为错误结果，不向上抛出
      const message = err instanceof Error ? err.message : String(err);
      if (controller.signal.aborted) {
        return { content: '[Aborted] Tool execution was cancelled.', isError: true };
      }
      this.log.error(`Tool ${toolCall.name} execution failed:`, err);
      return {
        content: `工具执行失败: ${message}`,
        isError: true
      };
    } finally {
      this.runningTools.delete(toolCall.id);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * 批量执行工具（分段并行策略）
   *
   * 执行策略：
   * 1. 保持 LLM 发出的工具调用原始顺序
   * 2. 连续的只读工具分为一组，并行执行（最多 MAX_PARALLEL 个）
   * 3. 遇到写工具时，先等待前面的并行组完成，再串行执行写工具
   * 4. 这样保证了 read → edit → read 的依赖顺序
   * 5. 遇到权限拒绝（Permission denied）时，立即终止后续所有操作
   *
   * @param signal - 外部中止信号
   * @returns Map<toolCallId, ToolResult> 保持原始调用顺序
   */
  async executeAll(toolCalls: ToolCall[], signal?: AbortSignal): Promise<Map<string, ToolResult>> {
    if (toolCalls.length === 0) {
      return new Map();
    }

    const resultsMap = new Map<string, ToolResult>();
    let permissionDenied = false; // 权限拒绝标志

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
      // 检查是否已中止或权限被拒绝
      if (signal?.aborted || permissionDenied) {
        const abortReason = permissionDenied 
          ? '[Cancelled] Previous operation was denied by user.' 
          : '[Aborted] Tool execution was cancelled.';
        
        // 为剩余未执行的工具填充中止结果
        if (segment.type === 'readonly') {
          for (const call of segment.calls) {
            resultsMap.set(call.id, { content: abortReason, isError: true });
          }
        } else {
          resultsMap.set(segment.call.id, { content: abortReason, isError: true });
        }
        continue;
      }

      if (segment.type === 'readonly') {
        // 并行执行只读组（有并发限制）
        const results = await this.executeParallel(segment.calls, undefined, signal);
        for (const { id, result } of results) {
          resultsMap.set(id, result);
          // 检查是否有权限拒绝
          if (result.isError && this.isPermissionDenied(result.content)) {
            permissionDenied = true;
            this.log.info('Permission denied detected, aborting remaining operations');
          }
        }
      } else {
        // 串行执行写工具
        try {
          const result = await this.execute(segment.call, signal);
          resultsMap.set(segment.call.id, result);
          // 检查是否有权限拒绝
          if (result.isError && this.isPermissionDenied(result.content)) {
            permissionDenied = true;
            this.log.info('Permission denied detected, aborting remaining operations');
          }
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
   * 检查结果是否为权限拒绝
   */
  private isPermissionDenied(content: string): boolean {
    return content.includes('操作被拒绝') || 
           content.includes('用户拒绝') ||
           content.includes('缓存拒绝') ||
           content.includes('策略禁止') ||
           content.includes('Operation denied') ||
           content.includes('User denied') ||
           content.includes('Cached denial') ||
           content.includes('Policy denied');
  }

  /**
   * 中止所有正在执行的工具
   */
  abortAll(): void {
    for (const [id, controller] of this.runningTools) {
      this.log.debug(`Aborting tool: ${id}`);
      controller.abort();
    }
    this.runningTools.clear();
  }

  /**
   * 获取当前运行中的工具数量
   */
  getRunningCount(): number {
    return this.runningTools.size;
  }

  /**
   * 并行执行一组只读工具（限制并发数）
   */
  private async executeParallel(
    calls: ToolCall[],
    maxConcurrency = getConcurrencyConfig()?.maxParallel ?? ToolDispatcher.MAX_PARALLEL,
    signal?: AbortSignal,
  ): Promise<Array<{ id: string; result: ToolResult }>> {
    const results: Array<{ id: string; result: ToolResult }> = [];

    // 分批执行，每批最多 maxConcurrency 个
    for (let i = 0; i < calls.length; i += maxConcurrency) {
      if (signal?.aborted) {
        // 为剩余批次填充中止结果
        for (let j = i; j < calls.length; j++) {
          results.push({ id: calls[j].id, result: { content: '[Aborted]', isError: true } });
        }
        break;
      }

      const batch = calls.slice(i, i + maxConcurrency);
      const batchPromises = batch.map(async (call) => {
        try {
          const result = await this.execute(call, signal);
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
