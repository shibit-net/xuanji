// ============================================================
// M5FieldsMigration — 为现有记忆添加 M5 字段
// ============================================================
// 职责：
// - 检测数据库表是否有 M5 字段（scope/volatility/significance/category_label）
// - 如果没有，执行 ALTER TABLE 添加字段
// - 为所有现有记忆推断并填充 M5 字段值

import type { MemoryStore } from '../MemoryStore.js';
import { inferMemoryAttributes } from '../MemoryAttributeInferrer.js';
import type { MemoryEntryType } from '../types.js';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'M5FieldsMigration' });

export class M5FieldsMigration {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * 执行迁移
   * 1. 检查表结构，添加缺失的 M5 字段
   * 2. 为所有现有记忆推断并填充 M5 字段
   */
  async run(): Promise<void> {
    log.info('Starting M5 fields migration...');

    const db = (this.store as any).db;
    if (!db) {
      log.warn('Database not initialized, skipping M5 migration');
      return;
    }

    // 1. 检查并添加字段
    const needsMigration = this.checkAndAddFields(db);
    if (!needsMigration) {
      log.info('M5 fields already exist, skipping migration');
      return;
    }

    // 2. 为现有记忆填充 M5 字段
    await this.fillM5Fields(db);

    log.info('M5 fields migration completed successfully');
  }

  /**
   * 检查表结构，添加缺失的 M5 字段
   * @returns true 如果需要迁移数据
   */
  private checkAndAddFields(db: any): boolean {
    try {
      // 检查表结构
      const columns = db.prepare('PRAGMA table_info(memories)').all() as Array<{ name: string }>;
      const columnNames = new Set(columns.map((c) => c.name));

      const m5Fields = ['scope', 'volatility', 'significance', 'category_label'];
      const missingFields = m5Fields.filter((f) => !columnNames.has(f));

      if (missingFields.length === 0) {
        return false; // 字段已存在
      }

      log.info(`Adding missing M5 fields: ${missingFields.join(', ')}`);

      // 添加缺失字段
      for (const field of missingFields) {
        const type = field === 'significance' ? 'REAL' : 'TEXT';
        db.exec(`ALTER TABLE memories ADD COLUMN ${field} ${type}`);
        log.debug(`Added column: ${field}`);
      }

      // 添加索引
      if (missingFields.includes('scope')) {
        db.exec('CREATE INDEX IF NOT EXISTS idx_mem_scope ON memories(scope)');
      }
      if (missingFields.includes('volatility')) {
        db.exec('CREATE INDEX IF NOT EXISTS idx_mem_volatility ON memories(volatility)');
      }

      return true; // 需要迁移数据
    } catch (err) {
      log.error('Failed to add M5 fields:', err);
      throw err;
    }
  }

  /**
   * 为所有现有记忆推断并填充 M5 字段
   */
  private async fillM5Fields(db: any): Promise<void> {
    try {
      // 查询所有没有 M5 字段的记忆
      const rows = db.prepare(`
        SELECT id, type, metadata
        FROM memories
        WHERE scope IS NULL OR volatility IS NULL OR significance IS NULL OR category_label IS NULL
      `).all() as Array<{ id: string; type: string; metadata: string }>;

      if (rows.length === 0) {
        log.info('No memories need M5 field migration');
        return;
      }

      log.info(`Migrating M5 fields for ${rows.length} memories...`);

      const updateStmt = db.prepare(`
        UPDATE memories
        SET scope = ?, volatility = ?, significance = ?, category_label = ?
        WHERE id = ?
      `);

      const transaction = db.transaction(() => {
        for (const row of rows) {
          // 优先从 metadata 中读取（如果之前存储过）
          let scope: string | undefined;
          let volatility: string | undefined;
          let significance: number | undefined;
          let categoryLabel: string | undefined;

          try {
            const metadata = JSON.parse(row.metadata || '{}');
            scope = metadata.scope;
            volatility = metadata.volatility;
            significance = metadata.significance;
            categoryLabel = metadata.categoryLabel;
          } catch {
            // metadata 解析失败，使用推断
          }

          // 如果 metadata 中没有，则根据 type 推断
          if (!scope || !volatility || !significance || !categoryLabel) {
            const inferred = inferMemoryAttributes(row.type as MemoryEntryType);
            scope = scope ?? inferred.scope;
            volatility = volatility ?? inferred.volatility;
            significance = significance ?? inferred.significance;
            categoryLabel = categoryLabel ?? inferred.categoryLabel;
          }

          updateStmt.run(scope, volatility, significance, categoryLabel, row.id);
        }
      });

      transaction();
      log.info(`Successfully migrated M5 fields for ${rows.length} memories`);
    } catch (err) {
      log.error('Failed to fill M5 fields:', err);
      throw err;
    }
  }
}
