// ============================================================
// 配置源实现
// ============================================================

import type { IConfigSource } from './ConfigService';
import { DEFAULT_CONFIG } from '@/core/config/defaults';
import { loadGlobalConfig, saveGlobalConfig } from '@/core/config/GlobalConfig';
import { loadProjectConfig } from '@/core/config/ProjectConfig';
import { getEnvProviderConfig, getEnvUIConfig, getEnvMemoryConfig } from '@/core/config/EnvConfig';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ConfigSources' });

/**
 * 默认配置源
 */
export class DefaultConfigSource implements IConfigSource {
  name = 'default';
  priority = 0;

  async load(): Promise<Record<string, any>> {
    return DEFAULT_CONFIG as any;
  }
}

/**
 * 全局配置源
 */
export class GlobalConfigSource implements IConfigSource {
  name = 'global';
  priority = 10;

  async load(): Promise<Record<string, any>> {
    try {
      return await loadGlobalConfig();
    } catch (error) {
      log.warn('Failed to load global config:', error);
      return {};
    }
  }

  async save(config: Record<string, any>): Promise<void> {
    await saveGlobalConfig(config);
  }
}

/**
 * 项目配置源
 */
export class ProjectConfigSource implements IConfigSource {
  name = 'project';
  priority = 20;

  async load(): Promise<Record<string, any>> {
    try {
      return await loadProjectConfig();
    } catch (error) {
      log.warn('Failed to load project config:', error);
      return {};
    }
  }
}

/**
 * 环境变量配置源
 */
export class EnvConfigSource implements IConfigSource {
  name = 'env';
  priority = 30;

  async load(): Promise<Record<string, any>> {
    return {
      provider: getEnvProviderConfig(),
      ui: getEnvUIConfig(),
      memory: getEnvMemoryConfig()
    };
  }
}

/**
 * 运行时配置源
 */
export class RuntimeConfigSource implements IConfigSource {
  name = 'runtime';
  priority = 40;
  private config: Record<string, any> = {};

  async load(): Promise<Record<string, any>> {
    return this.config;
  }

  /**
   * 设置运行时配置
   */
  set(key: string, value: any): void {
    this.setByPath(this.config, key, value);
  }

  /**
   * 清空运行时配置
   */
  clear(): void {
    this.config = {};
  }

  private setByPath(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    const lastKey = keys.pop()!;
    let current = obj;

    for (const key of keys) {
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }

    current[lastKey] = value;
  }
}

/**
 * 内存配置源（用于测试）
 */
export class MemoryConfigSource implements IConfigSource {
  name = 'memory';
  priority = 50;

  constructor(private config: Record<string, any> = {}) {}

  async load(): Promise<Record<string, any>> {
    return this.config;
  }

  async save(config: Record<string, any>): Promise<void> {
    this.config = config;
  }
}
