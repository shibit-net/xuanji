/**
 * TaskCompletionHandler — 后台异步任务完成处理
 *
 * 通过 EventBus 监听 ASYNC_TASK_COMPLETED / ASYNC_TASK_FAILED 事件，
 * 将结果注入到 AgentLoop 的 system prompt 后缀中。
 */

import type { ContextManager } from '@/core/context/ContextManager';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import type { AgentTaskCompletionResult } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'TaskCompletionHandler' });

export interface TaskCompletionHandlerCallbacks {
  onAutoSummarize?: () => void;
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
      eventBus.on<AgentTaskCompletionResult>(XuanjiEvent.ASYNC_TASK_COMPLETED, (result) => {
        this.handleCompletion(result);
      }),
      eventBus.on<AgentTaskCompletionResult>(XuanjiEvent.ASYNC_TASK_FAILED, (result) => {
        this.handleCompletion(result);
      }),
    );
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
    if (!this.isAutoSummarizeRun || this.pendingCompletions.length === 0) return;

    const completions = this.pendingCompletions.splice(0);
    for (const completion of completions) {
      const statusText = completion.status === 'completed' ? '✅ 已完成' :
        completion.status === 'failed' ? '❌ 失败' :
        completion.status === 'cancelled' ? '🚫 已取消' : completion.status;
      const output = completion.result?.content ?? '';
      const hint = [
        `\n[后台任务完成通知] 任务组 ${completion.groupId} ${statusText}`,
        completion.status === 'completed'
          ? '请直接将以下结果汇总后告知用户，不要再次调用 task_control 查询。'
          : completion.status === 'failed'
          ? `失败原因: ${completion.error ?? '未知'}。请告知用户并询问是否需要重试。`
          : '任务已取消。请告知用户。',
        completion.status === 'completed' && output
          ? `\n--- 任务输出 ---\n${output}\n--- 输出结束 ---`
          : '',
      ].filter(Boolean).join('\n');
      this.contextManager.setSystemPromptSuffix(hint, 'async-task-completion');
    }
  }

  /** 检查并在主循环结束后触发自动汇总 */
  checkAndAutoSummarize(): void {
    if (this.pendingCompletions.length > 0) {
      this.autoSummarize().catch((err) => {
        log.error(`Post-run auto-summarize failed: ${err}`);
      });
    }
  }

  // ── 私有方法 ──

  private handleCompletion(result: AgentTaskCompletionResult): void {
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

    if (!this.callbacks.isRunning?.()) {
      this.autoSummarize().catch((err) => {
        log.error(`Auto-summarize failed: ${err}`);
      });
    }
  }

  private async autoSummarize(): Promise<void> {
    this.callbacks.onAutoSummarize?.();
    this.isAutoSummarizeRun = true;
    try {
      await this.callbacks.onRun?.('[系统通知] 后台任务已完成，请汇总结果告知用户');
    } finally {
      this.isAutoSummarizeRun = false;
    }
  }
}
