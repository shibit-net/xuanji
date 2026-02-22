// ============================================================
// M9 配置管理 — 配置加载器
// ============================================================

import type { AppConfig, IConfigLoader } from '@/core/types';
import { DEFAULT_CONFIG } from './defaults';
import { getEnvProviderConfig } from './EnvConfig';
import { loadGlobalConfig } from './GlobalConfig';
import { loadProjectConfig } from './ProjectConfig';

/**
 * 深度合并对象 (后者覆盖前者)
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }
  return result;
}

/**
 * 通过点号路径取值 (e.g. "provider.model")
 */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * 通过点号路径设值
 */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * 配置加载器
 *
 * 配置优先级 (从低到高):
 * 1. 默认配置
 * 2. 全局配置 (~/.xuanji/config.json)
 * 3. 项目配置 (.xuanji/config.json)
 * 4. 环境变量
 * 5. CLI 参数 (通过 set 方法)
 */
export class ConfigLoader implements IConfigLoader {
  private config: AppConfig = { ...DEFAULT_CONFIG };
  private loaded = false;

  async load(): Promise<AppConfig> {
    // 1. 从默认配置开始
    let config: AppConfig = { ...DEFAULT_CONFIG };

    // 2. 合并全局配置
    const globalConfig = await loadGlobalConfig();
    config = deepMerge(config as unknown as Record<string, unknown>, globalConfig) as unknown as AppConfig;

    // 3. 合并项目配置
    const projectConfig = await loadProjectConfig();
    config = deepMerge(config as unknown as Record<string, unknown>, projectConfig) as unknown as AppConfig;

    // 4. 合并环境变量
    const envConfig = getEnvProviderConfig();
    config.provider = { ...config.provider, ...envConfig };

    this.config = config;
    this.loaded = true;
    return config;
  }

  get<T = unknown>(key: string): T | undefined {
    return getByPath(this.config as unknown as Record<string, unknown>, key) as T | undefined;
  }

  set(key: string, value: unknown): void {
    setByPath(this.config as unknown as Record<string, unknown>, key, value);
  }

  validate(): boolean {
    // 基础校验：必须有模型和 API Key
    if (!this.config.provider.model) return false;
    if (!this.config.provider.apiKey) return false;
    return true;
  }

  /** 获取完整配置 (只读) */
  getConfig(): Readonly<AppConfig> {
    return this.config;
  }

  /** 是否已加载 */
  isLoaded(): boolean {
    return this.loaded;
  }
}
