// ============================================================
// 用户配置管理 - 支持多用户
// ============================================================

import { join } from 'node:path';
import { readFile, writeFile, mkdir, readdir, existsSync } from 'node:fs/promises';
import type { AppConfig } from '@/shared/types/config';
import { logger } from '@/core/logger';
// DEFAULT_CONFIG 已删除，使用模板配置

const log = logger.child({ module: 'UserConfig' });

/**
 * 获取用户配置目录
 */
function getUserConfigDir(): string {
  return join(process.cwd(), '.xuanji', 'users');
}

/**
 * 获取用户配置文件路径
 */
function getUserConfigPath(userId: string): string {
  return join(getUserConfigDir(), `${userId}.json`);
}

/**
 * 确保配置目录存在
 */
async function ensureConfigDir(): Promise<void> {
  const dir = getUserConfigDir();
  await mkdir(dir, { recursive: true });
}

/**
 * 获取所有用户列表
 */
async function listUsers(): Promise<string[]> {
  const dir = getUserConfigDir();
  if (!existsSync(dir)) {
    return [];
  }

  const files = await readdir(dir);
  return files
    .filter(file => file.endsWith('.json'))
    .map(file => file.replace('.json', ''));
}

/**
 * 用户配置类
 */
export class UserConfig {
  private static instances: Map<string, UserConfig> = new Map();
  private userId: string;
  private config: Partial<AppConfig> = {};
  private loaded = false;

  private constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * 获取单例实例
   */
  static getInstance(userId: string): UserConfig {
    if (!UserConfig.instances.has(userId)) {
      UserConfig.instances.set(userId, new UserConfig(userId));
    }
    return UserConfig.instances.get(userId)!;
  }

  /**
   * 获取用户 ID
   */
  getUserId(): string {
    return this.userId;
  }

  /**
   * 加载用户配置
   */
  async load(): Promise<Partial<AppConfig>> {
    try {
      const configPath = getUserConfigPath(this.userId);
      const text = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(text);

      if (parsed.version && parsed.config) {
        this.config = parsed.config;
      } else {
        this.config = parsed;
      }

      this.loaded = true;
      log.debug(`User config loaded: ${this.userId}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        log.debug(`User config not found: ${this.userId}, using defaults`);
      } else {
        log.warn(`Failed to load user config (${this.userId}):`, error);
      }
      this.config = {};
    }

    return this.config;
  }

  /**
   * 保存用户配置
   */
  async save(config: Partial<AppConfig>): Promise<void> {
    await ensureConfigDir();

    const configPath = getUserConfigPath(this.userId);
    const configToSave = {
      version: '1.0',
      userId: this.userId,
      updatedAt: new Date().toISOString(),
      config
    };

    await writeFile(configPath, JSON.stringify(configToSave, null, 2), 'utf-8');
    this.config = config;
    log.info(`User config saved: ${this.userId}`);
  }

  /**
   * 获取当前配置
   */
  get(): Partial<AppConfig> {
    return this.config;
  }

  /**
   * @deprecated 使用 UserConfigInitializer 代替
   *
   * 初始化新用户配置（带默认值）
   * 此方法已废弃，请使用 UserConfigInitializer.initialize()
   */
  async init(): Promise<void> {
    throw new Error('UserConfig.init() 已废弃，请使用 UserConfigInitializer.initialize()');
  }
}

export {
  getUserConfigDir,
  getUserConfigPath,
  listUsers
};
