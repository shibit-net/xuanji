// ============================================================
// MemoryStore — 统一 SQLite 存储层
// ============================================================
// 单文件：.xuanji/users/{userId}/memory/memory.db
// 支持：CRUD、FTS5 全文检索、向量存储、事务批量写入

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { logger } from '@/core/logger';
import { getUserMemoryPath } from '@/core/config/PathManager';
import type { MemoryEntry, MemoryRow, VectorRow, CountRow, StatsRow, MemoryEntryType, MemoryScope, MemoryVolatility, MemoryCategory } from './types';

const log = logger.child({ module: 'MemoryStore' });

/** 向量搜索结果 */
export interface VectorSearchResult {
  id: string;
  similarity: number;
}

/**
 * MemoryStore — 统一 SQLite 存储
 *
 * 数据库路径：.xuanji/users/{userId}/memory/memory.db
 * 支持全局记忆（project_path = NULL）和项目级记忆（project_path = 路径）
 */
export class MemoryStore {
  private db: import('better-sqlite3').Database | null = null;
  private ready = false;
  private vecAvailable = false;
  private dbPath: string;

  constructor(userId: string) {
    this.dbPath = getUserMemoryPath(userId);
  }

  /** 初始化数据库（建表、触发器、尝试加载 sqlite-vec） */
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

    // 尝试加载 sqlite-vec 扩展
    try {
      const sqliteVec = await import('sqlite-vec');
      sqliteVec.load(this.db);
      this.vecAvailable = true;
      log.info('sqlite-vec extension loaded');
    } catch {
      this.vecAvailable = false;
      log.debug('sqlite-vec not available, using brute-force vector search');
    }

    this.createTables();
    this.ready = true;

    // 检测旧 JSONL 数据，自动迁移
    await this.autoMigrateIfNeeded();

    // M5 字段迁移
    await this.migrateM5Fields();

    log.info(`MemoryStore initialized: ${this.dbPath}`);
  }

  /** 保存单条记忆（INSERT OR REPLACE） */
  saveEntry(entry: MemoryEntry): void {
    this.ensureReady();
    this.saveEntryStmt().run(this.entryToRow(entry));
  }

  /** 批量保存（单一事务） */
  saveBatch(entries: MemoryEntry[]): void {
    if (entries.length === 0) return;
    this.ensureReady();

    const stmt = this.saveEntryStmt();
    const transaction = this.db!.transaction(() => {
      for (const entry of entries) {
        stmt.run(this.entryToRow(entry));
      }
    });
    transaction();
  }

  /** 更新记忆（部分字段）
   *
   * 使用真正的 UPDATE 语句（而非 INSERT OR REPLACE），
   * 保持 rowid 不变，确保 FTS5 索引不被破坏。
   */
  updateEntry(id: string, updates: Partial<MemoryEntry>): void {
    this.ensureReady();

    const existing = this.getEntry(id);
    if (!existing) {
      log.warn(`updateEntry: memory not found: ${id}`);
      return;
    }

    const merged: MemoryEntry = { ...existing, ...updates, id };
    const row = this.entryToRow(merged);

    this.db!.prepare(`
      UPDATE memories SET
        type = @type,
        content = @content,
        keywords = @keywords,
        source = @source,
        confidence = @confidence,
        accuracy = @accuracy,
        project_path = @project_path,
        updated_at = @updated_at,
        last_accessed_at = @last_accessed_at,
        access_count = @access_count,
        category = @category,
        session_id = @session_id,
        day_key = @day_key,
        superseded_by = @superseded_by,
        dismissed = @dismissed,
        obsolete = @obsolete,
        metadata = @metadata,
        scope = @scope,
        volatility = @volatility,
        significance = @significance,
        category_label = @category_label
      WHERE id = @id
    `).run(row);
  }

  /** 删除记忆 */
  deleteEntry(id: string): void {
    this.ensureReady();
    this.db!.prepare('DELETE FROM memories WHERE id = ?').run(id);
  }

  /** 获取单条记忆 */
  getEntry(id: string): MemoryEntry | null {
    this.ensureReady();
    const row = this.db!.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
    return row ? this.rowToEntry(row) : null;
  }

  /**
   * 读取所有记忆（按 last_accessed_at 降序）
   * @param options.projectPath - 过滤项目路径（undefined = 全局）
   * @param options.limit - 最多返回条数
   */
  readAll(options?: { projectPath?: string; limit?: number }): MemoryEntry[] {
    this.ensureReady();

    let sql = 'SELECT * FROM memories WHERE obsolete = 0';
    const params: (string | number)[] = [];

    if (options?.projectPath !== undefined) {
      sql += ' AND (project_path = ? OR project_path IS NULL)';
      params.push(options.projectPath);
    }

    sql += ' ORDER BY last_accessed_at DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db!.prepare(sql).all(...params) as MemoryRow[];
    return rows.map((r) => this.rowToEntry(r));
  }

  /**
   * FTS5 全文检索（替代关键词全量扫描）
   * 返回按相关度排序的记忆列表
   */
  searchFTS(query: string, limit = 50): MemoryEntry[] {
    this.ensureReady();

    try {
      const ftsQuery = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 2)
        .map((w) => `${w}*`)
        .join(' OR ');

      if (!ftsQuery) return [];

      const rows = this.db!.prepare(`
        SELECT m.*
        FROM memories_fts f
        INNER JOIN memories m ON m.id = f.id
        WHERE memories_fts MATCH ? AND m.obsolete = 0
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, limit) as MemoryRow[];

      return rows.map((r) => this.rowToEntry(r));
    } catch (err) {
      log.debug('FTS search failed, returning empty:', err);
      return [];
    }
  }

  /**
   * 向量相似度搜索
   * 优先使用 sqlite-vec，降级到暴力搜索
   */
  searchVector(queryEmbedding: Float32Array, topK = 50): VectorSearchResult[] {
    this.ensureReady();

    const queryBuf = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);

    if (this.vecAvailable) {
      try {
        const rows = this.db!.prepare(`
          SELECT m.id, v.distance
          FROM vec_memories v
          INNER JOIN memory_vector_map map ON map.vec_rowid = v.rowid
          INNER JOIN memories m ON m.id = map.memory_id
          WHERE v.embedding MATCH ? AND k = ?
          ORDER BY v.distance
        `).all(queryBuf, topK) as Array<{ id: string; distance: number }>;

        log.debug(`sqlite-vec search returned ${rows.length} results`);

        return rows.map((row) => ({
          id: row.id,
          similarity: 1 - row.distance,
        }));
      } catch (err) {
        log.debug('sqlite-vec search failed, falling back to brute-force:', err);
      }
    }

    return this.bruteForceSearch(queryEmbedding, topK);
  }

  /** 插入/更新向量 */
  upsertVector(memoryId: string, embedding: Float32Array): void {
    this.ensureReady();

    const embeddingBuf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    const now = new Date().toISOString();

    // 始终保存到 memory_vectors 表（降级方案）
    this.db!.prepare(`
      INSERT OR REPLACE INTO memory_vectors (memory_id, embedding, updated_at)
      VALUES (?, ?, ?)
    `).run(memoryId, embeddingBuf, now);

    // 如果 sqlite-vec 可用，同步到 vec_memories
    if (this.vecAvailable) {
      try {
        const tx = this.db!.transaction(() => {
          const existingMap = this.db!.prepare(`
            SELECT vec_rowid FROM memory_vector_map WHERE memory_id = ?
          `).get(memoryId) as { vec_rowid: number } | undefined;

          if (existingMap) {
            this.db!.prepare('DELETE FROM vec_memories WHERE rowid = ?').run(existingMap.vec_rowid);
          }

          const result = this.db!.prepare('INSERT INTO vec_memories (embedding) VALUES (?)').run(embeddingBuf);
          const vecRowid = result.lastInsertRowid;

          this.db!.prepare(`
            INSERT OR REPLACE INTO memory_vector_map (memory_id, vec_rowid)
            VALUES (?, ?)
          `).run(memoryId, vecRowid);

          log.debug(`Successfully synced to vec_memories: ${memoryId} -> vec_rowid ${vecRowid}`);
        });

        tx();
      } catch (err) {
        log.debug(`Failed to sync to vec_memories for ${memoryId}, will use brute-force search:`, err);
      }
    }
  }

  /** 获取已有向量的记忆 ID 集合 */
  getVectorIds(): Set<string> {
    this.ensureReady();
    const rows = this.db!.prepare('SELECT memory_id FROM memory_vectors').all() as Array<{ memory_id: string }>;
    return new Set(rows.map((row) => row.memory_id));
  }

  /** 压缩后覆盖写入（替代 LongTermMemory.replaceAll） */
  replaceAll(entries: MemoryEntry[], projectPath?: string): void {
    this.ensureReady();

    const transaction = this.db!.transaction(() => {
      if (projectPath !== undefined) {
        this.db!.prepare('DELETE FROM memories WHERE project_path = ?').run(projectPath);
      } else {
        this.db!.prepare('DELETE FROM memories WHERE project_path IS NULL').run();
      }

      const stmt = this.saveEntryStmt();
      for (const entry of entries) {
        stmt.run(this.entryToRow(entry));
      }
    });

    transaction();
  }

  /** 获取统计信息 */
  getStats(): { total: number; byType: Record<string, number> } {
    this.ensureReady();

    const total = (this.db!.prepare('SELECT COUNT(*) as count FROM memories WHERE obsolete = 0').get() as CountRow).count;

    const rows = this.db!.prepare(`
      SELECT type, COUNT(*) as count FROM memories WHERE obsolete = 0 GROUP BY type
    `).all() as StatsRow[];

    const byType: Record<string, number> = {};
    for (const row of rows) {
      byType[row.type] = row.count;
    }

    return { total, byType };
  }

  /** 获取缺失向量的记忆（用于补偿任务） */
  getMemoriesWithoutVectors(limit: number): MemoryEntry[] {
    this.ensureReady();

    const rows = this.db!.prepare(`
      SELECT * FROM memories
      WHERE id NOT IN (SELECT memory_id FROM memory_vectors)
        AND obsolete = 0
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as MemoryRow[];

    return rows.map((row) => this.rowToEntry(row));
  }

  /** Skill 向量相关（从 vector.db 合并） */
  upsertSkillEmbedding(skillId: string, skillName: string, embedding: Float32Array, description: string): void {
    this.ensureReady();
    const embeddingBuf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    this.db!.prepare(`
      INSERT OR REPLACE INTO skill_vectors (skill_id, skill_name, embedding, description, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(skillId, skillName, embeddingBuf, description, new Date().toISOString());
  }

  getAllSkillEmbeddings(): Array<{ skillId: string; skillName: string; embedding: Float32Array; description: string }> {
    this.ensureReady();
    const rows = this.db!.prepare('SELECT * FROM skill_vectors LIMIT 1000').all() as Array<{
      skill_id: string;
      skill_name: string;
      embedding: Buffer;
      description: string;
    }>;

    return rows.map((row) => {
      const buf = Buffer.from(row.embedding);
      return {
        skillId: row.skill_id,
        skillName: row.skill_name,
        embedding: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4),
        description: row.description,
      };
    });
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.ready = false;
    }
  }

  private createTables(): void {
    this.db!.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id                TEXT PRIMARY KEY,
        type              TEXT NOT NULL,
        content           TEXT NOT NULL,
        keywords          TEXT NOT NULL DEFAULT '[]',
        source            TEXT NOT NULL DEFAULT 'conversation',
        confidence        REAL NOT NULL DEFAULT 0.8,
        accuracy          REAL NOT NULL DEFAULT 1.0,
        project_path      TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        last_accessed_at  TEXT NOT NULL,
        access_count      INTEGER NOT NULL DEFAULT 0,
        category          TEXT,
        session_id        TEXT,
        day_key           TEXT,
        superseded_by     TEXT,
        dismissed         INTEGER DEFAULT 0,
        obsolete          INTEGER DEFAULT 0,
        metadata          TEXT DEFAULT '{}',
        scope             TEXT,
        volatility        TEXT,
        significance      REAL,
        category_label    TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_mem_type     ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_mem_project  ON memories(project_path);
      CREATE INDEX IF NOT EXISTS idx_mem_session  ON memories(session_id);
      CREATE INDEX IF NOT EXISTS idx_mem_created  ON memories(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mem_accessed ON memories(last_accessed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mem_obsolete ON memories(obsolete);
      CREATE INDEX IF NOT EXISTS idx_mem_scope    ON memories(scope);
      CREATE INDEX IF NOT EXISTS idx_mem_volatility ON memories(volatility);

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id UNINDEXED,
        content,
        keywords,
        content='memories',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, id, content, keywords) VALUES (new.rowid, new.id, new.content, new.keywords);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, id, content, keywords) VALUES ('delete', old.rowid, old.id, old.content, old.keywords);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, id, content, keywords) VALUES ('delete', old.rowid, old.id, old.content, old.keywords);
        INSERT INTO memories_fts(rowid, id, content, keywords) VALUES (new.rowid, new.id, new.content, new.keywords);
      END;

      CREATE TABLE IF NOT EXISTS memory_vectors (
        memory_id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS memory_vector_map (
        memory_id TEXT PRIMARY KEY,
        vec_rowid INTEGER NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS skill_vectors (
        skill_id    TEXT PRIMARY KEY,
        skill_name  TEXT NOT NULL,
        embedding   BLOB NOT NULL,
        description TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
    `);

    if (this.vecAvailable) {
      try {
        this.db!.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
            embedding float[384]
          );
        `);
      } catch {
        this.vecAvailable = false;
        log.debug('Failed to create vec_memories virtual table');
      }
    }
  }

  private saveEntryStmt() {
    return this.db!.prepare(`
      INSERT OR REPLACE INTO memories (
        id, type, content, keywords, source, confidence, accuracy,
        project_path, created_at, updated_at, last_accessed_at, access_count,
        category, session_id, day_key, superseded_by, dismissed, obsolete, metadata,
        scope, volatility, significance, category_label
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  private entryToRow(entry: MemoryEntry): Record<string, string | number | null> {
    const now = new Date().toISOString();

    const metadata = JSON.stringify({
      ...(entry.metadata ?? {}),
      relatedMemories: entry.relatedMemories,
      extractedFrom: entry.extractedFrom,
      topicId: entry.topicId,
      taskContext: entry.taskContext,
      lessonType: entry.lessonType,
      problemDescription: entry.problemDescription,
      solution: entry.solution,
      applicableScenarios: entry.applicableScenarios,
    });

    return {
      id: entry.id,
      type: entry.type,
      content: entry.content,
      keywords: JSON.stringify(entry.keywords ?? []),
      source: entry.source ?? 'conversation',
      confidence: entry.confidence ?? 0.8,
      accuracy: (entry as MemoryEntry & { accuracy?: number }).accuracy ?? 1.0,
      project_path: entry.projectPath ?? null,
      created_at: entry.createdAt ?? now,
      updated_at: now,
      last_accessed_at: entry.lastAccessedAt ?? now,
      access_count: entry.accessCount ?? 0,
      category: entry.category ?? null,
      session_id: entry.sessionId ?? null,
      day_key: entry.dayKey ?? null,
      superseded_by: entry.supersededBy ?? null,
      dismissed: entry.dismissed ? 1 : 0,
      obsolete: (entry as MemoryEntry & { obsolete?: boolean }).obsolete ? 1 : 0,
      metadata,
      scope: entry.scope ?? null,
      volatility: entry.volatility ?? null,
      significance: entry.significance ?? null,
      category_label: entry.categoryLabel ?? null,
    };
  }

  private rowToEntry(row: MemoryRow): MemoryEntry {
    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(row.metadata ?? '{}');
    } catch {
      // no-op
    }

    return {
      id: row.id,
      type: row.type as MemoryEntryType,
      content: row.content,
      keywords: (() => {
        try {
          return JSON.parse(row.keywords ?? '[]');
        } catch {
          return [];
        }
      })(),
      source: row.source ?? 'conversation',
      confidence: row.confidence ?? 0.8,
      projectPath: row.project_path ?? undefined,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      accessCount: row.access_count ?? 0,
      category: (row.category as MemoryCategory | null) ?? undefined,
      sessionId: row.session_id ?? undefined,
      dayKey: row.day_key ?? undefined,
      supersededBy: row.superseded_by ?? undefined,
      dismissed: row.dismissed === 1,
      obsolete: (row as any).obsolete === 1,
      metadata: Object.fromEntries(
        Object.entries(metadata).filter(([key]) =>
          !['relatedMemories', 'extractedFrom', 'topicId', 'taskContext',
            'lessonType', 'problemDescription', 'solution', 'applicableScenarios',
            'scope', 'volatility', 'significance', 'categoryLabel'].includes(key)
        )
      ),
      relatedMemories: metadata.relatedMemories as string[] | undefined,
      extractedFrom: metadata.extractedFrom as string | undefined,
      topicId: metadata.topicId as string | undefined,
      taskContext: metadata.taskContext as MemoryEntry['taskContext'],
      lessonType: metadata.lessonType as 'mistake' | 'improvement' | 'best_practice' | undefined,
      problemDescription: metadata.problemDescription as string | undefined,
      solution: metadata.solution as string | undefined,
      applicableScenarios: metadata.applicableScenarios as string[] | undefined,
      scope: (row.scope as MemoryScope | null) ?? (metadata.scope as MemoryScope | undefined),
      volatility: (row.volatility as MemoryVolatility | null) ?? (metadata.volatility as MemoryVolatility | undefined),
      significance: row.significance ?? (metadata.significance as number | undefined),
      categoryLabel: row.category_label ?? (metadata.categoryLabel as string | undefined),
    };
  }

  private bruteForceSearch(queryEmbedding: Float32Array, topK: number): VectorSearchResult[] {
    const PAGE_SIZE = 500;
    const total = (this.db!.prepare('SELECT COUNT(*) as count FROM memory_vectors').get() as CountRow).count;
    const results: VectorSearchResult[] = [];

    for (let offset = 0; offset < total; offset += PAGE_SIZE) {
      const rows = this.db!.prepare(`
        SELECT memory_id, embedding FROM memory_vectors LIMIT ? OFFSET ?
      `).all(PAGE_SIZE, offset) as VectorRow[];

      for (const row of rows) {
        const buf = Buffer.from(row.embedding);
        const stored = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
        const similarity = cosineSimilarity(queryEmbedding, stored);
        results.push({ id: row.memory_id, similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  private async autoMigrateIfNeeded(): Promise<void> {
    const { existsSync: exists } = await import('node:fs');
    const oldMemoryDir = join(homedir(), '.xuanji', 'memory');

    if (!exists(oldMemoryDir)) return;

    const currentCount = (this.db!.prepare('SELECT COUNT(*) as count FROM memories').get() as CountRow).count;
    if (currentCount > 0) return;

    try {
      const { MigrationRunner } = await import('./migration/MigrationRunner.js');
      const runner = new MigrationRunner(this);
      await runner.run();
    } catch (err) {
      log.debug('Auto migration skipped:', err);
    }
  }

  private async migrateM5Fields(): Promise<void> {
    try {
      const { M5FieldsMigration } = await import('./migration/M5FieldsMigration.js');
      const migration = new M5FieldsMigration(this);
      await migration.run();
    } catch (err) {
      log.debug('M5 fields migration skipped:', err);
    }
  }

  private ensureReady(): void {
    if (!this.ready || !this.db) {
      throw new Error('MemoryStore not initialized. Call init() first.');
    }
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
