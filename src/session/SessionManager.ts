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
import { basename } from 'path';
import { SessionStorage } from './SessionStorage.js';
import type {
  Message,
  SessionMetadata,
  SessionSnapshot,
  SessionListItem,
  SessionStorageOptions,
  ResumeOptions,
  SessionUsage,
  HistoryMessage,
  ResumedSessionContext,
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
   * @param options - 额外保存选项（usage、historyMessages）
   * @returns 会话 ID
   */
  async save(
    messages: Message[],
    name?: string,
    options?: { usage?: SessionUsage; historyMessages?: HistoryMessage[] },
  ): Promise<string> {
    const sessionId = this.activeSessionId ?? randomUUID();
    const now = Date.now();

    const metadata: SessionMetadata = {
      id: sessionId,
      name: name || this.generateDefaultName(messages),
      createdAt: this.activeSessionId ? (await this.getExistingCreatedAt(sessionId)) ?? now : now,
      updatedAt: now,
      messageCount: messages.length,
      workingDirectory: process.cwd(),
      preview: this.generatePreview(messages),
      gitInfo: this.getGitInfo(),
    };

    const snapshot: SessionSnapshot = {
      metadata,
      messages,
      checkpoints: [], // Checkpoint 由 CheckpointManager 独立管理
      usage: options?.usage,
      historyMessages: options?.historyMessages,
    };

    await this.storage.saveSnapshot(snapshot);
    this.activeSessionId = sessionId;

    return sessionId;
  }

  /**
   * 恢复已保存的会话
   *
   * @returns 恢复的会话上下文（含消息、usage、historyMessages）
   */
  async resume(sessionId: string, _options?: ResumeOptions): Promise<ResumedSessionContext> {
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

    return {
      sessionId,
      messages: snapshot.messages,
      usage: snapshot.usage ?? { input: 0, output: 0, cost: 0 },
      historyMessages: snapshot.historyMessages ?? [],
    };
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
   * 生成会话缩略内容（最后一条用户消息 + 最后一条助手回复的摘要）
   */
  private generatePreview(messages: Message[]): string {
    const parts: string[] = [];

    // 从后往前找最后一条用户消息和助手回复
    let lastUser = '';
    let lastAssistant = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!lastAssistant && msg.role === 'assistant') {
        lastAssistant = this.extractTextContent(msg);
      }
      if (!lastUser && msg.role === 'user') {
        lastUser = this.extractTextContent(msg);
      }
      if (lastUser && lastAssistant) break;
    }

    if (lastUser) {
      parts.push(`Q: ${lastUser.slice(0, 60)}${lastUser.length > 60 ? '...' : ''}`);
    }
    if (lastAssistant) {
      parts.push(`A: ${lastAssistant.slice(0, 80)}${lastAssistant.length > 80 ? '...' : ''}`);
    }

    return parts.join(' | ') || '';
  }

  /**
   * 从消息中提取纯文本内容
   */
  private extractTextContent(msg: Message): string {
    if (typeof msg.content === 'string') {
      return msg.content.replace(/\n+/g, ' ').trim();
    }
    // ContentBlock 数组：提取 text 类型的内容
    const texts = msg.content
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!);
    return texts.join(' ').replace(/\n+/g, ' ').trim();
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
