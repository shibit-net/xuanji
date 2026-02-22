import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatSession } from '@/core/chat/ChatSession';
import type { ILLMProvider, StreamEvent, IToolRegistry, ToolResult, ToolSchema, AppConfig } from '@/core/types';

/**
 * 创建 mock Provider
 */
function createMockProvider(responses: StreamEvent[][] = [[]]): ILLMProvider {
  let callIndex = 0;
  return {
    name: 'mock',
    models: ['mock-model'],
    isSupported: (model: string) => model.includes('mock'),
    stream: vi.fn(async function* (): AsyncIterable<StreamEvent> {
      const events = responses[callIndex] ?? [];
      callIndex++;
      for (const event of events) {
        yield event;
      }
    }),
  };
}

/**
 * 创建 mock ToolRegistry
 */
function createMockRegistry(): IToolRegistry {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(),
    getAll: vi.fn(() => []),
    getSchemas: vi.fn(() => []),
    has: vi.fn(() => false),
    execute: vi.fn(async () => ({ content: 'ok', isError: false })),
  };
}

/**
 * 创建完整的 mock 配置
 */
function createMockConfig(): AppConfig {
  return {
    provider: {
      model: 'mock-model',
      maxTokens: 4096,
      apiKey: 'test-api-key',
      baseURL: 'https://test.example.com',
    },
    ui: {
      theme: 'auto',
      showTokenUsage: true,
      showCost: true,
      showThinking: false,
    },
    tools: {
      enabled: [],
      permissions: {
        fileWrite: 'ask',
        fileRead: 'always',
        bashExec: 'ask',
      },
    },
    retry: {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      retryableStatusCodes: [429, 500, 502, 503, 529],
    },
  };
}

describe('ChatSession', () => {
  let provider: ILLMProvider;
  let registry: IToolRegistry;
  let config: AppConfig;

  beforeEach(() => {
    provider = createMockProvider([
      [
        { type: 'usage', usage: { input: 10, output: 0 } },
        { type: 'text_delta', text: 'Hello!' },
        { type: 'end', stopReason: 'end_turn', usage: { input: 0, output: 5 } },
      ],
    ]);
    registry = createMockRegistry();
    config = createMockConfig();
  });

  // ---- 初始化 ----

  it('构造后 isInitialized() 应为 false', () => {
    const session = new ChatSession();
    expect(session.isInitialized()).toBe(false);
  });

  it('init() 使用注入的组件应成功初始化', async () => {
    const session = new ChatSession({ provider, registry, config });
    await session.init();
    expect(session.isInitialized()).toBe(true);
  });

  it('init() 重复调用应幂等', async () => {
    const session = new ChatSession({ provider, registry, config });
    await session.init();
    await session.init(); // 不应抛出
    expect(session.isInitialized()).toBe(true);
  });

  it('缺少 apiKey 应抛出异常', async () => {
    const noKeyConfig = { ...config, provider: { ...config.provider, apiKey: undefined } };
    const session = new ChatSession({ provider, registry, config: noKeyConfig as AppConfig });
    await expect(session.init()).rejects.toThrow('API Key');
  });

  // ---- run / stop / reset ----

  it('run() 未初始化应抛出异常', async () => {
    const session = new ChatSession({ provider, registry, config });
    await expect(session.run('hello')).rejects.toThrow('尚未初始化');
  });

  it('run() 应成功执行对话', async () => {
    const session = new ChatSession({ provider, registry, config });
    await session.init();

    const texts: string[] = [];
    session.on({ onText: (t) => texts.push(t) });

    await session.run('test');
    expect(texts.join('')).toBe('Hello!');
  });

  it('stop() 未初始化不应抛出', () => {
    const session = new ChatSession({ provider, registry, config });
    expect(() => session.stop()).not.toThrow();
  });

  it('reset() 应清空状态', async () => {
    const session = new ChatSession({ provider, registry, config });
    await session.init();
    await session.run('test');

    session.reset();
    const state = session.getState();
    expect(state.messages).toHaveLength(0);
    expect(state.currentIteration).toBe(0);
  });

  // ---- getState / getConfig / getAgentLoop ----

  it('getState() 应返回正确状态', async () => {
    const session = new ChatSession({ provider, registry, config });
    await session.init();

    const state = session.getState();
    expect(state.status).toBe('idle');
    expect(state.currentIteration).toBe(0);
  });

  it('getConfig() 应返回配置', async () => {
    const session = new ChatSession({ provider, registry, config });
    await session.init();

    const cfg = session.getConfig();
    expect(cfg.provider.model).toBe('mock-model');
    expect(cfg.provider.apiKey).toBe('test-api-key');
  });

  it('getConfig() 未初始化应抛出', () => {
    const session = new ChatSession();
    expect(() => session.getConfig()).toThrow('尚未初始化');
  });

  it('getAgentLoop() 应返回 AgentLoop 实例', async () => {
    const session = new ChatSession({ provider, registry, config });
    await session.init();

    const loop = session.getAgentLoop();
    expect(loop).toBeDefined();
    expect(typeof loop.run).toBe('function');
  });

  // ---- 模型覆盖 ----

  it('应支持 model 参数覆盖配置中的模型', async () => {
    const session = new ChatSession({
      provider,
      registry,
      config,
      model: 'mock-override-model',
    });
    await session.init();

    const cfg = session.getConfig();
    expect(cfg.provider.model).toBe('mock-override-model');
  });
});
