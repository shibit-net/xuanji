/**
 * Unit tests for Token Stats Collector
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TokenStatsCollector } from '../TokenStatsCollector.js';
import type { IStatsStorage, UsageRecord } from '../../../types/stats.js';

// Mock storage for testing
class MockStatsStorage implements IStatsStorage {
  private records: UsageRecord[] = [];

  async saveRecord(record: UsageRecord): Promise<void> {
    this.records.push(record);
  }

  async getDailyRecords(date: Date): Promise<UsageRecord[]> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    return this.records.filter(
      r => r.timestamp >= dayStart.getTime() && r.timestamp <= dayEnd.getTime()
    );
  }

  async getRangeRecords(startDate: Date, endDate: Date): Promise<UsageRecord[]> {
    const startTime = startDate.getTime();
    const endTime = endDate.getTime();
    return this.records.filter(r => r.timestamp >= startTime && r.timestamp <= endTime);
  }

  // Test helper
  clear(): void {
    this.records = [];
  }
}

describe('TokenStatsCollector', () => {
  let storage: MockStatsStorage;
  let collector: TokenStatsCollector;

  beforeEach(() => {
    storage = new MockStatsStorage();
    collector = new TokenStatsCollector(storage);
  });

  it('should record usage', async () => {
    await collector.recordUsage({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      inputTokens: 1000,
      outputTokens: 500,
      toolName: 'read_file',
    });

    const today = new Date();
    const stats = await collector.getDailyStats(today);

    expect(stats).not.toBeNull();
    expect(stats!.totalTokens).toBe(1500);
    expect(stats!.inputTokens).toBe(1000);
    expect(stats!.outputTokens).toBe(500);
  });

  it('should calculate cost correctly', async () => {
    await collector.recordUsage({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    const today = new Date();
    const stats = await collector.getDailyStats(today);

    // claude-3-5-sonnet: $3/1M input, $15/1M output
    // Expected: 3 + 15 = $18
    expect(stats!.estimatedCost).toBeCloseTo(18, 2);
  });

  it('should aggregate tool usage', async () => {
    await collector.recordUsage({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      inputTokens: 1000,
      outputTokens: 500,
      toolName: 'read_file',
    });

    await collector.recordUsage({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      inputTokens: 2000,
      outputTokens: 1000,
      toolName: 'read_file',
    });

    await collector.recordUsage({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      inputTokens: 500,
      outputTokens: 250,
      toolName: 'write_file',
    });

    const today = new Date();
    const stats = await collector.getDailyStats(today);

    expect(stats!.toolUsage).toHaveLength(2);
    expect(stats!.toolUsage[0].tool).toBe('read_file');
    expect(stats!.toolUsage[0].count).toBe(2);
    expect(stats!.toolUsage[0].tokens).toBe(4500);
  });

  it('should return null for days with no data', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const stats = await collector.getDailyStats(yesterday);
    expect(stats).toBeNull();
  });

  it('should get top tools across date range', async () => {
    const today = new Date();

    await collector.recordUsage({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      inputTokens: 5000,
      outputTokens: 2500,
      toolName: 'read_file',
    });

    await collector.recordUsage({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      inputTokens: 1000,
      outputTokens: 500,
      toolName: 'write_file',
    });

    const topTools = await collector.getTopTools(3, today);

    expect(topTools).toHaveLength(2);
    expect(topTools[0].tool).toBe('read_file');
    expect(topTools[0].tokens).toBe(7500);
  });
});
