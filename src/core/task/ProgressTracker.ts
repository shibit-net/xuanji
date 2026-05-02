import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import type { Task, TaskStep, TaskStepResult } from './types';

export class ProgressTracker {
  onStepStarted(task: Task, step: TaskStep): void {
    eventBus.emit(XuanjiEvent.TASK_STEP_STARTED, { taskId: task.id, stepId: step.id });
  }

  onStepCompleted(task: Task, step: TaskStep, result: TaskStepResult): void {
    eventBus.emit(XuanjiEvent.TASK_STEP_COMPLETED, {
      taskId: task.id, stepId: step.id, success: result.success,
    });
  }

  onTaskCompleted(task: Task): void {
    eventBus.emit(XuanjiEvent.TASK_COMPLETED, { taskId: task.id, steps: task.completedSteps.length });
  }

  onTaskFailed(task: Task, error: string): void {
    eventBus.emit(XuanjiEvent.TASK_FAILED, { taskId: task.id, error });
  }
}
