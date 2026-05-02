// Task module type definitions

import type { IntentResult } from '@/core/conversation/types';

export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'terminated';

export type StepType = 'intent_analysis' | 'main_agent' | 'sub_agent' | 'agent_team' | 'synthesis' | 'user_confirmation';

export interface TaskStep {
  id: string;
  type: StepType;
  agentId: string;
  scene: string;
  description: string;
  input: string;
  dependencies: string[];
  status: TaskStatus;
  result?: TaskStepResult;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskStepResult {
  success: boolean;
  output?: string;
  tokenUsage?: { input: number; output: number };
  duration?: number;
  error?: string;
}

export interface TaskContext {
  workingDir: string;
  userId: string;
  depth: number;
  parentTaskId?: string;
}

export interface Task {
  id: string;
  type: 'sync' | 'async';
  status: TaskStatus;
  priority: number;
  intent: IntentResult;
  goal: string;
  complexity: 'simple' | 'standard' | 'complex';
  steps: TaskStep[];
  currentStepIndex: number;
  context: TaskContext;
  parentTaskId?: string;
  result?: TaskStepResult;
  completedSteps: TaskStepResult[];
  abortController: AbortController;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  timeout: number;
  retryCount: number;
  maxRetries: number;
}

export interface TaskPlan {
  steps: TaskStep[];
  estimatedDuration: number;
  complexity: string;
}

export interface CompletedAsyncTask {
  id: string;
  taskId: string;
  description: string;
  result: string;
  tokensUsed: { input: number; output: number };
  duration: number;
  completedAt: number;
}

export interface PartialResult {
  stepId: string;
  type: StepType;
  output: string;
  success: boolean;
}

export type AgentExecutor = (step: TaskStep, task: Task) => Promise<TaskStepResult>;
