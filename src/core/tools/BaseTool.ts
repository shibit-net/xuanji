// ============================================================
// M6 工具系统 — 工具基类
// ============================================================

import type { Tool, ToolResult, JSONSchema } from '@/core/types';

/**
 * 工具抽象基类
 * 所有具体工具继承此类
 */
export abstract class BaseTool implements Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly input_schema: JSONSchema;

  /** 默认为写工具（串行执行） */
  readonly readonly: boolean = false;

  abstract execute(input: Record<string, unknown>): Promise<ToolResult>;

  /**
   * 是否为写操作（Plan Mode 中将被拦截）
   * 默认：readonly=true 的工具不是写操作
   */
  isWriteOperation(): boolean {
    return !this.readonly;
  }

  /**
   * 创建成功结果
   */
  protected success(content: string, metadata?: Record<string, unknown>): ToolResult {
    return { content, isError: false, metadata };
  }

  /**
   * 创建错误结果
   */
  protected error(message: string, metadata?: Record<string, unknown>): ToolResult {
    return { content: message, isError: true, metadata };
  }
}
