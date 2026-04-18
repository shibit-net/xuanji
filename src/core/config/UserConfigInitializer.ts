// ============================================================
// 用户配置初始化服务
// ============================================================
// 负责在用户登录时初始化用户配置目录和文件
//
// 职责:
// 1. 从 default 模板复制整个用户目录
// 2. 更新配置文件中的 userId
// 3. 确保用户配置的完整性
// ============================================================

import { join } from 'node:path';
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'UserConfigInitializer' });

/**
 * 获取用户配置根目录
 */
export function getUserConfigRoot(userId: string): string {
  return join(process.cwd(), '.xuanji', 'users', userId);
}

/**
 * 获取用户配置文件路径
 */
export function getUserConfigPath(userId: string): string {
  return join(getUserConfigRoot(userId), 'config.json');
}

/**
 * 获取用户 agents 目录
 */
export function getUserAgentsDir(userId: string): string {
  return join(getUserConfigRoot(userId), 'agents');
}

/**
 * 获取用户 agent-overrides 目录
 */
export function getUserAgentOverridesDir(userId: string): string {
  return join(getUserConfigRoot(userId), 'agent-overrides');
}

/**
 * 获取用户模板目录（default 作为模板）
 */
export function getUserTemplateDir(): string {
  return join(process.cwd(), '.xuanji', 'users', 'default');
}

/**
 * 获取内置 agent 模板目录
 * @deprecated 使用 getUserTemplateDir 替代
 */
export function getBuiltinAgentsDir(): string {
  // 现在从 default 用户目录加载
  return join(getUserTemplateDir(), 'agents');
}

/**
 * 用户配置初始化器
 */
export class UserConfigInitializer {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * 初始化用户配置
   * 如果用户配置已存在，则跳过；否则从 default 模板复制整个目录
   */
  async initialize(): Promise<void> {
    const configPath = getUserConfigPath(this.userId);

    // 如果是 default 用户，跳过初始化（default 是模板）
    if (this.userId === 'default') {
      log.debug('跳过 default 模板用户的初始化');
      return;
    }

    if (existsSync(configPath)) {
      log.debug(`用户配置已存在: ${this.userId}`);
      return;
    }

    log.info(`初始化用户配置: ${this.userId}`);

    // 从 default 模板复制整个目录
    await this.copyFromTemplate();

    log.info(`用户配置初始化完成: ${this.userId}`);
  }

  /**
   * 从 default 模板复制整个用户目录
   */
  private async copyFromTemplate(): Promise<void> {
    const templateDir = getUserTemplateDir();
    const userDir = getUserConfigRoot(this.userId);

    if (!existsSync(templateDir)) {
      log.error(`模板目录不存在: ${templateDir}`);
      throw new Error('用户模板目录不存在，无法创建新用户');
    }

    log.info(`从模板复制用户配置: ${templateDir} -> ${userDir}`);

    // 递归复制整个目录
    await this.copyDirectory(templateDir, userDir);

    // 更新配置文件中的 userId
    await this.updateUserIdInConfig(userDir);
  }

  /**
   * 递归复制目录
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await mkdir(dest, { recursive: true });

    const entries = await readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await copyFile(srcPath, destPath);
        log.debug(`复制文件: ${entry.name}`);
      }
    }
  }

  /**
   * 更新配置文件中的 userId 和时间戳
   */
  private async updateUserIdInConfig(userDir: string): Promise<void> {
    const configPath = join(userDir, 'config.json');

    if (!existsSync(configPath)) {
      return;
    }

    try {
      const content = await readFile(configPath, 'utf-8');
      const config = JSON.parse(content);

      // 更新 userId 和时间戳
      config.userId = this.userId;
      config.isTemplate = false;
      config.createdAt = new Date().toISOString();
      config.updatedAt = new Date().toISOString();

      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      log.debug(`更新配置文件 userId: ${this.userId}`);
    } catch (error) {
      log.error(`更新配置文件失败: ${configPath}`, error);
    }
  }

  /**
   * 确保用户配置完整性
   * 检查并补充缺失的配置项
   */
  async ensureConfigIntegrity(): Promise<void> {
    const configPath = getUserConfigPath(this.userId);

    if (!existsSync(configPath)) {
      await this.initialize();
      return;
    }

    // 配置文件存在，验证完整性
    // 未来可以在这里添加配置升级逻辑
  }
}

/**
 * 初始化用户配置（便捷函数）
 */
export async function initializeUserConfig(userId: string): Promise<void> {
  const initializer = new UserConfigInitializer(userId);
  await initializer.initialize();
}

/**
 * 确保用户配置完整性（便捷函数）
 */
export async function ensureUserConfigIntegrity(userId: string): Promise<void> {
  const initializer = new UserConfigInitializer(userId);
  await initializer.ensureConfigIntegrity();
}
