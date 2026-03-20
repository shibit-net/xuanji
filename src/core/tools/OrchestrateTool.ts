/**
 * OrchestrateTool — Agent 编排协作工具
 *
 * 编排多个 Agent 协作完成复杂任务，支持多种协作策略（sequential/parallel/pipeline/debate）
 */

import type { JSONSchema, ToolResult, AgentConfig, IToolRegistry } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import type { ProviderManager } from '@/core/providers/ProviderManager';
import type { AgentRegistry } from '@/core/agent/AgentRegistry';
import { BaseTool } from './BaseTool';
import { TeamManager } from '@/core/agent/team/TeamManager';
import type { TeamConfig, TeamMember, TeamStrategy } from '@/core/agent/team/types';
import type { AgentRoleType } from '@/core/agent/SubAgentContext';

export class OrchestrateTool extends BaseTool {
  readonly name = 'orchestrate';
  readonly description = [
    '创建 Agent 团队协作完成复杂任务。',
    '',
    '🎯 用户明确请求时优先使用:',
    '✓ "用 code-review team 审查代码"',
    '✓ "创建 research team 调研最佳实践"',
    '✓ "用 architecture-debate team 讨论缓存方案"',
    '',
    '🤖 系统自动判断时使用:',
    '✓ 需要 3+ 个不同专业角色（如架构师+安全+性能）',
    '✓ 需要辩论/讨论达成共识（评估方案优劣）',
    '✓ 需要流水线处理数据（提取→清洗→分析）',
    '✓ 需要并行研究多个来源（文档+代码+社区）',
    '',
    '📋 协作策略:',
    '• sequential - 顺序执行（代码审查：架构→安全→性能，各自独立）',
    '• parallel - 并行执行（多源调研：文档+代码+社区，同时进行）',
    '• hierarchical - 分层执行（功能开发：技术负责人→后端/前端/QA）',
    '• debate - 辩论模式（架构讨论：3 方辩论，3 轮达成共识）',
    '• pipeline - 流水线（数据处理：提取→清洗→分析，输出传递）',
    '',
    '💡 常见模式:',
    '• "审查代码质量、安全、性能" → sequential, 3 成员',
    '• "从多个来源调研 X" → parallel, 2-3 成员',
    '• "设计 Y 的最佳方案" → debate, 2-3 成员, max_rounds=3',
    '• "处理数据：提取、清洗、分析" → pipeline, 3-4 成员',
    '',
    '❌ 不要使用:',
    '✗ 单个 Agent 能完成的任务 → 用 task 工具',
    '✗ 简单分析或代码修改 → 自己完成',
    '✗ 可以自己协调的顺序步骤 → 多次调用 task 工具',
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
              description: [
                'Agent ID (supports custom agents from AgentRegistry)',
                '',
                '内置: general-purpose, explore, plan, coder',
                '自定义: 任意 metadata.isSubAgent=true 的 Agent ID',
              ].join('\n'),
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

  readonly readonly = false; // 编排执行可能涉及写操作

  // 依赖注入
  private providerManager: ProviderManager | null = null;
  private agentRegistry: AgentRegistry | null = null;
  private registry: IToolRegistry | null = null;
  private agentConfig: AgentConfig | null = null;
  private hookRegistry: HookRegistry | null = null;
  private memoryStore: IMemoryStore | null = null;
  private currentDepth = 0;

  /**
   * 注入运行时依赖
   */
  setDependencies(deps: {
    providerManager: ProviderManager;
    agentRegistry: AgentRegistry;
    registry: IToolRegistry;
    agentConfig: AgentConfig;
    hookRegistry?: HookRegistry | null;
    memoryStore?: IMemoryStore | null;
    depth?: number;
  }): void {
    this.providerManager = deps.providerManager;
    this.agentRegistry = deps.agentRegistry;
    this.registry = deps.registry;
    this.agentConfig = deps.agentConfig;
    this.hookRegistry = deps.hookRegistry ?? null;
    this.memoryStore = deps.memoryStore ?? null;
    this.currentDepth = deps.depth ?? 0;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    // 验证依赖
    if (!this.providerManager || !this.agentRegistry || !this.registry || !this.agentConfig) {
      return this.error('OrchestrateTool not initialized. Internal error: dependencies not injected.');
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
      // 获取 Provider 实例
      const mainProvider = this.providerManager.getProvider(this.agentConfig);
      const lightProvider = this.providerManager.getLightProvider();

      // 创建团队管理器
      const teamManager = new TeamManager(
        mainProvider,
        lightProvider,
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
