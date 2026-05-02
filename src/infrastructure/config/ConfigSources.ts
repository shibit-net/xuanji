// ============================================================
// 配置源实现 — 使用新的 ConfigManager
// ============================================================

import type { IConfigSource } from './ConfigService';
import { getConfigManager } from '@/core/config/ConfigManager';
import { logger } from '@/core/logger';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const log = logger.child({ module: 'ConfigSources' });

/**
 * 模板配置源
 */
export class TemplateConfigSource implements IConfigSource {
  name = 'template';
  priority = 0;

  async load(): Promise<Record<string, any>> {
    try {
      const templatePath = join(process.cwd(), 'src/core/templates/config.json');
      const content = await readFile(templatePath, 'utf-8');
      const parsed = JSON.parse(content);
      return parsed.config || parsed;
    } catch {
      return {};
    }
  }
}

/**
 * 用户配置源 — 使用新的 ConfigManager
 */
export class UserConfigSource implements IConfigSource {
  name = 'user';
  priority = 10;
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  async load(): Promise<Record<string, any>> {
    try {
      const cfgMgr = getConfigManager();
      if (!cfgMgr.isLoaded()) {
        await cfgMgr.initForUser(this.userId);
      }
      return cfgMgr.getSettings() as unknown as Record<string, any>;
    } catch (error) {
      log.warn(`Failed to load user config (${this.userId}):`, error);
      return {};
    }
  }

  async save(config: Record<string, any>): Promise<void> {
    const cfgMgr = getConfigManager();
    await cfgMgr.updateSettings(config as any);
  }

  setUserId(userId: string): void {
    this.userId = userId;
  }

  getUserId(): string {
    return this.userId;
  }
}

/**
 * 运行时配置源
 */
export class RuntimeConfigSource implements IConfigSource {
  name = 'runtime';
  priority = 20;
  private config: Record<string, any> = {};

  async load(): Promise<Record<string, any>> {
    return this.config;
  }

  set(key: string, value: any): void {
    const keys = key.split('.');
    const lastKey = keys.pop()!;
    let current = this.config;
    for (const k of keys) {
      if (!(k in current)) current[k] = {};
      current = current[k];
    }
    current[lastKey] = value;
  }

  clear(): void {
    this.config = {};
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
