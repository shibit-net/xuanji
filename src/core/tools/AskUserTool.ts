// ============================================================
// AskUserTool — Agent 向用户提问
// ============================================================
//
// 当 Agent 需要用户澄清需求或做出选择时，使用此工具。
// 支持自由文本输入和结构化选项（单选/多选）。
//

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';

/**
 * AskUser 请求参数
 */
export interface AskUserRequest {
  question: string;
  options?: string[];
  multiSelect?: boolean;
  default?: string;
}

/**
 * 用户提问处理器
 * 由 UI 层注入，返回 Promise 实现阻塞等待用户回复
 */
export type AskUserHandler = (request: AskUserRequest) => Promise<string>;

/**
 * AskUserTool — Agent 主动向用户提问的工具
 *
 * 支持三种模式：
 * 1. 自由文本：仅提供 question
 * 2. 单选：提供 question + options
 * 3. 多选：提供 question + options + multiSelect: true
 */
export class AskUserTool extends BaseTool {
  readonly name = 'ask_user';
  readonly description = [
    '向用户提出问题并等待回复。',
    '当你需要以下信息时使用此工具:',
    '- 澄清模糊的需求',
    '- 在多个方案之间让用户做出选择',
    '- 确认关键操作前的参数',
    '不要用于闲聊或不必要的确认。',
    '',
    '支持结构化选项：',
    '- 提供 options 数组时，用户可从预定义选项中选择',
    '- 设置 multiSelect: true 允许多选',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: '向用户提出的问题（清晰、具体、简洁）',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: '选项列表（可选，提供则显示为选择题）',
      },
      multiSelect: {
        type: 'boolean',
        description: '是否允许多选（默认 false，仅在提供 options 时有效）',
      },
      default: {
        type: 'string',
        description: '默认值（可选）',
      },
    },
    required: ['question'],
  };

  /** 只读工具：不产生副作用 */
  readonly readonly = true;

  private handler: AskUserHandler | null = null;

  /**
   * 注入用户交互处理器（由 UI 层调用）
   */
  setHandler(handler: AskUserHandler): void {
    this.handler = handler;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const question = input.question as string;
    if (!question?.trim()) {
      return this.error('问题不能为空');
    }

    if (!this.handler) {
      return this.error('用户交互不可用（非交互模式）');
    }

    try {
      const request: AskUserRequest = {
        question,
        options: input.options as string[] | undefined,
        multiSelect: input.multiSelect as boolean | undefined,
        default: input.default as string | undefined,
      };

      const answer = await this.handler(request);
      if (!answer?.trim()) {
        return this.success('（用户未回复）');
      }
      return this.success(answer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`等待用户回复失败: ${message}`);
    }
  }
}
