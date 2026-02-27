// ============================================================
// 向量存储 — SQLite + sqlite-vec 本地向量数据库
// ============================================================

import { logger } from '@/core/logger';
import type { MemoryEntry } from '@/memory/types';

const log = logger.child({ module: 'vector-store' });

/** 向量搜索结果 */
export interface VectorSearchResult {
  memory: MemoryEntry;
  similarity: number;
}

/** Skill embedding 记录 */
export interface SkillEmbeddingRecord {
  skillId: string;
  skillName: string;
  embedding: Float32Array;
  description: string;
}

/**
 * VectorStore — 基于 SQLite + sqlite-vec 的本地向量存储
 *
 * 使用 better-sqlite3 作为 SQLite driver，
 * sqlite-vec 作为向量索引扩展。
 *
 * 数据库路径: ~/.xuanji/vector.db
 */
export class VectorStore {
  private db: any = null;
  private ready = false;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /** 初始化数据库 */
  async init(): Promise<void> {
    if (this.ready) return;

    try {
      const Database = (await import('better-sqlite3')).default;
      this.db = new Database(this.dbPath);

      // 启用 WAL 模式提升并发性能
      this.db.pragma('journal_mode = WAL');

      // 加载 sqlite-vec 扩展
      try {
        const sqliteVec = await import('sqlite-vec');
        sqliteVec.load(this.db);
        log.info('sqlite-vec extension loaded');
      } catch (err) {
        log.warn('sqlite-vec extension not available, vector search will be disabled:', err);
      }

      // 创建表
      this.createTables();
      this.ready = true;
      log.info(`VectorStore initialized: ${this.dbPath}`);
    } catch (err) {
      log.error('Failed to initialize VectorStore:', err);
      throw err;
    }
  }

  /** 插入记忆及其向量 */
  insertMemory(memory: MemoryEntry, embedding: Float32Array): void {
    this.ensureReady();

    const insertMemory = this.db.prepare(`
      INSERT OR REPLACE INTO memories (id, type, content, keywords, confidence, created_at, last_accessed_at, access_count, project_path, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertVector = this.db.prepare(`
      INSERT OR REPLACE INTO memory_vectors (memory_id, embedding, updated_at)
      VALUES (?, ?, ?)
    `);

    const insertVecIndex = this.db.prepare(`
      INSERT OR REPLACE INTO vec_memories (rowid, embedding)
      VALUES ((SELECT rowid FROM memories WHERE id = ?), ?)
    `);

    const now = new Date().toISOString();
    const embeddingBuf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);

    const transaction = this.db.transaction(() => {
      insertMemory.run(
        memory.id,
        memory.type,
        memory.content,
        JSON.stringify(memory.keywords),
        memory.confidence,
        memory.createdAt,
        memory.lastAccessedAt,
        memory.accessCount,
        memory.projectPath ?? null,
        memory.source,
      );
      insertVector.run(memory.id, embeddingBuf, now);
      try {
        insertVecIndex.run(memory.id, embeddingBuf);
      } catch {
        // sqlite-vec 扩展不可用时静默跳过
      }
    });

    transaction();
  }

  /** 批量插入 */
  insertBatch(memories: MemoryEntry[], embeddings: Float32Array[]): void {
    this.ensureReady();

    const transaction = this.db.transaction(() => {
      for (let i = 0; i < memories.length; i++) {
        this.insertMemory(memories[i], embeddings[i]);
      }
    });

    transaction();
  }

  /** 向量相似度搜索 */
  searchSimilar(queryEmbedding: Float32Array, topK: number = 50): VectorSearchResult[] {
    this.ensureReady();

    const queryBuf = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);

    // 尝试使用 sqlite-vec 的向量索引
    try {
      const rows = this.db.prepare(`
        SELECT
          m.id, m.type, m.content, m.keywords, m.confidence,
          m.created_at, m.last_accessed_at, m.access_count,
          m.project_path, m.source,
          v.distance
        FROM vec_memories v
        INNER JOIN memories m ON m.rowid = v.rowid
        WHERE v.embedding MATCH ?
        ORDER BY v.distance
        LIMIT ?
      `).all(queryBuf, topK);

      return rows.map((row: any) => ({
        memory: this.rowToMemoryEntry(row),
        similarity: 1 - row.distance, // cosine distance → similarity
      }));
    } catch {
      // sqlite-vec 不可用，降级到暴力搜索
      return this.bruteForceSearch(queryEmbedding, topK);
    }
  }

  /** 插入/更新 Skill embedding */
  upsertSkillEmbedding(skillId: string, skillName: string, embedding: Float32Array, description: string): void {
    this.ensureReady();

    const embeddingBuf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT OR REPLACE INTO skill_vectors (skill_id, skill_name, embedding, description, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(skillId, skillName, embeddingBuf, description, now);
  }

  /** 获取所有 Skill embeddings */
  getAllSkillEmbeddings(): SkillEmbeddingRecord[] {
    this.ensureReady();

    const rows = this.db.prepare('SELECT * FROM skill_vectors').all();
    return rows.map((row: any) => ({
      skillId: row.skill_id,
      skillName: row.skill_name,
      embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4),
      description: row.description,
    }));
  }

  /** 获取已存储的记忆 ID 集合 */
  getStoredMemoryIds(): Set<string> {
    this.ensureReady();

    const rows = this.db.prepare('SELECT id FROM memories').all();
    return new Set(rows.map((r: any) => r.id));
  }

  /** 获取记忆总数 */
  getMemoryCount(): number {
    this.ensureReady();
    return this.db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
  }

  /** 是否就绪 */
  isReady(): boolean {
    return this.ready;
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.ready = false;
    }
  }

  // ────────── 私有方法 ──────────

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        keywords TEXT NOT NULL,
        confidence REAL NOT NULL,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        project_path TEXT,
        source TEXT
      );

      CREATE TABLE IF NOT EXISTS memory_vectors (
        memory_id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS skill_vectors (
        skill_id TEXT PRIMARY KEY,
        skill_name TEXT NOT NULL,
        embedding BLOB NOT NULL,
        description TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // 尝试创建 vec0 虚拟表（sqlite-vec 可用时）
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
          embedding float[384]
        );
      `);
    } catch {
      log.debug('vec0 virtual table not available (sqlite-vec extension missing)');
    }
  }

  /** 暴力搜索（sqlite-vec 不可用时的降级方案，分批加载避免内存爆炸） */
  private bruteForceSearch(queryEmbedding: Float32Array, topK: number): VectorSearchResult[] {
    const PAGE_SIZE = 500;
    const totalCount = this.db.prepare('SELECT COUNT(*) as count FROM memory_vectors').get().count;
    const results: VectorSearchResult[] = [];

    for (let offset = 0; offset < totalCount; offset += PAGE_SIZE) {
      const rows = this.db.prepare(`
        SELECT m.*, mv.embedding as vec_embedding
        FROM memories m
        INNER JOIN memory_vectors mv ON mv.memory_id = m.id
        LIMIT ? OFFSET ?
      `).all(PAGE_SIZE, offset);

      for (const row of rows) {
        const storedEmbedding = new Float32Array(
          row.vec_embedding.buffer,
          row.vec_embedding.byteOffset,
          row.vec_embedding.byteLength / 4,
        );
        const similarity = cosineSimilarity(queryEmbedding, storedEmbedding);
        results.push({
          memory: this.rowToMemoryEntry(row),
          similarity,
        });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  private rowToMemoryEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      type: row.type,
      content: row.content,
      keywords: JSON.parse(row.keywords),
      confidence: row.confidence,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      accessCount: row.access_count,
      projectPath: row.project_path ?? undefined,
      source: row.source,
    };
  }

  private ensureReady(): void {
    if (!this.ready) {
      throw new Error('VectorStore not initialized. Call init() first.');
    }
  }
}

/** 计算余弦相似度 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
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
