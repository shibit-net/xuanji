/**
 * MainAgent - 主调度Agent（贾维斯架构）
 *
 * 职责：
 * 1. 需求解析：识别用户意图和任务类型
 * 2. 场景分析：识别编程场景
 * 3. 任务拆分：将复杂任务拆分为子任务
 * 4. 策略选择：选择最佳执行策略
 * 5. 子Agent调度：调用TeamManager执行任务
 * 6. 结果汇总：统一口吻包装，返回给用户
 *
 * 🎯 设计原则：
 * - 固定Prompt：主Agent的Prompt固定，不参与专业任务执行
 * - 职责单一：只做调度，不做专业输出
 * - 复用xuanji优势：IntentRouter + IntentAnalyzer + TeamManager + AgentLoop
 */

import type { IntentRouter } from '@/core/intent/IntentRouter';
import type { IntentAnalyzer } from '@/core/prompt/IntentAnalyzer';
import type { TeamManager } from '../team/TeamManager';
import type { TeamConfig, TeamExecutionResult } from '../team/types';
import type { AvailableModule } from '@/core/intent/LLMIntentClassifier';
import { PromptStore } from './PromptStore';
import { TaskPlanner } from './TaskPlanner';
import { ResultAggregator } from './ResultAggregator';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MainAgent' });

/**
 * MainAgent配置
 */
export interface MainAgentConfig {
  /** 是否启用意图识别 */
  enableIntentRouter?: boolean;
  /** 是否启用场景分析 */
  enableSceneAnalysis?: boolean;
  /** 是否启用任务拆分 */
  enableTaskDecomposition?: boolean;
  /** 是否启用结果汇总 */
  enableResultAggregation?: boolean;
}

/**
 * MainAgent - 主调度Agent
 */
export class MainAgent {
  private intentRouter: IntentRouter;
  private intentAnalyzer: IntentAnalyzer;
  private teamManager: TeamManager;
  private promptStore: PromptStore;
  private taskPlanner: TaskPlanner;
  private resultAggregator: ResultAggregator;
  private config: MainAgentConfig;

  constructor(
    intentRouter: IntentRouter,
    intentAnalyzer: IntentAnalyzer,
    teamManager: TeamManager,
    promptStore: PromptStore,
    taskPlanner: TaskPlanner,
    resultAggregator: ResultAggregator,
    config?: MainAgentConfig
  ) {
    this.intentRouter = intentRouter;
    this.intentAnalyzer = intentAnalyzer;
    this.teamManager = teamManager;
    this.promptStore = promptStore;
    this.taskPlanner = taskPlanner;
    this.resultAggregator = resultAggregator;
    this.config = {
      enableIntentRouter: true,
      enableSceneAnalysis: true,
      enableTaskDecomposition: true,
      enableResultAggregation: true,
      ...config,
    };
  }

  /**
   * 执行用户请求
   *
   * 流程：
   * 1. 意图识别（IntentRouter）
   * 2. 场景分析（IntentAnalyzer）
   * 3. 任务规划（TaskPlanner）
   * 4. 执行任务（TeamManager）
   * 5. 结果汇总（ResultAggregator）
   */
  async execute(userInput: string, signal?: AbortSignal): Promise<string> {
    log.info(`[MainAgent] Received user input: ${userInput.substring(0, 100)}...`);

    try {
      // 1. 意图识别（可选）
      let intent = null;
      if (this.config.enableIntentRouter) {
        const availableModules: AvailableModule[] = []; // TODO: 从AgentRegistry获取
        const intents = await this.intentRouter.route(userInput, availableModules, {
          threshold: 0.7,
          enableVector: true,
          enableLLM: false, // 简单场景不调用LLM
        });
        intent = intents[0] || null;
        log.info(`[MainAgent] Intent: ${intent?.type || 'none'} (confidence: ${intent?.confidence || 0})`);
      }

      // 2. 场景分析（可选）
      let scene = 'write_code';
      let complexity: 'simple' | 'standard' | 'complex' = 'standard';
      if (this.config.enableSceneAnalysis) {
        const analysis = await this.intentAnalyzer.analyze(userInput, true);
        scene = analysis.scene || 'write_code';
        complexity = analysis.complexity;
        log.info(`[MainAgent] Scene: ${scene}, Complexity: ${complexity}`);
      }

      // 3. 任务规划
      const plan = await this.taskPlanner.plan(intent, scene, complexity, userInput);
      log.info(`[MainAgent] Task plan: strategy=${plan.strategy}, tasks=${plan.tasks.length}`);

      // 4. 执行任务
      let result: TeamExecutionResult;
      if (plan.strategy === 'single') {
        // 简单任务：直接调用单个子Agent
        result = await this.executeSingleTask(plan, signal);
      } else {
        // 复杂任务：使用TeamManager协调执行
        result = await this.executeTeamTasks(plan, signal);
      }

      // 5. 结果汇总（可选）
      let finalOutput = result.output;
      if (this.config.enableResultAggregation && result.memberResults.length > 1) {
        finalOutput = await this.resultAggregator.aggregate(result, userInput);
      }

      log.info(`[MainAgent] Task completed successfully`);
      return finalOutput;

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error(`[MainAgent] Execution failed: ${errMsg}`);
      throw error;
    }
  }

  /**
   * 执行单个任务
   */
  private async executeSingleTask(
    plan: import('./TaskPlanner').TaskPlan,
    signal?: AbortSignal
  ): Promise<TeamExecutionResult> {
    const task = plan.tasks[0];

    // 获取场景Prompt
    const systemPrompt = await this.promptStore.getPromptForScene(task.scene);

    // 创建单成员团队
    const teamConfig: TeamConfig = {
      name: 'single-task',
      strategy: 'sequential',
      members: [{
        id: task.id,
        agentId: task.agentId,
        systemPrompt,
        capabilities: [task.scene],
      }],
    };

    await this.teamManager.createTeam(teamConfig);
    return this.teamManager.execute(plan.goal, signal);
  }

  /**
   * 执行团队任务（复用xuanji的TeamManager）
   */
  private async executeTeamTasks(
    plan: import('./TaskPlanner').TaskPlan,
    signal?: AbortSignal
  ): Promise<TeamExecutionResult> {
    // 为每个任务获取场景Prompt
    const membersWithPrompts = await Promise.all(
      plan.tasks.map(async (task) => {
        const systemPrompt = task.systemPrompt || await this.promptStore.getPromptForScene(task.scene);
        return {
          id: task.id,
          agentId: task.agentId,
          systemPrompt,
          capabilities: [task.scene],
          priority: task.priority,
        };
      })
    );

    const teamConfig: TeamConfig = {
      name: 'complex-task',
      strategy: plan.strategy as any,
      members: membersWithPrompts,
    };

    await this.teamManager.createTeam(teamConfig);
    return this.teamManager.execute(plan.goal, signal);
  }
}
