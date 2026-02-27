// ============================================================
// 子代理系统 — WorktreeManager Git Worktree 隔离
// ============================================================
//
// 为子代理提供 Git Worktree 隔离环境。
// 子代理在独立的 worktree 中工作，不影响主工作目录。
//

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'WorktreeManager' });

/**
 * Worktree 创建结果
 */
export interface WorktreeInfo {
  /** Worktree 路径 */
  path: string;
  /** 分支名 */
  branch: string;
}

/**
 * WorktreeManager — Git Worktree 管理器
 */
export class WorktreeManager {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath ?? join(process.cwd(), '.xuanji', 'worktrees');
  }

  /**
   * 检查当前目录是否为 git 仓库
   */
  isGitRepo(cwd?: string): boolean {
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: cwd ?? process.cwd(),
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 创建 Worktree
   */
  async create(name?: string): Promise<WorktreeInfo> {
    const cwd = process.cwd();

    if (!this.isGitRepo(cwd)) {
      throw new Error('当前目录不是 Git 仓库，无法创建 Worktree');
    }

    const wtName = name ?? `wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const branch = `xuanji-${wtName}`;
    const wtPath = join(this.basePath, wtName);

    // 确保基目录存在
    if (!existsSync(this.basePath)) {
      mkdirSync(this.basePath, { recursive: true });
    }

    try {
      // 创建 worktree + 新分支
      execSync(`git worktree add "${wtPath}" -b "${branch}"`, {
        cwd,
        stdio: 'pipe',
      });

      log.info(`Worktree created: ${wtPath} (branch: ${branch})`);
      return { path: wtPath, branch };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`创建 Worktree 失败: ${msg}`);
    }
  }

  /**
   * 检查 Worktree 是否有未提交的改动
   */
  async hasChanges(wtPath: string): Promise<boolean> {
    try {
      const output = execSync('git status --porcelain', {
        cwd: wtPath,
        encoding: 'utf-8',
      });
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * 移除 Worktree
   */
  async remove(wtPath: string): Promise<void> {
    try {
      // 获取分支名（用于清理）
      let branch: string | undefined;
      try {
        branch = execSync('git branch --show-current', {
          cwd: wtPath,
          encoding: 'utf-8',
        }).trim();
      } catch { /* ignore */ }

      // 移除 worktree
      execSync(`git worktree remove "${wtPath}" --force`, {
        cwd: process.cwd(),
        stdio: 'pipe',
      });

      // 删除关联分支
      if (branch && branch.startsWith('xuanji-')) {
        try {
          execSync(`git branch -D "${branch}"`, {
            cwd: process.cwd(),
            stdio: 'pipe',
          });
        } catch { /* 分支可能已被删除 */ }
      }

      log.info(`Worktree removed: ${wtPath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`移除 Worktree 失败: ${msg}, 尝试强制删除目录`);
      // 降级：直接删除目录
      if (existsSync(wtPath)) {
        rmSync(wtPath, { recursive: true, force: true });
      }
    }
  }

  /**
   * 清理所有 Worktree（无改动的自动删除）
   */
  async cleanup(): Promise<{ removed: string[]; kept: string[] }> {
    const removed: string[] = [];
    const kept: string[] = [];

    if (!existsSync(this.basePath)) return { removed, kept };

    try {
      const output = execSync('git worktree list --porcelain', {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });

      // 解析 worktree 路径
      const worktrees = output
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.replace('worktree ', ''))
        .filter((path) => path.startsWith(this.basePath));

      for (const wtPath of worktrees) {
        const hasChanges = await this.hasChanges(wtPath);
        if (hasChanges) {
          kept.push(wtPath);
        } else {
          await this.remove(wtPath);
          removed.push(wtPath);
        }
      }
    } catch (err) {
      log.warn('Worktree cleanup error:', err);
    }

    return { removed, kept };
  }
}
