/**
 * 集成测试：智能记忆刷新 + 主题提取
 *
 * 测试记忆系统的关键集成点：
 * 1. IntelligentMemoryFlush 与 MemoryManager 的集成
 * 2. 触发条件（token 阈值 / 时间阈值）工作正常
 * 3. TopicExtractor 与 MemoryManager 的集成
 * 4. 配置驱动的功能初始化
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── 被测模块 ───
import { MemoryManager } from '@/memory/MemoryManager';
import type { Message } from '@/session/types';

// ─── Mock Provider ───
class MockProvider {
  public callCount = 0;
  public lastMessages: any[] = [];

  async *stream(_messages: any[], _tools: any[], _config: any) {
    this.callCount++;

    const responseText = JSON.stringify({
      segments: [
        {
          category: 'topic',
          content: '测试主题内容',
          topicId: 'test-topic',
          memoryType: 'user_preference',
          importance: 'high',
          valueScore: 75,
        },
      ],
      totalValue: 75,
      summary: '提取了 1 个测试主题',
    });

    // 模拟流式输出
    for (const char of responseText) {
      yield {
        type: 'text_delta' as const,
        text: char,
      };
    }
  }

  async createMessage(messages: any[], _tools: any[], _config: any) {
    this.callCount++;
    this.lastMessages = messages;
    return {
      id: `msg-${this.callCount}`,
      model: 'mock-model',
      role: 'assistant' as const,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            segments: [
              {
                category: 'topic' as const,
                content: '测试主题内容',
                keywords: ['test', 'topic'],
                confidence: 0.8,
                value: 75,
              },
            ],
          }),
        },
      ],
      stop_reason: 'end_turn' as const,
      usage: { input_tokens: 100, output_tokens: 50 },
    };
  }

  getLastRequest() {
    return { messages: this.lastMessages };
  }

  reset() {
    this.callCount = 0;
    this.lastMessages = [];
  }
}

// ─── 临时目录 ───
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'xuanji-flush-e2e-'));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

// ═════════════════════════════════════════════════════════════
// 1. IntelligentMemoryFlush 集成测试
// ═════════════════════════════════════════════════════════════

describe('IntelligentMemoryFlush Integration', () => {
  it('MemoryManager 初始化后可获取 IntelligentMemoryFlush 实例', async () => {
    const memoryManager = new MemoryManager({
      enabled: true,
      intelligentFlush: {
        enabled: true,
        tokenThreshold: 0.75,
      },
    });

    await memoryManager.init();

    const mockProvider = new MockProvider();
    memoryManager.setProvider(mockProvider as any, {
      model: 'mock-model',
      lightModel: 'mock-light-model',
    });

    const intelligentFlush = memoryManager.getIntelligentFlush();
    expect(intelligentFlush).toBeDefined();
    expect(intelligentFlush).not.toBeNull();

    await memoryManager.shutdown();
  });

  it('Token 阈值触发条件检测', async () => {
    const memoryManager = new MemoryManager({
      enabled: true,
      intelligentFlush: {
        enabled: true,
        tokenThreshold: 0.5, // 50% 触发
        timeThreshold: 999999999, // 时间阈值设得很大，不会触发
      },
    });

    await memoryManager.init();

    const mockProvider = new MockProvider();
    memoryManager.setProvider(mockProvider as any, {
      model: 'mock-model',
      lightModel: 'mock-light-model',
    });

    const intelligentFlush = memoryManager.getIntelligentFlush();

    // 构造未达阈值的上下文
    const lowTokenContext = {
      messages: [{ role: 'user' as const, content: '短消息' }],
      currentTokens: 100,
      maxTokens: 1000,
      timeSinceLastFlush: 1000,
    };

    const shouldFlushLow = (intelligentFlush as any).shouldFlush(lowTokenContext);
    expect(shouldFlushLow).toBe(false);

    // 构造达到阈值的上下文
    const highTokenContext = {
      messages: [{ role: 'user' as const, content: 'x'.repeat(2000) }],
      currentTokens: 600, // 60% > 50%
      maxTokens: 1000,
      timeSinceLastFlush: 1000,
    };

    const shouldFlushHigh = (intelligentFlush as any).shouldFlush(highTokenContext);
    expect(shouldFlushHigh).toBe(true);

    await memoryManager.shutdown();
  });

  it('时间阈值触发条件检测', async () => {
    const memoryManager = new MemoryManager({
      enabled: true,
      intelligentFlush: {
        enabled: true,
        tokenThreshold: 1.0, // Token 阈值 100%，不会触发
        timeThreshold: 1000, // 1 秒
      },
    });

    await memoryManager.init();

    const mockProvider = new MockProvider();
    memoryManager.setProvider(mockProvider as any, {
      model: 'mock-model',
      lightModel: 'mock-light-model',
    });

    const intelligentFlush = memoryManager.getIntelligentFlush();

    // 时间未超过阈值
    const shortTimeContext = {
      messages: [{ role: 'user' as const, content: '消息' }],
      currentTokens: 100,
      maxTokens: 10000,
      timeSinceLastFlush: 500, // 0.5 秒 < 1 秒
    };

    const shouldFlushShort = (intelligentFlush as any).shouldFlush(shortTimeContext);
    expect(shouldFlushShort).toBe(false);

    // 时间超过阈值
    const longTimeContext = {
      messages: [{ role: 'user' as const, content: '消息' }],
      currentTokens: 100,
      maxTokens: 10000,
      timeSinceLastFlush: 1500, // 1.5 秒 > 1 秒
    };

    const shouldFlushLong = (intelligentFlush as any).shouldFlush(longTimeContext);
    expect(shouldFlushLong).toBe(true);

    await memoryManager.shutdown();
  });

  it('checkAndFlush 完整流程（使用 Mock Provider）', async () => {
    const memoryManager = new MemoryManager({
      enabled: true,
      intelligentFlush: {
        enabled: true,
        tokenThreshold: 0.5,
        timeThreshold: 1000,
        valueThreshold: 0,
        keepRecentMessages: 2,
      },
    });

    await memoryManager.init();

    const mockProvider = new MockProvider();
    memoryManager.setProvider(mockProvider as any, {
      model: 'mock-model',
      lightModel: 'mock-light-model',
    });

    const intelligentFlush = memoryManager.getIntelligentFlush();

    const context = {
      messages: [
        { role: 'user' as const, content: '消息1' },
        { role: 'assistant' as const, content: '回复1' },
        { role: 'user' as const, content: '消息2' },
        { role: 'assistant' as const, content: '回复2' },
      ] as Message[],
      currentTokens: 600,
      maxTokens: 1000,
      timeSinceLastFlush: 1000,
      sessionId: 'test-session',
    };

    const flushed = await intelligentFlush!.checkAndFlush(context);
    expect(flushed).toBe(true);

    // 验证 Mock Provider 被调用
    expect(mockProvider.callCount).toBeGreaterThan(0);

    // 验证消息被修剪（keepRecentMessages: 2）
    expect(context.messages.length).toBeLessThanOrEqual(2);

    await memoryManager.shutdown();
  });
});

// ═════════════════════════════════════════════════════════════
// 2. TopicExtractor 集成测试
// ═════════════════════════════════════════════════════════════

describe('TopicExtractor Integration', () => {
  it('MemoryManager 可以调用 extractTopics', async () => {
    const memoryManager = new MemoryManager({
      enabled: true,
      topicExtraction: {
        enabled: true,
        minEntriesForExtraction: 1,
      },
    });

    await memoryManager.init();

    const mockProvider = new MockProvider();
    memoryManager.setProvider(mockProvider as any, {
      model: 'mock-model',
      lightModel: 'mock-light-model',
    });

    // 添加一些 timeline 记忆
    const longTerm = memoryManager.getLongTermMemory();
    const dayKey = new Date().toISOString().split('T')[0];

    await longTerm.saveBatch([
      {
        id: 'mem-timeline-1',
        type: 'session_summary',
        category: 'timeline',
        dayKey,
        content: '讨论了 TypeScript 类型系统',
        keywords: ['typescript', 'types'],
        confidence: 0.9,
        source: 'conversation',
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        accessCount: 0,
      },
      {
        id: 'mem-timeline-2',
        type: 'session_summary',
        category: 'timeline',
        dayKey,
        content: '实现了泛型约束功能',
        keywords: ['generic', 'constraint'],
        confidence: 0.85,
        source: 'conversation',
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        accessCount: 0,
      },
    ]);

    // 调用主题提取
    await memoryManager.extractTopics(dayKey);

    // 由于 Mock Provider 返回 JSON，验证不抛错即可
    expect(true).toBe(true);

    await memoryManager.shutdown();
  });
});

// ═════════════════════════════════════════════════════════════
// 3. 配置驱动功能测试
// ═════════════════════════════════════════════════════════════

describe('Configuration-Driven Features', () => {
  it('intelligentFlush.enabled = false 时不初始化 IntelligentMemoryFlush', async () => {
    const memoryManager = new MemoryManager({
      enabled: true,
      intelligentFlush: {
        enabled: false,
      },
    });

    await memoryManager.init();

    const mockProvider = new MockProvider();
    memoryManager.setProvider(mockProvider as any, {
      model: 'mock-model',
      lightModel: 'mock-light-model',
    });

    const intelligentFlush = memoryManager.getIntelligentFlush();
    expect(intelligentFlush).toBeNull();

    await memoryManager.shutdown();
  });

  it('自定义配置参数生效', async () => {
    const customConfig = {
      enabled: true,
      intelligentFlush: {
        enabled: true,
        tokenThreshold: 0.6,
        timeThreshold: 2000,
        valueThreshold: 40,
        keepRecentMessages: 3,
      },
    };

    const memoryManager = new MemoryManager(customConfig);
    await memoryManager.init();

    const mockProvider = new MockProvider();
    memoryManager.setProvider(mockProvider as any, {
      model: 'mock-model',
      lightModel: 'mock-light-model',
    });

    const intelligentFlush = memoryManager.getIntelligentFlush();
    expect(intelligentFlush).toBeDefined();

    // 验证配置参数（通过私有字段）
    const config = (intelligentFlush as any).config;
    expect(config.tokenThreshold).toBe(0.6);
    expect(config.timeThreshold).toBe(2000);
    expect(config.valueThreshold).toBe(40);
    expect(config.keepRecentMessages).toBe(3);

    await memoryManager.shutdown();
  });

  it('未提供配置时使用默认值', async () => {
    const memoryManager = new MemoryManager({
      enabled: true,
    });

    await memoryManager.init();

    const mockProvider = new MockProvider();
    memoryManager.setProvider(mockProvider as any, {
      model: 'mock-model',
      lightModel: 'mock-light-model',
    });

    const intelligentFlush = memoryManager.getIntelligentFlush();

    // 默认启用
    expect(intelligentFlush).toBeDefined();

    // 验证默认配置值
    const config = (intelligentFlush as any).config;
    expect(config.tokenThreshold).toBe(0.75);
    expect(config.timeThreshold).toBe(30 * 60 * 1000); // 30 分钟
    expect(config.valueThreshold).toBe(50);
    expect(config.keepRecentMessages).toBe(5);

    await memoryManager.shutdown();
  });
});
