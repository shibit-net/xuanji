// ============================================================
// ProjectRegistry - 项目注册中心
// ============================================================
// 管理所有 xuanji 操作过的项目，记录项目路径和元数据
//
// 存储位置: .xuanji/users/{userId}/projects.json
// ============================================================

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { logger } from '@/core/logger';
import { ensureDirExists, getUserRoot } from '@/core/config/PathManager';

const log = logger.child({ module: 'ProjectRegistry' });

export interface ProjectRecord {
  path: string;
  name: string;
  hasRules: boolean;
  lastAccessed: number;
  firstAccessed: number;
}

export class ProjectRegistry {
  private registryPath: string;
  private projects: Map<string, ProjectRecord> = new Map();
  private loaded = false;

  constructor(userId: string) {
    const userRoot = getUserRoot(userId);
    this.registryPath = join(userRoot, 'projects.json');
  }

  /**
   * 加载项目注册表
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      if (existsSync(this.registryPath)) {
        const content = await readFile(this.registryPath, 'utf-8');
        const data = JSON.parse(content) as ProjectRecord[];
        this.projects = new Map(data.map(p => [p.path, p]));
        log.debug(`Loaded ${this.projects.size} projects from registry`);
      }
    } catch (err) {
      log.error('Failed to load project registry:', err);
    }

    this.loaded = true;
  }

  /**
   * 保存项目注册表
   */
  private async save(): Promise<void> {
    try {
      const dir = join(this.registryPath, '..');
      await ensureDirExists(dir);

      const data = Array.from(this.projects.values());
      await writeFile(this.registryPath, JSON.stringify(data, null, 2), 'utf-8');
      log.debug(`Saved ${data.length} projects to registry`);
    } catch (err) {
      log.error('Failed to save project registry:', err);
      throw err;
    }
  }

  /**
   * 注册一个项目（如果已存在则更新最后访问时间）
   */
  async register(projectPath: string, hasRules: boolean = false): Promise<void> {
    await this.load();

    const now = Date.now();
    const existing = this.projects.get(projectPath);

    if (existing) {
      existing.lastAccessed = now;
      existing.hasRules = hasRules;
    } else {
      const name = basename(projectPath);
      this.projects.set(projectPath, {
        path: projectPath,
        name,
        hasRules,
        lastAccessed: now,
        firstAccessed: now,
      });
      log.info(`Registered new project: ${name} (${projectPath})`);
    }

    await this.save();
  }

  /**
   * 获取所有项目列表（按最后访问时间倒序）
   */
  async list(): Promise<ProjectRecord[]> {
    await this.load();
    return Array.from(this.projects.values())
      .sort((a, b) => b.lastAccessed - a.lastAccessed);
  }

  /**
   * 获取单个项目信息
   */
  async get(projectPath: string): Promise<ProjectRecord | undefined> {
    await this.load();
    return this.projects.get(projectPath);
  }

  /**
   * 删除项目记录
   */
  async remove(projectPath: string): Promise<void> {
    await this.load();
    if (this.projects.delete(projectPath)) {
      await this.save();
      log.info(`Removed project: ${projectPath}`);
    }
  }

  /**
   * 清空所有项目记录
   */
  async clear(): Promise<void> {
    this.projects.clear();
    await this.save();
    log.info('Cleared all projects');
  }
}
