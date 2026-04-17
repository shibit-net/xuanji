// ============================================================
// MemoryMaintenanceScheduler — 记忆维护调度器
// ============================================================
// 职责：
// 1. 定期执行记忆压缩（去重、淘汰过时记忆）
// 2. 定期执行记忆提炼（升级、权重调整）
// 3. 在系统空闲时自动运行

import type { MemoryStore } from './MemoryStore.js';
import type { SubAgentFactory } from '@/core/agent/SubAgentFactory';
import { MemoryCompactor } from './MemoryCompactor.js';
import { MemoryRefiner } from './MemoryRefiner.js';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MemoryMaintenanceScheduler' });

export interface MaintenanceConfig {
  /** 是否启用自动维护 */
  enabled: boolean;
  /** 压缩间隔（毫秒），默认 24 小时 */
  compactionInterval: number;
  /** 提炼间隔（毫秒），默认 12 小时 */
  refinementInterval: number;
  /** 压缩激进程度 0-1 */
  compactionAggressiveness: number;
  /** 每次提炼最多升级数量 */
  maxUpgradesPerRun: number;
  /** 是否使用 LLM 进行智能压缩和提炼 */
  useLLM: boolean;
}

export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceConfig = {
  enabled: true,
  compactionInterval: 24 * 60 * 60 * 1000, // 24 小时
  refinementInterval: 12 * 60 * 60 * 1000, // 12 小时
  compactionAggressiveness: 0.5,
  maxUpgradesPerRun: 10,
  useLLM: true, // 默认启用 LLM
};

/**
 * MemoryMaintenanceScheduler — 记忆维护调度器
 *
 * 在后台定期执行记忆维护任务
 */
export class MemoryMaintenanceScheduler {
  private config: MaintenanceConfig;
  private compactor: MemoryCompactor;
  private refiner: MemoryRefiner;
  private compactionTimer: NodeJS.Timeout | null = null;
  private refinementTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    store: MemoryStore,
    subAgentFactory?: SubAgentFactory,
    config?: Partial<MaintenanceConfig>
  ) {
    this.config = { ...DEFAULT_MAINTENANCE_CONFIG, ...config };
    this.compactor = new MemoryCompactor(store, subAgentFactory);
    this.refiner = new MemoryRefiner(store, subAgentFactory);
  }

  /**
   * 启动调度器
   */
  start(): void {
    if (!this.config.enabled) {
      log.info('Memory maintenance scheduler is disabled');
      return;
    }

    if (this.running) {
      log.warn('Scheduler already running');
      return;
    }

    this.running = true;
    log.info('Starting memory maintenance scheduler', {
      compactionInterval: `${this.config.compactionInterval / 1000 / 60 / 60}h`,
      refinementInterval: `${this.config.refinementInterval / 1000 / 60 / 60}h`,
    });

    // 延迟 5 分钟后首次执行（避免启动时负载过高）
    const initialDelay = 5 * 60 * 1000;

    setTimeout(() => {
      this.scheduleCompaction();
      this.scheduleRefinement();
    }, initialDelay);
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.running) return;

    log.info('Stopping memory maintenance scheduler');

    if (this.compactionTimer) {
      clearTimeout(this.compactionTimer);
      this.compactionTimer = null;
    }

    if (this.refinementTimer) {
      clearTimeout(this.refinementTimer);
      this.refinementTimer = null;
    }

    this.running = false;
  }

  /**
   * 手动触发压缩
   */
  async runCompaction(dryRun = false): Promise<void> {
    log.info(`Running memory compaction (dryRun: ${dryRun}, useLLM: ${this.config.useLLM})...`);
    try {
      const result = await this.compactor.compact({
        dryRun,
        aggressiveness: this.config.compactionAggressiveness,
        useLLM: this.config.useLLM,
      });
      log.info('Compaction completed', result);
    } catch (err) {
      log.error('Compaction failed:', err);
    }
  }

  /**
   * 手动触发提炼
   */
  async runRefinement(dryRun = false): Promise<void> {
    log.info(`Running memory refinement (dryRun: ${dryRun}, useLLM: ${this.config.useLLM})...`);
    try {
      const result = await this.refiner.refine({
        dryRun,
        maxUpgrades: this.config.maxUpgradesPerRun,
        useLLM: this.config.useLLM,
      });
      log.info('Refinement completed', result);
    } catch (err) {
      log.error('Refinement failed:', err);
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return this.compactor.getStats();
  }

  // ────────── 私有方法 ──────────

  private scheduleCompaction(): void {
    this.compactionTimer = setTimeout(async () => {
      await this.runCompaction(false);
      this.scheduleCompaction(); // 递归调度
    }, this.config.compactionInterval);
  }

  private scheduleRefinement(): void {
    this.refinementTimer = setTimeout(async () => {
      await this.runRefinement(false);
      this.scheduleRefinement(); // 递归调度
    }, this.config.refinementInterval);
  }
}
