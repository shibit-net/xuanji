/**
 * TeamTool — 团队协作工具
 *
 * 允许 LLM 创建和管理 agent 团队来协作完成复杂任务
 */

import type { JSONSchema, ToolResult, AgentConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import { BaseTool } from './BaseTool';
import { TeamManager } from '@/core/agent/team/TeamManager';
import type { TeamConfig, TeamMember, TeamStrategy } from '@/core/agent/team/types';
import type { AgentRoleType } from '@/core/agent/SubAgentContext';

export class TeamTool extends BaseTool {
  readonly name = 'agent_team';
  readonly description = [
    'Create a team of AI agents to collaborate on complex tasks.',
    '',
    '🎯 WHEN TO USE (instead of single task tool):',
    '✓ User explicitly requests "team mode" or "multiple agents"',
    '✓ Task needs 3+ distinct expert roles (e.g., architect + security + performance)',
    '✓ User wants debate/discussion (e.g., "evaluate from different perspectives")',
    '✓ Clear multi-stage pipeline (e.g., "extract → analyze → report")',
    '',
    '❌ DO NOT USE when:',
    '✗ Single straightforward task → use task tool instead',
    '✗ Simple analysis or code change → handle it yourself',
    '✗ Sequential steps you can coordinate → just use task multiple times',
    '',
    '📋 Strategy Quick Guide:',
    'sequential = Code review (architect→security→performance, each builds on previous)',
    'parallel = Multi-source research (docs+blogs+code simultaneously, independent)',
    'hierarchical = Feature dev (tech lead plans → backend/frontend/qa execute)',
    'debate = Architecture design (3 rounds of discussion to reach consensus)',
    'pipeline = Data flow (extract→clean→analyze→visualize, output→input)',
    '',
    '💡 Common Patterns:',
    '"Review this code for quality, security, and performance" → sequential, 3 members',
    '"Research X from multiple sources" → parallel, 2-3 members',
    '"Design the best approach for Y" → debate, 2-3 members, max_rounds=3',
    '"Process data: extract, clean, analyze" → pipeline, 3-4 members',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      team_name: {
        type: 'string',
        description: 'Name for this team (e.g., "Code Review Team", "Research Squad")',
      },
      goal: {
        type: 'string',
        description: 'The overall goal the team should accomplish',
      },
      strategy: {
        type: 'string',
        enum: ['sequential', 'parallel', 'hierarchical', 'debate', 'pipeline'],
        description: 'Collaboration strategy. Choose based on task structure.',
      },
      members: {
        type: 'array',
        description: 'Team members definition',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique identifier (e.g., "analyst", "coder", "reviewer")',
            },
            role: {
              type: 'string',
              enum: ['general-purpose', 'explore', 'plan', 'coder'],
              description: 'Agent role type',
            },
            name: {
              type: 'string',
              description: 'Display name (optional, e.g., "Security Analyst")',
            },
            capabilities: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of this member\'s capabilities (e.g., ["code analysis", "security review"])',
            },
            priority: {
              type: 'number',
              description: 'Priority level (higher = more important). Required for hierarchical strategy.',
            },
            system_prompt: {
              type: 'string',
              description: 'Additional instructions specific to this member (optional)',
            },
          },
          required: ['id', 'role', 'capabilities'],
        },
      },
      max_rounds: {
        type: 'number',
        description: 'Maximum number of collaboration rounds (default: 10)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 600000 = 10 minutes)',
      },
    },
    required: ['team_name', 'goal', 'strategy', 'members'],
  };

  readonly readonly = false; // 团队执行可能涉及写操作

  // 依赖注入
  private mainProvider: ILLMProvider | null = null;
  private lightProvider: ILLMProvider | null = null;
  private registry: IToolRegistry | null = null;
  private agentConfig: AgentConfig | null = null;
  private hookRegistry: HookRegistry | null = null;
  private memoryStore: IMemoryStore | null = null;
  private currentDepth = 0;

  /**
   * 注入运行时依赖
   */
  setDependencies(deps: {
    provider: ILLMProvider;
    lightProvider: ILLMProvider;
    registry: IToolRegistry;
    agentConfig: AgentConfig;
    hookRegistry?: HookRegistry | null;
    memoryStore?: IMemoryStore | null;
    depth?: number;
  }): void {
    this.mainProvider = deps.provider;
    this.lightProvider = deps.lightProvider;
    this.registry = deps.registry;
    this.agentConfig = deps.agentConfig;
    this.hookRegistry = deps.hookRegistry ?? null;
    this.memoryStore = deps.memoryStore ?? null;
    this.currentDepth = deps.depth ?? 0;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    // 验证依赖
    if (!this.mainProvider || !this.lightProvider || !this.registry || !this.agentConfig) {
      return this.error('TeamTool not initialized. Internal error: dependencies not injected.');
    }

    // 解析参数
    const teamName = input.team_name as string;
    const goal = input.goal as string;
    const strategy = input.strategy as TeamStrategy;
    const membersInput = input.members as Array<{
      id: string;
      role: AgentRoleType;
      name?: string;
      capabilities: string[];
      priority?: number;
      system_prompt?: string;
    }>;
    const maxRounds = input.max_rounds as number | undefined;
    const timeout = input.timeout as number | undefined;

    // 验证输入
    if (!membersInput || membersInput.length === 0) {
      return this.error('Team must have at least one member');
    }

    if (membersInput.length > 10) {
      return this.error('Maximum team size is 10 members');
    }

    // 构建团队成员
    const members: TeamMember[] = membersInput.map(m => ({
      id: m.id,
      role: m.role,
      name: m.name,
      capabilities: m.capabilities,
      priority: m.priority,
      systemPrompt: m.system_prompt,
    }));

    // 创建团队配置
    const teamConfig: TeamConfig = {
      name: teamName,
      members,
      strategy,
      goal,
      maxRounds,
      timeout,
    };

    try {
      // 创建团队管理器
      const teamManager = new TeamManager(
        this.mainProvider,
        this.lightProvider,
        this.registry,
        this.agentConfig,
        this.hookRegistry,
        this.memoryStore,
        this.currentDepth,
      );

      // 创建团队
      await teamManager.createTeam(teamConfig);

      // 执行团队任务
      const result = await teamManager.execute(goal);

      // 格式化结果
      return this.formatResult(result, teamName, strategy);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return this.error(`Team execution failed: ${errMsg}`);
    }
  }

  /**
   * 格式化团队执行结果
   */
  private formatResult(
    result: import('@/core/agent/team/types').TeamExecutionResult,
    teamName: string,
    strategy: TeamStrategy,
  ): ToolResult {
    const meta = [
      `[Team "${teamName}" - Strategy: ${strategy}]`,
      `Duration: ${(result.duration / 1000).toFixed(1)}s`,
      `Rounds: ${result.rounds}`,
      `Members: ${result.memberResults.length}`,
      `Tokens: ${result.totalTokens.input} in / ${result.totalTokens.output} out`,
      result.timedOut ? '⚠️ Timed out' : '',
      result.success ? '✅ Success' : '❌ Failed',
    ].filter(Boolean).join(' | ');

    const memberSummary = result.memberResults
      .map(r => {
        const status = r.success ? '✅' : '❌';
        const duration = (r.duration / 1000).toFixed(1);
        return `${status} ${r.memberId}: ${duration}s, ${r.tokensUsed.input + r.tokensUsed.output} tokens`;
      })
      .join('\n');

    const content = [
      meta,
      '',
      '[Member Execution Summary]',
      memberSummary,
      '',
      '[Team Output]',
      result.output,
    ].join('\n');

    return this.success(content, {
      teamExecution: true,
      teamName,
      strategy,
      duration: result.duration,
      totalTokens: result.totalTokens,
      rounds: result.rounds,
      memberCount: result.memberResults.length,
      success: result.success,
      timedOut: result.timedOut,
    });
  }
}
