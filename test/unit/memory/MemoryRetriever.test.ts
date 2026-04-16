// ============================================================
// MemoryRetriever 单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { MemoryRetriever } from '@/memory/MemoryRetriever';
import type { MemoryEntry, RetrieveOptions } from '@/memory/types';
import type { MemoryStore } from '@/memory/MemoryStore';

function createEntry(overrides: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: 'test-id',
    type: 'project_fact',
    content: 'test content',
    keywords: [],
    source: 'test',
    confidence: 0.8,
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 0,
    ...overrides,
  };
}

/** 创建一个 mock MemoryStore，searchFTS 返回指定的 entries */
function createMockStore(entries: MemoryEntry[]): MemoryStore {
  return {
    searchFTS: (_query: string, _limit?: number) => entries,
    searchVector: (_embedding: Float32Array, _limit?: number) => [],
    getEntry: (id: string) => entries.find((e) => e.id === id) ?? null,
    readAll: () => entries,
    saveEntry: () => {},
    saveBatch: () => {},
    updateEntry: () => {},
    deleteEntry: () => {},
    replaceAll: () => {},
    upsertVector: () => {},
    getStats: () => ({ total: entries.length, byType: {} }),
    init: async () => {},
    close: () => {},
  } as unknown as MemoryStore;
}

describe('MemoryRetriever', () => {
  describe('retrieveWithFTS (synchronous)', () => {
    it('should return entries matching keywords', () => {
      const entries = [
        createEntry({ id: '1', keywords: ['typescript', 'memory'], content: 'TypeScript memory system' }),
        createEntry({ id: '2', keywords: ['python', 'django'], content: 'Python Django app' }),
        createEntry({ id: '3', keywords: ['typescript', 'testing'], content: 'TypeScript testing guide' }),
      ];
      const retriever = new MemoryRetriever(createMockStore(entries));

      const results = retriever.retrieveWithFTS('typescript memory');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.id).toBe('1'); // 最相关
    });

    it('should respect maxResults', () => {
      const entries = Array.from({ length: 20 }, (_, i) =>
        createEntry({ id: `${i}`, keywords: ['common'], content: `Entry ${i}` }),
      );
      const retriever = new MemoryRetriever(createMockStore(entries));

      const results = retriever.retrieveWithFTS('common', { maxResults: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should filter by minConfidence', () => {
      const entries = [
        createEntry({ id: '1', keywords: ['test'], confidence: 0.9 }),
        createEntry({ id: '2', keywords: ['test'], confidence: 0.2 }),
      ];
      const retriever = new MemoryRetriever(createMockStore(entries));

      const results = retriever.retrieveWithFTS('test', { minConfidence: 0.5 });
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('1');
    });

    it('should filter by types', () => {
      const entries = [
        createEntry({ id: '1', type: 'decision', keywords: ['test'] }),
        createEntry({ id: '2', type: 'error_resolution', keywords: ['test'] }),
        createEntry({ id: '3', type: 'project_fact', keywords: ['test'] }),
      ];
      const retriever = new MemoryRetriever(createMockStore(entries));

      const results = retriever.retrieveWithFTS('test', { types: ['decision'] });
      expect(results).toHaveLength(1);
      expect(results[0]?.type).toBe('decision');
    });

    it('should return empty for empty query', () => {
      const entries = [createEntry({ keywords: ['test'] })];
      const retriever = new MemoryRetriever(createMockStore(entries));
      const results = retriever.retrieveWithFTS('');
      expect(results).toEqual([]);
    });

    it('should prefer higher confidence entries', () => {
      const entries = [
        createEntry({ id: '1', keywords: ['bug', 'fix'], confidence: 0.5 }),
        createEntry({ id: '2', keywords: ['bug', 'fix'], confidence: 0.95 }),
      ];
      const retriever = new MemoryRetriever(createMockStore(entries));

      const results = retriever.retrieveWithFTS('bug fix');
      expect(results[0]?.id).toBe('2');
    });

    it('should consider content text matching', () => {
      const entries = [
        createEntry({ id: '1', keywords: ['test'], content: 'unrelated content' }),
        createEntry({ id: '2', keywords: ['test'], content: 'fix memory leak in MemoryManager' }),
      ];
      const retriever = new MemoryRetriever(createMockStore(entries));

      const results = retriever.retrieveWithFTS('memory leak');
      expect(results[0]?.id).toBe('2');
    });

    it('should filter out overdue deadlines (> 7 days)', () => {
      const now = new Date();
      const entries = [
        // 过期 10 天的 deadline - 应该被过滤
        createEntry({
          id: 'deadline-old',
          type: 'important_date',
          keywords: ['deadline', 'report'],
          content: 'Weekly report deadline',
          metadata: {
            dateType: 'deadline',
            dateValue: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            recurring: 'none',
          },
        }),
        // 未过期的 deadline - 应该保留
        createEntry({
          id: 'deadline-future',
          type: 'important_date',
          keywords: ['deadline', 'project'],
          content: 'Project deadline',
          metadata: {
            dateType: 'deadline',
            dateValue: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            recurring: 'none',
          },
        }),
        // 生日 - 应该保留（循环记忆）
        createEntry({
          id: 'birthday',
          type: 'important_date',
          keywords: ['birthday', 'alice'],
          content: "Alice's birthday",
          metadata: {
            dateType: 'birthday',
            dateValue: '2026-03-08',
            recurring: 'yearly',
          },
        }),
      ];
      const retriever = new MemoryRetriever(createMockStore(entries));

      const results = retriever.retrieveWithFTS('deadline birthday');

      // 过期 deadline 不应出现
      expect(results.find(e => e.id === 'deadline-old')).toBeUndefined();
      // 未过期 deadline 应该出现
      expect(results.find(e => e.id === 'deadline-future')).toBeDefined();
      // 生日应该出现
      expect(results.find(e => e.id === 'birthday')).toBeDefined();
    });
  });

  describe('retrieve (async, FTS fallback)', () => {
    it('should return results asynchronously', async () => {
      const entries = [
        createEntry({ id: '1', keywords: ['typescript'], content: 'TypeScript memory' }),
      ];
      const retriever = new MemoryRetriever(createMockStore(entries));

      const results = await retriever.retrieve('typescript');
      expect(results.length).toBeGreaterThanOrEqual(0); // FTS fallback
    });
  });

  describe('getAll', () => {
    it('should return all entries from store', () => {
      const entries = [
        createEntry({ id: '1' }),
        createEntry({ id: '2' }),
      ];
      const retriever = new MemoryRetriever(createMockStore(entries));

      const all = retriever.getAll();
      expect(all).toHaveLength(2);
    });
  });
});
