// ============================================================
// M10 遥测 — 按天聚合使用统计
// ============================================================
//
// 从 JSONL 日志聚合按天/模型的使用统计,支持费用趋势、工具排行等查询。
//
// 特性:
// - 基于 UsageStatsRecorder 的原始数据聚合
// - 按日期+模型分组统计
// - 增量聚合（避免重复处理）
// - 内存索引优化查询性能
// - JSON 格式缓存聚合结果
//

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { UsageRecord } from './UsageStatsRecorder';
import { UsageStatsRecorder } from './UsageStatsRecorder';
import { CostTracker } from '@/core/agent/CostTracker';
import type { PricingResolver } from '@/core/agent/PricingResolver';

// ── 类型定义 ──

/**
 * 按天聚合的使用记录
 */
export interface DailyUsageRecord {
  /** 日期 (YYYY-MM-DD) */
  date: string;
  /** 模型名称 */
  model: string;
  /** 总调用次数 */
  totalCalls: number;
  /** 总 token 数 */
  totalTokens: number;
  /** 输入 token */
  inputTokens: number;
  /** 输出 token */
  outputTokens: number;
  /** 缓存读取 token */
  cacheReadTokens: number;
  /** 缓存写入 token */
  cacheWriteTokens: number;
  /** 总费用 (USD) */
  totalCost: number;
  /** 工具调用统计 */
  tools: Record<string, number>; // { tool_name: count }
  /** 平均迭代次数 */
  avgIterations: number;
  /** 总耗时 (毫秒) */
  totalDurationMs: number;
}

/**
 * 聚合数据存储格式
 */
interface AggregatedStorage {
  version: string;
  records: DailyUsageRecord[];
  lastUpdate: string;
}

/**
 * 查询过滤器
 */
export interface DailyUsageFilter {
  /** 模型名称 */
  model?: string;
  /** 开始日期 (YYYY-MM-DD) */
  startDate?: string;
  /** 结束日期 (YYYY-MM-DD) */
  endDate?: string;
  /** 最大条数 */
  limit?: number;
}

// ── 核心类 ──

/**
 * DailyUsageStats — 按天聚合使用统计
 *
 * 从 UsageStatsRecorder 的 JSONL 日志中读取原始数据,
 * 按日期+模型聚合统计,缓存到 JSON 文件,支持多维度查询。
 */
export class DailyUsageStats {
  private static readonly VERSION = '1.0';

  private pricingResolver: PricingResolver | null = null;
  private usageRecorder: UsageStatsRecorder;
  private dailyFilePath: string;
  private statsDir: string;

  constructor(
    pricingResolver?: PricingResolver,
    usageRecorder?: UsageStatsRecorder,
    dailyFilePath?: string,
  ) {
    this.pricingResolver = pricingResolver ?? null;
    this.usageRecorder = usageRecorder ?? new UsageStatsRecorder();

    if (dailyFilePath) {
      this.dailyFilePath = dailyFilePath;
      this.statsDir = join(dailyFilePath, '..');
    } else {
      this.statsDir = join(homedir(), '.xuanji', 'stats');
      this.dailyFilePath = join(this.statsDir, 'daily.json');
    }
  }

  // ── 聚合核心逻辑 ──

  /**
   * 从 JSONL 日志聚合数据
   */
  async aggregate(startDate?: Date, endDate?: Date): Promise<DailyUsageRecord[]> {
    // 读取原始记录
    const filter: { startTime?: string; endTime?: string } = {};
    if (startDate) filter.startTime = startDate.toISOString();
    if (endDate) filter.endTime = endDate.toISOString();

    const records = await this.usageRecorder.query(filter);
    if (records.length === 0) return [];

    // 按日期+模型分组
    const grouped = new Map<string, DailyUsageRecord>();

    for (const record of records) {
      const date = new Date(record.timestamp).toISOString().split('T')[0]!;
      const key = `${date}:${record.model}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          date,
          model: record.model,
          totalCalls: 0,
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalCost: 0,
          tools: {},
          avgIterations: 0,
          totalDurationMs: 0,
        });
      }

      const daily = grouped.get(key)!;
      daily.totalCalls++;
      daily.inputTokens += record.input;
      daily.outputTokens += record.output;
      daily.cacheReadTokens += record.cacheRead ?? 0;
      daily.cacheWriteTokens += record.cacheWrite ?? 0;
      daily.totalTokens = daily.inputTokens + daily.outputTokens;
      daily.totalDurationMs += record.durationMs;

      // 计算费用
      if (this.pricingResolver) {
        const costTracker = new CostTracker(record.model, this.pricingResolver);
        const cost = costTracker.calculateCost({
          input: record.input,
          output: record.output,
          cacheRead: record.cacheRead,
          cacheWrite: record.cacheWrite,
        });
        daily.totalCost += cost;
      }

      // 聚合工具调用
      if (record.toolCalls) {
        for (const tc of record.toolCalls) {
          daily.tools[tc.name] = (daily.tools[tc.name] || 0) + tc.count;
        }
      }

      // 累计迭代次数（用于后续计算平均值）
      daily.avgIterations += record.iterations ?? 0;
    }

    // 计算平均迭代次数
    for (const daily of grouped.values()) {
      daily.avgIterations = daily.totalCalls > 0
        ? Math.round(daily.avgIterations / daily.totalCalls)
        : 0;
    }

    return Array.from(grouped.values()).sort((a, b) => {
      // 按日期降序,模型升序
      const dateCompare = b.date.localeCompare(a.date);
      return dateCompare !== 0 ? dateCompare : a.model.localeCompare(b.model);
    });
  }

  /**
   * 增量聚合并保存
   * 只处理上次聚合时间之后的新记录
   */
  async aggregateAndSave(): Promise<void> {
    try {
      // 读取已有聚合数据
      const existing = await this.loadAggregated();

      // 找到最后聚合的日期
      let lastUpdateTime: Date | undefined;
      const reprocessDates = new Set<string>(); // 需要重新处理的日期

      if (existing.records.length > 0) {
        const lastDate = existing.records[0]!.date; // 已按日期降序排序
        // 从该日期开始重新聚合（避免增量计算复杂性）
        lastUpdateTime = new Date(`${lastDate}T00:00:00Z`);
        lastUpdateTime.setDate(lastUpdateTime.getDate() - 1); // 往前一天重新聚合
        reprocessDates.add(lastDate); // 最后一天需要重新处理
      }

      // 聚合新增的记录（包括最后一天）
      const newRecords = await this.aggregate(lastUpdateTime);

      // 移除需要重新处理的日期
      const filteredExisting = existing.records.filter(
        r => !reprocessDates.has(r.date)
      );

      // 合并已有数据（不累加,直接替换重新处理的日期）
      const merged = this.mergeRecords(filteredExisting, newRecords);

      // 保存
      await this.saveAggregated(merged);
    } catch (err) {
      // 静默失败,不影响主流程
      // console.error('[DailyUsageStats] aggregateAndSave failed:', err);
    }
  }

  // ── 查询接口 ──

  /**
   * 获取指定日期的统计
   */
  async getDaily(date: string): Promise<DailyUsageRecord[]> {
    const data = await this.loadAggregated();
    return data.records.filter((r) => r.date === date);
  }

  /**
   * 获取日期范围的统计
   */
  async getRange(startDate: string, endDate: string): Promise<DailyUsageRecord[]> {
    const data = await this.loadAggregated();
    return data.records.filter((r) => r.date >= startDate && r.date <= endDate);
  }

  /**
   * 获取某个模型的所有统计
   */
  async getByModel(model: string): Promise<DailyUsageRecord[]> {
    const data = await this.loadAggregated();
    return data.records.filter((r) => r.model === model);
  }

  /**
   * 查询统计（支持多维度过滤）
   */
  async query(filter: DailyUsageFilter): Promise<DailyUsageRecord[]> {
    const data = await this.loadAggregated();
    let results = data.records;

    if (filter.model) {
      results = results.filter((r) => r.model === filter.model);
    }
    if (filter.startDate) {
      results = results.filter((r) => r.date >= filter.startDate!);
    }
    if (filter.endDate) {
      results = results.filter((r) => r.date <= filter.endDate!);
    }
    if (filter.limit && filter.limit > 0) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * 获取最常用工具 (TopN)
   */
  async getTopTools(limit: number): Promise<{ name: string; count: number }[]> {
    const data = await this.loadAggregated();
    const toolCounts = new Map<string, number>();

    for (const record of data.records) {
      for (const [name, count] of Object.entries(record.tools)) {
        toolCounts.set(name, (toolCounts.get(name) || 0) + count);
      }
    }

    return Array.from(toolCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * 获取费用趋势（最近 N 天）
   */
  async getCostTrend(days: number): Promise<{ date: string; cost: number }[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days + 1);

    const startStr = startDate.toISOString().split('T')[0]!;
    const endStr = endDate.toISOString().split('T')[0]!;

    const records = await this.getRange(startStr, endStr);

    // 按日期聚合费用
    const dailyCosts = new Map<string, number>();
    for (const record of records) {
      const cost = dailyCosts.get(record.date) || 0;
      dailyCosts.set(record.date, cost + record.totalCost);
    }

    // 填充缺失日期（费用为 0）
    const result: { date: string; cost: number }[] = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0]!;
      result.push({ date: dateStr, cost: dailyCosts.get(dateStr) || 0 });
    }

    return result;
  }

  // ── 存储管理 ──

  /**
   * 读取已保存的聚合数据
   */
  private async loadAggregated(): Promise<AggregatedStorage> {
    try {
      if (!existsSync(this.dailyFilePath)) {
        return {
          version: DailyUsageStats.VERSION,
          records: [],
          lastUpdate: new Date().toISOString(),
        };
      }

      const text = await readFile(this.dailyFilePath, 'utf-8');
      const data = JSON.parse(text) as AggregatedStorage;
      return data;
    } catch {
      return {
        version: DailyUsageStats.VERSION,
        records: [],
        lastUpdate: new Date().toISOString(),
      };
    }
  }

  /**
   * 保存聚合数据
   */
  private async saveAggregated(records: DailyUsageRecord[]): Promise<void> {
    try {
      await mkdir(this.statsDir, { recursive: true });

      const data: AggregatedStorage = {
        version: DailyUsageStats.VERSION,
        records,
        lastUpdate: new Date().toISOString(),
      };

      await writeFile(
        this.dailyFilePath,
        JSON.stringify(data, null, 2),
        'utf-8',
      );
    } catch {
      // 静默失败
    }
  }

  /**
   * 合并已有数据和新数据
   * 同一天+模型的记录会合并
   */
  private mergeRecords(
    existing: DailyUsageRecord[],
    newRecords: DailyUsageRecord[],
  ): DailyUsageRecord[] {
    const merged = new Map<string, DailyUsageRecord>();

    // 先加载已有数据
    for (const record of existing) {
      const key = `${record.date}:${record.model}`;
      merged.set(key, { ...record });
    }

    // 合并新数据
    for (const record of newRecords) {
      const key = `${record.date}:${record.model}`;
      const existing = merged.get(key);

      if (!existing) {
        merged.set(key, { ...record });
      } else {
        // 合并统计
        existing.totalCalls += record.totalCalls;
        existing.inputTokens += record.inputTokens;
        existing.outputTokens += record.outputTokens;
        existing.cacheReadTokens += record.cacheReadTokens;
        existing.cacheWriteTokens += record.cacheWriteTokens;
        existing.totalTokens = existing.inputTokens + existing.outputTokens;
        existing.totalCost += record.totalCost;
        existing.totalDurationMs += record.totalDurationMs;

        // 合并工具调用
        for (const [name, count] of Object.entries(record.tools)) {
          existing.tools[name] = (existing.tools[name] || 0) + count;
        }

        // 重新计算平均迭代次数
        const totalIterations =
          existing.avgIterations * (existing.totalCalls - record.totalCalls) +
          record.avgIterations * record.totalCalls;
        existing.avgIterations = Math.round(totalIterations / existing.totalCalls);
      }
    }

    // 按日期降序,模型升序排序
    return Array.from(merged.values()).sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      return dateCompare !== 0 ? dateCompare : a.model.localeCompare(b.model);
    });
  }

  /**
   * 清空所有聚合数据
   */
  async clear(): Promise<void> {
    try {
      if (existsSync(this.dailyFilePath)) {
        await writeFile(
          this.dailyFilePath,
          JSON.stringify({
            version: DailyUsageStats.VERSION,
            records: [],
            lastUpdate: new Date().toISOString(),
          }, null, 2),
          'utf-8',
        );
      }
    } catch {
      // 静默失败
    }
  }
}
