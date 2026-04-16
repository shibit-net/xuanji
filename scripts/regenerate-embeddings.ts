#!/usr/bin/env tsx
/**
 * 批量为缺失向量的记忆生成 embedding
 * 
 * 用法: tsx scripts/regenerate-embeddings.ts [--limit N] [--dry-run]
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { EmbeddingService } from '../src/embedding/EmbeddingService';

const dbPath = join(homedir(), '.xuanji', 'memory.db');

interface MemoryRow {
  id: string;
  type: string;
  content: string;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? parseInt(args[limitIndex + 1], 10) : undefined;

  console.log('🔧 批量生成向量嵌入\n');

  const db = new Database(dbPath);

  // 统计
  const total = (db.prepare('SELECT COUNT(*) as count FROM memories').get() as any).count;
  const withVector = (db.prepare('SELECT COUNT(*) as count FROM memory_vectors').get() as any).count;
  const missing = total - withVector;

  console.log(`📊 当前状态:`);
  console.log(`   总记忆数: ${total}`);
  console.log(`   有向量的: ${withVector} (${((withVector / total) * 100).toFixed(1)}%)`);
  console.log(`   缺失向量: ${missing} (${((missing / total) * 100).toFixed(1)}%)\n`);

  if (missing === 0) {
    console.log('✅ 所有记忆都已有向量，无需修复');
    db.close();
    return;
  }

  // 获取缺失向量的记忆
  const query = `
    SELECT id, type, content
    FROM memories
    WHERE id NOT IN (SELECT memory_id FROM memory_vectors)
    ${limit ? `LIMIT ${limit}` : ''}
  `;
  
  const memories = db.prepare(query).all() as MemoryRow[];
  
  console.log(`🎯 将处理 ${memories.length} 条记忆${dryRun ? ' (dry-run 模式)' : ''}\n`);

  if (dryRun) {
    console.log('📋 预览（前 10 条）:');
    for (const mem of memories.slice(0, 10)) {
      console.log(`   [${mem.type}] ${mem.content.slice(0, 60)}...`);
    }
    db.close();
    return;
  }

  // 初始化 EmbeddingService
  console.log('⏳ 初始化 Embedding 模型...');
  const embeddingService = EmbeddingService.getInstance();
  
  try {
    await embeddingService.init();
    console.log('✅ Embedding 模型已加载\n');
  } catch (err) {
    console.error('❌ 无法加载 Embedding 模型:', err);
    db.close();
    process.exit(1);
  }

  // 批量生成向量
  console.log('🚀 开始生成向量...\n');
  
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO memory_vectors (memory_id, embedding, updated_at)
    VALUES (?, ?, ?)
  `);

  let success = 0;
  let failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < memories.length; i++) {
    const mem = memories[i];
    
    try {
      const embedding = await embeddingService.embed(mem.content);
      const embeddingBuf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
      const now = new Date().toISOString();
      
      insertStmt.run(mem.id, embeddingBuf, now);
      success++;
      
      if ((i + 1) % 50 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = ((i + 1) / (Date.now() - startTime) * 1000).toFixed(1);
        console.log(`   进度: ${i + 1}/${memories.length} (${rate} 条/秒, 已用时 ${elapsed}s)`);
      }
    } catch (err) {
      failed++;
      console.error(`   ❌ 失败: ${mem.id} - ${err}`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgRate = (success / (Date.now() - startTime) * 1000).toFixed(1);

  console.log(`\n✅ 完成！`);
  console.log(`   成功: ${success} 条`);
  console.log(`   失败: ${failed} 条`);
  console.log(`   总耗时: ${totalTime}s`);
  console.log(`   平均速度: ${avgRate} 条/秒\n`);

  // 最终统计
  const finalWithVector = (db.prepare('SELECT COUNT(*) as count FROM memory_vectors').get() as any).count;
  console.log(`📊 最终状态:`);
  console.log(`   有向量的: ${finalWithVector}/${total} (${((finalWithVector / total) * 100).toFixed(1)}%)\n`);

  db.close();
}

main().catch((err) => {
  console.error('❌ 执行失败:', err);
  process.exit(1);
});
