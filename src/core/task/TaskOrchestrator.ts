/**
 * TaskOrchestrator — 任务管理中心
 *
 * 职责：接收调度指令，编排 agent 执行任务。
 */

import { logger } from '@/core/logger';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import { TaskPlanner } from './TaskPlanner';
import { TaskScheduler } from './TaskScheduler';
import { ExecutionEngine } from './ExecutionEngine';
import { ResultStack } from './ResultStack';
import { TaskCompletionHandler } from '@/core/agent/async/TaskCompletionHandler';
import type { ContextManager } from '@/core/context/ContextManager';
import type { Task, PartialResult, AgentExecutor } from './types';
import type { IntentResult } from '@/core/conversation/types';

const log = logger.child({ module: 'TaskOrchestrator' });

export class TaskOrchestrator {
  private planner = new TaskPlanner();
  private scheduler = new TaskScheduler();
  private engine = new ExecutionEngine();
  private resultStack = new ResultStack();
  private taskCounter = 0;
  private taskCompletionHandler: TaskCompletionHandler | null = null;

  constructor() {
    this.scheduler.setEngine(this.engine);
  }

  getPlanner(): TaskPlanner { return this.planner; }
  getEngine(): ExecutionEngine { return this.engine; }
  getScheduler(): TaskScheduler { return this.scheduler; }
  getResultStack(): ResultStack { return this.resultStack; }

  createTask(
    intent: IntentResult,
    goal: string,
    type: 'sync' | 'async',
    userId: string,
    workingDir: string,
    parentTaskId?: string,
  ): Task {
    const plan = this.planner.plan(intent, userId, workingDir, parentTaskId);
    const task: Task = {
      id: `task-${++this.taskCounter}-${Date.now()}`,
      type,
      status: 'pending',
      priority: type === 'sync' ? 10 : 5,
      intent,
      goal,
      complexity: intent.complexity,
      steps: plan.steps,
      currentStepIndex: 0,
      context: { userId, workingDir, depth: 0, parentTaskId },
      parentTaskId,
      completedSteps: [],
      abortController: new AbortController(),
      createdAt: Date.now(),
      timeout: 300_000,
      retryCount: 0,
      maxRetries: 3,
    };

    eventBus.emit(XuanjiEvent.TASK_CREATED, { taskId: task.id, type, complexity: intent.complexity });
    return task;
  }

  setContextManager(contextManager: ContextManager): void {
    this.taskCompletionHandler = new TaskCompletionHandler(contextManager, {
      onAutoSummarize: () => { eventBus.emit(XuanjiEvent.ASYNC_TASK_COMPLETED, { taskId: '' }); },
      onCitationData: () => {},
      onRun: async () => {},
      isRunning: () => (this.engine as any)._running ?? false,
    });
    this.taskCompletionHandler.register();
  }

  async run(task: Task): Promise<void> {
    this.taskCompletionHandler?.injectPendingCompletions();
    this.scheduler.schedule(task);
  }

  async terminateAll(): Promise<void> {
    log.info('Terminating all tasks');
    this.scheduler.cancelAll();
    this.taskCompletionHandler?.dispose();
    eventBus.emit(XuanjiEvent.TASK_TERMINATED, {});
  }

  collectPartialResults(): PartialResult[] {
    return this.resultStack.drain().map(t => ({
      stepId: t.taskId, type: 'sub_agent' as const, output: t.result, success: true,
    }));
  }

  setExecutor(executor: AgentExecutor): void { this.engine.setExecutor(executor); }
}
