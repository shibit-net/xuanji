/**
 * PersistentMessageQueue + AgentWorkerPool
 *
 * 设计文档：docs/platform-integration-design.md §11.1
 */

import type { Database } from 'better-sqlite3';
import { sleep } from '@/shared/utils/sleep.js';
import { logger } from '@/core/logger';
import type { PlatformMessage, AgentGateway } from './types.js';

const log = logger.child({ module: 'MessageQueue' });

// ─── 队列数据结构 ─────────────────────────────────────────

export interface QueueMessage {
  id: string;
  platform: string;
  payload: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  created_at: number;
  updated_at: number;
  retry_count: number;
  error?: string;
}

// ─── 持久化消息队列 ───────────────────────────────────────

const CREATE_QUEUE_TABLE = `
  CREATE TABLE IF NOT EXISTS platform_message_queue (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_queue_status ON platform_message_queue(status);
`;

export class PersistentMessageQueue {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
    this.db.exec(CREATE_QUEUE_TABLE);
  }

  enqueue(msg: PlatformMessage): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO platform_message_queue (id, platform, payload, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
    `).run(msg.id, msg.platform, JSON.stringify(msg), Date.now(), Date.now());
  }

  /** 原子性 dequeue：pending → processing，防止重复消费 */
  dequeue(): QueueMessage | null {
    const db = this.db;
    return db.transaction(() => {
      const row = db.prepare(`
        SELECT * FROM platform_message_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 1
      `).get() as QueueMessage | undefined;

      if (!row) return null;

      db.prepare(`
        UPDATE platform_message_queue
        SET status = 'processing', updated_at = ?
        WHERE id = ?
      `).run(Date.now(), row.id);

      return row;
    })();
  }

  markDone(id: string): void {
    this.db.prepare(`
      UPDATE platform_message_queue
      SET status = 'done', updated_at = ?
      WHERE id = ?
    `).run(Date.now(), id);
  }

  markFailed(id: string, error: string): void {
    this.db.prepare(`
      UPDATE platform_message_queue
      SET status = 'failed', updated_at = ?, error = ?, retry_count = retry_count + 1
      WHERE id = ?
    `).run(Date.now(), error, id);
  }

  /** 恢复崩溃时遗留的 processing 消息（超过 5 分钟重置为 pending） */
  recoverOrphaned(): number {
    const result = this.db.prepare(`
      UPDATE platform_message_queue
      SET status = 'pending', retry_count = retry_count + 1, updated_at = ?
      WHERE status = 'processing' AND updated_at < ?
    `).run(Date.now(), Date.now() - 300_000);

    if (result.changes > 0) {
      log.info(`Recovered ${result.changes} orphaned messages`);
    }
    return result.changes;
  }

  /** 清理已完成/失败的消息（超过 7 天） */
  cleanup(maxAgeMs: number = 7 * 24 * 3600 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db.prepare(`
      DELETE FROM platform_message_queue
      WHERE status IN ('done', 'failed') AND updated_at < ?
    `).run(cutoff);
    return result.changes;
  }
}

// ─── Worker Pool ──────────────────────────────────────────

export interface WorkerReplyHandler {
  sendReply(msg: PlatformMessage, text: string, imagePaths?: string[]): Promise<void>;
  sendError(msg: PlatformMessage, error: Error): Promise<void>;
}

export class AgentWorkerPool {
  private workers: AgentWorker[] = [];
  private readonly concurrency: number;

  constructor(
    private queue: PersistentMessageQueue,
    private agent: AgentGateway,
    private replyHandler: WorkerReplyHandler,
    concurrency = 3,
  ) {
    this.concurrency = concurrency;
  }

  async start(): Promise<void> {
    const recovered = this.queue.recoverOrphaned();
    log.info(`WorkerPool starting: ${this.concurrency} workers, ${recovered} messages recovered`);

    for (let i = 0; i < this.concurrency; i++) {
      const worker = new AgentWorker(i, this.queue, this.agent, this.replyHandler);
      this.workers.push(worker);
      worker.run();
    }
  }

  async stop(): Promise<void> {
    for (const w of this.workers) {
      w.stop();
    }
    this.workers = [];
  }
}

class AgentWorker {
  private running = true;

  constructor(
    private id: number,
    private queue: PersistentMessageQueue,
    private agent: AgentGateway,
    private replyHandler: WorkerReplyHandler,
  ) {}

  async run(): Promise<void> {
    log.info(`Worker#${this.id} started`);
    while (this.running) {
      const msg = this.queue.dequeue();
      if (!msg) {
        await sleep(1000);
        continue;
      }

      const payload: PlatformMessage = JSON.parse(msg.payload);
      log.debug(`Worker#${this.id} processing: ${msg.id} from ${msg.platform}`);

      try {
        const reply = await this.agent.process(payload);
        await this.replyHandler.sendReply(payload, reply.text, reply.imagePaths);
        this.queue.markDone(msg.id);
      } catch (err) {
        this.queue.markFailed(msg.id, (err as Error).message);
        await this.replyHandler.sendError(payload, err as Error).catch(() => {});
      }
    }
    log.info(`Worker#${this.id} stopped`);
  }

  stop(): void {
    this.running = false;
  }
}
