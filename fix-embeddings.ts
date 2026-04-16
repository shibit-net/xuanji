#!/usr/bin/env tsx
// 修复脚本：为缺失向量的记忆生成 embedding

import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const dbPath = join(homedir(), '.xuanji', 'memory.db');

async function main() {
  console.log('🔧 开始修复向量嵌入...\n');

  const db = new Database(dbPath);

  // 统计
  const total = (db.prepare('SELECT COUNT(*) as count FROM memories').get() as any).count;
  const withVector = (db.prepare('SELECT COUNT(*) as count FROM memory_vectors').get() as any).count;
  const missing = total - withVector;

  console.log(`📊 统计信息:`);
  console.log(`   总记忆数: ${total}`);
  console.log(`   有向量的: ${withVector} (${((withVector / total) * 100).toFixed(1)}%)`);
  console.log(`   缺失向量: ${missing} (${((missing / total) * 100).toFixed(1)}%)\n`);

  if (missing === 0) {
    console.log('✅ 所有记忆都已有向量，无需修复');
    db.close();
    return;
  }

  // 获取缺失向量的记忆
  const memoriesWithoutVector = db.prepare(`
    SELECT id, type, content
    FROM memories
    WHERE id NOT IN (SELECT memory_id FROM memory_vectors)
    LIMIT 10
  `).all() as Array<{ id: string; type: string; content: string }>;

  console.log(`🔍 缺失向量的记忆示例（前10条）:\n`);
  for (const mem of memoriesWithoutVector) {
    console.log(`   [${mem.type}] ${mem.content.slice(0, 60)}...`);
  }

  console.log('\n⚠️  需要运行 EmbeddingService 来生成向量');
  console.log('💡 建议：重启 xuanji，向量系统会自动为新记忆生成 embedding');
  console.log('📝 或者：修复 MemoryManager.embedEntriesAsync 的逻辑\n');

  db.close();
}

main().catch(console.error);
