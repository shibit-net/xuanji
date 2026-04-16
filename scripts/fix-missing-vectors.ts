#!/usr/bin/env tsx
// ============================================================
// 修复缺失向量的记忆
// ============================================================
// 用途：手动触发向量化处理，为所有缺失向量的记忆生成 embedding

import { homedir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { EmbeddingService } from '../src/embedding/EmbeddingService.js';
import { logger } from '../src/core/logger';

const log = logger.child({ module: 'FixMissingVectors' });

async function main() {
  const dbPath = join(homedir(), '.xuanji', 'memory.db');
  const db = new Database(dbPath);

  // 统计信息
  const totalMemories = db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number };
  const totalVectors = db.prepare('SELECT COUNT(*) as count FROM memory_vectors').get() as { count: number };
  
  log.info(`Total memories: ${totalMemories.count}`);
  log.info(`Total vectors: ${totalVectors.count}`);
  log.info(`Missing vectors: ${totalMemories.count - totalVectors.count}`);

  // 查询缺失向量的记忆
  const missingQuery = `
    SELECT m.id, m.content
    FROM memories m
    LEFT JOIN memory_vectors v ON m.id = v.memory_id
    WHERE v.memory_id IS NULL
    ORDER BY m.created_at DESC
  `;

  const missing = db.prepare(missingQuery).all() as Array<{ id: string; content: string }>;

  if (missing.length === 0) {
    log.info('✅ All memories have vectors!');
    db.close();
    return;
  }

  log.info(`Found ${missing.length} memories without vectors`);
  log.info('Initializing EmbeddingService...');

  // 初始化 embedding 服务
  const embeddingService = EmbeddingService.getInstance();
  await embeddingService.init();

  log.info('EmbeddingService ready, starting vectorization...');

  // 准备插入语句（包含 updated_at）
  const upsertStmt = db.prepare(`
    INSERT INTO memory_vectors (memory_id, embedding, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(memory_id) DO UPDATE SET 
      embedding = excluded.embedding,
      updated_at = datetime('now')
  `);

  let successCount = 0;
  let failedCount = 0;
  const batchSize = 10;

  // 分批处理
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    
    log.info(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(missing.length / batchSize)} (${batch.length} items)`);

    for (const item of batch) {
      try {
        const embedding = await embeddingService.embed(item.content);
        const buffer = Buffer.from(new Float32Array(embedding).buffer);
        upsertStmt.run(item.id, buffer);
        successCount++;
        
        if (successCount % 50 === 0) {
          log.info(`Progress: ${successCount}/${missing.length} (${Math.round(successCount / missing.length * 100)}%)`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`Failed to vectorize ${item.id}: ${msg}`);
        failedCount++;
      }
    }

    // 每批次后稍微延迟，避免过载
    if (i + batchSize < missing.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  db.close();

  log.info('');
  log.info('=== Vectorization Complete ===');
  log.info(`✅ Success: ${successCount}`);
  log.info(`❌ Failed: ${failedCount}`);
  log.info(`📊 Success rate: ${Math.round(successCount / missing.length * 100)}%`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
