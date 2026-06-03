/**
 * SessionRouter — sessionKey 管理 + 上下文隔离 + 消息历史 + 持久化
 *
 * 设计文档：docs/platform-integration-design.md §3
 *
 * 持久化：
 * - Session 列表 → ~/.xuanji/platform/sessions.json
 * - 消息历史   → ~/.xuanji/platform/messages/{sessionKey}.json（懒加载）
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
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

interface SessionEntry {
  chatId: string;
  lastActiveAt: number;
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

  registerSession(sessionKey: string, chatId: string): void {
    this.chatIdStore.set(sessionKey, {
      chatId,
      lastActiveAt: Date.now(),
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
    this.persistSessions();
  }

  removeSessionsByPlatform(platform: string): void {
    const prefix = `${platform}:`;
    for (const key of this.chatIdStore.keys()) {
      if (key.startsWith(prefix)) {
        this.chatIdStore.delete(key);
        this.messageStores.delete(key);
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
}
