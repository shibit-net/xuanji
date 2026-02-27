import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MCPManager } from '@/mcp/MCPManager';
import { MCPToolAdapter } from '@/mcp/MCPToolAdapter';
import { MCPSkillAdapter } from '@/mcp/MCPSkillAdapter';
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

describe('MCP Skill Adapter (Integration)', () => {
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

  it('MCPSkillAdapter 应正确设置 Skill 属性', async () => {
    const prompts = await manager.getAllPrompts();
    const adapter = new MCPSkillAdapter(prompts[0].serverName, prompts[0].prompt);

    expect(adapter.id).toBe(`market:${prompts[0].prompt.name}`);
    expect(adapter.category).toBe('prompt');
    expect(adapter.priority).toBe(70);
    expect(adapter.tags).toContain('mcp');
    expect(adapter.tags).toContain('market');
  });

  it('MCPSkillAdapter.render() 应调用 MCP prompts/get 并返回内容', async () => {
    const prompts = await manager.getAllPrompts();
    const strategyPrompt = prompts.find((p) => p.prompt.name === 'trading_strategy');
    expect(strategyPrompt).toBeDefined();

    const adapter = new MCPSkillAdapter(strategyPrompt!.serverName, strategyPrompt!.prompt);
    const rendered = await adapter.render({ params: { risk_level: 'high' } });

    expect(rendered).toContain('high');
  });

  it('MCPSkillAdapter 应转换 MCP 参数定义', async () => {
    const prompts = await manager.getAllPrompts();
    const strategyPrompt = prompts.find((p) => p.prompt.name === 'trading_strategy');
    expect(strategyPrompt).toBeDefined();

    const adapter = new MCPSkillAdapter(strategyPrompt!.serverName, strategyPrompt!.prompt);
    expect(adapter.parameters).toBeDefined();
    expect(adapter.parameters!.risk_level).toBeDefined();
    expect(adapter.parameters!.risk_level.type).toBe('string');
  });
});
