// ============================================================
// M2 Agent — 工具调度器
// ============================================================

import type { ToolCall, ToolResult, IToolRegistry } from '@/types';

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
  constructor(private registry: IToolRegistry) {}

  /**
   * 执行单个工具调用
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    return this.registry.execute(toolCall.name, toolCall.input);
  }

  /**
   * 执行多个工具调用 (顺序执行)
   * @returns Map<toolCallId, ToolResult>
   */
  async executeAll(toolCalls: ToolCall[]): Promise<Map<string, ToolResult>> {
    const results = new Map<string, ToolResult>();
    for (const call of toolCalls) {
      const result = await this.execute(call);
      results.set(call.id, result);
    }
    return results;
  }
}
