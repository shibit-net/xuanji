// ============================================================
// MemoryStoreTool 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { MemoryStoreTool } from '@/core/tools/MemoryStoreTool';
import { MemoryManager } from '@/memory/MemoryManager';
import { MemoryStore } from '@/memory/MemoryStore';

/** 创建隔离的 MemoryManager，使用临时数据库路径 */
function createIsolatedManager(dbPath: string, projectDir: string): MemoryManager {
  const manager = new MemoryManager({}, projectDir);
  (manager as any).store = new MemoryStore(dbPath);
  return manager;
}

describe('MemoryStoreTool', () => {
  let tool: MemoryStoreTool;
  let tempDir: string;
  let tempProjectDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xuanji-store-'));
    tempProjectDir = await mkdtemp(join(tmpdir(), 'xuanji-store-proj-'));

    manager = createIsolatedManager(join(tempDir, 'memory.db'), tempProjectDir);
    await manager.init();

    tool = new MemoryStoreTool();
    tool.setMemoryManager(manager);
  });

  afterEach(async () => {
    for (const dir of [tempDir, tempProjectDir]) {
      if (existsSync(dir)) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('should store user_preference memory', async () => {
    const result = await tool.execute({
      type: 'user_preference',
      content: 'Does not eat spicy food',
      keywords: ['food', 'spicy', 'preference'],
      confidence: 0.9,
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('Memory stored');
    expect(result.content).toContain('user_preference');

    // 验证写入 SQLite
    const stats = await manager.getStats();
    expect(stats.total).toBe(1);
    expect(stats.byType['user_preference']).toBe(1);
  });

  it('should store relationship memory', async () => {
    const result = await tool.execute({
      type: 'relationship',
      content: 'Alice likes Japanese cuisine',
      keywords: ['Alice', 'japanese', 'cuisine'],
      confidence: 0.85,
    });

    expect(result.isError).toBe(false);

    const stats = await manager.getStats();
    expect(stats.total).toBe(1);
    expect(stats.byType['relationship']).toBe(1);
  });

  it('should store important_date memory', async () => {
    const result = await tool.execute({
      type: 'important_date',
      content: "Alice's birthday is March 8th",
      keywords: ['Alice', 'birthday', 'march'],
      confidence: 0.95,
    });

    expect(result.isError).toBe(false);

    const stats = await manager.getStats();
    expect(stats.total).toBe(1);
  });

  it('should use default confidence of 0.8', async () => {
    const result = await tool.execute({
      type: 'user_fact',
      content: 'Works as a software engineer',
      keywords: ['software', 'engineer', 'job'],
      // no confidence provided
    });

    expect(result.isError).toBe(false);
    expect(result.metadata?.confidence).toBe(0.8);
  });

  it('should reject missing type', async () => {
    const result = await tool.execute({
      content: 'Some content',
      keywords: ['test'],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('type');
  });

  it('should reject empty content', async () => {
    const result = await tool.execute({
      type: 'user_preference',
      content: '',
      keywords: ['test'],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('content');
  });

  it('should reject empty keywords array', async () => {
    const result = await tool.execute({
      type: 'user_preference',
      content: 'Some preference',
      keywords: [],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('keywords');
  });

  it('should reject confidence below 0.6', async () => {
    const result = await tool.execute({
      type: 'user_preference',
      content: 'Some preference',
      keywords: ['test'],
      confidence: 0.3,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('confidence');
  });

  it('should reject confidence above 1.0', async () => {
    const result = await tool.execute({
      type: 'user_preference',
      content: 'Some preference',
      keywords: ['test'],
      confidence: 1.5,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('confidence');
  });

  it('should error when memory manager is not set', async () => {
    const toolWithoutManager = new MemoryStoreTool();

    const result = await toolWithoutManager.execute({
      type: 'user_preference',
      content: 'Some preference',
      keywords: ['test'],
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('not available');
  });

  it('should lowercase and trim keywords', async () => {
    const result = await tool.execute({
      type: 'user_preference',
      content: 'Prefers dark mode',
      keywords: [' Dark ', 'MODE', '  Editor  '],
    });

    expect(result.isError).toBe(false);

    // 验证关键词已规范化（通过检索验证）
    const results = await manager.retrieve('dark mode editor');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.keywords).toEqual(['dark', 'mode', 'editor']);
  });

  it('should have correct tool metadata', () => {
    expect(tool.name).toBe('memory_store');
    expect(tool.readonly).toBe(false);
    expect(tool.input_schema.required).toContain('type');
    expect(tool.input_schema.required).toContain('content');
    expect(tool.input_schema.required).toContain('keywords');
  });
});
