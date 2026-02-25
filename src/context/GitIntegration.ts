/**
 * ============================================================
 * M3 上下文引擎 — GitIntegration
 * ============================================================
 * 通过 git 命令获取仓库状态信息。
 *
 * 使用同步 API (execSync)，启动阶段性能可接受。
 * 所有方法都有 try-catch 保护，git 不可用时静默降级。
 */

import { execSync } from 'node:child_process';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'GitIntegration' });

/**
 * Git 仓库状态信息
 */
export interface GitStatus {
  /** 当前分支名 */
  branch: string;
  /** 是否有未提交的修改 */
  dirty: boolean;
  /** 未提交的文件数量 */
  dirtyCount: number;
  /** 最近的提交记录 */
  recentCommits: GitCommit[];
}

/**
 * 单条 Git 提交信息
 */
export interface GitCommit {
  /** 提交 hash (短) */
  hash: string;
  /** 提交消息 (首行) */
  message: string;
  /** 提交时间 (ISO 8601) */
  date: string;
  /** 作者名 */
  author: string;
}

export class GitIntegration {
  private rootPath: string;

  constructor(rootPath: string) {
    this.rootPath = rootPath;
  }

  /**
   * 获取完整的 Git 状态信息
   */
  getStatus(commitCount = 5): GitStatus | null {
    try {
      const branch = this.getBranch();
      if (!branch) return null;

      const { dirty, dirtyCount } = this.getDirtyStatus();
      const recentCommits = this.getRecentCommits(commitCount);

      return { branch, dirty, dirtyCount, recentCommits };
    } catch (err) {
      log.debug('Failed to get git status:', err);
      return null;
    }
  }

  /**
   * 获取当前分支名
   */
  private getBranch(): string | null {
    try {
      const result = this.exec('git rev-parse --abbrev-ref HEAD');
      return result.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * 获取 dirty 状态
   */
  private getDirtyStatus(): { dirty: boolean; dirtyCount: number } {
    try {
      const result = this.exec('git status --porcelain');
      const lines = result.split('\n').filter((l) => l.trim());
      return { dirty: lines.length > 0, dirtyCount: lines.length };
    } catch {
      return { dirty: false, dirtyCount: 0 };
    }
  }

  /**
   * 获取最近 N 条提交
   */
  private getRecentCommits(count: number): GitCommit[] {
    try {
      // 使用 %x00 作为字段分隔符，%x01 作为记录分隔符
      const format = '%h%x00%s%x00%aI%x00%an%x01';
      const result = this.exec(`git log -${count} --format="${format}"`);
      if (!result.trim()) return [];

      return result
        .split('\x01')
        .filter((r) => r.trim())
        .map((record) => {
          const [hash, message, date, author] = record.trim().split('\x00');
          return { hash, message, date, author };
        });
    } catch {
      return [];
    }
  }

  /**
   * 执行 git 命令
   */
  private exec(cmd: string): string {
    return execSync(cmd, {
      cwd: this.rootPath,
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
}
