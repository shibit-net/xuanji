// ============================================================
// MemoryCompactor 单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { MemoryCompactor } from '@/memory/MemoryCompactor';
import type { SessionMemory, MemoryEntry } from '@/memory/types';

function createSession(overrides: Partial<SessionMemory> = {}): SessionMemory {
  return {
    sessionId: 'sess-123',
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    userMessages: ['Fix the bug in MemoryManager'],
    assistantHighlights: ['I found the issue and fixed it'],
    toolCalls: [
      { name: 'read_file', input: { file_path: 'src/memory/MemoryManager.ts' }, isError: false, resultSummary: 'file content' },
      { name: 'edit_file', input: { file_path: 'src/memory/MemoryManager.ts' }, isError: false, resultSummary: 'edited' },
    ],
    durationMs: 5000,
    model: 'claude-sonnet-4',
    ...overrides,
  };
}

function createEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'entry-1',
    type: 'project_fact',
    content: 'test content',
    keywords: ['test'],
    source: 'test',
    confidence: 0.8,
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    accessCount: 0,
    ...overrides,
  };
}

describe('MemoryCompactor', () => {
  const compactor = new MemoryCompactor();

  describe('compactSession', () => {
    it('should generate session summary', () => {
      const session = createSession();
      const entries = compactor.compactSession(session);

      expect(entries.length).toBeGreaterThan(0);
      const summary = entries.find((e) => e.type === 'session_summary');
      expect(summary).toBeDefined();
      expect(summary?.content).toContain('用户需求');
      expect(summary?.content).toContain('read_file');
    });

    it('should extract tool patterns for frequently used tools', () => {
      const session = createSession({
        toolCalls: [
          { name: 'read_file', input: {}, isError: false, resultSummary: 'ok' },
          { name: 'read_file', input: {}, isError: false, resultSummary: 'ok' },
          { name: 'read_file', input: {}, isError: false, resultSummary: 'ok' },
          { name: 'edit_file', input: {}, isError: false, resultSummary: 'ok' },
        ],
      });

      const entries = compactor.compactSession(session);
      const toolPattern = entries.find((e) => e.type === 'tool_pattern');
      expect(toolPattern).toBeDefined();
      expect(toolPattern?.content).toContain('read_file');
    });

    it('should extract error resolutions', () => {
      const session = createSession({
        toolCalls: [
          { name: 'edit_file', input: {}, isError: true, resultSummary: 'File not found' },
          { name: 'edit_file', input: {}, isError: false, resultSummary: 'Successfully edited' },
        ],
      });

      const entries = compactor.compactSession(session);
      const resolution = entries.find((e) => e.type === 'error_resolution');
      expect(resolution).toBeDefined();
      expect(resolution?.content).toContain('File not found');
    });

    it('should extract decisions from Chinese text', () => {
      const session = createSession({
        userMessages: ['决定使用 TypeScript 重写整个模块'],
      });

      const entries = compactor.compactSession(session);
      const decision = entries.find((e) => e.type === 'decision');
      expect(decision).toBeDefined();
    });

    it('should handle empty session', () => {
      const session = createSession({
        userMessages: [],
        assistantHighlights: [],
        toolCalls: [],
      });

      const entries = compactor.compactSession(session);
      // 可能只有一条空摘要
      expect(entries.length).toBeLessThanOrEqual(1);
    });
  });

  describe('compactLongTerm', () => {
    it('should remove expired entries', () => {
      const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 年前
      const entries = [
        createEntry({ id: '1', createdAt: oldDate, confidence: 0.3, accessCount: 0 }),
        createEntry({ id: '2', createdAt: new Date().toISOString(), confidence: 0.8 }),
      ];

      const compacted = compactor.compactLongTerm(entries);
      expect(compacted).toHaveLength(1);
      expect(compacted[0]?.id).toBe('2');
    });

    it('should keep frequently accessed old entries', () => {
      const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const entries = [
        createEntry({ id: '1', createdAt: oldDate, accessCount: 10 }),
      ];

      const compacted = compactor.compactLongTerm(entries);
      expect(compacted).toHaveLength(1);
    });

    it('should merge overlapping entries', () => {
      const entries = [
        createEntry({ id: '1', keywords: ['typescript', 'memory', 'manager'], content: 'v1' }),
        createEntry({ id: '2', keywords: ['typescript', 'memory', 'manager'], content: 'v2', confidence: 0.9 }),
      ];

      const compacted = compactor.compactLongTerm(entries);
      expect(compacted).toHaveLength(1);
      // 应保留置信度更高的
      expect(compacted[0]?.confidence).toBe(0.9);
    });

    it('should respect max entries limit', () => {
      const entries = Array.from({ length: 1500 }, (_, i) =>
        createEntry({
          id: `${i}`,
          keywords: [`unique-${i}`], // 不同关键词，不会被合并
        }),
      );

      const compacted = compactor.compactLongTerm(entries);
      expect(compacted.length).toBeLessThanOrEqual(1000);
    });
  });
});
