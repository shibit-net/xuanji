// ============================================================
// TopicExtractor 测试
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TopicExtractor } from '@/memory/TopicExtractor';
import type { MemoryEntry } from '@/memory/types';
import type { ILLMProvider } from '@/core/types';

describe('TopicExtractor', () => {
  let mockProvider: ILLMProvider;
  let extractor: TopicExtractor;

  beforeEach(() => {
    // Mock LLM Provider
    mockProvider = {
      name: 'mock-provider',
      models: ['mock-model'],
      isSupported: () => true,
      stream: vi.fn(async function* () {
        yield {
          type: 'text_delta' as const,
          text: 'User prefers Bun over npm for package management',
        };
        yield {
          type: 'end' as const,
          stopReason: 'end_turn' as const,
        };
      }),
    };

    extractor = new TopicExtractor({
      llmProvider: mockProvider,
      providerConfig: {
        model: 'mock-model',
        temperature: 0.2,
        maxTokens: 200,
      },
      mergeThreshold: 0.85,
      minEntriesForExtraction: 2,
    });
  });

  describe('extractTopicsFromTimeline', () => {
    it('应该从 timeline 记忆中提取主题', async () => {
      const timelineMemories: MemoryEntry[] = [
        {
          id: 'mem-timeline-001',
          category: 'timeline',
          dayKey: '2026-03-16',
          type: 'session_summary',
          content: 'User mentioned preferring Bun over npm',
          keywords: ['bun', 'npm', 'package'], // 使用 'package' 而不是 'preference'
          source: 'session',
          confidence: 0.8,
          createdAt: '2026-03-16T09:00:00Z',
          lastAccessedAt: '2026-03-16T09:00:00Z',
          accessCount: 1,
        },
        {
          id: 'mem-timeline-002',
          category: 'timeline',
          dayKey: '2026-03-16',
          type: 'session_summary',
          content: 'Discussed Bun installation and usage',
          keywords: ['bun', 'install', 'package'],
          source: 'session',
          confidence: 0.8,
          createdAt: '2026-03-16T10:00:00Z',
          lastAccessedAt: '2026-03-16T10:00:00Z',
          accessCount: 1,
        },
      ];

      const extractedTopics = await extractor.extractTopicsFromTimeline(
        timelineMemories,
        []
      );

      expect(extractedTopics).toHaveLength(1);
      const topic = extractedTopics[0];

      expect(topic.category).toBe('topic');
      expect(topic.topicId).toBe('package-manager'); // 明确期望的 topicId
      expect(topic.content).toBe('User prefers Bun over npm for package management');
      expect(topic.relatedMemories).toHaveLength(2);
      expect(topic.relatedMemories).toContain('mem-timeline-001');
      expect(topic.relatedMemories).toContain('mem-timeline-002');
      expect(topic.extractedFrom).toBe('mem-timeline-001');
    });

    it('应该跳过条目数不足的主题组', async () => {
      const timelineMemories: MemoryEntry[] = [
        {
          id: 'mem-timeline-001',
          category: 'timeline',
          dayKey: '2026-03-16',
          type: 'session_summary',
          content: 'Single isolated memory',
          keywords: ['isolated'],
          source: 'session',
          confidence: 0.8,
          createdAt: '2026-03-16T09:00:00Z',
          lastAccessedAt: '2026-03-16T09:00:00Z',
          accessCount: 1,
        },
      ];

      const extractedTopics = await extractor.extractTopicsFromTimeline(
        timelineMemories,
        []
      );

      // 应该返回空，因为只有 1 条记忆（< minEntriesForExtraction=2）
      expect(extractedTopics).toHaveLength(0);
    });

    it('应该推断正确的 topicId', async () => {
      const timelineMemories: MemoryEntry[] = [
        {
          id: 'mem-timeline-001',
          category: 'timeline',
          type: 'error_resolution',
          content: 'Fixed bug in authentication',
          keywords: ['bug', 'fix', 'error', 'debug'],
          source: 'session',
          confidence: 0.8,
          createdAt: '2026-03-16T09:00:00Z',
          lastAccessedAt: '2026-03-16T09:00:00Z',
          accessCount: 1,
        },
        {
          id: 'mem-timeline-002',
          category: 'timeline',
          type: 'error_resolution',
          content: 'Debugged memory leak issue',
          keywords: ['debug', 'error', 'memory'],
          source: 'session',
          confidence: 0.8,
          createdAt: '2026-03-16T10:00:00Z',
          lastAccessedAt: '2026-03-16T10:00:00Z',
          accessCount: 1,
        },
      ];

      const extractedTopics = await extractor.extractTopicsFromTimeline(
        timelineMemories,
        []
      );

      expect(extractedTopics).toHaveLength(1);
      // 应该推断为 'debugging' topicId（因为有 'debug', 'error', 'bug' 关键词）
      expect(extractedTopics[0].topicId).toBe('debugging');
      expect(extractedTopics[0].type).toBe('error_resolution');
    });

    it('应该推断正确的重要性', async () => {
      const highImportanceSource: MemoryEntry = {
        id: 'mem-timeline-001',
        category: 'timeline',
        type: 'user_preference',
        content: 'User preference 1',
        keywords: ['preference'],
        source: 'session',
        confidence: 0.8,
        createdAt: '2026-03-16T09:00:00Z',
        lastAccessedAt: '2026-03-16T09:00:00Z',
        accessCount: 1,
        metadata: { importance: 'high' },
      };

      const normalSource: MemoryEntry = {
        id: 'mem-timeline-002',
        category: 'timeline',
        type: 'user_preference',
        content: 'User preference 2',
        keywords: ['preference'],
        source: 'session',
        confidence: 0.8,
        createdAt: '2026-03-16T10:00:00Z',
        lastAccessedAt: '2026-03-16T10:00:00Z',
        accessCount: 1,
      };

      const extractedTopics = await extractor.extractTopicsFromTimeline(
        [highImportanceSource, normalSource],
        []
      );

      expect(extractedTopics).toHaveLength(1);
      // 因为有一个来源记忆是 high importance，提取的 topic 也应该是 high
      expect(extractedTopics[0].metadata?.importance).toBe('high');
    });

    it('应该在没有 timeline 记忆时返回空数组', async () => {
      const extractedTopics = await extractor.extractTopicsFromTimeline([], []);
      expect(extractedTopics).toHaveLength(0);
    });
  });
});
