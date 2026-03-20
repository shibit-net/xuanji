import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PipelineTool } from '@/core/tools/PipelineTool';
import type { ILLMProvider, AgentConfig, IToolRegistry } from '@/core/types';
import type { ProviderManager } from '@/core/providers/ProviderManager';
import type { AgentRegistry } from '@/core/agent/AgentRegistry';

// Mock dependencies
const createMockProvider = (): ILLMProvider => ({
  name: 'mock-provider',
  chat: vi.fn(async function* () {
    yield { type: 'text', text: 'Mock response' };
  }),
  chatSync: vi.fn(async () => ({ content: 'Mock response', stopReason: 'end_turn' })),
});

const createMockProviderManager = (): ProviderManager => ({
  getProvider: vi.fn(() => createMockProvider()),
  getLightProvider: vi.fn(() => createMockProvider()),
} as any);

const createMockAgentRegistry = (): AgentRegistry => ({
  get: vi.fn(() => undefined),
  list: vi.fn(() => []),
} as any);

const createMockToolRegistry = (): IToolRegistry => ({
  register: vi.fn(),
  unregister: vi.fn(),
  get: vi.fn(),
  getAll: vi.fn(() => []),
  getSchemas: vi.fn(() => []),
  has: vi.fn(() => false),
  execute: vi.fn(async () => ({ content: 'mock result', isError: false })),
} as any);

const createMockAgentConfig = (): AgentConfig => ({
  provider: 'anthropic',
  model: 'claude-sonnet-4',
  temperature: 0.7,
  maxTokens: 4096,
});

describe('PipelineTool', () => {
  let tool: PipelineTool;
  let mockProviderManager: ProviderManager;
  let mockAgentRegistry: AgentRegistry;
  let mockToolRegistry: IToolRegistry;
  let mockAgentConfig: AgentConfig;

  beforeEach(() => {
    tool = new PipelineTool();
    mockProviderManager = createMockProviderManager();
    mockAgentRegistry = createMockAgentRegistry();
    mockToolRegistry = createMockToolRegistry();
    mockAgentConfig = createMockAgentConfig();

    tool.setDependencies({
      providerManager: mockProviderManager,
      agentRegistry: mockAgentRegistry,
      registry: mockToolRegistry,
      agentConfig: mockAgentConfig,
      depth: 0,
    });
  });

  it('应有正确的工具名和 schema', () => {
    expect(tool.name).toBe('pipeline');
    expect(tool.description).toBeTruthy();
    expect(tool.input_schema.required).toContain('chain');
  });

  it('应验证链至少有 2 步', async () => {
    const result = await tool.execute({
      chain: [
        { agent_id: 'explore', task_template: 'Step 1' },
      ],
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('at least 2 steps');
  });

  it('应验证链为空时返回错误', async () => {
    const result = await tool.execute({
      chain: [],
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('at least 2 steps');
  });

  it('未初始化时应返回错误', async () => {
    const uninitializedTool = new PipelineTool();
    const result = await uninitializedTool.execute({
      chain: [
        { agent_id: 'explore', task_template: 'Step 1' },
        { agent_id: 'coder', task_template: 'Step 2' },
      ],
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not initialized');
  });

  it('应支持 {{previous_output}} 模板变量', () => {
    expect(tool.description).toContain('{{previous_output}}');
  });

  it('schema 应包含所有必需字段', () => {
    const chainItemSchema = (tool.input_schema.properties?.chain as any).items;
    expect(chainItemSchema.required).toContain('agent_id');
    expect(chainItemSchema.required).toContain('task_template');
    expect(chainItemSchema.properties).toHaveProperty('description');
    expect(chainItemSchema.properties).toHaveProperty('timeout');
  });
});
