// ============================================================
// SQLiteStorage - SQLite 存储实现
// ============================================================
// 基于 SQLite 的通用存储实现
//
// 特性:
// - 支持所有 IFullStorage 接口
// - 自动创建表结构
// - 事务支持
// - 批量操作优化
// ============================================================

import type {
  IFullStorage,
  ITransaction,
  QueryFilter,
  SearchQuery,
  SearchResult,
  ISerializer
} from './interfaces';
import { JSONSerializer } from './interfaces';
import { Database } from 'better-sqlite3';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SQLiteStorage' });

/**
 * SQLite 事务实现
 */
class SQLiteTransaction<T> implements ITransaction<T> {
  private operations: Array<() => void> = [];

  constructor(
    private db: Database,
    private tableName: string,
    private serializer: ISerializer<T>
  ) {}

  async save(id: string, data: T): Promise<void> {
    const serialized = this.serializer.serialize(data);
    this.operations.push(() => {
      this.db.prepare(
        `INSERT OR REPLACE INTO ${this.tableName} (id, data, updated_at) VALUES (?, ?, ?)`
      ).run(id, serialized, Date.now());
    });
  }

  async load(id: string): Promise<T | null> {
    const row = this.db.prepare(
      `SELECT data FROM ${this.tableName} WHERE id = ?`
    ).get(id) as { data: string } | undefined;

    return row ? this.serializer.deserialize(row.data) : null;
  }

  async delete(id: string): Promise<void> {
    this.operations.push(() => {
      this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id);
    });
  }

  async commit(): Promise<void> {
    for (const op of this.operations) {
      op();
    }
    this.operations = [];
  }

  async rollback(): Promise<void> {
    this.operations = [];
  }
}

/**
 * SQLiteStorage - SQLite 存储实现
 */
export class SQLiteStorage<T> implements IFullStorage<T> {
  private db: Database;
  private serializer: ISerializer<T>;

  private closed = false;

  constructor(
    dbPath: string,
    private tableName: string,
    serializer?: ISerializer<T>
  ) {
    const BetterSqlite3 = require('better-sqlite3');
    this.db = new BetterSqlite3(dbPath);
    // 启用 WAL 模式提升并发性能，避免 SQLITE_BUSY
    this.db.pragma('journal_mode = WAL');
    // 同步模式设为 NORMAL，平衡性能与安全性
    this.db.pragma('synchronous = NORMAL');
    this.serializer = serializer || new JSONSerializer<T>();
    this.initTable();
  }

  /**
   * 初始化表结构
   */
  private initTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      )
    `);

    // 创建索引
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_updated_at
      ON ${this.tableName}(updated_at)
    `);
  }

  // ============================================================
  // IStorage 接口实现
  // ============================================================

  async save(id: string, data: T): Promise<void> {
    const serialized = this.serializer.serialize(data);
    this.db.prepare(
      `INSERT OR REPLACE INTO ${this.tableName} (id, data, updated_at) VALUES (?, ?, ?)`
    ).run(id, serialized, Date.now());
  }

  async load(id: string): Promise<T | null> {
    const row = this.db.prepare(
      `SELECT data FROM ${this.tableName} WHERE id = ?`
    ).get(id) as { data: string } | undefined;

    return row ? this.serializer.deserialize(row.data) : null;
  }

  async query(filter: QueryFilter): Promise<T[]> {
    const { sql, params } = this.buildQuery(filter);
    const rows = this.db.prepare(sql).all(...params) as Array<{ data: string }>;
    return rows.map(row => this.serializer.deserialize(row.data));
  }

  async delete(id: string): Promise<void> {
    this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`).run(id);
  }

  async exists(id: string): Promise<boolean> {
    const row = this.db.prepare(
      `SELECT 1 FROM ${this.tableName} WHERE id = ? LIMIT 1`
    ).get(id);
    return row !== undefined;
  }

  // close() 方法见下方（事务方法之后）

  // ============================================================
  // IBatchStorage 接口实现
  // ============================================================

  async saveBatch(items: Array<{ id: string; data: T }>): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO ${this.tableName} (id, data, updated_at) VALUES (?, ?, ?)`
    );

    const transaction = this.db.transaction((items: Array<{ id: string; data: T }>) => {
      for (const item of items) {
        const serialized = this.serializer.serialize(item.data);
        stmt.run(item.id, serialized, Date.now());
      }
    });

    transaction(items);
  }

  async loadBatch(ids: string[]): Promise<Map<string, T>> {
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(
      `SELECT id, data FROM ${this.tableName} WHERE id IN (${placeholders})`
    ).all(...ids) as Array<{ id: string; data: string }>;

    const result = new Map<string, T>();
    for (const row of rows) {
      result.set(row.id, this.serializer.deserialize(row.data));
    }
    return result;
  }

  async deleteBatch(ids: string[]): Promise<void> {
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(
      `DELETE FROM ${this.tableName} WHERE id IN (${placeholders})`
    ).run(...ids);
  }

  // ============================================================
  // ITransactionalStorage 接口实现
  // ============================================================

  async transaction<R>(fn: (tx: ITransaction<T>) => Promise<R>): Promise<R> {
    const tx = new SQLiteTransaction(this.db, this.tableName, this.serializer);

    try {
      const result = await fn(tx);
      // 使用 better-sqlite3 原生事务包装所有收集的操作，保证原子性
      this.db.transaction(() => {
        for (const op of (tx as any).operations as Array<() => void>) {
          op();
        }
      })();
      return result;
    } catch (error) {
      // fn 抛出异常时操作未执行，无需回滚
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  // ============================================================
  // IQueryableStorage 接口实现
  // ============================================================

  async count(filter: QueryFilter): Promise<number> {
    const { sql, params } = this.buildQuery(filter, true);
    const row = this.db.prepare(sql).get(...params) as { count: number };
    return row.count;
  }

  async search(query: SearchQuery): Promise<SearchResult<T>> {
    // 简单的全文搜索实现
    const sql = `
      SELECT data FROM ${this.tableName}
      WHERE data LIKE ?
      LIMIT ?
    `;
    const rows = this.db.prepare(sql).all(
      `%${query.query}%`,
      query.limit || 20
    ) as Array<{ data: string }>;

    const items = rows.map(row => this.serializer.deserialize(row.data));

    return {
      items,
      total: items.length,
      hasMore: items.length === (query.limit || 20)
    };
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  private buildQuery(filter: QueryFilter, isCount = false): { sql: string; params: any[] } {
    const params: any[] = [];
    let sql = isCount
      ? `SELECT COUNT(*) as count FROM ${this.tableName}`
      : `SELECT data FROM ${this.tableName}`;

    // WHERE 子句
    if (filter.where && Object.keys(filter.where).length > 0) {
      const conditions: string[] = [];
      for (const [key, value] of Object.entries(filter.where)) {
        conditions.push(`json_extract(data, '$.${key}') = ?`);
        params.push(value);
      }
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    // ORDER BY 子句
    if (!isCount && filter.orderBy && filter.orderBy.length > 0) {
      const orders = filter.orderBy.map(
        o => `json_extract(data, '$.${o.field}') ${o.direction.toUpperCase()}`
      );
      sql += ` ORDER BY ${orders.join(', ')}`;
    }

    // LIMIT 和 OFFSET
    if (!isCount) {
      if (filter.limit) {
        sql += ` LIMIT ?`;
        params.push(filter.limit);
      }
      if (filter.offset) {
        sql += ` OFFSET ?`;
        params.push(filter.offset);
      }
    }

    return { sql, params };
  }
}
