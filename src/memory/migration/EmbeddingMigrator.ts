// ============================================================
// M4 记忆系统 — 向量迁移工具
// ============================================================

import type { EmbeddingService } from '@/embedding/EmbeddingService';
import type { VectorStore } from '@/embedding/VectorStore';
import type { LongTermMemory } from '../LongTermMemory';
import type { MemoryEntry } from '../types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'embedding-migrator' });

/**
 * EmbeddingMigrator — 将 JSONL 记忆迁移到向量存储
 *
 * 读取 LongTermMemory 中已有的记忆条目，
 * 批量生成 embeddings 并写入 VectorStore。
 *
 * 运行时机：
 * - 首次启动时自动检测（VectorStore 为空时）
 * - 用户手动触发（/memory migrate 命令）
 */
export class EmbeddingMigrator {
  private embeddingService: EmbeddingService;
  private vectorStore: VectorStore;
  private longTermMemory: LongTermMemory;

  constructor(
    embeddingService: EmbeddingService,
    vectorStore: VectorStore,
    longTermMemory: LongTermMemory,
  ) {
    this.embeddingService = embeddingService;
    this.vectorStore = vectorStore;
    this.longTermMemory = longTermMemory;
  }

  /**
   * 执行迁移（增量：仅迁移 VectorStore 中不存在的记忆）
   */
  async migrate(batchSize = 20): Promise<{ migrated: number; total: number; skipped: number }> {
    const memories = await this.longTermMemory.readAll();
    const total = memories.length;

    if (total === 0) {
      log.info('No memories to migrate');
      return { migrated: 0, total: 0, skipped: 0 };
    }

    // 获取已迁移的 ID
    const existingIds = this.vectorStore.getStoredMemoryIds();
    const toMigrate = memories.filter((m) => !existingIds.has(m.id));
    const skipped = total - toMigrate.length;

    if (toMigrate.length === 0) {
      log.info(`All ${total} memories already migrated`);
      return { migrated: 0, total, skipped };
    }

    log.info(`Migrating ${toMigrate.length} memories to vector store (${skipped} already exist)...`);

    let migrated = 0;

    for (let i = 0; i < toMigrate.length; i += batchSize) {
      const batch = toMigrate.slice(i, i + batchSize);
      const texts = batch.map((m) => m.content);

      try {
        const embeddings = await this.embeddingService.embedBatch(texts);
        this.vectorStore.insertBatch(batch, embeddings);
        migrated += batch.length;

        const progress = Math.round((migrated / toMigrate.length) * 100);
        log.info(`Migration progress: ${migrated}/${toMigrate.length} (${progress}%)`);
      } catch (err) {
        log.error(`Failed to migrate batch at offset ${i}:`, err);
        // 继续下一批，不中断整体迁移
      }
    }

    log.info(`Migration complete: ${migrated}/${toMigrate.length} migrated, ${skipped} skipped`);
    return { migrated, total, skipped };
  }

  /**
   * 迁移单条新记忆（实时增量更新）
   */
  async migrateOne(memory: MemoryEntry): Promise<void> {
    try {
      const embedding = await this.embeddingService.embed(memory.content);
      this.vectorStore.insertMemory(memory, embedding);
    } catch (err) {
      log.debug(`Failed to embed memory ${memory.id}:`, err);
    }
  }

  /**
   * 检查是否需要迁移
   */
  async needsMigration(): Promise<boolean> {
    const memoryCount = (await this.longTermMemory.readAll()).length;
    const vectorCount = this.vectorStore.getMemoryCount();
    return memoryCount > vectorCount;
  }
}
