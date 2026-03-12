// ============================================================
// DailyUsageStats 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { DailyUsageStats } from '@/core/telemetry/DailyUsageStats';
import { UsageStatsRecorder, type UsageRecord } from '@/core/telemetry/UsageStatsRecorder';
import { PricingResolver } from '@/core/agent/PricingResolver';

describe('DailyUsageStats', () => {
  let tempDir: string;
  let usageFilePath: string;
  let dailyFilePath: string;
  let recorder: UsageStatsRecorder;
  let stats: DailyUsageStats;
  let pricingResolver: PricingResolver;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xuanji-daily-stats-test-'));
    usageFilePath = join(tempDir, 'usage.jsonl');
    dailyFilePath = join(tempDir, 'daily.json');

    recorder = new UsageStatsRecorder(usageFilePath);
    pricingResolver = new PricingResolver();
    stats = new DailyUsageStats(pricingResolver, recorder, dailyFilePath);
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // ── 辅助函数 ──

  async function recordUsage(record: UsageRecord): Promise<void> {
    await recorder.record(record);
  }

  function createRecord(
    date: string,
    model: string,
    input: number,
    output: number,
    toolCalls?: { name: string; count: number }[],
  ): UsageRecord {
    return {
      timestamp: new Date(`${date}T10:00:00Z`).toISOString(),
      model,
      input,
      output,
      durationMs: 5000,
      iterations: 3,
      toolCalls: toolCalls?.map(tc => ({
        name: tc.name,
        count: tc.count,
        durationMs: 100,
        errorCount: 0,
      })),
    };
  }

  // ── 基础聚合 ──

  it('should aggregate usage by date and model', async () => {
    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 1000, 500));
    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 2000, 800));
    await recordUsage(createRecord('2026-03-09', 'gpt-4o', 1500, 600));

    const records = await stats.aggregate();

    expect(records).toHaveLength(2);

    const sonnet = records.find(r => r.model === 'claude-sonnet-4')!;
    expect(sonnet).toBeDefined();
    expect(sonnet.date).toBe('2026-03-09');
    expect(sonnet.totalCalls).toBe(2);
    expect(sonnet.inputTokens).toBe(3000);
    expect(sonnet.outputTokens).toBe(1300);
    expect(sonnet.totalTokens).toBe(4300);

    const gpt = records.find(r => r.model === 'gpt-4o')!;
    expect(gpt).toBeDefined();
    expect(gpt.totalCalls).toBe(1);
    expect(gpt.inputTokens).toBe(1500);
  });

  it('should aggregate across multiple days', async () => {
    await recordUsage(createRecord('2026-03-07', 'claude-sonnet-4', 1000, 500));
    await recordUsage(createRecord('2026-03-08', 'claude-sonnet-4', 2000, 800));
    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 1500, 600));

    const records = await stats.aggregate();

    expect(records).toHaveLength(3);
    // 按日期降序排序
    expect(records[0].date).toBe('2026-03-09');
    expect(records[1].date).toBe('2026-03-08');
    expect(records[2].date).toBe('2026-03-07');
  });

  it('should aggregate tool calls', async () => {
    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 1000, 500, [
      { name: 'read_file', count: 3 },
      { name: 'bash', count: 1 },
    ]));
    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 2000, 800, [
      { name: 'read_file', count: 2 },
      { name: 'edit_file', count: 1 },
    ]));

    const records = await stats.aggregate();

    expect(records).toHaveLength(1);
    expect(records[0].tools).toEqual({
      read_file: 5,
      bash: 1,
      edit_file: 1,
    });
  });

  it('should handle cache tokens', async () => {
    await recordUsage({
      ...createRecord('2026-03-09', 'claude-sonnet-4', 1000, 500),
      cacheRead: 200,
      cacheWrite: 100,
    });

    const records = await stats.aggregate();

    expect(records).toHaveLength(1);
    expect(records[0].cacheReadTokens).toBe(200);
    expect(records[0].cacheWriteTokens).toBe(100);
  });

  // ── 日期范围聚合 ──

  it('should aggregate within date range', async () => {
    await recordUsage(createRecord('2026-03-05', 'claude-sonnet-4', 1000, 500));
    await recordUsage(createRecord('2026-03-07', 'claude-sonnet-4', 2000, 800));
    await recordUsage(createRecord('2026-03-10', 'claude-sonnet-4', 1500, 600));

    const startDate = new Date('2026-03-06');
    const endDate = new Date('2026-03-09');
    const records = await stats.aggregate(startDate, endDate);

    expect(records).toHaveLength(1);
    expect(records[0].date).toBe('2026-03-07');
  });

  // ── 查询接口 ──

  it('should query by date', async () => {
    await recordUsage(createRecord('2026-03-07', 'claude-sonnet-4', 1000, 500));
    await recordUsage(createRecord('2026-03-08', 'claude-sonnet-4', 2000, 800));
    await recordUsage(createRecord('2026-03-09', 'gpt-4o', 1500, 600));

    await stats.aggregateAndSave();

    const records = await stats.getDaily('2026-03-08');
    expect(records).toHaveLength(1);
    expect(records[0].date).toBe('2026-03-08');
  });

  it('should query by date range', async () => {
    await recordUsage(createRecord('2026-03-07', 'claude-sonnet-4', 1000, 500));
    await recordUsage(createRecord('2026-03-08', 'claude-sonnet-4', 2000, 800));
    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 1500, 600));

    await stats.aggregateAndSave();

    const records = await stats.getRange('2026-03-07', '2026-03-08');
    expect(records).toHaveLength(2);
    expect(records.every(r => r.date >= '2026-03-07' && r.date <= '2026-03-08')).toBe(true);
  });

  it('should query by model', async () => {
    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 1000, 500));
    await recordUsage(createRecord('2026-03-09', 'gpt-4o', 2000, 800));

    await stats.aggregateAndSave();

    const records = await stats.getByModel('claude-sonnet-4');
    expect(records).toHaveLength(1);
    expect(records[0].model).toBe('claude-sonnet-4');
  });

  it('should query with multiple filters', async () => {
    await recordUsage(createRecord('2026-03-07', 'claude-sonnet-4', 1000, 500));
    await recordUsage(createRecord('2026-03-08', 'claude-sonnet-4', 2000, 800));
    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 1500, 600));
    await recordUsage(createRecord('2026-03-09', 'gpt-4o', 1500, 600));

    await stats.aggregateAndSave();

    const records = await stats.query({
      model: 'claude-sonnet-4',
      startDate: '2026-03-08',
      endDate: '2026-03-09',
      limit: 1,
    });

    expect(records).toHaveLength(1);
    expect(records[0].model).toBe('claude-sonnet-4');
    expect(records[0].date).toBe('2026-03-09'); // 按日期降序，取第一个
  });

  // ── 工具排行 ──

  it('should return top tools', async () => {
    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 1000, 500, [
      { name: 'read_file', count: 10 },
      { name: 'bash', count: 5 },
      { name: 'edit_file', count: 3 },
      { name: 'write_file', count: 2 },
    ]));

    await stats.aggregateAndSave();

    const topTools = await stats.getTopTools(3);

    expect(topTools).toHaveLength(3);
    expect(topTools[0].name).toBe('read_file');
    expect(topTools[0].count).toBe(10);
    expect(topTools[1].name).toBe('bash');
    expect(topTools[2].name).toBe('edit_file');
  });

  it('should aggregate tool counts across dates', async () => {
    await recordUsage(createRecord('2026-03-08', 'claude-sonnet-4', 1000, 500, [
      { name: 'read_file', count: 5 },
    ]));
    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 1000, 500, [
      { name: 'read_file', count: 7 },
    ]));

    await stats.aggregateAndSave();

    const topTools = await stats.getTopTools(10);

    expect(topTools).toHaveLength(1);
    expect(topTools[0].name).toBe('read_file');
    expect(topTools[0].count).toBe(12);
  });

  // ── 费用趋势 ──

  it('should return cost trend', async () => {
    await recordUsage(createRecord('2026-03-07', 'claude-sonnet-4', 1000, 500));
    await recordUsage(createRecord('2026-03-08', 'claude-sonnet-4', 2000, 800));
    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 1500, 600));

    await stats.aggregateAndSave();

    const trend = await stats.getCostTrend(3);

    expect(trend).toHaveLength(3);
    expect(trend[0].date).toBe('2026-03-07');
    expect(trend[1].date).toBe('2026-03-08');
    expect(trend[2].date).toBe('2026-03-09');
    // 所有日期都应该有费用值（有数据或 0）
    expect(trend.every(t => t.cost >= 0)).toBe(true);
  });

  it('should fill missing dates with zero cost', async () => {
    await recordUsage(createRecord('2026-03-07', 'claude-sonnet-4', 1000, 500));
    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 1500, 600));

    await stats.aggregateAndSave();

    const trend = await stats.getCostTrend(3);

    expect(trend).toHaveLength(3);
    expect(trend[0].cost).toBeGreaterThan(0); // 2026-03-07
    expect(trend[1].cost).toBe(0); // 2026-03-08 (缺失)
    expect(trend[2].cost).toBeGreaterThan(0); // 2026-03-09
  });

  // ── 增量聚合 ──

  it('should merge records when aggregating', async () => {
    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 1000, 500));
    await stats.aggregateAndSave();

    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 2000, 800));
    await stats.aggregateAndSave();

    const records = await stats.getDaily('2026-03-09');

    expect(records).toHaveLength(1);
    expect(records[0].totalCalls).toBe(2);
    expect(records[0].inputTokens).toBe(3000);
    expect(records[0].outputTokens).toBe(1300);
  });

  it('should preserve existing data when adding new dates', async () => {
    await recordUsage(createRecord('2026-03-07', 'claude-sonnet-4', 1000, 500));
    await stats.aggregateAndSave();

    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 2000, 800));
    await stats.aggregateAndSave();

    const records = await stats.query({});

    expect(records).toHaveLength(2);
    expect(records.find(r => r.date === '2026-03-07')).toBeDefined();
    expect(records.find(r => r.date === '2026-03-09')).toBeDefined();
  });

  // ── 空数据处理 ──

  it('should handle empty usage records', async () => {
    const records = await stats.aggregate();
    expect(records).toEqual([]);

    const daily = await stats.getDaily('2026-03-09');
    expect(daily).toEqual([]);

    const topTools = await stats.getTopTools(10);
    expect(topTools).toEqual([]);
  });

  it('should handle aggregateAndSave with no data', async () => {
    await expect(stats.aggregateAndSave()).resolves.not.toThrow();
  });

  // ── 清空数据 ──

  it('should clear aggregated data', async () => {
    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 1000, 500));
    await stats.aggregateAndSave();

    await stats.clear();

    const records = await stats.getDaily('2026-03-09');
    expect(records).toEqual([]);
  });

  // ── 排序 ──

  it('should sort by date descending and model ascending', async () => {
    await recordUsage(createRecord('2026-03-09', 'gpt-4o', 1000, 500));
    await recordUsage(createRecord('2026-03-09', 'claude-sonnet-4', 1000, 500));
    await recordUsage(createRecord('2026-03-08', 'claude-sonnet-4', 1000, 500));

    const records = await stats.aggregate();

    expect(records).toHaveLength(3);
    expect(records[0].date).toBe('2026-03-09');
    expect(records[0].model).toBe('claude-sonnet-4');
    expect(records[1].date).toBe('2026-03-09');
    expect(records[1].model).toBe('gpt-4o');
    expect(records[2].date).toBe('2026-03-08');
  });
});
