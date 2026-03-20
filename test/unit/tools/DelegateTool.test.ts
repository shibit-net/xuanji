import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DelegateTool } from '@/core/tools/DelegateTool';
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

describe('DelegateTool', () => {
  let tool: DelegateTool;
  let mockProviderManager: ProviderManager;
  let mockAgentRegistry: AgentRegistry;
  let mockToolRegistry: IToolRegistry;
  let mockAgentConfig: AgentConfig;

  beforeEach(() => {
    tool = new DelegateTool();
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
    expect(tool.name).toBe('delegate');
    expect(tool.description).toBeTruthy();
    expect(tool.input_schema.required).toContain('description');
  });

  it('未初始化时应返回错误', async () => {
    const uninitializedTool = new DelegateTool();
    const result = await uninitializedTool.execute({
      description: 'Test task',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not initialized');
  });

  it('应支持可选的 subagent_type 参数', () => {
    const subagentTypeProp = tool.input_schema.properties?.subagent_type;
    expect(subagentTypeProp).toBeDefined();
    expect((subagentTypeProp as any).type).toBe('string');
  });

  it('应支持可选的 include_parent_context 参数', () => {
    const includeProp = tool.input_schema.properties?.include_parent_context;
    expect(includeProp).toBeDefined();
    expect((includeProp as any).type).toBe('boolean');
  });

  it('应支持可选的 isolation 参数', () => {
    const isolationProp = tool.input_schema.properties?.isolation;
    expect(isolationProp).toBeDefined();
    expect((isolationProp as any).enum).toContain('none');
    expect((isolationProp as any).enum).toContain('worktree');
  });

  it('应支持可选的 timeout 参数', () => {
    const timeoutProp = tool.input_schema.properties?.timeout;
    expect(timeoutProp).toBeDefined();
    expect((timeoutProp as any).type).toBe('number');
  });

  it('应标记为 readonly', () => {
    expect(tool.readonly).toBe(true);
  });

  it('应能获取活跃子代理数', () => {
    expect(tool.getActiveCount()).toBe(0);
  });
});
