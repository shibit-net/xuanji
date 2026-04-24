/**
 * TeamTool — 团队协作工具
 *
 * 允许 LLM 创建和管理 agent 团队来协作完成复杂任务
 */

import type { JSONSchema, ToolResult, AgentConfig, ILLMProvider, IToolRegistry } from '@/core/types';
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
    'CRITICAL: Use match_agent FIRST to find suitable preset agents for each role.',
    'Use EXACT agentId from match_agent (e.g., "coder", "explore", "plan").',
    '',
    '⚠️ IMPORTANT - Temporary Agents:',
    'If agent_id does NOT exist in the registry (not a preset agent):',
    '- You MUST provide system_prompt for that member to define its behavior',
    '- The temporary agent will inherit the parent agent\'s LLM configuration',
    '- Example: { id: "m1", agent_id: "custom-analyzer", system_prompt: "You are a data analyzer..." }',
    '',
    'Members parameter MUST be an array: [{ id: "m1", ... }, { id: "m2", ... }]',
    '',
    'Strategies: parallel (independent tasks), sequential (dependent steps),',
    'hierarchical (leader + workers), debate (pros/cons), pipeline (data flow).',
    '',
    'Detailed usage guide is available in l2-team-coordination prompt (loaded for complex tasks).',
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
        description: [
          'The overall goal the team should accomplish.',
          'Team members have NO access to the parent conversation history.',
          'You MUST include all necessary context inline: relevant findings, constraints, file paths, decisions, and expected output format.',
          'Think of this as a self-contained brief — everything the team needs to succeed must be here.',
        ].join('\n'),
      },
      strategy: {
        type: 'string',
        enum: ['sequential', 'parallel', 'hierarchical', 'debate', 'pipeline'],
        description: 'Collaboration strategy. Choose based on task structure.',
      },
      members: {
        type: 'array',
        description: [
          '⚠️ CRITICAL: This MUST be an array of team member objects.',
          'Team members definition - each member represents one agent in the team.',
          '',
          'Example:',
          '  members: [',
          '    { id: "m1", role: "coder", capabilities: ["code review"] },',
          '    { id: "m2", role: "explore", capabilities: ["security analysis"] }',
          '  ]',
        ].join('\n'),
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique identifier (e.g., "analyst", "coder", "reviewer")',
            },
            agent_id: {
              type: 'string',
              description: [
                '⚠️ CRITICAL: This field MUST contain the EXACT agentId returned by match_agent.',
                '',
                '🚫 FORBIDDEN: Do NOT invent custom names like "code-reviewer", "security-analyst", "结构扫描器".',
                '✅ REQUIRED: Use the exact string from match_agent result: "coder", "explore", "plan", etc.',
                '',
                '⚡ MANDATORY WORKFLOW:',
                '1. Call match_agent({ task_description: "..." })',
                '2. Look at the result: { agentId: "coder", score: 0.85 }',
                '3. Copy "coder" EXACTLY to this field',
                '',
                '⚠️ TEMPORARY AGENTS:',
                'If you use a custom agent_id that does NOT exist in the registry:',
                '- You MUST provide system_prompt for this member',
                '- The temporary agent will inherit parent agent\'s LLM configuration',
                '- Example: { agent_id: "custom-analyzer", system_prompt: "You are..." }',
                '',
                'Example - CORRECT:',
                '  match_agent({ task_description: "review code quality" })',
                '  → Returns: { agentId: "coder", score: 0.85 }',
                '  → agent_id: "coder"  ✅ Copied exactly',
                '',
                'Example - WRONG:',
                '  match_agent({ task_description: "review code quality" })',
                '  → Returns: { agentId: "coder", score: 0.85 }',
                '  → agent_id: "code-reviewer"  ❌ Custom name - DO NOT DO THIS',
                '  → agent_id: "代码审查员"  ❌ Custom name - DO NOT DO THIS',
                '',
                'Valid preset agent IDs (use these EXACTLY):',
                '- "coder" — Code writing, refactoring, debugging',
                '- "explore" — Code exploration, analysis, research',
                '- "test-writer" — Test creation and validation',
                '- "doc-writer" — Documentation writing',
                '- "plan" — Planning and design',
                '- "general-purpose" — Default versatile agent',
              ].join('\n'),
            },
            name: {
              type: 'string',
              description: 'Display name (optional, e.g., "Security Analyst")',
            },
            capabilities: {
              type: 'array',
              items: { type: 'string' },
              description: [
                'List of this member\'s capabilities (e.g., ["code analysis", "security review"]).',
                'Optional - if omitted, will be auto-derived from system_prompt or role.',
              ].join('\n'),
            },
            priority: {
              type: 'number',
              description: 'Priority level (higher = more important). Required for hierarchical strategy.',
            },
            system_prompt: {
              type: 'string',
              description: [
                'Custom system prompt for this member.',
                '',
                '⚠️ REQUIRED when agent_id is NOT a preset agent:',
                '- If you use a custom agent_id that doesn\'t exist in the registry',
                '- You MUST provide this parameter to define the agent\'s behavior',
                '- The temporary agent will inherit parent agent\'s LLM configuration',
                '',
                'OPTIONAL when agent_id is a preset agent:',
                '- Overrides the preset agent config systemPrompt when provided',
                '- Use this to customize behavior for specific tasks',
              ].join('\n'),
            },
            tools: {
              type: 'array',
              items: { type: 'string' },
              description: 'Custom tool list for this member. Overrides preset agent config tools when provided.',
            },
            timeout: {
              type: 'number',
              description: [
                'Per-member timeout in milliseconds (optional).',
                '',
                '⚠️ WARNING: Explicitly setting this value will OVERRIDE auto-calculated timeouts.',
                'The system automatically allocates timeout based on strategy:',
                '  - parallel: each member gets full team timeout',
                '  - sequential: members share with progressive allocation',
                '  - hierarchical: leader gets 50%, workers share remaining',
                '',
                '❌ Common mistake: Setting member.timeout = 60000 when team.timeout = 300000',
                '   → Member only gets 60s instead of auto-allocated 300s (parallel)',
                '',
                '✅ Best practice: DO NOT set this field unless you have a specific reason.',
                'Let the system auto-calculate based on strategy and team timeout.',
              ].join('\n'),
            },
          },
          required: ['id'],
        },
      },
      max_rounds: {
        type: 'number',
        description: 'Maximum number of collaboration rounds (default: 10)',
      },
      timeout: {
        type: 'number',
        description: [
          '🆕 Team total timeout in milliseconds (default: 1200000 = 20 minutes).',
          '',
          '⚡ This is a HARD LIMIT for the entire team execution.',
          'The system will automatically calculate member timeouts based on:',
          '  - Team total timeout',
          '  - Strategy (parallel/sequential/hierarchical/debate/pipeline)',
          '  - Number of members',
          '',
          '📊 Recommended timeouts by strategy and complexity:',
          '',
          'Simple tasks (2-3 members):',
          '  - parallel: 600000ms (10 min)',
          '  - sequential: 900000ms (15 min)',
          '',
          'Medium tasks (3-4 members):',
          '  - parallel: 1200000ms (20 min) — default',
          '  - sequential: 1800000ms (30 min)',
          '  - hierarchical: 1800000ms (30 min)',
          '',
          'Complex/Large analysis tasks (4-5 members):',
          '  - parallel: 2400000ms (40 min)',
          '  - sequential: 3600000ms (60 min)',
          '  - hierarchical: 3000000ms (50 min)',
          '  - debate (3 rounds): 2400000ms (40 min)',
          '',
          '⚠️ For large analysis tasks, use 40-60 minutes to ensure completion.',
          '',
          '💡 How it works:',
          '  - parallel: each member gets ~full timeout (concurrent)',
          '  - sequential: members share timeout progressively',
          '  - hierarchical: leader gets 50%, workers share remaining',
          '',
          '✅ Best practice: Set generous timeout, let strategy auto-allocate to members.',
        ].join('\n'),
      },
    },
    required: ['team_name', 'goal', 'strategy', 'members'],
  };

  readonly readonly = false; // 团队执行可能涉及写操作

  // 依赖注入
  private mainProvider: ILLMProvider | null = null;
  private registry: IToolRegistry | null = null;
  private agentConfig: AgentConfig | null = null;
  private hookRegistry: HookRegistry | null = null;
  private currentDepth = 0;
  private agentRegistry: import('@/core/agent/AgentRegistry').AgentRegistry | null = null;
  private providerManager: import('@/core/providers/ProviderManager').ProviderManager | null = null;

  /**
   * 注入运行时依赖
   */
  setDependencies(deps: {
    provider: ILLMProvider;
    registry: IToolRegistry;
    agentConfig: AgentConfig;
    hookRegistry?: HookRegistry | null;
    depth?: number;
    agentRegistry?: import('@/core/agent/AgentRegistry').AgentRegistry | null;
    providerManager?: import('@/core/providers/ProviderManager').ProviderManager | null;
  }): void {
    this.mainProvider = deps.provider;
    this.registry = deps.registry;
    this.agentConfig = deps.agentConfig;
    this.hookRegistry = deps.hookRegistry ?? null;
    this.currentDepth = deps.depth ?? 0;
    this.agentRegistry = deps.agentRegistry ?? null;
    this.providerManager = deps.providerManager ?? null;
  }

  async execute(input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    // 验证依赖
    if (!this.mainProvider || !this.registry || !this.agentConfig) {
      return this.error('TeamTool not initialized. Internal error: dependencies not injected.');
    }

    // 验证 agentRegistry 和 providerManager（TeamManager 现在强制要求）
    if (!this.agentRegistry || !this.providerManager) {
      return this.error('TeamTool requires agentRegistry and providerManager to be initialized.');
    }

    // 解析参数
    const teamName = input.team_name as string;
    const goal = input.goal as string;
    const strategy = input.strategy as TeamStrategy;
    const membersInput = input.members as Array<{
      id: string;
      agent_id?: string;
      role?: AgentRoleType; // 向后兼容，已废弃
      name?: string;
      capabilities?: string[];
      priority?: number;
      system_prompt?: string;
      tools?: string[];
      timeout?: number;
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
      agentId: m.agent_id || m.role || 'general-purpose', // 优先使用 agent_id，向后兼容 role
      name: m.name,
      capabilities: m.capabilities ?? [],
      priority: m.priority,
      systemPrompt: m.system_prompt,
      tools: m.tools,
      timeout: m.timeout,
    }));

    // 🆕 计算超时配置
    const teamTotalTimeout = timeout ?? 1_200_000; // 默认 20 分钟（更充足，适合大型分析任务）
    let defaultMemberTimeout: number;

    // 根据策略和成员数量自动计算 defaultMemberTimeout
    switch (strategy) {
      case 'parallel':
        // 并行：每个成员可以用接近全部时间（留 10% 缓冲）
        defaultMemberTimeout = Math.floor(teamTotalTimeout * 0.9);
        break;
      case 'sequential':
        // 串行：平均分配，前面成员会得到更多（通过权重调整）
        defaultMemberTimeout = Math.floor(teamTotalTimeout / members.length);
        break;
      case 'hierarchical':
        // 层级：leader + workers，按 1.5:1 比例分配
        // 假设 1 个 leader + N 个 workers
        // total = leader * 1.5 + workers * 1.0 = 1.5 + (N-1) = N + 0.5
        // defaultMemberTimeout = total / (N + 0.5)
        defaultMemberTimeout = Math.floor(teamTotalTimeout / (members.length + 0.5));
        break;
      case 'debate':
        // 辩论：多轮，每轮所有成员发言
        const rounds = maxRounds ?? 10;
        // 首轮 1.0x，后续轮 0.6x，平均约 0.7x
        defaultMemberTimeout = Math.floor(teamTotalTimeout / (members.length * rounds * 0.7));
        break;
      case 'pipeline':
        // 流水线：串行，但各阶段权重不同（1.3x, 1.0x, 0.7x）
        // 平均约 1.0x
        defaultMemberTimeout = Math.floor(teamTotalTimeout / members.length);
        break;
      default:
        defaultMemberTimeout = Math.floor(teamTotalTimeout / members.length);
    }

    // 创建团队配置
    const teamConfig: TeamConfig = {
      name: teamName,
      members,
      strategy,
      goal,
      maxRounds,
      teamTotalTimeout,           // 🆕 团队总超时
      defaultMemberTimeout,       // 🆕 成员基准超时（会被策略权重调整）
      // memberTimeoutMs 不设置，让策略计算生效
    };

    try {
      // 创建团队管理器
      const teamManager = new TeamManager(
        this.mainProvider,
        this.registry,
        this.agentConfig,
        this.hookRegistry,
        null,
        this.currentDepth,
        this.agentRegistry,
        this.providerManager,
      );

      // 创建团队
      await teamManager.createTeam(teamConfig);

      // 执行团队任务
      const result = await teamManager.execute(goal, signal);

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
