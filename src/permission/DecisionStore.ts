// ============================================================
// M5 权限控制 — 决策持久化存储
// ============================================================
//
// 将用户的 Always/Never 决策持久化到 SQLite 数据库，重启后不需重新确认
//

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'DecisionStore' });

/**
 * 持久化决策记录
 */
interface PersistedDecision {
  /** 缓存 key */
  cacheKey: string;
  /** 是否允许 */
  allowed: boolean;
  /** 工具名称 */
  toolName: string;
  /** 记录时间戳 (ISO 8601) */
  timestamp: string;
  /** 可选过期时间 (ISO 8601) */
  expiresAt?: string;
}

/**
 * 拒绝操作记录
 */
export interface DeniedOperation {
  /** 操作类别 */
  category: string;
  /** 操作模式 */
  pattern: string;
  /** 拒绝原因 */
  reason: string;
  /** 拒绝时间戳 */
  timestamp: number;
}

/**
 * DecisionStore — 权限决策持久化存储
 *
 * 使用 SQLite 数据库存储用户的 Always/Never 决策和拒绝操作记录
 */
export class DecisionStore {
  private db: import('better-sqlite3').Database | null = null;
  private dbPath: string;
  private ready: boolean = false;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? join(homedir(), '.xuanji', 'permission-decisions.db');
  }

  /**
   * 初始化数据库
   */
  async init(): Promise<void> {
    if (this.ready) return;

    // 确保目录存在
    const dir = join(this.dbPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const Database = (await import('better-sqlite3')).default;
    this.db = new Database(this.dbPath);

    // WAL 模式提升并发性能
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.initDB();
    this.ready = true;

    log.info(`DecisionStore initialized: ${this.dbPath}`);
  }

  /**
   * 创建数据库表
   */
  private initDB(): void {
    if (!this.db) return;

    // 决策表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        cache_key TEXT PRIMARY KEY,
        allowed INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        expires_at TEXT
      )
    `);

    // 拒绝操作表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS denied_operations (
        category TEXT NOT NULL,
        pattern TEXT NOT NULL,
        reason TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (category, pattern)
      )
    `);

    log.debug('Database tables initialized');
  }

  /**
   * 获取决策
   *
   * @returns true=允许, false=拒绝, undefined=未记录
   */
  get(cacheKey: string): boolean | undefined {
    this.ensureReady();

    const stmt = this.db!.prepare(`
      SELECT allowed, expires_at FROM decisions WHERE cache_key = ?
    `);
    const row = stmt.get(cacheKey) as { allowed: number; expires_at: string | null } | undefined;

    if (!row) {
      return undefined;
    }

    // 检查是否过期
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      this.delete(cacheKey);
      return undefined;
    }

    return row.allowed === 1;
  }

  /**
   * 设置决策
   */
  async set(cacheKey: string, allowed: boolean, toolName: string, ttlDays?: number): Promise<void> {
    this.ensureReady();

    const timestamp = new Date().toISOString();
    let expiresAt: string | null = null;

    // 如果指定了 TTL，计算过期时间
    if (ttlDays && ttlDays > 0) {
      const expires = new Date();
      expires.setDate(expires.getDate() + ttlDays);
      expiresAt = expires.toISOString();
    }

    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO decisions (cache_key, allowed, tool_name, timestamp, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(cacheKey, allowed ? 1 : 0, toolName, timestamp, expiresAt);
    log.debug(`Saved decision: ${cacheKey} -> ${allowed}`);
  }

  /**
   * 删除决策
   */
  async delete(cacheKey: string): Promise<void> {
    this.ensureReady();

    const stmt = this.db!.prepare(`DELETE FROM decisions WHERE cache_key = ?`);
    stmt.run(cacheKey);
  }

  /**
   * 清空所有决策
   */
  async clear(): Promise<void> {
    this.ensureReady();

    this.db!.exec(`DELETE FROM decisions`);
    log.debug('Cleared all decisions');
  }

  /**
   * 获取所有决策（用于调试）
   */
  getAll(): PersistedDecision[] {
    this.ensureReady();

    const stmt = this.db!.prepare(`
      SELECT cache_key, allowed, tool_name, timestamp, expires_at FROM decisions
    `);
    const rows = stmt.all() as Array<{
      cache_key: string;
      allowed: number;
      tool_name: string;
      timestamp: string;
      expires_at: string | null;
    }>;

    return rows.map(row => ({
      cacheKey: row.cache_key,
      allowed: row.allowed === 1,
      toolName: row.tool_name,
      timestamp: row.timestamp,
      expiresAt: row.expires_at ?? undefined,
    }));
  }

  /**
   * 是否已加载
   */
  isLoaded(): boolean {
    return this.ready;
  }

  /**
   * 保存拒绝操作记录
   */
  async saveDeniedOperation(category: string, pattern: string, reason: string): Promise<void> {
    this.ensureReady();

    const timestamp = Date.now();
    const stmt = this.db!.prepare(`
      INSERT OR REPLACE INTO denied_operations (category, pattern, reason, timestamp)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(category, pattern, reason, timestamp);
    log.debug(`Saved denied operation: ${category}:${pattern}`);
  }

  /**
   * 加载所有拒绝操作记录
   */
  loadDeniedOperations(): Map<string, DeniedOperation> {
    this.ensureReady();

    const stmt = this.db!.prepare(`
      SELECT category, pattern, reason, timestamp FROM denied_operations
    `);
    const rows = stmt.all() as Array<{
      category: string;
      pattern: string;
      reason: string;
      timestamp: number;
    }>;

    const result = new Map<string, DeniedOperation>();
    for (const row of rows) {
      const key = `${row.category}:${row.pattern}`;
      result.set(key, {
        category: row.category,
        pattern: row.pattern,
        reason: row.reason,
        timestamp: row.timestamp,
      });
    }

    return result;
  }

  /**
   * 删除拒绝操作记录
   */
  async deleteDeniedOperation(key: string): Promise<void> {
    this.ensureReady();

    const [category, pattern] = key.split(':', 2);
    if (!category || !pattern) {
      log.warn(`Invalid denied operation key: ${key}`);
      return;
    }

    const stmt = this.db!.prepare(`
      DELETE FROM denied_operations WHERE category = ? AND pattern = ?
    `);
    stmt.run(category, pattern);
    log.debug(`Deleted denied operation: ${key}`);
  }

  /**
   * 清空所有拒绝操作记录
   */
  async clearDeniedOperations(): Promise<void> {
    this.ensureReady();

    this.db!.exec(`DELETE FROM denied_operations`);
    log.debug('Cleared all denied operations');
  }

  /**
   * 确保数据库已初始化
   */
  private ensureReady(): void {
    if (!this.ready || !this.db) {
      throw new Error('DecisionStore not initialized. Call init() first.');
    }
  }
}
