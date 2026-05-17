/**
 * TeamTool — 团队协作工具
 *
 * 创建多 agent 团队协作完成任务。支持 5 种协作策略。
 * 第 0 层（主 agent）自动异步执行，第 1+ 层自动同步。
 * agent_team 成员是执行单元，不能再次创建子 agent 或子 team。
 */

import type { JSONSchema, ToolResult, AgentConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import type { HookListener } from '@/hooks/EventEmitter.js';
import { BaseTool } from './BaseTool';
import { TeamManager } from '@/core/agent/team/TeamManager';
import type { TeamConfig, TeamMember, TeamStrategy } from '@/core/agent/team/types';
import type { AgentRoleType } from '@/core/agent/SubAgentContext';
import { TaskOrchestrator } from '@/core/task/TaskOrchestrator';
import { TeamContext } from './TeamContext';

// ─── 成员输入类型 ────────────────────────────────────

interface MemberInput {
  id: string;
  agent_id?: string;
  role?: AgentRoleType;
  name?: string;
  task?: string;
  capabilities?: string[];
  priority?: number;
  scene?: string;
  scenes?: string[];
  system_prompt?: string;
  tools?: string[];
  timeout?: number;
}

// ─── 策略超时配置 ────────────────────────────────────

const STRATEGY_BASE_TIMEOUT: Record<string, number> = {
  debate:       1_800_000,  // 30min
  hierarchical: 600_000 + 300_000, // leader + at least 1 worker
  parallel:     600_000 + 200_000,
  sequential:   300_000 + 100_000,
  pipeline:     300_000 + 150_000,
};

const DEBATE_ROUND_FACTORS: Record<number, number> = {
  2: 1.0, 3: 1.5, 4: 2.0, 5: 3.0,
};

const MAX_MEMBERS = 10;
const MIN_MEMBER_TIMEOUT_MS = 120_000; // 2 分钟

// ─── TeamTool ────────────────────────────────────────

export class TeamTool extends BaseTool {
  readonly name = 'agent_team';
  readonly description = [
    'Create a team of agents to collaborate on a task. Supports 5 strategies.',
    '',
    'WHEN TO USE:',
    '• parallel — Multiple agents analyze same input from different angles',
    '• sequential — Each agent processes previous agent\'s output',
    '• hierarchical — A leader agent coordinates and delegates to member agents',
    '• debate — Agents discuss and reach consensus on a decision',
    '• pipeline — Data flows through agents in sequence, each transforms the data',
    '',
    'WHEN NOT TO USE:',
    '• Single sub-task → use task instead (simpler, faster)',
    '',
    'IMPORTANT: Team members are execution units — they cannot call task or agent_team.',
    'If you need nested delegation, use task to create a leader agent that further delegates.',
    '',
    'Always use list_scenes to pick the right scene for each member.',
    '',
    'TASK ASSIGNMENT — You are the assigner:',
    '• You MUST assign a unique, specific task to EACH member via the `task` field.',
    '• Do NOT give all members the same task. Each member should have a clearly different responsibility.',
    '• The `goal` is the team\'s overall objective. Each `member.task` is that member\'s specific contribution.',
    '• For debate: assign different stances/perspectives via `system_prompt` with [debate_role:...] tag.',
    '• For parallel: assign different analysis angles to each member.',
    '• For sequential/pipeline: each member\'s task should reflect their position in the workflow.',
    '• Sub-agents have NO access to parent conversation — put ALL needed context in task + system_prompt.',
    '',
    'Example — parallel:',
    '  agent_team({',
    '    team_name: "code-review",',
    '    goal: "Review codebase from quality, security, and performance.",',
    '    strategy: "parallel",',
    '    members: [',
    '      { id: "quality", agent_id: "explore", task: "Check code quality, smells, maintainability", tools: ["read_file", "glob", "grep", "list_directory"] },',
    '      { id: "security", agent_id: "explore", task: "Find security vulnerabilities", scene: "review", tools: ["read_file", "glob", "grep", "list_directory"] },',
    '    ]',
    '  })',
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
        description: 'Team overall goal (WHAT the team should achieve as a whole). Note: this is the team-level objective, NOT each member\'s task. Assign individual tasks via members[].task. Sub-agents have NO access to parent conversation history — include ALL context: file paths, constraints, output format',
      },
      strategy: {
        type: 'string',
        enum: ['sequential', 'parallel', 'hierarchical', 'debate', 'pipeline'],
        description: 'Collaboration strategy. Choose based on task structure.',
      },
      members: {
        type: 'array',
        description: 'Team member array. Each member is a worker agent executing a specific sub-task with clear division of work',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique member identifier. Use short role names (e.g. "quality", "security")' },
            agent_id: {
              type: 'string',
              description: [
                'Must come from match_agent results. Do not invent agent IDs.',
                '- Score >= 0.5: use the agent ID from match_agent directly',
                '- Score < 0.5: use a custom ID and must provide system_prompt (creates temporary agent)',
                '- Multi-perspective on same domain: use same agent ID + different scene/system_prompt',
              ].join('\n'),
            },
            name: { type: 'string', description: 'Member display name (optional), e.g. "Security Reviewer"' },
            capabilities: { type: 'array', items: { type: 'string' }, description: 'Member capability list (optional)' },
            priority: { type: 'number', description: 'Priority (required for hierarchical strategy, leader set >= 8)' },
            task: { type: 'string', description: 'Member\'s specific task (WHAT to do). Assigned by you (main agent). Each member must have a unique, executable task. Never give multiple members the same or highly similar task descriptions' },
            scene: {
              type: 'string',
              description: [
                'Scene type, determines which L1 prompt the sub-agent loads.',
                '**Must query list_scenes first and pick a valid scene ID**.',
                'Do not invent scene IDs.',
                'Omit if no suitable scene exists.',
              ].join('\n'),
            },
            system_prompt: {
              type: 'string',
              description: 'Role behavior guidance (HOW to behave). Written by you (main agent) to define the member\'s stance, mindset, and boundaries. Required for temporary agents, optional for preset agents. Debate strategy: include [debate_role:affirmative|negative|judge] tag to specify stance',
            },
            tools: { type: 'array', items: { type: 'string' }, description: 'List of tool names available to this member. Sub-agents have NO tools by default — strongly recommended to provide explicitly. Minimum: read_file, glob, grep, list_directory. Coding: add write_file, edit_file, bash' },
            timeout: { type: 'number', description: 'Member timeout in milliseconds. Not recommended to set — system auto-allocates' },
          },
          required: ['id'],
        },
      },
      max_rounds: { type: 'number', description: 'Max collaboration rounds (default: 5)' },
      timeout: {
        type: 'number',
        description: [
          'Team total timeout in milliseconds (hard limit). Auto-calculated if not set.',
          'Suggestions: code review 30-60min, debate consensus 1.5h+, large refactor 2-3h.',
        ].join(' '),
      },
      async: {
        type: 'boolean',
        description: 'Async execution mode. Main agent auto-async, sub-agent auto-sync. Generally no need to set this.',
      },
    },
    required: ['team_name', 'goal', 'strategy', 'members'],
  };

  readonly readonly = false;

  // ── 依赖注入 ────────────────────────────────────────

  private mainProvider: ILLMProvider | null = null;
  private registry: IToolRegistry | null = null;
  private agentConfig: AgentConfig | null = null;
  private hookRegistry: HookRegistry | null = null;
  private currentDepth = 0;
  private agentRegistry: import('@/core/agent/AgentRegistry').AgentRegistry | null = null;
  private providerManager: import('@/core/providers/ProviderManager').ProviderManager | null = null;
  private layeredPromptBuilder: import('@/core/prompt/LayeredPromptBuilder').LayeredPromptBuilder | null = null;

  setDependencies(deps: {
    provider: ILLMProvider;
    registry: IToolRegistry;
    agentConfig: AgentConfig;
    hookRegistry?: HookRegistry | null;
    depth?: number;
    agentRegistry?: import('@/core/agent/AgentRegistry').AgentRegistry | null;
    providerManager?: import('@/core/providers/ProviderManager').ProviderManager | null;
    layeredPromptBuilder?: import('@/core/prompt/LayeredPromptBuilder').LayeredPromptBuilder;
  }): void {
    this.mainProvider = deps.provider;
    this.registry = deps.registry;
    this.agentConfig = deps.agentConfig;
    this.hookRegistry = deps.hookRegistry ?? null;
    this.currentDepth = deps.depth ?? 0;
    this.agentRegistry = deps.agentRegistry ?? null;
    this.providerManager = deps.providerManager ?? null;
    this.layeredPromptBuilder = deps.layeredPromptBuilder ?? null;
  }

  // ── 主入口 ──────────────────────────────────────────

  async execute(input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    // 1. 依赖检查
    const depsErr = this.checkDependencies();
    if (depsErr) return depsErr;

    // 2. 嵌套检查
    if (TeamContext.get()) {
      return this.error('agent_team cannot be nested inside another agent_team. Complete work directly in the current team, or have the main agent create an independent agent_team.');
    }

    // 3. 参数解析
    const parsed = this.parseInput(input);

    // 4. 输入验证
    const validationErr = this.validateInput(parsed);
    if (validationErr) return validationErr;

    // 5. 构建团队配置
    const teamConfig = this.buildTeamConfig(parsed);

    // 6. 执行
    const isAsync = this.currentDepth === 0 || input.async === true;
    if (isAsync) {
      return this.executeAsync(teamConfig, parsed, input);
    }
    return this.executeSync(teamConfig, parsed.goal, signal, input._cwd as string | undefined);
  }

  // ── 依赖与输入验证 ──────────────────────────────────

  private checkDependencies(): ToolResult | null {
    if (!this.mainProvider || !this.registry || !this.agentConfig) {
      return this.error('TeamTool not initialized. Internal error: dependencies not injected.');
    }
    if (!this.agentRegistry || !this.providerManager) {
      return this.error('TeamTool requires agentRegistry and providerManager to be initialized.');
    }
    return null;
  }

  private parseInput(input: Record<string, unknown>): {
    teamName: string;
    goal: string;
    strategy: TeamStrategy;
    membersInput: MemberInput[];
    maxRounds?: number;
    timeout?: number;
  } {
    return {
      teamName: input.team_name as string,
      goal: input.goal as string,
      strategy: input.strategy as TeamStrategy,
      membersInput: (input.members || []) as MemberInput[],
      maxRounds: input.max_rounds as number | undefined,
      timeout: input.timeout as number | undefined,
    };
  }

  private validateInput(parsed: {
    membersInput: MemberInput[];
    strategy: string;
    timeout?: number;
  }): ToolResult | null {
    if (!parsed.membersInput || parsed.membersInput.length === 0) {
      return this.error('Team must have at least one member');
    }
    if (parsed.membersInput.length > MAX_MEMBERS) {
      return this.error(`Maximum team size is ${MAX_MEMBERS} members`);
    }
    return null;
  }

  // ── 团队配置构建 ────────────────────────────────────

  private buildTeamConfig(parsed: {
    teamName: string;
    goal: string;
    strategy: TeamStrategy;
    membersInput: MemberInput[];
    maxRounds?: number;
    timeout?: number;
  }): TeamConfig {
    const { teamName, goal, strategy, membersInput, maxRounds, timeout } = parsed;
    const rounds = maxRounds ?? 3;

    const members = this.buildMembers(membersInput);
    const teamTotalTimeout = this.calculateTeamTimeout(strategy, members.length, rounds, timeout);
    const defaultMemberTimeout = this.calculateMemberTimeout(strategy, members.length, rounds, teamTotalTimeout);

    return {
      name: teamName,
      members,
      strategy,
      goal,
      maxRounds: rounds,
      teamTotalTimeout,
      defaultMemberTimeout,
    };
  }

  private buildMembers(membersInput: MemberInput[]): TeamMember[] {
    return membersInput.map(m => ({
      id: m.id,
      agentId: m.agent_id || m.role || '',
      name: m.name,
      task: m.task,
      capabilities: m.capabilities ?? [],
      priority: m.priority,
      scene: m.scene,
      scenes: m.scenes,
      systemPrompt: m.system_prompt,
      tools: m.tools,
      timeout: m.timeout,
    }));
  }

  // ── 超时计算 ────────────────────────────────────────

  private calculateTeamTimeout(
    strategy: string,
    memberCount: number,
    rounds: number,
    userTimeout?: number,
  ): number {
    if (userTimeout) return userTimeout;

    const base = STRATEGY_BASE_TIMEOUT[strategy] ?? 600_000;
    // 按成员数调整基准超时
    const scaled = strategy === 'debate'
      ? base
      : base + (memberCount - 1) * (
          strategy === 'hierarchical' ? 300_000
          : strategy === 'parallel' ? 200_000
          : strategy === 'pipeline' ? 150_000
          : 100_000
        );

    // 辩论策略：按轮次倍增
    if (strategy === 'debate') {
      const factor = DEBATE_ROUND_FACTORS[rounds] ?? 1.5;
      return Math.floor(scaled * factor);
    }
    return scaled;
  }

  private calculateMemberTimeout(
    strategy: string,
    memberCount: number,
    _rounds: number,
    teamTotalTimeout: number,
  ): number {
    let perMember: number;

    switch (strategy) {
      case 'parallel':
        perMember = Math.floor(teamTotalTimeout * 0.85);
        break;
      case 'hierarchical':
        perMember = Math.floor(teamTotalTimeout / (1 + memberCount * 0.7));
        break;
      case 'debate':
        perMember = Math.floor(teamTotalTimeout / (memberCount * _rounds));
        break;
      case 'sequential':
      case 'pipeline':
      default:
        perMember = Math.floor(teamTotalTimeout / memberCount);
        break;
    }

    return Math.max(perMember, MIN_MEMBER_TIMEOUT_MS);
  }

  // ── 同步执行 ────────────────────────────────────────

  private async executeSync(
    teamConfig: TeamConfig,
    goal: string,
    signal?: AbortSignal,
    cwd?: string,
  ): Promise<ToolResult> {
    try {
      const teamManager = this.createTeamManager(cwd);
      await teamManager.createTeam(teamConfig);
      const result = await teamManager.execute(goal, signal);
      return this.formatResult(result, teamConfig.name, teamConfig.strategy);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return this.error(`Team execution failed: ${errMsg}`);
    }
  }

  // ── 异步执行 ────────────────────────────────────────

  private executeAsync(
    teamConfig: TeamConfig,
    parsed: { teamName: string; goal: string; strategy: TeamStrategy; membersInput: MemberInput[] },
    input: Record<string, unknown>,
  ): ToolResult {
    const manager = TaskOrchestrator.getInstance();
    const memberNames = parsed.membersInput.map(m => ({
      id: m.id,
      name: m.name ?? m.id,
      status: 'pending' as const,
    }));

    // 团队级别的 subAgentId，用于前端 auto-summarize-start 时清理节点
    const teamSubAgentId = `team-exec-${parsed.teamName}-${Date.now()}`;

    const result = manager.startTask({
      type: 'team',
      goal: parsed.goal.slice(0, 120),
      members: memberNames,
      workingDir: input._cwd as string | undefined,
      subAgentId: teamSubAgentId,
      executor: async (abortSignal, onProgress, groupId) => {
        onProgress({ phase: 'setup', currentMember: '创建团队...' });

        const teamManager = this.createTeamManager(input._cwd as string | undefined, teamSubAgentId);
        await teamManager.createTeam(teamConfig);
        const teamId = teamManager.getTeamId();

        onProgress({ phase: 'executing', totalMembers: memberNames.length, completedMembers: 0 });

        // 所有成员初始设为 waiting，由 TeamMemberStart Hook 在实际启动时切换到 running
        for (const m of memberNames) {
          manager.updateMemberStatus(groupId, m.id, 'waiting');
        }

        // 注册 HookRegistry 监听器，实时更新成员状态
        const onMemberStart: HookListener = async (ctx) => {
          if (ctx.teamId === teamId && ctx.data?.memberId) {
            manager.updateMemberStatus(groupId, ctx.data.memberId as string, 'running');
          }
          // 辩论模式：更新轮次信息到 task progress
          if (ctx.data?.currentRound != null) {
            onProgress({ currentRound: ctx.data.currentRound as number, maxRounds: ctx.data.maxRounds as number | undefined });
          }
          return { success: true };
        };

        const onMemberEnd: HookListener = async (ctx) => {
          if (ctx.teamId === teamId && ctx.data?.memberId) {
            const success = ctx.data?.success as boolean | undefined;
            const newStatus = success !== false ? 'completed' : 'failed';
            manager.updateMemberStatus(
              groupId,
              ctx.data.memberId as string,
              newStatus,
              success === false ? {
                failureReason: (ctx.data?.failureReason as string) || (ctx.data?.failureCategory as string) || 'unknown',
                retryCount: ctx.data?.retryCount as number | undefined,
              } : undefined,
            );
          }
          return { success: true };
        };

        if (this.hookRegistry) {
          this.hookRegistry.addListener('TeamMemberStart', onMemberStart);
          this.hookRegistry.addListener('TeamMemberEnd', onMemberEnd);
        } else {
          // 回退：无 HookRegistry 时全部设为 running
          for (const m of memberNames) {
            manager.updateMemberStatus(groupId, m.id, 'running');
          }
        }

        try {
          const execResult = await teamManager.execute(parsed.goal, abortSignal);

          onProgress({ phase: 'synthesizing', completedMembers: memberNames.length });
          for (const mr of execResult.memberResults) {
            manager.updateMemberStatus(
              groupId,
              mr.memberId,
              mr.success ? 'completed' : 'failed',
              mr.success ? undefined : {
                failureReason: mr.failureCategory || mr.error || 'unknown',
                retryCount: mr.retryCount,
              },
            );
          }

          return this.formatResult(execResult, parsed.teamName, parsed.strategy);
        } finally {
          if (this.hookRegistry) {
            this.hookRegistry.removeListener('TeamMemberStart', onMemberStart);
            this.hookRegistry.removeListener('TeamMemberEnd', onMemberEnd);
          }
        }
      },
    });

    if (result.error) {
      return this.error(result.error);
    }

    return this.formatAsyncResponse(result.groupId, parsed);
  }

  private createTeamManager(cwd?: string, teamId?: string): TeamManager {
    return new TeamManager(
      this.mainProvider!,
      this.registry!,
      this.agentConfig!,
      this.hookRegistry,
      null,
      this.currentDepth,
      this.agentRegistry!,
      this.providerManager!,
      cwd,
      teamId,
      this.layeredPromptBuilder ?? undefined,
    );
  }

  // ── 结果格式化 ──────────────────────────────────────

  private formatAsyncResponse(
    groupId: string,
    parsed: { teamName: string; goal: string; strategy: TeamStrategy; membersInput: MemberInput[] },
  ): ToolResult {
    const memberList = parsed.membersInput.map(m => m.name ?? m.id).join(', ');
    return this.success(
      [
        '[Agent Team Started - Running in Background]',
        `Group ID: ${groupId}`,
        `Team: ${parsed.teamName}`,
        `Strategy: ${parsed.strategy}`,
        `Members (${parsed.membersInput.length}): ${memberList}`,
        `Goal: ${parsed.goal.slice(0, 150)}`,
        '',
        '⛔ Your turn ends NOW. Do NOT continue executing. Stop immediately.',
        '',
        'The system will notify you when the team completes. Until then, DO NOT query task status. End your response right now.',
        '',
        'IMPORTANT: Async task output is not visible to the user. The system will inject results into your context.',
        'When notified, you MUST report the results to the user verbally. Never say "the results are shown above."',
        '',
        '---',
        'Commands available after notification:',
        `- Check progress: task_control({ action: "status", groupId: "${groupId}" })`,
        `- Cancel: task_control({ action: "cancel", groupId: "${groupId}" })`,
        `- List all: task_control({ action: "list" })`,
      ].join('\n'),
      {
        taskAsync: true,
        groupId,
        teamName: parsed.teamName,
        strategy: parsed.strategy,
        memberCount: parsed.membersInput.length,
      },
    );
  }

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
        const name = r.memberName || r.memberId;
        let line = `${status} ${name}: ${duration}s, ${r.tokensUsed.input + r.tokensUsed.output} tokens`;
        if (r.retryCount && r.retryCount > 0) {
          line += r.success
            ? ` (succeeded after ${r.retryCount} retries)`
            : ` (failed after ${r.retryCount} retries)`;
        }
        if (!r.success && r.failureCategory) {
          line += ` — Failure: ${r.failureCategory}`;
        }
        return line;
      })
      .join('\n');

    const retryAdvice = this.buildRetryAdvice(result);
    const content = [
      meta,
      '',
      '[Member Execution Summary]',
      memberSummary,
      '',
      '[Team Output]',
      result.output,
      '',
      '---',
      retryAdvice,
      '⚠️ When reporting team results to the user, every key finding from each member MUST include a clickable citation. Citation format (write inline, NOT inside code blocks or blockquotes):',
      '📎 [member name]: "Copy a sentence verbatim from that member\'s output"',
      '',
      'The citation name must exactly match the member name shown in the summary above, otherwise the user cannot click to view the full output.',
    ].join('\n');

    const citations = result.memberResults.map(r => ({
      agentName: r.memberName || r.memberId,
      originalOutput: r.result,
      duration: r.duration,
      tokensUsed: r.tokensUsed,
    }));

    const resultMeta = {
      teamExecution: true,
      teamName,
      strategy,
      duration: result.duration,
      totalTokens: result.totalTokens,
      rounds: result.rounds,
      memberCount: result.memberResults.length,
      success: result.success,
      timedOut: result.timedOut,
      citations,
    };

    if (result.success) {
      return this.success(content, resultMeta);
    }
    return this.error(content, resultMeta);
  }

  private buildRetryAdvice(result: import('@/core/agent/team/types').TeamExecutionResult): string {
    if (result.timedOut) {
      const successCount = result.memberResults.filter(r => r.success).length;
      const lines = [
        '⏱️ Team execution timed out. Suggested retry strategy:',
        '  1. Preferred: call agent_team again with a larger timeout (recommend at least double)',
        `     - Current duration: ${Math.floor((result.duration || 0) / 1000)}s`,
        `     - Suggested timeout: ${Math.floor((result.duration || 60_000) / 1000) * 2 * 1000} or larger`,
      ];
      if (successCount > 0) {
        lines.push(`     - ${successCount}/${result.memberResults.length} members completed successfully. Results saved to checkpoint — recoverable on retry.`);
      }
      lines.push('  2. Fallback: if timeout was caused by a specific stage, use task tool to retry that stage individually');
      return lines.join('\n');
    }

    if (!result.success) {
      const failedMembers = result.memberResults.filter(r => !r.success);
      const categories = new Set(failedMembers.map(r => r.failureCategory).filter(Boolean));
      const failedIds = failedMembers.map(r => r.memberName || r.memberId).join(', ');

      if (categories.has('stage_disconnect') || categories.has('output_truncated')) {
        return [
          '⚠️ Team execution failed (stage disconnect / output truncated). Suggested retry strategy:',
          '  1. Preferred: use task tool to re-execute failed stages individually',
          `     - Failed members: ${failedIds}`,
          '     - Provide clearer task descriptions with complete file paths',
          '     - Re-run full pipeline after individual stages succeed',
          '  2. Fallback: call agent_team again with increased per-member timeout',
        ].join('\n');
      }

      return [
        '⚠️ Team execution failed. Suggested retry strategy:',
        '  1. Preferred: call agent_team again after adjusting member config or task descriptions',
        '  2. Fallback: if only individual members failed with clear reasons, use task tool to retry those specific tasks',
        `     - Failed members: ${failedIds}`,
      ].join('\n');
    }

    return '';
  }
}
