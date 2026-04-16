/**
 * Multi-Agent 工具集成测试
 *
 * 验证 ChainTool, ListAgentsTool, MatchAgentTool 是否正确注册
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ChatSession } from '@/core/chat/ChatSession';

describe('Multi-Agent Tools Integration', () => {
  let session: ChatSession;

  beforeAll(async () => {
    session = new ChatSession({
      config: {
        provider: {
          adapter: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          apiKey: 'test-api-key',
          baseURL: 'https://api.anthropic.com',
          maxTokens: 8096,
          temperature: 0.7,
        },
        agent: {
          maxIterations: 30,
        },
        skills: {
          enabled: ['xuanji-assistant', 'memory-context'],
        },
        tools: {
          enabled: [],
          permissions: {
            fileRead: 'ask',
            fileWrite: 'ask',
            bashExec: 'ask',
          },
        },
        ui: {
          language: 'zh',
          theme: 'auto',
          showTokenUsage: true,
          showCost: false,
          showThinking: false,
        },
        retry: {
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 10000,
          backoffMultiplier: 2,
          retryableStatusCodes: [429, 500, 502, 503, 504],
        },
        routing: {
          mode: 'never',
        } as any,
      },
    });

    await session.init();
  });

  it('应该注册 ListAgentsTool', () => {
    // @ts-ignore - 访问私有属性用于测试
    const baseRegistry = session['baseRegistry'];
    expect(baseRegistry).toBeDefined();
    const listAgentsTool = baseRegistry!.get('list_agents');

    expect(listAgentsTool).toBeDefined();
    expect(listAgentsTool?.name).toBe('list_agents');
    expect(listAgentsTool?.description).toContain('List all available agents');
  });

  it('应该注册 MatchAgentTool', () => {
    // @ts-ignore - 访问私有属性用于测试
    const baseRegistry = session['baseRegistry'];
    expect(baseRegistry).toBeDefined();
    const matchAgentTool = baseRegistry!.get('match_agent');

    expect(matchAgentTool).toBeDefined();
    expect(matchAgentTool?.name).toBe('match_agent');
    expect(matchAgentTool?.description).toContain('Find the best agent');
  });

  it('AgentRegistry 应该已初始化', () => {
    const agentRegistry = session.getAgentRegistry();

    expect(agentRegistry).toBeDefined();
    expect(agentRegistry?.getAllIds).toBeDefined();
  });

  it('AgentRegistry 应该包含内置的 SubAgent 配置', () => {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      throw new Error('AgentRegistry not initialized');
    }

    const builtinAgents = ['xuanji', 'general-purpose', 'explore', 'plan', 'coder'];

    for (const agentId of builtinAgents) {
      const agent = agentRegistry.get(agentId);
      expect(agent).toBeDefined();
      expect(agent?.metadata?.source).toBe('builtin');
    }
  });

  it('SubAgent 配置应该有正确的 metadata 标记', () => {
    const agentRegistry = session.getAgentRegistry();
    if (!agentRegistry) {
      throw new Error('AgentRegistry not initialized');
    }

    // 验证 SubAgent 标记
    const subAgents = ['general-purpose', 'explore', 'plan', 'coder'];
    for (const agentId of subAgents) {
      const agent = agentRegistry.get(agentId);
      expect(agent?.metadata?.isSubAgent).toBe(true);
    }

    // 验证主 Agent 标记
    const mainAgent = agentRegistry.get('xuanji');
    expect(mainAgent?.metadata?.isMainAgent).toBe(true);
  });
});
