/**
 * 会话生命周期管理
 *
 * 职责:
 * - 保存当前会话（消息历史 + 元数据）
 * - 恢复已保存的会话
 * - 列出 / 删除已保存会话
 */

import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { SessionStorage } from './SessionStorage.js';
import type {
  Message,
  SessionMetadata,
  SessionSnapshot,
  SessionListItem,
  SessionStorageOptions,
  ResumeOptions,
} from './types.js';

export interface SessionManagerOptions extends Partial<SessionStorageOptions> {}

export class SessionManager {
  private storage: SessionStorage;
  /** 当前活跃会话 ID（save 后设置） */
  private activeSessionId: string | null = null;

  constructor(options?: SessionManagerOptions) {
    this.storage = new SessionStorage(options);
  }

  /**
   * 保存当前会话
   *
   * @param messages - 当前完整消息历史（来自 MessageManager.getHistory()）
   * @param name - 可选会话名称（默认自动生成）
   * @returns 会话 ID
   */
  async save(messages: Message[], name?: string): Promise<string> {
    const sessionId = this.activeSessionId ?? randomUUID();
    const now = Date.now();

    const metadata: SessionMetadata = {
      id: sessionId,
      name: name || this.generateDefaultName(messages),
      createdAt: this.activeSessionId ? (await this.getExistingCreatedAt(sessionId)) ?? now : now,
      updatedAt: now,
      messageCount: messages.length,
      workingDirectory: process.cwd(),
      gitInfo: this.getGitInfo(),
    };

    const snapshot: SessionSnapshot = {
      metadata,
      messages,
      checkpoints: [], // Checkpoint 由 CheckpointManager 独立管理
    };

    await this.storage.saveSnapshot(snapshot);
    this.activeSessionId = sessionId;

    return sessionId;
  }

  /**
   * 恢复已保存的会话
   *
   * @returns 恢复的消息历史
   */
  async resume(sessionId: string, _options?: ResumeOptions): Promise<Message[]> {
    const exists = await this.storage.exists(sessionId);
    if (!exists) {
      throw new Error(`会话 ${sessionId} 不存在`);
    }

    const snapshot = await this.storage.loadSnapshot(sessionId);

    // 设置为当前活跃会话
    this.activeSessionId = sessionId;

    // 更新最后访问时间
    await this.storage.updateMetadata(sessionId, (meta) => ({
      ...meta,
      updatedAt: Date.now(),
    }));

    return snapshot.messages;
  }

  /**
   * 列出所有已保存会话
   */
  async list(): Promise<SessionListItem[]> {
    return this.storage.listSessions();
  }

  /**
   * 删除会话
   */
  async delete(sessionId: string): Promise<void> {
    await this.storage.deleteSession(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
  }

  /**
   * 获取会话元数据
   */
  async getMetadata(sessionId: string): Promise<SessionMetadata | null> {
    try {
      const snapshot = await this.storage.loadSnapshot(sessionId);
      return snapshot.metadata;
    } catch {
      return null;
    }
  }

  /**
   * 获取当前活跃会话 ID
   */
  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  /**
   * 设置活跃会话 ID（用于恢复后关联）
   */
  setActiveSessionId(id: string | null): void {
    this.activeSessionId = id;
  }

  /**
   * 获取底层存储（供 CheckpointManager 使用）
   */
  getStorage(): SessionStorage {
    return this.storage;
  }

  /**
   * 修复损坏的会话
   */
  async repair(sessionId: string): Promise<{ fixed: number; removed: number }> {
    return this.storage.repairSession(sessionId);
  }

  // ─── 私有方法 ─────────────────────────────────────────

  /**
   * 自动生成会话名称（取首条用户消息的前 30 个字符）
   */
  private generateDefaultName(messages: Message[]): string {
    const firstUserMsg = messages.find((m) => m.role === 'user');
    if (!firstUserMsg) {
      return `Session ${new Date().toLocaleString('zh-CN')}`;
    }

    const content = typeof firstUserMsg.content === 'string'
      ? firstUserMsg.content
      : '[对话]';

    return content.slice(0, 30) + (content.length > 30 ? '...' : '');
  }

  /**
   * 获取 Git 仓库信息（静默失败）
   */
  private getGitInfo(): { branch: string; commit: string } | undefined {
    try {
      const opts = { encoding: 'utf-8' as const, timeout: 5000 };
      const branch = execSync('git rev-parse --abbrev-ref HEAD', opts).trim();
      const commit = execSync('git rev-parse --short HEAD', opts).trim();
      return { branch, commit };
    } catch {
      return undefined;
    }
  }

  /**
   * 获取已存在会话的创建时间
   */
  private async getExistingCreatedAt(sessionId: string): Promise<number | null> {
    try {
      const metadata = await this.getMetadata(sessionId);
      return metadata?.createdAt ?? null;
    } catch {
      return null;
    }
  }
}
