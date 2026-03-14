/**
 * Planner 模块 - 类型定义
 */

import type { ExecutionPlan, TaskComplexity } from '@/core/routing/types';

/**
 * Planner 配置
 */
export interface PlannerConfig {
  /** Planner 使用的模型（默认使用 Sonnet） */
  model?: string;
  /** 最大规划步骤数（默认 10） */
  maxSteps?: number;
  /** 规划超时时间（毫秒，默认 30000） */
  timeout?: number;
  /** 是否需要用户确认（默认 true） */
  requireConfirmation?: boolean;
}

/**
 * 规划上下文
 */
export interface PlanningContext {
  /** 用户输入 */
  userInput: string;
  /** 任务复杂度分析结果 */
  complexity: TaskComplexity;
  /** 可用的 Agent Profile IDs */
  availableAgents?: string[];
  /** 历史消息数（用于上下文理解） */
  messageCount?: number;
}

/**
 * 子任务定义（简化版）
 */
export interface SubTask {
  /** 子任务 ID */
  id: string;
  /** 子任务描述 */
  task: string;
  /** 分配的 Agent Profile ID */
  agentProfile?: string;
  /** 依赖的子任务 IDs */
  dependencies?: string[];
  /** 是否可并行执行 */
  parallel?: boolean;
}
