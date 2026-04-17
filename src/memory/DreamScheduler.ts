// ============================================================
// DreamScheduler — 做梦调度器
// ============================================================
// 管理做梦触发时机：会话结束、定期、记忆阈值
// ============================================================

import type { DreamResult, DreamProgress } from './types';
import type { DreamAgent } from './DreamAgent';
import type { MemoryStore } from './MemoryStore';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'DreamScheduler' });

export interface DreamSchedulerOptions {
  batchSize?: number;
  scheduleIntervalMs?: number;   // 定期检查间隔（默认1小时）
  minIntervalMs?: number;        // 两次做梦最小间隔（默认6小时）
  memoryThreshold?: number;      // 触发做梦的新增记忆数量（默认50）
  idleThresholdMs?: number;      // 用户空闲多久触发（默认30分钟）
}

/**
 * 做梦调度器
 */
export class DreamScheduler {
  private dreamAgent: DreamAgent;
  private store: MemoryStore;
  private options: Required<DreamSchedulerOptions>;

  private isRunning = false;
  private lastDreamTime = 0;
  private lastActivityTime = Date.now();
  private scheduleTimer?: ReturnType<typeof setInterval>;

  constructor(
    dreamAgent: DreamAgent,
    store: MemoryStore,
    options: DreamSchedulerOptions = {}
  ) {
    this.dreamAgent = dreamAgent;
    this.store = store;
    this.options = {
      batchSize: options.batchSize ?? 100,
      scheduleIntervalMs: options.scheduleIntervalMs ?? 3600 * 1000,
      minIntervalMs: options.minIntervalMs ?? 6 * 3600 * 1000,
      memoryThreshold: options.memoryThreshold ?? 50,
      idleThresholdMs: options.idleThresholdMs ?? 30 * 60 * 1000,
    };
  }

  /**
   * 记录用户活动（用于空闲检测）
   */
  recordActivity(): void {
    this.lastActivityTime = Date.now();
  }

  /**
   * 检查是否应该做梦
   */
  async shouldDream(): Promise<{ should: boolean; reason?: string }> {
    if (this.isRunning) {
      return { should: false };
    }

    const now = Date.now();
    const timeSinceLastDream = now - this.lastDreamTime;

    // 最小间隔保护
    if (this.lastDreamTime > 0 && timeSinceLastDream < this.options.minIntervalMs) {
      return { should: false };
    }

    // 触发条件1：超过24小时未做梦
    if (timeSinceLastDream >= 24 * 3600 * 1000) {
      return { should: true, reason: 'daily' };
    }

    // 触发条件2：新增记忆超过阈值
    const newMemoryCount = await this.getNewMemoryCount();
    if (newMemoryCount >= this.options.memoryThreshold) {
      return { should: true, reason: `memory-threshold(${newMemoryCount})` };
    }

    // 触发条件3：用户空闲超过阈值
    const idleTime = now - this.lastActivityTime;
    if (idleTime >= this.options.idleThresholdMs) {
      return { should: true, reason: 'user-idle' };
    }

    return { should: false };
  }

  /**
   * 执行做梦
   */
  async executeDream(options?: {
    dryRun?: boolean;
    onProgress?: (progress: DreamProgress) => void;
  }): Promise<DreamResult | null> {
    if (this.isRunning) {
      log.warn('🌙 做梦已在运行中，跳过');
      return null;
    }

    this.isRunning = true;

    try {
      log.info('🌙 开始做梦...');

      const result = await this.dreamAgent.dream({
        batchSize: this.options.batchSize,
        dryRun: options?.dryRun,
        onProgress: options?.onProgress,
      });

      this.lastDreamTime = Date.now();

      log.info('🌙 做梦完成', result);

      return result;
    } catch (err) {
      log.error('🌙 做梦失败', err);
      return null;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 启动定期调度
   */
  startSchedule(): void {
    if (this.scheduleTimer) return;

    this.scheduleTimer = setInterval(async () => {
      const { should, reason } = await this.shouldDream();
      if (should) {
        log.info(`🌙 触发做梦条件: ${reason}`);
        // 后台异步执行，不阻塞
        this.executeDream().catch(err => {
          log.error('定期做梦失败', err);
        });
      }
    }, this.options.scheduleIntervalMs);

    log.info('🌙 做梦调度器已启动');
  }

  /**
   * 停止定期调度
   */
  stopSchedule(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = undefined;
      log.info('🌙 做梦调度器已停止');
    }
  }

  /**
   * 获取自上次做梦以来新增的记忆数量
   */
  private async getNewMemoryCount(): Promise<number> {
    const since = this.lastDreamTime || Date.now() - 24 * 3600 * 1000;

    try {
      const sql = `
        SELECT COUNT(*) as count
        FROM memories
        WHERE deleted_at IS NULL
          AND CAST(strftime('%s', created_at) * 1000 AS INTEGER) > ?
      `;
      const row = this.store.db!.prepare(sql).get(since) as any;
      return row?.count ?? 0;
    } catch {
      return 0;
    }
  }

  get running(): boolean {
    return this.isRunning;
  }
}
