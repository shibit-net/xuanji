import type { Message } from '@/core/types';

export type ConversationState = 'idle' | 'analyzing' | 'executing' | 'outputting' | 'waiting_async';

export type InputSource = 'chat_input' | 'shortcut' | 'external_trigger' | 'auto_summarize';

export interface UserInput {
  raw: string;
  timestamp: number;
  source: InputSource;
}

export interface ProcessedInput {
  original: string;
  mentions: string[];
  contextHints: string[];
  timestamp: number;
  source: InputSource;
}

export interface IntentResult {
  scene: string | null;
  agent: string | null;
  complexity: 'simple' | 'standard' | 'complex';
  confidence: number;
  matchMethod: 'llm' | 'embedding' | 'keyword' | 'default';
}

export interface RoutingDecision {
  action: 'delegate_single_agent' | 'delegate_agent_team' | 'run_main_agent' | 'direct_answer' | 'execute_async' | 'ask_user';
  agentId?: string;
  scene?: string;
  prompt?: string;
  answer?: string;
  question?: string;
  members?: Array<{ agentId: string; role: string }>;
  task?: any;
}

export type ExecuteAction =
  | { action: 'terminate_and_restart'; mergedInput: string; partialResults: any[] }
  | { action: 'gentle_append'; message: string }
  | { action: 'queue'; message: string };

export type StateChangeHandler = (from: ConversationState, to: ConversationState) => void;

export interface ConversationSnapshot {
  state: ConversationState;
  lastIntent: IntentResult | null;
  currentTaskId: string | null;
  timestamp: number;
}

export type IntentAnalyzerFn = (input: string, history?: Message[]) => Promise<IntentResult>;
