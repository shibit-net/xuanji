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
    '创建 AI agent 团队协作完成复杂任务。',
    '',
    '使用流程：',
    '1. 为每个不同领域调用 match_agent 查找合适的 agent',
    '2. 分数 >= 0.5 使用返回的 agent ID，分数 < 0.5 创建临时 agent（需提供 system_prompt）',
    '3. 同领域多视角：使用同一 agent ID + 不同 scene/system_prompt',
    '',
    '异常处理：',
    '- 超时：重试并增大 timeout 参数',
    '- 失败：调整成员配置或任务描述后重试，不要用 task 逐个替代',
    '',
    '策略选择：parallel(独立并行) | sequential(依赖串行) | hierarchical(leader协调) | debate(辩论共识) | pipeline(数据流)',
    '',
    '快速推荐：',
    '- 架构设计+分工实现 → hierarchical',
    '- 独立功能并行开发/代码审查 → parallel',
    '- 有明确依赖链/构建部署 → sequential',
    '- 方案评审/技术决策 → debate',
    '- 数据ETL/处理管道 → pipeline（大数据量建议改用 sequential）',
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
            id: {
              type: 'string',
              description: '成员唯一标识，使用短小的角色名（如 "quality"、"security"）',
            },
            agent_id: {
              type: 'string',
              description: [
                '必须来自 match_agent 的结果。不能自行编造。',
                '- 分数 >= 0.5：直接使用 match_agent 返回的 agent ID',
                '- 分数 < 0.5：使用自定义 ID 并必须提供 system_prompt（创建临时 agent）',
                '- 同领域多视角：使用同一 agent ID + 不同 scene/system_prompt',
              ].join('\n'),
            },
            name: {
              type: 'string',
              description: '成员显示名（可选），如 "Security Reviewer"',
            },
            capabilities: {
              type: 'array',
              items: { type: 'string' },
              description: '成员能力列表（可选），省略则从 agent 配置推断',
            },
            priority: {
              type: 'number',
              description: '优先级（hierarchical 策略需要，leader 设 >= 8）',
            },
            task: {
              type: 'string',
              description: '成员的具体工作任务（WHAT to do）。区别于 system_prompt（HOW to behave）。每个成员必须有独特、可执行的任务',
            },
            scene: {
              type: 'string',
              description: '场景类型，决定加载哪组 L1 prompt。**必须为每个成员指定**。通过 list_scenes 查询可用场景后选择合适的分配，无合适场景时使用 "general"',
            },
            system_prompt: {
              type: 'string',
              description: '角色行为引导（HOW to behave）。临时 agent 必需，预置 agent 可选（覆盖默认配置）。辩论策略必须包含元数据标记：[debate_role:affirmative]（正方）或 [debate_role:negative]（反方）或 [debate_role:judge]（裁判），放在 system_prompt 末尾便于解析',
            },
            tools: {
              type: 'array',
              items: { type: 'string' },
              description: '成员可用工具列表（可选），覆盖预置 agent 的默认工具',
            },
            timeout: {
              type: 'number',
              description: '成员超时（毫秒）。不推荐设置，系统会根据策略自动分配合理的超时时间',
            },
          },
          required: ['id'],
        },
      },
      max_rounds: {
        type: 'number',
        description: '最大协作轮次（默认 5）',
      },
      timeout: {
        type: 'number',
        description: [
          '团队总超时（毫秒），硬限制。不设置时自动计算：成员数 × 轮次 × 600000ms（最少30分钟，最多4小时）。',
          '建议值：代码审查 30-60分钟、辩论共识 1.5小时+、大型重构 2-3小时。',
          '超时后可用更大的 timeout 值重试。',
        ].join(' '),
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
      task?: string;          // 🆕 成员具体任务（WHAT to do）
      capabilities?: string[];
      priority?: number;
      scene?: string;         // 🆕 场景类型
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
      agentId: m.agent_id || m.role || '', // 优先使用 agent_id，向后兼容 role
      name: m.name,
      task: m.task,             // 🆕 成员具体任务
      capabilities: m.capabilities ?? [],
      priority: m.priority,
      scene: m.scene,           // 🆕 场景类型
      systemPrompt: m.system_prompt,
      tools: m.tools,
      timeout: m.timeout,
    }));

    // 🆕 计算超时配置 — 基于审计数据的优化公式
    const rounds = maxRounds ?? 3; // 默认 3 轮（超过 3 轮 Token 爆炸）

    // 策略基础超时（ms）
    const baseTimeouts: Record<string, number> = {
      debate:       1_800_000, // 30min（含多轮辩论）
      hierarchical: 600_000 + 300_000 * Math.max(0, members.length - 1), // leader + workers
      parallel:     600_000 + 200_000 * Math.max(0, members.length - 1),
      sequential:   300_000 + 100_000 * Math.max(0, members.length - 1),
      pipeline:     300_000 + 150_000 * Math.max(0, members.length - 1),
    };

    const baseTimeout = baseTimeouts[strategy] ?? 600_000;

    // 辩论轮次因子
    const roundFactors: Record<number, number> = { 2: 1.0, 3: 1.5, 4: 2.0, 5: 3.0 };
    const roundFactor = strategy === 'debate' ? (roundFactors[rounds] ?? 1.5) : 1.0;

    const teamTotalTimeout = timeout ?? Math.floor(baseTimeout * roundFactor);
    let defaultMemberTimeout: number;

    // 根据策略分配成员基准超时
    switch (strategy) {
      case 'parallel':
        defaultMemberTimeout = Math.floor(teamTotalTimeout * 0.85);
        break;
      case 'sequential':
        defaultMemberTimeout = Math.floor(teamTotalTimeout / members.length);
        break;
      case 'hierarchical':
        defaultMemberTimeout = Math.floor(teamTotalTimeout / (1 + members.length * 0.7));
        break;
      case 'debate':
        defaultMemberTimeout = Math.floor(teamTotalTimeout / (members.length * rounds));
        break;
      case 'pipeline':
        defaultMemberTimeout = Math.floor(teamTotalTimeout / members.length);
        break;
      default:
        defaultMemberTimeout = Math.floor(teamTotalTimeout / members.length);
    }

    // 每成员最低 2 分钟保障
    defaultMemberTimeout = Math.max(defaultMemberTimeout, 120_000);

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
        input._cwd as string | undefined,
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
        const name = r.memberName || r.memberId;
        return `${status} ${name}: ${duration}s, ${r.tokensUsed.input + r.tokensUsed.output} tokens`;
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
      '',
      '---',
      (() => {
        if (result.timedOut) {
          const successCount = result.memberResults.filter(r => r.success).length;
          const checkpointInfo = successCount > 0
            ? [`     - ${successCount}/${result.memberResults.length} 位成员成功完成，结果已保存至 checkpoint，重试时可恢复`]
            : [];
          return [
            '⏱️ 团队执行超时。建议重试策略：',
            '  1. 优先：再次调用 agent_team 并增大 timeout 参数（建议至少翻倍）',
            `     - 当前耗时: ${Math.floor((result.duration || 0) / 1000)}s`,
            `     - 建议设置 timeout: ${Math.floor((result.duration || 60_000) / 1000) * 2 * 1000} 或更大`,
            ...checkpointInfo,
            '  2. 备选：如果超时由某个特定阶段导致，可用 task 工具单独重试该阶段，然后将结果传回 agent_team',
            '',
          ].join('\n');
        }
        if (!result.success) {
          // Bug 5: 根据失败分类提供不同的重试建议
          const failedMembers = result.memberResults.filter(r => !r.success);
          const categories = new Set(failedMembers.map(r => r.failureCategory).filter(Boolean));

          if (categories.has('stage_disconnect') || categories.has('output_truncated')) {
            const failedIds = failedMembers.map(r => r.memberName || r.memberId).join(', ');
            return [
              '⚠️ 团队执行失败（阶段衔接/输出截断）。建议重试策略：',
              '  1. 优先：用 task 工具单独重新执行失败的阶段',
              `     - 失败成员: ${failedIds}`,
              '     - 提供更明确的任务描述和完整的文件路径',
              '     - 单阶段成功后再考虑重新运行完整 pipeline',
              '  2. 备选：再次调用 agent_team，但增加各成员的 timeout',
              '',
            ].join('\n');
          }

          return [
            '⚠️ 团队执行失败。建议重试策略：',
            '  1. 优先：再次调用 agent_team，调整成员配置或任务描述后重试',
            '  2. 备选：如果仅个别成员失败且问题明确（如输出截断），可用 task 工具单独重试该成员的任务',
            `     - 失败成员: ${failedMembers.map(r => r.memberName || r.memberId).join(', ')}`,
            '',
          ].join('\n');
        }
        return '';
      })(),
      '⚠️ 当你向用户总结团队执行结果时，必须为每位成员的关键发现附带可点击引用。引用格式（直接写在正文中，不要放在代码块或引用块里）：',
      '📎 [成员名称]："从该成员输出中逐字复制一句原话"',
      '',
      '引用名称必须与上方成员摘要中显示的名称完全一致，否则用户无法点击查看完整输出。',
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
