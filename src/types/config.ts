// ============================================================
// 配置相关类型定义
// ============================================================

import type { ProviderConfig, RetryConfig } from './provider';

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
}

/**
 * UI 主题
 */
export type UITheme = 'light' | 'dark' | 'auto';

/**
 * UI 配置
 */
export interface UIConfig {
  /** 主题 */
  theme: UITheme;
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
 * 权限配置
 */
export interface PermissionConfig {
  /** 文件写入权限 */
  fileWrite: PermissionLevel;
  /** 文件读取权限 */
  fileRead: PermissionLevel;
  /** 命令执行权限 */
  bashExec: PermissionLevel;
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
