/**
 * Async Agent Task — 异步后台 Agent 任务类型定义
 *
 * 对标 BackgroundTaskManager，管理后台运行的 Agent 任务组（team/task）。
 * 主 agent 委派后立即返回，用户可查询进度、发起新任务、调整运行中的任务。
 */

import type { ToolResult } from '@/core/types';

/** 任务组状态 */
export type AgentTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** 任务组类型 */
export type AgentTaskType = 'team' | 'task';

/** 任务执行阶段 */
export type AgentTaskPhase = 'setup' | 'executing' | 'synthesizing';

/** 后台任务进度 */
export interface AgentTaskProgress {
  phase: AgentTaskPhase;
  totalMembers: number;
  completedMembers: number;
  currentMember?: string;
  currentMemberStatus?: string;
  elapsed: number;
  estimatedRemaining?: number;
}

/** 后台任务组成员状态 */
export type AgentTaskMemberStatus = 'pending' | 'running' | 'completed' | 'failed';

/** 后台任务组成员 */
export interface AgentTaskMember {
  id: string;
  name: string;
  status: AgentTaskMemberStatus;
  startTime?: number;
  endTime?: number;
}

/** 任务完成通知回调 */
export type AgentTaskCompletionCallback = (result: AgentTaskCompletionResult) => void;

/** 任务完成结果 */
export interface AgentTaskCompletionResult {
  groupId: string;
  status: AgentTaskStatus;
  result?: ToolResult;
  error?: string;
  completedAt: number;
}

/** 后台 Agent 任务组 */
export interface AgentTaskGroup {
  groupId: string;
  type: AgentTaskType;
  goal: string;
  status: AgentTaskStatus;
  progress: AgentTaskProgress;
  members: AgentTaskMember[];
  startedAt: number;
  completedAt?: number;
  result?: ToolResult;
  abortController: AbortController;
  workingDir?: string;
  isolation?: 'none' | 'worktree';
  /** 完成通知回调集合 */
  completionCallbacks: Set<AgentTaskCompletionCallback>;
}

/** 启动任务组参数 */
export interface StartAgentTaskOptions {
  type: AgentTaskType;
  goal: string;
  members?: AgentTaskMember[];
  workingDir?: string;
  isolation?: 'none' | 'worktree';
  /** 执行函数：接收 abortSignal + onProgress + groupId，返回 ToolResult */
  executor: (signal: AbortSignal, onProgress: (progress: Partial<AgentTaskProgress>) => void, groupId: string) => Promise<ToolResult>;
}

/** AsyncAgentTaskManager 配置 */
export interface AsyncAgentTaskConfig {
  maxConcurrent: number;
  maxLifetimeMs: number;
  maxCompletedTasks: number;
}
