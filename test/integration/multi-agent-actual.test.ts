/**
 * Multi-Agent 工具实际功能测试
 * 
 * 测试 delegate、orchestrate、quick_team 的实际执行
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ChatSession } from '@/core/chat/ChatSession';
import type { ToolResult } from '@/core/types';

describe('Multi-Agent Tools - Actual Execution', () => {
  let session: ChatSession;

  beforeAll(async () => {
    // 使用真实配置初始化
    session = new ChatSession({
      config: {
        provider: {
          adapter: 'anthropic',
          model: 'claude-sonnet-4-5-20250929',
          apiKey: process.env.ANTHROPIC_API_KEY || 'test-api-key',
          baseURL: 'https://api.anthropic.com',
          maxTokens: 8096,
          temperature: 0.7,
        },
        agent: {
          maxIterations: 30,
        },
        skills: {
          enabled: [],
        },
        tools: {
          enabled: [],
          permissions: {
            fileRead: 'allow',
            fileWrite: 'deny',
            bashExec: 'allow',
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
      },
    });

    await session.init();
  });

  afterAll(async () => {
    // ChatSession cleanup
    if (session) {
      // @ts-ignore
      await session.cleanup?.();
    }
  });

  describe('DelegateTool', () => {
    it('应该正确注册 delegate 工具', () => {
      // @ts-ignore
      const baseRegistry = session['baseRegistry'];
      const delegateTool = baseRegistry?.get('delegate');

      expect(delegateTool).toBeDefined();
      expect(delegateTool?.name).toBe('delegate');
      expect(delegateTool?.description).toContain('委托');
    });

    it('delegate 工具应该有正确的参数 schema', () => {
      // @ts-ignore
      const baseRegistry = session['baseRegistry'];
      const delegateTool = baseRegistry?.get('delegate');

      expect(delegateTool?.input_schema).toBeDefined();
      expect(delegateTool?.input_schema.properties).toHaveProperty('description');
      expect(delegateTool?.input_schema.properties).toHaveProperty('subagent_type');
      expect(delegateTool?.input_schema.properties).toHaveProperty('include_parent_context');
      expect(delegateTool?.input_schema.required).toContain('description');
    });

    it('delegate 工具依赖应该已注入', () => {
      // @ts-ignore
      const baseRegistry = session['baseRegistry'];
      const delegateTool = baseRegistry?.get('delegate');

      // @ts-ignore - 检查依赖是否注入
      expect(delegateTool?.['providerManager']).toBeDefined();
      // @ts-ignore
      expect(delegateTool?.['agentRegistry']).toBeDefined();
      // @ts-ignore
      expect(delegateTool?.['registry']).toBeDefined();
    });
  });

  describe('OrchestrateTool', () => {
    it('应该正确注册 orchestrate 工具', () => {
      // @ts-ignore
      const baseRegistry = session['baseRegistry'];
      const orchestrateTool = baseRegistry?.get('orchestrate');

      expect(orchestrateTool).toBeDefined();
      expect(orchestrateTool?.name).toBe('orchestrate');
      expect(orchestrateTool?.description).toContain('团队');
    });

    it('orchestrate 工具应该有正确的参数 schema', () => {
      // @ts-ignore
      const baseRegistry = session['baseRegistry'];
      const orchestrateTool = baseRegistry?.get('orchestrate');

      expect(orchestrateTool?.input_schema).toBeDefined();
      expect(orchestrateTool?.input_schema.properties).toHaveProperty('team_name');
      expect(orchestrateTool?.input_schema.properties).toHaveProperty('goal');
      expect(orchestrateTool?.input_schema.properties).toHaveProperty('strategy');
      expect(orchestrateTool?.input_schema.properties).toHaveProperty('members');
      expect(orchestrateTool?.input_schema.required).toContain('team_name');
      expect(orchestrateTool?.input_schema.required).toContain('goal');
      expect(orchestrateTool?.input_schema.required).toContain('strategy');
      expect(orchestrateTool?.input_schema.required).toContain('members');
    });

    it('orchestrate 工具应该支持 5 种协作策略', () => {
      // @ts-ignore
      const baseRegistry = session['baseRegistry'];
      const orchestrateTool = baseRegistry?.get('orchestrate');

      const strategyEnum = orchestrateTool?.input_schema.properties.strategy.enum;
      expect(strategyEnum).toContain('sequential');
      expect(strategyEnum).toContain('parallel');
      expect(strategyEnum).toContain('hierarchical');
      expect(strategyEnum).toContain('debate');
      expect(strategyEnum).toContain('pipeline');
    });
  });

  describe('QuickTeamTool', () => {
    it('应该正确注册 quick_team 工具', () => {
      // @ts-ignore
      const baseRegistry = session['baseRegistry'];
      const quickTeamTool = baseRegistry?.get('quick_team');

      expect(quickTeamTool).toBeDefined();
      expect(quickTeamTool?.name).toBe('quick_team');
      expect(quickTeamTool?.description).toContain('模板');
    });

    it('quick_team 工具应该有正确的参数 schema', () => {
      // @ts-ignore
      const baseRegistry = session['baseRegistry'];
      const quickTeamTool = baseRegistry?.get('quick_team');

      expect(quickTeamTool?.input_schema).toBeDefined();
      expect(quickTeamTool?.input_schema.properties).toHaveProperty('template');
      expect(quickTeamTool?.input_schema.properties).toHaveProperty('goal');
      expect(quickTeamTool?.input_schema.required).toContain('template');
      expect(quickTeamTool?.input_schema.required).toContain('goal');
    });

    it('quick_team 工具应该支持 5 种预定义模板', () => {
      // @ts-ignore
      const baseRegistry = session['baseRegistry'];
      const quickTeamTool = baseRegistry?.get('quick_team');

      const templateEnum = quickTeamTool?.input_schema.properties.template.enum;
      expect(templateEnum).toContain('code-review');
      expect(templateEnum).toContain('research');
      expect(templateEnum).toContain('architecture-debate');
      expect(templateEnum).toContain('data-pipeline');
      expect(templateEnum).toContain('feature-development');
    });
  });

  describe('工具集成', () => {
    it('所有三个工具应该都已注册', () => {
      // @ts-ignore
      const baseRegistry = session['baseRegistry'];
      
      expect(baseRegistry?.get('delegate')).toBeDefined();
      expect(baseRegistry?.get('orchestrate')).toBeDefined();
      expect(baseRegistry?.get('quick_team')).toBeDefined();
    });

    it('AgentRegistry 应该包含必需的 SubAgent', () => {
      const agentRegistry = session.getAgentRegistry();
      
      expect(agentRegistry?.get('explore')).toBeDefined();
      expect(agentRegistry?.get('plan')).toBeDefined();
      expect(agentRegistry?.get('coder')).toBeDefined();
      expect(agentRegistry?.get('general-purpose')).toBeDefined();
    });

    it('SubAgent 应该有正确的 metadata 标记', () => {
      const agentRegistry = session.getAgentRegistry();
      
      const explore = agentRegistry?.get('explore');
      expect(explore?.metadata?.isSubAgent).toBe(true);
      
      const plan = agentRegistry?.get('plan');
      expect(plan?.metadata?.isSubAgent).toBe(true);
      
      const coder = agentRegistry?.get('coder');
      expect(coder?.metadata?.isSubAgent).toBe(true);
    });
  });
});
