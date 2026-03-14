import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MCPManager } from '@/mcp/MCPManager';
import { MCPToolAdapter } from '@/mcp/MCPToolAdapter';
import { resolve } from 'node:path';

const MOCK_SERVER_PATH = resolve(__dirname, '../../fixtures/mock-mcp-server.cjs');

describe('MCP Tool Adapter (Integration)', () => {
  let manager: MCPManager;

  beforeAll(async () => {
    manager = MCPManager.getInstance();
    await manager.initialize({
      servers: [
        { name: 'market', command: 'node', args: [MOCK_SERVER_PATH] },
      ],
    });
  });

  afterAll(async () => {
    await manager.shutdown();
    MCPManager.resetInstance();
  });

  it('MCPToolAdapter 工具名应包含 serverName 前缀', async () => {
    const tools = await manager.getAllTools();
    const adapter = new MCPToolAdapter(tools[0].serverName, tools[0].tool);

    expect(adapter.name).toBe(`market:${tools[0].tool.name}`);
    expect(adapter.description).toBeDefined();
    expect(adapter.input_schema).toBeDefined();
  });

  it('MCPToolAdapter.execute() 应调用 MCP 工具并返回结果', async () => {
    const tools = await manager.getAllTools();
    const stockPriceTool = tools.find((t) => t.tool.name === 'stock_price');
    expect(stockPriceTool).toBeDefined();

    const adapter = new MCPToolAdapter(stockPriceTool!.serverName, stockPriceTool!.tool);
    const result = await adapter.execute({ symbol: '600519' });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('600519');
    expect(result.content).toContain('1888.88');
  });

  it('MCPToolAdapter.execute() 工具错误应返回 error result', async () => {
    // 创建一个指向不存在工具的 adapter
    const adapter = new MCPToolAdapter('market', {
      name: 'nonexistent_tool',
      inputSchema: { type: 'object' },
    });

    const result = await adapter.execute({});
    expect(result.isError).toBe(true);
  });

  it('MCPToolAdapter 应默认为 readonly (并行执行)', () => {
    const adapter = new MCPToolAdapter('market', {
      name: 'test',
      inputSchema: { type: 'object' },
    });
    expect(adapter.readonly).toBe(true);
  });
});
