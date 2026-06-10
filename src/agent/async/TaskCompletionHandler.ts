/**
 * TaskCompletionHandler — 后台异步任务完成处理
 *
 * 通过 EventBus 监听 ASYNC_TASK_COMPLETED / ASYNC_TASK_FAILED 事件，
 * 将结果注入到 AgentLoop 的 system prompt 后缀中。
 */

import type { ContextManager } from '@/infrastructure/context/ContextManager';
import { eventBus } from '@/infrastructure/events/EventBus';
import { XuanjiEvent } from '@/infrastructure/events/events';
import type { TaskCompletionResult as AgentTaskCompletionResult } from '@/agent/task/types';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'TaskCompletionHandler' });

export interface TaskCompletionHandlerCallbacks {
  onAutoSummarize?: (subAgentId?: string, groupId?: string) => void;
  onCitationData?: (citations: Array<{ agentName: string; originalOutput: string; duration: number; tokensUsed: { input: number; output: number } }>) => void;
  onRun?: (message: string) => Promise<void>;
  isRunning?: () => boolean;
}

export class TaskCompletionHandler {
  private pendingCompletions: AgentTaskCompletionResult[] = [];
  private isAutoSummarizeRun = false;
  private eventUnsubscribers: Array<() => void> = [];
  private contextManager: ContextManager;
  private callbacks: TaskCompletionHandlerCallbacks;

  constructor(contextManager: ContextManager, callbacks: TaskCompletionHandlerCallbacks) {
    this.contextManager = contextManager;
    this.callbacks = callbacks;
  }

  /** 注册 EventBus 监听 */
  register(): void {
    this.eventUnsubscribers.push(
      eventBus.on(XuanjiEvent.ASYNC_TASK_COMPLETED, (result) => {
        this.handleCompletion(result);
      }),
      eventBus.on(XuanjiEvent.ASYNC_TASK_FAILED, (result) => {
        this.handleCompletion(result);
      }),
    );
  }

  /** 新会话复用时重置状态，防止跨会话 pendingCompletions 污染 */
  resetForNewSession(contextManager: ContextManager): void {
    this.pendingCompletions = [];
    this.isAutoSummarizeRun = false;
    this.contextManager = contextManager;
  }

  /** 取消注册 EventBus 监听 */
  dispose(): void {
    for (const unsub of this.eventUnsubscribers) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.eventUnsubscribers = [];
  }

  /** 是否有待处理的完成通知 */
  hasPending(): boolean {
    return this.pendingCompletions.length > 0;
  }

  /** 是否为自动汇总运行 */
  isAutoSummarize(): boolean {
    return this.isAutoSummarizeRun;
  }

  /** 注入待处理的后台任务完成通知到 system prompt */
  injectPendingCompletions(): void {
    if (this.pendingCompletions.length === 0) return;

    const completions = this.pendingCompletions.splice(0);

    for (const completion of completions) {
      const statusText = completion.status === 'completed' ? '已完成' :
        completion.status === 'failed' ? '失败' :
        completion.status === 'cancelled' ? '已取消' : completion.status;
      const hint = [
        `我之前委派的后台任务（${completion.groupId}）已经${statusText}了。`,
        completion.status === 'completed'
          ? `使用 task_control({ action: "status", groupId: "${completion.groupId}" }) 获取完整结果，然后汇总给用户。`
          : completion.status === 'failed'
          ? `失败原因：${completion.error ?? '未知错误'}。告知用户并询问是否重试。`
          : '任务已取消，告知用户。',
      ].filter(Boolean).join('\n');
      this.contextManager.setSystemPromptSuffix(hint, 'async-task-completion');
    }
  }

  /** 检查并在主循环结束后触发自动汇总。等待所有 pending completion 处理完成后再返回。 */
  async checkAndAutoSummarize(): Promise<void> {
    while (this.pendingCompletions.length > 0) {
      try {
        await this.autoSummarize();
      } catch (err) {
        log.error(`Post-run auto-summarize failed: ${err}`);
        break;
      }
    }
  }

  // ── 私有方法 ──

  private handleCompletion(result: AgentTaskCompletionResult): void {
    log.info('[TaskCompletionHandler] handleCompletion called:', {
      groupId: result.groupId,
      status: result.status,
      isAutoSummarizeRun: this.isAutoSummarizeRun,
      isRunning: this.callbacks.isRunning?.(),
    });
    this.pendingCompletions.push(result);

    if (result.result?.metadata) {
      const meta = result.result.metadata;
      const citations: Array<{ agentName: string; originalOutput: string; duration: number; tokensUsed: { input: number; output: number } }> = [];
      if (Array.isArray(meta.citations)) {
        citations.push(...(meta.citations as any[]));
      } else if (meta.originalOutput) {
        citations.push({
          agentName: (meta.agentName as string) || 'unknown-agent',
          originalOutput: meta.originalOutput as string,
          duration: (meta.duration as number) || 0,
          tokensUsed: (meta.tokensUsed as { input: number; output: number }) || { input: 0, output: 0 },
        });
      }
      if (citations.length > 0) this.callbacks.onCitationData?.(citations);
    }

    // 取消的任务不需要汇报，直接丢弃
    if (result.status === 'cancelled') {
      this.pendingCompletions.pop();
      return;
    }

    // 防止 autoSummarize → onAutoSummarize → emit ASYNC_TASK_COMPLETED → handleCompletion 无限递归
    if (!this.isAutoSummarizeRun && !this.callbacks.isRunning?.()) {
      this.checkAndAutoSummarize().catch((err) => {
        log.error(`Auto-summarize failed: ${err}`);
      });
    }
  }

  private async autoSummarize(): Promise<void> {
    this.isAutoSummarizeRun = true;

    // 只取第一个完成通知，一个一个处理
    const completion = this.pendingCompletions.shift();
    if (!completion) {
      this.isAutoSummarizeRun = false;
      return;
    }

    log.info('autoSummarize completion:', JSON.stringify({ groupId: completion.groupId, subAgentId: completion.subAgentId, status: completion.status }));

    const statusText = completion.status === 'completed' ? '已完成' :
      completion.status === 'failed' ? '失败' :
      completion.status === 'cancelled' ? '已取消' : completion.status;
    const subAgentId = completion.subAgentId;
    const hint = [
      `我之前委派的后台任务（${completion.groupId}）已经${statusText}了。`,
      completion.status === 'completed'
        ? `使用 task_control({ action: "status", groupId: "${completion.groupId}" }) 获取完整结果，然后汇总给用户。这是唯一获取结果的方式，不要跳过这一步。`
        : completion.status === 'failed'
        ? `失败原因：${completion.error ?? '未知错误'}。告知用户并询问是否重试。`
        : '任务已取消，告知用户。',
    ].filter(Boolean).join('\n');
    this.contextManager.setSystemPromptSuffix(hint, 'async-task-completion');

    this.callbacks.onAutoSummarize?.(subAgentId, completion.groupId);
    try {
      await this.callbacks.onRun?.('[系统通知] 有一个后台任务刚完成，结果已注入系统提示。立刻向用户汇报这个结果，不要等待其他任务。');
    } finally {
      this.isAutoSummarizeRun = false;
    }
  }
}
