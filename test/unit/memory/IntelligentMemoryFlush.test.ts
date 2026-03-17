// ============================================================
// IntelligentMemoryFlush 测试
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntelligentMemoryFlush } from '@/memory/IntelligentMemoryFlush';
import type { FlushContext, Evaluation } from '@/memory/IntelligentMemoryFlush';
import type { ILLMProvider, ProviderConfig } from '@/core/types';
import type { Message } from '@/core/types';
import type { MemoryManager } from '@/memory/MemoryManager';

describe('IntelligentMemoryFlush', () => {
  let mockProvider: ILLMProvider;
  let mockMemoryManager: MemoryManager;
  let flush: IntelligentMemoryFlush;

  beforeEach(() => {
    // Mock LLM Provider
    mockProvider = {
      name: 'mock-provider',
      models: ['mock-model'],
      isSupported: () => true,
      stream: vi.fn(async function* () {
        yield {
          type: 'text_delta' as const,
          text: JSON.stringify({
            segments: [
              {
                category: 'topic',
                content: 'User prefers Bun over npm',
                topicId: 'user-preferences',
                memoryType: 'user_preference',
                importance: 'high',
                valueScore: 90,
              },
              {
                category: 'timeline',
                content: 'Discussed memory system architecture',
                importance: 'medium',
                valueScore: 70,
              },
              {
                category: 'discard',
                content: 'Greeting and small talk',
                valueScore: 10,
              },
            ],
            totalValue: 85,
            summary: 'Extracted 1 topic and 1 timeline segment',
          }),
        };
        yield {
          type: 'end' as const,
          stopReason: 'end_turn' as const,
        };
      }),
    };

    // Mock MemoryManager
    mockMemoryManager = {
      add: vi.fn(async () => {}),
    } as unknown as MemoryManager;

    const providerConfig: ProviderConfig = {
      model: 'mock-model',
      lightModel: 'mock-light-model',
      temperature: 0.3,
      maxTokens: 1000,
    };

    flush = new IntelligentMemoryFlush(
      mockProvider,
      providerConfig,
      mockMemoryManager,
      {
        tokenThreshold: 0.75,
        timeThreshold: 30 * 60 * 1000,
        valueThreshold: 50,
        autoDiscard: true,
        keepRecentMessages: 5,
      }
    );
  });

  describe('checkAndFlush', () => {
    it('应该在 token 超过阈值时触发刷新', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const context: FlushContext = {
        messages,
        currentTokens: 8000,
        maxTokens: 10000,
        timeSinceLastFlush: 10 * 60 * 1000, // 10 分钟
      };

      const flushed = await flush.checkAndFlush(context);

      expect(flushed).toBe(true);
      expect(mockMemoryManager.add).toHaveBeenCalledTimes(2); // topic + timeline
    });

    it('应该在时间超过阈值时触发刷新', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const context: FlushContext = {
        messages,
        currentTokens: 3000,
        maxTokens: 10000,
        timeSinceLastFlush: 40 * 60 * 1000, // 40 分钟
      };

      const flushed = await flush.checkAndFlush(context);

      expect(flushed).toBe(true);
      expect(mockMemoryManager.add).toHaveBeenCalled();
    });

    it('应该在未达到阈值时不触发刷新', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const context: FlushContext = {
        messages,
        currentTokens: 3000,
        maxTokens: 10000,
        timeSinceLastFlush: 10 * 60 * 1000, // 10 分钟
      };

      const flushed = await flush.checkAndFlush(context);

      expect(flushed).toBe(false);
      expect(mockMemoryManager.add).not.toHaveBeenCalled();
    });

    it('应该清理消息历史，保留最近 N 条', async () => {
      const messages: Message[] = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Response 2' },
        { role: 'user', content: 'Message 3' },
        { role: 'assistant', content: 'Response 3' },
        { role: 'user', content: 'Message 4' },
        { role: 'assistant', content: 'Response 4' },
      ];

      const context: FlushContext = {
        messages,
        currentTokens: 8000,
        maxTokens: 10000,
        timeSinceLastFlush: 10 * 60 * 1000,
      };

      await flush.checkAndFlush(context);

      // 应该保留最近 5 条消息
      expect(messages).toHaveLength(5);
      expect(messages[0].content).toBe('Response 2');
      expect(messages[4].content).toBe('Response 4');
    });

    it('应该跳过 discard 类型的片段', async () => {
      const context: FlushContext = {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
        ],
        currentTokens: 8000,
        maxTokens: 10000,
        timeSinceLastFlush: 10 * 60 * 1000,
      };

      await flush.checkAndFlush(context);

      // 只保存了 topic 和 timeline，discard 被跳过
      expect(mockMemoryManager.add).toHaveBeenCalledTimes(2);

      const calls = (mockMemoryManager.add as ReturnType<typeof vi.fn>).mock.calls;
      const categories = calls.map(call => call[0].category);

      expect(categories).toContain('topic');
      expect(categories).toContain('timeline');
      expect(categories).not.toContain('discard');
    });

    it('应该跳过价值评分低于阈值的片段', async () => {
      // 修改 mock provider 返回低价值片段
      mockProvider.stream = vi.fn(async function* () {
        yield {
          type: 'text_delta' as const,
          text: JSON.stringify({
            segments: [
              {
                category: 'timeline',
                content: 'Low value content',
                valueScore: 30, // 低于阈值 50
              },
              {
                category: 'topic',
                content: 'High value content',
                topicId: 'general',
                memoryType: 'decision',
                valueScore: 80,
              },
            ],
            totalValue: 55,
            summary: '1 high value, 1 low value',
          }),
        };
      });

      const context: FlushContext = {
        messages: [{ role: 'user', content: 'Test' }],
        currentTokens: 8000,
        maxTokens: 10000,
        timeSinceLastFlush: 10 * 60 * 1000,
      };

      await flush.checkAndFlush(context);

      // 只保存了高价值片段
      expect(mockMemoryManager.add).toHaveBeenCalledTimes(1);
      const call = (mockMemoryManager.add as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0].content).toBe('High value content');
    });
  });

  describe('parseEvaluation', () => {
    it('应该解析 JSON 格式的评估结果', () => {
      const jsonResponse = JSON.stringify({
        segments: [
          {
            category: 'topic',
            content: 'Test content',
            topicId: 'test',
            valueScore: 80,
          },
        ],
        totalValue: 80,
        summary: 'Test summary',
      });

      // @ts-ignore - 访问私有方法
      const evaluation = flush.parseEvaluation(jsonResponse);

      expect(evaluation.segments).toHaveLength(1);
      expect(evaluation.segments[0].category).toBe('topic');
      expect(evaluation.totalValue).toBe(80);
    });

    it('应该解析带代码块包裹的 JSON', () => {
      const response = `\`\`\`json
{
  "segments": [
    {
      "category": "timeline",
      "content": "Test",
      "valueScore": 70
    }
  ],
  "totalValue": 70,
  "summary": "Test"
}
\`\`\``;

      // @ts-ignore - 访问私有方法
      const evaluation = flush.parseEvaluation(response);

      expect(evaluation.segments).toHaveLength(1);
      expect(evaluation.segments[0].category).toBe('timeline');
    });
  });

  describe('fallback evaluation', () => {
    it('应该在 LLM 失败时使用降级评估', async () => {
      // Mock provider 抛出错误
      mockProvider.stream = vi.fn(async function* () {
        throw new Error('LLM API failed');
      });

      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const context: FlushContext = {
        messages,
        currentTokens: 8000,
        maxTokens: 10000,
        timeSinceLastFlush: 10 * 60 * 1000,
      };

      const flushed = await flush.checkAndFlush(context);

      // 应该仍然执行刷新（使用降级策略）
      expect(flushed).toBe(true);

      // 降级策略：所有非系统消息归为 timeline
      expect(mockMemoryManager.add).toHaveBeenCalledTimes(2);

      const calls = (mockMemoryManager.add as ReturnType<typeof vi.fn>).mock.calls;
      const categories = calls.map(call => call[0].category);

      expect(categories.every(c => c === 'timeline')).toBe(true);
    });
  });
});
