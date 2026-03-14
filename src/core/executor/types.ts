/**
 * Executor 模块 - 类型定义
 */

import type { ExecutionPlan } from '@/core/routing/types';

/**
 * Executor 配置
 */
export interface ExecutorConfig {
  /** 最大并发子任务数（默认 3） */
  maxConcurrent?: number;
  /** 子任务超时时间（毫秒，默认 300000 = 5 分钟） */
  timeout?: number;
  /** 是否在错误时停止（默认 false，继续执行其他子任务） */
  stopOnError?: boolean;
}

/**
 * 子任务执行结果
 */
export interface SubTaskResult {
  /** 步骤序号 */
  order: number;
  /** 步骤描述 */
  description: string;
  /** Agent ID */
  agentId?: string;
  /** 执行状态 */
  status: 'success' | 'failed' | 'skipped';
  /** 执行结果（成功时） */
  result?: string;
  /** 错误信息（失败时） */
  error?: string;
  /** 执行耗时（毫秒） */
  duration?: number;
  /** 开始时间 */
  startedAt?: string;
  /** 结束时间 */
  completedAt?: string;
}

/**
 * 执行计划结果
 */
export interface ExecutionResult {
  /** 任务 ID */
  taskId: string;
  /** 任务描述 */
  taskDescription: string;
  /** 执行状态 */
  status: 'success' | 'partial' | 'failed';
  /** 子任务结果 */
  subTaskResults: SubTaskResult[];
  /** 总耗时（毫秒） */
  totalDuration: number;
  /** 开始时间 */
  startedAt: string;
  /** 结束时间 */
  completedAt: string;
  /** 汇总结果 */
  summary?: string;
}

/**
 * 执行进度回调
 */
export interface ExecutionCallbacks {
  /** 子任务开始时 */
  onSubTaskStart?: (order: number, description: string) => void;
  /** 子任务完成时 */
  onSubTaskComplete?: (result: SubTaskResult) => void;
  /** 执行进度更新 */
  onProgress?: (completed: number, total: number) => void;
}
