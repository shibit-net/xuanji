/**
 * Token stats collector - aggregates usage data
 */

import type { 
  ITokenStatsCollector, 
  IStatsStorage, 
  DailyStats, 
  ToolUsage, 
  UsageRecord 
} from '../../types/stats.js';
import { calculateCost } from './PricingConfig.js';
import { StatsStorage } from './StatsStorage.js';

export class TokenStatsCollector implements ITokenStatsCollector {
  private storage: IStatsStorage;

  constructor(storage?: IStatsStorage, userId?: string) {
    this.storage = storage || new StatsStorage(undefined, userId);
  }

  async recordUsage(params: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    toolName?: string;
  }): Promise<void> {
    const record: UsageRecord = {
      provider: params.provider,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      toolName: params.toolName,
      timestamp: Date.now(),
    };

    await this.storage.saveRecord(record);
  }

  async getDailyStats(date: Date): Promise<DailyStats | null> {
    const records = await this.storage.getDailyRecords(date);
    
    if (records.length === 0) {
      return null;
    }

    return this.aggregateRecords(records, date);
  }

  async getTopTools(limit: number, date?: Date): Promise<ToolUsage[]> {
    const records = date 
      ? await this.storage.getDailyRecords(date)
      : await this.storage.getRangeRecords(
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          new Date()
        );

    const toolMap = new Map<string, { count: number; tokens: number }>();

    for (const record of records) {
      if (!record.toolName) continue;

      const existing = toolMap.get(record.toolName) || { count: 0, tokens: 0 };
      toolMap.set(record.toolName, {
        count: existing.count + 1,
        tokens: existing.tokens + record.inputTokens + record.outputTokens,
      });
    }

    return Array.from(toolMap.entries())
      .map(([tool, data]) => ({ tool, ...data }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, limit);
  }

  async getRangeStats(startDate: Date, endDate: Date): Promise<DailyStats[]> {
    const records = await this.storage.getRangeRecords(startDate, endDate);
    
    // Group by day
    const dailyMap = new Map<string, UsageRecord[]>();
    
    for (const record of records) {
      const date = new Date(record.timestamp);
      const dateKey = this.getDateKey(date);
      
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, []);
      }
      dailyMap.get(dateKey)!.push(record);
    }

    const stats: DailyStats[] = [];
    for (const [dateKey, dayRecords] of dailyMap.entries()) {
      const date = new Date(dateKey);
      stats.push(this.aggregateRecords(dayRecords, date));
    }

    return stats.sort((a, b) => a.date.localeCompare(b.date));
  }

  private aggregateRecords(records: UsageRecord[], date: Date): DailyStats {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;
    const toolMap = new Map<string, { count: number; tokens: number }>();

    for (const record of records) {
      totalInputTokens += record.inputTokens;
      totalOutputTokens += record.outputTokens;
      totalCost += calculateCost(
        record.provider,
        record.model,
        record.inputTokens,
        record.outputTokens
      );

      if (record.toolName) {
        const existing = toolMap.get(record.toolName) || { count: 0, tokens: 0 };
        toolMap.set(record.toolName, {
          count: existing.count + 1,
          tokens: existing.tokens + record.inputTokens + record.outputTokens,
        });
      }
    }

    const toolUsage: ToolUsage[] = Array.from(toolMap.entries())
      .map(([tool, data]) => ({ tool, ...data }))
      .sort((a, b) => b.tokens - a.tokens);

    return {
      date: this.getDateKey(date),
      totalTokens: totalInputTokens + totalOutputTokens,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      estimatedCost: totalCost,
      toolUsage,
    };
  }

  private getDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
