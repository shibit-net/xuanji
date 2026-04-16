// ============================================================
// VectorManager — 向量生成管理器
// ============================================================
// 职责：
//   1. 统一管理 EmbeddingService 初始化
//   2. 为新记忆生成向量（带重试队列）
//   3. 后台补偿任务：扫描并修复缺失向量的记忆
//   4. 可观测性：记录成功率、失败原因

import { logger } from '@/core/logger';
import type { MemoryStore } from './MemoryStore';
import type { MemoryEntry } from './types';

const log = logger.child({ module: 'VectorManager' });

interface VectorTask {
  memoryId: string;
  content: string;
  retryCount: number;
  lastError?: string;
}

interface VectorStats {
  totalProcessed: number;
  successCount: number;
  failedCount: number;
  pendingCount: number;
}

export class VectorManager {
  private embeddingService: any = null;
  private embeddingReady = false;
  private initPromise: Promise<void> | null = null;
  private retryQueue: VectorTask[] = [];
  private processing = false;
  private stats: VectorStats = {
    totalProcessed: 0,
    successCount: 0,
    failedCount: 0,
    pendingCount: 0,
  };
  private compensationTimer: NodeJS.Timeout | null = null;

  constructor(
    private store: MemoryStore,
    private config: {
      maxRetries?: number;
      compensationIntervalMs?: number;
      batchSize?: number;
    } = {},
  ) {
    this.config = {
      maxRetries: 3,
      compensationIntervalMs: 5 * 60 * 1000,
      batchSize: 50,
      ...config,
    };
  }

  async init(): Promise<void> {
    if (this.embeddingReady) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    try {
      log.info('Initializing EmbeddingService...');
      const { EmbeddingService } = await import('@/embedding/EmbeddingService');
      this.embeddingService = EmbeddingService.getInstance();
      await this.embeddingService.init();
      this.embeddingReady = true;
      log.info('EmbeddingService ready');
      this.startCompensationTask();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('EmbeddingService unavailable: ' + msg);
      throw err;
    }
  }

  async embedEntries(entries: MemoryEntry[]): Promise<void> {
    if (entries.length === 0) return;

    if (!this.embeddingReady) {
      try {
        await this.init();
      } catch {
        for (const entry of entries) {
          this.addToRetryQueue(entry.id, entry.content);
        }
        return;
      }
    }

    for (const entry of entries) {
      this.stats.totalProcessed++;
      try {
        const embedding = await this.embeddingService.embed(entry.content);
        this.store.upsertVector(entry.id, embedding);
        this.stats.successCount++;
      } catch (err) {
        this.stats.failedCount++;
        const msg = err instanceof Error ? err.message : String(err);
        log.debug('Failed to embed entry ' + entry.id + ': ' + msg);
        this.addToRetryQueue(entry.id, entry.content, msg);
      }
    }

    this.processRetryQueue();
  }

  private addToRetryQueue(memoryId: string, content: string, error?: string): void {
    const existing = this.retryQueue.find((t) => t.memoryId === memoryId);
    if (existing) {
      existing.retryCount++;
      existing.lastError = error;
    } else {
      this.retryQueue.push({ memoryId, content, retryCount: 0, lastError: error });
    }
    this.stats.pendingCount = this.retryQueue.length;
  }

  private processRetryQueue(): void {
    if (this.processing || this.retryQueue.length === 0 || !this.embeddingReady) return;
    this.processing = true;

    (async () => {
      while (this.retryQueue.length > 0) {
        const task = this.retryQueue.shift()!;
        if (task.retryCount >= this.config.maxRetries!) {
          log.warn('Giving up on entry ' + task.memoryId + ' after ' + task.retryCount + ' retries');
          this.stats.failedCount++;
          continue;
        }

        try {
          const embedding = await this.embeddingService.embed(task.content);
          this.store.upsertVector(task.memoryId, embedding);
          this.stats.successCount++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.debug('Retry failed for ' + task.memoryId + ': ' + msg);
          this.addToRetryQueue(task.memoryId, task.content, msg);
        }

        await new Promise((resolve) => setImmediate(resolve));
      }

      this.stats.pendingCount = this.retryQueue.length;
      this.processing = false;
    })();
  }

  private startCompensationTask(): void {
    if (this.compensationTimer) return;

    this.compensationTimer = setInterval(() => {
      this.runCompensation();
    }, this.config.compensationIntervalMs!);

    this.runCompensation();
  }

  private async runCompensation(): Promise<void> {
    if (!this.embeddingReady) return;

    try {
      const missing = this.store.getMemoriesWithoutVectors(this.config.batchSize!);
      
      if (missing.length === 0) {
        log.debug('No missing vectors, compensation task skipped');
        return;
      }

      log.info('Compensation: processing ' + missing.length + ' memories without vectors');

      for (const entry of missing) {
        try {
          const embedding = await this.embeddingService.embed(entry.content);
          this.store.upsertVector(entry.id, embedding);
          this.stats.successCount++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.debug('Compensation failed for ' + entry.id + ': ' + msg);
          this.addToRetryQueue(entry.id, entry.content, msg);
        }
      }

      log.info('Compensation completed: ' + missing.length + ' processed');
    } catch (err) {
      log.warn('Compensation task failed:', err);
    }
  }

  getStats(): VectorStats {
    return { ...this.stats };
  }

  isReady(): boolean {
    return this.embeddingReady;
  }

  async shutdown(): Promise<void> {
    if (this.compensationTimer) {
      clearInterval(this.compensationTimer);
      this.compensationTimer = null;
    }
    this.retryQueue = [];
    log.info('VectorManager shutdown complete');
  }
}
