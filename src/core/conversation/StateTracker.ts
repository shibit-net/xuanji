import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import type { ConversationState, StateChangeHandler, IntentResult, ConversationSnapshot } from './types';

export class StateTracker {
  private state: ConversationState = 'idle';
  private lastIntent: IntentResult | null = null;
  private currentTask: { id: string } | null = null;
  private handlers = new Set<StateChangeHandler>();

  getState(): ConversationState { return this.state; }
  getLastIntent(): IntentResult | null { return this.lastIntent; }
  getCurrentTask(): { id: string } | null { return this.currentTask; }

  setIntent(intent: IntentResult): void { this.lastIntent = intent; }
  setCurrentTask(task: { id: string } | null): void { this.currentTask = task; }
  clearIntent(): void { this.lastIntent = null; }
  keepIntent(): void { /* 保持意图，跳过下一次分析 */ }

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

  takeSnapshot(): ConversationSnapshot {
    return {
      state: this.state,
      lastIntent: this.lastIntent,
      currentTaskId: this.currentTask?.id ?? null,
      timestamp: Date.now(),
    };
  }

  restoreSnapshot(snapshot: ConversationSnapshot): void {
    this.state = snapshot.state;
    this.lastIntent = snapshot.lastIntent;
    if (snapshot.currentTaskId) {
      this.currentTask = { id: snapshot.currentTaskId };
    } else {
      this.currentTask = null;
    }
  }
}
