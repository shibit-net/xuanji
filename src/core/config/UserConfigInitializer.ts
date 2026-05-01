// ============================================================
// 用户配置初始化服务
// ============================================================
// 从 src/core/templates（源码模板，Git 追踪）复制整个用户配置
// 创建完整的用户目录结构

import { join } from 'node:path';
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { logger } from '@/core/logger';
import {
  getTemplateRoot,
  getUserRoot,
  getUserConfigPath,
  getUserAgentsDir,
  getUserPermissionsDir,
  getUserSessionsDir,
  getUserProtocolsDir,
  getUserLogsDir,
  getUserRemindersDir,
  getUserSkillsDir,
  getUserStatsDir,
  getUserMemoryDir,
} from './PathManager';

const log = logger.child({ module: 'UserConfigInitializer' });

function ensureAllUserDirectories(userId: string): Promise<void> {
  const dirs = [
    getUserRoot(userId),
    getUserAgentsDir(userId),
    getUserMemoryDir(userId),
    getUserPermissionsDir(userId),
    getUserSessionsDir(userId),
    getUserProtocolsDir(userId),
    getUserLogsDir(userId),
    getUserRemindersDir(userId),
    getUserSkillsDir(userId),
    getUserStatsDir(userId),
  ];
  return Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true }))).then(() => {});
}

async function copyDirectory(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

/** 同步目录：仅复制缺失的文件，不覆盖已有文件 */
async function syncDirectory(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });

  let entries;
  try {
    entries = await readdir(src, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await syncDirectory(srcPath, destPath);
    } else if (!existsSync(destPath)) {
      await copyFile(srcPath, destPath);
    }
  }
}

export class UserConfigInitializer {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  async initialize(): Promise<void> {
    // 始终确保所有用户目录存在（幂等）
    await ensureAllUserDirectories(this.userId);

    const configPath = getUserConfigPath(this.userId);
    if (existsSync(configPath)) {
      // config.json 已存在，仅补建缺失的默认文件（不覆盖已有文件）
      await this.syncMissingDefaults();
      return;
    }

    log.debug(`初始化用户配置: ${this.userId}`);

    await this.copyFromSourceTemplate();
    await this.updateConfigWithUserId();

    log.debug(`用户配置初始化完成: ${this.userId}`);
  }

  /**
   * 补建缺失的默认文件（幂等 — 已有文件不覆盖）
   */
  private async syncMissingDefaults(): Promise<void> {
    const templateRoot = getTemplateRoot();
    const userRoot = getUserRoot(this.userId);

    if (!existsSync(templateRoot)) return;

    // 配置根文件
    const configFiles = ['config.json', 'mcp.json', 'prompt.json'];
    for (const file of configFiles) {
      const dest = join(userRoot, file);
      if (!existsSync(dest)) {
        const src = join(templateRoot, file);
        if (existsSync(src)) {
          await copyFile(src, dest);
          log.debug(`补建配置文件: ${file}`);
        }
      }
    }

    // agents 目录
    const templateAgentsDir = join(templateRoot, 'agents');
    const userAgentsDir = getUserAgentsDir(this.userId);
    if (existsSync(templateAgentsDir)) {
      await syncDirectory(templateAgentsDir, userAgentsDir);
    }

    // protocols 目录
    const templateProtocolsDir = join(templateRoot, 'protocols');
    const userProtocolsDir = getUserProtocolsDir(this.userId);
    if (existsSync(templateProtocolsDir)) {
      await syncDirectory(templateProtocolsDir, userProtocolsDir);
    }

    // prompts 目录
    const templatePromptsDir = join(templateRoot, 'prompts');
    const userPromptsDir = join(userRoot, 'prompts');
    if (existsSync(templatePromptsDir)) {
      await syncDirectory(templatePromptsDir, userPromptsDir);
    }
  }

  private async copyFromSourceTemplate(): Promise<void> {
    const templateRoot = getTemplateRoot();
    const userRoot = getUserRoot(this.userId);

    if (!existsSync(templateRoot)) {
      log.error(`源码模板目录不存在: ${templateRoot}`);
      throw new Error('源码模板目录不存在，无法创建新用户');
    }

    const configFiles = ['config.json', 'mcp.json', 'prompt.json'];
    for (const file of configFiles) {
      const src = join(templateRoot, file);
      const dest = join(userRoot, file);
      if (existsSync(src)) {
        await copyFile(src, dest);
      }
    }

    const templateAgentsDir = join(templateRoot, 'agents');
    const userAgentsDir = getUserAgentsDir(this.userId);
    if (existsSync(templateAgentsDir)) {
      await copyDirectory(templateAgentsDir, userAgentsDir);
    }

    const templateProtocolsDir = join(templateRoot, 'protocols');
    const userProtocolsDir = getUserProtocolsDir(this.userId);
    if (existsSync(templateProtocolsDir)) {
      await copyDirectory(templateProtocolsDir, userProtocolsDir);
    }
  }

  private async updateConfigWithUserId(): Promise<void> {
    const configPath = getUserConfigPath(this.userId);

    if (!existsSync(configPath)) {
      return;
    }

    try {
      const content = await readFile(configPath, 'utf-8');
      let config = JSON.parse(content);

      config.userId = this.userId;
      config.createdAt = new Date().toISOString();
      config.updatedAt = new Date().toISOString();

      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
      log.debug(`更新配置文件 userId: ${this.userId}`);
    } catch (err) {
      log.error(`更新配置文件失败: ${configPath}`, err);
    }
  }

  async ensureConfigIntegrity(): Promise<void> {
    const configPath = getUserConfigPath(this.userId);

    if (!existsSync(configPath)) {
      await this.initialize();
    }
  }
}

export async function initializeUserConfig(userId: string): Promise<void> {
  const initializer = new UserConfigInitializer(userId);
  await initializer.initialize();
}

export async function ensureUserConfigIntegrity(userId: string): Promise<void> {
  const initializer = new UserConfigInitializer(userId);
  await initializer.ensureConfigIntegrity();
}
