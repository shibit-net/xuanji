// ============================================================
// 配置源实现 - 简化版（只保留默认和用户配置）
// ============================================================

import type { IConfigSource } from './ConfigService';
import { DEFAULT_CONFIG } from '@/core/config/defaults';
import { UserConfig } from '@/core/config/UserConfig';
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
 * 用户配置源
 */
export class UserConfigSource implements IConfigSource {
  name = 'user';
  priority = 10;
  private userId: string;

  constructor(userId: string = 'default') {
    this.userId = userId;
  }

  async load(): Promise<Record<string, any>> {
    try {
      const userConfig = UserConfig.getInstance(this.userId);
      return await userConfig.load() as Record<string, any>;
    } catch (error) {
      log.warn(`Failed to load user config (${this.userId}):`, error);
      return {};
    }
  }

  async save(config: Record<string, any>): Promise<void> {
    const userConfig = UserConfig.getInstance(this.userId);
    await userConfig.save(config);
  }

  /**
   * 切换用户
   */
  setUserId(userId: string): void {
    this.userId = userId;
  }

  /**
   * 获取当前用户 ID
   */
  getUserId(): string {
    return this.userId;
  }
}

/**
 * 运行时配置源（用于动态修改）
 */
export class RuntimeConfigSource implements IConfigSource {
  name = 'runtime';
  priority = 20;
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
  priority = 30;

  constructor(private config: Record<string, any> = {}) {}

  async load(): Promise<Record<string, any>> {
    return this.config;
  }

  async save(config: Record<string, any>): Promise<void> {
    this.config = config;
  }
}
