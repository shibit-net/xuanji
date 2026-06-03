// ============================================================
// SessionRecorder 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { SessionRecorder, type SessionRecord } from '@/infrastructure/telemetry/SessionRecorder';
import { getUTC8DateString } from '@/shared/utils/time/formatters';

function todayFile(base: string, name: string): string {
  return join(base, `${name}-${getUTC8DateString()}.jsonl`);
}

describe('SessionRecorder', () => {
  let tempDir: string;
  let testFilePath: string;
  let recorder: SessionRecorder;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xuanji-test-'));
    testFilePath = todayFile(tempDir, 'sessions');
    recorder = new SessionRecorder(join(tempDir, 'sessions.jsonl'));
  });

  afterEach(async () => {
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should append record to JSONL file', async () => {
    const record: SessionRecord = {
      timestamp: new Date().toISOString(),
      model: 'claude-sonnet-4',
      input: 1234,
      output: 567,
      durationMs: 5678,
    };

    await recorder.record(record);

    const content = await readFile(testFilePath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(record);
  });

  it('should create file if not exists', async () => {
    expect(existsSync(testFilePath)).toBe(false);

    await recorder.record({
      timestamp: new Date().toISOString(),
      model: 'test',
      input: 100,
      output: 50,
      durationMs: 1000,
    });

    expect(existsSync(testFilePath)).toBe(true);
  });

  it('should handle concurrent writes', async () => {
    const records: SessionRecord[] = Array.from({ length: 10 }, (_, i) => ({
      timestamp: new Date().toISOString(),
      model: 'claude-sonnet-4',
      input: i * 100,
      output: i * 50,
      durationMs: i * 1000,
    }));

    await Promise.all(records.map((r) => recorder.record(r)));

    const content = await readFile(testFilePath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(10);
  });

  it('should read last N records', async () => {
    // 写入 5 条记录
    for (let i = 0; i < 5; i++) {
      await recorder.record({
        timestamp: new Date().toISOString(),
        model: 'claude-sonnet-4',
        input: i * 100,
        output: i * 50,
        durationMs: i * 1000,
      });
    }

    // 读取最后 3 条 (从后往前)
    const records = await recorder.readRecords(3);
    expect(records).toHaveLength(3);
    // 最后写入的是 input=400, 倒数第二是 input=300, 倒数第三是 input=200
    expect(records[0].input).toBe(400);
    expect(records[1].input).toBe(300);
    expect(records[2].input).toBe(200);
  });

  it('should handle malformed lines gracefully', async () => {
    // 写入正常记录
    await recorder.record({
      timestamp: new Date().toISOString(),
      model: 'test',
      input: 100,
      output: 50,
      durationMs: 1000,
    });

    // 手动追加格式错误的行
    const fs = await import('node:fs/promises');
    await fs.appendFile(testFilePath, 'invalid json\n', 'utf-8');
    await recorder.record({
      timestamp: new Date().toISOString(),
      model: 'test2',
      input: 200,
      output: 100,
      durationMs: 2000,
    });

    // 读取记录，应该跳过格式错误的行
    const records = await recorder.readRecords();
    expect(records).toHaveLength(2);
    expect(records[0].model).toBe('test2');
    expect(records[1].model).toBe('test');
  });

  it('should clear all records', async () => {
    // 写入记录
    await recorder.record({
      timestamp: new Date().toISOString(),
      model: 'test',
      input: 100,
      output: 50,
      durationMs: 1000,
    });

    expect(existsSync(testFilePath)).toBe(true);

    // 清空
    await recorder.clear();

    expect(existsSync(testFilePath)).toBe(false);
  });

  it('should handle cache tokens', async () => {
    const record: SessionRecord = {
      timestamp: new Date().toISOString(),
      model: 'claude-sonnet-4',
      input: 1234,
      output: 567,
      cacheRead: 100,
      cacheWrite: 50,
      durationMs: 5678,
    };

    await recorder.record(record);

    const content = await readFile(testFilePath, 'utf-8');
    const parsed = JSON.parse(content.trim()) as SessionRecord;
    expect(parsed.cacheRead).toBe(100);
    expect(parsed.cacheWrite).toBe(50);
  });
});
