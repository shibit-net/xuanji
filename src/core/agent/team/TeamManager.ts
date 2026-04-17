/**
 * TeamManager — 团队管理器
 *
 * 核心职责：
 * 1. 管理团队成员生命周期
 * 2. 根据策略分配任务
 * 3. 路由成员间消息
 * 4. 聚合执行结果
 */

import type {
  TeamConfig,
  TeamContext,
  TeamMember,
  TeamMessage,
  TeamMessageType,
  TaskAssignment,
  TaskExecutionResult,
  TeamExecutionResult,
  ITeamManager,
  TeamStrategy,
} from './types';
import type { ILLMProvider, IToolRegistry, AgentConfig } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import type { AgentRegistry } from '../AgentRegistry';
import type { ProviderManager } from '@/core/providers/ProviderManager';
import { DEFAULT_TEAM_CONFIG } from './types';
import type { SubAgentResult } from '../SubAgentLoop';
import { SubAgentFactory } from '../SubAgentFactory';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'TeamManager' });

/**
 * 团队管理器实现
 */
export class TeamManager implements ITeamManager {
  private context: TeamContext | null = null;
  private mainProvider: ILLMProvider;
  private registry: IToolRegistry;
  private agentConfig: AgentConfig;
  private hookRegistry: HookRegistry | null;
  private memoryStore: IMemoryStore | null;
  private running = false;
  private taskQueue: TaskAssignment[] = [];
  private completedTasks: Map<string, TaskExecutionResult> = new Map();
  private depth: number;
  private subAgentFactory: SubAgentFactory;
  private teamId: string; // 团队唯一标识，在构造时生成
  private agentRegistry: AgentRegistry; // 保存 agentRegistry 引用

  constructor(
    mainProvider: ILLMProvider,
    registry: IToolRegistry,
    agentConfig: AgentConfig,
    hookRegistry?: HookRegistry | null,
    memoryStore?: IMemoryStore | null,
    depth = 0,
    agentRegistry?: AgentRegistry,
    providerManager?: ProviderManager,
  ) {
    this.mainProvider = mainProvider;
    this.registry = registry;
    this.agentConfig = agentConfig;
    this.hookRegistry = hookRegistry ?? null;
    this.memoryStore = memoryStore ?? null;
    this.depth = depth;
    this.teamId = `team-${Date.now()}`; // 在构造时生成唯一 ID

    if (!agentRegistry || !providerManager) {
      throw new Error('TeamManager requires agentRegistry and providerManager');
    }

    this.agentRegistry = agentRegistry; // 保存引用

    this.subAgentFactory = new SubAgentFactory(
      agentRegistry,
      providerManager,
      registry,
      hookRegistry,
      memoryStore,
      mainProvider,  // 传递父 provider
      agentConfig,  // 🔧 传递父 agent 的完整配置（包含 provider 信息）
    );
  }

  /**
   * 标准化 Agent ID（精确匹配）
   *
   * 策略：
   * 1. 精确匹配：检查是否是已注册的 agent（内置/用户/项目）
   * 2. 未匹配：创建临时 agent，并输出警告
   *
   * 不再进行模糊匹配和别名映射，强制 LLM 使用精确的 agent ID。
   * 这样可以避免错误的自动映射（如 "分析师" 被映射到 "explore"）。
   */
  private normalizeAgentId(agentId: string, memberId: string): string {
    // 1. 精确匹配：检查是否是已注册的 agent（内置/用户/项目）
    const registeredAgent = this.agentRegistry.get(agentId);
    if (registeredAgent) {
      const agentType = registeredAgent.metadata?.builtin ? 'preset' : 'custom';
      log.info(`[${memberId}] Using ${agentType} agent: ${agentId}`);
      return agentId;
    }

    // 2. 未匹配：将创建临时 agent
    log.warn(
      `[${memberId}] Agent ID "${agentId}" not found in registry. ` +
      `Will create temporary agent. ` +
      `Tip: Use match_agent tool to find suitable preset agents (coder, explore, test-writer, etc.)`
    );
    return agentId;
  }

  /**
   * 创建团队
   */
  async createTeam(config: TeamConfig): Promise<void> {
    // 验证团队配置
    this.validateTeamConfig(config);

    // 初始化上下文
    this.context = {
      config: {
        ...config,
        maxRounds: config.maxRounds ?? DEFAULT_TEAM_CONFIG.maxRounds,
        defaultMemberTimeout: config.defaultMemberTimeout ?? DEFAULT_TEAM_CONFIG.defaultMemberTimeout,
        enableSharedKnowledge: config.enableSharedKnowledge ?? DEFAULT_TEAM_CONFIG.enableSharedKnowledge,
        recordHistory: config.recordHistory ?? DEFAULT_TEAM_CONFIG.recordHistory,
      },
      sharedKnowledge: new Map(),
      messageHistory: [],
      memberStates: new Map(),
      currentRound: 0,
      startTime: Date.now(),
    };

    log.info(`Team "${config.name}" created with ${config.members.length} members, strategy: ${config.strategy}`);
  }

  /**
   * 获取团队 ID
   */
  getTeamId(): string {
    return this.teamId;
  }

  /**
   * 执行团队任务
   */
  async execute(goal: string, externalSignal?: AbortSignal): Promise<TeamExecutionResult> {
    if (!this.context) {
      throw new Error('Team not created. Call createTeam() first.');
    }

    if (this.running) {
      throw new Error('Team is already executing a task.');
    }

    this.running = true;
    const startTime = Date.now();
    const memberResults: TaskExecutionResult[] = [];
    let timedOut = false;

    // 🆕 团队级超时控制 - 根据策略和轮次动态计算
    const teamTimeout = this.calculateTeamTimeout();
    const teamAbortController = new AbortController();
    const teamTimer = setTimeout(() => {
      teamAbortController.abort();
      timedOut = true;
      log.warn(`Team "${this.context!.config.name}" exceeded total timeout ${teamTimeout}ms`);
    }, teamTimeout);

    // 🔧 监听外部 signal（来自 AgentLoop.stop()）
    const onExternalAbort = () => {
      teamAbortController.abort();
      log.warn(`Team "${this.context!.config.name}" aborted by external signal`);
    };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    // 触发 TeamStart Hook
    if (this.hookRegistry) {
      // 🔧 验证 members 必须是数组
      if (!Array.isArray(this.context.config.members)) {
        throw new Error(
          `TeamManager: config.members must be an array, got ${typeof this.context.config.members}. ` +
          `Please ensure the 'members' parameter in agent_team tool is an array of member objects.`
        );
      }

      this.hookRegistry.emit('TeamStart', {
        teamId: this.teamId,
        data: {
          name: this.context.config.name,
          goal,
          strategy: this.context.config.strategy,
          memberCount: this.context.config.members.length,
          // 添加完整的成员列表（用于 UI 预先显示团队结构）
          members: this.context.config.members.map((member, index) => ({
            id: member.id,
            name: member.name || member.id,
            role: member.agentId, // 使用 agentId
            capabilities: member.capabilities,
            stepIndex: index,
          })),
        },
      }).catch((err) => {
        log.debug('TeamStart hook emit failed:', err);
      });
    }

    try {
      log.info(`Team "${this.context.config.name}" executing goal: ${goal}`);

      // 输出超时分配方案
      this.logTimeoutAllocation();

      // 检查是否已经超时
      if (teamAbortController.signal.aborted) {
        throw new Error('Team timeout before execution started');
      }

      // 执行策略
      const strategyPromise = (): Promise<TaskExecutionResult[]> => {
        switch (this.context!.config.strategy) {
          case 'sequential':
            return this.executeSequential(goal, teamAbortController.signal);
          case 'parallel':
            return this.executeParallel(goal, teamAbortController.signal);
          case 'hierarchical':
            return this.executeHierarchical(goal, teamAbortController.signal);
          case 'debate':
            return this.executeDebate(goal, teamAbortController.signal);
          case 'pipeline':
            return this.executePipeline(goal, teamAbortController.signal);
          default:
            return Promise.reject(new Error(`Unknown team strategy: ${this.context!.config.strategy}`));
        }
      };

      const results = await strategyPromise();
      memberResults.push(...results);

      // 聚合结果
      const output = this.aggregateResults(memberResults);
      const duration = Date.now() - startTime;
      const totalTokens = memberResults.reduce(
        (acc, r) => ({
          input: acc.input + r.tokensUsed.input,
          output: acc.output + r.tokensUsed.output,
        }),
        { input: 0, output: 0 },
      );

      const result: TeamExecutionResult = {
        goal,
        output,
        memberResults,
        duration,
        totalTokens,
        rounds: this.context.currentRound,
        success: memberResults.every(r => r.success),
        timedOut,
      };

      // 触发 TeamEnd Hook
      if (this.hookRegistry) {
        this.hookRegistry.emit('TeamEnd', {
          teamId: this.teamId,
          data: {
            name: this.context.config.name,
            goal,
            duration,
            success: result.success,
            timedOut,
          },
        }).catch((err) => {
          log.debug('TeamEnd hook emit failed:', err);
        });
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errMsg = error instanceof Error ? error.message : String(error);

      if (errMsg.includes('timeout') || errMsg.includes('timed out') || teamAbortController.signal.aborted) {
        timedOut = true;
      }

      // 触发 TeamEnd Hook（失败情况）
      if (this.hookRegistry) {
        this.hookRegistry.emit('TeamEnd', {
          teamId: this.teamId,
          data: {
            name: this.context!.config.name,
            goal,
            duration,
            success: false,
            timedOut,
            error: errMsg,
          },
        }).catch((err) => {
          log.debug('TeamEnd hook emit failed:', err);
        });
      }

      return {
        goal,
        output: `Team execution failed: ${errMsg}`,
        memberResults,
        duration,
        totalTokens: { input: 0, output: 0 },
        rounds: this.context!.currentRound,
        success: false,
        timedOut,
      };
    } finally {
      clearTimeout(teamTimer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
      this.running = false;
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(message: TeamMessage): Promise<void> {
    if (!this.context) {
      throw new Error('Team not created.');
    }

    if (this.context.config.recordHistory) {
      this.context.messageHistory.push(message);
    }

    log.debug(`Message: ${message.from} -> ${message.to} [${message.type}]: ${message.content.substring(0, 100)}`);
  }

  /**
   * 获取团队上下文
   */
  getContext(): TeamContext {
    if (!this.context) {
      throw new Error('Team not created.');
    }
    return this.context;
  }

  /**
   * 停止执行
   */
  stop(): void {
    this.running = false;
    log.info('Team execution stopped');
  }

  // ─── 私有方法 ─────────────────────────────────────────

  /**
   * 验证团队配置
   */
  private validateTeamConfig(config: TeamConfig): void {
    if (!config.name || config.name.trim() === '') {
      throw new Error('Team name is required');
    }

    if (!config.members || config.members.length === 0) {
      throw new Error('Team must have at least one member');
    }

    // 检查成员 ID 唯一性
    const ids = new Set<string>();
    for (const member of config.members) {
      if (ids.has(member.id)) {
        throw new Error(`Duplicate member ID: ${member.id}`);
      }
      ids.add(member.id);
    }

    // 🔧 检查 system_prompt 唯一性（防止所有成员做相同任务）
    if (config.members.length > 1) {
      const systemPrompts = config.members
        .map(m => m.systemPrompt?.trim().toLowerCase())
        .filter(p => p && p.length > 0);

      const uniquePrompts = new Set(systemPrompts);

      // 如果有重复的 system_prompt，给出详细错误提示
      if (uniquePrompts.size < systemPrompts.length) {
        const duplicates: string[] = [];
        const seen = new Set<string>();

        for (const prompt of systemPrompts) {
          if (prompt && seen.has(prompt)) {
            duplicates.push(prompt.slice(0, 50) + '...');
          }
          if (prompt) {
            seen.add(prompt);
          }
        }

        throw new Error(
          `❌ Task decomposition failed: Multiple members have identical system_prompt.\n\n` +
          `Each team member MUST have a UNIQUE, SPECIFIC responsibility.\n\n` +
          `Duplicate prompt detected: "${duplicates[0] || 'unknown'}"\n\n` +
          `Please follow these patterns:\n` +
          `- Pattern 1 (Parallel): Each member analyzes SAME input from DIFFERENT perspective\n` +
          `  Example: member1="Focus on code quality", member2="Focus on security", member3="Focus on performance"\n\n` +
          `- Pattern 2 (Sequential): Each member processes output of PREVIOUS member\n` +
          `  Example: member1="Extract logs", member2="Clean and group", member3="Analyze patterns"\n\n` +
          `- Pattern 3 (Hierarchical): Leader decomposes, workers execute SUB-TASKS\n` +
          `  Example: leader="Break down into 3 sub-tasks", worker1="Implement backend", worker2="Implement frontend"\n\n` +
          `See l2-team-coordination prompt for detailed examples.`
        );
      }

      // 如果所有成员的 system_prompt 都为空或过短，也给出警告
      if (uniquePrompts.size === 0 || systemPrompts.every(p => !p || p.length < 20)) {
        log.warn(
          `⚠️ Warning: Team members have no or very short system_prompt. ` +
          `This may result in all members doing the same task. ` +
          `Consider adding specific system_prompt for each member.`
        );
      }
    }

    // 检查策略特定要求
    if (config.strategy === 'hierarchical') {
      const leaders = config.members.filter(m => m.priority && m.priority > 0);
      if (leaders.length === 0) {
        throw new Error('Hierarchical strategy requires at least one member with priority > 0');
      }
    }
  }

  /**
   * 串行执行策略
   */
  private async executeSequential(goal: string, signal?: AbortSignal): Promise<TaskExecutionResult[]> {
    const results: TaskExecutionResult[] = [];
    const members = this.getSortedMembers();

    for (let i = 0; i < members.length; i++) {
      if (!this.running || signal?.aborted) break;
      const member = members[i];

      const result = await this.executeMemberTask(member, goal, results, undefined, i, signal);
      results.push(result);

      if (!result.success) {
        log.warn(`Member ${member.id} failed, stopping sequential execution`);
        break;
      }
    }

    return results;
  }

  /**
   * 并行执行策略（最多 3 个子代理并发）
   */
  private async executeParallel(goal: string, signal?: AbortSignal): Promise<TaskExecutionResult[]> {
    const members = this.context!.config.members;
    const MAX_CONCURRENT = 3;

    if (members.length <= MAX_CONCURRENT) {
      // 成员数不超过并发上限，直接全部并行
      return Promise.all(members.map((member, index) => this.executeMemberTask(member, goal, [], undefined, index, signal)));
    }

    // 分批并行，每批最多 MAX_CONCURRENT 个，避免资源耗尽
    const results: TaskExecutionResult[] = [];
    for (let i = 0; i < members.length; i += MAX_CONCURRENT) {
      if (!this.running || signal?.aborted) break;
      const batch = members.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.all(
        batch.map((member, batchIndex) => this.executeMemberTask(member, goal, [], undefined, i + batchIndex, signal))
      );
      results.push(...batchResults);
    }
    return results;
  }

  /**
   * 层级执行策略
   */
  private async executeHierarchical(goal: string, signal?: AbortSignal): Promise<TaskExecutionResult[]> {
    const results: TaskExecutionResult[] = [];
    const members = this.getSortedMembers();

    // 主 agent（优先级最高）
    const leader = members[0];
    const leaderResult = await this.executeMemberTask(leader, goal, [], undefined, 0, signal);
    results.push(leaderResult);

    if (!leaderResult.success || signal?.aborted) {
      return results;
    }

    // 根据主 agent 的输出，分配给其他成员
    const workers = members.slice(1);
    const workerPromises = workers.map((worker, workerIndex) =>
      this.executeMemberTask(
        worker,
        `Based on the leader's analysis:\n${leaderResult.result}\n\nYour task: ${goal}`,
        results,
        undefined,
        workerIndex + 1, // Workers 从索引 1 开始
        signal,
      )
    );

    const workerResults = await Promise.all(workerPromises);
    results.push(...workerResults);

    return results;
  }

  /**
   * 辩论执行策略
   */
  private async executeDebate(goal: string, signal?: AbortSignal): Promise<TaskExecutionResult[]> {
    const results: TaskExecutionResult[] = [];
    const members = this.context!.config.members;
    const maxRounds = this.context!.config.maxRounds!;

    for (let round = 0; round < maxRounds && this.running; round++) {
      if (signal?.aborted) break;

      this.context!.currentRound = round + 1;
      log.info(`Debate round ${round + 1}/${maxRounds}`);

      // 每轮所有成员发言
      for (let memberIndex = 0; memberIndex < members.length; memberIndex++) {
        if (signal?.aborted) break;

        const member = members[memberIndex];
        const previousResults = results.filter(r => r.taskId.startsWith(`debate-round-${round}`));
        const context = previousResults.length > 0
          ? `Previous opinions:\n${previousResults.map(r => `${r.memberId}: ${r.result}`).join('\n\n')}`
          : '';

        const taskDescription = context
          ? `${goal}\n\n${context}\n\nYour turn to respond:`
          : goal;

        const result = await this.executeMemberTask(
          member,
          taskDescription,
          results,
          `debate-round-${round + 1}-${member.id}`,
          memberIndex, // 传入成员索引
          signal,
        );
        results.push(result);
      }

      // 检查是否达成共识（简化版：所有成员都认为任务完成）
      const roundResults = results.slice(-members.length);
      const allAgree = roundResults.every(r =>
        r.result.toLowerCase().includes('agree') || r.result.toLowerCase().includes('consensus')
      );

      if (allAgree) {
        log.info('Consensus reached, ending debate');
        break;
      }
    }

    return results;
  }

  /**
   * 流水线执行策略
   *
   * ⚠️ Pipeline 保持用户定义的原始顺序（不按 priority 排序）
   * 因为流水线的语义是「前一个成员的输出 → 下一个成员的输入」，
   * 用户定义数组的顺序即为流水线阶段顺序。
   */
  private async executePipeline(goal: string, signal?: AbortSignal): Promise<TaskExecutionResult[]> {
    const results: TaskExecutionResult[] = [];
    const members = this.context!.config.members;

    let currentInput = goal;

    for (let i = 0; i < members.length; i++) {
      if (!this.running || signal?.aborted) break;
      const member = members[i];

      const result = await this.executeMemberTask(member, currentInput, results, undefined, i, signal);
      results.push(result);

      if (!result.success) {
        log.warn(`Pipeline failed at member ${member.id}`);
        break;
      }

      // 下一个成员的输入是当前成员的输出
      currentInput = result.result;
    }

    return results;
  }

  /**
   * 执行成员任务
   */
  private async executeMemberTask(
    member: TeamMember,
    task: string,
    previousResults: TaskExecutionResult[],
    taskId?: string,
    memberIndex?: number, // 成员索引（用于超时计算）
    signal?: AbortSignal, // 🆕 团队级超时信号
  ): Promise<TaskExecutionResult> {
    const tid = taskId ?? `task-${member.id}-${Date.now()}`;
    const startTime = Date.now();

    // 🆕 检查团队级超时
    if (signal?.aborted) {
      return {
        taskId: tid,
        memberId: member.id,
        result: '',
        success: false,
        duration: 0,
        tokensUsed: { input: 0, output: 0 },
        error: 'Team timeout before member execution started',
      };
    }

    // 标准化 agent ID（自动修正，只调用一次）
    const normalizedAgentId = this.normalizeAgentId(member.agentId, member.id);

    // 触发 TeamMemberStart Hook
    if (this.hookRegistry) {
      // 从 AgentRegistry 获取 Agent 配置，判断 Agent 类型
      const agentConfig = this.agentRegistry.get(normalizedAgentId);
      const isFromBuiltinDir = agentConfig?.metadata?.builtin === true;

      // 判断 Agent 类型
      let agentType: 'preset' | 'builtin' | 'custom' | 'temporary';
      if (agentConfig) {
        if (isFromBuiltinDir) {
          agentType = 'preset'; // 内置 agent（coder/explore/plan 等）
        } else {
          agentType = 'custom'; // 用户自定义 agent
        }
      } else {
        agentType = 'temporary'; // 临时 agent（未注册）
      }

      this.hookRegistry.emit('TeamMemberStart', {
        teamId: this.teamId,
        data: {
          memberId: member.id,
          name: member.name,
          role: normalizedAgentId, // 使用标准化后的 agent ID
          task: task.substring(0, 200),
          builtin: isFromBuiltinDir, // 保留兼容性
          agentType, // 新增：详细的 agent 类型
          // 策略和团队信息
          strategy: this.context!.config.strategy,
          teamName: this.context!.config.name,
          stepIndex: memberIndex,
          totalSteps: this.context!.config.members.length,
          // 辩论轮次信息（Debate 策略专用）
          currentRound: this.context!.currentRound,
          maxRounds: this.context!.config.maxRounds,
          // systemPrompt 前 100 字符（用于 GUI 解析 debate_role 标签）
          systemPromptHint: member.systemPrompt?.substring(0, 100),
        },
      }).catch((err) => {
        log.debug('TeamMemberStart hook emit failed:', err);
      });
    }

    try {
      // 构建成员特定的任务描述
      const enrichedTask = this.enrichTaskForMember(member, task, previousResults);

      let result: SubAgentResult;

      // 执行子代理（使用 calculateMemberTimeout 计算超时）
      const memberTimeout = this.calculateMemberTimeout(member, memberIndex);

      const factoryResult = await this.subAgentFactory.createAndRun(normalizedAgentId, {
        task: enrichedTask,
        depth: this.depth + 1,
        timeout: memberTimeout,
        parentConfig: this.agentConfig,
        systemPrompt: member.systemPrompt,
        tools: member.tools,
        skipSubAgentStartHook: true, // 禁用 SubAgentStart Hook，因为已经通过 TeamMemberStart 添加了
        parentAgentId: this.teamId, // 传递团队 ID 作为父 agent ID
        workingDir: process.cwd(), // 🔧 传递当前工作目录，确保子 agent 在正确的目录下工作
      }, signal); // 🔧 传递 abort signal，支持用户终止

      result = {
        result: factoryResult.result,
        tokensUsed: factoryResult.tokensUsed,
        duration: factoryResult.duration,
        timedOut: factoryResult.timedOut,
        iterations: factoryResult.iterations,
      };

      const executionResult: TaskExecutionResult = {
        taskId: tid,
        memberId: member.id,
        result: result.result,
        success: !result.timedOut && !('hasError' in result && result.hasError),
        duration: result.duration,
        tokensUsed: result.tokensUsed,
      };

      // 触发 TeamMemberEnd Hook
      if (this.hookRegistry) {
        this.hookRegistry.emit('TeamMemberEnd', {
          teamId: this.teamId,
          data: {
            memberId: member.id,
            success: executionResult.success,
            duration: executionResult.duration,
            resultSummary: executionResult.result.substring(0, 200),
          },
        }).catch((err) => {
          log.debug('TeamMemberEnd hook emit failed:', err);
        });
      }

      return executionResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errMsg = error instanceof Error ? error.message : String(error);

      return {
        taskId: tid,
        memberId: member.id,
        result: '',
        success: false,
        duration,
        tokensUsed: { input: 0, output: 0 },
        error: errMsg,
      };
    }
  }

  /**
   * 为成员增强任务描述
   */
  private enrichTaskForMember(
    member: TeamMember,
    task: string,
    previousResults: TaskExecutionResult[],
  ): string {
    let enriched = task;

    // 🔧 强制使用绝对路径（彻底解决相对路径问题）
    const cwd = process.cwd();
    enriched = `⚠️ CRITICAL - Working Directory Context:
You are working in: ${cwd}

MANDATORY RULES:
1. ALL file paths MUST be absolute paths starting with: ${cwd}/
2. NEVER use relative paths like "src/", "./", "../"
3. When the task mentions a file like "src/foo.ts", convert it to: ${cwd}/src/foo.ts
4. When creating/reading/editing files, always prepend: ${cwd}/

Example conversions:
- "src/auth/login.ts" → "${cwd}/src/auth/login.ts"
- "test/unit/auth.test.ts" → "${cwd}/test/unit/auth.test.ts"
- "README.md" → "${cwd}/README.md"

---

${enriched}`;

    // 添加成员能力说明（帮助成员理解自己的职责范围）
    if (member.capabilities.length > 0) {
      enriched += `\n\nYour role capabilities: ${member.capabilities.join(', ')}`;
    }

    // 添加共享知识（如果启用）
    if (this.context!.config.enableSharedKnowledge && this.context!.sharedKnowledge.size > 0) {
      const knowledge = Array.from(this.context!.sharedKnowledge.entries())
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join('\n');
      enriched += `\n\nShared Knowledge:\n${knowledge}`;
    }

    return enriched;
  }

  /**
   * 聚合成员结果
   */
  private aggregateResults(results: TaskExecutionResult[]): string {
    if (results.length === 0) {
      return 'No results to aggregate';
    }

    const strategy = this.context!.config.strategy;

    switch (strategy) {
      case 'sequential':
      case 'pipeline':
        // 返回最后一个成员的结果
        return results[results.length - 1].result;

      case 'parallel':
        // 合并所有成员的结果
        return results
          .map(r => `[${r.memberId}]\n${r.result}`)
          .join('\n\n---\n\n');

      case 'hierarchical':
        // 第一个是 leader，其他是 workers
        const leaderResult = results[0];
        const workerResults = results.slice(1);
        return [
          `[Leader Analysis]`,
          leaderResult.result,
          '',
          `[Team Execution]`,
          ...workerResults.map(r => `- ${r.memberId}: ${r.result}`),
        ].join('\n');

      case 'debate':
        // 返回最后一轮的总结
        const lastRound = results.slice(-this.context!.config.members.length);
        return [
          `[Team Consensus]`,
          ...lastRound.map(r => `${r.memberId}: ${r.result}`),
        ].join('\n\n');

      default:
        return results.map(r => r.result).join('\n\n');
    }
  }

  /**
   * 为团队计算合适的总超时时间
   * 🔧 根据策略和轮次动态调整
   */
  private calculateTeamTimeout(): number {
    const config = this.context!.config;

    // 优先级 1: 显式设置的团队超时
    if (config.teamTotalTimeout) {
      return config.teamTotalTimeout;
    }

    // 优先级 2: 根据策略动态计算
    const baseTimeout = DEFAULT_TEAM_CONFIG.teamTotalTimeout;
    const strategy = config.strategy;
    const memberCount = config.members.length;

    let teamTimeout: number;

    switch (strategy) {
      case 'parallel':
        // 并行：团队总时长 = 单个成员时长（因为是并发）
        teamTimeout = baseTimeout;
        break;

      case 'sequential':
      case 'pipeline':
        // 串行/流水线：团队总时长 = 成员数量 × 基准时长
        teamTimeout = baseTimeout * memberCount;
        break;

      case 'hierarchical':
        // 层级：Leader + Workers 并行，总时长 = Leader时长 + Worker时长
        // Leader 1.5x，Workers 并行执行
        teamTimeout = baseTimeout * 2.5;
        break;

      case 'debate': {
        // 🔧 辩论：根据总轮次和成员数量动态计算总超时时间
        const maxRounds = config.maxRounds || 3;
        const memberCount = config.members.length;
        const firstRoundRatio = config.debateFirstRoundRatio ?? DEFAULT_TEAM_CONFIG.debateFirstRoundRatio;
        const laterRoundRatio = config.debateLaterRoundRatio ?? DEFAULT_TEAM_CONFIG.debateLaterRoundRatio;
        const defaultMemberTimeout = config.defaultMemberTimeout ?? DEFAULT_TEAM_CONFIG.defaultMemberTimeout;

        // 计算所有轮次的总超时时间
        let totalTimeout = 0;

        for (let round = 1; round <= maxRounds; round++) {
          let roundRatio: number;

          if (round === 1) {
            // 第1轮：开场陈述，需要更多时间
            roundRatio = firstRoundRatio; // 默认 1.5x
          } else if (round === maxRounds) {
            // 最后一轮：总结陈词 + 裁判判决，需要最多时间
            roundRatio = firstRoundRatio * 1.2; // 1.8x
          } else {
            // 中间轮次：辩论交锋，正常时间
            roundRatio = laterRoundRatio; // 默认 1.0x
          }

          // 🔧 每轮的超时 = 单个成员基准超时 × 轮次倍率 × 成员数量（串行发言）
          // 例如：3个成员，首轮 1.5x，每人 10 分钟 → 10min × 1.5 × 3 = 45min
          const roundTimeout = defaultMemberTimeout * roundRatio * memberCount;
          totalTimeout += roundTimeout;
        }

        // 添加 20% 的缓冲时间，避免边界超时
        teamTimeout = Math.floor(totalTimeout * 1.2);
        break;
      }

      default:
        teamTimeout = baseTimeout;
    }

    return teamTimeout;
  }

  /**
   * 为成员计算合适的子代理超时
   *
   * 🆕 优先级（已修复）：
   * 1. member.timeout（成员显式设置）
   * 2. 基于 defaultMemberTimeout 和策略权重的自动计算 ← 提升优先级
   * 3. config.memberTimeoutMs（团队级统一超时，作为兜底） ← 降低优先级
   *
   * 策略说明：
   * - parallel: 每人 defaultMemberTimeout（并行不叠加）
   * - sequential: 基于 defaultMemberTimeout，前面成员适当放宽（1.2x → 0.8x）
   * - hierarchical: Leader = defaultMemberTimeout × leaderRatio，Worker = defaultMemberTimeout
   * - debate: 首轮 = defaultMemberTimeout × firstRoundRatio，后续 = defaultMemberTimeout × laterRoundRatio
   * - pipeline: 输入阶段 1.3x，中间 1.0x，输出 0.7x
   */
  private calculateMemberTimeout(member: TeamMember, memberIndex?: number): number {
    const config = this.context!.config;

    // 优先级 1: 成员显式设置的超时
    if (member.timeout) {
      return member.timeout;
    }

    // 🆕 优先级 2: 基于策略和权重的自动计算
    const baseTimeout = config.defaultMemberTimeout ?? DEFAULT_TEAM_CONFIG.defaultMemberTimeout;
    const strategy = config.strategy;
    const memberCount = config.members.length;

    // 获取配置或使用默认值
    const MIN_TIMEOUT = config.minMemberTimeout ?? DEFAULT_TEAM_CONFIG.minMemberTimeout;
    const MIN_DEBATE_TIMEOUT = 60_000; // Debate 每轮至少 60s

    let perMemberTimeout: number;

    switch (strategy) {
      case 'parallel':
        // 并行：每个成员独享完整的基准超时
        perMemberTimeout = baseTimeout;
        break;

      case 'sequential': {
        // 顺序执行：前松后紧，前面成员稍宽裕，后面成员稍紧凑
        if (memberIndex !== undefined) {
          // 渐进式调整：第 1 个成员 1.2x，最后 0.8x
          const weight = 1.2 - (memberIndex / Math.max(memberCount - 1, 1)) * 0.4;
          perMemberTimeout = Math.floor(baseTimeout * weight);
        } else {
          perMemberTimeout = baseTimeout;
        }
        break;
      }

      case 'hierarchical': {
        // 🔧 层级执行：根据角色和任务复杂度动态分配时长
        const isLeader = member.priority && member.priority >= 8;
        const leaderRatio = config.hierarchicalLeaderRatio ?? DEFAULT_TEAM_CONFIG.hierarchicalLeaderRatio;

        if (isLeader) {
          // Leader 获得 leaderRatio 倍的基准超时（默认 1.5x）
          // Leader 需要规划和协调，需要更多时间
          perMemberTimeout = Math.floor(baseTimeout * leaderRatio);
        } else {
          // 🔧 Workers 根据 capabilities 和 agentId 动态调整超时
          let workerRatio = 1.0;

          // 根据 agentId 类型调整
          if (member.agentId) {
            const agentId = member.agentId.toLowerCase();

            // 代码相关任务：需要更多时间
            if (agentId.includes('coder') || agentId.includes('developer') || agentId.includes('implement')) {
              workerRatio = 1.3;
            }
            // 测试相关任务：中等时间
            else if (agentId.includes('test') || agentId.includes('qa')) {
              workerRatio = 1.1;
            }
            // 探索/研究任务：较多时间
            else if (agentId.includes('explore') || agentId.includes('research') || agentId.includes('analyze')) {
              workerRatio = 1.2;
            }
            // 规划任务：较多时间
            else if (agentId.includes('plan') || agentId.includes('architect')) {
              workerRatio = 1.25;
            }
            // 其他任务：基准时间
          }

          // 🔧 根据 capabilities 数量调整（能力越多，任务可能越复杂）
          if (member.capabilities && member.capabilities.length > 0) {
            const capabilityBonus = Math.min(member.capabilities.length * 0.05, 0.2); // 最多增加20%
            workerRatio += capabilityBonus;
          }

          perMemberTimeout = Math.floor(baseTimeout * workerRatio);
        }
        break;
      }

      case 'debate': {
        // 🔧 辩论模式：根据轮次和角色动态分配时长
        const currentRound = this.context!.currentRound || 1;
        const maxRounds = config.maxRounds || 3;
        const firstRoundRatio = config.debateFirstRoundRatio ?? DEFAULT_TEAM_CONFIG.debateFirstRoundRatio;
        const laterRoundRatio = config.debateLaterRoundRatio ?? DEFAULT_TEAM_CONFIG.debateLaterRoundRatio;

        // 🔧 根据轮次调整时长
        let roundRatio: number;
        if (currentRound === 1) {
          // 第1轮：开场陈述，需要更多时间
          roundRatio = firstRoundRatio; // 默认 1.5x
        } else if (currentRound === maxRounds) {
          // 最后一轮：总结陈词，需要充足时间
          roundRatio = firstRoundRatio * 1.2; // 1.8x
        } else {
          // 中间轮次：辩论交锋，正常时间
          roundRatio = laterRoundRatio; // 默认 1.0x
        }

        // 🔧 根据角色调整时长（从 systemPrompt 中解析）
        let roleRatio = 1.0;
        if (member.systemPrompt) {
          const roleMatch = member.systemPrompt.match(/\[debate_role:(affirmative|negative|judge)\]/i);
          if (roleMatch) {
            const role = roleMatch[1].toLowerCase();
            if (role === 'judge') {
              // 裁判需要更多时间评估和判决
              roleRatio = 1.3;
            }
          }
        }

        perMemberTimeout = Math.floor(baseTimeout * roundRatio * roleRatio);

        // 保证最小值
        perMemberTimeout = Math.max(perMemberTimeout, MIN_DEBATE_TIMEOUT);
        break;
      }

      case 'pipeline': {
        // 流水线：根据阶段特点调整权重
        if (memberIndex !== undefined) {
          let weight = 1.0;

          // 第一个阶段（输入）：1.3x
          if (memberIndex === 0) {
            weight = 1.3;
          }
          // 最后一个阶段（输出）：0.7x
          else if (memberIndex === memberCount - 1) {
            weight = 0.7;
          }
          // 中间阶段（处理）：1.0x

          perMemberTimeout = Math.floor(baseTimeout * weight);
        } else {
          perMemberTimeout = baseTimeout;
        }
        break;
      }

      default:
        perMemberTimeout = baseTimeout;
    }

    // 🆕 优先级 3: 团队级统一超时（作为兜底或上限）
    if (config.memberTimeoutMs) {
      // 如果设置了统一超时，取两者较小值（避免超出预算）
      perMemberTimeout = Math.min(perMemberTimeout, config.memberTimeoutMs);
    }

    const result = Math.max(perMemberTimeout, MIN_TIMEOUT);
    log.debug(
      `[${member.id}] calculated timeout: ${result}ms ` +
      `(strategy=${strategy}, baseTimeout=${baseTimeout}ms, members=${memberCount}, index=${memberIndex ?? 'N/A'})`
    );
    return result;
  }

  /**
   * 获取按优先级排序的成员列表
   */
  private getSortedMembers(): TeamMember[] {
    return [...this.context!.config.members].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    );
  }

  /**
   * 记录超时分配方案（便于用户了解实际配置）
   */
  private logTimeoutAllocation(): void {
    const config = this.context!.config;
    const strategy = config.strategy;
    const members = config.members;

    log.info(`[Team Timeout Allocation]`);
    log.info(`  Strategy: ${strategy}`);
    log.info(`  Members: ${members.length}`);
    log.info(`  🆕 Team Total Timeout: ${config.teamTotalTimeout ?? DEFAULT_TEAM_CONFIG.teamTotalTimeout}ms (${((config.teamTotalTimeout ?? DEFAULT_TEAM_CONFIG.teamTotalTimeout) / 1000).toFixed(0)}s)`);
    log.info(`  Default Member Timeout: ${config.defaultMemberTimeout ?? DEFAULT_TEAM_CONFIG.defaultMemberTimeout}ms`);

    // 计算并显示每个成员的超时
    let estimatedTotal = 0;
    members.forEach((member, index) => {
      const calculatedTimeout = this.calculateMemberTimeout(member, index);
      const timeout = member.timeout ?? calculatedTimeout;
      const label = member.name || member.id;
      const priorityInfo = member.priority !== undefined ? ` (priority=${member.priority})` : '';

      // 标记显式设置的超时
      const timeoutSource = member.timeout ? ' [explicit]' : ' [auto]';
      const warningMark = member.timeout && member.timeout < calculatedTimeout ? ' ⚠️' : '';

      log.info(`    - ${label}${priorityInfo}: ${timeout}ms (${(timeout / 1000).toFixed(0)}s)${timeoutSource}${warningMark}`);

      // 累计预估总超时（根据策略）
      if (strategy === 'parallel') {
        estimatedTotal = Math.max(estimatedTotal, timeout);
      } else {
        estimatedTotal += timeout;
      }
    });

    // 显示预估总超时
    log.info(`  Estimated Total: ${estimatedTotal}ms (${(estimatedTotal / 1000).toFixed(0)}s)`);

    // 策略特定的额外信息
    if (strategy === 'hierarchical') {
      const ratio = config.hierarchicalLeaderRatio ?? DEFAULT_TEAM_CONFIG.hierarchicalLeaderRatio;
      log.info(`  Hierarchical Leader Ratio: ${(ratio * 100).toFixed(0)}%`);
    } else if (strategy === 'debate') {
      const ratio = config.debateFirstRoundRatio ?? DEFAULT_TEAM_CONFIG.debateFirstRoundRatio;
      const maxRounds = config.maxRounds ?? DEFAULT_TEAM_CONFIG.maxRounds;
      log.info(`  Debate First Round Ratio: ${(ratio * 100).toFixed(0)}%`);
      log.info(`  Max Rounds: ${maxRounds}`);
    }
  }
}
