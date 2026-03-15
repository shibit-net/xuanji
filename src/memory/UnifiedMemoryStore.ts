// ============================================================
// 统一记忆存储（Unified Memory Store）
// ============================================================
// 职责：
// - 提供完整的 CRUD 操作（create, read, update, delete）
// - 支持向量语义检索
// - 管理记忆质量（质量评分、用户反馈）
// - 支持记忆导出/导入
// ============================================================

import Database from 'better-sqlite3';
import path from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import { VectorStore } from '../embedding/VectorStore.js';
import { EmbeddingService } from '../embedding/EmbeddingService.js';

// ============================================================
// 类型定义
// ============================================================

/** 记忆类型 */
export type UnifiedMemoryType =
  | 'exchange'          // 对话交互
  | 'fact'             // 事实性知识
  | 'preference'       // 用户偏好
  | 'skill'            // 技能
  | 'error'            // 错误记录
  | 'decision'         // 决策记录
  | 'pattern';         // 模式

/** 记忆质量 */
export interface MemoryQuality {
  accuracy: number;        // 准确性（0-1）
  confidence: number;      // 可信度（0-1）
  recency: number;         // 时效性（0-1，自动计算）
  useCount: number;        // 使用次数
  lastUsed: number;        // 最后使用时间（timestamp）
}

/** 记忆来源 */
export interface MemoryProvenance {
  source: 'user_explicit' | 'conversation' | 'file_analysis' | 'web_search' | 'error_detection';
  originalContext: {
    sessionId?: string;
    messageId?: string;
    filePath?: string;
    url?: string;
    timestamp: number;
  };
  extractionMethod: 'llm_extract' | 'user_command' | 'rule_based' | 'auto_detect';
  traceable: boolean;      // 是否可追溯到原始对话
  verifiable: boolean;     // 是否可验证
}

/** 统一记忆条目 */
export interface UnifiedMemory {
  id: string;
  type: UnifiedMemoryType;
  content: string;
  metadata: Record<string, any>;
  quality: MemoryQuality;
  provenance: MemoryProvenance;
  hidden: boolean;
  obsolete: boolean;
  needsReview: boolean;
  createdAt: number;
  updatedAt: number;
  embedding?: number[];    // 向量表示（由 VectorStore 管理）
}

/** 检索选项 */
export interface SearchOptions {
  query?: string;          // 语义搜索查询
  type?: UnifiedMemoryType | UnifiedMemoryType[];
  minQuality?: number;     // 最小质量分数
  minAccuracy?: number;    // 最小准确性
  minConfidence?: number;  // 最小可信度
  excludeHidden?: boolean; // 排除隐藏的记忆
  excludeObsolete?: boolean; // 排除过时的记忆
  timeRange?: {
    start?: number;
    end?: number;
  };
  limit?: number;
  offset?: number;
}

/** 记忆统计 */
export interface MemoryStats {
  total: number;
  byType: Record<UnifiedMemoryType, number>;
  byQuality: {
    high: number;      // quality >= 0.7
    medium: number;    // 0.4 <= quality < 0.7
    low: number;       // quality < 0.4
  };
  hidden: number;
  obsolete: number;
  needsReview: number;
}

// ============================================================
// UnifiedMemoryStore 类
// ============================================================

export class UnifiedMemoryStore {
  private db: Database.Database | null = null;
  private vectorStore: VectorStore | null = null;
  private embedding: EmbeddingService | null = null;
  private dbPath: string;

  constructor(dataDir?: string) {
    const baseDir = dataDir || path.join(homedir(), '.xuanji');
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }
    this.dbPath = path.join(baseDir, 'unified-memory.db');
  }

  /**
   * 初始化存储
   */
  async init(): Promise<void> {
    // 1. 初始化 SQLite 数据库
    this.db = new Database(this.dbPath);

    // 2. 创建表结构
    this.createTables();

    // 3. 初始化向量存储（使用现有的 VectorStore）
    this.vectorStore = new VectorStore(this.dbPath);
    await this.vectorStore.init();

    // 4. 初始化 Embedding 服务
    this.embedding = EmbeddingService.getInstance();
    await this.embedding.init();

    console.log(`[UnifiedMemoryStore] Initialized at ${this.dbPath}`);
  }

  /**
   * 创建数据库表
   */
  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    // 记忆主表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS unified_memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL,
        quality TEXT NOT NULL,
        provenance TEXT NOT NULL,
        hidden INTEGER DEFAULT 0,
        obsolete INTEGER DEFAULT 0,
        needs_review INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_type ON unified_memories(type);
      CREATE INDEX IF NOT EXISTS idx_hidden ON unified_memories(hidden);
      CREATE INDEX IF NOT EXISTS idx_obsolete ON unified_memories(obsolete);
      CREATE INDEX IF NOT EXISTS idx_created_at ON unified_memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_updated_at ON unified_memories(updated_at);
    `);

    // 向量索引由 VectorStore 管理
  }

  /**
   * 添加记忆
   */
  async add(memory: Omit<UnifiedMemory, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    if (!this.db || !this.vectorStore || !this.embedding) {
      throw new Error('Store not initialized');
    }

    const now = Date.now();
    const id = `mem-${now}-${Math.random().toString(36).slice(2, 9)}`;

    const fullMemory: UnifiedMemory = {
      ...memory,
      id,
      createdAt: now,
      updatedAt: now,
    };

    // 1. 生成 embedding
    const embedding = await this.embedding.embed(memory.content);

    // 2. 保存到主表
    const stmt = this.db.prepare(`
      INSERT INTO unified_memories (
        id, type, content, metadata, quality, provenance,
        hidden, obsolete, needs_review, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      fullMemory.type,
      fullMemory.content,
      JSON.stringify(fullMemory.metadata),
      JSON.stringify(fullMemory.quality),
      JSON.stringify(fullMemory.provenance),
      fullMemory.hidden ? 1 : 0,
      fullMemory.obsolete ? 1 : 0,
      fullMemory.needsReview ? 1 : 0,
      fullMemory.createdAt,
      fullMemory.updatedAt
    );

    // 3. 添加到向量索引
    await this.vectorStore.add(id, embedding);

    return id;
  }

  /**
   * 获取单条记忆
   */
  async get(id: string): Promise<UnifiedMemory | null> {
    if (!this.db) throw new Error('Store not initialized');

    const stmt = this.db.prepare('SELECT * FROM unified_memories WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) return null;

    return this.rowToMemory(row);
  }

  /**
   * 更新记忆
   */
  async update(id: string, updates: Partial<UnifiedMemory>): Promise<void> {
    if (!this.db || !this.vectorStore || !this.embedding) {
      throw new Error('Store not initialized');
    }

    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Memory not found: ${id}`);
    }

    const updated: UnifiedMemory = {
      ...existing,
      ...updates,
      id, // 不允许修改 ID
      updatedAt: Date.now(),
    };

    // 如果内容变更，重新生成 embedding
    if (updates.content && updates.content !== existing.content) {
      const embedding = await this.embedding.embed(updates.content);
      await this.vectorStore.update(id, embedding);
    }

    // 更新主表
    const stmt = this.db.prepare(`
      UPDATE unified_memories
      SET type = ?, content = ?, metadata = ?, quality = ?, provenance = ?,
          hidden = ?, obsolete = ?, needs_review = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updated.type,
      updated.content,
      JSON.stringify(updated.metadata),
      JSON.stringify(updated.quality),
      JSON.stringify(updated.provenance),
      updated.hidden ? 1 : 0,
      updated.obsolete ? 1 : 0,
      updated.needsReview ? 1 : 0,
      updated.updatedAt,
      id
    );
  }

  /**
   * 删除记忆
   */
  async delete(id: string): Promise<void> {
    if (!this.db || !this.vectorStore) {
      throw new Error('Store not initialized');
    }

    // 1. 从主表删除
    const stmt = this.db.prepare('DELETE FROM unified_memories WHERE id = ?');
    stmt.run(id);

    // 2. 从向量索引删除
    await this.vectorStore.delete(id);
  }

  /**
   * 搜索记忆（支持语义搜索 + 过滤）
   */
  async search(options: SearchOptions = {}): Promise<UnifiedMemory[]> {
    if (!this.db || !this.vectorStore || !this.embedding) {
      throw new Error('Store not initialized');
    }

    let memories: UnifiedMemory[] = [];

    // [1] 语义搜索
    if (options.query) {
      const embedding = await this.embedding.embed(options.query);
      const results = await this.vectorStore.search(embedding, options.limit || 50);

      // 获取完整记忆数据
      for (const result of results) {
        const memory = await this.get(result.id);
        if (memory) {
          memories.push(memory);
        }
      }
    } else {
      // [2] 数据库查询（无语义搜索）
      let sql = 'SELECT * FROM unified_memories WHERE 1=1';
      const params: any[] = [];

      if (options.type) {
        const types = Array.isArray(options.type) ? options.type : [options.type];
        sql += ` AND type IN (${types.map(() => '?').join(',')})`;
        params.push(...types);
      }

      if (options.excludeHidden) {
        sql += ' AND hidden = 0';
      }

      if (options.excludeObsolete) {
        sql += ' AND obsolete = 0';
      }

      if (options.timeRange) {
        if (options.timeRange.start) {
          sql += ' AND created_at >= ?';
          params.push(options.timeRange.start);
        }
        if (options.timeRange.end) {
          sql += ' AND created_at <= ?';
          params.push(options.timeRange.end);
        }
      }

      sql += ' ORDER BY updated_at DESC';

      if (options.limit) {
        sql += ' LIMIT ?';
        params.push(options.limit);
      }

      if (options.offset) {
        sql += ' OFFSET ?';
        params.push(options.offset);
      }

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as any[];

      memories = rows.map(row => this.rowToMemory(row));
    }

    // [3] 应用质量过滤
    return this.applyQualityFilter(memories, options);
  }

  /**
   * 应用质量过滤
   */
  private applyQualityFilter(memories: UnifiedMemory[], options: SearchOptions): UnifiedMemory[] {
    return memories.filter(m => {
      // 最小质量分数
      if (options.minQuality !== undefined) {
        const finalScore = this.calculateFinalScore(m.quality);
        if (finalScore < options.minQuality) return false;
      }

      // 最小准确性
      if (options.minAccuracy !== undefined) {
        if (m.quality.accuracy < options.minAccuracy) return false;
      }

      // 最小可信度
      if (options.minConfidence !== undefined) {
        if (m.quality.confidence < options.minConfidence) return false;
      }

      return true;
    });
  }

  /**
   * 计算最终质量分数（加权平均）
   */
  private calculateFinalScore(quality: MemoryQuality): number {
    const weights = {
      accuracy: 0.4,
      confidence: 0.3,
      recency: 0.2,
      frequency: 0.1,
    };

    const recency = this.calculateRecency(quality.lastUsed);
    const frequency = this.calculateFrequency(quality.useCount, quality.lastUsed);

    return (
      quality.accuracy * weights.accuracy +
      quality.confidence * weights.confidence +
      recency * weights.recency +
      frequency * weights.frequency
    );
  }

  /**
   * 计算时效性（指数衰减）
   */
  private calculateRecency(lastUsed: number): number {
    const now = Date.now();
    const hoursSince = (now - lastUsed) / (1000 * 60 * 60);
    const halfLife = 168; // 7天（168小时）

    return Math.exp(-0.693 * hoursSince / halfLife);
  }

  /**
   * 计算使用频率分数
   */
  private calculateFrequency(useCount: number, lastUsed: number): number {
    const now = Date.now();
    const daysSinceLastUse = (now - lastUsed) / (1000 * 60 * 60 * 24);

    const baseScore = Math.log10(useCount + 1) / Math.log10(101); // 归一化到 0-1
    const recencyFactor = Math.exp(-daysSinceLastUse / 30); // 30天半衰期

    return baseScore * 0.7 + recencyFactor * 0.3;
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<MemoryStats> {
    if (!this.db) throw new Error('Store not initialized');

    const stats: MemoryStats = {
      total: 0,
      byType: {
        exchange: 0,
        fact: 0,
        preference: 0,
        skill: 0,
        error: 0,
        decision: 0,
        pattern: 0,
      },
      byQuality: {
        high: 0,
        medium: 0,
        low: 0,
      },
      hidden: 0,
      obsolete: 0,
      needsReview: 0,
    };

    // 总数
    const total = this.db.prepare('SELECT COUNT(*) as count FROM unified_memories').get() as any;
    stats.total = total.count;

    // 按类型统计
    const byType = this.db.prepare(`
      SELECT type, COUNT(*) as count
      FROM unified_memories
      GROUP BY type
    `).all() as any[];

    for (const row of byType) {
      stats.byType[row.type as UnifiedMemoryType] = row.count;
    }

    // 按质量统计
    const allMemories = await this.search({ limit: 10000 }); // 获取全部（有限制）
    for (const mem of allMemories) {
      const score = this.calculateFinalScore(mem.quality);
      if (score >= 0.7) {
        stats.byQuality.high++;
      } else if (score >= 0.4) {
        stats.byQuality.medium++;
      } else {
        stats.byQuality.low++;
      }
    }

    // 隐藏/过时/需审核
    const hidden = this.db.prepare('SELECT COUNT(*) as count FROM unified_memories WHERE hidden = 1').get() as any;
    stats.hidden = hidden.count;

    const obsolete = this.db.prepare('SELECT COUNT(*) as count FROM unified_memories WHERE obsolete = 1').get() as any;
    stats.obsolete = obsolete.count;

    const needsReview = this.db.prepare('SELECT COUNT(*) as count FROM unified_memories WHERE needs_review = 1').get() as any;
    stats.needsReview = needsReview.count;

    return stats;
  }

  /**
   * 获取所有记忆（用于导出）
   */
  async getAll(): Promise<UnifiedMemory[]> {
    if (!this.db) throw new Error('Store not initialized');

    const stmt = this.db.prepare('SELECT * FROM unified_memories ORDER BY updated_at DESC');
    const rows = stmt.all() as any[];

    return rows.map(row => this.rowToMemory(row));
  }

  /**
   * 批量导入记忆
   */
  async importMany(memories: UnifiedMemory[]): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    for (const memory of memories) {
      try {
        // 检查是否已存在（基于内容相似度）
        const existing = await this.findSimilar(memory.content, 0.95);

        if (existing.length > 0) {
          skipped++;
          continue;
        }

        // 导入
        await this.add(memory);
        imported++;
      } catch (err) {
        console.error(`Failed to import memory:`, err);
        skipped++;
      }
    }

    return { imported, skipped };
  }

  /**
   * 查找相似记忆（用于去重）
   */
  async findSimilar(content: string, threshold: number = 0.9): Promise<UnifiedMemory[]> {
    if (!this.vectorStore || !this.embedding) {
      throw new Error('Store not initialized');
    }

    const embedding = await this.embedding.embed(content);
    const results = await this.vectorStore.search(embedding, 5);

    const similar: UnifiedMemory[] = [];

    for (const result of results) {
      if (result.score >= threshold) {
        const memory = await this.get(result.id);
        if (memory) {
          similar.push(memory);
        }
      }
    }

    return similar;
  }

  /**
   * 数据库行转换为 Memory 对象
   */
  private rowToMemory(row: any): UnifiedMemory {
    return {
      id: row.id,
      type: row.type,
      content: row.content,
      metadata: JSON.parse(row.metadata),
      quality: JSON.parse(row.quality),
      provenance: JSON.parse(row.provenance),
      hidden: row.hidden === 1,
      obsolete: row.obsolete === 1,
      needsReview: row.needs_review === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * 关闭数据库
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
