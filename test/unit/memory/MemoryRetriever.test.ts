// ============================================================
// MemoryRetriever 单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { MemoryRetriever } from '@/memory/MemoryRetriever';
import type { MemoryEntry } from '@/memory/types';

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

describe('MemoryRetriever', () => {
  const retriever = new MemoryRetriever(30);

  describe('extractQueryKeywords', () => {
    it('should extract words and filter stop words', () => {
      const keywords = retriever.extractQueryKeywords('Fix the bug in MemoryManager');
      expect(keywords).toContain('fix');
      expect(keywords).toContain('memorymanager');
      expect(keywords).not.toContain('the');
      expect(keywords).not.toContain('in');
    });

    it('should extract file paths', () => {
      const keywords = retriever.extractQueryKeywords('Read src/memory/types.ts');
      expect(keywords.some((k) => k.includes('src/memory/types.ts'))).toBe(true);
    });
  });

  describe('retrieve', () => {
    it('should return entries matching keywords', () => {
      const memories = [
        createEntry({ id: '1', keywords: ['typescript', 'memory'], content: 'TypeScript memory system' }),
        createEntry({ id: '2', keywords: ['python', 'django'], content: 'Python Django app' }),
        createEntry({ id: '3', keywords: ['typescript', 'testing'], content: 'TypeScript testing guide' }),
      ];

      const results = retriever.retrieve('typescript memory', memories);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.id).toBe('1'); // 最相关
    });

    it('should respect maxResults', () => {
      const memories = Array.from({ length: 20 }, (_, i) =>
        createEntry({ id: `${i}`, keywords: ['common'], content: `Entry ${i}` }),
      );

      const results = retriever.retrieve('common', memories, { maxResults: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should filter by minConfidence', () => {
      const memories = [
        createEntry({ id: '1', keywords: ['test'], confidence: 0.9 }),
        createEntry({ id: '2', keywords: ['test'], confidence: 0.2 }),
      ];

      const results = retriever.retrieve('test', memories, { minConfidence: 0.5 });
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe('1');
    });

    it('should filter by types', () => {
      const memories = [
        createEntry({ id: '1', type: 'decision', keywords: ['test'] }),
        createEntry({ id: '2', type: 'error_resolution', keywords: ['test'] }),
        createEntry({ id: '3', type: 'project_fact', keywords: ['test'] }),
      ];

      const results = retriever.retrieve('test', memories, { types: ['decision'] });
      expect(results).toHaveLength(1);
      expect(results[0]?.type).toBe('decision');
    });

    it('should return empty for empty query', () => {
      const memories = [createEntry({ keywords: ['test'] })];
      const results = retriever.retrieve('', memories);
      expect(results).toEqual([]);
    });

    it('should prefer higher confidence entries', () => {
      const memories = [
        createEntry({ id: '1', keywords: ['bug', 'fix'], confidence: 0.5 }),
        createEntry({ id: '2', keywords: ['bug', 'fix'], confidence: 0.95 }),
      ];

      const results = retriever.retrieve('bug fix', memories);
      expect(results[0]?.id).toBe('2');
    });

    it('should consider content text matching', () => {
      const memories = [
        createEntry({ id: '1', keywords: ['test'], content: 'unrelated content' }),
        createEntry({ id: '2', keywords: ['test'], content: 'fix memory leak in MemoryManager' }),
      ];

      const results = retriever.retrieve('memory leak', memories);
      expect(results[0]?.id).toBe('2');
    });

    it('should filter out overdue deadlines (> 7 days)', () => {
      const now = new Date();
      const memories = [
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

      const results = retriever.retrieve('deadline birthday', memories);
      
      // 过期 deadline 不应出现
      expect(results.find(e => e.id === 'deadline-old')).toBeUndefined();
      // 未过期 deadline 应该出现
      expect(results.find(e => e.id === 'deadline-future')).toBeDefined();
      // 生日应该出现
      expect(results.find(e => e.id === 'birthday')).toBeDefined();
    });
  });
});
