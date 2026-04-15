/**
 * Agent Team Types — 团队协作类型定义
 *
 * 定义多 agent 协作的核心类型和接口
 */

import type { AgentRoleType } from '../SubAgentContext';
import type { AgentState, ToolResult } from '@/core/types';

/**
 * 团队成员定义
 */
export interface TeamMember {
  /** 成员唯一标识 */
  id: string;
  /** 成员角色 */
  role: AgentRoleType;
  /** 成员名称（可选） */
  name?: string;
  /** 能力描述列表 */
  capabilities: string[];
  /** 允许使用的工具（空数组表示使用默认工具集） */
  tools?: string[];
  /** 优先级（数字越大优先级越高） */
  priority?: number;
  /** 成员特定的系统提示（会追加到角色默认提示后） */
  systemPrompt?: string;
  /**
   * 成员独立超时（毫秒）。
   * 若未设置，由 TeamManager 根据策略自动推算：
   * - parallel: 等于团队总超时（并行不叠加）
   * - sequential / pipeline: 团队总超时 / 成员数
   * - hierarchical: 团队总超时 / (workers + 1)
   * - debate: 团队总超时 / (成员数 × maxRounds)
   */
  timeout?: number;
}

/**
 * 团队消息类型
 */
export type TeamMessageType =
  | 'task'       // 任务分配
  | 'result'     // 任务结果
  | 'question'   // 提问
  | 'answer'     // 回答
  | 'broadcast'  // 广播消息
  | 'handoff';   // 任务移交

/**
 * 团队消息
 */
export interface TeamMessage {
  /** 消息 ID */
  id: string;
  /** 发送者 ID */
  from: string;
  /** 接收者 ID（'all' 表示广播，'manager' 表示发给管理器） */
  to: string | 'all' | 'manager';
  /** 消息类型 */
  type: TeamMessageType;
  /** 消息内容 */
  content: string;
  /** 时间戳 */
  timestamp: number;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 团队协作策略
 */
export type TeamStrategy =
  | 'sequential'   // 串行：按顺序执行任务
  | 'parallel'     // 并行：同时执行多个子任务
  | 'hierarchical' // 层级：有主 agent 协调其他 agent
  | 'debate'       // 辩论：多个 agent 讨论达成共识
  | 'pipeline';    // 流水线：前一个 agent 的输出是下一个的输入

/**
 * 团队配置
 */
export interface TeamConfig {
  /** 团队名称 */
  name: string;
  /** 团队成员 */
  members: TeamMember[];
  /** 协作策略 */
  strategy: TeamStrategy;
  /** 团队目标描述 */
  goal: string;
  /** 最大轮次（防止无限循环） */
  maxRounds?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 是否启用共享知识库 */
  enableSharedKnowledge?: boolean;
  /** 是否记录完整消息历史 */
  recordHistory?: boolean;
  
  // 🆕 超时分配策略配置
  /** Hierarchical 模式下 Leader 占用的时间比例（默认 0.5，即 50%） */
  hierarchicalLeaderRatio?: number;
  /** Debate 模式下首轮占用的时间比例（默认 0.4，即 40%） */
  debateFirstRoundRatio?: number;
  /** 是否启用动态超时调整（默认 true） */
  enableDynamicTimeout?: boolean;
  /** 单个成员的最小超时时间（毫秒，默认 30000 即 30s） */
  minMemberTimeout?: number;
}

/**
 * 团队上下文
 */
export interface TeamContext {
  /** 团队配置 */
  config: TeamConfig;
  /** 共享知识库 */
  sharedKnowledge: Map<string, unknown>;
  /** 消息历史 */
  messageHistory: TeamMessage[];
  /** 成员状态 */
  memberStates: Map<string, AgentState>;
  /** 当前轮次 */
  currentRound: number;
  /** 开始时间 */
  startTime: number;
}

/**
 * 任务分配
 */
export interface TaskAssignment {
  /** 任务 ID */
  taskId: string;
  /** 分配给的成员 ID */
  memberId: string;
  /** 任务描述 */
  description: string;
  /** 任务优先级 */
  priority?: number;
  /** 依赖的任务 ID 列表（这些任务完成后才能开始） */
  dependencies?: string[];
  /** 任务元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 任务执行结果
 */
export interface TaskExecutionResult {
  /** 任务 ID */
  taskId: string;
  /** 执行的成员 ID */
  memberId: string;
  /** 执行结果 */
  result: string;
  /** 是否成功 */
  success: boolean;
  /** 执行耗时（毫秒） */
  duration: number;
  /** Token 使用量 */
  tokensUsed: { input: number; output: number };
  /** 错误信息（如果失败） */
  error?: string;
}

/**
 * 团队执行结果
 */
export interface TeamExecutionResult {
  /** 团队目标 */
  goal: string;
  /** 最终输出 */
  output: string;
  /** 各成员的执行结果 */
  memberResults: TaskExecutionResult[];
  /** 总耗时（毫秒） */
  duration: number;
  /** 总 token 使用量 */
  totalTokens: { input: number; output: number };
  /** 执行的轮次数 */
  rounds: number;
  /** 是否成功 */
  success: boolean;
  /** 是否超时 */
  timedOut: boolean;
}

/**
 * 团队管理器接口
 */
export interface ITeamManager {
  /**
   * 创建团队
   */
  createTeam(config: TeamConfig): Promise<void>;

  /**
   * 执行团队任务
   */
  execute(goal: string): Promise<TeamExecutionResult>;

  /**
   * 发送消息
   */
  sendMessage(message: TeamMessage): Promise<void>;

  /**
   * 获取团队上下文
   */
  getContext(): TeamContext;

  /**
   * 停止执行
   */
  stop(): void;
}

/**
 * 默认团队配置
 */
export const DEFAULT_TEAM_CONFIG = {
  maxRounds: 10,
  timeout: 1_800_000, // 30 分钟（多 agent 协作需要充足时间，从 20min 提升到 30min）
  enableSharedKnowledge: true,
  recordHistory: true,
  
  // 超时分配策略默认值
  hierarchicalLeaderRatio: 0.5,   // Leader 占 50%
  debateFirstRoundRatio: 0.4,     // 首轮占 40%
  enableDynamicTimeout: true,      // 启用动态调整
  minMemberTimeout: 30_000,        // 最小 30s
} as const;
