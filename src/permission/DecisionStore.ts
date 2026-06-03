// ============================================================
// M5 权限控制 — 决策持久化存储
// ============================================================
//
// 将用户的 Always/Never 决策持久化到 SQLite 数据库，重启后不需重新确认
//

import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { logger } from '@/infrastructure/logger';

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
 * 审计日志记录
 */
export interface AuditLogEntry {
  /** 事件类型 */
  eventType: string;
  /** 工具名称 */
  toolName: string;
  /** 操作类别 */
  category?: string;
  /** 风险级别 */
  riskLevel?: string;
  /** 决策结果 */
  decision: string;
  /** 决策原因 */
  reason?: string;
  /** 操作目标 */
  target?: string;
  /** 用户操作 */
  userAction?: string;
  /** 时间戳 */
  timestamp: number;
  /** 会话ID */
  sessionId?: string;
}

/**
 * 审计日志查询选项
 */
export interface AuditQueryOptions {
  /** 工具名称过滤 */
  toolName?: string;
  /** 决策结果过滤 */
  decision?: string;
  /** 风险级别过滤 */
  riskLevel?: string;
  /** 开始时间 */
  startTime?: number;
  /** 结束时间 */
  endTime?: number;
  /** 限制数量 */
  limit?: number;
  /** 偏移量 */
  offset?: number;
}

/**
 * 审计统计信息
 */
export interface AuditStats {
  /** 总检查次数 */
  totalChecks: number;
  /** 允许次数 */
  allowedCount: number;
  /** 拒绝次数 */
  deniedCount: number;
  /** 允许率 */
  allowRate: number;
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

  constructor(dbPath: string) {
    this.dbPath = dbPath;
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

    // 审计日志表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS permission_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        category TEXT,
        risk_level TEXT,
        decision TEXT NOT NULL,
        reason TEXT,
        target TEXT,
        user_action TEXT,
        timestamp INTEGER NOT NULL,
        session_id TEXT
      )
    `);

    // 审计日志索引（提升查询性能）
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON permission_audit(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_tool_name ON permission_audit(tool_name);
      CREATE INDEX IF NOT EXISTS idx_audit_decision ON permission_audit(decision);
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

  // ============================================================
  // 审计日志方法
  // ============================================================

  /**
   * 保存审计日志
   */
  async saveAuditLog(entry: AuditLogEntry): Promise<void> {
    this.ensureReady();

    const stmt = this.db!.prepare(`
      INSERT INTO permission_audit (
        event_type, tool_name, category, risk_level, decision,
        reason, target, user_action, timestamp, session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.eventType,
      entry.toolName,
      entry.category ?? null,
      entry.riskLevel ?? null,
      entry.decision,
      entry.reason ?? null,
      entry.target ?? null,
      entry.userAction ?? null,
      entry.timestamp,
      entry.sessionId ?? null
    );
  }

  /**
   * 查询审计日志
   */
  queryAuditLogs(options: AuditQueryOptions = {}): AuditLogEntry[] {
    this.ensureReady();

    let sql = 'SELECT * FROM permission_audit WHERE 1=1';
    const params: any[] = [];

    if (options.toolName) {
      sql += ' AND tool_name = ?';
      params.push(options.toolName);
    }

    if (options.decision) {
      sql += ' AND decision = ?';
      params.push(options.decision);
    }

    if (options.riskLevel) {
      sql += ' AND risk_level = ?';
      params.push(options.riskLevel);
    }

    if (options.startTime) {
      sql += ' AND timestamp >= ?';
      params.push(options.startTime);
    }

    if (options.endTime) {
      sql += ' AND timestamp <= ?';
      params.push(options.endTime);
    }

    sql += ' ORDER BY timestamp DESC';

    if (options.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    if (options.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const stmt = this.db!.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      id: number;
      event_type: string;
      tool_name: string;
      category: string | null;
      risk_level: string | null;
      decision: string;
      reason: string | null;
      target: string | null;
      user_action: string | null;
      timestamp: number;
      session_id: string | null;
    }>;

    return rows.map(row => ({
      eventType: row.event_type,
      toolName: row.tool_name,
      category: row.category ?? undefined,
      riskLevel: row.risk_level ?? undefined,
      decision: row.decision,
      reason: row.reason ?? undefined,
      target: row.target ?? undefined,
      userAction: row.user_action ?? undefined,
      timestamp: row.timestamp,
      sessionId: row.session_id ?? undefined,
    }));
  }

  /**
   * 获取审计统计
   */
  getAuditStats(): AuditStats {
    this.ensureReady();

    const stmt = this.db!.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN decision = 'allowed' THEN 1 ELSE 0 END) as allowed,
        SUM(CASE WHEN decision = 'denied' THEN 1 ELSE 0 END) as denied
      FROM permission_audit
    `);

    const row = stmt.get() as { total: number; allowed: number; denied: number };

    return {
      totalChecks: row.total,
      allowedCount: row.allowed,
      deniedCount: row.denied,
      allowRate: row.total > 0 ? row.allowed / row.total : 0,
    };
  }

  /**
   * 清除审计日志
   */
  async clearAuditLogs(): Promise<void> {
    this.ensureReady();

    this.db!.exec(`DELETE FROM permission_audit`);
    log.debug('Cleared all audit logs');
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
