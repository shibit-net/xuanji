// ============================================================
// 提醒统计 — ReminderStatsService 数据聚合层
// ============================================================

import type {
  Reminder,
  ReminderStats,
  ReminderStatusDistribution,
  ReminderRecurringDistribution,
  ReminderSourceDistribution,
  ReminderDateBucket,
  IReminderEngine,
  IReminderStatsService,
  StatsQueryOptions,
} from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'reminder-stats-service' });

/**
 * 零值统计（当 reminders 为空或异常时返回）
 */
const ZERO_STATS: ReminderStats = {
  total: 0,
  byStatus: { active: 0, done: 0, dismissed: 0 },
  byRecurring: { once: 0, daily: 0, weekly: 0, monthly: 0, yearly: 0 },
  bySource: { user_explicit: 0, auto_extracted: 0 },
  byDate: [],
  dateRange: null,
  generatedAt: new Date().toISOString(),
};

/**
 * ReminderStatsService — 提醒统计聚合服务
 *
 * 从 IReminderEngine 获取原始数据并聚合为 ReminderStats。
 * 所有聚合方法均为纯函数，便于单元测试。
 */
export class ReminderStatsService implements IReminderStatsService {
  private readonly engine: IReminderEngine;

  /**
   * @param engine IReminderEngine 接口实现（依赖注入）
   */
  constructor(engine: IReminderEngine) {
    this.engine = engine;
  }

  /**
   * 获取聚合统计数据
   *
   * @param options 可选的过滤条件（按状态、日期范围）
   * @returns 聚合统计结果。异常时返回零值统计，永不抛出。
   */
  async getStats(options?: StatsQueryOptions): Promise<ReminderStats> {
    try {
      const reminders = await this.engine.listReminders(options);
      log.debug(`getStats: aggregating ${reminders.length} reminders (options: ${JSON.stringify(options)})`);

      if (reminders.length === 0) {
        return { ...ZERO_STATS, generatedAt: new Date().toISOString() };
      }

      const byStatus = aggregateByStatus(reminders);
      const byRecurring = aggregateByRecurring(reminders);
      const bySource = aggregateBySource(reminders);
      const byDate = aggregateByDate(reminders);
      const dateRange = computeDateRange(reminders);

      return {
        total: reminders.length,
        byStatus,
        byRecurring,
        bySource,
        byDate,
        dateRange,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      log.warn('getStats failed, returning zero-value stats:', error);
      return { ...ZERO_STATS, generatedAt: new Date().toISOString() };
    }
  }
}

// ────────── 纯函数聚合器 ──────────

/**
 * 按提醒状态分布聚合
 *
 * @param reminders 提醒列表
 * @returns 按 active / done / dismissed 的计数分布
 */
function aggregateByStatus(reminders: Reminder[]): ReminderStatusDistribution {
  const result: ReminderStatusDistribution = { active: 0, done: 0, dismissed: 0 };
  for (const r of reminders) {
    result[r.status] += 1;
  }
  return result;
}

/**
 * 按循环类型分布聚合
 *
 * @param reminders 提醒列表
 * @returns 按 once / daily / weekly / monthly / yearly 的计数分布
 */
function aggregateByRecurring(reminders: Reminder[]): ReminderRecurringDistribution {
  const result: ReminderRecurringDistribution = { once: 0, daily: 0, weekly: 0, monthly: 0, yearly: 0 };
  for (const r of reminders) {
    result[r.recurring] += 1;
  }
  return result;
}

/**
 * 按来源分布聚合
 *
 * @param reminders 提醒列表
 * @returns 按 user_explicit / auto_extracted 的计数分布
 */
function aggregateBySource(reminders: Reminder[]): ReminderSourceDistribution {
  const result: ReminderSourceDistribution = { user_explicit: 0, auto_extracted: 0 };
  for (const r of reminders) {
    result[r.source] += 1;
  }
  return result;
}

/**
 * 按日期分布聚合
 *
 * 按 triggerDate 分组并计数，以 triggerDate 升序排列。
 *
 * @param reminders 提醒列表
 * @returns 按日期分组的统计条目，升序排列
 */
function aggregateByDate(reminders: Reminder[]): ReminderDateBucket[] {
  const bucketMap = new Map<string, number>();

  for (const r of reminders) {
    const count = bucketMap.get(r.triggerDate) ?? 0;
    bucketMap.set(r.triggerDate, count + 1);
  }

  const buckets: ReminderDateBucket[] = [];
  for (const [date, count] of bucketMap) {
    buckets.push({ date, count });
  }

  // 按日期升序排列
  buckets.sort((a, b) => a.date.localeCompare(b.date));

  return buckets;
}

/**
 * 计算统计覆盖的时间范围
 *
 * @param reminders 提醒列表
 * @returns 最小和最大 triggerDate，空数组返回 null
 */
function computeDateRange(reminders: Reminder[]): { from: string; to: string } | null {
  if (reminders.length === 0) return null;

  let from = reminders[0]!.triggerDate;
  let to = reminders[0]!.triggerDate;

  for (const r of reminders) {
    if (r.triggerDate < from) from = r.triggerDate;
    if (r.triggerDate > to) to = r.triggerDate;
  }

  return { from, to };
}
