// ============================================================
// 配置相关类型定义
// ============================================================

import type { ProviderConfig, RetryConfig } from './provider';
import type { MemoryConfig } from '@/memory/types';
import type { MCPConfig } from '@/mcp/types';

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
  /** 记忆系统配置 */
  memory?: MemoryConfig;
  /** IM 机器人配置（可选） */
  bots?: BotsConfig;
  /** MCP 配置 */
  mcp?: MCPConfig;
  /** Web Search 配置 */
  webSearch?: WebSearchConfig;
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
 * 工具配置
 */
export interface ToolsConfig {
  /** 启用的工具列表 (空 = 全部启用) */
  enabled: string[];
  /** 权限配置 */
  permissions: PermissionConfig;
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
