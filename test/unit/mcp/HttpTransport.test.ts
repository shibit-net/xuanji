/**
 * HttpTransport 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpTransport } from '@/mcp/transports/HttpTransport';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('HttpTransport', () => {
  let transport: HttpTransport;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (transport) {
      await transport.close();
    }
  });

  describe('构造函数', () => {
    it('应该正确初始化配置', () => {
      transport = new HttpTransport({
        url: 'http://localhost:3000',
        headers: { 'X-Custom': 'test' },
        timeout: 5000,
        maxRetries: 3,
      });

      expect(transport.isConnected()).toBe(false);
    });

    it('应该拒绝无效的 URL', () => {
      expect(() => {
        new HttpTransport({ url: 'invalid-url' });
      }).toThrow('invalid url');
    });

    it('应该拒绝空 URL', () => {
      expect(() => {
        new HttpTransport({ url: '' });
      }).toThrow('url is required');
    });
  });

  describe('纯 HTTP 模式', () => {
    beforeEach(() => {
      transport = new HttpTransport({
        url: 'http://localhost:3000',
        enableSSE: false,
        debug: false,
      });
    });

    it('应该成功发送请求和接收响应', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        result: { tools: [] },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const result = await transport.request('tools/list', {});

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/tools/list',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
      expect(result).toEqual({ tools: [] });
    });

    it('应该处理错误响应', async () => {
      const mockResponse = {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32601,
          message: 'Method not found',
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      await expect(transport.request('invalid/method', {})).rejects.toThrow('Method not found');
    });

    it('应该处理 HTTP 错误', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(transport.request('tools/list', {})).rejects.toThrow('404 Not Found');
    });

    it('应该在 5xx 错误时重试', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            jsonrpc: '2.0',
            id: 1,
            result: { success: true },
          }),
        });

      const result = await transport.request('tools/list', {});

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ success: true });
    }, 10000);

    it('应该在达到最大重试次数后抛出错误', async () => {
      transport = new HttpTransport({
        url: 'http://localhost:3000',
        enableSSE: false,
        maxRetries: 2,
        debug: false,
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
      });

      await expect(transport.request('tools/list', {})).rejects.toThrow('Service Unavailable');

      // 初次请求 + 2 次重试 = 3 次
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('应该处理网络超时', async () => {
      transport = new HttpTransport({
        url: 'http://localhost:3000',
        enableSSE: false,
        timeout: 100,
        maxRetries: 0,
        debug: false,
      });

      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      mockFetch.mockRejectedValue(abortError);

      await expect(transport.request('tools/list', {})).rejects.toThrow();
    }, 5000);

    it('应该支持自定义请求头', async () => {
      transport = new HttpTransport({
        url: 'http://localhost:3000',
        headers: {
          Authorization: 'Bearer test-token',
          'X-Custom-Header': 'custom-value',
        },
        enableSSE: false,
        debug: false,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: 1,
          result: {},
        }),
      });

      await transport.request('tools/list', {});

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'X-Custom-Header': 'custom-value',
          }),
        })
      );
    });
  });

  describe('SSE 模式', () => {
    beforeEach(() => {
      transport = new HttpTransport({
        url: 'http://localhost:3000',
        enableSSE: true,
        ssePath: '/sse',
        debug: false,
      });
    });

    it('应该在初始化时建立 SSE 连接', async () => {
      const mockBody = {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
          releaseLock: () => {},
        }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockBody,
      });

      await transport.initialize();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/sse',
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'text/event-stream',
          }),
        })
      );
      expect(transport.isConnected()).toBe(true);
    });

    it('应该处理 SSE 连接失败', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(transport.initialize()).rejects.toThrow('SSE connection failed');
    });

    it('应该在 SSE 模式下发送请求到 HTTP 端点', async () => {
      // 模拟 SSE 连接
      const mockBody = {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
          releaseLock: () => {},
        }),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockBody,
      });

      await transport.initialize();

      // 发送请求
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      // 不等待响应（响应通过 SSE 返回）
      const promise = transport.request('tools/list', {});

      // 手动触发 SSE 响应
      const response = {
        jsonrpc: '2.0',
        id: 1,
        result: { tools: [] },
      };

      // 通过内部方法模拟 SSE 响应（实际测试中需要 mock SSE 流）
      (transport as any).handleResponse(response);

      const result = await promise;
      expect(result).toEqual({ tools: [] });
    });
  });

  describe('状态管理', () => {
    beforeEach(() => {
      transport = new HttpTransport({
        url: 'http://localhost:3000',
        enableSSE: false,
        debug: false,
      });
    });

    it('初始状态应该是 uninitialized', () => {
      expect(transport.getState()).toBe('uninitialized');
      expect(transport.isConnected()).toBe(false);
    });

    it('初始化后状态应该是 ready', async () => {
      await transport.initialize();
      expect(transport.getState()).toBe('ready');
      expect(transport.isConnected()).toBe(true);
    });

    it('关闭后状态应该是 closed', async () => {
      await transport.initialize();
      await transport.close();
      expect(transport.getState()).toBe('closed');
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe('并发请求', () => {
    beforeEach(() => {
      transport = new HttpTransport({
        url: 'http://localhost:3000',
        enableSSE: false,
        debug: false,
      });
    });

    it('应该正确处理多个并发请求', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(async () => ({
        ok: true,
        json: async () => ({
          jsonrpc: '2.0',
          id: ++callCount,
          result: { success: true },
        }),
      }));

      const promises = [
        transport.request('tools/list', {}),
        transport.request('tools/call', { name: 'test' }),
        transport.request('prompts/list', {}),
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      expect(results.every(r => (r as any).success)).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    }, 10000);
  });

  describe('请求超时', () => {
    it('应该在超时后拒绝请求', async () => {
      transport = new HttpTransport({
        url: 'http://localhost:3000',
        enableSSE: false,
        timeout: 100,
        maxRetries: 0,
        debug: false,
      });

      mockFetch.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => {
          resolve({
            ok: true,
            json: async () => ({ jsonrpc: '2.0', id: 1, result: {} }),
          });
        }, 500))
      );

      await expect(transport.request('tools/list', {})).rejects.toThrow('timeout');
    }, 2000);
  });
});
