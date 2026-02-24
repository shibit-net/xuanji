// ============================================================
// M2 Agent — 工具调度器
// ============================================================

import type { ToolCall, ToolResult, IToolRegistry } from '@/core/types';
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

  constructor(private registry: IToolRegistry) {}

  /**
   * 执行单个工具调用（保留向后兼容）
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    return this.registry.execute(toolCall.name, toolCall.input);
  }

  /**
   * 批量执行工具（并行+串行混合）
   *
   * 执行策略：
   * 1. 按 readonly 属性分组：只读工具 vs 写入工具
   * 2. 并行执行所有只读工具（无副作用，安全并行）
   * 3. 串行执行所有写入工具（有副作用，保证顺序）
   * 4. 合并结果并按原始调用顺序返回
   *
   * @returns Map<toolCallId, ToolResult> 保持原始调用顺序
   */
  async executeAll(toolCalls: ToolCall[]): Promise<Map<string, ToolResult>> {
    if (toolCalls.length === 0) {
      return new Map();
    }

    // 1️⃣ 按只读属性分组
    const readonlyGroup: ToolCall[] = [];
    const writeGroup: ToolCall[] = [];

    for (const call of toolCalls) {
      const tool = this.registry.get(call.name);
      if (!tool) {
        // 未知工具归到写组（保守处理，避免意外并行）
        writeGroup.push(call);
        continue;
      }

      if (tool.readonly === true) {
        readonlyGroup.push(call);
      } else {
        writeGroup.push(call);
      }
    }

    // 2️⃣ 并行执行只读工具
    const readonlyPromises = readonlyGroup.map(async (call) => {
      try {
        const result = await this.execute(call);
        return { id: call.id, result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          id: call.id,
          result: { content: `并行执行失败: ${message}`, isError: true },
        };
      }
    });

    const readonlyResults = await Promise.allSettled(readonlyPromises);

    // 3️⃣ 串行执行写工具
    const writeResults: Array<{ id: string; result: ToolResult }> = [];
    for (const call of writeGroup) {
      try {
        const result = await this.execute(call);
        writeResults.push({ id: call.id, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeResults.push({
          id: call.id,
          result: { content: `串行执行失败: ${message}`, isError: true },
        });
      }
    }

    // 4️⃣ 合并结果（按原始顺序）
    const resultsMap = new Map<string, ToolResult>();

    // 提取并行结果
    for (const promiseResult of readonlyResults) {
      if (promiseResult.status === 'fulfilled') {
        const { id, result } = promiseResult.value;
        resultsMap.set(id, result);
      } else {
        // Promise 自身失败（不应该发生，因为内部已 catch）
        this.log.error('Unexpected promise rejection:', promiseResult.reason);
      }
    }

    // 提取串行结果
    for (const { id, result } of writeResults) {
      resultsMap.set(id, result);
    }

    return resultsMap;
  }
}
