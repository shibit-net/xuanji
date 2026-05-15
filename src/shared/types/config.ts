// ============================================================
// 配置相关类型定义
// ============================================================

import type { ProviderConfig, RetryConfig } from './provider';
import type { MCPConfig } from '@/mcp/types';
import type { PricingConfig } from './pricing';

/**
 * 路由模式配置
 */
type RoutingMode = 'auto' | 'always' | 'never';

/**
 * 路由配置
 */
interface RoutingConfig {
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
 * Planner 配置
 */
interface PlannerConfig {
  /** 最大步骤数 */
  maxSteps: number;
  /** 是否启用 LLM 分析 */
  useAnalyzer: boolean;
  /** 分析器模型 */
  analyzerModel?: string;
}

/**
 * Executor 配置
 */
interface ExecutorConfig {
  /** 最大并发子 agent 数 */
  maxConcurrentSubAgents: number;
  /** 最大嵌套深度 */
  maxNestingDepth: number;
  /** 步骤超时时间（毫秒） */
  stepTimeout: number;
}

/**
 * Skill 系统配置
 */
export interface SkillsConfig {
  /** 启用的 Skill ID 列表 */
  enabled?: string[];

  /** 禁用的 Skill ID 列表 */
  disabled?: string[];

  /** 是否加载用户自定义 Skill */
  loadCustom?: boolean;

  /** 自定义 Skill 路径（相对于项目根目录） */
  customPath?: string;

  /** Skill 参数覆盖 */
  overrides?: Record<string, Record<string, any>>;
}

/**
 * Agent 调优配置
 */
export interface AgentTuningConfig {
  /** 最大迭代次数（默认 Infinity，不限制） */
  maxIterations?: number;

  /** 上下文压缩配置 */
  compressor?: {
    /** 是否启用压缩（默认 false） */
    enabled?: boolean;
    /** 压缩阈值（token 数，默认 80000） */
    threshold?: number;
    /** 压缩使用的模型（默认使用主模型） */
    model?: string;
  };

  /** 子代理配置 */
  subAgent?: {
    /** 最大嵌套深度 (默认 3) */
    maxNestingDepth?: number;
    /** 最大并发子代理数 (默认 3) */
    maxConcurrent?: number;
    /** 子代理超时 (ms, 默认 300000) */
    timeout?: number;
    /** 最大迭代次数 (默认 30) */
    maxIterations?: number;
  };

  /** 异步 Agent 任务配置 */
  asyncAgentTasks?: {
    /** 最大并发后台任务数 (默认 3) */
    maxConcurrent?: number;
    /** 后台任务最大生存时间 (ms, 默认 14400000 = 4小时) */
    maxLifetimeMs?: number;
    /** 保留的已完成任务数上限 (默认 20) */
    maxCompletedTasks?: number;
  };
}

/**
 * 性格标签
 */
export type PersonalityTrait =
  | 'warm'       // 温暖体贴
  | 'humorous'   // 幽默风趣
  | 'serious'    // 严肃专业
  | 'gentle'     // 温柔细腻
  | 'energetic'  // 活力充沛
  | 'calm';      // 沉稳冷静

/**
 * 机器人拟人化配置
 */
export interface PersonaConfig {
  /** 机器人名字（默认 "璇玑"） */
  name?: string;
  /** 对用户的称呼（默认 "用户"） */
  userNickname?: string;
  /** 性格标签，多选 */
  personality?: PersonalityTrait[];
  /** 说话风格（默认 "balanced"） */
  talkStyle?: 'formal' | 'casual' | 'cute' | 'cool' | 'balanced';
  /** 自定义人设补充描述（自由文本） */
  customDescription?: string;
}

/**
 * 功能特性配置
 */
export interface FeaturesConfig {
  /**
   * 是否启用智能管家服务（默认 false）
   *
   * 启用时：LLM 主动分析上下文并推送通知
   * 禁用时：仅在会话启动时被动检查提醒
   */
  proactiveButler?: boolean;

  /**
   * 是否启用智能记忆 V2（默认 false）
   *
   * 启用时：LLM 主动决策哪些值得记忆，去重/合并/优先级管理
   * 禁用时：使用规则驱动的提取方式（V1）
   */
  smartMemoryV2?: boolean;

  /** 是否启用意图路由系统（默认 true） */
  intentRouter?: boolean;
}

/**
 * 日志目录模式
 */
export type LogDirMode = 'home' | 'project' | 'custom';

/**
 * 日志配置
 */
export interface LoggingConfig {
  /** 日志目录模式（默认: home，使用 .xuanji/logs） */
  mode?: LogDirMode;
  /** 自定义日志目录（仅在 mode: custom 时使用） */
  dir?: string;
  /** 是否启用文件输出（默认: true） */
  enableFile?: boolean;
  /** 是否启用控制台输出（默认: true） */
  enableConsole?: boolean;
  /** 日志级别（默认: dev=debug, prod=info） */
  level?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Embedding 配置
 */
export interface EmbeddingConfig {
  /** 模型 ID */
  model: string;
  /** 向量维度 */
  dimensions: number;
  /** 是否启用缓存 */
  cacheEnabled: boolean;
  /** 缓存最大条数 */
  cacheMaxSize: number;
  /** HuggingFace 镜像地址 */
  hfMirror?: string;
}

/**
 * 下载配置
 */
export interface DownloadConfig {
  /** HuggingFace 镜像地址（默认 https://hf-mirror.com） */
  hfMirror?: string;
  /** 代理地址（可选） */
  proxy?: string;
}

/**
 * 应用总配置
 */
export interface AppConfig {
  /** 项目根目录（可选） */
  projectRoot?: string;
  /** 默认工作目录路径（默认 ~/.xuanji/workspace/） */
  workspacePath?: string;
  /** LLM Provider 配置 */
  provider: ProviderConfig;
  /** Embedding 配置 */
  embedding?: EmbeddingConfig;
  /** 下载配置 */
  download?: DownloadConfig;
  /** UI 配置 */
  ui: UIConfig;
  /** 权限配置 */
  permission: PermissionConfig;
  /** 工具配置 */
  tools: ToolsConfig;
  /** 重试策略 */
  retry: RetryConfig;
  /** Skill 系统配置 */
  skills?: SkillsConfig;
  /** 子代理配置 */
  agent?: AgentTuningConfig;
  /** MCP 配置 */
  mcp?: MCPConfig;
  /** Web Search 配置 */
  webSearch?: WebSearchConfig;
  /** 定价配置 */
  pricing?: PricingConfig;
  /** 会话配置 */
  session?: SessionConfig;
  /** 功能特性配置 */
  features?: FeaturesConfig;
  /** 任务路由配置 */
  routing?: RoutingConfig;
  /** 任务规划器配置 */
  planner?: PlannerConfig;
  /** 任务执行器配置 */
  executor?: ExecutorConfig;
  /** 机器人拟人化配置 */
  persona?: PersonaConfig;
  /** Hooks 配置 */
  hooks?: Record<string, any>;
  /** 日志配置 */
  logging?: LoggingConfig;
  /** 是否已完成首次引导（onboarding） */
  onboardingDone?: boolean;
}

/**
 * Web Search 配置
 */
export interface WebSearchConfig {
  /** 默认搜索引擎 */
  defaultProvider?: 'tavily' | 'serper' | 'brave' | 'duckduckgo';
  /** 降级引擎列表（按优先级排序） */
  fallbackProviders?: Array<'tavily' | 'serper' | 'brave' | 'duckduckgo'>;
  /** API Keys（也可通过环境变量设置） */
  apiKeys?: {
    /** Tavily API Key（环境变量：TAVILY_API_KEY） */
    tavily?: string;
    /** Serper API Key（环境变量：SERPER_API_KEY） */
    serper?: string;
    /** Brave API Key（环境变量：BRAVE_API_KEY） */
    brave?: string;
  };
  /** 缓存 TTL（毫秒，默认 900000 = 15 分钟） */
  cacheTTL?: number;
  /** 每次搜索返回的最大结果数（默认 5） */
  maxResults?: number;
  /** 速率限制（每分钟请求数，默认 10） */
  rateLimit?: number;
}

/**
 * UI 主题
 */
export type UITheme = 'light' | 'dark' | 'auto';

/**
 * UI 语言
 */
export type UILanguage = 'zh' | 'en';

/**
 * UI 配置
 */
export interface UIConfig {
  /** 主题 */
  theme: UITheme;
  /** 语言 */
  language: UILanguage;
  /** 是否显示 Token 用量 */
  showTokenUsage: boolean;
  /** 是否显示费用 */
  showCost: boolean;
  /** 是否显示思考过程 */
  showThinking: boolean;
}

/**
 * 权限级别
 */
export type PermissionLevel = 'always' | 'ask' | 'never';

/**
 * Warn 级别处理策略
 */
export type WarnLevelStrategy = 'auto-allow' | 'ask';

/**
 * 写入确认策略
 */
export type WriteConfirmStrategy = 
  | 'ask'        // 每次写入都需要确认（保守）
  | 'auto'       // 项目内写入自动放行（激进）
  | 'plan-only'; // 依赖 LLM 通过 plan_review 主动确认（默认，平衡）

/**
 * 权限配置
 */
export interface PermissionConfig {
  /** 文件写入权限 */
  fileWrite: PermissionLevel;
  /** 文件读取权限 */
  fileRead: PermissionLevel;
  /** 命令执行权限 */
  bashExec: PermissionLevel;
  /** Warn 级别操作的处理策略（默认 'ask'，之前是 'auto-allow'） */
  warnLevel?: WarnLevelStrategy;
  /** 写入操作确认策略（默认 'plan-only'） */
  confirmWrite?: WriteConfirmStrategy;
  /** 是否在批量写入时合并确认（默认 false） */
  confirmBatchWrite?: boolean;
  /** 允许执行的命令白名单模式 */
  allowedCommands?: string[];
  /** 禁止执行的命令黑名单模式 */
  deniedCommands?: string[];
  /** 允许操作的文件路径模式 */
  allowedPaths?: string[];
  /** 禁止操作的文件路径模式 */
  deniedPaths?: string[];
  /** 是否启用决策持久化（默认 true） */
  persistDecisions?: boolean;
  /** 决策存储文件路径（默认 .xuanji/permission-decisions.json） */
  decisionsFile?: string;
}

/**
 * 工具超时配置
 */
export interface ToolTimeoutConfig {
  /** Bash 命令默认超时 (ms, 默认 120000) */
  bash?: number;
  /** WebFetch 默认超时 (ms, 默认 30000) */
  webFetch?: number;
  /** 工具执行默认超时 (ms, 默认 300000) */
  default?: number;
  /** 后台任务最大生存时间 (ms, 默认 3600000) */
  backgroundTask?: number;
  /** agent_team 工具超时 (ms, 默认 1800000 = 30分钟) */
  agent_team?: number;
  /** task 工具超时 (ms, 默认 1800000 = 30分钟) */
  task?: number;
  /** 用户交互工具超时 (ms, 默认 1800000 = 30分钟)，影响 ask_user、plan_review、enter_plan_mode、exit_plan_mode */
  interactive?: number;
}

/**
 * 并发限制配置
 */
export interface ConcurrencyConfig {
  /** 工具并行执行最大数 (默认 5) */
  maxParallel?: number;
  /** 最大后台任务数 (默认 5) */
  maxBackgroundTasks?: number;
}

/**
 * 输出限制配置
 */
export interface OutputLimitsConfig {
  /** 单个工具输出最大长度 (字符, 默认 30000) */
  toolOutput?: number;
  /** 发给 LLM 的单条 tool_result 最大长度 (字符, 默认 80000) */
  toolResult?: number;
}

/**
 * Grep 工具配置
 */
export interface GrepConfig {
  /** 最大匹配数 (默认 500) */
  maxMatches?: number;
  /** 每个文件最大匹配数 (默认 50) */
  maxMatchesPerFile?: number;
  /** 最大上下文行数 (默认 5) */
  maxContextLines?: number;
}

/**
 * Glob 工具配置
 */
export interface GlobConfig {
  /** 最大返回文件数 (默认 1000) */
  maxFiles?: number;
}

/**
 * Schema 模式
 * - compact: 极简模式（仅保留核心功能说明，生产环境）
 * - detailed: 详细模式（完整说明，调试/首次使用）
 * - auto: 自动模式（首轮详细，后续简化）
 */
export type SchemaMode = 'compact' | 'detailed' | 'auto';

/**
 * Tool Result 摘要配置
 */
export interface ToolResultSummaryConfig {
  /** 是否启用 tool result 摘要（默认 false） */
  enabled?: boolean;
  /** 超过此字符数时触发摘要（默认 10000） */
  threshold?: number;
  /** 需要摘要的工具列表（默认 ['read_file', 'bash', 'grep']） */
  tools?: string[];
}

/**
 * 工具配置
 */
export interface ToolsConfig {
  /** 启用的工具列表 (空 = 全部启用) */
  enabled: string[];
  /** 权限配置 */
  permissions: PermissionConfig;
  /** 工具 Schema 模式（默认 compact） */
  schemaMode?: SchemaMode;
  /** Tool Result 摘要配置 */
  resultSummary?: ToolResultSummaryConfig;
  /** 超时配置 */
  timeouts?: ToolTimeoutConfig;
  /** 并发限制 */
  concurrency?: ConcurrencyConfig;
  /** 输出限制 */
  outputLimits?: OutputLimitsConfig;
  /** Grep 工具配置 */
  grep?: GrepConfig;
  /** Glob 工具配置 */
  glob?: GlobConfig;
  /** Bash 工具配置 */
  bash?: BashToolConfig;
}

/**
 * Bash 工具配置
 */
export interface BashToolConfig {
  /** 沙箱配置 */
  sandbox?: {
    /** 是否启用沙箱 */
    enabled: boolean;
    /** 沙箱模式: auto=自动选择, seatbelt=macOS, bwrap=Linux, none=禁用 */
    mode: 'auto' | 'seatbelt' | 'bwrap' | 'none';
    /** 允许写入的路径列表 */
    allowedPaths: string[];
    /** 是否拒绝网络访问 */
    denyNetwork: boolean;
    /** 是否拒绝系统路径写入 */
    denySystemPaths: boolean;
  };
}

// ============================================================
// 配置加载器接口
// ============================================================

/**
 * 配置加载器接口
 */
export interface IConfigLoader {
  /** 加载并合并所有层级配置 */
  load(): Promise<AppConfig>;
  /** 获取配置值 (支持点号路径 e.g. "provider.model") */
  get<T = unknown>(key: string): T | undefined;
  /** 设置配置值 */
  set(key: string, value: unknown): void;
  /** 校验配置完整性 */
  validate(): boolean;
}

/**
 * 会话配置（连续模式）
 */
export interface SessionConfig {
  /** 归档触发条件（满足任一即触发） */
  archiveThresholds: {
    /** 消息数阈值（默认 50 条） */
    messageCount: number;
    /** Token 数阈值（默认 100k） */
    tokenCount: number;
    /** 时间阈值（分钟，默认 120） */
    timeMinutes: number;
  };

  /** 归档策略 */
  archiveStrategy: {
    /** 归档后保留最近消息数（默认 10） */
    keepRecentMessages: number;
    /** 是否生成会话摘要（默认 true） */
    generateSummary: boolean;
    /** 是否提取关键点（默认 true） */
    extractKeyPoints: boolean;
  };

  /** 启动时是否自动恢复上一次对话（默认 true） */
  autoResumeLastSession: boolean;
  /** 是否显示恢复提示（默认 true） */
  showResumeNotification: boolean;

  /** 最大保留会话数（默认 50） */
  maxSessions?: number;
}

