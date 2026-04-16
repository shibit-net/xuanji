import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TeamTool } from '@/core/tools/TeamTool';
import type { ILLMProvider, AgentConfig, IToolRegistry } from '@/core/types';

// Mock dependencies
const createMockProvider = (): ILLMProvider => ({
  name: 'mock-provider',
  models: [],
  stream: vi.fn(async function* () {
    yield { type: 'text', text: 'Mock response' };
  }),
  isSupported: vi.fn(() => true),
} as unknown as ILLMProvider);

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
  model: 'claude-sonnet-4',
  temperature: 0.7,
  maxTokens: 4096,
});

describe('TeamTool', () => {
  let tool: TeamTool;
  let mockMainProvider: ILLMProvider;
  let mockToolRegistry: IToolRegistry;
  let mockAgentConfig: AgentConfig;

  beforeEach(() => {
    tool = new TeamTool();
    mockMainProvider = createMockProvider();
    mockToolRegistry = createMockToolRegistry();
    mockAgentConfig = createMockAgentConfig();

    tool.setDependencies({
      provider: mockMainProvider,
      registry: mockToolRegistry,
      agentConfig: mockAgentConfig,
      depth: 0,
    });
  });

  it('应有正确的工具名和 schema', () => {
    expect(tool.name).toBe('agent_team');
    expect(tool.description).toBeTruthy();
    expect(tool.input_schema.required).toContain('team_name');
    expect(tool.input_schema.required).toContain('goal');
    expect(tool.input_schema.required).toContain('strategy');
    expect(tool.input_schema.required).toContain('members');
  });

  it('应验证团队至少有一个成员', async () => {
    const result = await tool.execute({
      team_name: 'Test Team',
      goal: 'Test goal',
      strategy: 'sequential',
      members: [],
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('at least one member');
  });

  it('应限制团队成员数量为 10', async () => {
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
    const uninitializedTool = new TeamTool();
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
    const strategies = (tool.input_schema.properties?.strategy as any).enum;
    expect(strategies).toContain('sequential');
    expect(strategies).toContain('parallel');
    expect(strategies).toContain('hierarchical');
    expect(strategies).toContain('debate');
    expect(strategies).toContain('pipeline');
  });

  it('成员 schema 应包含所有必需字段', () => {
    const memberSchema = (tool.input_schema.properties?.members as any).items;
    expect(memberSchema.required).toContain('id');
    expect(memberSchema.required).toContain('role');
    expect(memberSchema.required).toContain('capabilities');
  });

  it('应支持成员角色类型', () => {
    const memberSchema = (tool.input_schema.properties?.members as any).items;
    const roleEnum = memberSchema.properties.role.enum;
    expect(roleEnum).toContain('general-purpose');
    expect(roleEnum).toContain('explore');
    expect(roleEnum).toContain('plan');
    expect(roleEnum).toContain('coder');
  });
});
