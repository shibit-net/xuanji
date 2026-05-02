/**
 * SessionManager — 会话管理器
 *
 * 职责：管理对话会话的生命周期、持久化、恢复、多会话切换。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { logger } from '@/core/logger';
import type { Message, TokenUsage } from '@/core/types';

const log = logger.child({ module: 'SessionManager' });

export interface SessionConfig {
  name: string;
  agentId?: string;
  workingDir?: string;
  metadata?: Record<string, any>;
}

export interface Session {
  id: string;
  name: string;
  agentId: string;
  status: 'active' | 'paused' | 'archived';
  messages: Message[];
  tokenUsage: TokenUsage;
  createdAt: number;
  updatedAt: number;
  workingDir?: string;
  metadata?: Record<string, any>;
}

export interface SessionSummary {
  id: string;
  name: string;
  status: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private activeSessionId: string | null = null;
  private storageDir: string;
  private autoSaveInterval: ReturnType<typeof setInterval> | null = null;

  constructor(userId?: string) {
    const home = os.homedir();
    this.storageDir = path.join(home, '.xuanji', 'users', userId ?? 'default', 'sessions');
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  create(name: string, config?: Partial<SessionConfig>): Session {
    const session: Session = {
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      agentId: config?.agentId ?? 'main',
      status: 'active',
      messages: [],
      tokenUsage: { input: 0, output: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workingDir: config?.workingDir,
      metadata: config?.metadata,
    };
    this.sessions.set(session.id, session);
    this.activeSessionId = session.id;
    log.info(`Session created: ${session.id}`);
    return session;
  }

  getActive(): Session | null {
    if (!this.activeSessionId) return null;
    return this.sessions.get(this.activeSessionId) ?? null;
  }

  switchTo(sessionId: string): Session | null {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.activeSessionId = sessionId;
      session.status = 'active';
      session.updatedAt = Date.now();
    }
    return session ?? null;
  }

  get(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null;
  }

  list(): SessionSummary[] {
    const result: SessionSummary[] = [];
    for (const [, s] of this.sessions) {
      result.push({
        id: s.id,
        name: s.name,
        status: s.status,
        messageCount: s.messages.length,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      });
    }
    return result.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async save(sessionId?: string): Promise<void> {
    const id = sessionId ?? this.activeSessionId;
    if (!id) return;
    const session = this.sessions.get(id);
    if (!session) return;

    const filePath = path.join(this.storageDir, `${id}.json`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
      log.debug(`Session saved: ${id}`);
    } catch (err) {
      log.error(`Failed to save session ${id}:`, err);
    }
  }

  async restore(sessionId: string): Promise<Session | null> {
    const filePath = path.join(this.storageDir, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) return null;

    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      const session = JSON.parse(data) as Session;
      this.sessions.set(session.id, session);
      log.info(`Session restored: ${sessionId}`);
      return session;
    } catch (err) {
      log.error(`Failed to restore session ${sessionId}:`, err);
      return null;
    }
  }

  async restoreAll(): Promise<SessionSummary[]> {
    if (!fs.existsSync(this.storageDir)) return [];

    const files = fs.readdirSync(this.storageDir).filter(f => f.endsWith('.json'));
    const restored: SessionSummary[] = [];

    for (const file of files) {
      const sessionId = file.replace('.json', '');
      const session = await this.restore(sessionId);
      if (session) {
        restored.push({
          id: session.id,
          name: session.name,
          status: session.status,
          messageCount: session.messages.length,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        });
      }
    }

    return restored.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  enableAutoSave(intervalMs: number = 60000): void {
    if (this.autoSaveInterval) clearInterval(this.autoSaveInterval);
    this.autoSaveInterval = setInterval(() => {
      if (this.activeSessionId) this.save();
    }, intervalMs);
  }

  disableAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  updateMessages(sessionId: string, messages: Message[]): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages = messages;
      session.updatedAt = Date.now();
    }
  }

  updateTokenUsage(sessionId: string, usage: TokenUsage): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.tokenUsage.input += usage.input;
      session.tokenUsage.output += usage.output;
      session.tokenUsage.cacheRead = (session.tokenUsage.cacheRead ?? 0) + (usage.cacheRead ?? 0);
      session.tokenUsage.cacheWrite = (session.tokenUsage.cacheWrite ?? 0) + (usage.cacheWrite ?? 0);
    }
  }

  archive(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'archived';
      session.updatedAt = Date.now();
    }
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    const filePath = path.join(this.storageDir, `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
    log.info(`Session deleted: ${sessionId}`);
  }

  export(sessionId: string, format: 'markdown' | 'json' = 'markdown'): string {
    const session = this.sessions.get(sessionId);
    if (!session) return '';

    if (format === 'json') {
      return JSON.stringify(session, null, 2);
    }

    const lines: string[] = [`# ${session.name}`, '', `Created: ${new Date(session.createdAt).toISOString()}`];
    for (const msg of session.messages) {
      lines.push('', `## ${msg.role}`);
      if (typeof msg.content === 'string') {
        lines.push(msg.content);
      } else {
        for (const block of msg.content) {
          if (block.type === 'text') lines.push(block.text ?? '');
          else if (block.type === 'tool_use') lines.push(`[Tool: ${block.name}] ${JSON.stringify(block.input)}`);
          else if (block.type === 'tool_result') lines.push(`[Result] ${block.content ?? ''}`);
        }
      }
    }
    return lines.join('\n');
  }

  get activeId(): string | null {
    return this.activeSessionId;
  }

  get count(): number {
    return this.sessions.size;
  }
}
