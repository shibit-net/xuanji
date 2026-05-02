/**
 * ConversationManager — 对话管理中心
 *
 * 子模块：InputReceiver, IntentAnalyzer, StateTracker, RoutingDecider, ResponseDispatcher
 */

import { logger } from '@/core/logger';
import { InputReceiver } from './InputReceiver';
import { IntentAnalyzer } from './IntentAnalyzer';
import { StateTracker } from './StateTracker';
import { RoutingDecider } from './RoutingDecider';
import { ResponseDispatcher } from './ResponseDispatcher';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import type { UserInput, ProcessedInput, InputSource, IntentResult, RoutingDecision, ExecuteAction, ConversationState, IntentAnalyzerFn } from './types';

const log = logger.child({ module: 'ConversationManager' });

export class ConversationManager {
  private _inputReceiver = new InputReceiver();
  private _intentAnalyzer = new IntentAnalyzer();
  private _stateTracker = new StateTracker();
  private _routingDecider = new RoutingDecider();
  private _responseDispatcher = new ResponseDispatcher();
  private _pendingQueue: ProcessedInput[] = [];
  private _promptBuilder: import('@/core/prompt/LayeredPromptBuilder').LayeredPromptBuilder | null = null;
  private _activeAbortController: AbortController | null = null;

  constructor() {
    log.info('ConversationManager initialized');
  }

  // ── Delegates ─────────────────────────────────────────

  get stateTracker(): StateTracker { return this._stateTracker; }
  get responseDispatcher(): ResponseDispatcher { return this._responseDispatcher; }
  getState(): ConversationState { return this._stateTracker.getState(); }
  getLastIntent(): IntentResult | null { return this._stateTracker.getLastIntent(); }

  // ── Input ──────────────────────────────────────────────

  receive(raw: string, source: InputSource = 'chat_input'): UserInput {
    const input = this._inputReceiver.receive(raw, source);
    eventBus.emit(XuanjiEvent.USER_INPUT_RECEIVED, { raw, source, timestamp: input.timestamp });
    return input;
  }

  preprocess(input: UserInput): ProcessedInput {
    return this._inputReceiver.preprocess(input);
  }

  enqueue(message: string): void {
    this._pendingQueue.push(this.preprocess(this.receive(message)));
  }

  interrupt(message: string): void {
    this._pendingQueue.unshift(this.preprocess(this.receive(message)));
  }

  consumePending(): ProcessedInput | null {
    return this._pendingQueue.shift() ?? null;
  }

  hasPending(): boolean { return this._pendingQueue.length > 0; }

  // ── Intent ─────────────────────────────────────────────

  setIntentAnalyzer(fn: IntentAnalyzerFn): void {
    this._intentAnalyzer.setAnalyzer(fn);
  }

  async analyzeIntent(input: string): Promise<IntentResult> {
    this._stateTracker.transitionTo('analyzing');
    const result = await this._intentAnalyzer.analyze(input);
    this._stateTracker.setIntent(result);
    eventBus.emit(XuanjiEvent.INTENT_ANALYZED, result);
    return result;
  }

  // ── Prompt Building ──────────────────────────────────────

  setPromptBuilder(builder: import('@/core/prompt/LayeredPromptBuilder').LayeredPromptBuilder): void {
    this._promptBuilder = builder;
  }

  async buildPrompt(userMessage: string, intent: IntentResult): Promise<string> {
    if (!this._promptBuilder) return '';
    const buildResult = await this._promptBuilder.build({
      userMessage,
      scene: intent.scene ?? undefined,
      complexity: intent.complexity,
      agent: intent.agent ?? undefined,
      matchMethod: intent.matchMethod,
    });
    return buildResult.prompt;
  }

  // ── Routing ────────────────────────────────────────────

  decide(intent: IntentResult): RoutingDecision {
    return this._routingDecider.decide(intent, this._stateTracker.getState());
  }

  whileExecuting(input: ProcessedInput): ExecuteAction {
    return this._routingDecider.whileExecuting(input);
  }

  whileOutputting(input: ProcessedInput): { action: 'queue'; message: string } {
    return this._routingDecider.whileOutputting(input);
  }

  whileWaitingAsync(input: ProcessedInput): RoutingDecision {
    return this._routingDecider.whileWaitingAsync(input);
  }

  // ── State ──────────────────────────────────────────────

  transitionTo(newState: ConversationState): void {
    this._stateTracker.transitionTo(newState);
  }

  onStateChange(handler: (from: ConversationState, to: ConversationState) => void): () => void {
    return this._stateTracker.onStateChange(handler);
  }

  // ── Abort Controller ─────────────────────────────────────

  get activeAbortController(): AbortController | null {
    return this._activeAbortController;
  }

  get inputReceiver(): InputReceiver { return this._inputReceiver; }
}
