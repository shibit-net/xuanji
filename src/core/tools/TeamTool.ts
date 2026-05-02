/**
 * TeamTool — 团队协作工具
 *
 * 创建多 agent 团队协作完成任务。支持 5 种协作策略。
 * 第 0 层（主 agent）自动异步执行，第 1+ 层自动同步。
 * agent_team 成员是执行单元，不能再次创建子 agent 或子 team。
 */

import type { JSONSchema, ToolResult, AgentConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import { BaseTool } from './BaseTool';
import { TeamManager } from '@/core/agent/team/TeamManager';
import type { TeamConfig, TeamMember, TeamStrategy } from '@/core/agent/team/types';
import type { AgentRoleType } from '@/core/agent/SubAgentContext';
import { AsyncAgentTaskManager } from '@/core/agent/async';
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
    'Every member needs a unique, specific task. Do NOT give all members the same goal.',
    '',
    'Example — parallel:',
    '  agent_team({',
    '    team_name: "code-review",',
    '    goal: "Review codebase from quality, security, and performance.",',
    '    strategy: "parallel",',
    '    members: [',
    '      { id: "quality", agent_id: "explore", task: "Check code quality, smells, maintainability" },',
    '      { id: "security", agent_id: "explore", task: "Find security vulnerabilities", scene: "review" },',
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
        description: '团队总目标。子 agent 无法访问父对话历史，必须包含所有必要的上下文：文件路径、约束条件、输出格式',
      },
      strategy: {
        type: 'string',
        enum: ['sequential', 'parallel', 'hierarchical', 'debate', 'pipeline'],
        description: 'Collaboration strategy. Choose based on task structure.',
      },
      members: {
        type: 'array',
        description: '团队成员数组。每个成员是执行具体子任务的工作 agent，需有明确分工',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '成员唯一标识，使用短小的角色名（如 "quality"、"security"）' },
            agent_id: {
              type: 'string',
              description: [
                '必须来自 match_agent 的结果。不能自行编造。',
                '- 分数 >= 0.5：直接使用 match_agent 返回的 agent ID',
                '- 分数 < 0.5：使用自定义 ID 并必须提供 system_prompt（创建临时 agent）',
                '- 同领域多视角：使用同一 agent ID + 不同 scene/system_prompt',
              ].join('\n'),
            },
            name: { type: 'string', description: '成员显示名（可选），如 "Security Reviewer"' },
            capabilities: { type: 'array', items: { type: 'string' }, description: '成员能力列表（可选）' },
            priority: { type: 'number', description: '优先级（hierarchical 策略需要，leader 设 >= 8）' },
            task: { type: 'string', description: '成员的具体工作任务（WHAT to do）。每个成员必须有独特、可执行的任务' },
            scene: {
              type: 'string',
              description: [
                '场景类型，决定子 agent 加载哪组 L1 prompt。',
                '**必须通过 list_scenes 查询后选择合适的 scene ID 填入**。',
                '不要自行编造 scene ID。',
                '如无合适场景可用 "general"。',
              ].join('\n'),
            },
            system_prompt: {
              type: 'string',
              description: '角色行为引导（HOW to behave）。临时 agent 必需，预置 agent 可选。辩论策略需包含 [debate_role:affirmative|negative|judge] 标记',
            },
            tools: { type: 'array', items: { type: 'string' }, description: '成员可用工具列表（可选）' },
            timeout: { type: 'number', description: '成员超时（毫秒）。不推荐设置，系统会自动分配' },
          },
          required: ['id'],
        },
      },
      max_rounds: { type: 'number', description: '最大协作轮次（默认 5）' },
      timeout: {
        type: 'number',
        description: [
          '团队总超时（毫秒），硬限制。不设置时自动计算。',
          '建议值：代码审查 30-60分钟、辩论共识 1.5小时+、大型重构 2-3小时。',
        ].join(' '),
      },
      async: {
        type: 'boolean',
        description: '异步执行模式。主 agent 自动异步，子 agent 自动同步。一般无需设置此参数。',
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

  // ── 主入口 ──────────────────────────────────────────

  async execute(input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    // 1. 依赖检查
    const depsErr = this.checkDependencies();
    if (depsErr) return depsErr;

    // 2. 嵌套检查
    if (TeamContext.get()) {
      return this.error('agent_team 不能在另一个 agent_team 内部使用。请直接在团队中完成工作，或让主 agent 再创建一个独立的 agent_team。');
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
    return this.executeSync(teamConfig, parsed.goal, signal);
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
  ): Promise<ToolResult> {
    try {
      const teamManager = this.createTeamManager();
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
    const manager = AsyncAgentTaskManager.getInstance();
    const memberNames = parsed.membersInput.map(m => ({
      id: m.id,
      name: m.name ?? m.id,
      status: 'pending' as const,
    }));

    const result = manager.startTask({
      type: 'team',
      goal: parsed.goal.slice(0, 120),
      members: memberNames,
      workingDir: input._cwd as string | undefined,
      executor: async (abortSignal, onProgress, groupId) => {
        onProgress({ phase: 'setup', currentMember: '创建团队...' });

        const teamManager = this.createTeamManager();
        await teamManager.createTeam(teamConfig);

        onProgress({ phase: 'executing', totalMembers: memberNames.length, completedMembers: 0 });
        for (const m of memberNames) {
          manager.updateMemberStatus(groupId, m.id, 'running');
        }

        const execResult = await teamManager.execute(parsed.goal, abortSignal);

        onProgress({ phase: 'synthesizing', completedMembers: memberNames.length });
        for (const mr of execResult.memberResults) {
          manager.updateMemberStatus(groupId, mr.memberId, mr.success ? 'completed' : 'failed');
        }

        return this.formatResult(execResult, parsed.teamName, parsed.strategy);
      },
    });

    if (result.error) {
      return this.error(result.error);
    }

    return this.formatAsyncResponse(result.groupId, parsed);
  }

  private createTeamManager(): TeamManager {
    return new TeamManager(
      this.mainProvider!,
      this.registry!,
      this.agentConfig!,
      this.hookRegistry,
      null,
      this.currentDepth,
      this.agentRegistry!,
      this.providerManager!,
      undefined,
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
        '[Agent Team 已启动 - 后台运行]',
        `任务组 ID: ${groupId}`,
        `团队: ${parsed.teamName}`,
        `策略: ${parsed.strategy}`,
        `成员 (${parsed.membersInput.length}): ${memberList}`,
        `目标: ${parsed.goal.slice(0, 150)}`,
        '',
        '---',
        '用户可以：',
        `- 查询进度: 使用 task_control({ action: "status", groupId: "${groupId}" })`,
        `- 取消任务: 使用 task_control({ action: "cancel", groupId: "${groupId}" })`,
        `- 查看所有后台任务: 使用 task_control({ action: "list" })`,
        '完成后系统会通知你汇总结果。',
      ].join('\n'),
      {
        teamAsync: true,
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
        return `${status} ${name}: ${duration}s, ${r.tokensUsed.input + r.tokensUsed.output} tokens`;
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
      '⚠️ 当你向用户总结团队执行结果时，必须为每位成员的关键发现附带可点击引用。引用格式（直接写在正文中，不要放在代码块或引用块里）：',
      '📎 [成员名称]："从该成员输出中逐字复制一句原话"',
      '',
      '引用名称必须与上方成员摘要中显示的名称完全一致，否则用户无法点击查看完整输出。',
    ].join('\n');

    const citations = result.memberResults.map(r => ({
      agentName: r.memberName || r.memberId,
      originalOutput: r.result,
      duration: r.duration,
      tokensUsed: r.tokensUsed,
    }));

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
      citations,
    });
  }

  private buildRetryAdvice(result: import('@/core/agent/team/types').TeamExecutionResult): string {
    if (result.timedOut) {
      const successCount = result.memberResults.filter(r => r.success).length;
      const lines = [
        '⏱️ 团队执行超时。建议重试策略：',
        '  1. 优先：再次调用 agent_team 并增大 timeout 参数（建议至少翻倍）',
        `     - 当前耗时: ${Math.floor((result.duration || 0) / 1000)}s`,
        `     - 建议设置 timeout: ${Math.floor((result.duration || 60_000) / 1000) * 2 * 1000} 或更大`,
      ];
      if (successCount > 0) {
        lines.push(`     - ${successCount}/${result.memberResults.length} 位成员成功完成，结果已保存至 checkpoint，重试时可恢复`);
      }
      lines.push('  2. 备选：如果超时由某个特定阶段导致，可用 task 工具单独重试该阶段');
      return lines.join('\n');
    }

    if (!result.success) {
      const failedMembers = result.memberResults.filter(r => !r.success);
      const categories = new Set(failedMembers.map(r => r.failureCategory).filter(Boolean));
      const failedIds = failedMembers.map(r => r.memberName || r.memberId).join(', ');

      if (categories.has('stage_disconnect') || categories.has('output_truncated')) {
        return [
          '⚠️ 团队执行失败（阶段衔接/输出截断）。建议重试策略：',
          '  1. 优先：用 task 工具单独重新执行失败的阶段',
          `     - 失败成员: ${failedIds}`,
          '     - 提供更明确的任务描述和完整的文件路径',
          '     - 单阶段成功后再考虑重新运行完整 pipeline',
          '  2. 备选：再次调用 agent_team，但增加各成员的 timeout',
        ].join('\n');
      }

      return [
        '⚠️ 团队执行失败。建议重试策略：',
        '  1. 优先：再次调用 agent_team，调整成员配置或任务描述后重试',
        '  2. 备选：如果仅个别成员失败且问题明确，可用 task 工具单独重试该成员的任务',
        `     - 失败成员: ${failedIds}`,
      ].join('\n');
    }

    return '';
  }
}
