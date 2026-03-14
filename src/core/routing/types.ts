/**
 * 任务路由系统 - 类型定义
 */

/**
 * 路由模式配置
 */
export type RoutingMode = 'auto' | 'always' | 'never';

/**
 * 执行模式
 */
export type ExecutionMode = 'direct' | 'decompose';

/**
 * 任务复杂度
 */
export type ComplexityLevel = 'simple' | 'medium' | 'complex';

/**
 * 触发类型
 */
export type TriggerType = 'command' | 'nlp';

/**
 * 路由决策原因
 */
export type RoutingReason =
  | 'config-forced'      // 配置强制
  | 'explicit-trigger'   // 显式触发
  | 'complexity'         // 复杂度分析
  | 'default';           // 默认行为

/**
 * 触发匹配结果
 */
export interface TriggerMatch {
  /** 触发类型 */
  type: TriggerType;
  /** 触发词/模式 */
  trigger: string;
}

/**
 * 任务复杂度分析结果
 */
export interface TaskComplexity {
  /** 是否包含多个步骤 */
  isMultiStep: boolean;
  /** 是否需要专业 Agent */
  requiresSpecialist: boolean;
  /** 预估步骤数（1-20） */
  estimatedSteps: number;
  /** 涉及的领域 */
  domains: string[];
  /** 是否可并行执行 */
  parallelizable: boolean;
  /** 复杂度等级 */
  complexity: ComplexityLevel;
  /** 分析理由 */
  reasoning?: string;
}

/**
 * 路由决策结果
 */
export interface RoutingDecision {
  /** 执行模式 */
  mode: ExecutionMode;
  /** 决策原因 */
  reason: RoutingReason;
  /** 触发信息（如果是显式触发） */
  trigger?: TriggerMatch;
  /** 复杂度分析（如果是基于复杂度） */
  complexity?: TaskComplexity;
  /** 时间戳 */
  timestamp?: string;
}

/**
 * 执行计划步骤
 */
export interface ExecutionStep {
  /** 步骤序号 */
  order: number;
  /** 步骤描述 */
  description: string;
  /** 负责的 Agent ID */
  agentId?: string;
  /** 预估耗时（秒） */
  estimatedDuration?: number;
  /** 是否可与其他步骤并行 */
  parallelWith?: number[];
  /** 依赖的步骤序号 */
  dependsOn?: number[];
}

/**
 * 执行计划
 */
export interface ExecutionPlan {
  /** 任务 ID */
  taskId: string;
  /** 任务描述 */
  taskDescription: string;
  /** 执行步骤 */
  steps: ExecutionStep[];
  /** 需要的 Agent 列表 */
  requiredAgents: {
    id: string;
    name: string;
    role: string;
  }[];
  /** 预估总耗时（秒） */
  estimatedTotalDuration: number;
  /** 预估 token 消耗 */
  estimatedTokens?: number;
  /** 生成时间 */
  createdAt: string;
}

/**
 * 计划确认结果
 */
export interface PlanConfirmation {
  /** 是否确认执行 */
  confirmed: boolean;
  /** 用户反馈 */
  feedback?: string;
  /** 修改的步骤（如果有） */
  modifiedSteps?: ExecutionStep[];
}

/**
 * 路由配置
 */
export interface RoutingConfig {
  /** 路由模式 */
  mode: RoutingMode;

  /** 复杂度分析配置 */
  complexity: {
    /** Multi-Agent 的最小步骤数阈值 */
    minStepsForMultiAgent: number;
    /** Token 消耗阈值 */
    tokenThreshold: number;
    /** 是否启用 LLM 分析器 */
    useAnalyzer: boolean;
    /** 分析器使用的模型 */
    analyzerModel: string;
    /** 缓存分析结果（秒） */
    cacheTTL: number;
  };

  /** 运行时升级配置 */
  runtimeUpgrade: {
    /** 是否启用运行时升级 */
    enabled: boolean;
    /** 是否自动确认（false 则需要用户确认） */
    autoConfirm: boolean;
    /** 升级阈值 */
    thresholds: {
      /** 最大步骤数 */
      maxSteps: number;
      /** 最大 token 消耗 */
      maxTokens: number;
    };
  };

  /** 执行计划配置 */
  executionPlan: {
    /** 是否启用计划预览 */
    enabled: boolean;
    /** 是否需要用户确认（complex 任务强制） */
    requireConfirmation: boolean;
    /** 计划超时时间（秒） */
    planTimeout: number;
  };
}

/**
 * 会话上下文（用于路由决策）
 */
export interface SessionContext {
  /** 会话 ID */
  sessionId: string;
  /** 历史消息数 */
  messageCount: number;
  /** 已使用的 Agent IDs */
  usedAgents: string[];
  /** 当前模式 */
  currentMode?: ExecutionMode;
  /** 用户偏好 */
  userPreferences?: {
    preferMultiAgent?: boolean;
    autoConfirmPlans?: boolean;
  };
}
