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
  /**
   * Agent ID（预置 agent 的 ID 或自定义角色名）
   * 推荐使用 match_agent 返回的预置 agent ID：coder, explore, test-writer, doc-writer, plan, general-purpose
   */
  agentId: string;
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
  /** 🆕 成员具体任务（WHAT to do，区别于 systemPrompt 的 HOW to behave） */
  task?: string;
  /** 🆕 场景类型（write_code / debug / review 等） */
  scene?: string;
  /** 🆕 场景专用 prompt（L1 层，会与 agent.systemPrompt 组合） */
  scenePrompt?: string;
  /**
   * 成员独立超时（毫秒）。
   * 若未设置，由 TeamManager 根据策略自动推算，
   * 基于 TeamConfig.defaultMemberTimeout 和策略权重。
   */
  timeout?: number;
  /** @deprecated 使用 agentId 代替 */
  role?: AgentRoleType;
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

  // 🆕 团队级超时控制
  /**
   * 团队总超时（毫秒）- 硬性时间上限。
   * 无论策略如何，团队执行时间不会超过此值。
   * 默认 600000 (10 分钟)。
   */
  teamTotalTimeout?: number;

  /**
   * 每个成员的默认超时基准（毫秒），各策略在此基础上按权重调整。
   * 如果未设置，将根据 teamTotalTimeout 和成员数量自动计算。
   */
  defaultMemberTimeout?: number;

  /**
   * 单个成员的统一超时时间（毫秒）。
   * ⚠️ 仅作为兜底值使用，优先级低于策略权重计算。
   * 不推荐设置此值，应该让策略自动分配超时。
   */
  memberTimeoutMs?: number;

  /** 是否启用共享知识库 */
  enableSharedKnowledge?: boolean;
  /** 是否记录完整消息历史 */
  recordHistory?: boolean;

  // 超时分配策略配置
  /** Hierarchical 模式下 Leader 超时倍率（基于 defaultMemberTimeout，默认 1.5） */
  hierarchicalLeaderRatio?: number;
  /** Debate 模式下首轮超时倍率（基于 defaultMemberTimeout，默认 1.0） */
  debateFirstRoundRatio?: number;
  /** Debate 模式下后续轮超时倍率（基于 defaultMemberTimeout，默认 0.6） */
  debateLaterRoundRatio?: number;
  /** 是否启用动态超时调整（默认 true） */
  enableDynamicTimeout?: boolean;
  /** 单个成员的最小超时时间（毫秒，默认 30000 即 30s） */
  minMemberTimeout?: number;
  /** Debate 论点新颖度收敛阈值（0-1，默认 0.7。连续两轮相似度超过此值则提前收敛） */
  debateConvergenceThreshold?: number;
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
 * 失败分类
 */
export type FailureCategory =
  | 'timeout'            // 超时失败
  | 'stage_disconnect'   // Pipeline/Sequential 阶段衔接失败
  | 'output_truncated'   // 输出截断导致不完整
  | 'general_failure';   // 一般性失败

/**
 * 输出产物（成员产出的文件引用）
 */
export interface OutputArtifact {
  /** 文件路径 */
  filePath: string;
  /** 来源成员 ID */
  memberId: string;
  /** 引用块 ID */
  refId: string;
}

/**
 * 任务执行结果
 */
export interface TaskExecutionResult {
  /** 任务 ID */
  taskId: string;
  /** 执行的成员 ID */
  memberId: string;
  /** 成员显示名称（用于引用） */
  memberName?: string;
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
  /** 失败分类（失败时填充） */
  failureCategory?: FailureCategory;
  /** 产出的文件路径列表 */
  outputFiles?: string[];
  /** checkpoint 保存时间戳（内部使用） */
  savedAt?: number;
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
  execute(goal: string, externalSignal?: AbortSignal): Promise<TeamExecutionResult>;

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
  maxRounds: 3,                    // P1 优化：默认 3 轮（超过 3 轮 Token 爆炸，审计数据证实）
  teamTotalTimeout: 3_600_000,     // 团队总超时 60 分钟（上层 TeamTool 会根据策略动态覆盖）
  defaultMemberTimeout: 600_000,   // P2 优化：成员基准超时 10 分钟（基于审计数据，300k→600k）
  enableSharedKnowledge: true,
  recordHistory: true,

  // 超时分配策略默认值
  hierarchicalLeaderRatio: 1.5,    // Leader 超时倍率（1.5x）
  debateFirstRoundRatio: 1.5,      // P2 优化：首轮超时倍率（2.0→1.5，Judge 预读已覆盖初始开销）
  debateLaterRoundRatio: 1.0,      // 后续轮超时倍率（1.0x，正常辩论时间）
  enableDynamicTimeout: true,       // 启用动态调整
  minMemberTimeout: 60_000,         // P2 优化：最小 60s（30s→60s，给子 agent 更充裕的初始化时间）
  debateConvergenceThreshold: 0.7, // 论点新颖度阈值
} as const;
