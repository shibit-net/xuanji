import { describe, it, expect, beforeEach } from 'vitest';
import { TokenManager } from '@/agent/TokenManager';
import type { Message } from '@/types';

describe('TokenManager', () => {
  let manager: TokenManager;

  beforeEach(() => {
    manager = new TokenManager(200_000, 8192);
  });

  // ---- estimateTokens() ----

  it('estimateTokens() 应估算字符串消息的 token 数', () => {
    const messages: Message[] = [
      { role: 'user', content: 'Hello world' }, // 11 chars → ceil(11/4) = 3
    ];
    expect(manager.estimateTokens(messages)).toBe(3);
  });

  it('estimateTokens() 应估算长消息的 token 数', () => {
    const content = 'a'.repeat(1000); // 1000 chars → 250 tokens
    const messages: Message[] = [{ role: 'user', content }];
    expect(manager.estimateTokens(messages)).toBe(250);
  });

  it('estimateTokens() 应处理 ContentBlock 数组消息', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hello' },        // 5 chars
          { type: 'tool_use', input: { a: 'b' } }, // JSON.stringify({a:'b'}) = '{"a":"b"}' = 9 chars
        ],
      },
    ];
    const tokens = manager.estimateTokens(messages);
    // text: 5, input: 9, others "" → ceil(14/4) = 4
    expect(tokens).toBeGreaterThan(0);
  });

  it('estimateTokens() 空消息应返回 0', () => {
    expect(manager.estimateTokens([])).toBe(0);
  });

  // ---- fitWindow() ----

  it('fitWindow() 短消息应原样返回', () => {
    const messages: Message[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: '短消息' },
    ];
    const result = manager.fitWindow(messages);
    expect(result).toEqual(messages);
  });

  it('fitWindow() 应保留 system prompt 并裁剪旧消息', () => {
    // 创建一个非常小窗口的 manager
    const smallManager = new TokenManager(100, 50); // 仅 50 tokens 输入空间
    const longText = 'a'.repeat(400); // 100 tokens per message

    const messages: Message[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: longText },      // 旧消息 (应被裁剪)
      { role: 'assistant', content: longText },  // 旧消息 (应被裁剪)
      { role: 'user', content: 'latest' },       // 最新消息
    ];

    const result = smallManager.fitWindow(messages);
    // system 应始终保留
    expect(result[0].role).toBe('system');
    // 最新消息应保留
    expect(result[result.length - 1].content).toBe('latest');
    // 裁剪后的消息应少于原始数量
    expect(result.length).toBeLessThan(messages.length);
  });

  // ---- recordUsage() & getTotalUsage() ----

  it('recordUsage() 应累计 token 用量', () => {
    manager.recordUsage({ input: 100, output: 50 });
    manager.recordUsage({ input: 200, output: 100 });
    const usage = manager.getTotalUsage();
    expect(usage.input).toBe(300);
    expect(usage.output).toBe(150);
  });

  it('recordUsage() 应累计 cache token', () => {
    manager.recordUsage({ input: 100, output: 50, cacheRead: 10, cacheWrite: 5 });
    manager.recordUsage({ input: 200, output: 100, cacheRead: 20, cacheWrite: 10 });
    const usage = manager.getTotalUsage();
    expect(usage.cacheRead).toBe(30);
    expect(usage.cacheWrite).toBe(15);
  });

  it('getTotalUsage() 应返回用量副本', () => {
    manager.recordUsage({ input: 100, output: 50 });
    const u1 = manager.getTotalUsage();
    const u2 = manager.getTotalUsage();
    expect(u1).toEqual(u2);
    expect(u1).not.toBe(u2);
  });

  // ---- reset() ----

  it('reset() 应重置累计用量', () => {
    manager.recordUsage({ input: 100, output: 50 });
    manager.reset();
    const usage = manager.getTotalUsage();
    expect(usage.input).toBe(0);
    expect(usage.output).toBe(0);
  });
});
