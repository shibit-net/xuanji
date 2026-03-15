// ============================================================
// 经验教训存储（Lesson Store）
// ============================================================
// 职责：
// - 存储所有类型的经验教训（成功/失败/最佳实践/陷阱/优化）
// - 支持向量语义检索（找到相似情况的经验）
// - 管理应用规则（何时应用这些经验）
// - 跟踪应用效果（这个经验是否真的有用）
// ============================================================

import Database from 'better-sqlite3';
import path from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import { EmbeddingService } from '../embedding/EmbeddingService.js';
import type {
  LessonEvent,
  LessonType,
  LessonDomain,
  LessonAnalysis,
  CoreLesson,
  ApplicationRule,
} from './types.js';

// ============================================================
// 搜索选项
// ============================================================

export interface LessonSearchOptions {
  query?: string;               // 语义搜索查询
  type?: LessonType | LessonType[];
  domain?: LessonDomain | LessonDomain[];
  minConfidence?: number;       // 最小置信度
  onlyVerified?: boolean;       // 只返回已验证的
  excludeObsolete?: boolean;    // 排除过时的
  timeRange?: {
    start?: number;
    end?: number;
  };
  limit?: number;
  offset?: number;
}

// ============================================================
// 统计信息
// ============================================================

export interface LessonStats {
  total: number;
  byType: Record<LessonType, number>;
  byDomain: Record<LessonDomain, number>;
  verified: number;
  applied: number;
  averageSuccessRate: number;
}

// ============================================================
// LessonStore 类
// ============================================================

export class LessonStore {
  private db: Database.Database | null = null;
  private embedding: EmbeddingService | null = null;
  private dbPath: string;
  private vecAvailable = false;

  constructor(dataDir?: string) {
    const baseDir = dataDir || path.join(homedir(), '.xuanji');
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }
    this.dbPath = path.join(baseDir, 'lessons.db');
  }

  /**
   * 初始化存储
   */
  async init(): Promise<void> {
    // 1. 初始化 SQLite 数据库
    this.db = new Database(this.dbPath);

    // 启用 WAL 模式提升并发性能
    this.db.pragma('journal_mode = WAL');

    // 加载 sqlite-vec 扩展
    try {
      const sqliteVec = await import('sqlite-vec');
      sqliteVec.load(this.db);
      this.vecAvailable = true;
      console.log('[LessonStore] sqlite-vec extension loaded');
    } catch (err) {
      this.vecAvailable = false;
      console.warn('[LessonStore] sqlite-vec not available, vector search disabled:', err);
    }

    // 2. 创建表结构
    this.createTables();

    // 3. 初始化 Embedding 服务
    this.embedding = EmbeddingService.getInstance();
    await this.embedding.init();

    console.log(`[LessonStore] Initialized at ${this.dbPath}`);
  }

  /**
   * 创建数据库表
   */
  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    // 经验教训主表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        domain TEXT NOT NULL,
        experience TEXT NOT NULL,
        context TEXT NOT NULL,
        analysis TEXT,
        lesson TEXT,
        application_rule TEXT,
        verification TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_type ON lessons(type);
      CREATE INDEX IF NOT EXISTS idx_domain ON lessons(domain);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON lessons(timestamp);
    `);

    // 向量索引表（如果 sqlite-vec 可用）
    if (this.vecAvailable) {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_lessons USING vec0(
          lesson_id TEXT PRIMARY KEY,
          embedding FLOAT[384]
        );
      `);
    }

    // 应用规则表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS application_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        trigger TEXT NOT NULL,
        application TEXT NOT NULL,
        message TEXT NOT NULL,
        auto_apply TEXT,
        learned_from TEXT NOT NULL,
        metrics TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        version INTEGER DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_rule_type ON application_rules(rule_type);
      CREATE INDEX IF NOT EXISTS idx_learned_from ON application_rules(learned_from);
    `);
  }

  /**
   * 添加经验教训
   */
  async add(lesson: Omit<LessonEvent, 'id' | 'timestamp'>): Promise<string> {
    if (!this.db || !this.embedding) {
      throw new Error('Store not initialized');
    }

    const now = Date.now();
    const id = `lesson-${now}-${Math.random().toString(36).slice(2, 9)}`;

    const fullLesson: LessonEvent = {
      ...lesson,
      id,
      timestamp: now,
    };

    // 1. 生成 embedding（基于标题 + 描述 + 核心教训）
    const textForEmbedding = [
      fullLesson.experience.title,
      fullLesson.experience.description,
      fullLesson.lesson?.summary || '',
      fullLesson.lesson?.keyTakeaway || '',
    ].join(' ');

    const embedding = await this.embedding.embed(textForEmbedding);

    // 2. 保存到主表
    const stmt = this.db.prepare(`
      INSERT INTO lessons (
        id, timestamp, type, domain, experience, context,
        analysis, lesson, application_rule, verification,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      fullLesson.timestamp,
      fullLesson.type,
      fullLesson.domain,
      JSON.stringify(fullLesson.experience),
      JSON.stringify(fullLesson.context),
      fullLesson.analysis ? JSON.stringify(fullLesson.analysis) : null,
      fullLesson.lesson ? JSON.stringify(fullLesson.lesson) : null,
      fullLesson.applicationRule ? JSON.stringify(fullLesson.applicationRule) : null,
      JSON.stringify(fullLesson.verification),
      now,
      now
    );

    // 3. 添加到向量索引
    if (this.vecAvailable) {
      const embeddingBuf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
      const insertVec = this.db.prepare(`
        INSERT INTO vec_lessons (lesson_id, embedding)
        VALUES (?, ?)
      `);
      insertVec.run(id, embeddingBuf);
    }

    // 4. 如果有应用规则，保存到应用规则表
    if (fullLesson.applicationRule) {
      await this.saveApplicationRule(fullLesson.applicationRule);
    }

    return id;
  }

  /**
   * 保存应用规则
   */
  private async saveApplicationRule(rule: ApplicationRule): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO application_rules (
        id, name, description, rule_type, trigger, application,
        message, auto_apply, learned_from, metrics,
        created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      rule.id,
      rule.name,
      rule.description,
      rule.ruleType,
      JSON.stringify(rule.trigger),
      JSON.stringify(rule.application),
      rule.message,
      rule.autoApply ? JSON.stringify(rule.autoApply) : null,
      rule.learnedFrom,
      JSON.stringify(rule.metrics),
      rule.createdAt,
      rule.updatedAt,
      rule.version
    );
  }

  /**
   * 获取单条经验
   */
  async get(id: string): Promise<LessonEvent | null> {
    if (!this.db) throw new Error('Store not initialized');

    const stmt = this.db.prepare('SELECT * FROM lessons WHERE id = ?');
    const row = stmt.get(id) as any;

    if (!row) return null;

    return this.rowToLesson(row);
  }

  /**
   * 更新经验
   */
  async update(id: string, updates: Partial<LessonEvent>): Promise<void> {
    if (!this.db || !this.embedding) {
      throw new Error('Store not initialized');
    }

    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Lesson not found: ${id}`);
    }

    const updated: LessonEvent = {
      ...existing,
      ...updates,
      id, // 不允许修改 ID
    };

    // 如果核心内容变更，重新生成 embedding
    if (
      updates.experience?.title ||
      updates.experience?.description ||
      updates.lesson
    ) {
      const textForEmbedding = [
        updated.experience.title,
        updated.experience.description,
        updated.lesson?.summary || '',
        updated.lesson?.keyTakeaway || '',
      ].join(' ');

      const embedding = await this.embedding.embed(textForEmbedding);

      // 更新向量索引
      if (this.vecAvailable) {
        const embeddingBuf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
        const updateVec = this.db.prepare(`
          UPDATE vec_lessons
          SET embedding = ?
          WHERE lesson_id = ?
        `);
        updateVec.run(embeddingBuf, id);
      }
    }

    // 更新主表
    const stmt = this.db.prepare(`
      UPDATE lessons
      SET type = ?, domain = ?, experience = ?, context = ?,
          analysis = ?, lesson = ?, application_rule = ?, verification = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(
      updated.type,
      updated.domain,
      JSON.stringify(updated.experience),
      JSON.stringify(updated.context),
      updated.analysis ? JSON.stringify(updated.analysis) : null,
      updated.lesson ? JSON.stringify(updated.lesson) : null,
      updated.applicationRule ? JSON.stringify(updated.applicationRule) : null,
      JSON.stringify(updated.verification),
      Date.now(),
      id
    );

    // 更新应用规则
    if (updated.applicationRule) {
      await this.saveApplicationRule(updated.applicationRule);
    }
  }

  /**
   * 删除经验
   */
  async delete(id: string): Promise<void> {
    if (!this.db) {
      throw new Error('Store not initialized');
    }

    // 1. 删除应用规则
    const lesson = await this.get(id);
    if (lesson?.applicationRule) {
      const deleteRuleStmt = this.db.prepare('DELETE FROM application_rules WHERE id = ?');
      deleteRuleStmt.run(lesson.applicationRule.id);
    }

    // 2. 从主表删除
    const stmt = this.db.prepare('DELETE FROM lessons WHERE id = ?');
    stmt.run(id);

    // 3. 从向量索引删除
    if (this.vecAvailable) {
      const deleteVec = this.db.prepare('DELETE FROM vec_lessons WHERE lesson_id = ?');
      deleteVec.run(id);
    }
  }

  /**
   * 搜索经验（支持语义搜索 + 过滤）
   */
  async search(options: LessonSearchOptions = {}): Promise<LessonEvent[]> {
    if (!this.db || !this.embedding) {
      throw new Error('Store not initialized');
    }

    let lessons: LessonEvent[] = [];

    // [1] 语义搜索
    if (options.query && this.vecAvailable) {
      const queryEmbedding = await this.embedding.embed(options.query);
      const embeddingBuf = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);

      const searchStmt = this.db.prepare(`
        SELECT lesson_id, distance
        FROM vec_lessons
        WHERE embedding MATCH ?
        ORDER BY distance
        LIMIT ?
      `);

      const results = searchStmt.all(embeddingBuf, options.limit || 50) as Array<{ lesson_id: string; distance: number }>;

      // 获取完整数据
      for (const result of results) {
        const lesson = await this.get(result.lesson_id);
        if (lesson) {
          lessons.push(lesson);
        }
      }
    } else {
      // [2] 数据库查询
      let sql = 'SELECT * FROM lessons WHERE 1=1';
      const params: any[] = [];

      if (options.type) {
        const types = Array.isArray(options.type) ? options.type : [options.type];
        sql += ` AND type IN (${types.map(() => '?').join(',')})`;
        params.push(...types);
      }

      if (options.domain) {
        const domains = Array.isArray(options.domain) ? options.domain : [options.domain];
        sql += ` AND domain IN (${domains.map(() => '?').join(',')})`;
        params.push(...domains);
      }

      if (options.timeRange) {
        if (options.timeRange.start) {
          sql += ' AND timestamp >= ?';
          params.push(options.timeRange.start);
        }
        if (options.timeRange.end) {
          sql += ' AND timestamp <= ?';
          params.push(options.timeRange.end);
        }
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

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as any[];

      lessons = rows.map(row => this.rowToLesson(row));
    }

    // [3] 应用过滤
    return this.applyFilters(lessons, options);
  }

  /**
   * 应用过滤条件
   */
  private applyFilters(lessons: LessonEvent[], options: LessonSearchOptions): LessonEvent[] {
    return lessons.filter(lesson => {
      // 最小置信度
      if (options.minConfidence !== undefined) {
        if (!lesson.analysis || lesson.analysis.confidence < options.minConfidence) {
          return false;
        }
      }

      // 只返回已验证的
      if (options.onlyVerified && !lesson.verification.verified) {
        return false;
      }

      return true;
    });
  }

  /**
   * 查找相似经验（用于去重和参考）
   */
  async findSimilar(
    query: string,
    threshold: number = 0.85,
    limit: number = 5
  ): Promise<Array<LessonEvent & { similarity: number }>> {
    if (!this.embedding || !this.db || !this.vecAvailable) {
      return [];
    }

    const queryEmbedding = await this.embedding.embed(query);
    const embeddingBuf = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);

    const searchStmt = this.db.prepare(`
      SELECT lesson_id, distance
      FROM vec_lessons
      WHERE embedding MATCH ?
      ORDER BY distance
      LIMIT ?
    `);

    const results = searchStmt.all(embeddingBuf, limit) as Array<{ lesson_id: string; distance: number }>;

    const similar: Array<LessonEvent & { similarity: number }> = [];

    for (const result of results) {
      const similarity = 1 - result.distance; // 将距离转换为相似度
      if (similarity >= threshold) {
        const lesson = await this.get(result.lesson_id);
        if (lesson) {
          similar.push({
            ...lesson,
            similarity,
          });
        }
      }
    }

    return similar;
  }

  /**
   * 获取所有应用规则
   */
  async getAllRules(): Promise<ApplicationRule[]> {
    if (!this.db) throw new Error('Store not initialized');

    const stmt = this.db.prepare('SELECT * FROM application_rules ORDER BY updated_at DESC');
    const rows = stmt.all() as any[];

    return rows.map(row => this.rowToRule(row));
  }

  /**
   * 根据触发条件查找适用的规则
   */
  async findApplicableRules(context: {
    task?: string;
    toolName?: string;
    domain?: LessonDomain;
  }): Promise<ApplicationRule[]> {
    const allRules = await this.getAllRules();

    return allRules.filter(rule => {
      // 检查工具名称匹配
      if (context.toolName && rule.trigger.toolName) {
        if (rule.trigger.toolName !== context.toolName) {
          return false;
        }
      }

      // 检查领域匹配
      if (context.domain && rule.trigger.domain) {
        if (rule.trigger.domain !== context.domain) {
          return false;
        }
      }

      // 检查任务模式匹配
      if (context.task && rule.trigger.taskPattern) {
        if (!rule.trigger.taskPattern.test(context.task)) {
          return false;
        }
      }

      // 检查上下文关键词
      if (context.task && rule.trigger.contextMatch && rule.trigger.contextMatch.length > 0) {
        const hasMatch = rule.trigger.contextMatch.some(keyword =>
          context.task!.toLowerCase().includes(keyword.toLowerCase())
        );
        if (!hasMatch) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * 更新规则指标
   */
  async updateRuleMetrics(
    ruleId: string,
    metric: 'triggeredCount' | 'appliedCount' | 'successCount' | 'failureCount',
    increment: number = 1
  ): Promise<void> {
    if (!this.db) throw new Error('Store not initialized');

    const stmt = this.db.prepare('SELECT metrics FROM application_rules WHERE id = ?');
    const row = stmt.get(ruleId) as any;

    if (!row) return;

    const metrics = JSON.parse(row.metrics);
    metrics[metric] += increment;

    const updateStmt = this.db.prepare(
      'UPDATE application_rules SET metrics = ?, updated_at = ? WHERE id = ?'
    );
    updateStmt.run(JSON.stringify(metrics), Date.now(), ruleId);
  }

  /**
   * 获取统计信息
   */
  async getStats(): Promise<LessonStats> {
    if (!this.db) throw new Error('Store not initialized');

    const stats: LessonStats = {
      total: 0,
      byType: {
        success: 0,
        failure: 0,
        best_practice: 0,
        pitfall: 0,
        optimization: 0,
      },
      byDomain: {
        coding: 0,
        debugging: 0,
        tool_usage: 0,
        communication: 0,
        decision_making: 0,
        workflow: 0,
      },
      verified: 0,
      applied: 0,
      averageSuccessRate: 0,
    };

    // 总数
    const total = this.db.prepare('SELECT COUNT(*) as count FROM lessons').get() as any;
    stats.total = total.count;

    // 按类型
    const byType = this.db.prepare(`
      SELECT type, COUNT(*) as count
      FROM lessons
      GROUP BY type
    `).all() as any[];

    for (const row of byType) {
      stats.byType[row.type as LessonType] = row.count;
    }

    // 按领域
    const byDomain = this.db.prepare(`
      SELECT domain, COUNT(*) as count
      FROM lessons
      GROUP BY domain
    `).all() as any[];

    for (const row of byDomain) {
      stats.byDomain[row.domain as LessonDomain] = row.count;
    }

    // 已验证数量
    const allLessons = await this.search({ limit: 10000 });
    stats.verified = allLessons.filter(l => l.verification.verified).length;
    stats.applied = allLessons.filter(l => l.verification.applied).length;

    // 平均成功率
    const withApplications = allLessons.filter(l => l.verification.applicationCount > 0);
    if (withApplications.length > 0) {
      const totalSuccessRate = withApplications.reduce((sum, l) => {
        return sum + (l.verification.successCount / l.verification.applicationCount);
      }, 0);
      stats.averageSuccessRate = totalSuccessRate / withApplications.length;
    }

    return stats;
  }

  /**
   * 数据库行转换为 LessonEvent
   */
  private rowToLesson(row: any): LessonEvent {
    return {
      id: row.id,
      timestamp: row.timestamp,
      type: row.type,
      domain: row.domain,
      experience: JSON.parse(row.experience),
      context: JSON.parse(row.context),
      analysis: row.analysis ? JSON.parse(row.analysis) : undefined,
      lesson: row.lesson ? JSON.parse(row.lesson) : undefined,
      applicationRule: row.application_rule ? JSON.parse(row.application_rule) : undefined,
      verification: JSON.parse(row.verification),
    };
  }

  /**
   * 数据库行转换为 ApplicationRule
   */
  private rowToRule(row: any): ApplicationRule {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      ruleType: row.rule_type,
      trigger: JSON.parse(row.trigger),
      application: JSON.parse(row.application),
      message: row.message,
      autoApply: row.auto_apply ? JSON.parse(row.auto_apply) : undefined,
      learnedFrom: row.learned_from,
      metrics: JSON.parse(row.metrics),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
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
