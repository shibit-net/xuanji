/**
 * 任务执行器 - Executor
 *
 * 职责：
 * 1. 执行 ExecutionPlan 中的所有子任务
 * 2. 管理子任务依赖关系和并行执行
 * 3. 为每个子任务创建 Worker Agent（使用 SubAgentLoop）
 * 4. 汇总执行结果
 */

import type { ILLMProvider, IToolRegistry, AgentConfig } from '@/core/types';
import type { ExecutionPlan } from '@/core/routing/types';
import type { ExecutorConfig, ExecutionResult, SubTaskResult, ExecutionCallbacks } from './types';
import { SubAgentContext } from '@/core/agent/SubAgentContext';
import type { SubAgentFactory } from '@/core/agent/SubAgentFactory';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'executor' });

export class Executor {
  private config: Required<ExecutorConfig>;

  constructor(
    private provider: ILLMProvider,
    private toolRegistry: IToolRegistry,
    private agentConfig: AgentConfig,
    config?: ExecutorConfig,
    private subAgentFactory?: SubAgentFactory,
  ) {
    this.config = {
      maxConcurrent: config?.maxConcurrent || 3,
      timeout: config?.timeout || 300000, // 5 minutes
      stopOnError: config?.stopOnError ?? false,
    };
  }

  /**
   * 执行计划
   *
   * @param plan 执行计划
   * @param callbacks 执行回调
   * @returns 执行结果
   */
  async execute(
    plan: ExecutionPlan,
    callbacks?: ExecutionCallbacks,
  ): Promise<ExecutionResult> {
    log.info('Executing plan...', {
      taskId: plan.taskId,
      steps: plan.steps.length,
    });

    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const subTaskResults: SubTaskResult[] = [];

    // 按依赖关系执行子任务
    const { steps } = plan;
    const completedSteps = new Set<number>();
    const failedSteps = new Set<number>();

    for (const step of steps) {
      // 先检查依赖是否有失败的
      const hasFailed = step.dependsOn?.some(dep => failedSteps.has(dep));
      if (hasFailed) {
        subTaskResults.push({
          order: step.order,
          description: step.description,
          agentId: step.agentId,
          status: 'skipped',
          error: '依赖子任务执行失败',
        });
        continue;
      }

      // 再检查依赖是否满足
      const depsReady = !step.dependsOn || step.dependsOn.every(dep => completedSteps.has(dep));
      if (!depsReady) {
        // 依赖未满足，跳过
        subTaskResults.push({
          order: step.order,
          description: step.description,
          agentId: step.agentId,
          status: 'skipped',
          error: '依赖子任务未完成',
        });
        continue;
      }

      // 执行子任务
      callbacks?.onSubTaskStart?.(step.order, step.description);

      const result = await this.executeSubTask(step.description, step.agentId);
      result.order = step.order; // 设置正确的步骤编号
      subTaskResults.push(result);

      callbacks?.onSubTaskComplete?.(result);
      callbacks?.onProgress?.(subTaskResults.length, steps.length);

      if (result.status === 'success') {
        completedSteps.add(step.order);
      } else {
        failedSteps.add(step.order);
        if (this.config.stopOnError) {
          log.warn(`Stopping execution due to error in step ${step.order}`);
          break;
        }
      }
    }

    const completedAt = new Date().toISOString();
    const totalDuration = Date.now() - startTime;

    // 判断总体状态
    const successCount = subTaskResults.filter(r => r.status === 'success').length;
    const failedCount = subTaskResults.filter(r => r.status === 'failed').length;

    let status: 'success' | 'partial' | 'failed';
    if (failedCount === 0) {
      status = 'success';
    } else if (successCount > 0) {
      status = 'partial';
    } else {
      status = 'failed';
    }

    // 生成汇总
    const summary = this.generateSummary(plan, subTaskResults);

    const result: ExecutionResult = {
      taskId: plan.taskId,
      taskDescription: plan.taskDescription,
      status,
      subTaskResults,
      totalDuration,
      startedAt,
      completedAt,
      summary,
    };

    log.info('Execution completed', {
      taskId: plan.taskId,
      status,
      duration: totalDuration,
      success: successCount,
      failed: failedCount,
    });

    return result;
  }

  /**
   * 执行单个子任务
   */
  private async executeSubTask(
    taskDescription: string,
    agentId?: string,
  ): Promise<SubTaskResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    try {
      log.debug(`Executing subtask: ${taskDescription}`, { agentId });

      if (!this.subAgentFactory) {
        throw new Error('SubAgentFactory is required for task execution');
      }

      const result = await this.subAgentFactory.createAndRun(agentId ?? 'general-purpose', {
        task: taskDescription,
        parentConfig: this.agentConfig,
      });

      const completedAt = new Date().toISOString();
      const duration = Date.now() - startTime;

      return {
        order: 0, // will be set by caller
        description: taskDescription,
        agentId,
        status: 'success',
        result: result.result,
        duration,
        startedAt,
        completedAt,
      };
    } catch (error) {
      const completedAt = new Date().toISOString();
      const duration = Date.now() - startTime;

      log.error(`Subtask failed: ${taskDescription}`, error);

      return {
        order: 0, // will be set by caller
        description: taskDescription,
        agentId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        duration,
        startedAt,
        completedAt,
      };
    }
  }

  /**
   * 生成执行汇总
   */
  private generateSummary(plan: ExecutionPlan, results: SubTaskResult[]): string {
    const lines: string[] = [];

    lines.push(`任务: ${plan.taskDescription}`);
    lines.push(`总步骤数: ${plan.steps.length}`);
    lines.push('');

    lines.push('执行结果:');
    for (const result of results) {
      const icon = result.status === 'success' ? '✅' : result.status === 'failed' ? '❌' : '⏭️';
      lines.push(`${icon} 步骤 ${result.order}: ${result.description}`);
      if (result.error) {
        lines.push(`   错误: ${result.error}`);
      }
      if (result.duration) {
        lines.push(`   耗时: ${(result.duration / 1000).toFixed(1)}s`);
      }
    }

    lines.push('');
    lines.push(`总耗时: ${results.reduce((sum, r) => sum + (r.duration || 0), 0) / 1000}s`);

    return lines.join('\n');
  }
}
