/**
 * 消息去重器 — 防止 WebSocket 重连/Webhook 重试导致的消息重复处理
 *
 * 特性：
 * - 内存 Map + JSON 文件持久化（重启后去重状态不丢失）
 * - TTL 过期机制（默认 24h）+ 大小上限（默认 10000 条）
 * - 惰性清理：每 N 次 isDuplicate 调用触发一次过期清理
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'MessageDeduplicator' });

export class MessageDeduplicator {
  private seen = new Map<string, number>();
  private dirty = false;
  private callCounter = 0;

  constructor(
    private filePath: string,
    private ttlMs: number = 24 * 3600 * 1000,
    private maxSize: number = 10_000,
    private autoPruneInterval: number = 200,
  ) {
    this.load();
    this.prune();
  }

  /** 检查消息是否重复。首次出现的消息返回 false 并记录；重复消息返回 true。 */
  isDuplicate(messageId: string): boolean {
    if (!messageId) return false;

    const now = Date.now();
    const seenAt = this.seen.get(messageId);

    if (seenAt !== undefined && now - seenAt < this.ttlMs) {
      return true;
    }

    this.seen.set(messageId, now);
    this.dirty = true;

    // 超出大小上限时清理
    if (this.seen.size > this.maxSize) {
      this.prune();
    }

    // 惰性定期清理过期条目
    this.callCounter++;
    if (this.callCounter >= this.autoPruneInterval) {
      this.callCounter = 0;
      this.prune();
    }

    return false;
  }

  /** 清理过期条目 */
  prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    let removed = 0;
    for (const [id, ts] of this.seen) {
      if (ts < cutoff) {
        this.seen.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      this.dirty = true;
      log.debug(`Deduplicator pruned ${removed} expired entries`);
    }
  }

  /** 持久化到磁盘 */
  save(): void {
    if (!this.dirty) return;
    try {
      const entries: Record<string, number> = {};
      for (const [id, ts] of this.seen) {
        entries[id] = ts;
      }
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.filePath, JSON.stringify({ message_ids: entries }), { encoding: 'utf-8' });
      this.dirty = false;
    } catch (err) {
      log.warn(`Deduplicator save failed: ${(err as Error).message}`);
    }
  }

  /** 从磁盘加载去重状态 */
  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;

      const raw = readFileSync(this.filePath, 'utf-8');
      const payload = JSON.parse(raw);
      const seenData = payload?.message_ids;

      if (!seenData || typeof seenData !== 'object') return;

      const now = Date.now();
      let loaded = 0;
      for (const [key, value] of Object.entries(seenData)) {
        if (typeof key !== 'string' || !key.trim()) continue;
        const ts = typeof value === 'number' ? value : 0;
        // TTL 检查：ts=0 的条目保留一周期（兼容旧格式升级）
        if (ts === 0 || this.ttlMs <= 0 || now - ts < this.ttlMs) {
          this.seen.set(key, ts || now);
          loaded++;
        }
      }

      // 大小上限裁剪
      if (this.seen.size > this.maxSize) {
        const sorted = [...this.seen.entries()].sort((a, b) => b[1] - a[1]);
        this.seen = new Map(sorted.slice(0, this.maxSize));
      }

      log.info(`Deduplicator loaded ${this.seen.size} entries (${loaded} valid) from ${this.filePath}`);
    } catch (err) {
      log.warn(`Deduplicator load failed, starting fresh: ${(err as Error).message}`);
      this.seen = new Map();
    }
  }

  clear(): void {
    this.seen.clear();
    this.dirty = true;
  }
}
