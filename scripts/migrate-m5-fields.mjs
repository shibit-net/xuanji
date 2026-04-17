#!/usr/bin/env node
// ============================================================
// M5 字段迁移脚本
// ============================================================
// 手动执行：node scripts/migrate-m5-fields.mjs

import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

const dbPath = join(homedir(), '.xuanji', 'memory.db');
console.log(`数据库路径: ${dbPath}`);

const db = new Database(dbPath);

// 1. 检查表结构
console.log('\n=== 检查表结构 ===');
const columns = db.prepare('PRAGMA table_info(memories)').all();
const columnNames = new Set(columns.map(c => c.name));

const m5Fields = ['scope', 'volatility', 'significance', 'category_label'];
const missingFields = m5Fields.filter(f => !columnNames.has(f));

if (missingFields.length === 0) {
  console.log('✓ M5 字段已存在，无需迁移');
  db.close();
  process.exit(0);
}

console.log(`需要添加的字段: ${missingFields.join(', ')}`);

// 2. 添加字段
console.log('\n=== 添加 M5 字段 ===');
for (const field of missingFields) {
  const type = field === 'significance' ? 'REAL' : 'TEXT';
  db.exec(`ALTER TABLE memories ADD COLUMN ${field} ${type}`);
  console.log(`✓ 添加字段: ${field}`);
}

// 3. 添加索引
if (missingFields.includes('scope')) {
  db.exec('CREATE INDEX IF NOT EXISTS idx_mem_scope ON memories(scope)');
  console.log('✓ 添加索引: idx_mem_scope');
}
if (missingFields.includes('volatility')) {
  db.exec('CREATE INDEX IF NOT EXISTS idx_mem_volatility ON memories(volatility)');
  console.log('✓ 添加索引: idx_mem_volatility');
}

// 4. 为现有记忆填充 M5 字段
console.log('\n=== 填充 M5 字段 ===');

// 类型到 M5 属性的映射
const typeToM5 = {
  // profile 层
  'user_fact': { scope: 'profile', volatility: 'stable', significance: 0.8, categoryLabel: '用户/基本信息' },
  'user_preference': { scope: 'profile', volatility: 'stable', significance: 0.8, categoryLabel: '用户/偏好习惯' },
  'relationship': { scope: 'profile', volatility: 'stable', significance: 0.8, categoryLabel: '用户/人际关系' },
  'important_date': { scope: 'profile', volatility: 'stable', significance: 0.7, categoryLabel: '用户/重要日期' },

  // knowledge 层
  'decision': { scope: 'knowledge', volatility: 'normal', significance: 0.7, categoryLabel: '项目/决策记录' },
  'error_resolution': { scope: 'knowledge', volatility: 'normal', significance: 0.6, categoryLabel: '经验/错误解决' },
  'tool_pattern': { scope: 'knowledge', volatility: 'normal', significance: 0.6, categoryLabel: '经验/工具模式' },
  'lesson_learned': { scope: 'knowledge', volatility: 'normal', significance: 0.6, categoryLabel: '经验/知识库' },
  'reusable_pattern': { scope: 'knowledge', volatility: 'normal', significance: 0.6, categoryLabel: '经验/知识库' },
  'domain_knowledge': { scope: 'knowledge', volatility: 'normal', significance: 0.6, categoryLabel: '经验/知识库' },
  'agent_knowledge': { scope: 'knowledge', volatility: 'normal', significance: 0.6, categoryLabel: '经验/知识库' },

  // episode 层
  'session_summary': { scope: 'episode', volatility: 'transient', significance: 0.3, categoryLabel: '会话/摘要' },
  'project_fact': { scope: 'episode', volatility: 'normal', significance: 0.5, categoryLabel: '项目/事实' },
  'unfinished_task': { scope: 'episode', volatility: 'transient', significance: 0.6, categoryLabel: '任务/待办' },
};

const rows = db.prepare('SELECT id, type, metadata FROM memories WHERE scope IS NULL').all();
console.log(`需要迁移的记忆数量: ${rows.length}`);

const updateStmt = db.prepare(`
  UPDATE memories
  SET scope = ?, volatility = ?, significance = ?, category_label = ?
  WHERE id = ?
`);

let migrated = 0;
const transaction = db.transaction(() => {
  for (const row of rows) {
    let m5 = typeToM5[row.type];

    // 如果类型映射不存在，尝试从 metadata 读取
    if (!m5) {
      try {
        const metadata = JSON.parse(row.metadata || '{}');
        if (metadata.scope && metadata.volatility && metadata.significance && metadata.categoryLabel) {
          m5 = {
            scope: metadata.scope,
            volatility: metadata.volatility,
            significance: metadata.significance,
            categoryLabel: metadata.categoryLabel,
          };
        }
      } catch {}
    }

    // 如果还是没有，使用默认值
    if (!m5) {
      m5 = { scope: 'episode', volatility: 'transient', significance: 0.5, categoryLabel: '其他' };
    }

    updateStmt.run(m5.scope, m5.volatility, m5.significance, m5.categoryLabel, row.id);
    migrated++;
  }
});

transaction();
console.log(`✓ 成功迁移 ${migrated} 条记忆`);

// 5. 验证
console.log('\n=== 验证迁移结果 ===');
const stats = db.prepare(`
  SELECT scope, COUNT(*) as count
  FROM memories
  GROUP BY scope
  ORDER BY count DESC
`).all();

console.log('按 scope 统计:');
for (const stat of stats) {
  console.log(`  ${stat.scope || 'NULL'}: ${stat.count}`);
}

db.close();
console.log('\n✓ M5 字段迁移完成');
