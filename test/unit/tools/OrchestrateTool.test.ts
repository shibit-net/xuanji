import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrchestrateTool } from '@/core/tools/OrchestrateTool';
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

describe('OrchestrateTool', () => {
  let tool: OrchestrateTool;
  let mockProviderManager: ProviderManager;
  let mockAgentRegistry: AgentRegistry;
  let mockToolRegistry: IToolRegistry;
  let mockAgentConfig: AgentConfig;

  beforeEach(() => {
    tool = new OrchestrateTool();
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
    expect(tool.name).toBe('orchestrate');
    expect(tool.description).toBeTruthy();
    expect(tool.input_schema.required).toContain('team_name');
    expect(tool.input_schema.required).toContain('goal');
    expect(tool.input_schema.required).toContain('strategy');
    expect(tool.input_schema.required).toContain('members');
  });

  it('应验证必需参数', async () => {
    const result = await tool.execute({
      team_name: 'Test Team',
      goal: 'Test goal',
      strategy: 'sequential',
      members: [],
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('at least one member');
  });

  it('应限制团队成员数量', async () => {
    const members = Array.from({ length: 11 }, (_, i) => ({
      id: `member-${i}`,
      role: 'general-purpose' as const,
      capabilities: ['test'],
    }));

    const result = await tool.execute({
      team_name: 'Large Team',
      goal: 'Test goal',
      strategy: 'sequential',
      members,
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Maximum team size');
  });

  it('未初始化时应返回错误', async () => {
    const uninitializedTool = new OrchestrateTool();
    const result = await uninitializedTool.execute({
      team_name: 'Test',
      goal: 'Test',
      strategy: 'sequential',
      members: [{ id: 'test', role: 'general-purpose', capabilities: [] }],
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not initialized');
  });

  it('应支持所有策略类型', () => {
    const strategies = tool.input_schema.properties?.strategy as any;
    expect(strategies.enum).toContain('sequential');
    expect(strategies.enum).toContain('parallel');
    expect(strategies.enum).toContain('hierarchical');
    expect(strategies.enum).toContain('debate');
    expect(strategies.enum).toContain('pipeline');
  });
});
