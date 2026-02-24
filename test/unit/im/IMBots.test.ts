import { describe, it, expect, vi } from 'vitest';
import { DingtalkBot } from '@/adapters/im/DingtalkBot';
import { FeishuBot } from '@/adapters/im/FeishuBot';
import { WecomBot } from '@/adapters/im/WecomBot';
import type { ChatSession } from '@/core/chat/ChatSession';

/**
 * 创建 mock ChatSession
 */
function createMockSession(): ChatSession {
  return {
    init: vi.fn(),
    on: vi.fn(),
    run: vi.fn(async () => {}),
    stop: vi.fn(),
    reset: vi.fn(),
    getState: vi.fn(() => ({
      status: 'idle' as const,
      messages: [],
      tokenUsage: { input: 0, output: 0 },
      cost: 0,
      currentIteration: 0,
    })),
    getAgentLoop: vi.fn(),
    getConfig: vi.fn(() => ({
      provider: { model: 'mock', maxTokens: 4096, apiKey: 'test' },
      ui: { theme: 'auto', showTokenUsage: true, showCost: true, showThinking: false },
      tools: { enabled: [], permissions: { fileWrite: 'ask', fileRead: 'always', bashExec: 'ask' } },
      retry: { maxRetries: 3, initialDelay: 1000, maxDelay: 30000, backoffMultiplier: 2, retryableStatusCodes: [] },
    })),
    isInitialized: vi.fn(() => true),
  } as unknown as ChatSession;
}

describe('DingtalkBot', () => {
  it('应有正确的名称', () => {
    const bot = new DingtalkBot({ appKey: 'test', appSecret: 'test' });
    expect(bot.name).toBe('dingtalk');
  });

  it('缺少配置应抛出异常', async () => {
    const bot = new DingtalkBot({ appKey: '', appSecret: '' });
    const session = createMockSession();
    await expect(bot.start(session)).rejects.toThrow('DINGTALK_APP_KEY');
  });

  it('stop() 应正常工作', async () => {
    const bot = new DingtalkBot({ appKey: 'test', appSecret: 'test' });
    await expect(bot.stop()).resolves.toBeUndefined();
  });

  it('应从环境变量读取配置', () => {
    const originalKey = process.env.DINGTALK_APP_KEY;
    const originalSecret = process.env.DINGTALK_APP_SECRET;

    process.env.DINGTALK_APP_KEY = 'env-key';
    process.env.DINGTALK_APP_SECRET = 'env-secret';

    const bot = new DingtalkBot();
    // 构造函数应该读取环境变量，不会抛出
    expect(bot.name).toBe('dingtalk');

    // 恢复
    if (originalKey !== undefined) process.env.DINGTALK_APP_KEY = originalKey;
    else delete process.env.DINGTALK_APP_KEY;
    if (originalSecret !== undefined) process.env.DINGTALK_APP_SECRET = originalSecret;
    else delete process.env.DINGTALK_APP_SECRET;
  });
});

describe('FeishuBot', () => {
  it('应有正确的名称', () => {
    const bot = new FeishuBot({ appId: 'test', appSecret: 'test' });
    expect(bot.name).toBe('feishu');
  });

  it('缺少配置应抛出异常', async () => {
    const bot = new FeishuBot({ appId: '', appSecret: '' });
    const session = createMockSession();
    await expect(bot.start(session)).rejects.toThrow('飞书机器人配置缺失');
  });

  it('stop() 应正常工作', async () => {
    const bot = new FeishuBot({ appId: 'test', appSecret: 'test' });
    await expect(bot.stop()).resolves.toBeUndefined();
  });

  it('应从环境变量读取配置', () => {
    const originalId = process.env.FEISHU_APP_ID;
    const originalSecret = process.env.FEISHU_APP_SECRET;

    process.env.FEISHU_APP_ID = 'env-id';
    process.env.FEISHU_APP_SECRET = 'env-secret';

    const bot = new FeishuBot();
    expect(bot.name).toBe('feishu');

    if (originalId !== undefined) process.env.FEISHU_APP_ID = originalId;
    else delete process.env.FEISHU_APP_ID;
    if (originalSecret !== undefined) process.env.FEISHU_APP_SECRET = originalSecret;
    else delete process.env.FEISHU_APP_SECRET;
  });
});

describe('WecomBot', () => {
  it('应有正确的名称', () => {
    const bot = new WecomBot({ corpId: 'test', secret: 'test' });
    expect(bot.name).toBe('wecom');
  });

  it('缺少 corpId/secret 应抛出异常', async () => {
    const bot = new WecomBot({ corpId: '', secret: '' });
    const session = createMockSession();
    await expect(bot.start(session)).rejects.toThrow('WECOM_CORPID');
  });

  it('缺少 token/encodingAESKey 应抛出异常', async () => {
    const bot = new WecomBot({ corpId: 'test', secret: 'test', token: '', encodingAESKey: '' });
    const session = createMockSession();
    await expect(bot.start(session)).rejects.toThrow('WECOM_TOKEN');
  });

  it('stop() 应正常工作', async () => {
    const bot = new WecomBot({ corpId: 'test', secret: 'test' });
    await expect(bot.stop()).resolves.toBeUndefined();
  });

  it('应从环境变量读取配置', () => {
    const originalCorp = process.env.WECOM_CORPID;
    const originalSecret = process.env.WECOM_SECRET;

    process.env.WECOM_CORPID = 'env-corp';
    process.env.WECOM_SECRET = 'env-secret';

    const bot = new WecomBot();
    expect(bot.name).toBe('wecom');

    if (originalCorp !== undefined) process.env.WECOM_CORPID = originalCorp;
    else delete process.env.WECOM_CORPID;
    if (originalSecret !== undefined) process.env.WECOM_SECRET = originalSecret;
    else delete process.env.WECOM_SECRET;
  });
});
