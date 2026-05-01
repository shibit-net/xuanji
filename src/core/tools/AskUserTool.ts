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

  /** 上下文信息（用于 UI 显示和优先级控制） */
  context?: {
    /** Agent ID */
    agentId?: string;
    /** Agent 显示名称 */
    agentName?: string;
    /** 优先级（1-10，默认 5，数值越大优先级越高） */
    priority?: number;
    /** 超时时间（毫秒，默认 300000 即 5 分钟） */
    timeout?: number;
  };
}

/**
 * 用户提问处理器
 * 由 UI 层注入，返回 Promise 实现阻塞等待用户回复
 */
export type AskUserHandler = (request: AskUserRequest) => Promise<string>;

/**
 * 队列项
 */
interface QueueItem {
  request: AskUserRequest;
  resolve: (result: ToolResult) => void;
  timestamp: number;
}

/**
 * AskUserTool — Agent 主动向用户提问的工具
 *
 * 支持三种模式：
 * 1. 自由文本：仅提供 question
 * 2. 单选：提供 question + options
 * 3. 多选：提供 question + options + multiSelect: true
 *
 * 🆕 并发控制：
 * - 内置队列机制，多个 agent 同时提问时自动排队
 * - 支持优先级排序（priority 字段）
 * - 支持超时控制（timeout 字段）
 */
export class AskUserTool extends BaseTool {
  readonly name = 'ask_user';
  readonly description = [
    '向用户提问并等待回复。用于澄清需求、选择方案、确认关键操作。',
    '不要用于闲聊或不必要的确认。',
    '支持选项列表（单选/多选）、优先级（1-10）、超时设置。',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Question to ask the user (clear, specific, concise)',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Option list (optional, displays as multiple choice if provided)',
      },
      multiSelect: {
        type: 'boolean',
        description: 'Whether to allow multiple selections (default false, only effective when options provided)',
      },
      default: {
        type: 'string',
        description: 'Default value (optional)',
      },
      priority: {
        type: 'number',
        description: 'Question priority (1-10, default 5, higher value = higher priority)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default 300000 = 5 minutes)',
      },
    },
    required: ['question'],
  };

  /** 只读工具：不产生副作用 */
  readonly readonly = true;

  private handler: AskUserHandler | null = null;
  private queue: QueueItem[] = [];
  private processing = false;

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

    // 构建请求对象
    const request: AskUserRequest = {
      question,
      options: input.options as string[] | undefined,
      multiSelect: input.multiSelect as boolean | undefined,
      default: input.default as string | undefined,
      context: {
        // 从 input 中提取上下文信息（由 AgentLoop 或 SubAgentFactory 注入）
        agentId: (input as any)._agentId as string | undefined,
        agentName: (input as any)._agentName as string | undefined,
        priority: (input.priority as number | undefined) ?? 5,
        timeout: (input.timeout as number | undefined) ?? 300000,
      },
    };

    // 加入队列，返回 Promise
    return new Promise<ToolResult>((resolve) => {
      this.queue.push({
        request,
        resolve,
        timestamp: Date.now(),
      });
      this.processQueue();
    });
  }

  /**
   * 处理队列（串行执行）
   */
  private async processQueue(): Promise<void> {
    // 如果正在处理或队列为空，直接返回
    if (this.processing || this.queue.length === 0) {
      return;
    }

    // 按优先级排序（优先级高的在前，优先级相同则按时间排序）
    this.queue.sort((a, b) => {
      const priorityA = a.request.context?.priority ?? 5;
      const priorityB = b.request.context?.priority ?? 5;
      if (priorityA !== priorityB) {
        return priorityB - priorityA; // 高优先级在前
      }
      return a.timestamp - b.timestamp; // 时间早的在前
    });

    this.processing = true;
    const item = this.queue.shift()!;

    try {
      // 设置超时
      const timeout = item.request.context?.timeout ?? 300000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('用户回复超时')), timeout);
      });

      // 等待用户回复或超时
      const answer = await Promise.race([
        this.handler!(item.request),
        timeoutPromise,
      ]);

      // 处理回复
      const answerStr = typeof answer === 'string'
        ? answer
        : (answer && typeof (answer as any).answer === 'string'
            ? (answer as any).answer
            : String(answer ?? ''));

      if (!answerStr.trim()) {
        item.resolve(this.success('（用户未回复）'));
      } else {
        item.resolve(this.success(answerStr));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      item.resolve(this.error(`等待用户回复失败: ${message}`));
    } finally {
      this.processing = false;
      // 处理下一个问题
      this.processQueue();
    }
  }
}
