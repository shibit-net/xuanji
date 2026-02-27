import { describe, it, expect, afterEach, vi } from 'vitest';
import { MCPManager } from '@/mcp/MCPManager';
import { resolve } from 'node:path';

const MOCK_SERVER_PATH = resolve(__dirname, '../../fixtures/mock-mcp-server.cjs');

describe('MCPManager', () => {
  afterEach(async () => {
    const manager = MCPManager.getInstance();
    if (manager.isInitialized()) {
      await manager.shutdown();
    }
    MCPManager.resetInstance();
  });

  // ---- 单例 ----

  it('getInstance() 应返回相同实例', () => {
    const a = MCPManager.getInstance();
    const b = MCPManager.getInstance();
    expect(a).toBe(b);
  });

  it('resetInstance() 应重置实例', () => {
    const a = MCPManager.getInstance();
    MCPManager.resetInstance();
    const b = MCPManager.getInstance();
    expect(a).not.toBe(b);
  });

  // ---- initialize ----

  it('initialize() 应注册服务器', async () => {
    const manager = MCPManager.getInstance();
    await manager.initialize({
      servers: [
        {
          name: 'market',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
      ],
    });

    expect(manager.isInitialized()).toBe(true);
    expect(manager.getServerCount()).toBe(1);
  });

  it('initialize() 应跳过 disabled 服务器', async () => {
    const manager = MCPManager.getInstance();
    await manager.initialize({
      servers: [
        {
          name: 'enabled-server',
          command: 'node',
          args: [MOCK_SERVER_PATH],
        },
        {
          name: 'disabled-server',
          command: 'node',
          args: [MOCK_SERVER_PATH],
          disabled: true,
        },
      ],
    });

    expect(manager.getServerCount()).toBe(1);
    expect(manager.getClient('enabled-server')).toBeDefined();
    expect(manager.getClient('disabled-server')).toBeUndefined();
  });

  it('initialize() 重复调用应幂等', async () => {
    const manager = MCPManager.getInstance();
    await manager.initialize({
      servers: [{ name: 'test', command: 'node', args: [MOCK_SERVER_PATH] }],
    });
    await manager.initialize({
      servers: [{ name: 'test2', command: 'node', args: [MOCK_SERVER_PATH] }],
    });

    // 仍然只有第一次注册的服务器
    expect(manager.getServerCount()).toBe(1);
  });

  // ---- getAllTools ----

  it('getAllTools() 应返回所有服务器的工具', async () => {
    const manager = MCPManager.getInstance();
    await manager.initialize({
      servers: [
        { name: 'market', command: 'node', args: [MOCK_SERVER_PATH] },
      ],
    });

    const tools = await manager.getAllTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].serverName).toBe('market');
    expect(tools[0].tool).toHaveProperty('name');
  });

  // ---- getAllPrompts ----

  it('getAllPrompts() 应返回所有服务器的 Prompts', async () => {
    const manager = MCPManager.getInstance();
    await manager.initialize({
      servers: [
        { name: 'market', command: 'node', args: [MOCK_SERVER_PATH] },
      ],
    });

    const prompts = await manager.getAllPrompts();
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts[0].serverName).toBe('market');
  });

  // ---- callTool ----

  it('callTool() 应成功调用指定服务器的工具', async () => {
    const manager = MCPManager.getInstance();
    await manager.initialize({
      servers: [
        { name: 'market', command: 'node', args: [MOCK_SERVER_PATH] },
      ],
    });

    const result = await manager.callTool('market', 'stock_price', { symbol: '600519' });
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('callTool() 不存在的服务器应抛出错误', async () => {
    const manager = MCPManager.getInstance();
    await manager.initialize({ servers: [] });

    await expect(manager.callTool('nonexistent', 'tool', {})).rejects.toThrow('not found');
  });

  // ---- getPrompt ----

  it('getPrompt() 应成功获取指定服务器的 Prompt', async () => {
    const manager = MCPManager.getInstance();
    await manager.initialize({
      servers: [
        { name: 'market', command: 'node', args: [MOCK_SERVER_PATH] },
      ],
    });

    const result = await manager.getPrompt('market', 'trading_strategy', { risk_level: 'low' });
    expect(result.messages).toBeDefined();
  });

  // ---- shutdown ----

  it('shutdown() 应关闭所有服务器', async () => {
    const manager = MCPManager.getInstance();
    await manager.initialize({
      servers: [
        { name: 'market', command: 'node', args: [MOCK_SERVER_PATH] },
      ],
    });

    await manager.shutdown();
    expect(manager.isInitialized()).toBe(false);
    expect(manager.getServerCount()).toBe(0);
  });

  // ---- getServerRuntimes ----

  it('getServerRuntimes() 应返回服务器运行时信息', async () => {
    const manager = MCPManager.getInstance();
    await manager.initialize({
      servers: [
        { name: 'market', command: 'node', args: [MOCK_SERVER_PATH] },
      ],
    });

    const runtimes = manager.getServerRuntimes();
    expect(runtimes.length).toBe(1);
    expect(runtimes[0].name).toBe('market');
    expect(runtimes[0].config.command).toBe('node');
  });
});
