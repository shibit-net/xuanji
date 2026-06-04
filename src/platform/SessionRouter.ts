/**
 * SessionRouter — sessionKey 管理 + 上下文隔离 + 消息历史 + 持久化
 *
 * 设计文档：docs/platform-integration-design.md §3
 *
 * 持久化：
 * - Session 列表 → ~/.xuanji/platform/sessions.json
 * - 消息历史   → ~/.xuanji/platform/messages/{sessionKey}.json（懒加载）
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import type { PlatformMessage } from './types.js';
import type { Message } from '@/session/types.js';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'SessionRouter' });

// ─── SessionKey 构建 ──────────────────────────────────────

export function buildSessionKey(msg: Pick<PlatformMessage, 'platform' | 'chatType' | 'chatId'>): string {
  return `${msg.platform}:${msg.chatType}:${msg.chatId}`;
}

export function parseSessionKey(sessionKey: string): {
  platform: string;
  chatType: 'private' | 'group';
  chatId: string;
} {
  const [platform, chatType, ...rest] = sessionKey.split(':');
  return {
    platform,
    chatType: chatType as 'private' | 'group',
    chatId: rest.join(':'),
  };
}

// ─── 持久化类型 ────────────────────────────────────────────

export interface MessageMeta {
  senderName?: string;
  senderId?: string;
  mentions?: string[];
  replyTo?: string;
  replyToMsg?: string;
}

interface SessionEntry {
  chatId: string;
  lastActiveAt: number;
  /** 群聊时从 group_members 或平台 API 获取的显示名 */
  displayName?: string;
}

interface SessionsFile {
  sessions: Record<string, SessionEntry>;
}

// ─── SessionRouter ────────────────────────────────────────

export class SessionRouter {
  private userMapping: Record<string, string> = {};
  private chatIdStore = new Map<string, SessionEntry>();
  private messageStores = new Map<string, Message[]>();
  private dataDir: string | null = null;
  private dirty = false;

  constructor(dataDir?: string) {
    if (dataDir) {
      this.dataDir = dataDir;
      this.loadPersistedState();
    }
  }

  // ── 用户映射 ─────────────────────────────────────────────

  setUserMapping(mapping: Record<string, string>): void {
    this.userMapping = mapping;
  }

  resolveUserId(platform: string, platformUserId: string): string {
    const key = `${platform}:${platformUserId}`;
    return this.userMapping[key] || key;
  }

  // ── ChatId 管理 ──────────────────────────────────────────

  registerSession(sessionKey: string, chatId: string, displayName?: string): void {
    const existing = this.chatIdStore.get(sessionKey);
    // 保留已有的 displayName，新传入的 undefined 不覆盖
    const name = displayName ?? existing?.displayName;
    this.chatIdStore.set(sessionKey, {
      chatId,
      lastActiveAt: Date.now(),
      displayName: name,
    });
    this.persistSessions();
  }

  getChatId(sessionKey: string): string | undefined {
    return this.chatIdStore.get(sessionKey)?.chatId;
  }

  getSessionEntry(sessionKey: string): SessionEntry | undefined {
    return this.chatIdStore.get(sessionKey);
  }

  // ── 消息历史 ────────────────────────────────────────────

  loadHistory(sessionKey: string): Message[] {
    // 先检查内存
    const cached = this.messageStores.get(sessionKey);
    if (cached && cached.length > 0) return cached;

    // 懒加载磁盘消息
    const persisted = this.loadPersistedMessages(sessionKey);
    if (persisted.length > 0) {
      this.messageStores.set(sessionKey, persisted);
    }
    return persisted;
  }

  /** 获取最近几条消息（用于群聊上下文），返回携带发送者信息 */
  loadRecentHistory(sessionKey: string, count: number): Array<Message & { meta?: MessageMeta }> {
    const all = this.loadHistory(sessionKey);
    if (all.length === 0) return [];
    // 从磁盘消息中解析 meta（存储时已内嵌到 content 中）
    return all.slice(-count).map(msg => {
      let meta: MessageMeta | undefined;
      if (typeof msg.content === 'string' && msg.content.startsWith('[meta]')) {
        try {
          const metaEnd = msg.content.indexOf('\n');
          meta = JSON.parse(msg.content.slice(6, metaEnd));
          return { ...msg, content: msg.content.slice(metaEnd + 1), meta };
        } catch {}
      }
      return msg;
    });
  }

  /** 带发送者/提及/回复元信息的消息存储 */
  saveMessageWithMeta(
    sessionKey: string,
    role: 'user' | 'assistant',
    content: string,
    meta?: MessageMeta,
  ): void {
    const msg: Message = {
      role,
      content: meta ? `[meta]${JSON.stringify(meta)}\n${content}` : content,
      timestamp: Date.now(),
    };
    const existing = this.messageStores.get(sessionKey) || [];
    existing.push(msg);
    this.messageStores.set(sessionKey, existing);
    this.persistMessages(sessionKey);
  }

  /** 根据 messageId 查找历史消息的发送者和内容 */
  getRepliedMessage(sessionKey: string, messageId: string): { senderName: string; content: string } | null {
    // 群聊场景下，messageId 通常存储为 meta.replyToMsg
    // 遍历历史找到 content 中保存的对应消息
    const messages = this.loadRecentHistory(sessionKey, 50);
    for (const msg of messages) {
      const meta = (msg as any).meta as MessageMeta | undefined;
      // 匹配 meta 中的 replyToMsg 或者直接匹配 messageId
      if (meta?.replyToMsg === messageId) {
        const sender = meta?.senderName || '未知用户';
        const text = typeof msg.content === 'string' ? msg.content : '';
        return { senderName: sender, content: text.slice(0, 200) };
      }
    }
    return null;
  }

  saveMessages(sessionKey: string, messages: Message[]): void {
    const existing = this.messageStores.get(sessionKey) || [];
    existing.push(...messages);
    this.messageStores.set(sessionKey, existing);
    this.persistMessages(sessionKey);
    log.debug(`Session ${sessionKey}: ${messages.length} messages saved (total: ${existing.length})`);
  }

  // ── 会话列表 ────────────────────────────────────────────

  getActiveSessions(): string[] {
    return Array.from(this.chatIdStore.keys());
  }

  getActiveSessionEntries(): Array<{ sessionKey: string } & SessionEntry> {
    return Array.from(this.chatIdStore.entries()).map(([sessionKey, entry]) => ({
      sessionKey,
      ...entry,
    }));
  }

  removeSession(sessionKey: string): void {
    this.chatIdStore.delete(sessionKey);
    this.messageStores.delete(sessionKey);
    this.deleteMessageFile(sessionKey);
    this.persistSessions();
  }

  removeSessionsByPlatform(platform: string): void {
    const prefix = `${platform}:`;
    for (const key of this.chatIdStore.keys()) {
      if (key.startsWith(prefix)) {
        this.chatIdStore.delete(key);
        this.messageStores.delete(key);
        this.deleteMessageFile(key);
      }
    }
    this.persistSessions();
  }

  // ── 持久化 ──────────────────────────────────────────────

  private ensureDir(): void {
    if (!this.dataDir) return;
    try {
      if (!existsSync(this.dataDir)) {
        mkdirSync(this.dataDir, { recursive: true });
      }
    } catch {}
  }

  private get sessionsPath(): string {
    return `${this.dataDir}/sessions.json`;
  }

  private get messagesDir(): string {
    return `${this.dataDir}/messages`;
  }

  private sanitizeFilename(sessionKey: string): string {
    return sessionKey.replace(/[^a-zA-Z0-9:_-]/g, '_');
  }

  private loadPersistedState(): void {
    if (!this.dataDir) return;

    try {
      // 加载 session 列表
      const sessionsPath = this.sessionsPath;
      if (existsSync(sessionsPath)) {
        const raw = readFileSync(sessionsPath, 'utf-8');
        const data: SessionsFile = JSON.parse(raw);
        for (const [sessionKey, entry] of Object.entries(data.sessions)) {
          this.chatIdStore.set(sessionKey, entry);
        }
        log.info(`Loaded ${this.chatIdStore.size} persisted sessions`);
      }
    } catch (err) {
      log.warn(`Failed to load persisted sessions: ${(err as Error).message}`);
    }
  }

  private persistSessions(): void {
    if (!this.dataDir) return;

    try {
      this.ensureDir();
      const data: SessionsFile = {
        sessions: Object.fromEntries(this.chatIdStore),
      };
      writeFileSync(this.sessionsPath, JSON.stringify(data, null, 2));
    } catch (err) {
      log.warn(`Failed to persist sessions: ${(err as Error).message}`);
    }
  }

  private loadPersistedMessages(sessionKey: string): Message[] {
    if (!this.dataDir) return [];

    try {
      const msgDir = this.messagesDir;
      if (!existsSync(msgDir)) return [];

      const filePath = `${msgDir}/${this.sanitizeFilename(sessionKey)}.json`;
      if (!existsSync(filePath)) return [];

      const raw = readFileSync(filePath, 'utf-8');
      const messages: Message[] = JSON.parse(raw);
      log.info(`Loaded ${messages.length} messages for session ${sessionKey}`);
      return messages;
    } catch (err) {
      log.warn(`Failed to load messages for ${sessionKey}: ${(err as Error).message}`);
      return [];
    }
  }

  private persistMessages(sessionKey: string): void {
    if (!this.dataDir) return;

    try {
      const msgDir = this.messagesDir;
      if (!existsSync(msgDir)) {
        mkdirSync(msgDir, { recursive: true });
      }

      const messages = this.messageStores.get(sessionKey);
      if (!messages || messages.length === 0) return;

      const filePath = `${msgDir}/${this.sanitizeFilename(sessionKey)}.json`;
      // 只保留最近 200 条消息，避免文件过大
      const trimmed = messages.length > 200 ? messages.slice(-200) : messages;
      writeFileSync(filePath, JSON.stringify(trimmed, null, 2));
    } catch (err) {
      log.warn(`Failed to persist messages for ${sessionKey}: ${(err as Error).message}`);
    }
  }

  private deleteMessageFile(sessionKey: string): void {
    if (!this.dataDir) return;
    try {
      const filePath = `${this.messagesDir}/${this.sanitizeFilename(sessionKey)}.json`;
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        log.info(`Deleted message file: ${sessionKey}`);
      }
    } catch (err) {
      log.warn(`Failed to delete message file for ${sessionKey}: ${(err as Error).message}`);
    }
  }
}
