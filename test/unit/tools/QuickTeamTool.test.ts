import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QuickTeamTool } from '@/core/tools/QuickTeamTool';
import type { ILLMProvider, AgentConfig, IToolRegistry } from '@/core/types';

// Mock dependencies
const createMockProvider = (): ILLMProvider => ({
  name: 'mock-provider',
  chat: vi.fn(async function* () {
    yield { type: 'text', text: 'Mock response' };
  }),
  chatSync: vi.fn(async () => ({ content: 'Mock response', stopReason: 'end_turn' })),
});

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

describe('QuickTeamTool', () => {
  let tool: QuickTeamTool;
  let mockMainProvider: ILLMProvider;
  let mockLightProvider: ILLMProvider;
  let mockToolRegistry: IToolRegistry;
  let mockAgentConfig: AgentConfig;

  beforeEach(() => {
    tool = new QuickTeamTool();
    mockMainProvider = createMockProvider();
    mockLightProvider = createMockProvider();
    mockToolRegistry = createMockToolRegistry();
    mockAgentConfig = createMockAgentConfig();

    tool.setDependencies({
      provider: mockMainProvider,
      lightProvider: mockLightProvider,
      registry: mockToolRegistry,
      agentConfig: mockAgentConfig,
      depth: 0,
    });
  });

  it('应有正确的工具名和 schema', () => {
    expect(tool.name).toBe('quick_team');
    expect(tool.description).toBeTruthy();
    expect(tool.input_schema.required).toContain('template');
    expect(tool.input_schema.required).toContain('goal');
  });

  it('应支持所有预定义模板', () => {
    const templateEnum = (tool.input_schema.properties?.template as any).enum;
    expect(templateEnum).toContain('code-review');
    expect(templateEnum).toContain('research');
    expect(templateEnum).toContain('architecture-debate');
    expect(templateEnum).toContain('data-pipeline');
    expect(templateEnum).toContain('feature-development');
  });

  it('未知模板应返回错误', async () => {
    const result = await tool.execute({
      template: 'unknown-template',
      goal: 'Test goal',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Unknown template');
  });

  it('未初始化时应返回错误', async () => {
    const uninitializedTool = new QuickTeamTool();
    const result = await uninitializedTool.execute({
      template: 'code-review',
      goal: 'Test goal',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not initialized');
  });

  it('应支持可选的 target 参数', () => {
    const targetProp = (tool.input_schema.properties?.target as any);
    expect(targetProp).toBeDefined();
    expect(targetProp.type).toBe('string');
  });

  it('应支持可选的 max_rounds 参数', () => {
    const maxRoundsProp = (tool.input_schema.properties?.max_rounds as any);
    expect(maxRoundsProp).toBeDefined();
    expect(maxRoundsProp.type).toBe('number');
  });

  it('应支持可选的 timeout 参数', () => {
    const timeoutProp = (tool.input_schema.properties?.timeout as any);
    expect(timeoutProp).toBeDefined();
    expect(timeoutProp.type).toBe('number');
  });
});
