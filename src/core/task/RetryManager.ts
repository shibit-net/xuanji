import { logger } from '@/core/logger';
import type { Task, TaskStep, TaskStepResult } from './types';

const log = logger.child({ module: 'RetryManager' });

export class RetryManager {
  private maxRetries = 3;

  async handleError(
    task: Task,
    step: TaskStep,
    error: Error,
    retryFn: (step: TaskStep) => Promise<TaskStepResult>,
  ): Promise<TaskStepResult> {
    if (task.retryCount >= (task.maxRetries || this.maxRetries)) {
      return { success: false, error: error.message };
    }

    task.retryCount++;
    const delay = Math.min(1000 * Math.pow(2, task.retryCount - 1), 30000);
    log.warn(`Retry ${task.retryCount}/${task.maxRetries} for step ${step.id}, waiting ${delay}ms`);

    await new Promise(r => setTimeout(r, delay));
    return retryFn({ ...step, id: `${step.id}-retry` });
  }
}
