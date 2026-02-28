// ============================================================
// 配置相关类型定义
// ============================================================

import type { ProviderConfig, RetryConfig } from './provider';
import type { MemoryConfig } from '@/memory/types';
import type { MCPConfig } from '@/mcp/types';
import type { PricingConfig } from './pricing';

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

  /** Agent 配置 */
  agent?: {
    /** 使用哪个 Agent Skill */
    skillId?: string;
  };
}

/**
 * Agent 调优配置
 */
export interface AgentTuningConfig {
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
}

/**
 * 应用总配置
 */
export interface AppConfig {
  /** LLM Provider 配置 */
  provider: ProviderConfig;
  /** UI 配置 */
  ui: UIConfig;
  /** 工具配置 */
  tools: ToolsConfig;
  /** 重试策略 */
  retry: RetryConfig;
  /** Skill 系统配置 */
  skills?: SkillsConfig;
  /** 子代理配置 */
  agent?: AgentTuningConfig;
  /** 记忆系统配置 */
  memory?: MemoryConfig;
  /** IM 机器人配置（可选） */
  bots?: BotsConfig;
  /** MCP 配置 */
  mcp?: MCPConfig;
  /** Web Search 配置 */
  webSearch?: WebSearchConfig;
  /** 定价配置 */
  pricing?: PricingConfig;
  /** CLI 输入历史记录（最多 50 条） */
  history?: string[];
}

/**
 * Web Search 配置
 */
export interface WebSearchConfig {
  /** 搜索 API 提供商 */
  provider: 'tavily' | 'brave';
  /** API Key（也可通过环境变量 TAVILY_API_KEY / BRAVE_API_KEY 设置） */
  apiKey?: string;
  /** 缓存 TTL（毫秒，默认 900000 = 15 分钟） */
  cacheTTL?: number;
  /** 每次搜索返回的最大结果数（默认 5） */
  maxResults?: number;
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
 * 权限配置
 */
export interface PermissionConfig {
  /** 文件写入权限 */
  fileWrite: PermissionLevel;
  /** 文件读取权限 */
  fileRead: PermissionLevel;
  /** 命令执行权限 */
  bashExec: PermissionLevel;
  /** Warn 级别操作的处理策略（默认 'auto-allow'） */
  warnLevel?: WarnLevelStrategy;
  /** 允许执行的命令白名单模式 */
  allowedCommands?: string[];
  /** 禁止执行的命令黑名单模式 */
  deniedCommands?: string[];
  /** 允许操作的文件路径模式 */
  allowedPaths?: string[];
  /** 禁止操作的文件路径模式 */
  deniedPaths?: string[];
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
 * 工具配置
 */
export interface ToolsConfig {
  /** 启用的工具列表 (空 = 全部启用) */
  enabled: string[];
  /** 权限配置 */
  permissions: PermissionConfig;
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

// ============================================================
// IM 机器人配置
// ============================================================

/**
 * 钉钉机器人配置
 */
export interface DingtalkBotConfig {
  enabled?: boolean;
  appKey: string;
  appSecret: string;
}

/**
 * 飞书机器人配置
 */
export interface FeishuBotConfig {
  enabled?: boolean;
  appId: string;
  appSecret: string;
}

/**
 * 企业微信机器人配置
 */
export interface WecomBotConfig {
  enabled?: boolean;
  corpId: string;
  secret: string;
  agentId: string;
  token: string;
  encodingAESKey: string;
  port?: number;
}

/**
 * IM 机器人总配置
 */
export interface BotsConfig {
  dingtalk?: DingtalkBotConfig;
  feishu?: FeishuBotConfig;
  wecom?: WecomBotConfig;
}
