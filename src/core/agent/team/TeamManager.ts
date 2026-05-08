/**
 * TeamManager — 团队管理器
 *
 * 核心职责：
 * 1. 管理团队成员生命周期
 * 2. 根据策略分配任务
 * 3. 路由成员间消息
 * 4. 聚合执行结果
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
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
  FailureCategory,
} from './types';
import type { ILLMProvider, IToolRegistry, AgentConfig } from '@/core/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import type { AgentRegistry } from '../AgentRegistry';
import type { ProviderManager } from '@/core/providers/ProviderManager';
import { DEFAULT_TEAM_CONFIG } from './types';
import type { SubAgentResult } from '../factory/AgentFactory';
import { AgentFactory } from '../factory/AgentFactory';
import { WorktreeManager, type WorktreeInfo } from '../WorktreeManager';
import { logger } from '@/core/logger';
import { TeamContext as TeamContextStore } from '@/core/tools/TeamContext';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
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
  private running = false;
  private taskQueue: TaskAssignment[] = [];
  private completedTasks: Map<string, TaskExecutionResult> = new Map();
  private depth: number;
  private teamAbortController: AbortController | null = null; // 保存引用以便 stop() 能中止
  public agentFactory: AgentFactory;  // 统一 Agent 工厂
  private teamId: string; // 团队唯一标识，在构造时生成
  private agentRegistry: AgentRegistry; // 保存 agentRegistry 引用
  private memberSubAgentIds: Map<string, string> = new Map(); // 预生成的 subAgentId 映射 (memberId → subAgentId)
  private workingDir: string; // 团队工作目录（从 TeamTool._cwd 传入，避免依赖全局 process.cwd()）
  private worktreeManager: WorktreeManager; // P1-2: 工作区隔离管理
  private activeWorktrees: Map<string, WorktreeInfo> = new Map(); // P1-2: 活跃的 worktree 映射 (memberId → WorktreeInfo)
  private recoveredCheckpoints: Map<string, TaskExecutionResult> = new Map(); // P1-1: 从历史 checkpoint 恢复的成员结果

  constructor(
    mainProvider: ILLMProvider,
    registry: IToolRegistry,
    agentConfig: AgentConfig,
    hookRegistry?: HookRegistry | null,
    memoryStore?: null,
    depth = 0,
    agentRegistry?: AgentRegistry,
    providerManager?: ProviderManager,
    workingDir?: string,
  ) {
    this.mainProvider = mainProvider;
    this.registry = registry;
    this.agentConfig = agentConfig;
    this.hookRegistry = hookRegistry ?? null;
    this.depth = depth;
    this.teamId = `team-${Date.now()}`; // 在构造时生成唯一 ID
    this.workingDir = workingDir || process.cwd();
    this.worktreeManager = new WorktreeManager(path.join(this.workingDir, '.xuanji', 'worktrees'));

    if (!agentRegistry || !providerManager) {
      throw new Error('TeamManager requires agentRegistry and providerManager');
    }

    this.agentRegistry = agentRegistry; // 保存引用

    this.agentFactory = new AgentFactory(registry);
    if (hookRegistry) this.agentFactory.setHookRegistry(hookRegistry);
    this.agentFactory.setParentProvider(mainProvider);
    this.agentFactory.setParentConfig(agentConfig);
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
      const category = registeredAgent.metadata?.category || 'custom';
      const agentType = category === 'system' ? 'builtin' : category === 'app' ? 'preset' : 'custom';
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
    this.teamAbortController = teamAbortController;
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

    // 🆕 预生成所有成员的 subAgentId，使前端可以在 TeamStart 时一次性展示所有成员
    this.memberSubAgentIds.clear();
    for (const member of this.context.config.members) {
      const normalizedAgentId = this.normalizeAgentId(member.agentId, member.id);
      const subAgentId = `subagent-${normalizedAgentId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      this.memberSubAgentIds.set(member.id, subAgentId);
    }

    // P1-1: 加载历史 checkpoint，恢复已完成成员的结果
    this.recoveredCheckpoints = this.loadCheckpoints();
    const recoveredMemberIds: string[] = [];
    if (this.recoveredCheckpoints.size > 0) {
      for (const [memberId, cp] of this.recoveredCheckpoints) {
        if (cp.success && this.context.config.members.some(m => m.id === memberId)) {
          recoveredMemberIds.push(memberId);
          log.info(`Recovered checkpoint for ${memberId} (duration: ${(cp.duration / 1000).toFixed(1)}s)`);
        }
      }
    }

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
          maxRounds: this.context.config.maxRounds,
          recoveredMembers: recoveredMemberIds, // P1-1: 从 checkpoint 恢复的成员列表
          // 添加完整的成员列表（含预生成的 subAgentId，用于前端一次性展示所有成员）
          members: this.context.config.members.map((member, index) => {
            const agentConfig = this.agentRegistry.get(member.agentId);
            const displayName = agentConfig?.name || member.name || member.id;
            const category = agentConfig?.metadata?.category || 'custom';
            let agentType: 'preset' | 'builtin' | 'custom' | 'temporary';
            if (agentConfig) {
              if (category === 'system') agentType = 'builtin';
              else if (category === 'app') agentType = 'preset';
              else agentType = 'custom';
            } else {
              agentType = 'temporary';
            }

            // 解析辩论角色（正方/反方/裁判），使前端在团队创建时即可展示
            let debateRole: 'affirmative' | 'negative' | 'judge' | undefined;
            if (member.systemPrompt) {
              const roleMatch = member.systemPrompt.match(/\[debate_role:(affirmative|negative|judge)\]/i);
              if (roleMatch) {
                debateRole = roleMatch[1].toLowerCase() as 'affirmative' | 'negative' | 'judge';
              }
            }

            return {
              id: member.id,
              name: displayName,
              role: member.agentId,
              capabilities: member.capabilities,
              stepIndex: index,
              totalSteps: this.context!.config.members.length,
              subAgentId: this.memberSubAgentIds.get(member.id) || '',
              agentType,
              strategy: this.context!.config.strategy,
              teamName: this.context!.config.name,
              task: (member.task || goal).substring(0, 200),
              debateRole,
              scene: member.scene?.replace(/^l[12]-/, ''),
              executionMode: 'acp',
            };
          }),
        },
      }).catch((err) => {
        log.debug('TeamStart hook emit failed:', err);
      });

      // 通过 EventBus 发送团队启动事件（agent-bridge 监听此事件转发到渲染进程）
      eventBus.emit(XuanjiEvent.HOOK_TEAM_START, {
        teamId: this.teamId,
        data: {
          name: this.context.config.name,
          goal,
          strategy: this.context.config.strategy,
          memberCount: this.context.config.members.length,
          maxRounds: this.context.config.maxRounds,
          members: this.context.config.members.map((member, index) => {
            const agentConfig = this.agentRegistry.get(member.agentId);
            const displayName = agentConfig?.name || member.name || member.id;
            const category = agentConfig?.metadata?.category || 'custom';
            let agentType: 'preset' | 'builtin' | 'custom' | 'temporary';
            if (agentConfig) {
              if (category === 'system') agentType = 'builtin';
              else if (category === 'app') agentType = 'preset';
              else agentType = 'custom';
            } else {
              agentType = 'temporary';
            }
            let debateRole: 'affirmative' | 'negative' | 'judge' | undefined;
            if (member.systemPrompt) {
              const roleMatch = member.systemPrompt.match(/\[debate_role:(affirmative|negative|judge)\]/i);
              if (roleMatch) {
                debateRole = roleMatch[1].toLowerCase() as 'affirmative' | 'negative' | 'judge';
              }
            }
            return {
              id: member.id,
              name: displayName,
              role: member.agentId,
              capabilities: member.capabilities,
              stepIndex: index,
              totalSteps: this.context!.config.members.length,
              subAgentId: this.memberSubAgentIds.get(member.id) || '',
              agentType,
              strategy: this.context!.config.strategy,
              teamName: this.context!.config.name,
              task: (member.task || goal).substring(0, 200),
              debateRole,
              scene: member.scene?.replace(/^l[12]-/, ''),
              executionMode: 'acp',
            };
          }),
        },
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
      log.info(`[TEAM] 执行策略: "${this.context!.config.strategy}", 成员数: ${this.context!.config.members.length}, teamName: "${this.context!.config.name}"`);
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
            checkpointCount: memberResults.filter(r => r.success).length,
          },
        }).catch((err) => {
          log.debug('TeamEnd hook emit failed:', err);
        });
      }

      // 通过 EventBus 发送团队结束事件
      eventBus.emit(XuanjiEvent.HOOK_TEAM_END, {
        teamId: this.teamId,
        data: {
          name: this.context.config.name,
          success: result.success,
          duration,
          timedOut,
        },
      });

      // P1-1: 成功完成时清理 checkpoint
      if (result.success) {
        this.clearCheckpoints();
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
            cancelled: externalSignal?.aborted ?? false,
            error: errMsg,
            checkpointCount: memberResults.filter(r => r.success).length,
            checkpointDir: this.checkpointDir,
          },
        }).catch((err) => {
          log.debug('TeamEnd hook emit failed:', err);
        });
      }

      // 通过 EventBus 发送团队结束事件（失败）
      eventBus.emit(XuanjiEvent.HOOK_TEAM_END, {
        teamId: this.teamId,
        data: {
          name: this.context!.config.name,
          success: false,
          duration,
          timedOut,
          cancelled: externalSignal?.aborted ?? false,
          error: errMsg,
        },
      });

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
      this.teamAbortController = null;
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
    if (this.teamAbortController) {
      this.teamAbortController.abort();
    }
    log.info('Team execution stopped (aborted)');
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

    // P2-7: 并行策略验证 — 确保每个成员有足够信息创建子 agent
    if (config.strategy === 'parallel') {
      const problemMembers: string[] = [];
      for (const m of config.members) {
        const isRegistered = this.agentRegistry.get(m.agentId);
        const hasSystemPrompt = m.systemPrompt && m.systemPrompt.trim().length > 10;
        const hasTools = m.tools && m.tools.length > 0;
        // 未注册 + 缺少 system_prompt 或 tools → 无法创建
        if (!isRegistered && !hasSystemPrompt) {
          problemMembers.push(
            `  - "${m.id}" (agent_id="${m.agentId}"): ` +
            `未在注册表中找到，且缺少 system_prompt。请提供 system_prompt 描述该临时 agent 的行为。`
          );
        } else if (!isRegistered && !hasTools) {
          problemMembers.push(
            `  - "${m.id}" (agent_id="${m.agentId}"): ` +
            `未在注册表中找到，且未指定 tools。请提供 tools 参数（如 ["read_file", "write_file", "grep"]）。`
          );
        }
      }
      if (problemMembers.length > 0) {
        throw new Error(
          `Parallel strategy: ${problemMembers.length} 个成员无法创建子 agent，缺少必要参数：\n\n` +
          `${problemMembers.join('\n')}\n\n` +
          `解决方案：\n` +
          `1. 推荐：为每个成员使用 match_agent 查找合适的预置 agent\n` +
          `2. 备选：为临时 agent 提供 system_prompt + tools 参数\n` +
          `示例：\n` +
          `{ id: "${problemMembers[0]?.split('"')[1] || 'member'}", agent_id: "custom-analyst", ` +
          `system_prompt: "你是一个代码分析专家...", tools: ["read_file", "grep", "glob"] }`
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

    // P2-5: 策略推荐 — 分析 goal 特征，提示最佳策略
    const suggested = this.suggestStrategy(config);
    if (suggested && suggested !== config.strategy) {
      log.info(
        `Strategy hint: task looks like "${suggested}" pattern. ` +
        `Current strategy is "${config.strategy}". If execution fails, consider switching to "${suggested}".`
      );
    }
  }

  /**
   * P1 优化 — 基于任务特征自动推荐策略（决策树）
   *
   * 决策树逻辑：
   *   if has_known_conflict → debate
   *   elif needs_design_first → hierarchical
   *   elif has_data_pipeline → pipeline
   *   elif has_dependency → sequential
   *   else → parallel
   *
   * 前置门槛：至少满足 2 条使用条件才推荐 agent_team
   */
  private suggestStrategy(config: TeamConfig): TeamStrategy | null {
    const { goal, strategy, members } = config;
    const goalLower = goal.toLowerCase();
    const memberTasks = members.map(m => (m.task || m.systemPrompt || '').toLowerCase()).join(' ');
    const allText = `${goalLower} ${memberTasks}`;

    // ── 特征提取（关键词匹配识别 4 个维度） ──────────────
    // 1. has_known_conflict：已知决策分歧
    const conflictKeywords = /争议|分歧|辩论|选型|方案.*对比|方案.*选择|技术.*选|哪个.*好|比较|权衡|取舍|vs\.?|versus|debate|pros?\s*(?:and|&)\s*cons?|choose\s*between|decide\s*between|评审.*方案/i;
    const hasKnownConflict = conflictKeywords.test(allText);

    // 2. needs_design_first：需要先设计再实现
    const designFirstKeywords = /架构.*设计|设计.*架构|先.*规划|规划.*再|系统.*设计|重构.*方案|架构.*重构|技术方案|从零.*搭建|整体.*设计|architect.*first|design.*before|plan.*then|decompose.*assign|拆分为.*子任务|分解.*分配/i;
    const needsDesignFirst = designFirstKeywords.test(allText);

    // 3. has_data_pipeline：数据流转链
    const pipelineKeywords = /数据.*处理|ETL|数据流|提取.*转换|转换.*加载|采集.*清洗.*分析|收集.*分析.*报告|数据处理管道|pipeline|extract.*transform|data.*flow|数据.*可视化|看板|报表.*生成/i;
    const hasDataPipeline = pipelineKeywords.test(allText);

    // 4. has_dependency：子任务有依赖
    const dependencyKeywords = /依赖|先后|步骤|阶段|第一步.*第二步|然后|接着|之后|基于.*结果|前一步|上一个.*输出|上一个.*结果|depends?\s*on|sequential|step\s*by\s*step|typecheck.*build|lint.*test.*build/i;
    const hasDependency = dependencyKeywords.test(allText);

    // ── 决策树 ──────────────────────────────────────────
    let recommended: TeamStrategy | null = null;
    let reason = '';

    if (hasKnownConflict) {
      recommended = 'debate';
      reason = '检测到决策分歧/方案选型特征 → debate';
    } else if (needsDesignFirst) {
      recommended = 'hierarchical';
      reason = '检测到架构设计+分工实现特征 → hierarchical';
    } else if (hasDataPipeline) {
      recommended = 'pipeline';
      reason = '检测到数据流转/ETL特征 → pipeline';
    } else if (hasDependency) {
      recommended = 'sequential';
      reason = '检测到步骤依赖特征 → sequential';
    } else {
      recommended = 'parallel';
      reason = '无特殊依赖特征 → parallel（默认最快）';
    }

    if (recommended && recommended !== strategy) {
      log.info(
        `Strategy hint: ${reason}. ` +
        `Current strategy is "${strategy}". If execution fails, consider switching to "${recommended}".`
      );
    } else if (recommended === strategy) {
      log.info(`Strategy confirmed: ${reason}`);
    }

    return recommended !== strategy ? recommended : null;
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
   *
   * P1-2: 为每个并行成员创建独立 worktree，避免 Worker 间文件冲突
   */
  private async executeParallel(goal: string, signal?: AbortSignal): Promise<TaskExecutionResult[]> {
    const members = this.context!.config.members;
    const MAX_CONCURRENT = 3;

    // P1-2: 为每个成员创建 worktree（顺序创建避免 git 冲突）
    const worktreePaths: Map<string, string> = new Map();
    const useWorktreeIsolation = this.worktreeManager.isGitRepo(this.workingDir) && members.length > 1;

    if (useWorktreeIsolation) {
      log.info(`Creating ${members.length} worktree(s) for parallel isolation`);
      for (const member of members) {
        if (signal?.aborted) break;
        try {
          const info = await this.worktreeManager.create(`team-${this.teamId}-${member.id}`);
          worktreePaths.set(member.id, info.path);
          this.activeWorktrees.set(member.id, info);
          log.info(`Worktree created for ${member.id}: ${info.path}`);
        } catch (err) {
          log.warn(`Failed to create worktree for ${member.id}, falling back to shared workspace:`, err);
        }
      }
    }

    const executeWithWorktree = (member: TeamMember, index: number): Promise<TaskExecutionResult> => {
      const wtPath = worktreePaths.get(member.id);
      return this.executeMemberTask(member, goal, [], undefined, index, signal, 0, wtPath);
    };

    try {
      // 滑动窗口：最多 MAX_CONCURRENT 个并行，任一完成即补入下一个
      const results: TaskExecutionResult[] = new Array(members.length);
      const running = new Map<number, Promise<number>>(); // index → Promise<index>
      let nextIndex = 0;

      const startMember = () => {
        if (nextIndex >= members.length || running.size >= MAX_CONCURRENT) return;
        const index = nextIndex++;
        const member = members[index];
        const p = executeWithWorktree(member, index).then((result) => {
          results[index] = result;
          return index;
        });
        running.set(index, p);
      };

      // 启动初始窗口
      for (let i = 0; i < Math.min(MAX_CONCURRENT, members.length); i++) {
        startMember();
      }

      // 任一完成 → 立即补入下一个
      while (running.size > 0) {
        if (!this.running || signal?.aborted) break;
        const completedIndex = await Promise.race(running.values());
        running.delete(completedIndex);
        startMember();
      }

      // P1-2: 合并 worktree 变更回主仓库
      if (worktreePaths.size > 0) {
        await this.mergeWorktrees();
      }

      return results.filter((r): r is TaskExecutionResult => r !== undefined);
    } finally {
      // P1-2: 清理所有 worktree
      if (worktreePaths.size > 0) {
        await this.cleanupWorktrees();
      }
    }
  }

  /**
   * P1-2: 合并所有活跃 worktree 的变更回主仓库
   */
  private async mergeWorktrees(): Promise<void> {
    for (const [memberId, info] of this.activeWorktrees) {
      try {
        const hasChanges = await this.worktreeManager.hasChanges(info.path);
        if (hasChanges) {
          // 在 worktree 中提交变更
          const { execFileSync } = await import('node:child_process');
          execFileSync('git', ['add', '-A'], { cwd: info.path, stdio: 'pipe' });
          execFileSync('git', ['commit', '-m', `[team] ${memberId} worktree changes`], {
            cwd: info.path, stdio: 'pipe',
          });
          // 合并 worktree 分支到当前分支
          execFileSync('git', ['merge', info.branch, '--strategy=ort', '--no-edit'], {
            cwd: this.workingDir, stdio: 'pipe',
          });
          log.info(`Merged worktree changes from ${memberId} (branch: ${info.branch})`);
        }
      } catch (err) {
        log.warn(`Failed to merge worktree for ${memberId}:`, err);
      }
    }
  }

  /**
   * P1-2: 清理所有活跃 worktree
   */
  private async cleanupWorktrees(): Promise<void> {
    for (const [memberId, info] of this.activeWorktrees) {
      try {
        await this.worktreeManager.remove(info.path);
        log.info(`Cleaned up worktree for ${memberId}`);
      } catch (err) {
        log.warn(`Failed to cleanup worktree for ${memberId}:`, err);
      }
    }
    this.activeWorktrees.clear();
  }

  /**
   * 层级执行策略
   *
   * Leader 收到团队组成信息后自行分解任务，Worker 各自拿到 Leader 分配的独立子任务。
   * 主 agent 只负责 Leader 的初始目标，不预分配 Worker 任务。
   */
  private async executeHierarchical(goal: string, signal?: AbortSignal): Promise<TaskExecutionResult[]> {
    const results: TaskExecutionResult[] = [];
    const members = this.getSortedMembers();

    const leader = members[0];
    const workers = members.slice(1);

    // ── 构建团队组成描述，供 Leader 分解任务 ──────────────────
    const teamRoster = workers.map((w, i) =>
      `  ${i + 1}. ${w.name || w.id} (id: ${w.id})` +
      (w.capabilities.length > 0 ? ` — 能力: ${w.capabilities.join(', ')}` : '')
    ).join('\n');

    const leaderTask = [
      `团队目标：${goal}`,
      '',
      `你的团队有 ${workers.length} 名成员：`,
      teamRoster,
      '',
      '你的职责：分析目标，为每名成员分配具体的子任务，形成执行计划。',
      '',
      '**分配方式：使用 task 工具逐个创建子成员，而不是输出文本格式的分配方案。**',
      '',
      '执行步骤：',
      `1. 分析目标，决定每个成员需要做什么、用什么 scene（通过 list_scenes 查询可用 scene）`,
      `2. 为每个成员调用一次 task 工具执行其任务`,
      `3. task 调用格式：task({ subagent_type: "<agent-id>", scene: "<scene>", description: "..." })`,
      `4. 所有成员完成后，汇总结果并输出最终产出`,
      '',
      '注意：task 是同步调用，等待一个成员完成后才能开始下一个。',
      '',
    ].join('\n');

    // ── Leader 自行通过 task 工具分配并执行 ────────────────
    // leader 会自己调 task 创建子成员，TeamManager 不再介入
    log.info(`Hierarchical: Leader "${leader.name || leader.id}" 通过 task 工具分配任务`);
    const leaderResult = await TeamContextStore.run({
      teamId: this.teamId,
      parentMemberId: leader.id,
      strategy: 'hierarchical',
    }, () => this.executeMemberTask(leader, leaderTask, [], undefined, 0, signal));
    results.push(leaderResult);

    return results;
  }

  /**
   * 解析 Leader 输出中的任务分配
   * 格式：[ASSIGN:<memberId>]\n<task>\n[/ASSIGN]
   */
  private parseHierarchicalAssignments(
    leaderOutput: string,
    workers: TeamMember[],
  ): Map<string, string> {
    const assignments = new Map<string, string>();
    const workerIds = new Set(workers.map(w => w.id));

    // 匹配 [ASSIGN:id] ... [/ASSIGN] 块
    const assignRegex = /\[ASSIGN:\s*([^\]]+)\]\s*([\s\S]*?)\s*\[\/ASSIGN\]/gi;
    let match: RegExpExecArray | null;

    while ((match = assignRegex.exec(leaderOutput)) !== null) {
      const rawId = match[1].trim();
      const task = match[2].trim();

      // 尝试精确匹配 worker ID
      if (workerIds.has(rawId)) {
        assignments.set(rawId, task);
      } else {
        // 模糊匹配：按名称或部分 ID
        const matchedWorker = workers.find(w =>
          w.id === rawId ||
          (w.name && w.name.toLowerCase() === rawId.toLowerCase()) ||
          (w.name && rawId.toLowerCase().includes(w.name.toLowerCase()))
        );
        if (matchedWorker) {
          assignments.set(matchedWorker.id, task);
        }
      }
    }

    return assignments;
  }

  /**
   * 辩论执行策略
   *
   * P1 优化 — Judge 预读模式：
   * 1. 预读阶段：Judge 读取关键源码 → 输出「事实摘要」（关键函数行号、分支条件、边界值）
   * 2. 辩论阶段：PM/Engineer 引用摘要而非重复读取文件
   * 3. 仅在事实争议时才重新读取具体行
   *
   * Token 节省：文件读取量从 角色数×轮次×文件数 → 1次（Judge）+ 摘要引用
   */
  private async executeDebate(goal: string, signal?: AbortSignal): Promise<TaskExecutionResult[]> {
    const results: TaskExecutionResult[] = [];
    const members = this.context!.config.members;
    const maxRounds = this.context!.config.maxRounds!;
    const convergenceThreshold = this.context!.config.debateConvergenceThreshold
      ?? DEFAULT_TEAM_CONFIG.debateConvergenceThreshold;

    // 查找 Judge 角色
    const judgeIndex = members.findIndex(m =>
      m.systemPrompt && /\[debate_role:\s*judge\]/i.test(m.systemPrompt)
    );
    const judge = judgeIndex >= 0 ? members[judgeIndex] : null;

    // ─── P1: Judge 预读阶段 ───────────────────────────────
    let factSummary = '';
    if (judge) {
      log.info('Debate: Judge pre-reading phase — collecting key facts before debate');

      const preReadTask = [
        '⚖️ 预读阶段（仅你执行，正反方暂不参与）：',
        '',
        `辩论议题：${goal}`,
        '',
        '你的任务：',
        '1. 读取辩论涉及的所有关键源码文件',
        '2. 提取关键事实：函数签名、核心分支条件、边界值、重要常量',
        '3. 输出一份「事实摘要」，包含：',
        '   - 涉及的关键文件路径',
        '   - 核心函数/方法及行号',
        '   - 关键分支条件和边界值',
        '   - 不涉及观点判断的纯事实数据',
        '',
        '要求：',
        '- 只陈述事实，不做价值判断',
        '- 标注精确行号以便后续引用（如 L42-L58）',
        '- 摘要长度不超过 1500 字',
        '- 格式：[文件路径] → 关键行号 + 事实描述',
        '',
        '此摘要将共享给正反方，避免他们重复读取相同文件。',
      ].join('\n');

      const judgePreReadResult = await this.executeMemberTask(
        judge,
        preReadTask,
        [],
        'debate-preread-judge',
        judgeIndex,
        signal,
      );
      results.push(judgePreReadResult);

      if (judgePreReadResult.success) {
        factSummary = judgePreReadResult.result;
        log.info(`Debate: Judge pre-read complete, fact summary: ${factSummary.length} chars`);
      }
    }

    // ─── 辩论轮次 ─────────────────────────────────────────
    // Bug 6: 追踪连续低新颖度轮次
    let consecutiveLowNoveltyRounds = 0;

    for (let round = 0; round < maxRounds && this.running; round++) {
      if (signal?.aborted) break;

      this.context!.currentRound = round + 1;
      log.info(`Debate round ${round + 1}/${maxRounds}`);

      const roundStartIndex = results.length;

      // 每轮所有成员发言
      for (let memberIndex = 0; memberIndex < members.length; memberIndex++) {
        if (signal?.aborted) break;

        const member = members[memberIndex];

        // 跳过 Judge（仅在预读和最终裁决时发言）
        const isJudge = member.systemPrompt && /\[debate_role:\s*judge\]/i.test(member.systemPrompt);
        if (isJudge) continue;

        // 构造辩论 goal：base goal + Judge 事实摘要 + 回合指令
        // 完整辩论历史由 enrichTaskForMember 的 previousResults 机制注入
        // 先解析角色
        const roleMatch = member.systemPrompt?.match(/\[debate_role:(affirmative|negative|judge)\]/i);
        const roleLabel = roleMatch
          ? ({ affirmative: '正方', negative: '反方', judge: '裁判' }[roleMatch[1].toLowerCase()] || roleMatch[1])
          : member.name || member.id;
        const totalRounds = this.context!.config.maxRounds!;

        let debateGoal = `⚖️ 辩论轮次 ${round + 1}/${totalRounds} —— 你是「${roleLabel}」\n\n当前任务：${goal}`;
        if (factSummary && round === 0) {
          debateGoal += `\n\n[Judge 事实摘要 — 辩论引用基础]:\n${factSummary}\n\n📌 引用代码时请使用摘要中的行号，避免重复读取文件。仅当事摘要不足时再读取具体文件。`;
        }
        if (round >= 1) {
          debateGoal += '\n\n⚠️ 本轮仅回应对方论点 + 补充新证据。禁止重复已陈述的论点。';
        }
        debateGoal += '\n\n⏳ 说明：辩论按顺序进行，你发言完毕后系统会自动轮到下一个成员。**不要使用 sleep 或 task_control 等工具等待其他成员**——直接完成你的发言即可。';

        const result = await this.executeMemberTask(
          member,
          debateGoal,
          results,
          `debate-round-${round + 1}-${member.id}`,
          memberIndex,
          signal,
        );
        results.push(result);
      }

      // Bug 6: 检查本轮论点新颖度（从第 2 轮开始）
      if (round >= 1) {
        const currentRoundResults = results.slice(roundStartIndex);
        const prevRoundStartIndex = results.findIndex(r =>
          r.taskId.startsWith(`debate-round-${round}`)
        );
        if (prevRoundStartIndex >= 0) {
          const prevRoundResults = results.slice(prevRoundStartIndex, roundStartIndex);
          const novelty = this.detectArgumentNovelty(prevRoundResults, currentRoundResults);

          log.info(`Debate round ${round + 1} novelty: ${(novelty * 100).toFixed(0)}%`);

          if (novelty < (1.0 - convergenceThreshold)) {
            consecutiveLowNoveltyRounds++;
            log.info(`Low novelty detected (${consecutiveLowNoveltyRounds} consecutive rounds)`);
          } else {
            consecutiveLowNoveltyRounds = 0;
          }

          const noveltyExtremelyLow = novelty < 0.10;
          const noveltyLowAndDeep = novelty < 0.30 && round >= 2;
          const shouldConverge =
            consecutiveLowNoveltyRounds >= 2 ||
            noveltyExtremelyLow ||
            noveltyLowAndDeep;

          if (shouldConverge) {
            const reason = noveltyExtremelyLow
              ? `extremely low novelty (${(novelty * 100).toFixed(0)}%)`
              : noveltyLowAndDeep
                ? `low novelty in late round (${(novelty * 100).toFixed(0)}%, round ${round + 1})`
                : 'no new arguments for 2 consecutive rounds';
            log.info(`Arguments converged — ${reason}. Triggering early conclusion.`);

            // 找到裁判成员做最终裁决
            if (judge) {
              const debateSummary = results.map(r =>
                `[${r.memberId} R${r.taskId.match(/round-(\d+)/)?.[1] || '?'}]: ${r.result.substring(0, 500)}`
              ).join('\n\n');

              const judgeTask = [
                `辩论已自然收敛——${reason}。`,
                factSummary ? `\n事实摘要（已在辩论前确认）：\n${factSummary}\n` : '',
                `作为裁判，请基于以下辩论记录做出最终裁决：`,
                '',
                debateSummary,
                '',
                '请给出：1) 裁决结论 2) 关键论据摘要 3) 建议的后续行动',
              ].join('\n');

              const judgeResult = await this.executeMemberTask(
                judge,
                judgeTask,
                results,
                `debate-round-${round + 1}-judge-final`,
                members.indexOf(judge),
                signal,
              );
              results.push(judgeResult);
            }

            break;
          }
        }
      }

      // 检查是否达成共识
      const roundResults = results.slice(-members.filter(m =>
        !m.systemPrompt || !/\[debate_role:\s*judge\]/i.test(m.systemPrompt)
      ).length);
      const agreePattern = /(?:^|\s)(agree|consensus|concur|一致|同意|达成共识)(?:\s|[.,!?:;]|$)/i;
      const allAgree = roundResults.length > 0 && roundResults.every(r => agreePattern.test(r.result));

      if (allAgree) {
        log.info('Consensus reached, ending debate');
        break;
      }
    }

    // 辩论结束后自动写入共识文件
    const writeResult = await this.finalizeDebateWithFileWrite(goal, results, members, signal);
    if (writeResult) results.push(writeResult);
    return results;
  }

  /**
   * 辩论结束后自动将共识写入目标文件
   * 提取 goal 中的文件路径，选择 writer（judge 或首成员），执行 write_file
   */
  private async finalizeDebateWithFileWrite(
    goal: string,
    results: TaskExecutionResult[],
    members: TeamMember[],
    signal?: AbortSignal,
  ): Promise<TaskExecutionResult | null> {
    // 检测目标文件路径
    const targetFiles = this.extractFilePathsFromOutput(goal);
    if (targetFiles.length === 0) return null;

    // 选择 writer：优先 judge，其次第一个成员
    const judge = members.find(m =>
      m.systemPrompt && /\[debate_role:\s*judge\]/i.test(m.systemPrompt)
    );
    const writer = judge || members[0];

    // 构建最终合成任务
    const debateSummary = results.map(r =>
      `[${r.memberId} R${r.taskId.match(/round-(\d+)/)?.[1] || '?'}]: ${r.result.substring(0, 600)}`
    ).join('\n\n');

    const writeTask = [
      '辩论已结束，现在作为最终撰稿人，请将达成共识的结论写入以下文件：',
      targetFiles.map(f => `  - ${f}`).join('\n'),
      '',
      '请基于以下辩论记录撰写共识结论：',
      '',
      debateSummary,
      '',
      '要求：',
      '1. 综合各方观点，提炼共识结论',
      '2. 如有分歧，明确指出并给出建议',
      '3. 使用 write_file 将最终结论写入上述文件',
    ].join('\n');

    // 确保 writer 有写文件工具
    const writerWithTools: TeamMember = {
      ...writer,
      tools: writer.tools && writer.tools.length > 0
        ? [...new Set([...writer.tools, 'write_file', 'edit_file'])]
        : ['write_file', 'edit_file'],
    };

    return this.executeMemberTask(
      writerWithTools,
      writeTask,
      results,
      'debate-final-write',
      members.indexOf(writer),
      signal,
    );
  }

  /**
   * 流水线执行策略
   *
   * ⚠️ Pipeline 保持用户定义的原始顺序（不按 priority 排序）
   * 因为流水线的语义是「前一个成员的输出 → 下一个成员的输入」，
   * 用户定义数组的顺序即为流水线阶段顺序。
   *
   * P0-2: 阶段间通过文件传递数据，替代 stdout 字符串拼接，避免大文本导致超时
   */
  private async executePipeline(goal: string, signal?: AbortSignal): Promise<TaskExecutionResult[]> {
    const results: TaskExecutionResult[] = [];
    const members = this.context!.config.members;
    const cwd = this.workingDir;

    // 创建 pipeline 临时目录
    const pipelineDir = path.join(cwd, '.team_pipeline');
    try { fs.mkdirSync(pipelineDir, { recursive: true }); } catch { /* ignore */ }

    let currentInput = goal;

    for (let i = 0; i < members.length; i++) {
      if (!this.running || signal?.aborted) break;
      const member = members[i];

      log.info(`[PIPELINE] >>> 开始执行成员 ${i + 1}/${members.length}: ${member.id} (${member.name || member.agentId}) @ ${Date.now()}`);
      const result = await this.executeMemberTask(member, currentInput, results, undefined, i, signal);
      log.info(`[PIPELINE] <<< 成员 ${i + 1}/${members.length} 完成: ${member.id} success=${result.success} @ ${Date.now()}`);

      // 提取产出文件路径，仅在磁盘验证通过的路径才传播给下游
      if (result.success && result.result) {
        const candidateFiles = this.extractFilePathsFromOutput(result.result);
        const verifiedFiles = candidateFiles.filter(f => {
          try { return fs.existsSync(f); } catch { return false; }
        });
        if (verifiedFiles.length > 0) {
          result.outputFiles = verifiedFiles;
        }
      }

      results.push(result);

      if (!result.success) {
        log.warn(`Pipeline failed at member ${member.id}`);
        break;
      }

      // P0-2: 将当前阶段输出写入临时文件，下游通过读取文件获取数据
      const nextMember = members[i + 1];
      if (nextMember) {
        const stageFile = path.join(pipelineDir, `stage_${i}_${member.id}.txt`);
        try {
          fs.writeFileSync(stageFile, result.result, 'utf-8');
          log.info(`Pipeline stage ${i} output written to ${stageFile} (${result.result.length} chars)`);
        } catch (err) {
          log.warn(`Failed to write pipeline stage output to ${stageFile}:`, err);
        }

        const outputFiles = result.outputFiles || [];
        const fileListParts: string[] = [stageFile, ...outputFiles];
        const fileList = fileListParts.map(f => `  - ${f}`).join('\n');

        // 仅传递简短指令 + 文件路径，下游自行读取文件获取完整数据
        currentInput = [
          `你处于流水线的第 ${i + 2}/${members.length} 阶段。`,
          `前一阶段 "${member.name || member.id}" 已完成工作，产出数据已写入以下文件：`,
          '',
          fileList,
          '',
          `请使用 read_file 工具读取上述文件获取完整数据，然后继续你的工作。`,
          '',
          `原始任务目标：${goal}`,
        ].join('\n');
      } else {
        currentInput = result.result;
      }
    }

    // 清理临时目录
    try {
      fs.rmSync(pipelineDir, { recursive: true, force: true });
    } catch { /* ignore */ }

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
    memberIndex?: number,
    signal?: AbortSignal,
    retryCount: number = 0,
    worktreePath?: string,
    preferGoal: boolean = false,
  ): Promise<TaskExecutionResult> {
    const maxRetries = 1; // 失败后最多重试 1 次
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
        failureCategory: 'timeout',
      };
    }

    // P1-1: Checkpoint 快速恢复 — 如果该成员已有成功的 checkpoint，直接复用
    const recoveredCp = this.recoveredCheckpoints.get(member.id);
    if (recoveredCp?.success && retryCount === 0) {
      log.info(`Recovering ${member.id} from checkpoint (saved at ${new Date(recoveredCp.savedAt || 0).toISOString()})`);
      // 触发 TeamMemberStart → TeamMemberEnd（前端感知一致性）
      const shortResult = recoveredCp.result.substring(0, 200);
      if (this.hookRegistry) {
        const displayName = recoveredCp.memberName || member.id;
        const subAgentId = this.memberSubAgentIds.get(member.id) || `subagent-recovered-${member.id}`;
        this.hookRegistry.emit('TeamMemberStart', {
          teamId: this.teamId,
          data: {
            memberId: member.id,
            subAgentId,
            name: displayName,
            role: member.agentId,
            task: (member.task || task).substring(0, 200),
            agentType: 'temporary',
            executionMode: 'acp',
            strategy: this.context!.config.strategy,
            teamName: this.context!.config.name,
            stepIndex: memberIndex,
            totalSteps: this.context!.config.members.length,
            recovered: true,
          },
        }).catch(() => {});
        eventBus.emit(XuanjiEvent.HOOK_TEAM_MEMBER_START, {
          teamId: this.teamId,
          data: {
            memberId: member.id,
            subAgentId,
            name: displayName,
            role: member.agentId,
            task: (member.task || task).substring(0, 200),
            agentType: 'temporary',
            executionMode: 'acp',
            strategy: this.context!.config.strategy,
            teamName: this.context!.config.name,
            stepIndex: memberIndex,
            totalSteps: this.context!.config.members.length,
            recovered: true,
          },
        });
        this.hookRegistry.emit('TeamMemberEnd', {
          teamId: this.teamId,
          data: {
            memberId: member.id,
            subAgentId,
            memberName: displayName,
            success: true,
            duration: recoveredCp.duration,
            resultSummary: shortResult,
            result: recoveredCp.result,
            tokensUsed: recoveredCp.tokensUsed,
            strategy: this.context!.config.strategy,
            teamName: this.context!.config.name,
            recovered: true,
          },
        }).catch(() => {});
        eventBus.emit(XuanjiEvent.HOOK_TEAM_MEMBER_END, {
          teamId: this.teamId,
          data: {
            memberId: member.id,
            subAgentId,
            success: true,
            duration: recoveredCp.duration,
            resultSummary: shortResult,
            teamName: this.context!.config.name,
            recovered: true,
          },
        });
      }
      return { ...recoveredCp, taskId: tid };
    }

    // 标准化 agent ID（自动修正，只调用一次）
    const normalizedAgentId = this.normalizeAgentId(member.agentId, member.id);

    // 从 AgentRegistry 获取 Agent 配置
    const agentConfig = this.agentRegistry.get(normalizedAgentId);
    // 显示名称：预设 agent 优先用注册表名称，临时 agent 用 LLM 提供的名称
    const displayName = agentConfig?.name || member.name || member.id;

    // 使用 TeamStart 时预生成的 subAgentId，确保前后端 ID 一致
    const subAgentId = this.memberSubAgentIds.get(member.id) || `subagent-${normalizedAgentId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    // 触发 TeamMemberStart Hook
    if (this.hookRegistry) {
      const category = agentConfig?.metadata?.category || 'custom';

      // 判断 Agent 类型
      let agentType: 'preset' | 'builtin' | 'custom' | 'temporary';
      if (agentConfig) {
        if (category === 'system') {
          agentType = 'builtin';
        } else if (category === 'app') {
          agentType = 'preset';
        } else {
          agentType = 'custom';
        }
      } else {
        agentType = 'temporary'; // 临时 agent（未注册）
      }

      // 解析辩论角色（正方/反方/裁判）
      let debateRole: 'affirmative' | 'negative' | 'judge' | undefined;
      if (member.systemPrompt) {
        const roleMatch = member.systemPrompt.match(/\[debate_role:(affirmative|negative|judge)\]/i);
        if (roleMatch) {
          debateRole = roleMatch[1].toLowerCase() as 'affirmative' | 'negative' | 'judge';
        }
      }

      // 辩论模式：在 task 中标注角色，使前端思考气泡能区分正反方
      const roleLabels: Record<string, string> = { affirmative: '正方', negative: '反方', judge: '裁判' };
      const displayTask = (() => {
        const base = (member.task || task).substring(0, 200);
        if (debateRole && roleLabels[debateRole]) {
          return `${roleLabels[debateRole]}·${base}`;
        }
        return base;
      })();

      log.info(`[PIPELINE] --- TeamMemberStart 发射: memberId=${member.id}, subAgentId=${subAgentId}, name=${displayName} @ ${Date.now()}`);
      this.hookRegistry.emit('TeamMemberStart', {
        teamId: this.teamId,
        data: {
          memberId: member.id,
          subAgentId,  // 🆕 预生成的 subAgentId，前端用于创建 agent 节点和匹配 timeline 事件
          name: displayName,
          role: normalizedAgentId, // 使用标准化后的 agent ID
          task: displayTask,  // 🆕 辩论模式带角色前缀，便于前端区分正反方
          agentType, // 新增：详细的 agent 类型
          scene: member.scene?.replace(/^l[12]-/, ''),    // 🆕 场景类型（剥离 l1-/l2- 前缀用于前端展示）
          executionMode: 'acp',
          // 策略和团队信息
          strategy: this.context!.config.strategy,
          teamName: this.context!.config.name,
          stepIndex: memberIndex,
          totalSteps: this.context!.config.members.length,
          // 辩论轮次信息（Debate 策略专用）
          currentRound: this.context!.currentRound,
          maxRounds: this.context!.config.maxRounds,
          // 辩论角色（后端解析，前端直接使用）
          debateRole,
          // systemPrompt 前 100 字符（用于 GUI 调试）
          systemPromptHint: member.systemPrompt?.substring(0, 100),
        },
      }).catch((err) => {
        log.debug('TeamMemberStart hook emit failed:', err);
      });

      // 通过 EventBus 发送团队成员启动事件
      eventBus.emit(XuanjiEvent.HOOK_TEAM_MEMBER_START, {
        teamId: this.teamId,
        data: {
          memberId: member.id,
          subAgentId,
          name: displayName,
          role: normalizedAgentId,
          task: displayTask,
          agentType,
          scene: member.scene?.replace(/^l[12]-/, ''),
          executionMode: 'acp',
          strategy: this.context!.config.strategy,
          teamName: this.context!.config.name,
          stepIndex: memberIndex,
          totalSteps: this.context!.config.members.length,
          currentRound: this.context!.currentRound,
          maxRounds: this.context!.config.maxRounds,
          debateRole,
          systemPromptHint: member.systemPrompt?.substring(0, 100),
        },
      });
    }

    try {
      // 构建成员特定的任务描述（enrichTaskForMember 负责注入前序结果）
      const enrichedTask = this.enrichTaskForMember(member, task, previousResults, preferGoal);

      let result: SubAgentResult;

      // 执行子代理（使用 calculateMemberTimeout 计算超时）
      const memberTimeout = this.calculateMemberTimeout(member, memberIndex);

      // 保存当前 cwd，成员执行完毕后恢复（防止 change_directory 全局副作用）
      // P1-2: 如果有 worktree，让成员在隔离的工作区执行
      const savedCwd = worktreePath || this.workingDir;

      // 使用成员配置的工具集（如果未配置，默认不注入任何额外工具）
      // 各策略按需配置 tools 参数，系统不代为判断
      const effectiveTools = member.tools && member.tools.length > 0
        ? member.tools
        : undefined;

      const factoryResult = await this.agentFactory.createAndRun(normalizedAgentId, {
        task: enrichedTask,
        depth: this.depth + 1,
        timeout: memberTimeout,
        parentConfig: this.agentConfig,
        systemPrompt: member.systemPrompt,
        scene: member.scene,
        scenes: member.scenes,
        scenePrompt: member.scenePrompt,
        tools: effectiveTools,
        skipSubAgentStartHook: true,
        parentAgentId: this.teamId,
        workingDir: savedCwd,
        subAgentId,  // 🆕 传入预生成的 subAgentId，确保与 TeamMemberStart 一致
      }, signal);

      // 恢复 cwd，避免成员间的全局副作用
      try {
        process.chdir(savedCwd);
      } catch (e) {
        log.warn(`Failed to restore cwd to ${savedCwd}:`, e);
      }

      result = {
        result: factoryResult.result,
        tokensUsed: factoryResult.tokensUsed,
        duration: factoryResult.duration,
        timedOut: factoryResult.timedOut,
        iterations: factoryResult.iterations,
        success: factoryResult.success,
      };

      const executionResult: TaskExecutionResult = {
        taskId: tid,
        memberId: member.id,
        memberName: displayName,
        result: result.result,
        success: result.success,
        duration: result.duration,
        tokensUsed: result.tokensUsed,
        retryCount,
      };

      // 触发 TeamMemberEnd Hook
      if (this.hookRegistry) {
        this.hookRegistry.emit('TeamMemberEnd', {
          teamId: this.teamId,
          data: {
            memberId: member.id,
            subAgentId,
            memberName: displayName,
            success: executionResult.success,
            duration: executionResult.duration,
            resultSummary: executionResult.result.substring(0, 200),
            result: executionResult.result,
            tokensUsed: executionResult.tokensUsed,
            strategy: this.context!.config.strategy,
            teamName: this.context!.config.name,
            retryCount,
            failureReason: !executionResult.success
              ? (result.timedOut ? 'timeout' : this.classifyFailure(executionResult, this.context!.config.strategy))
              : undefined,
            error: executionResult.error,
          },
        }).catch((err) => {
          log.debug('TeamMemberEnd hook emit failed:', err);
        });
      }

      // 通过 EventBus 发送团队成员结束事件
      eventBus.emit(XuanjiEvent.HOOK_TEAM_MEMBER_END, {
        teamId: this.teamId,
        data: {
          memberId: member.id,
          subAgentId,
          success: executionResult.success,
          duration: executionResult.duration,
          resultSummary: executionResult.result.substring(0, 200),
          teamName: this.context!.config.name,
          retryCount,
          failureReason: !executionResult.success
            ? (result.timedOut ? 'timeout' : this.classifyFailure(executionResult, this.context!.config.strategy))
            : undefined,
        },
      });

      // P1-1: 保存 checkpoint — 成功或失败都保存，防止超时丢失已完成工作
      this.saveCheckpoint(member.id, executionResult);

      // 🔧 失败重试：在团队内部对失败成员重试一次，避免整个 agent_team 重建
      if (!executionResult.success && retryCount < maxRetries && !signal?.aborted) {
        log.warn(
          `Team member "${displayName}" failed (attempt ${retryCount + 1}), ` +
          `retrying within team (${retryCount + 1}/${maxRetries})...`
        );
        return this.executeMemberTask(
          member, task, previousResults, taskId, memberIndex, signal, retryCount + 1, worktreePath
        );
      }

      // Bug 5: 为失败结果添加分类
      if (!executionResult.success && !executionResult.failureCategory) {
        executionResult.failureCategory = this.classifyFailure(executionResult, this.context!.config.strategy);
      }

      return executionResult;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errMsg = error instanceof Error ? error.message : String(error);

      // 🔧 异常重试：捕获异常后重试一次
      if (retryCount < maxRetries && !signal?.aborted) {
        log.warn(
          `Team member "${displayName}" threw exception (attempt ${retryCount + 1}): ${errMsg}, ` +
          `retrying within team (${retryCount + 1}/${maxRetries})...`
        );
        // 发射失败事件的 hook（前端感知到第一次失败）
        if (this.hookRegistry) {
          this.hookRegistry.emit('TeamMemberEnd', {
            teamId: this.teamId,
            data: {
              subAgentId,
              memberId: member.id,
              memberName: displayName,
              success: false,
              duration,
              resultSummary: errMsg.substring(0, 200),
              result: '',
              tokensUsed: { input: 0, output: 0 },
              strategy: this.context!.config.strategy,
              teamName: this.context!.config.name,
              retryCount,
              failureReason: signal?.aborted ? 'aborted' : 'exception',
              error: errMsg,
            },
          }).catch((hookErr) => {
            log.debug('TeamMemberEnd hook emit failed:', hookErr);
          });
        }

        // 通过 EventBus 发送团队成员结束事件（异常/失败）
        eventBus.emit(XuanjiEvent.HOOK_TEAM_MEMBER_END, {
          teamId: this.teamId,
          data: {
            memberId: member.id,
            subAgentId,
            success: false,
            duration,
            resultSummary: errMsg.substring(0, 200),
            teamName: this.context!.config.name,
            retryCount,
            failureReason: signal?.aborted ? 'aborted' : 'exception',
          },
        });
        return this.executeMemberTask(
          member, task, previousResults, taskId, memberIndex, signal, retryCount + 1, worktreePath
        );
      }

      const failureResult: TaskExecutionResult = {
        taskId: tid,
        memberId: member.id,
        result: '',
        success: false,
        duration,
        tokensUsed: { input: 0, output: 0 },
        error: errMsg,
        retryCount,
      };
      failureResult.failureCategory = this.classifyFailure(failureResult, this.context!.config.strategy);
      return failureResult;
    }
  }

  /**
   * 为成员增强任务描述
   * @param preferGoal 为 true 时 goal 优先（层级模式 Leader 已分配独立任务），否则 member.task 优先
   */
  private enrichTaskForMember(
    member: TeamMember,
    goal: string,
    previousResults: TaskExecutionResult[],
    preferGoal: boolean = false,
  ): string {
    const strategy = this.context!.config.strategy;
    const memberCount = this.context!.config.members.length;
    const memberIndex = previousResults.length; // 已完成的成员数 = 当前成员的序号

    // 层级模式：Leader 已为每个成员分配独立任务（goal 即独立任务），member.task 仅作角色参考
    let enriched: string;
    if (member.task && !preferGoal) {
      enriched = `${member.task}\n\n团队目标上下文：${goal}`;
    } else if (member.task && preferGoal) {
      enriched = `${goal}\n\n团队成员角色：${member.task}`;
    } else {
      enriched = goal;
    }

    // 🔧 强制使用绝对路径（彻底解决相对路径问题）
    const cwd = this.workingDir;
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

    // 🔧 注入前序成员的结果，实现团队内数据传递（Sequential/Pipeline/Hierarchical）
    const successResults = previousResults.filter(r => r.success);
    if (successResults.length > 0) {
      const strategyLabel = strategy === 'pipeline'
        ? 'Pipeline — the previous stage output is your input. You MUST process it and produce the next stage result.'
        : strategy === 'sequential'
          ? `Sequential (Step ${memberIndex + 1}/${memberCount}) — the previous members have completed their work. You MUST build on their outputs.`
          : strategy === 'debate'
            ? '=== 完整辩论记录 ==='
            : 'The following outputs from previous team members provide context for your work.';

      // debate 策略不截断，完整注入；pipeline/sequential 扩大到 8000；其他截断到 5000
      const isDebate = strategy === 'debate';
      const truncateLimit = isDebate ? Infinity : (strategy === 'pipeline' || strategy === 'sequential') ? 8000 : 5000;

      const prevContext = successResults
        .map((r, resultIdx) => {
          const name = r.memberName || r.memberId;
          const truncated = isDebate ? r.result : this.smartTruncate(r.result, truncateLimit);
          // debate 模式：加角色标签；debate 下不过块引用
          let formatted: string;
          if (isDebate) {
            const label = this.formatDebateSpeakerLabel(name, r.memberId);
            formatted = `[${label}]:\n${truncated}`;
          } else {
            // Bug 4: 为大型输出添加块引用 ID
            if (r.result.length > 2000) {
              const chunks: string[] = [];
              for (let ci = 0; ci < r.result.length; ci += 2000) {
                const chunk = r.result.substring(ci, ci + 2000);
                chunks.push(`[ref:${r.memberId}_p${Math.floor(ci / 2000)}]\n${chunk}`);
              }
              return `[${name}]:\n${chunks.join('\n---\n')}${r.result.length > truncateLimit ? `\n...[total ${r.result.length} chars, ${chunks.length} ref blocks]` : ''}`;
            }
            formatted = `[${name}]:\n${truncated}${r.result.length > truncateLimit ? `\n...[truncated, total ${r.result.length} chars]` : ''}`;
          }
          return formatted;
        })
        .join('\n\n---\n\n');

      // Bug 4: 添加引用说明
      const quotingNote = successResults.some(r => r.result.length > 2000)
        ? '\n💡 引用队友输出时请使用 ref ID（如 "如 [ref:architect_p2] 所述"）进行精确引用。\n'
        : '';

      // Bug 8: 提取前序成员产出的文件路径，仅传播磁盘上实际存在的路径
      const existingFiles: string[] = [];
      for (const r of successResults) {
        const files = r.outputFiles || this.extractFilePathsFromOutput(r.result);
        for (const f of files) {
          if (existingFiles.includes(f)) continue;
          try {
            if (fs.existsSync(f)) {
              existingFiles.push(f);
            }
          } catch {
            // 权限错误等，跳过
          }
        }
      }

      let fileContextSection = '';
      if (existingFiles.length > 0) {
        fileContextSection = `\n[前序成员产出的文件]:\n${existingFiles.map(f => `  - ${f}`).join('\n')}\n`;
      }

      const trailingInstruction = isDebate
        ? 'Based on the debate above, continue your argument. Do NOT repeat your own previous points.'
        : 'Based on the above outputs, continue your work. Do NOT repeat work already done by previous members.';

      enriched += `\n\n========================================\nIMPORTANT — Previous Team Members' Outputs\n========================================\n${strategyLabel}\n${quotingNote}${fileContextSection}\n${prevContext}\n========================================\n\n${trailingInstruction}`;
    }

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

      case 'debate': {
        // 按轮次分组，返回所有轮次的完整辩论记录
        const memberCount = this.context!.config.members.length;
        const rounds: string[] = [];
        for (let i = 0; i < results.length; i += memberCount) {
          const roundNum = Math.floor(i / memberCount) + 1;
          const roundResults = results.slice(i, i + memberCount);
          rounds.push(
            `[Round ${roundNum}]\n${roundResults.map(r => `${r.memberId}: ${r.result}`).join('\n\n')}`
          );
        }
        return [
          `[Debate Summary — ${rounds.length} rounds]`,
          ...rounds,
        ].join('\n\n---\n\n');
      }

      default:
        return results.map(r => r.result).join('\n\n');
    }
  }

  /**
   * 为团队计算合适的总超时时间
   * 🔧 根据策略和轮次动态调整
   */
  /**
   * 为团队计算合适的总超时时间
   *
   * 🔧 P2 优化：基于审计数据的策略特定公式
   * Debate       = 1,800,000ms × roundFactor（固定，因为有轮次）
   * Hierarchical = 600,000ms + 300,000ms × Worker数
   * Parallel     = 600,000ms + 200,000ms × (成员数-1)
   * Sequential   = 300,000ms + 100,000ms × (阶段数-1)
   * Pipeline     = 300,000ms + 150,000ms × (阶段数-1)
   */
  private calculateTeamTimeout(): number {
    const config = this.context!.config;

    const strategy = config.strategy;
    const memberCount = config.members.length;

    // 策略基础超时（ms）
    const baseTimeouts: Record<string, number> = {
      debate:       1_800_000,
      hierarchical: 600_000 + 300_000 * Math.max(0, memberCount - 1),
      parallel:     600_000 + 200_000 * Math.max(0, memberCount - 1),
      sequential:   300_000 + 100_000 * Math.max(0, memberCount - 1),
      pipeline:     300_000 + 150_000 * Math.max(0, memberCount - 1),
    };

    let dynamicTimeout = baseTimeouts[strategy] ?? 600_000;

    // 辩论轮次因子
    if (strategy === 'debate') {
      const maxRounds = config.maxRounds || 3;
      const roundFactors: Record<number, number> = { 2: 1.0, 3: 1.5, 4: 2.0, 5: 3.0 };
      const roundFactor = roundFactors[maxRounds] ?? 1.5;
      dynamicTimeout = Math.floor(dynamicTimeout * roundFactor);
    }

    // 复杂度因子（基于 goal 内容估算）
    const complexity = this.estimateTaskComplexity(config.goal, []);
    dynamicTimeout = Math.floor(dynamicTimeout * complexity);

    // 显式设置的 teamTotalTimeout 优先
    if (config.teamTotalTimeout && config.teamTotalTimeout > dynamicTimeout) {
      return config.teamTotalTimeout;
    }

    return dynamicTimeout;
  }

  /**
   * 为成员计算合适的子代理超时
   *
   * 优先级：
   * 1. member.timeout（成员显式设置）
   * 2. 基于策略权重 + 任务复杂度自动计算
   * 3. config.memberTimeoutMs（团队级统一超时兜底）
   *
   * P2 优化 — 复杂度因子：
   *   简单任务（纯函数测试）= 1.0
   *   中等任务（含 mock）= 1.5
   *   复杂任务（页面测试含交互）= 2.0
   *   极复杂（含 fakeTimers/异步）= 2.5
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

    // Bug 3: pipeline/sequential 最小超时从 30s 提升到 60s
    const effectiveMinTimeout = (strategy === 'pipeline' || strategy === 'sequential')
      ? Math.max(MIN_TIMEOUT, 60_000)
      : MIN_TIMEOUT;

    // Bug 3: 估算任务复杂度
    const taskForEstimation = member.task || this.context!.config.goal;
    const complexity = this.estimateTaskComplexity(taskForEstimation, member.capabilities);

    let perMemberTimeout: number;

    switch (strategy) {
      case 'parallel':
        // 并行：每个成员独享完整的基准超时
        perMemberTimeout = baseTimeout;
        break;

      case 'sequential': {
        // 顺序执行：后续成员需要更多时间（需处理前序输出），权重递增
        if (memberIndex !== undefined) {
          // 第 1 个成员 0.9x（无前序上下文），最后 1.4x（处理所有前序输出）
          const weight = 0.9 + (memberIndex / Math.max(memberCount - 1, 1)) * 0.5;
          perMemberTimeout = Math.floor(baseTimeout * weight * complexity);
        } else {
          perMemberTimeout = Math.floor(baseTimeout * complexity);
        }
        break;
      }

      case 'hierarchical': {
        // 🔧 层级执行：按优先级排序后，第一个是 Leader
        // 与 validateTeamConfig 对齐：priority > 0 即为 leader
        const isLeader = member.priority != null && member.priority > 0;
        const leaderRatio = config.hierarchicalLeaderRatio ?? DEFAULT_TEAM_CONFIG.hierarchicalLeaderRatio;

        if (isLeader) {
          // Leader 获得 leaderRatio 倍的基准超时（默认 1.5x）
          // Leader 需要规划和协调，需要更多时间
          perMemberTimeout = Math.floor(baseTimeout * leaderRatio * complexity);
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

          perMemberTimeout = Math.floor(baseTimeout * workerRatio * complexity);
        }
        break;
      }

      case 'debate': {
        // 🔧 辩论：根据轮次、成员数和角色动态计算超时
        const currentRound = this.context!.currentRound || 1;
        const maxRounds = config.maxRounds || 5;
        const memberCount = config.members.length;
        const firstRoundRatio = config.debateFirstRoundRatio ?? DEFAULT_TEAM_CONFIG.debateFirstRoundRatio;
        const laterRoundRatio = config.debateLaterRoundRatio ?? DEFAULT_TEAM_CONFIG.debateLaterRoundRatio;

        // 🔧 成员数缩放因子：人数越多，每人分配的时间越少
        // 2人→1.0, 3人→0.67, 4人→0.5, 5人→0.4
        const memberScaleFactor = Math.max(0.4, 2.0 / Math.max(memberCount, 2));
        const basePerMember = Math.floor(baseTimeout * memberScaleFactor);

        // 🔧 轮次阶段倍率
        let roundRatio: number;
        if (currentRound === 1) {
          roundRatio = firstRoundRatio; // 首轮开场陈述 1.5x
        } else if (currentRound === maxRounds) {
          roundRatio = firstRoundRatio * 1.2; // 末轮总结陈词 1.8x
        } else {
          roundRatio = laterRoundRatio; // 中间轮辩论交锋 1.0x
        }

        // 🔧 角色倍率（裁判需要更多时间评估）
        let roleRatio = 1.0;
        if (member.systemPrompt) {
          const roleMatch = member.systemPrompt.match(/\[debate_role:(affirmative|negative|judge)\]/i);
          if (roleMatch && roleMatch[1].toLowerCase() === 'judge') {
            roleRatio = 1.3;
          }
        }

        perMemberTimeout = Math.floor(basePerMember * roundRatio * roleRatio * complexity);

        // 辩论发言至少 minMemberTimeout（默认 30s），辩论需要足够思考时间
        perMemberTimeout = Math.max(perMemberTimeout, MIN_TIMEOUT * 2);
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
          // 最后一个阶段（输出）：检测到报告/文档生成时 1.3x，否则 1.0x
          else if (memberIndex === memberCount - 1) {
            const isReportGeneration = /report|报告|html|document|chart|visualization|图表|看板|dashboard/i
              .test(taskForEstimation);
            weight = isReportGeneration ? 1.3 : 1.0;
          }
          // 中间阶段（处理）：1.0x

          perMemberTimeout = Math.floor(baseTimeout * weight * complexity);
        } else {
          perMemberTimeout = Math.floor(baseTimeout * complexity);
        }
        break;
      }

      default:
        perMemberTimeout = Math.floor(baseTimeout * complexity);
    }

    // 🆕 优先级 3: 团队级统一超时（作为兜底或上限）
    if (config.memberTimeoutMs) {
      // 如果设置了统一超时，取两者较小值（避免超出预算）
      perMemberTimeout = Math.min(perMemberTimeout, config.memberTimeoutMs);
    }

    const result = Math.max(perMemberTimeout, effectiveMinTimeout);
    log.debug(
      `[${member.id}] calculated timeout: ${result}ms ` +
      `(strategy=${strategy}, baseTimeout=${baseTimeout}ms, members=${memberCount}, index=${memberIndex ?? 'N/A'}, complexity=${complexity.toFixed(2)})`
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

    log.debug(`[Team Timeout Allocation]`);
    log.debug(`  Strategy: ${strategy}`);
    log.debug(`  Members: ${members.length}`);
    log.debug(`  🆕 Team Total Timeout: ${config.teamTotalTimeout ?? DEFAULT_TEAM_CONFIG.teamTotalTimeout}ms (${((config.teamTotalTimeout ?? DEFAULT_TEAM_CONFIG.teamTotalTimeout) / 1000).toFixed(0)}s)`);
    log.debug(`  Default Member Timeout: ${config.defaultMemberTimeout ?? DEFAULT_TEAM_CONFIG.defaultMemberTimeout}ms`);

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

      log.debug(`    - ${label}${priorityInfo}: ${timeout}ms (${(timeout / 1000).toFixed(0)}s)${timeoutSource}${warningMark}`);

      // 累计预估总超时（根据策略）
      if (strategy === 'parallel') {
        estimatedTotal = Math.max(estimatedTotal, timeout);
      } else {
        estimatedTotal += timeout;
      }
    });

    // 显示预估总超时
    log.debug(`  Estimated Total: ${estimatedTotal}ms (${(estimatedTotal / 1000).toFixed(0)}s)`);

    // 策略特定的额外信息
    if (strategy === 'hierarchical') {
      const ratio = config.hierarchicalLeaderRatio ?? DEFAULT_TEAM_CONFIG.hierarchicalLeaderRatio;
      log.debug(`  Hierarchical Leader Ratio: ${(ratio * 100).toFixed(0)}%`);
    } else if (strategy === 'debate') {
      // 辩论策略：展示完整的超时分配方案
      const maxRounds = config.maxRounds ?? 5;
      const memberCount = config.members.length;
      const firstRoundRatio = config.debateFirstRoundRatio ?? DEFAULT_TEAM_CONFIG.debateFirstRoundRatio;
      const laterRoundRatio = config.debateLaterRoundRatio ?? DEFAULT_TEAM_CONFIG.debateLaterRoundRatio;
      const memberScaleFactor = Math.max(0.4, 2.0 / Math.max(memberCount, 2));
      const defaultMemberTimeout = config.defaultMemberTimeout ?? DEFAULT_TEAM_CONFIG.defaultMemberTimeout;
      const basePerMember = Math.floor(defaultMemberTimeout * memberScaleFactor);

      log.debug(`  Debate Timeout Plan:`);
      log.debug(`    Members: ${memberCount}, Max Rounds: ${maxRounds}`);
      log.debug(`    Member Scale Factor: ${(memberScaleFactor * 100).toFixed(0)}% (${(basePerMember / 1000).toFixed(0)}s base per member)`);

      let planTotal = 0;
      for (let round = 1; round <= maxRounds; round++) {
        let roundRatio: number;
        let phaseLabel: string;
        if (round === 1) {
          roundRatio = firstRoundRatio;
          phaseLabel = '开场陈述';
        } else if (round === maxRounds) {
          roundRatio = firstRoundRatio * 1.2;
          phaseLabel = '总结陈词';
        } else {
          roundRatio = laterRoundRatio;
          phaseLabel = '辩论交锋';
        }
        const perMemberMs = Math.floor(basePerMember * roundRatio);
        const roundTotal = perMemberMs * memberCount;
        planTotal += roundTotal;
        log.debug(`    Round ${round}/${maxRounds} [${phaseLabel}]: ${(perMemberMs / 1000).toFixed(0)}s/人 × ${memberCount}人 = ${(roundTotal / 1000).toFixed(0)}s`);
      }
      log.debug(`    Plan Total: ${(planTotal / 1000).toFixed(0)}s, With Buffer: ${(planTotal * 1.2 / 1000).toFixed(0)}s`);
    }
  }

  // ─── Bug 修复：新增工具方法 ─────────────────────────────

  /**
   * 从成员输出中提取文件路径（Bug 1 & Bug 8）
   * 匹配绝对路径、write_file 调用、Created/Writing to 模式
   */
  private extractFilePathsFromOutput(output: string): string[] {
    const paths = new Set<string>();
    const cwd = this.workingDir;

    // 1. 绝对路径（以 cwd 开头）
    const absPathRegex = new RegExp(
      `${cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^\\s"'\`)*]+`,
      'g'
    );
    for (const match of output.matchAll(absPathRegex)) {
      paths.add(match[0]);
    }

    // 2. write_file / Write / Edit 工具调用中的路径
    const toolPathRegex = /(?:write_file|Write|Edit|Bash)\s*[：(]\s*["'`]?([^\s"'`\n)]+)/gi;
    for (const match of output.matchAll(toolPathRegex)) {
      let p = match[1];
      // 相对路径 → 转为绝对路径
      if (!path.isAbsolute(p)) {
        p = path.resolve(cwd, p);
      }
      paths.add(p);
    }

    // 3. "Created file" / "Writing to" / "输出到" 等模式
    const createdRegex = /(?:Created|Writing to|输出到|写入|saved to)\s+["'`]?([^\s"'`\n]+)/gi;
    for (const match of output.matchAll(createdRegex)) {
      let p = match[1];
      if (!path.isAbsolute(p)) {
        p = path.resolve(cwd, p);
      }
      paths.add(p);
    }

    return Array.from(paths);
  }

  /**
   * 智能截断：保留摘要 + 工具调用 + 结论（Bug 2）
   */
  private smartTruncate(output: string, maxLen: number): string {
    if (output.length <= maxLen) return output;

    const introLen = Math.min(800, Math.floor(maxLen * 0.3));
    const conclusionLen = Math.min(500, Math.floor(maxLen * 0.2));
    const middleLen = maxLen - introLen - conclusionLen - 100; // 100 给分隔符

    const intro = output.substring(0, introLen);

    // 提取工具调用行（write_file, Edit, Bash 等）
    const toolLines: string[] = [];
    const toolPattern = /^.*?\b(?:write_file|Write|Edit|Bash|Glob|Grep|Read)\s*[：(].*$/gm;
    for (const match of output.matchAll(toolPattern)) {
      if (toolLines.join('\n').length + match[0].length < middleLen) {
        toolLines.push(match[0].trim());
      }
    }

    const conclusion = output.substring(output.length - conclusionLen);

    const parts = [intro];
    if (toolLines.length > 0) {
      parts.push(`\n\n...[${toolLines.length} tool calls preserved]...\n`);
      parts.push(toolLines.join('\n'));
    } else {
      parts.push(`\n\n...[${output.length - introLen - conclusionLen} chars omitted]...\n`);
    }
    parts.push(`\n\n...[conclusion]...\n`);
    parts.push(conclusion);

    return parts.join('');
  }

  /**
   * 为辩论成员添加角色标签
   */
  private formatDebateSpeakerLabel(name: string, memberId: string): string {
    const members = this.context?.config.members || [];
    const member = members.find(m => m.id === memberId);
    if (member?.systemPrompt) {
      const rm = member.systemPrompt.match(/\[debate_role:(affirmative|negative|judge)\]/i);
      if (rm) {
        const labels: Record<string, string> = { affirmative: '正方', negative: '反方', judge: '裁判' };
        return `${labels[rm[1].toLowerCase()] || rm[1]} (${name})`;
      }
    }
    return name;
  }

  /**
   * 估算任务复杂度（Bug 3 / P2-6 增强）
   * 返回 0.8x - 1.8x 的倍率，更细粒度地反映任务实际成本
   */
  private estimateTaskComplexity(task: string, capabilities: string[]): number {
    let complexity = 1.0;

    // 任务长度（分段更细）
    if (task.length > 2000) complexity += 0.25;
    else if (task.length > 1000) complexity += 0.2;
    else if (task.length > 500) complexity += 0.1;

    // 高复杂度关键词（需要大量代码生成/重构）
    const criticalComplexityWords = /full.*(?:app|application|project|system)|整套|完整.*(?:系统|应用|项目)|from scratch|all.*(?:endpoints?|routes?|components?|pages?)/i;
    const highComplexityWords = /implement|create|refactor|build|develop|rewrite|migrate|重构|实现|创建|开发|迁移|搭建/i;
    const mediumComplexityWords = /write|generate|produce|test|debug|fix|optimize|编写|生成|测试|调试|修复|优化/i;
    const analysisWords = /analyze|review|audit|inspect|check|examine|分析|审查|审计|检查|评估|探索/i;

    // V3: 辩论/裁决/多轮讨论 — 涉及深度代码级分析和多轮论证
    const debateWords = /debate|辩论|裁决|judge|verdict|ruling|正方|反方|裁判|多轮|共识|consensus|argument|argue|rebut|反驳|裁定|终审/i;
    // V3: 代码级验证 — 逐行审查、跨文件追踪、引用验证
    const deepAnalysisWords = /逐行|逐文件|代码级|code.level|跨文件|cross.file|引用.*验证|fact.check|事实核查|源码.*验证|track.*down|trace/i;

    if (criticalComplexityWords.test(task)) complexity += 0.4;
    else if (highComplexityWords.test(task)) complexity += 0.2;
    else if (mediumComplexityWords.test(task)) complexity += 0.1;
    else if (analysisWords.test(task)) complexity += 0.05;

    // V3: 辩论场景 — 涉及多轮论证和角色扮演，与上述分支叠加
    if (debateWords.test(task)) complexity += 0.25;
    if (deepAnalysisWords.test(task)) complexity += 0.15;

    // 检测 debate_role 标记（affirmative/negative/judge）— 辩论必涉及深度分析
    if (/\[debate_role:/i.test(task)) complexity += 0.15;

    // 能力数量（细化上限）
    if (capabilities.length > 0) {
      complexity += Math.min(capabilities.length * 0.06, 0.25);
    }

    // 文件引用计数（按扩展名分组，更准确反映工作量）
    const fileRefs = (task.match(/\/[^\s"'`]*\.[a-zA-Z]+/g) || []).length;
    if (fileRefs > 10) complexity += 0.25;
    else if (fileRefs > 5) complexity += 0.15;
    else if (fileRefs > 2) complexity += 0.08;

    // 输出格式要求（报告、文档等需要更长思考）
    if (/report|报告|document|文档|visualization|图表|chart/i.test(task)) {
      complexity += 0.1;
    }

    // 涉及外部 API / 数据库操作
    if (/api|fetch|axios|http|database|db|sql|数据库|接口/i.test(task)) {
      complexity += 0.1;
    }

    return Math.max(0.8, Math.min(1.8, complexity));
  }

  /**
   * 检测论点新颖度（Bug 6）
   * 返回 0-1 之间的值，1 表示完全新颖，0 表示完全重复
   */
  private detectArgumentNovelty(
    prevRound: TaskExecutionResult[],
    currentRound: TaskExecutionResult[],
  ): number {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
      'before', 'after', 'above', 'below', 'between', 'under', 'again',
      'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
      'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
      'such', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
      'because', 'but', 'and', 'or', 'if', 'while', 'although', 'though',
      'this', 'that', 'these', 'those', 'it', 'its', 'we', 'you', 'they',
      'i', 'my', 'your', 'our', 'their', 'not', 'also', 'about', 'what',
      'which', 'who', '使用', '可以', '通过', '一个', '这个', '需要', '我们',
      '应该', '能够', '进行', '以及', '并且', '或者', '但是', '因为', '所以',
    ]);

    const getSignificantWords = (text: string): Set<string> => {
      const words = text.toLowerCase().split(/[\s,.;:!?()\[\]{}"'`\n\r\t]+/);
      return new Set(
        words.filter(w => w.length > 2 && !stopWords.has(w))
      );
    };

    const prevWords = getSignificantWords(prevRound.map(r => r.result).join(' '));
    const currWords = getSignificantWords(currentRound.map(r => r.result).join(' '));

    if (prevWords.size === 0 && currWords.size === 0) return 1.0;

    const intersection = new Set([...prevWords].filter(w => currWords.has(w)));
    const union = new Set([...prevWords, ...currWords]);

    const jaccard = intersection.size / union.size;
    return 1.0 - jaccard; // 新颖度 = 1 - 相似度
  }

  /**
   * 等待 Leader 产出的文件就绪（Bug 7）
   */
  private async waitForLeaderFiles(output: string): Promise<void> {
    const filePaths = this.extractFilePathsFromOutput(output);

    if (filePaths.length === 0) {
      // 无文件产出，给予 500ms 缓冲确保 fsync
      await new Promise(resolve => setTimeout(resolve, 500));
      return;
    }

    log.info(`Hierarchical: Waiting for ${filePaths.length} leader-produced files to be ready...`);

    const MAX_WAIT_MS = 5000;
    const CHECK_INTERVAL_MS = 200;
    const startTime = Date.now();

    for (const filePath of filePaths) {
      while (Date.now() - startTime < MAX_WAIT_MS) {
        try {
          if (fs.existsSync(filePath)) {
            log.info(`  ✓ File ready: ${filePath}`);
            break;
          }
        } catch {
          // 权限错误等，继续等待
        }
        await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
      }

      if (Date.now() - startTime >= MAX_WAIT_MS) {
        log.warn(`  ⚠️ File not ready after ${MAX_WAIT_MS}ms: ${filePath}. Workers will proceed anyway.`);
      }
    }

    // 额外 500ms 缓冲确保文件系统同步
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  /**
   * 获取 checkpoint 目录路径
   * 使用团队名称（非 teamId）实现跨次运行的 checkpoint 恢复
   */
  private get checkpointDir(): string {
    const safeName = (this.context?.config.name || 'unknown').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').substring(0, 50);
    return path.join(this.workingDir, '.xuanji', 'checkpoints', safeName);
  }

  /**
   * 保存成员执行 checkpoint，防止超时丢失已完成工作
   * 文件名格式：<memberId>.json，同一 teamName 下最新 checkpoint 覆盖旧文件
   */
  private saveCheckpoint(memberId: string, result: TaskExecutionResult): void {
    try {
      if (!fs.existsSync(this.checkpointDir)) {
        fs.mkdirSync(this.checkpointDir, { recursive: true });
      }
      const checkpointFile = path.join(this.checkpointDir, `${memberId}.json`);
      const checkpoint: TaskExecutionResult & { savedAt: number } = {
        ...result,
        savedAt: Date.now(),
      };
      fs.writeFileSync(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf-8');
      log.info(`Checkpoint saved: ${memberId} (success: ${result.success})`);
    } catch (err) {
      log.warn(`Failed to save checkpoint for ${memberId}:`, err);
    }
  }

  /**
   * 加载所有已保存的 checkpoint
   */
  loadCheckpoints(): Map<string, TaskExecutionResult> {
    const checkpoints = new Map<string, TaskExecutionResult>();
    try {
      if (!fs.existsSync(this.checkpointDir)) return checkpoints;
      const files = fs.readdirSync(this.checkpointDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(this.checkpointDir, file), 'utf-8');
          const checkpoint = JSON.parse(content) as TaskExecutionResult;
          const memberId = file.replace('.json', '');
          checkpoints.set(memberId, checkpoint);
        } catch {
          // 损坏的 checkpoint 跳过
        }
      }
    } catch (err) {
      log.warn('Failed to load checkpoints:', err);
    }
    return checkpoints;
  }

  /**
   * 清除所有 checkpoint
   */
  clearCheckpoints(): void {
    try {
      if (fs.existsSync(this.checkpointDir)) {
        fs.rmSync(this.checkpointDir, { recursive: true, force: true });
        log.info('Checkpoints cleared');
      }
    } catch (err) {
      log.warn('Failed to clear checkpoints:', err);
    }
  }

  /**
   * 分类失败原因（Bug 5）
   */
  private classifyFailure(result: TaskExecutionResult, strategy?: TeamStrategy): FailureCategory {
    const errorMsg = (result.error || '').toLowerCase();
    const output = (result.result || '');

    if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
      return 'timeout';
    }

    // 检测截断：输出以不完整的代码片段结尾
    if (output.length > 2000 && (
      output.endsWith('...') ||
      output.endsWith('…') ||
      /[{};]\s*$/.test(output.trim()) === false && output.trim().length > 3000
    )) {
      return 'output_truncated';
    }

    // Pipeline/Sequential 中间阶段失败
    if (strategy === 'pipeline' || strategy === 'sequential') {
      if (!result.success && result.error) {
        return 'stage_disconnect';
      }
    }

    return 'general_failure';
  }
}
