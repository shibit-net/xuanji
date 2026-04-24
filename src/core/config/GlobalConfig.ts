// ============================================================
// M9 配置管理 — 全局配置系统（多层合并）
// ============================================================
//
// 配置优先级（从高到低）：
//   1. 环境变量（XUANJI_*）
//   2. 项目配置（.xuanji/config.json）
//   3. 全局配置（~/.xuanji/config.json）
//   4. 默认值
//

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { AppConfig } from '@/core/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'GlobalConfig' });

// ============================================================
// 常量
// ============================================================

/** 全局配置目录 */
const GLOBAL_CONFIG_DIR = join(homedir(), '.xuanji');

/** 全局配置文件路径 */
const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, 'config.json');

/** 项目配置目录名 */
const PROJECT_CONFIG_DIR_NAME = '.xuanji';

/** 配置文件版本 */
const CONFIG_VERSION = '1.0';

// ============================================================
// 配置文件结构
// ============================================================

/**
 * 配置文件格式（支持版本管理）
 */
export interface ConfigFile {
  /** 配置文件版本 */
  version: string;
  /** 配置内容 */
  config: Partial<AppConfig>;
}

// ============================================================
// 环境变量映射
// ============================================================

/**
 * 环境变量 → 配置路径映射
 *
 * 键: 环境变量名
 * 值: 配置对象中的点号路径
 */
const ENV_MAPPINGS: Record<string, { path: string; transform?: (v: string) => unknown }> = {
  // Provider 相关（仅使用 XUANJI_* 前缀，避免与其他工具冲突）
  'XUANJI_API_KEY':       { path: 'provider.apiKey' },
  'XUANJI_MODEL':         { path: 'provider.model' },
  'XUANJI_LIGHT_MODEL':   { path: 'provider.lightModel' },
  'XUANJI_BASE_URL':      { path: 'provider.baseURL' },
  'XUANJI_MAX_TOKENS':    { path: 'provider.maxTokens', transform: (v) => parseInt(v, 10) || undefined },
  'XUANJI_TEMPERATURE':   { path: 'provider.temperature', transform: (v) => parseFloat(v) },
  'XUANJI_ADAPTER':       { path: 'provider.adapter' },
  'XUANJI_TIMEOUT':       { path: 'provider.timeout', transform: (v) => parseInt(v, 10) || undefined },

  // Embedding 配置（独立命名空间）
  'XUANJI_EMBEDDING_MODEL': { path: 'embedding.model' },
  'XUANJI_EMBEDDING_DIMENSIONS': { path: 'embedding.dimensions', transform: (v) => parseInt(v, 10) || undefined },
  'XUANJI_EMBEDDING_CACHE_ENABLED': { path: 'embedding.cacheEnabled', transform: (v) => v === 'true' || v === '1' },
  'XUANJI_EMBEDDING_CACHE_MAX_SIZE': { path: 'embedding.cacheMaxSize', transform: (v) => parseInt(v, 10) || undefined },
  'XUANJI_EMBEDDING_HF_MIRROR': { path: 'embedding.hfMirror' },
  'HF_ENDPOINT': { path: 'embedding.hfMirror' }, // 向后兼容

  // UI 相关
  'XUANJI_THEME':         { path: 'ui.theme' },
  'XUANJI_LANGUAGE':      { path: 'ui.language' },
  'XUANJI_LOCALE':        { path: 'ui.language' },

  // Memory 相关
  'XUANJI_MEMORY_ENABLED': { path: 'memory.enabled', transform: (v) => v === 'true' || v === '1' },

  // Web Search 相关（保留第三方服务的标准环境变量名）
  'TAVILY_API_KEY':       { path: 'webSearch.apiKeys.tavily' },
  'BRAVE_API_KEY':        { path: 'webSearch.apiKeys.brave' },
  'SERPER_API_KEY':       { path: 'webSearch.apiKeys.serper' },
};

// ============================================================
// 工具函数
// ============================================================

/**
 * 深度合并配置对象
 *
 * - 对象属性递归合并
 * - 数组：覆盖（不合并）
 * - 原始值：后者覆盖前者
 * - undefined 值不覆盖已有值
 */
export function deepMergeConfig(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];

    if (srcVal === undefined) continue;

    if (
      srcVal !== null && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal !== null && tgtVal !== undefined && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
    ) {
      result[key] = deepMergeConfig(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

/**
 * 通过点号路径取值 (e.g. "provider.model")
 */
export function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * 通过点号路径设值 (e.g. "provider.model", "claude-sonnet-4-20250514")
 */
export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

// ============================================================
// 兼容旧 API（保留原有导出）
// ============================================================

/**
 * 加载全局配置（兼容旧接口）
 */
export async function loadGlobalConfig(): Promise<Record<string, unknown>> {
  return GlobalConfig.readGlobalConfig() as Promise<Record<string, unknown>>;
}

/**
 * 保存全局配置（兼容旧接口）
 */
export async function saveGlobalConfig(config: Record<string, unknown>): Promise<void> {
  await GlobalConfig.writeGlobalConfig(config as Partial<AppConfig>);
}

// ============================================================
// GlobalConfig 类
// ============================================================

/**
 * 全局配置管理器
 *
 * 提供多层配置的加载、合并、读写能力。
 * 所有方法均为静态方法，无需实例化。
 */
export class GlobalConfig {
  /**
   * 加载并合并所有层次的配置
   *
   * 合并顺序（后者覆盖前者）：
   * 1. 默认值（由调用方传入 defaults）
   * 2. 全局配置（~/.xuanji/config.json）
   * 3. 项目配置（.xuanji/config.json）
   * 4. 环境变量
   *
   * @param projectRoot 项目根目录（默认 process.cwd()）
   * @param defaults 默认配置对象
   * @returns 合并后的完整配置
   */
  static async load(projectRoot?: string, defaults?: Record<string, unknown>): Promise<Partial<AppConfig>> {
    // 层 4：从默认值开始
    let merged: Record<string, unknown> = defaults ? { ...defaults } : {};

    // 层 3：全局配置
    const globalConfig = await GlobalConfig.readGlobalConfig();
    if (Object.keys(globalConfig).length > 0) {
      merged = deepMergeConfig(merged, globalConfig as Record<string, unknown>);
    }

    // 层 2：项目配置
    const projectConfig = await GlobalConfig.readProjectConfig(projectRoot);
    if (Object.keys(projectConfig).length > 0) {
      merged = deepMergeConfig(merged, projectConfig as Record<string, unknown>);
    }

    // 层 1：环境变量（最高优先级）
    const envConfig = GlobalConfig.resolveEnvConfig();
    if (Object.keys(envConfig).length > 0) {
      merged = deepMergeConfig(merged, envConfig);
    }

    return merged as Partial<AppConfig>;
  }

  /**
   * 获取全局配置文件路径
   */
  static getGlobalConfigPath(): string {
    return GLOBAL_CONFIG_PATH;
  }

  /**
   * 获取项目配置文件路径
   */
  static getProjectConfigPath(projectRoot?: string): string {
    const base = projectRoot ?? process.cwd();
    return join(base, PROJECT_CONFIG_DIR_NAME, 'config.json');
  }

  /**
   * 读取全局配置（仅全局层，不合并）
   *
   * 文件不存在时返回空对象 {}
   * JSON 解析失败时打 warn 日志，返回空对象
   */
  static async readGlobalConfig(): Promise<Partial<AppConfig>> {
    try {
      const configPath = GlobalConfig.getGlobalConfigPath();
      const text = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(text);

      // 支持带版本号的格式
      if (parsed.version && parsed.config) {
        return (parsed as ConfigFile).config;
      }
      // 兼容不带版本号的纯配置格式
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn(`全局配置文件解析失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {};
  }

  /**
   * 写入全局配置
   *
   * 自动确保 ~/.xuanji/ 目录存在
   * 使用带版本号的 ConfigFile 格式
   */
  static async writeGlobalConfig(config: Partial<AppConfig>): Promise<void> {
    await GlobalConfig.ensureGlobalDir();
    const configFile: ConfigFile = {
      version: CONFIG_VERSION,
      config,
    };
    const configPath = GlobalConfig.getGlobalConfigPath();
    await writeFile(configPath, JSON.stringify(configFile, null, 2), 'utf-8');
  }

  /**
   * 读取项目配置（仅项目层，不合并）
   *
   * 文件不存在时返回空对象 {}
   */
  static async readProjectConfig(projectRoot?: string): Promise<Partial<AppConfig>> {
    const configPath = GlobalConfig.getProjectConfigPath(projectRoot);
    try {
      const text = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(text);

      // 支持带版本号的格式
      if (parsed.version && parsed.config) {
        return (parsed as ConfigFile).config;
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn(`项目配置文件解析失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return {};
  }

  /**
   * 写入项目配置
   *
   * 自动确保项目 .xuanji/ 目录存在
   */
  static async writeProjectConfig(config: Partial<AppConfig>, projectRoot?: string): Promise<void> {
    const base = projectRoot ?? process.cwd();
    const dir = join(base, PROJECT_CONFIG_DIR_NAME);
    await mkdir(dir, { recursive: true });

    const configFile: ConfigFile = {
      version: CONFIG_VERSION,
      config,
    };
    const configPath = GlobalConfig.getProjectConfigPath(projectRoot);
    await writeFile(configPath, JSON.stringify(configFile, null, 2), 'utf-8');
  }

  /**
   * 确保全局配置目录存在
   */
  static async ensureGlobalDir(): Promise<void> {
    const configPath = GlobalConfig.getGlobalConfigPath();
    const dir = configPath.substring(0, configPath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
  }

  /**
   * 从环境变量构建配置覆盖对象
   *
   * 遍历 ENV_MAPPINGS，将已设置的环境变量转换为配置路径
   */
  static resolveEnvConfig(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [envKey, { path, transform }] of Object.entries(ENV_MAPPINGS)) {
      const value = process.env[envKey];
      if (value !== undefined && value !== '') {
        const transformed = transform ? transform(value) : value;
        if (transformed !== undefined) {
          setByPath(result, path, transformed);
        }
      }
    }

    return result;
  }

  /**
   * 获取环境变量映射表（用于测试和文档）
   */
  static getEnvMappings(): Record<string, { path: string; transform?: (v: string) => unknown }> {
    return { ...ENV_MAPPINGS };
  }
}

export { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH, CONFIG_VERSION };
