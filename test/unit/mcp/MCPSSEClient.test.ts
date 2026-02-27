import { describe, it, expect, afterEach, vi } from 'vitest';
import { MCPSSEClient } from '@/mcp/MCPSSEClient';

describe('MCPSSEClient', () => {
  it('应在缺少 sseUrl 时抛出错误', () => {
    expect(() => new MCPSSEClient({
      config: {
        name: 'test-sse',
        command: 'node',
        transport: 'sse',
        httpUrl: 'http://localhost:3000/rpc',
        // 缺少 sseUrl
      },
      timeout: 5000,
    })).toThrow('requires sseUrl and httpUrl');
  });

  it('应在缺少 httpUrl 时抛出错误', () => {
    expect(() => new MCPSSEClient({
      config: {
        name: 'test-sse',
        command: 'node',
        transport: 'sse',
        sseUrl: 'http://localhost:3000/sse',
        // 缺少 httpUrl
      },
      timeout: 5000,
    })).toThrow('requires sseUrl and httpUrl');
  });

  it('应正确创建实例', () => {
    const client = new MCPSSEClient({
      config: {
        name: 'test-sse',
        command: 'node',
        transport: 'sse',
        sseUrl: 'http://localhost:3000/sse',
        httpUrl: 'http://localhost:3000/rpc',
      },
    });

    expect(client.getName()).toBe('test-sse');
    expect(client.getState()).toBe('uninitialized');
    expect(client.getReconnectAttempts()).toBe(0);
  });

  it('close() 在 uninitialized 状态应幂等', async () => {
    const client = new MCPSSEClient({
      config: {
        name: 'test-sse',
        command: 'node',
        transport: 'sse',
        sseUrl: 'http://localhost:3000/sse',
        httpUrl: 'http://localhost:3000/rpc',
      },
    });

    // close 未启动的客户端不应报错
    await expect(client.close()).resolves.not.toThrow();
  });

  it('start() 在连接失败时应进入 error 状态', async () => {
    const client = new MCPSSEClient({
      config: {
        name: 'test-sse-fail',
        command: 'node',
        transport: 'sse',
        sseUrl: 'http://localhost:99999/sse',  // 无效端口
        httpUrl: 'http://localhost:99999/rpc',
      },
      timeout: 1000,
    });

    await expect(client.start()).rejects.toThrow();
    expect(client.getState()).toBe('error');
  });
});
