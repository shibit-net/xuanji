// ============================================================
// TaskRouterService — 任务路由服务
// ============================================================
// 纯规则路由（触发词检测），零 LLM 调用。
// 复杂任务分解（Planner + Executor）仍由此服务执行。

import type { ILLMProvider, IToolRegistry, AppConfig } from '@/core/types';
import { TaskRouter, DEFAULT_ROUTING_CONFIG } from './TaskRouter';
import type { RoutingDecision, ExecutionMode } from './types';
import { Planner } from '@/core/planner/Planner';
import { Executor } from '@/core/executor/Executor';
import type { SubAgentFactory } from '@/core/agent/SubAgentFactory';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'TaskRouterService' });

export interface TaskRouterServiceOptions {
  provider: ILLMProvider;
  registry: IToolRegistry;
  config: AppConfig;
  subAgentFactory?: SubAgentFactory;
}

export class TaskRouterService {
  private taskRouter: TaskRouter;
  private planner: Planner | null = null;
  private executor: Executor | null = null;
  private provider: ILLMProvider;
  private registry: IToolRegistry;
  private config: AppConfig;

  constructor(options: TaskRouterServiceOptions) {
    this.provider = options.provider;
    this.registry = options.registry;
    this.config = options.config;

    const routingConfig = this.config.routing || DEFAULT_ROUTING_CONFIG;
    this.taskRouter = new TaskRouter(routingConfig);

    try {
      this.planner = new Planner(this.provider, this.config.planner);
      this.executor = new Executor(
        this.provider,
        this.registry,
        {
          model: this.config.provider.model,
          apiKey: this.config.provider.apiKey,
          baseURL: this.config.provider.baseURL,
          maxTokens: this.config.provider.maxTokens,
          temperature: this.config.provider.temperature,
          maxIterations: this.config.agent?.maxIterations,
        },
        this.config.executor,
        options.subAgentFactory,
      );
      log.info('TaskRouterService initialized');
    } catch (err) {
      log.warn('Planner/Executor init failed:', err);
    }
  }

  async route(
    userMessage: string,
    context?: {
      sessionId?: string;
      messageCount?: number;
      usedAgents?: string[];
      currentMode?: ExecutionMode;
    },
  ): Promise<RoutingDecision> {
    const decision = await this.taskRouter.route(userMessage, {
      sessionId: context?.sessionId ?? 'unknown',
      messageCount: context?.messageCount ?? 0,
      usedAgents: context?.usedAgents ?? [],
      currentMode: context?.currentMode ?? 'direct',
    });
    log.info(`Routing decision: ${decision.mode} (reason: ${decision.reason})`);
    return decision;
  }

  async executeWithPlanner(userMessage: string, decision: RoutingDecision): Promise<void> {
    if (!this.planner || !this.executor) {
      throw new Error('Planner or Executor not initialized');
    }

    // 如果没有 complexity（如显式触发），提供默认值
    const complexity = decision.complexity ?? {
      isMultiStep: true,
      requiresSpecialist: false,
      estimatedSteps: 3,
      domains: [],
      parallelizable: false,
      complexity: 'medium' as const,
      reasoning: 'Explicit trigger without complexity analysis',
    };

    const plan = await this.planner.plan({
      userInput: userMessage,
      complexity,
      availableAgents: [],
    });
    log.info(`Generated plan: ${plan.steps.length} steps`);

    const result = await this.executor.execute(plan, {
      onSubTaskStart: (order, description) => log.debug(`SubTask ${order} started: ${description}`),
      onSubTaskComplete: (taskResult) => log.debug(`SubTask ${taskResult.order} done`),
      onProgress: (current, total) => log.debug(`Progress: ${current}/${total}`),
    });
    log.info(`Plan executed: ${result.status}`);
  }

  getTaskRouter(): TaskRouter { return this.taskRouter; }
  getPlanner(): Planner | null { return this.planner; }
  getExecutor(): Executor | null { return this.executor; }
  dispose(): void { this.planner = null; this.executor = null; }
}
