import { describe, it, expect, beforeEach } from 'vitest';
import { SubAgentFactory } from '@/core/agent/SubAgentFactory';
import { AgentRegistry } from '@/core/agent/AgentRegistry';
import {
  createMockProviderManager,
  createMockToolRegistry,
  createMockAgentConfig,
} from '../helpers/mock-factory';
import type { ConfigurableAgentConfig } from '@/core/agent/types';

describe('Integration: Agent disabled check', () => {
  let agentRegistry: AgentRegistry;
  let subAgentFactory: SubAgentFactory;

  beforeEach(async () => {
    // 创建测试用的 AgentRegistry
    agentRegistry = new AgentRegistry('test-user');

    // 注册一个测试 agent（启用状态）
    const enabledAgent: ConfigurableAgentConfig = {
      id: 'test-enabled-agent',
      name: 'Test Enabled Agent',
      description: 'A test agent that is enabled',
      capabilities: ['test capability'],
      tools: [{ name: 'read_file' }],
      systemPrompt: 'You are a test agent',
      model: {
        primary: 'claude-sonnet-4-6',
        maxTokens: 1000,
      },
      provider: {
        apiKey: 'test-key',
      },
      execution: {
        maxIterations: 10,
        timeout: 30000,
      },
      enabled: true,
      metadata: {
        category: 'app',
      },
    };

    // 注册一个禁用的 agent
    const disabledAgent: ConfigurableAgentConfig = {
      id: 'test-disabled-agent',
      name: 'Test Disabled Agent',
      description: 'A test agent that is disabled',
      capabilities: ['test capability'],
      tools: [{ name: 'read_file' }],
      systemPrompt: 'You are a test agent',
      model: {
        primary: 'claude-sonnet-4-6',
        maxTokens: 1000,
      },
      provider: {
        apiKey: 'test-key',
      },
      execution: {
        maxIterations: 10,
        timeout: 30000,
      },
      enabled: false,
      metadata: {
        category: 'app',
      },
    };

    agentRegistry.register(enabledAgent);
    agentRegistry.register(disabledAgent);

    // 创建 SubAgentFactory
    const providerManager = createMockProviderManager();
    const toolRegistry = createMockToolRegistry();
    const agentConfig = createMockAgentConfig();

    subAgentFactory = new SubAgentFactory(
      agentRegistry,
      providerManager,
      toolRegistry,
      null,
      null,
      null,
      agentConfig as any
    );
  });

  it('should allow creating enabled agent', async () => {
    // 尝试创建启用的 agent，应该成功
    await expect(
      subAgentFactory.createSubAgent('test-enabled-agent', {
        task: 'Test task',
        timeout: 5000,
      })
    ).resolves.toBeDefined();
  });

  it('should reject creating disabled agent', async () => {
    // 尝试创建禁用的 agent，应该抛出错误
    await expect(
      subAgentFactory.createSubAgent('test-disabled-agent', {
        task: 'Test task',
        timeout: 5000,
      })
    ).rejects.toThrow(/is disabled/);
  });

  it('should filter out disabled agents in getEnabled()', () => {
    const enabledAgents = agentRegistry.getEnabled();

    // 应该只包含启用的 agent
    expect(enabledAgents).toHaveLength(1);
    expect(enabledAgents[0].id).toBe('test-enabled-agent');
    expect(enabledAgents.find(a => a.id === 'test-disabled-agent')).toBeUndefined();
  });

  it('should include disabled agents in getAll()', () => {
    const allAgents = agentRegistry.getAll();

    // 应该包含所有 agent
    expect(allAgents).toHaveLength(2);
    expect(allAgents.find(a => a.id === 'test-enabled-agent')).toBeDefined();
    expect(allAgents.find(a => a.id === 'test-disabled-agent')).toBeDefined();
  });
});
