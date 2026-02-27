// ============================================================
// SmartMemoryExtractor 单元测试
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SmartMemoryExtractor } from '@/memory/SmartMemoryExtractor';
import type { SessionMemory, MemoryConfig } from '@/memory/types';
import { DEFAULT_MEMORY_CONFIG } from '@/memory/types';
import type { ILLMProvider, ProviderConfig, StreamEvent, ToolSchema, Message } from '@/core/types';

// ────────── Mock Provider ──────────

function createMockProvider(responseText: string): ILLMProvider {
  return {
    name: 'mock',
    models: ['mock-model'],
    isSupported: () => true,
    stream: async function* (_messages: Message[], _tools: ToolSchema[], _config: ProviderConfig): AsyncIterable<StreamEvent> {
      // 模拟逐字符流式返回
      for (const char of responseText) {
        yield { type: 'text_delta', text: char };
      }
      yield { type: 'end', stopReason: 'end_turn' };
    },
  };
}

function createProviderConfig(): ProviderConfig {
  return {
    model: 'test-model',
    apiKey: 'test-key',
    maxTokens: 4096,
  };
}

function createSession(overrides: Partial<SessionMemory> = {}): SessionMemory {
  return {
    sessionId: `sess-${Date.now()}`,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    userMessages: [],
    assistantHighlights: [],
    toolCalls: [],
    durationMs: 5000,
    model: 'claude-sonnet-4',
    ...overrides,
  };
}

describe('SmartMemoryExtractor', () => {
  const config: MemoryConfig = {
    ...DEFAULT_MEMORY_CONFIG,
    extractorMinConfidence: 0.6,
    extractorTemperature: 0.3,
    extractorTimeout: 60_000,
  };

  describe('extractFromSession', () => {
    it('should extract user_preference from direct statement', async () => {
      const jsonResponse = JSON.stringify([
        {
          type: 'user_preference',
          content: 'Does not eat spicy food, prefers mild Sichuan cuisine',
          keywords: ['food', 'spicy', 'sichuan', 'preference'],
          confidence: 0.9,
        },
      ]);

      const provider = createMockProvider(jsonResponse);
      const extractor = new SmartMemoryExtractor(provider, createProviderConfig(), config);

      const session = createSession({
        userMessages: ['我不吃辣，但微辣可以'],
        assistantHighlights: ['好的，记住了'],
      });

      const entries = await extractor.extractFromSession(session);

      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe('user_preference');
      expect(entries[0].content).toContain('spicy');
      expect(entries[0].confidence).toBe(0.9);
      expect(entries[0].source).toBe('llm-extraction');
      expect(entries[0].id).toMatch(/^mem_/);
    });

    it('should extract relationship memory', async () => {
      const jsonResponse = JSON.stringify([
        {
          type: 'relationship',
          content: 'Alice likes Japanese cuisine',
          keywords: ['Alice', 'japanese', 'cuisine', 'preference'],
          confidence: 0.9,
        },
        {
          type: 'important_date',
          content: "Alice's birthday is March 8th",
          keywords: ['Alice', 'birthday', 'march'],
          confidence: 0.95,
        },
      ]);

      const provider = createMockProvider(jsonResponse);
      const extractor = new SmartMemoryExtractor(provider, createProviderConfig(), config);

      const session = createSession({
        userMessages: ['Alice 特别喜欢吃日料，她生日是 3 月 8 号'],
        assistantHighlights: ['明白，已记录 Alice 的信息'],
      });

      const entries = await extractor.extractFromSession(session);

      expect(entries).toHaveLength(2);
      expect(entries[0].type).toBe('relationship');
      expect(entries[1].type).toBe('important_date');
    });

    it('should filter out entries with low confidence', async () => {
      const jsonResponse = JSON.stringify([
        {
          type: 'user_preference',
          content: 'Might prefer dark mode',
          keywords: ['dark', 'mode', 'editor'],
          confidence: 0.5, // 低于阈值 0.6
        },
        {
          type: 'user_fact',
          content: 'Works as a software engineer',
          keywords: ['software', 'engineer', 'job'],
          confidence: 0.85,
        },
      ]);

      const provider = createMockProvider(jsonResponse);
      const extractor = new SmartMemoryExtractor(provider, createProviderConfig(), config);

      const session = createSession({
        userMessages: ['帮我重构这段代码'],
        assistantHighlights: ['重构完成'],
      });

      const entries = await extractor.extractFromSession(session);

      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe('user_fact');
      expect(entries[0].confidence).toBe(0.85);
    });

    it('should handle empty extraction result', async () => {
      const provider = createMockProvider('[]');
      const extractor = new SmartMemoryExtractor(provider, createProviderConfig(), config);

      const session = createSession({
        userMessages: ['帮我格式化这段代码'],
        assistantHighlights: ['格式化完成'],
      });

      const entries = await extractor.extractFromSession(session);
      expect(entries).toHaveLength(0);
    });

    it('should handle JSON wrapped in code block', async () => {
      const responseText = '```json\n[\n  {\n    "type": "decision",\n    "content": "Decided to use TypeScript",\n    "keywords": ["typescript", "decision"],\n    "confidence": 0.9\n  }\n]\n```';

      const provider = createMockProvider(responseText);
      const extractor = new SmartMemoryExtractor(provider, createProviderConfig(), config);

      const session = createSession({
        userMessages: ['以后都用 TypeScript 吧'],
        assistantHighlights: ['好的'],
      });

      const entries = await extractor.extractFromSession(session);
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe('decision');
    });

    it('should handle malformed JSON gracefully', async () => {
      const provider = createMockProvider('This is not JSON at all');
      const extractor = new SmartMemoryExtractor(provider, createProviderConfig(), config);

      const session = createSession({
        userMessages: ['test'],
      });

      const entries = await extractor.extractFromSession(session);
      expect(entries).toHaveLength(0);
    });

    it('should handle provider error gracefully', async () => {
      const errorProvider: ILLMProvider = {
        name: 'error-mock',
        models: ['mock-model'],
        isSupported: () => true,
        stream: async function* () {
          yield { type: 'error', error: new Error('API Error') } as StreamEvent;
          throw new Error('API Error');
        },
      };

      const extractor = new SmartMemoryExtractor(errorProvider, createProviderConfig(), config);
      const session = createSession({
        userMessages: ['test'],
      });

      const entries = await extractor.extractFromSession(session);
      expect(entries).toHaveLength(0);
    });

    it('should skip entries with missing required fields', async () => {
      const jsonResponse = JSON.stringify([
        {
          type: 'user_preference',
          // 缺少 content
          keywords: ['food'],
          confidence: 0.9,
        },
        {
          type: 'user_fact',
          content: 'Lives in Beijing',
          keywords: ['Beijing', 'location'],
          confidence: 0.85,
        },
      ]);

      const provider = createMockProvider(jsonResponse);
      const extractor = new SmartMemoryExtractor(provider, createProviderConfig(), config);

      const session = createSession({
        userMessages: ['我住在北京'],
      });

      const entries = await extractor.extractFromSession(session);
      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe('user_fact');
    });

    it('should use configured extractor model', async () => {
      let capturedConfig: ProviderConfig | null = null;

      const spyProvider: ILLMProvider = {
        name: 'spy-mock',
        models: ['mock-model'],
        isSupported: () => true,
        stream: async function* (_messages: Message[], _tools: ToolSchema[], config: ProviderConfig) {
          capturedConfig = config;
          yield { type: 'text_delta', text: '[]' };
          yield { type: 'end', stopReason: 'end_turn' };
        },
      };

      const customConfig = {
        ...config,
        extractorModel: 'claude-haiku-3.5',
      };

      const extractor = new SmartMemoryExtractor(spyProvider, createProviderConfig(), customConfig);
      await extractor.extractFromSession(createSession());

      expect(capturedConfig).not.toBeNull();
      expect(capturedConfig!.model).toBe('claude-haiku-3.5');
    });

    it('should use main model when extractorModel is null', async () => {
      let capturedConfig: ProviderConfig | null = null;

      const spyProvider: ILLMProvider = {
        name: 'spy-mock',
        models: ['mock-model'],
        isSupported: () => true,
        stream: async function* (_messages: Message[], _tools: ToolSchema[], config: ProviderConfig) {
          capturedConfig = config;
          yield { type: 'text_delta', text: '[]' };
          yield { type: 'end', stopReason: 'end_turn' };
        },
      };

      const nullModelConfig = {
        ...config,
        extractorModel: null,
      };

      const providerConfig = createProviderConfig();
      providerConfig.model = 'claude-sonnet-4';

      const extractor = new SmartMemoryExtractor(spyProvider, providerConfig, nullModelConfig);
      await extractor.extractFromSession(createSession());

      expect(capturedConfig).not.toBeNull();
      expect(capturedConfig!.model).toBe('claude-sonnet-4');
    });
  });
});
