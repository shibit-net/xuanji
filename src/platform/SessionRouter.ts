/**
 * SessionRouter — sessionKey 管理 + 上下文隔离 + 消息历史
 *
 * 设计文档：docs/platform-integration-design.md §3
 */

import type { PlatformMessage } from './types.js';
import type { Message } from '@/session/types.js';
import { logger } from '@/core/logger';

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

// ─── SessionRouter ────────────────────────────────────────

export class SessionRouter {
  private userMapping: Record<string, string> = {};
  private chatIdStore = new Map<string, string>();
  private messageStores = new Map<string, Message[]>();

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
    this.chatIdStore.set(sessionKey, chatId);
  }

  getChatId(sessionKey: string): string | undefined {
    return this.chatIdStore.get(sessionKey);
  }

  // ── 消息历史 ────────────────────────────────────────────

  loadHistory(sessionKey: string): Message[] {
    return this.messageStores.get(sessionKey) || [];
  }

  saveMessages(sessionKey: string, messages: Message[]): void {
    const existing = this.messageStores.get(sessionKey) || [];
    existing.push(...messages);
    this.messageStores.set(sessionKey, existing);
    log.debug(`Session ${sessionKey}: ${messages.length} messages saved (total: ${existing.length})`);
  }

  // ── 会话列表 ────────────────────────────────────────────

  getActiveSessions(): string[] {
    return Array.from(this.chatIdStore.keys());
  }
}
