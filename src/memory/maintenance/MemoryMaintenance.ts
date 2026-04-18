// ============================================================
// MemoryMaintenance - 维护层实现
// ============================================================
// 负责记忆压缩、归档、清理
//
// 职责:
// - 记忆压缩（合并相似记忆）
// - 记忆归档（导出旧记忆）
// - 数据库清理（vacuum）
// - 定时维护调度
// ============================================================

import type { IMemoryStorage, IMemoryMaintenance, CompactionResult, ArchiveResult, MaintenanceConfig } from '../interfaces';
import { MemoryCompactor } from '../MemoryCompactor';
import { MemoryMaintenanceScheduler } from '../MemoryMaintenanceScheduler';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MemoryMaintenance' });

/**
 * MemoryMaintenance - 维护层实现
 */
export class MemoryMaintenance implements IMemoryMaintenance {
  private compactor: MemoryCompactor;
  private scheduler: MemoryMaintenanceScheduler | null = null;

  constructor(
    private storage: IMemoryStorage,
    private projectRoot?: string
  ) {
    this.compactor = new MemoryCompactor();
  }

  /**
   * 压缩记忆
   */
  async compact(): Promise<CompactionResult> {
    log.info('Starting memory compaction');

    // 1. 查询所有记忆
    const entries = await this.storage.query({ limit: 10000 });
    const before = entries.length;

    // 2. 压缩
    const compacted = await this.compactor.compact(entries);
    const after = compacted.length;

    // 3. 保存压缩后的记忆
    await this.storage.transaction(async (tx) => {
      // 删除旧记忆
      for (const entry of entries) {
        await tx.delete(entry.id);
      }

      // 保存新记忆
      for (const entry of compacted) {
        await tx.save(entry);
      }
    });

    log.info(`Compaction complete: ${before} → ${after} (removed ${before - after})`);

    return {
      before,
      after,
      removed: before - after
    };
  }

  /**
   * 归档记忆
   */
  async archive(before: Date): Promise<ArchiveResult> {
    log.info(`Archiving memories before ${before.toISOString()}`);

    // 1. 查询旧记忆
    const entries = await this.storage.query({
      timeRange: {
        start: new Date(0),
        end: before
      }
    });

    if (entries.length === 0) {
      log.info('No memories to archive');
      return { archived: 0, path: '' };
    }

    // 2. 导出到文件
    const timestamp = Date.now();
    const path = `${this.projectRoot || '.'}/.xuanji/memory/archive-${timestamp}.json`;

    const fs = await import('node:fs/promises');
    await fs.mkdir(`${this.projectRoot || '.'}/.xuanji/memory`, { recursive: true });
    await fs.writeFile(path, JSON.stringify(entries, null, 2));

    // 3. 删除已归档的记忆
    await this.storage.transaction(async (tx) => {
      for (const entry of entries) {
        await tx.delete(entry.id);
      }
    });

    log.info(`Archived ${entries.length} memories to ${path}`);

    return {
      archived: entries.length,
      path
    };
  }

  /**
   * 数据库清理
   */
  async vacuum(): Promise<void> {
    log.info('Vacuuming database');

    // MemoryStore 的 vacuum 方法
    const store = (this.storage as any).getStore?.();
    if (store && typeof store.vacuum === 'function') {
      await store.vacuum();
    }

    log.info('Vacuum complete');
  }

  /**
   * 调度定时维护
   */
  scheduleMaintenance(config: MaintenanceConfig): void {
    log.info('Scheduling maintenance tasks');

    this.scheduler = new MemoryMaintenanceScheduler(
      async () => await this.compact(),
      async () => {
        const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        await this.archive(oneMonthAgo);
      },
      async () => await this.vacuum()
    );

    this.scheduler.start(
      config.compactInterval || 24 * 60 * 60 * 1000,  // 默认 24 小时
      config.archiveInterval || 7 * 24 * 60 * 60 * 1000,  // 默认 7 天
      config.vacuumInterval || 30 * 24 * 60 * 60 * 1000   // 默认 30 天
    );
  }

  /**
   * 停止定时维护
   */
  stopMaintenance(): void {
    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler = null;
      log.info('Maintenance tasks stopped');
    }
  }
}
