// ============================================================
// 项目配置系统（多层合并 + 项目初始化）
// ============================================================
//
// 配置优先级（从高到低）：
//   1. 环境变量（XUANJI_*）
//   2. 项目配置（{cwd}/.xuanji/config.json）
//   3. 默认值
//
// 首次启动时自动初始化 .xuanji/config.json 和 rules.md
//

import { join, dirname } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { AppConfig } from '@/infrastructure/core-types';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'ProjectConfig' });

// ============================================================
// 常量
// ============================================================

export const PROJECT_CONFIG_DIR_NAME = '.xuanji';
export const PROJECT_CONFIG_FILE_NAME = 'config.json';
export const CONFIG_VERSION = '1.0';

// ============================================================
// 配置文件结构
// ============================================================

export interface ConfigFile {
  version: string;
  config: Partial<AppConfig>;
}

// ============================================================
// 环境变量映射
// ============================================================

const ENV_MAPPINGS: Record<string, { path: string; transform?: (v: string) => unknown }> = {
  'XUANJI_API_KEY':       { path: 'provider.apiKey' },
  'XUANJI_MODEL':         { path: 'provider.model' },
  'XUANJI_LIGHT_MODEL':   { path: 'provider.lightModel' },
  'XUANJI_BASE_URL':      { path: 'provider.baseURL' },
  'XUANJI_MAX_TOKENS':    { path: 'provider.maxTokens', transform: (v) => parseInt(v, 10) || undefined },
  'XUANJI_TEMPERATURE':   { path: 'provider.temperature', transform: (v) => parseFloat(v) },
  'XUANJI_ADAPTER':       { path: 'provider.adapter' },
  'XUANJI_TIMEOUT':       { path: 'provider.timeout', transform: (v) => parseInt(v, 10) || undefined },

  'XUANJI_EMBEDDING_MODEL': { path: 'embedding.model' },
  'XUANJI_EMBEDDING_HF_MIRROR': { path: 'embedding.hfMirror' },
  'HF_ENDPOINT': { path: 'embedding.hfMirror' },
  'XUANJI_HF_MIRROR': { path: 'download.hfMirror' },

  'XUANJI_THEME':         { path: 'ui.theme' },
  'XUANJI_LANGUAGE':      { path: 'ui.language' },
  'XUANJI_LOCALE':        { path: 'ui.language' },

  'TAVILY_API_KEY':       { path: 'webSearch.apiKeys.tavily' },
  'BRAVE_API_KEY':        { path: 'webSearch.apiKeys.brave' },
  'SERPER_API_KEY':       { path: 'webSearch.apiKeys.serper' },
};

// ============================================================
// 工具函数
// ============================================================

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

export function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

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
// ProjectConfig 类
// ============================================================

export class ProjectConfig {
  // ── 多层配置加载 ──

  static async load(projectRoot?: string, defaults?: Record<string, unknown>): Promise<Partial<AppConfig>> {
    let merged: Record<string, unknown> = defaults ? { ...defaults } : {};

    const projectConfig = await ProjectConfig.readProjectConfig(projectRoot);
    if (Object.keys(projectConfig).length > 0) {
      merged = deepMergeConfig(merged, projectConfig as Record<string, unknown>);
    }

    const envConfig = ProjectConfig.resolveEnvConfig();
    if (Object.keys(envConfig).length > 0) {
      merged = deepMergeConfig(merged, envConfig);
    }

    return merged as Partial<AppConfig>;
  }

  // ── 项目配置路径 ──

  static getProjectConfigPath(projectRoot?: string): string {
    const base = projectRoot ?? process.cwd();
    return join(base, PROJECT_CONFIG_DIR_NAME, PROJECT_CONFIG_FILE_NAME);
  }

  static getProjectRulesPath(projectRoot?: string): string {
    const base = projectRoot ?? process.cwd();
    return join(base, PROJECT_CONFIG_DIR_NAME, 'rules.md');
  }

  // ── 项目配置读写 ──

  static async readProjectConfig(projectRoot?: string): Promise<Partial<AppConfig>> {
    const configPath = ProjectConfig.getProjectConfigPath(projectRoot);
    try {
      const text = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(text);

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

  static async writeProjectConfig(config: Partial<AppConfig>, projectRoot?: string): Promise<void> {
    const configPath = ProjectConfig.getProjectConfigPath(projectRoot);
    await mkdir(dirname(configPath), { recursive: true });

    const configFile: ConfigFile = {
      version: CONFIG_VERSION,
      config,
    };
    await writeFile(configPath, JSON.stringify(configFile, null, 2), 'utf-8');
  }

  // ── 带自动初始化的项目配置加载 ──

  static async loadProjectConfig(projectRoot?: string): Promise<Record<string, unknown>> {
    try {
      const path = ProjectConfig.getProjectConfigPath(projectRoot);
      const text = await readFile(path, 'utf-8');
      return JSON.parse(text);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await ProjectConfig.autoInitProjectConfig(projectRoot);
        try {
          const path = ProjectConfig.getProjectConfigPath(projectRoot);
          const text = await readFile(path, 'utf-8');
          return JSON.parse(text);
        } catch {
          // 初始化失败，返回空对象
        }
      }
    }
    return {};
  }

  // ── 环境变量解析 ──

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

  static getEnvMappings(): Record<string, { path: string; transform?: (v: string) => unknown }> {
    return { ...ENV_MAPPINGS };
  }

  // ── 私有方法 ──

  private static async autoInitProjectConfig(projectRoot?: string): Promise<void> {
    try {
      const { ProjectConfigWriter } = await import('./ProjectConfigWriter');
      const writer = new ProjectConfigWriter();
      const language = process.env.XUANJI_LANG === 'zh' ? 'zh' : 'en';
      await writer.initProjectConfig({
        language,
        overwrite: false,
        generateFullConfig: true,
      }, projectRoot);
    } catch {
      // 静默失败
    }
  }
}
