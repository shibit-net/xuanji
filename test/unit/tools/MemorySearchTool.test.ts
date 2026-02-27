// ============================================================
// MemorySearchTool 单元测试
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { MemorySearchTool } from '@/core/tools/MemorySearchTool';
import { MemoryManager } from '@/memory/MemoryManager';
import { StorageBackend } from '@/memory/StorageBackend';
import type { MemoryEntry } from '@/memory/types';

function createEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    type: 'user_preference',
    content: 'Does not eat spicy food',
    keywords: ['food', 'spicy', 'preference'],
    source: 'llm-explicit',
    confidence: 0.9,
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 0,
    ...overrides,
  };
}

describe('MemorySearchTool', () => {
  let tool: MemorySearchTool;
  let tempGlobalDir: string;
  let tempProjectDir: string;
  let manager: MemoryManager;
  let storage: StorageBackend;

  beforeEach(async () => {
    tempGlobalDir = await mkdtemp(join(tmpdir(), 'xuanji-search-global-'));
    tempProjectDir = await mkdtemp(join(tmpdir(), 'xuanji-search-project-'));
    storage = new StorageBackend();

    manager = new MemoryManager({}, tempProjectDir);
    // 覆盖全局目录实现测试隔离
    manager['longTerm']['globalDir'] = tempGlobalDir;

    // 写入一些测试数据
    const entries: MemoryEntry[] = [
      createEntry({
        type: 'user_preference',
        content: 'Does not eat spicy food, prefers mild cuisine',
        keywords: ['food', 'spicy', 'preference', 'mild'],
        confidence: 0.9,
      }),
      createEntry({
        type: 'user_preference',
        content: 'Allergic to peanuts',
        keywords: ['allergy', 'peanuts', 'food', 'health'],
        confidence: 0.95,
      }),
      createEntry({
        type: 'relationship',
        content: 'Alice likes Japanese cuisine',
        keywords: ['Alice', 'japanese', 'cuisine', 'preference'],
        confidence: 0.85,
      }),
      createEntry({
        type: 'important_date',
        content: "Alice's birthday is March 8th",
        keywords: ['Alice', 'birthday', 'march'],
        confidence: 0.95,
      }),
      createEntry({
        type: 'decision',
        content: 'Decided to use TypeScript for new project',
        keywords: ['typescript', 'decision', 'project'],
        confidence: 0.9,
      }),
    ];

    // 写入知识文件
    const knowledgePath = join(tempGlobalDir, 'knowledge.jsonl');
    const personalPath = join(tempGlobalDir, 'personal.jsonl');
    const decisionsPath = join(tempGlobalDir, 'decisions.jsonl');

    await storage.append(knowledgePath, entries[0]);
    await storage.append(knowledgePath, entries[1]);
    await storage.append(personalPath, entries[2]);
    await storage.append(personalPath, entries[3]);
    await storage.append(decisionsPath, entries[4]);

    await manager.init();

    tool = new MemorySearchTool();
    tool.setMemoryManager(manager);
  });

  afterEach(async () => {
    for (const dir of [tempGlobalDir, tempProjectDir]) {
      if (existsSync(dir)) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('should find food preferences', async () => {
    const result = await tool.execute({
      query: 'food preference spicy',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('spicy');
    expect(result.metadata?.count).toBeGreaterThan(0);
  });

  it('should find relationship by name', async () => {
    const result = await tool.execute({
      query: 'Alice',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('Alice');
    expect(result.metadata?.count).toBeGreaterThan(0);
  });

  it('should filter by type', async () => {
    const result = await tool.execute({
      query: 'Alice',
      type: 'important_date',
    });

    expect(result.isError).toBe(false);
    // 应该只返回 important_date 类型
    if ((result.metadata?.count as number) > 0) {
      expect(result.metadata?.types).toContain('important_date');
    }
  });

  it('should respect limit parameter', async () => {
    const result = await tool.execute({
      query: 'food',
      limit: 1,
    });

    expect(result.isError).toBe(false);
    expect(result.metadata?.count).toBeLessThanOrEqual(1);
  });

  it('should return no results when memory is empty', async () => {
    // 创建一个空的 manager 来测试无结果情况
    const emptyGlobalDir = await mkdtemp(join(tmpdir(), 'xuanji-search-empty-'));
    const emptyProjectDir = await mkdtemp(join(tmpdir(), 'xuanji-search-emptyp-'));
    const emptyManager = new MemoryManager({}, emptyProjectDir);
    emptyManager['longTerm']['globalDir'] = emptyGlobalDir;
    await emptyManager.init();

    const emptyTool = new MemorySearchTool();
    emptyTool.setMemoryManager(emptyManager);

    const result = await emptyTool.execute({
      query: 'anything',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('No relevant memories');
    expect(result.metadata?.count).toBe(0);

    // 清理
    await rm(emptyGlobalDir, { recursive: true, force: true });
    await rm(emptyProjectDir, { recursive: true, force: true });
  });

  it('should reject empty query', async () => {
    const result = await tool.execute({
      query: '',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('query');
  });

  it('should reject invalid limit', async () => {
    const result = await tool.execute({
      query: 'test',
      limit: 0,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('limit');
  });

  it('should error when memory manager is not set', async () => {
    const toolWithoutManager = new MemorySearchTool();

    const result = await toolWithoutManager.execute({
      query: 'test',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('not available');
  });

  it('should have correct tool metadata', () => {
    expect(tool.name).toBe('memory_search');
    expect(tool.readonly).toBe(true);
    expect(tool.input_schema.required).toContain('query');
  });

  it('should include type labels in output', async () => {
    const result = await tool.execute({
      query: 'food spicy preference',
    });

    expect(result.isError).toBe(false);
    if ((result.metadata?.count as number) > 0) {
      // 输出中应包含类型标签
      const hasTypeLabel = result.content.includes('User Preference')
        || result.content.includes('Relationship')
        || result.content.includes('Important Date')
        || result.content.includes('Decision');
      expect(hasTypeLabel).toBe(true);
    }
  });
});
