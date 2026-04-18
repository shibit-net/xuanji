// ============================================================
// MemoryStorage - 内存存储实现
// ============================================================
// 基于 Map 的内存存储，主要用于测试
//
// 特性:
// - 完全在内存中
// - 支持所有 IFullStorage 接口
// - 快速、无 I/O
// - 数据不持久化
// ============================================================

import type {
  IFullStorage,
  ITransaction,
  QueryFilter,
  SearchQuery,
  SearchResult
} from './interfaces';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MemoryStorage' });

/**
 * 内存事务实现
 */
class MemoryTransaction<T> implements ITransaction<T> {
  private snapshot: Map<string, T>;
  private operations: Map<string, T | null> = new Map();

  constructor(private data: Map<string, T>) {
    // 创建快照
    this.snapshot = new Map(data);
  }

  async save(id: string, data: T): Promise<void> {
    this.operations.set(id, structuredClone(data));
  }

  async load(id: string): Promise<T | null> {
    // 先查操作缓存
    if (this.operations.has(id)) {
      const data = this.operations.get(id);
      return data ? structuredClone(data) : null;
    }
    // 再查快照
    const data = this.snapshot.get(id);
    return data ? structuredClone(data) : null;
  }

  async delete(id: string): Promise<void> {
    this.operations.set(id, null);
  }

  async commit(): Promise<void> {
    // 应用所有操作
    for (const [id, data] of this.operations) {
      if (data === null) {
        this.data.delete(id);
      } else {
        this.data.set(id, data);
      }
    }
    this.operations.clear();
  }

  async rollback(): Promise<void> {
    this.operations.clear();
  }
}

/**
 * MemoryStorage - 内存存储实现
 */
export class MemoryStorage<T> implements IFullStorage<T> {
  private data = new Map<string, T>();

  // ============================================================
  // IStorage 接口实现
  // ============================================================

  async save(id: string, data: T): Promise<void> {
    this.data.set(id, structuredClone(data));
  }

  async load(id: string): Promise<T | null> {
    const data = this.data.get(id);
    return data ? structuredClone(data) : null;
  }

  async query(filter: QueryFilter): Promise<T[]> {
    let results = Array.from(this.data.values()).map(v => structuredClone(v));

    // where 过滤
    if (filter.where) {
      results = results.filter(item => this.matchFilter(item, filter.where!));
    }

    // orderBy 排序
    if (filter.orderBy && filter.orderBy.length > 0) {
      results.sort((a, b) => {
        for (const order of filter.orderBy!) {
          const aVal = (a as any)[order.field];
          const bVal = (b as any)[order.field];
          if (aVal < bVal) return order.direction === 'asc' ? -1 : 1;
          if (aVal > bVal) return order.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }

    // offset + limit
    const offset = filter.offset || 0;
    const limit = filter.limit || results.length;
    return results.slice(offset, offset + limit);
  }

  async delete(id: string): Promise<void> {
    this.data.delete(id);
  }

  async exists(id: string): Promise<boolean> {
    return this.data.has(id);
  }

  async close(): Promise<void> {
    this.data.clear();
  }

  // ============================================================
  // IBatchStorage 接口实现
  // ============================================================

  async saveBatch(items: Array<{ id: string; data: T }>): Promise<void> {
    for (const item of items) {
      this.data.set(item.id, structuredClone(item.data));
    }
  }

  async loadBatch(ids: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const id of ids) {
      const data = this.data.get(id);
      if (data) {
        result.set(id, structuredClone(data));
      }
    }
    return result;
  }

  async deleteBatch(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.data.delete(id);
    }
  }

  // ============================================================
  // ITransactionalStorage 接口实现
  // ============================================================

  async transaction<R>(fn: (tx: ITransaction<T>) => Promise<R>): Promise<R> {
    const tx = new MemoryTransaction(this.data);
    try {
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  // ============================================================
  // IQueryableStorage 接口实现
  // ============================================================

  async count(filter: QueryFilter): Promise<number> {
    const results = await this.query(filter);
    return results.length;
  }

  async search(query: SearchQuery): Promise<SearchResult<T>> {
    const allItems = Array.from(this.data.values());
    const searchTerm = query.query.toLowerCase();

    // 简单的全文搜索
    const items = allItems.filter(item => {
      const str = JSON.stringify(item).toLowerCase();
      return str.includes(searchTerm);
    });

    const limit = query.limit || 20;
    const hasMore = items.length > limit;

    return {
      items: items.slice(0, limit).map(v => structuredClone(v)),
      total: items.length,
      hasMore
    };
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /**
   * 匹配过滤条件
   */
  private matchFilter(item: any, where: Record<string, any>): boolean {
    for (const [key, value] of Object.entries(where)) {
      if (item[key] !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * 获取所有数据（测试用）
   */
  getAll(): T[] {
    return Array.from(this.data.values()).map(v => structuredClone(v));
  }

  /**
   * 清空所有数据（测试用）
   */
  clear(): void {
    this.data.clear();
  }

  /**
   * 获取数据数量
   */
  size(): number {
    return this.data.size;
  }
}
