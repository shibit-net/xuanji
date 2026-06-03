/**
 * 对话状态机
 *
 * 状态：
 *   idle          — 空闲，等待用户输入
 *   executing     — 主 agent 正在执行
 *   outputting    — 主 agent 正在输出回复
 *   waiting_async — 有后台任务在跑，主 agent 空闲
 */

import { eventBus } from '@/infrastructure/events/EventBus';
import { XuanjiEvent } from '@/infrastructure/events/events';

export type ConversationState = 'idle' | 'executing' | 'outputting' | 'waiting_async';

export type StateChangeHandler = (from: ConversationState, to: ConversationState) => void;

export interface StateSnapshot {
  state: ConversationState;
  timestamp: number;
}

export class StateTracker {
  private state: ConversationState = 'idle';
  private handlers = new Set<StateChangeHandler>();

  getState(): ConversationState {
    return this.state;
  }

  transitionTo(newState: ConversationState): void {
    const old = this.state;
    if (old === newState) return;
    this.state = newState;
    eventBus.emit(XuanjiEvent.CONVERSATION_STATE_CHANGED, { from: old, to: newState });
    for (const h of this.handlers) {
      try { h(old, newState); } catch { /* isolate */ }
    }
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
}
