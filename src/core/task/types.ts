/**
 * Task 类型定义
 *
 * 统一的后台任务类型，替代旧的 TaskStep/TaskOrchestrator 体系。
 * 每个 task 工具/team 工具创建的后台任务都是一个 TaskGroup。
 */

import type { ToolResult } from '@/core/types';

/** 任务组状态 */
export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** 任务组类型 */
export type TaskGroupType = 'team' | 'task';

/** 任务执行阶段 */
export type TaskPhase = 'setup' | 'executing' | 'synthesizing';

/** 后台任务进度 */
export interface TaskProgress {
  phase: TaskPhase;
  totalMembers: number;
  completedMembers: number;
  currentMember?: string;
  currentMemberStatus?: string;
  elapsed: number;
  estimatedRemaining?: number;
}

/** 后台任务组成员状态 */
export type TaskMemberStatus = 'pending' | 'waiting' | 'running' | 'completed' | 'failed';

/** 后台任务组成员 */
export interface TaskMember {
  id: string;
  name: string;
  status: TaskMemberStatus;
  startTime?: number;
  endTime?: number;
  /** 失败原因（status=failed 时填充） */
  failureReason?: string;
  /** 重试次数 */
  retryCount?: number;
}

/** 任务完成通知回调 */
export type TaskCompletionCallback = (result: TaskCompletionResult) => void;

/** 任务完成结果 */
export interface TaskCompletionResult {
  groupId: string;
  status: TaskStatus;
  result?: ToolResult;
  error?: string;
  completedAt: number;
  /** 关联的子 agent ID，用于前端精确清理 workspace 节点 */
  subAgentId?: string;
}

/** 后台任务组 */
export interface TaskGroup {
  groupId: string;
  type: TaskGroupType;
  goal: string;
  status: TaskStatus;
  progress: TaskProgress;
  members: TaskMember[];
  startedAt: number;
  completedAt?: number;
  result?: ToolResult;
  abortController: AbortController;
  workingDir?: string;
  isolation?: 'none' | 'worktree';
  /** 完成通知回调集合 */
  completionCallbacks: Set<TaskCompletionCallback>;
  /** 关联的子 agent ID */
  subAgentId?: string;
}

/** 启动任务组参数 */
export interface StartTaskOptions {
  type: TaskGroupType;
  goal: string;
  members?: TaskMember[];
  workingDir?: string;
  isolation?: 'none' | 'worktree';
  /** 关联的子 agent ID，透传给 completion 事件供前端精确清理 */
  subAgentId?: string;
  /** 执行函数：接收 abortSignal + onProgress + groupId，返回 ToolResult */
  executor: (signal: AbortSignal, onProgress: (progress: Partial<TaskProgress>) => void, groupId: string) => Promise<ToolResult>;
}

/** TaskOrchestrator 配置 */
export interface TaskOrchestratorConfig {
  maxConcurrent: number;
  maxLifetimeMs: number;
  maxCompletedTasks: number;
}

// ── 旧类型（待移除） ────────────────────────────────

export type IntentResult = {
  scene: string | null;
  agent: string | null;
  complexity: 'simple' | 'standard' | 'complex';
  confidence: number;
  matchMethod: 'llm' | 'embedding' | 'keyword' | 'default';
};
