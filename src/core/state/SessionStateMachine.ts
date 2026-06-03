/**
 * SessionStateMachine — 替代 StateTracker + _pendingQueue + interrupt() 50ms 轮询。
 *
 * 5 状态：idle / thinking / executing / outputting / waiting_async
 * thinking: Agent 在思考（LLM 流式推理），可快速中断
 * executing: Agent 在工具执行中，需等待工具完成后中断
 * 7 事件 → 返回 SessionAction 驱动 ChatSession 行为。
 * 同时实现 InterruptChecker 接口供 AgentLoop 查询中断状态。
 */

import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import { logger } from '@/core/logger';
import type { InterruptChecker } from '@/agent/InterruptChecker';

const log = logger.child({ module: 'SessionStateMachine' });

// ============================================================
// 状态 / 事件 / Action 定义
// ============================================================

export type SessionState = 'idle' | 'thinking' | 'executing' | 'outputting' | 'waiting_async';

export type SessionEvent =
  | { type: 'USER_MESSAGE'; message: string }
  | { type: 'USER_INTERRUPT'; message?: string }
  | { type: 'AGENT_STARTED' }
  | { type: 'AGENT_TOOL_STARTED' }
  | { type: 'AGENT_TEXT_STARTED' }
  | { type: 'AGENT_COMPLETED' }
  | { type: 'ASYNC_TASK_COMPLETED'; taskId: string };

export type SessionAction =
  | { type: 'RUN_AGENT'; message: string }
  | { type: 'ABORT_AGENT' }
  | { type: 'QUEUE_ONLY' }
  | { type: 'EMIT_SESSION_IDLE' }
  | { type: 'RUN_AUTO_SUMMARIZE' }
  | { type: 'NOOP' };

export type StateChangeHandler = (from: SessionState, to: SessionState) => void;

export interface StateSnapshot {
  state: SessionState;
  timestamp: number;
}

// ============================================================
// SessionStateMachine
// ============================================================

export class SessionStateMachine implements InterruptChecker {
  private state: SessionState = 'idle';
  private handlers = new Set<StateChangeHandler>();
  pendingMessages: string[] = [];
  private _abortRequested = false;
  private _interruptAfterStream = false;
  private _textOutputStarted = false;
  private _pendingAsyncTaskIds = new Set<string>();

  // ============================================================
  // 兼容旧 StateTracker API
  // ============================================================

  getState(): SessionState {
    return this.state;
  }

  transitionTo(newState: SessionState): void {
    const old = this.state;
    if (old === newState) return;
    this.state = newState;
    eventBus.emitSync(XuanjiEvent.CONVERSATION_STATE_CHANGED, { from: old, to: newState });
    for (const h of this.handlers) {
      try { h(old, newState); } catch { /* isolate */ }
    }
    log.info(`State: ${old} → ${newState}`);
  }

  onStateChange(handler: StateChangeHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  takeSnapshot(): StateSnapshot {
    return { state: this.state, timestamp: Date.now() };
  }

  restoreSnapshot(snapshot: StateSnapshot): void {
    this.state = snapshot.state;
  }

  // ============================================================
  // 新 API：事件驱动的 transition
  // ============================================================

  transition(event: SessionEvent): SessionAction {
    switch (this.state) {
      case 'idle':
        return this.handleInIdle(event);
      case 'thinking':
        return this.handleInThinking(event);
      case 'executing':
        return this.handleInExecuting(event);
      case 'outputting':
        return this.handleInOutputting(event);
      case 'waiting_async':
        return this.handleInWaitingAsync(event);
    }
  }

  // ============================================================
  // InterruptChecker 实现（供 AgentLoop 使用）
  // ============================================================

  shouldStop(): boolean {
    return this._abortRequested || (this.pendingMessages.length > 0 && !this._textOutputStarted);
  }

  shouldAbort(): boolean {
    return this._abortRequested;
  }

  shouldStopAtCheckpoint(): boolean {
    return this._interruptAfterStream;
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /** 注册异步任务（task / agent_team 创建时调用） */
  registerAsyncTask(taskId: string): void {
    this._pendingAsyncTaskIds.add(taskId);
  }

  /** 异步任务完成/失败时调用 */
  completeAsyncTask(taskId: string): void {
    this._pendingAsyncTaskIds.delete(taskId);
  }

  get pendingAsyncTaskCount(): number {
    return this._pendingAsyncTaskIds.size;
  }

  // ============================================================
  // 状态内部处理器
  // ============================================================

  private handleInIdle(event: SessionEvent): SessionAction {
    switch (event.type) {
      case 'USER_MESSAGE':
        this._textOutputStarted = false;
        this._abortRequested = false;
        this._interruptAfterStream = false;
        this.transitionTo('thinking');
        return { type: 'RUN_AGENT', message: event.message };

      case 'USER_INTERRUPT':
        // idle 时无 agent 在运行，仅排队
        if (event.message) this.pendingMessages.push(event.message);
        return { type: 'QUEUE_ONLY' };

      case 'AGENT_STARTED':
        this._textOutputStarted = false;
        this._abortRequested = false;
        this._interruptAfterStream = false;
        this.transitionTo('thinking');
        return { type: 'NOOP' };

      default:
        return { type: 'NOOP' };
    }
  }

  private handleInThinking(event: SessionEvent): SessionAction {
    switch (event.type) {
      case 'USER_MESSAGE':
        // 思考中 → 直接中断并排队执行（LLM 流会快速响应 abort）
        this.pendingMessages.push(event.message);
        this._abortRequested = true;
        return { type: 'QUEUE_ONLY' };

      case 'USER_INTERRUPT':
        if (event.message) this.pendingMessages.push(event.message);
        this._abortRequested = true;
        return { type: 'ABORT_AGENT' };

      case 'AGENT_TOOL_STARTED':
        this.transitionTo('executing');
        return { type: 'NOOP' };

      case 'AGENT_TEXT_STARTED':
        this._textOutputStarted = true;
        this.transitionTo('outputting');
        return { type: 'NOOP' };

      case 'AGENT_COMPLETED':
        return this.handleAgentCompleted();

      case 'ASYNC_TASK_COMPLETED':
        this._pendingAsyncTaskIds.delete(event.taskId);
        return { type: 'NOOP' };

      default:
        return { type: 'NOOP' };
    }
  }

  private handleInExecuting(event: SessionEvent): SessionAction {
    switch (event.type) {
      case 'USER_MESSAGE':
        // 工具执行中 → 排队等待工具完成后执行
        this.pendingMessages.push(event.message);
        this._abortRequested = true;
        return { type: 'QUEUE_ONLY' };

      case 'USER_INTERRUPT':
        if (event.message) this.pendingMessages.push(event.message);
        this._abortRequested = true;
        return { type: 'ABORT_AGENT' };

      case 'AGENT_TEXT_STARTED':
        this._textOutputStarted = true;
        this.transitionTo('outputting');
        return { type: 'NOOP' };

      case 'AGENT_COMPLETED':
        return this.handleAgentCompleted();

      case 'ASYNC_TASK_COMPLETED':
        this._pendingAsyncTaskIds.delete(event.taskId);
        return { type: 'NOOP' };

      default:
        return { type: 'NOOP' };
    }
  }

  private handleInOutputting(event: SessionEvent): SessionAction {
    switch (event.type) {
      case 'USER_MESSAGE':
        this.pendingMessages.push(event.message);
        this._interruptAfterStream = true;
        return { type: 'QUEUE_ONLY' };

      case 'USER_INTERRUPT':
        if (event.message) this.pendingMessages.push(event.message);
        this._abortRequested = true;
        return { type: 'ABORT_AGENT' };

      case 'AGENT_COMPLETED':
        return this.handleAgentCompleted();

      case 'ASYNC_TASK_COMPLETED':
        this._pendingAsyncTaskIds.delete(event.taskId);
        return { type: 'NOOP' };

      default:
        return { type: 'NOOP' };
    }
  }

  private handleInWaitingAsync(event: SessionEvent): SessionAction {
    switch (event.type) {
      case 'USER_MESSAGE':
        this._textOutputStarted = false;
        this._abortRequested = false;
        this.transitionTo('thinking');
        return { type: 'RUN_AGENT', message: event.message };

      case 'USER_INTERRUPT':
        if (event.message) this.pendingMessages.push(event.message);
        return { type: 'QUEUE_ONLY' };

      case 'ASYNC_TASK_COMPLETED':
        this._pendingAsyncTaskIds.delete(event.taskId);
        if (this._pendingAsyncTaskIds.size === 0 && this.pendingMessages.length === 0) {
          this.transitionTo('idle');
          return { type: 'EMIT_SESSION_IDLE' };
        }
        if (this._pendingAsyncTaskIds.size === 0 && this.pendingMessages.length > 0) {
          // 所有异步任务完成，且有排队消息 → 继续运行
          this._textOutputStarted = false;
          this._abortRequested = false;
          this.transitionTo('thinking');
          return {
            type: 'RUN_AGENT',
            message: this.consumePendingMessages(),
          };
        }
        return { type: 'RUN_AUTO_SUMMARIZE' };

      case 'AGENT_STARTED':
        this._textOutputStarted = false;
        this._abortRequested = false;
        this._interruptAfterStream = false;
        this.transitionTo('thinking');
        return { type: 'NOOP' };

      case 'AGENT_COMPLETED':
        return this.handleAgentCompleted();

      default:
        return { type: 'NOOP' };
    }
  }

  /** Agent 完成后的统一处理 */
  private handleAgentCompleted(): SessionAction {
    this._textOutputStarted = false;
    this._abortRequested = false;
    this._interruptAfterStream = false;

    if (this.pendingMessages.length > 0) {
      // 有排队消息 → 继续运行（替代 drainPendingQueue + batch join）
      this.transitionTo('thinking');
      return { type: 'RUN_AGENT', message: this.consumePendingMessages() };
    }
    if (this._pendingAsyncTaskIds.size > 0) {
      this.transitionTo('waiting_async');
      return { type: 'NOOP' };
    }
    this.transitionTo('idle');
    return { type: 'EMIT_SESSION_IDLE' };
  }

  private consumePendingMessages(): string {
    const combined: string[] = [];
    while (this.pendingMessages.length > 0) {
      combined.push(this.pendingMessages.shift()!);
    }
    return combined.join('\n');
  }
}
