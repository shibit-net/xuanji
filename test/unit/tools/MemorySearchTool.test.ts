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
import { MemoryStore } from '@/memory/MemoryStore';
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

/** 创建隔离的 MemoryManager，使用临时数据库路径 */
function createIsolatedManager(dbPath: string, projectDir: string): MemoryManager {
  const manager = new MemoryManager({}, projectDir);
  (manager as any).store = new MemoryStore(dbPath);
  return manager;
}

describe('MemorySearchTool', () => {
  let tool: MemorySearchTool;
  let tempDir: string;
  let tempProjectDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'xuanji-search-'));
    tempProjectDir = await mkdtemp(join(tmpdir(), 'xuanji-search-proj-'));
    const dbPath = join(tempDir, 'memory.db');

    manager = createIsolatedManager(dbPath, tempProjectDir);
    await manager.init();

    // 写入测试数据
    const entries: MemoryEntry[] = [
      createEntry({
        id: 'mem-food-1',
        type: 'user_preference',
        content: 'Does not eat spicy food, prefers mild cuisine',
        keywords: ['food', 'spicy', 'preference', 'mild'],
        confidence: 0.9,
      }),
      createEntry({
        id: 'mem-food-2',
        type: 'user_preference',
        content: 'Allergic to peanuts',
        keywords: ['allergy', 'peanuts', 'food', 'health'],
        confidence: 0.95,
      }),
      createEntry({
        id: 'mem-rel-1',
        type: 'relationship',
        content: 'Alice likes Japanese cuisine',
        keywords: ['Alice', 'japanese', 'cuisine', 'preference'],
        confidence: 0.85,
      }),
      createEntry({
        id: 'mem-date-1',
        type: 'important_date',
        content: "Alice's birthday is March 8th",
        keywords: ['Alice', 'birthday', 'march'],
        confidence: 0.95,
      }),
      createEntry({
        id: 'mem-dec-1',
        type: 'decision',
        content: 'Decided to use TypeScript for new project',
        keywords: ['typescript', 'decision', 'project'],
        confidence: 0.9,
      }),
    ];

    const store = manager.getStore();
    for (const entry of entries) {
      store.saveEntry(entry);
    }

    tool = new MemorySearchTool();
    tool.setMemoryManager(manager);
  });

  afterEach(async () => {
    for (const dir of [tempDir, tempProjectDir]) {
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
    const emptyDir = await mkdtemp(join(tmpdir(), 'xuanji-search-empty-'));
    const emptyProjDir = await mkdtemp(join(tmpdir(), 'xuanji-search-emptyp-'));
    const emptyManager = createIsolatedManager(join(emptyDir, 'memory.db'), emptyProjDir);
    await emptyManager.init();

    const emptyTool = new MemorySearchTool();
    emptyTool.setMemoryManager(emptyManager);

    const result = await emptyTool.execute({
      query: 'anything',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('No relevant memories');
    expect(result.metadata?.count).toBe(0);

    await rm(emptyDir, { recursive: true, force: true });
    await rm(emptyProjDir, { recursive: true, force: true });
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
      const hasTypeLabel = result.content.includes('User Preference')
        || result.content.includes('Relationship')
        || result.content.includes('Important Date')
        || result.content.includes('Decision');
      expect(hasTypeLabel).toBe(true);
    }
  });
});
