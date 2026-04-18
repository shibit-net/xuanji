// ============================================================
// MemoryStorage - 存储层实现
// ============================================================
// 纯粹的数据访问逻辑，不包含业务逻辑
//
// 职责:
// - 保存/查询/删除/更新记忆条目
// - 事务支持
// - 数据库连接管理
// ============================================================

import type { MemoryEntry, MemoryFilter, Transaction } from '@/memory/types';
import type { IMemoryStorage } from './interfaces';
import { MemoryStore } from './MemoryStore';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MemoryStorage' });

/**
 * MemoryStorage - 存储层实现
 */
export class MemoryStorage implements IMemoryStorage {
  private store: MemoryStore;

  constructor(dbPath?: string) {
    this.store = new MemoryStore(dbPath);
  }

  async init(): Promise<void> {
    await this.store.init();
  }

  async save(entry: MemoryEntry): Promise<void> {
    await this.store.save(entry);
  }

  async saveBatch(entries: MemoryEntry[]): Promise<void> {
    await this.store.transaction(async (tx) => {
      for (const entry of entries) {
        await tx.save(entry);
      }
    });
  }

  async query(filter: MemoryFilter): Promise<MemoryEntry[]> {
    return await this.store.query(filter);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async update(id: string, updates: Partial<MemoryEntry>): Promise<void> {
    await this.store.update(id, updates);
  }

  async transaction<R>(fn: (tx: Transaction) => Promise<R>): Promise<R> {
    return await this.store.transaction(fn);
  }

  async close(): Promise<void> {
    await this.store.close();
  }

  /**
   * 获取底层 MemoryStore（用于向后兼容）
   */
  getStore(): MemoryStore {
    return this.store;
  }
}
