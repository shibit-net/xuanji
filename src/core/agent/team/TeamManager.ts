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
import { DEFAULT_TEAM_CONFIG } from './types';
import { runSubAgent, type SubAgentResult } from '../SubAgentLoop';
import { SubAgentContext } from '../SubAgentContext';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'TeamManager' });

/**
 * 团队管理器实现
 */
export class TeamManager implements ITeamManager {
  private context: TeamContext | null = null;
  private mainProvider: ILLMProvider;
  private lightProvider: ILLMProvider;
  private registry: IToolRegistry;
  private agentConfig: AgentConfig;
  private hookRegistry: HookRegistry | null;
  private memoryStore: IMemoryStore | null;
  private running = false;
  private taskQueue: TaskAssignment[] = [];
  private completedTasks: Map<string, TaskExecutionResult> = new Map();
  private depth: number;

  constructor(
    mainProvider: ILLMProvider,
    lightProvider: ILLMProvider,
    registry: IToolRegistry,
    agentConfig: AgentConfig,
    hookRegistry?: HookRegistry | null,
    memoryStore?: IMemoryStore | null,
    depth = 0,
  ) {
    this.mainProvider = mainProvider;
    this.lightProvider = lightProvider;
    this.registry = registry;
    this.agentConfig = agentConfig;
    this.hookRegistry = hookRegistry ?? null;
    this.memoryStore = memoryStore ?? null;
    this.depth = depth;
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
        timeout: config.timeout ?? DEFAULT_TEAM_CONFIG.timeout,
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
   * 执行团队任务
   */
  async execute(goal: string): Promise<TeamExecutionResult> {
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

    // 触发 TeamStart Hook
    if (this.hookRegistry) {
      this.hookRegistry.emit('TeamStart', {
        teamId: `team-${Date.now()}`,
        data: {
          name: this.context.config.name,
          goal,
          strategy: this.context.config.strategy,
          memberCount: this.context.config.members.length,
        },
      }).catch((err) => {
        log.debug('TeamStart hook emit failed:', err);
      });
    }

    try {
      log.info(`Team "${this.context.config.name}" executing goal: ${goal}`);

      // 整体超时保护 —— 防止团队执行无限期挂起
      // sequential/pipeline/debate 每个成员都有单独超时，但多成员叠加可能超出总预算
      const teamTimeout = this.context.config.timeout!;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      const strategyPromise = (): Promise<TaskExecutionResult[]> => {
        switch (this.context!.config.strategy) {
          case 'sequential':
            return this.executeSequential(goal);
          case 'parallel':
            return this.executeParallel(goal);
          case 'hierarchical':
            return this.executeHierarchical(goal);
          case 'debate':
            return this.executeDebate(goal);
          case 'pipeline':
            return this.executePipeline(goal);
          default:
            return Promise.reject(new Error(`Unknown team strategy: ${this.context!.config.strategy}`));
        }
      };

      const teamTimeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          // 停止后续成员执行（sequential / pipeline / debate 检查 this.running）
          this.running = false;
          reject(new Error(
            `Team "${this.context!.config.name}" timed out after ${(teamTimeout / 1000).toFixed(0)}s`
          ));
        }, teamTimeout);
      });

      try {
        const results = await Promise.race([strategyPromise(), teamTimeoutPromise]);
        memberResults.push(...results);
      } finally {
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      }

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
          teamId: `team-${startTime}`,
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

      if (errMsg.includes('timeout') || errMsg.includes('timed out')) {
        timedOut = true;
      }

      return {
        goal,
        output: `Team execution failed: ${errMsg}`,
        memberResults,
        duration,
        totalTokens: { input: 0, output: 0 },
        rounds: this.context.currentRound,
        success: false,
        timedOut,
      };
    } finally {
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
  private async executeSequential(goal: string): Promise<TaskExecutionResult[]> {
    const results: TaskExecutionResult[] = [];
    const members = this.getSortedMembers();

    for (const member of members) {
      if (!this.running) break;

      const result = await this.executeMemberTask(member, goal, results);
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
  private async executeParallel(goal: string): Promise<TaskExecutionResult[]> {
    const members = this.context!.config.members;
    const MAX_CONCURRENT = 3;

    if (members.length <= MAX_CONCURRENT) {
      // 成员数不超过并发上限，直接全部并行
      return Promise.all(members.map(member => this.executeMemberTask(member, goal, [])));
    }

    // 分批并行，每批最多 MAX_CONCURRENT 个，避免资源耗尽
    const results: TaskExecutionResult[] = [];
    for (let i = 0; i < members.length; i += MAX_CONCURRENT) {
      if (!this.running) break;
      const batch = members.slice(i, i + MAX_CONCURRENT);
      const batchResults = await Promise.all(
        batch.map(member => this.executeMemberTask(member, goal, []))
      );
      results.push(...batchResults);
    }
    return results;
  }

  /**
   * 层级执行策略
   */
  private async executeHierarchical(goal: string): Promise<TaskExecutionResult[]> {
    const results: TaskExecutionResult[] = [];
    const members = this.getSortedMembers();

    // 主 agent（优先级最高）
    const leader = members[0];
    const leaderResult = await this.executeMemberTask(leader, goal, []);
    results.push(leaderResult);

    if (!leaderResult.success) {
      return results;
    }

    // 根据主 agent 的输出，分配给其他成员
    const workers = members.slice(1);
    const workerPromises = workers.map(worker =>
      this.executeMemberTask(
        worker,
        `Based on the leader's analysis:\n${leaderResult.result}\n\nYour task: ${goal}`,
        results,
      )
    );

    const workerResults = await Promise.all(workerPromises);
    results.push(...workerResults);

    return results;
  }

  /**
   * 辩论执行策略
   */
  private async executeDebate(goal: string): Promise<TaskExecutionResult[]> {
    const results: TaskExecutionResult[] = [];
    const members = this.context!.config.members;
    const maxRounds = this.context!.config.maxRounds!;

    for (let round = 0; round < maxRounds && this.running; round++) {
      this.context!.currentRound = round + 1;
      log.info(`Debate round ${round + 1}/${maxRounds}`);

      // 每轮所有成员发言
      for (const member of members) {
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
   */
  private async executePipeline(goal: string): Promise<TaskExecutionResult[]> {
    const results: TaskExecutionResult[] = [];
    const members = this.getSortedMembers();

    let currentInput = goal;

    for (const member of members) {
      if (!this.running) break;

      const result = await this.executeMemberTask(member, currentInput, results);
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
  ): Promise<TaskExecutionResult> {
    const tid = taskId ?? `task-${member.id}-${Date.now()}`;
    const startTime = Date.now();

    // 触发 TeamMemberStart Hook
    if (this.hookRegistry) {
      this.hookRegistry.emit('TeamMemberStart', {
        teamId: `team-${this.context!.startTime}`,
        data: {
          memberId: member.id,
          role: member.role,
          task: task.substring(0, 200),
        },
      }).catch((err) => {
        log.debug('TeamMemberStart hook emit failed:', err);
      });
    }

    try {
      // 构建成员特定的任务描述
      const enrichedTask = this.enrichTaskForMember(member, task, previousResults);

      // 创建子代理上下文
      const context = new SubAgentContext({
        task: enrichedTask,
        role: member.role,
        depth: this.depth + 1,
        timeout: this.context!.config.timeout,
      });

      // 执行子代理
      const result = await runSubAgent(
        this.mainProvider,
        this.lightProvider,
        this.registry,
        this.agentConfig,
        context,
        this.hookRegistry,
        this.memoryStore,
      );

      const executionResult: TaskExecutionResult = {
        taskId: tid,
        memberId: member.id,
        result: result.result,
        success: !result.timedOut && !result.hasError,
        duration: result.duration,
        tokensUsed: result.tokensUsed,
      };

      // 触发 TeamMemberEnd Hook
      if (this.hookRegistry) {
        this.hookRegistry.emit('TeamMemberEnd', {
          teamId: `team-${this.context!.startTime}`,
          data: {
            memberId: member.id,
            success: executionResult.success,
            duration: executionResult.duration,
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

    // 添加成员能力说明
    if (member.capabilities.length > 0) {
      enriched += `\n\nYour capabilities: ${member.capabilities.join(', ')}`;
    }

    // 添加成员特定提示
    if (member.systemPrompt) {
      enriched += `\n\n${member.systemPrompt}`;
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
   * 获取按优先级排序的成员列表
   */
  private getSortedMembers(): TeamMember[] {
    return [...this.context!.config.members].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    );
  }
}
