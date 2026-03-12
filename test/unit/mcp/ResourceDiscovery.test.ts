/**
 * ============================================================
 * ResourceDiscovery 单元测试
 * ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResourceDiscovery } from '@/mcp/ResourceDiscovery';
import { MCPManager } from '@/mcp/MCPManager';
import type { MCPResource, IMCPClient, MCPServerRuntime } from '@/mcp/types';

describe('ResourceDiscovery', () => {
  let resourceDiscovery: ResourceDiscovery;
  let mockMCPManager: MCPManager;
  let mockClient: IMCPClient;

  const mockResources: MCPResource[] = [
    {
      uri: 'file:///home/user/doc.txt',
      name: 'Example File',
      description: 'An example text file',
      mimeType: 'text/plain',
    },
    {
      uri: 'db://query/users',
      name: 'Users Query',
      description: 'Database query for users',
      mimeType: 'application/json',
    },
    {
      uri: 'file:///{path}',
      name: 'Dynamic File',
      description: 'File with path parameter',
      mimeType: 'text/plain',
      uriTemplate: 'file:///{path}',
    },
  ];

  beforeEach(() => {
    // 创建一个固定的 mock client
    mockClient = {
      listResources: vi.fn().mockResolvedValue(mockResources),
      readResource: vi.fn().mockResolvedValue([
        {
          uri: 'file:///home/user/doc.txt',
          mimeType: 'text/plain',
          text: 'Hello, World!',
        },
      ]),
    } as unknown as IMCPClient;

    // Mock MCPManager
    mockMCPManager = {
      getServerRuntimes: vi.fn(() => [
        {
          name: 'test-server',
          state: 'ready',
          config: {
            name: 'test-server',
            command: 'node',
            args: ['server.js'],
          },
        } as MCPServerRuntime,
      ]),
      getClient: vi.fn((serverId: string) => {
        if (serverId === 'test-server') {
          return mockClient;
        }
        return undefined;
      }),
    } as unknown as MCPManager;

    resourceDiscovery = new ResourceDiscovery(mockMCPManager);
  });

  describe('listAllResources', () => {
    it('应该返回所有服务器的资源列表', async () => {
      const resources = await resourceDiscovery.listAllResources();

      expect(resources).toHaveLength(3);
      expect(resources[0].name).toBe('Example File');
      expect(resources[1].name).toBe('Users Query');
      expect(resources[2].name).toBe('Dynamic File');
    });

    it('应该跳过非 ready 状态的服务器', async () => {
      mockMCPManager.getServerRuntimes = vi.fn(() => [
        {
          name: 'error-server',
          state: 'error',
        } as MCPServerRuntime,
      ]);

      const resources = await resourceDiscovery.listAllResources();

      expect(resources).toHaveLength(0);
    });

    it('应该在单个服务器失败时继续处理其他服务器', async () => {
      mockMCPManager.getServerRuntimes = vi.fn(() => [
        {
          name: 'working-server',
          state: 'ready',
        } as MCPServerRuntime,
        {
          name: 'failing-server',
          state: 'ready',
        } as MCPServerRuntime,
      ]);

      mockMCPManager.getClient = vi.fn((serverId: string) => {
        if (serverId === 'working-server') {
          return {
            listResources: vi.fn().mockResolvedValue([mockResources[0]]),
          } as unknown as IMCPClient;
        }
        if (serverId === 'failing-server') {
          return {
            listResources: vi.fn().mockRejectedValue(new Error('Server error')),
          } as unknown as IMCPClient;
        }
        return undefined;
      });

      const resources = await resourceDiscovery.listAllResources();

      expect(resources).toHaveLength(1);
      expect(resources[0].name).toBe('Example File');
    });
  });

  describe('listServerResources', () => {
    it('应该返回指定服务器的资源列表', async () => {
      const resources = await resourceDiscovery.listServerResources('test-server');

      expect(resources).toHaveLength(3);
      expect(resources[0].uri).toBe('file:///home/user/doc.txt');
    });

    it('应该使用缓存', async () => {
      // 第一次调用
      await resourceDiscovery.listServerResources('test-server');

      // 第二次调用应该使用缓存
      const resources = await resourceDiscovery.listServerResources('test-server');

      expect(resources).toHaveLength(3);

      // listResources 只被调用一次（第一次调用）
      expect(mockClient.listResources).toHaveBeenCalledTimes(1);
    });

    it('应该在服务器不存在时抛出错误', async () => {
      await expect(resourceDiscovery.listServerResources('non-existent')).rejects.toThrow(
        'MCP server "non-existent" not found'
      );
    });
  });

  describe('readResource', () => {
    it('应该读取资源内容（文本）', async () => {
      const content = await resourceDiscovery.readResource('file:///home/user/doc.txt');

      expect(content.uri).toBe('file:///home/user/doc.txt');
      expect(content.content).toBe('Hello, World!');
      expect(content.mimeType).toBe('text/plain');
    });

    it('应该读取资源内容（二进制 blob）', async () => {
      // 先添加资源到列表
      mockClient.listResources = vi.fn().mockResolvedValue([
        ...mockResources,
        {
          uri: 'file:///image.png',
          name: 'Image File',
          mimeType: 'image/png',
        },
      ]);

      mockClient.readResource = vi.fn().mockResolvedValue([
        {
          uri: 'file:///image.png',
          mimeType: 'image/png',
          blob: 'iVBORw0KGgoAAAANSUhEUgAAAAUA',
        },
      ]);

      const content = await resourceDiscovery.readResource('file:///image.png');

      expect(content.content).toBe('iVBORw0KGgoAAAANSUhEUgAAAAUA');
      expect(content.mimeType).toBe('image/png');
    });

    it('应该在资源不存在时抛出错误', async () => {
      await expect(resourceDiscovery.readResource('file:///non-existent.txt')).rejects.toThrow(
        'Resource not found'
      );
    });

    it('应该在读取失败时抛出错误', async () => {
      // 先清除缓存，让 readResource 重新获取资源列表
      await resourceDiscovery.refreshCache();

      mockClient.readResource = vi.fn().mockRejectedValue(new Error('Read failed'));

      await expect(resourceDiscovery.readResource('file:///home/user/doc.txt')).rejects.toThrow();
    });

    it('应该在返回空内容时抛出错误', async () => {
      // 先清除缓存，让 readResource 重新获取资源列表
      await resourceDiscovery.refreshCache();

      mockClient.readResource = vi.fn().mockResolvedValue([]);

      await expect(resourceDiscovery.readResource('file:///home/user/doc.txt')).rejects.toThrow(
        'Resource returned empty content'
      );
    });
  });

  describe('refreshCache', () => {
    it('应该清除指定服务器的缓存', async () => {
      // 填充缓存
      await resourceDiscovery.listServerResources('test-server');

      // 清除缓存
      await resourceDiscovery.refreshCache('test-server');

      // 再次调用应该重新获取
      await resourceDiscovery.listServerResources('test-server');

      // listResources 被调用两次（缓存被清除）
      expect(mockClient.listResources).toHaveBeenCalledTimes(2);
    });

    it('应该清除所有缓存', async () => {
      // 填充缓存
      await resourceDiscovery.listServerResources('test-server');

      // 清除所有缓存
      await resourceDiscovery.refreshCache();

      const stats = resourceDiscovery.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('resolveTemplate', () => {
    it('应该解析 URI 模板', () => {
      const uri = resourceDiscovery.resolveTemplate('file:///{path}', {
        path: 'home/user/doc.txt',
      });

      expect(uri).toBe('file:///home%2Fuser%2Fdoc.txt');
    });

    it('应该处理多个变量', () => {
      const uri = resourceDiscovery.resolveTemplate('db://{database}/{table}', {
        database: 'mydb',
        table: 'users',
      });

      expect(uri).toBe('db://mydb/users');
    });

    it('应该在变量缺失时返回空字符串', () => {
      const uri = resourceDiscovery.resolveTemplate('file:///{path}', {});

      expect(uri).toBe('file:///');
    });

    it('应该对变量值进行 URL 编码', () => {
      const uri = resourceDiscovery.resolveTemplate('file:///{path}', {
        path: 'home/user/My Document.txt',
      });

      expect(uri).toBe('file:///home%2Fuser%2FMy%20Document.txt');
    });
  });

  describe('getCacheStats', () => {
    it('应该返回缓存统计信息', async () => {
      await resourceDiscovery.listServerResources('test-server');

      const stats = resourceDiscovery.getCacheStats();

      expect(stats.size).toBe(1);
      expect(stats.maxSize).toBe(100);
      expect(stats.defaultTTL).toBe(5 * 60 * 1000); // 5 分钟
    });
  });

  describe('destroy', () => {
    it('应该销毁缓存', () => {
      resourceDiscovery.destroy();

      const stats = resourceDiscovery.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });
});
