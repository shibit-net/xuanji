// ============================================================
// 数据迁移：添加决策点记忆系统字段
// ============================================================

import type { Database } from 'better-sqlite3';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'Migration001' });

/**
 * 迁移：添加决策点记忆系统和做梦机制字段
 */
export async function migrate001(db: Database): Promise<void> {
  log.info('开始迁移：添加决策点记忆系统字段');

  // 检查是否已迁移
  const columns = db.pragma('table_info(memories)') as Array<{ name: string }>;
  const columnNames = columns.map(c => c.name);

  if (columnNames.includes('usage_scenarios')) {
    log.info('迁移已完成，跳过');
    return;
  }

  // 开始事务
  const transaction = db.transaction(() => {
    // 1. 添加决策点记忆系统字段
    log.info('添加决策点记忆系统字段...');

    db.exec(`
      -- 使用场景标签（JSON数组）
      ALTER TABLE memories ADD COLUMN usage_scenarios TEXT DEFAULT '[]';

      -- 约束级别
      ALTER TABLE memories ADD COLUMN constraint_level TEXT DEFAULT 'may';

      -- 使用统计
      ALTER TABLE memories ADD COLUMN usage_count INTEGER DEFAULT 0;
      ALTER TABLE memories ADD COLUMN last_used INTEGER;
      ALTER TABLE memories ADD COLUMN effective_count INTEGER DEFAULT 0;

      -- 记忆来源（v2，避免与现有source字段冲突）
      ALTER TABLE memories ADD COLUMN memory_origin_v2 TEXT DEFAULT 'agent';

      -- 关联记忆（JSON数组）
      ALTER TABLE memories ADD COLUMN related_memories TEXT DEFAULT '[]';
    `);

    // 2. 添加做梦机制字段
    log.info('添加做梦机制字段...');

    db.exec(`
      -- 做梦代数
      ALTER TABLE memories ADD COLUMN dream_generation INTEGER DEFAULT 0;

      -- 支持证据数量
      ALTER TABLE memories ADD COLUMN evidence_count INTEGER DEFAULT 1;

      -- 最后复审时间
      ALTER TABLE memories ADD COLUMN last_reviewed INTEGER;

      -- 最后做梦处理时间
      ALTER TABLE memories ADD COLUMN last_dreamed INTEGER;

      -- 做梦处理次数
      ALTER TABLE memories ADD COLUMN dream_count INTEGER DEFAULT 0;
    `);

    // 3. 添加软删除字段
    log.info('添加软删除字段...');

    db.exec(`
      -- 删除时间戳
      ALTER TABLE memories ADD COLUMN deleted_at INTEGER;

      -- 删除原因
      ALTER TABLE memories ADD COLUMN delete_reason TEXT;
    `);

    // 4. 创建新索引
    log.info('创建新索引...');

    db.exec(`
      -- 约束级别索引
      CREATE INDEX IF NOT EXISTS idx_mem_constraint ON memories(constraint_level);

      -- 记忆来源索引
      CREATE INDEX IF NOT EXISTS idx_mem_origin_v2 ON memories(memory_origin_v2);

      -- 做梦代数索引
      CREATE INDEX IF NOT EXISTS idx_mem_dream_gen ON memories(dream_generation);

      -- 最后使用时间索引
      CREATE INDEX IF NOT EXISTS idx_mem_last_used ON memories(last_used DESC);

      -- 软删除索引
      CREATE INDEX IF NOT EXISTS idx_mem_deleted ON memories(deleted_at);

      -- 做梦处理时间索引
      CREATE INDEX IF NOT EXISTS idx_mem_last_dreamed ON memories(last_dreamed);

      -- 复合索引：约束级别 + 使用场景
      CREATE INDEX IF NOT EXISTS idx_mem_constraint_scenarios
        ON memories(constraint_level, usage_scenarios);

      -- 部分索引：只索引活跃记忆（未删除且最近使用）
      CREATE INDEX IF NOT EXISTS idx_mem_active
        ON memories(last_used DESC, effective_count DESC)
        WHERE deleted_at IS NULL;
    `);

    // 5. 迁移现有数据的默认值
    log.info('迁移现有数据...');

    db.exec(`
      -- 为现有记忆设置合理的默认值
      UPDATE memories
      SET
        usage_scenarios = '[]',
        constraint_level = CASE
          WHEN type IN ('user_preference', 'important_date') THEN 'must'
          WHEN type IN ('decision', 'tool_pattern') THEN 'should'
          ELSE 'may'
        END,
        usage_count = access_count,
        last_used = CAST(strftime('%s', last_accessed_at) * 1000 AS INTEGER),
        effective_count = CAST(access_count * 0.7 AS INTEGER),
        memory_origin_v2 = CASE
          WHEN source = 'user' THEN 'user'
          ELSE 'agent'
        END,
        related_memories = '[]',
        dream_generation = 0,
        evidence_count = 1,
        dream_count = 0
      WHERE usage_scenarios IS NULL;
    `);

    log.info('迁移完成');
  });

  // 执行事务
  transaction();

  // 6. 验证迁移
  const newColumns = db.pragma('table_info(memories)') as Array<{ name: string }>;
  const newColumnNames = newColumns.map(c => c.name);

  const requiredColumns = [
    'usage_scenarios',
    'constraint_level',
    'usage_count',
    'last_used',
    'effective_count',
    'memory_origin_v2',
    'related_memories',
    'dream_generation',
    'evidence_count',
    'last_reviewed',
    'last_dreamed',
    'dream_count',
    'deleted_at',
    'delete_reason'
  ];

  const missingColumns = requiredColumns.filter(col => !newColumnNames.includes(col));

  if (missingColumns.length > 0) {
    throw new Error(`迁移失败：缺少字段 ${missingColumns.join(', ')}`);
  }

  log.info('迁移验证通过');
}
