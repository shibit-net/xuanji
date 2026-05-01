// ============================================================
// UsageStatsRecorder 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { UsageStatsRecorder, type UsageRecord } from '@/core/telemetry/UsageStatsRecorder';

function todayFile(base: string, name: string): string {
  const today = new Date().toISOString().split('T')[0];
  return join(base, `${name}-${today}.jsonl`);
}

describe('UsageStatsRecorder', () => {
  let tempDir: string;
  let testFilePath: string;
  let recorder: UsageStatsRecorder;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xuanji-usage-test-'));
    testFilePath = todayFile(tempDir, 'usage');
    recorder = new UsageStatsRecorder(join(tempDir, 'usage.jsonl'));
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // ── 基础记录 ──

  it('should record usage stats', async () => {
    const record: UsageRecord = {
      timestamp: new Date().toISOString(),
      sessionId: 'session-1',
      model: 'claude-sonnet-4',
      input: 1234,
      output: 567,
      cacheRead: 100,
      cacheWrite: 50,
      durationMs: 5678,
      iterations: 3,
      toolCalls: [
        { name: 'read_file', count: 2, durationMs: 100, errorCount: 0 },
        { name: 'bash', count: 1, durationMs: 500, errorCount: 0 },
      ],
    };

    await recorder.record(record);

    const content = await readFile(testFilePath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as UsageRecord;
    expect(parsed.model).toBe('claude-sonnet-4');
    expect(parsed.input).toBe(1234);
    expect(parsed.iterations).toBe(3);
    expect(parsed.toolCalls).toHaveLength(2);
  });

  it('should record without optional fields', async () => {
    const record: UsageRecord = {
      timestamp: new Date().toISOString(),
      model: 'gpt-4o',
      input: 500,
      output: 200,
      durationMs: 3000,
    };

    await recorder.record(record);

    const records = await recorder.query();
    expect(records).toHaveLength(1);
    expect(records[0].toolCalls).toBeUndefined();
    expect(records[0].iterations).toBeUndefined();
  });

  it('should append multiple records', async () => {
    for (let i = 0; i < 5; i++) {
      await recorder.record({
        timestamp: new Date().toISOString(),
        model: 'test-model',
        input: i * 100,
        output: i * 50,
        durationMs: i * 1000,
      });
    }

    const records = await recorder.query();
    expect(records).toHaveLength(5);
  });

  // ── 查询过滤 ──

  it('should filter by model', async () => {
    await recorder.record({
      timestamp: new Date().toISOString(),
      model: 'claude-sonnet-4',
      input: 100, output: 50, durationMs: 1000,
    });
    await recorder.record({
      timestamp: new Date().toISOString(),
      model: 'gpt-4o',
      input: 200, output: 100, durationMs: 2000,
    });
    await recorder.record({
      timestamp: new Date().toISOString(),
      model: 'claude-sonnet-4',
      input: 300, output: 150, durationMs: 3000,
    });

    const claudeRecords = await recorder.query({ model: 'claude-sonnet-4' });
    expect(claudeRecords).toHaveLength(2);

    const gptRecords = await recorder.query({ model: 'gpt-4o' });
    expect(gptRecords).toHaveLength(1);
  });

  it('should filter by time range', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    await recorder.record({
      timestamp: twoDaysAgo.toISOString(),
      model: 'test', input: 100, output: 50, durationMs: 1000,
    });
    await recorder.record({
      timestamp: yesterday.toISOString(),
      model: 'test', input: 200, output: 100, durationMs: 2000,
    });
    await recorder.record({
      timestamp: now.toISOString(),
      model: 'test', input: 300, output: 150, durationMs: 3000,
    });

    // 仅查最近 1 天
    const recentRecords = await recorder.query({
      startTime: yesterday.toISOString(),
    });
    expect(recentRecords).toHaveLength(2); // yesterday + now
  });

  it('should support limit', async () => {
    for (let i = 0; i < 10; i++) {
      await recorder.record({
        timestamp: new Date().toISOString(),
        model: 'test', input: i * 100, output: i * 50, durationMs: 1000,
      });
    }

    const limited = await recorder.query({ limit: 3 });
    expect(limited).toHaveLength(3);
    // limit 取最后 3 条
    expect(limited[0].input).toBe(700);
    expect(limited[2].input).toBe(900);
  });

  // ── 聚合统计 ──

  it('should aggregate by model', async () => {
    await recorder.record({
      timestamp: new Date().toISOString(),
      model: 'claude-sonnet-4',
      input: 100, output: 50, cacheRead: 10, cacheWrite: 5, durationMs: 1000, iterations: 2,
    });
    await recorder.record({
      timestamp: new Date().toISOString(),
      model: 'claude-sonnet-4',
      input: 200, output: 100, cacheRead: 20, cacheWrite: 10, durationMs: 2000, iterations: 3,
    });
    await recorder.record({
      timestamp: new Date().toISOString(),
      model: 'gpt-4o',
      input: 300, output: 150, durationMs: 3000, iterations: 1,
    });

    const stats = await recorder.aggregate();

    // 总计
    expect(stats.total.sessionCount).toBe(3);
    expect(stats.total.input).toBe(600);
    expect(stats.total.output).toBe(300);
    expect(stats.total.cacheRead).toBe(30);
    expect(stats.total.cacheWrite).toBe(15);
    expect(stats.total.durationMs).toBe(6000);
    expect(stats.total.iterations).toBe(6);

    // 按模型
    expect(stats.byModel['claude-sonnet-4'].sessionCount).toBe(2);
    expect(stats.byModel['claude-sonnet-4'].totalInput).toBe(300);
    expect(stats.byModel['claude-sonnet-4'].totalOutput).toBe(150);
    expect(stats.byModel['claude-sonnet-4'].totalCacheRead).toBe(30);

    expect(stats.byModel['gpt-4o'].sessionCount).toBe(1);
    expect(stats.byModel['gpt-4o'].totalInput).toBe(300);
  });

  it('should aggregate by tool', async () => {
    await recorder.record({
      timestamp: new Date().toISOString(),
      model: 'test',
      input: 100, output: 50, durationMs: 1000,
      toolCalls: [
        { name: 'read_file', count: 3, durationMs: 150, errorCount: 0 },
        { name: 'bash', count: 1, durationMs: 500, errorCount: 0 },
      ],
    });
    await recorder.record({
      timestamp: new Date().toISOString(),
      model: 'test',
      input: 200, output: 100, durationMs: 2000,
      toolCalls: [
        { name: 'read_file', count: 2, durationMs: 100, errorCount: 1 },
        { name: 'write_file', count: 1, durationMs: 200, errorCount: 0 },
      ],
    });

    const stats = await recorder.aggregate();

    // read_file: 3+2=5 次, 150+100=250ms, 0+1=1 错误
    expect(stats.byTool['read_file'].callCount).toBe(5);
    expect(stats.byTool['read_file'].totalDurationMs).toBe(250);
    expect(stats.byTool['read_file'].errorCount).toBe(1);
    expect(stats.byTool['read_file'].avgDurationMs).toBe(50); // 250/5

    // bash: 1 次
    expect(stats.byTool['bash'].callCount).toBe(1);
    expect(stats.byTool['bash'].totalDurationMs).toBe(500);
    expect(stats.byTool['bash'].avgDurationMs).toBe(500);

    // write_file: 1 次
    expect(stats.byTool['write_file'].callCount).toBe(1);
    expect(stats.byTool['write_file'].errorCount).toBe(0);
  });

  it('should aggregate with time range filter', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    await recorder.record({
      timestamp: twoDaysAgo.toISOString(),
      model: 'test', input: 100, output: 50, durationMs: 1000,
    });
    await recorder.record({
      timestamp: now.toISOString(),
      model: 'test', input: 200, output: 100, durationMs: 2000,
    });

    const stats = await recorder.aggregate({ startTime: yesterday.toISOString() });
    expect(stats.total.sessionCount).toBe(1);
    expect(stats.total.input).toBe(200);
  });

  it('should return empty stats when no records', async () => {
    const stats = await recorder.aggregate();
    expect(stats.total.sessionCount).toBe(0);
    expect(stats.total.input).toBe(0);
    expect(stats.total.output).toBe(0);
    expect(Object.keys(stats.byModel)).toHaveLength(0);
    expect(Object.keys(stats.byTool)).toHaveLength(0);
  });

  it('should track time range in aggregated stats', async () => {
    const t1 = '2026-02-20T10:00:00.000Z';
    const t2 = '2026-02-25T15:00:00.000Z';

    await recorder.record({
      timestamp: t1,
      model: 'test', input: 100, output: 50, durationMs: 1000,
    });
    await recorder.record({
      timestamp: t2,
      model: 'test', input: 200, output: 100, durationMs: 2000,
    });

    const stats = await recorder.aggregate();
    expect(stats.timeRange.start).toBe(t1);
    expect(stats.timeRange.end).toBe(t2);
  });

  // ── 容错处理 ──

  it('should silently handle write failures', async () => {
    const badRecorder = new UsageStatsRecorder('/proc/nonexistent/usage.jsonl');

    await expect(
      badRecorder.record({
        timestamp: new Date().toISOString(),
        model: 'test', input: 100, output: 50, durationMs: 1000,
      }),
    ).resolves.not.toThrow();
  });

  it('should return empty array for non-existent file', async () => {
    const records = await recorder.query();
    expect(records).toEqual([]);
  });

  // ── 清空 ──

  it('should clear all records', async () => {
    await recorder.record({
      timestamp: new Date().toISOString(),
      model: 'test', input: 100, output: 50, durationMs: 1000,
    });

    expect(existsSync(testFilePath)).toBe(true);
    await recorder.clear();
    expect(existsSync(testFilePath)).toBe(false);
  });
});
