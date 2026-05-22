// ============================================================
// AskUserTool — Agent 向用户提问
// ============================================================
//
// 当 Agent 需要用户澄清需求或做出选择时，使用此工具。
// 支持自由文本输入和结构化选项（单选/多选）。
//
// 并发控制：通过 PermissionController.serialize() 统一排队，
// 权限确认、计划审查、AskUser 共享同一队列，避免 UI 混乱。
//

import type { JSONSchema, ToolResult } from '@/core/types';
import type { IPermissionController } from '@/permission/types';
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
 * AskUserTool — Agent 主动向用户提问的工具
 *
 * 支持三种模式：
 * 1. 自由文本：仅提供 question
 * 2. 单选：提供 question + options
 * 3. 多选：提供 question + options + multiSelect: true
 *
 * 通过 PermissionController.serialize() 串行化用户交互，
 * 与权限确认、计划审查共享同一队列。
 */
export class AskUserTool extends BaseTool {
  readonly name = 'ask_user';
  readonly description = [
    'Ask the user a question and wait for their response.',
    'Use when you need clarification, a decision, or additional information to proceed.',
    'Supports multiple choice options (single/multi select), priority (1-10), and timeout.',
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
  private permissionController: IPermissionController | null = null;

  /**
   * 注入用户交互处理器（由 UI 层调用）
   */
  setHandler(handler: AskUserHandler): void {
    this.handler = handler;
  }

  /**
   * 注入权限控制器（由 ToolRegistry 调用，用于共享串行化队列）
   */
  setPermissionController(controller: IPermissionController): void {
    this.permissionController = controller;
  }

  async execute(input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const question = input.question as string;
    if (!question?.trim()) {
      return this.error('问题不能为空');
    }

    if (!this.handler) {
      return this.error('用户交互不可用（非交互模式）');
    }

    // 信号已触发则立即取消
    if (signal?.aborted) {
      return this.error('用户取消了提问');
    }

    const request: AskUserRequest = {
      question,
      options: input.options as string[] | undefined,
      multiSelect: input.multiSelect as boolean | undefined,
      default: input.default as string | undefined,
      context: {
        agentId: (input as any)._agentId as string | undefined,
        agentName: (input as any)._agentName as string | undefined,
        priority: (input.priority as number | undefined) ?? 5,
        timeout: (input.timeout as number | undefined) ?? 300000,
      },
    };

    // 通过 PermissionController 的统一队列串行化用户交互
    const serialize = this.permissionController?.serialize?.bind(this.permissionController)
      ?? ((fn: () => Promise<ToolResult>) => fn());

    return serialize(async () => {
      const timeout = request.context?.timeout ?? 300000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('用户回复超时')), timeout);
      });

      // 将 AbortSignal 转换为 Promise，信号触发时取消等待
      const abortPromise = signal
        ? new Promise<never>((_, reject) => {
            if (signal.aborted) {
              reject(new Error('已取消'));
            } else {
              signal.addEventListener('abort', () => reject(new Error('已取消')), { once: true });
            }
          })
        : null;

      try {
        const promises: Promise<string>[] = [this.handler!(request), timeoutPromise];
        if (abortPromise) promises.push(abortPromise);

        const answer = await Promise.race(promises);

        const answerStr = typeof answer === 'string'
          ? answer
          : (answer && typeof (answer as any).answer === 'string'
              ? (answer as any).answer
              : String(answer ?? ''));

        if (!answerStr.trim()) {
          return this.success('（用户未回复）');
        }
        return this.success(answerStr);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return this.error(`等待用户回复失败: ${message}`);
      }
    });
  }
}
