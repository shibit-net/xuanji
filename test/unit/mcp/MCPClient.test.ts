import { describe, it, expect, afterEach, vi } from 'vitest';
import { MCPClient } from '@/mcp/MCPClient';
import { resolve } from 'node:path';

const MOCK_SERVER_PATH = resolve(__dirname, '../../fixtures/mock-mcp-server.cjs');

describe('MCPClient', () => {
  let client: MCPClient;

  afterEach(async () => {
    if (client) {
      await client.close();
    }
  });

  function createClient() {
    client = new MCPClient({
      config: {
        name: 'test-server',
        command: 'node',
        args: [MOCK_SERVER_PATH],
      },
      timeout: 5000,
      debug: false,
    });
    return client;
  }

  // ---- start ----

  it('start() 应启动 MCP 服务器', async () => {
    createClient();
    await client.start();
    expect(client.getState()).toBe('ready');
  });

  it('start() 重复启动应幂等', async () => {
    createClient();
    await client.start();
    await client.start(); // 不应抛出
    expect(client.getState()).toBe('ready');
  });

  // ---- listTools ----

  it('listTools() 应返回工具列表', async () => {
    createClient();
    await client.start();
    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0]).toHaveProperty('name');
    expect(tools[0]).toHaveProperty('inputSchema');
  });

  it('listTools() 结果应被缓存', async () => {
    createClient();
    await client.start();
    const tools1 = await client.listTools();
    const tools2 = await client.listTools();
    expect(tools1).toBe(tools2); // 相同引用（缓存）
  });

  // ---- listPrompts ----

  it('listPrompts() 应返回 Prompt 列表', async () => {
    createClient();
    await client.start();
    const prompts = await client.listPrompts();
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts[0]).toHaveProperty('name');
  });

  // ---- callTool ----

  it('callTool() 应成功调用工具', async () => {
    createClient();
    await client.start();
    const result = await client.callTool('stock_price', { symbol: '600519' });
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].type).toBe('text');

    const data = JSON.parse(result.content[0].text!);
    expect(data.symbol).toBe('600519');
    expect(data.price).toBe(1888.88);
  });

  it('callTool() 工具错误应返回 isError', async () => {
    createClient();
    await client.start();
    const result = await client.callTool('error_tool', {});
    expect(result.isError).toBe(true);
  });

  it('callTool() 不存在的工具应抛出错误', async () => {
    createClient();
    await client.start();
    await expect(client.callTool('nonexistent', {})).rejects.toThrow('MCP Error');
  });

  // ---- getPrompt ----

  it('getPrompt() 应成功获取 Prompt', async () => {
    createClient();
    await client.start();
    const result = await client.getPrompt('trading_strategy', { risk_level: 'high' });
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0].content.text).toContain('high');
  });

  it('getPrompt() 不存在的 Prompt 应抛出错误', async () => {
    createClient();
    await client.start();
    await expect(client.getPrompt('nonexistent')).rejects.toThrow('MCP Error');
  });

  // ---- close ----

  it('close() 应关闭连接', async () => {
    createClient();
    await client.start();
    await client.close();
    expect(client.getState()).toBe('closed');
  });

  it('close() 重复关闭应幂等', async () => {
    createClient();
    await client.start();
    await client.close();
    await client.close(); // 不应抛出
  });

  // ---- getName ----

  it('getName() 应返回服务器名称', () => {
    createClient();
    expect(client.getName()).toBe('test-server');
  });

  // ---- initialize 握手 ----

  it('start() 应完成 initialize 握手并获取服务器信息', async () => {
    createClient();
    await client.start();
    expect(client.getState()).toBe('ready');

    // 验证从 initialize 响应中获取的信息
    const serverInfo = client.getServerInfo();
    expect(serverInfo).toBeDefined();
    expect(serverInfo!.name).toBe('mock-mcp-server');
    expect(serverInfo!.version).toBe('1.0.0');
  });

  it('start() 应获取服务器能力', async () => {
    createClient();
    await client.start();

    const capabilities = client.getServerCapabilities();
    expect(capabilities).toBeDefined();
    expect(capabilities!.tools).toBeDefined();
  });

  // ---- 重连机制 ----

  it('getReconnectAttempts() 初始为 0', () => {
    createClient();
    expect(client.getReconnectAttempts()).toBe(0);
  });

  it('close() 应阻止重连（intentionalClose）', async () => {
    createClient();
    await client.start();

    // 正常关闭不应触发重连
    await client.close();
    expect(client.getState()).toBe('closed');
    expect(client.getReconnectAttempts()).toBe(0);
  });

  // ---- 错误处理 ----

  it('命令不存在时 start() 应失败', async () => {
    client = new MCPClient({
      config: {
        name: 'bad-server',
        command: 'nonexistent-command-xxx',
        args: [],
      },
      timeout: 2000,
    });

    // start() 本身不会抛出（进程启动是异步的），但后续调用会失败
    await client.start();

    // 等待进程错误事件
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 调用工具应该失败
    await expect(client.listTools()).rejects.toThrow();
  });
});
