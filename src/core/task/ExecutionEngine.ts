import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import { logger } from '@/core/logger';
import { RetryManager } from './RetryManager';
import { ProgressTracker } from './ProgressTracker';
import { ResultAggregator } from './ResultAggregator';
import type { Task, TaskStep, AgentExecutor } from './types';

const log = logger.child({ module: 'ExecutionEngine' });

export class ExecutionEngine {
  private executor: AgentExecutor | null = null;
  private retryManager = new RetryManager();
  private tracker = new ProgressTracker();
  private aggregator = new ResultAggregator();

  setExecutor(executor: AgentExecutor): void { this.executor = executor; }

  async execute(task: Task): Promise<void> {
    if (!this.executor) throw new Error('No executor configured');

    eventBus.emit(XuanjiEvent.TASK_STARTED, { taskId: task.id, type: task.type });

    for (let i = 0; i < task.steps.length; i++) {
      const step = task.steps[i];
      if (step.status === 'completed') continue;

      const depsMet = step.dependencies.every(depId =>
        task.steps.find(s => s.id === depId)?.status === 'completed'
      );
      if (!depsMet) { log.warn(`Step ${step.id} dependencies not met, skipping`); continue; }

      task.currentStepIndex = i;
      step.status = 'running';
      step.startedAt = Date.now();
      this.tracker.onStepStarted(task, step);

      try {
        const result = await this.executor(step, task);
        step.result = result;
        step.status = result.success ? 'completed' : 'failed';
        step.completedAt = Date.now();
        task.completedSteps.push(result);
        this.tracker.onStepCompleted(task, step, result);

        if (!result.success) { task.result = result; return; }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const retryResult = await this.retryManager.handleError(task, step, error, s => this.executor!(s, task));
        step.result = retryResult;
        step.status = retryResult.success ? 'completed' : 'failed';
        step.completedAt = Date.now();
        task.completedSteps.push(retryResult);
        if (!retryResult.success) { task.result = retryResult; return; }
      }
    }

    task.result = this.aggregator.aggregate(task.completedSteps);
    this.tracker.onTaskCompleted(task);
  }
}
