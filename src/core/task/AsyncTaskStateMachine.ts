/**
 * AsyncTaskStateMachine — 统一管理 task 和 agent_team 的后台生命周期。
 *
 * 状态：creating → running → completed/summarizing → cleared
 * 事件驱动，通过 onTaskStateChanged 回调通知 EventForwarder 发出 IPC 事件。
 */

import { logger } from '@/core/logger';

const log = logger.child({ module: 'AsyncTaskStateMachine' });

// ============================================================
// 状态 / 事件定义
// ============================================================

export type AsyncTaskStatus = 'creating' | 'running' | 'completed' | 'summarizing' | 'failed' | 'cancelled' | 'cleared';

export type AsyncTaskEvent =
  | { type: 'TASK_CREATED'; taskId: string; taskType: 'task' | 'team'; name: string; parentAgentId?: string }
  | { type: 'SUBAGENT_STARTED'; taskId: string; subAgentId: string; memberName: string }
  | { type: 'SUBAGENT_ENDED'; taskId: string; subAgentId: string; success: boolean; duration?: number }
  | { type: 'TASK_COMPLETED'; taskId: string }
  | { type: 'TASK_FAILED'; taskId: string; error?: string }
  | { type: 'SUMMARIZE_STARTED'; taskId: string }
  | { type: 'SUMMARIZE_COMPLETED'; taskId: string }
  | { type: 'TASK_CANCELLED'; taskId: string };

export interface AsyncTaskState {
  taskId: string;
  taskType: 'task' | 'team';
  name: string;
  status: AsyncTaskStatus;
  parentAgentId?: string;
  subAgentIds: Set<string>;
  createdAt: number;
  completedAt?: number;
  error?: string;
}

export type TaskStateChangeCallback = (task: AsyncTaskState, event: AsyncTaskEvent) => void;

// ============================================================
// AsyncTaskStateMachine
// ============================================================

export class AsyncTaskStateMachine {
  private tasks = new Map<string, AsyncTaskState>();
  private _onTaskStateChanged: TaskStateChangeCallback | null = null;

  /** 设置状态变更回调（EventForwarder 注册此回调以发出 IPC 事件） */
  onTaskStateChanged(callback: TaskStateChangeCallback): void {
    this._onTaskStateChanged = callback;
  }

  /** 获取任务当前状态 */
  getTask(taskId: string): AsyncTaskState | undefined {
    return this.tasks.get(taskId);
  }

  /** 获取所有活跃任务（非 cleared） */
  getActiveTasks(): AsyncTaskState[] {
    return [...this.tasks.values()].filter(t => t.status !== 'cleared');
  }

  /** 是否有待完成的任务 */
  hasPendingTasks(): boolean {
    return [...this.tasks.values()].some(t =>
      t.status === 'creating' || t.status === 'running' || t.status === 'summarizing'
    );
  }

  /** 处理事件 */
  transition(event: AsyncTaskEvent): AsyncTaskState | null {
    switch (event.type) {
      case 'TASK_CREATED':
        return this.handleTaskCreated(event);
      case 'SUBAGENT_STARTED':
        return this.handleSubAgentStarted(event);
      case 'SUBAGENT_ENDED':
        return this.handleSubAgentEnded(event);
      case 'TASK_COMPLETED':
        return this.handleTaskCompleted(event);
      case 'TASK_FAILED':
        return this.handleTaskFailed(event);
      case 'SUMMARIZE_STARTED':
        return this.handleSummarizeStarted(event);
      case 'SUMMARIZE_COMPLETED':
        return this.handleSummarizeCompleted(event);
      case 'TASK_CANCELLED':
        return this.handleTaskCancelled(event);
    }
  }

  /** 清理已完成/失败/取消的任务 */
  clearTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task && task.status !== 'cleared') {
      task.status = 'cleared';
      this.notify(task, { type: 'TASK_CANCELLED', taskId });
    }
  }

  /** 批量清理终态任务 */
  clearCompletedTasks(): string[] {
    const cleared: string[] = [];
    for (const [taskId, task] of this.tasks) {
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        task.status = 'cleared';
        cleared.push(taskId);
        this.notify(task, { type: 'TASK_CANCELLED', taskId });
      }
    }
    return cleared;
  }

  // ============================================================
  // 内部处理器
  // ============================================================

  private handleTaskCreated(event: AsyncTaskEvent & { type: 'TASK_CREATED' }): AsyncTaskState {
    const task: AsyncTaskState = {
      taskId: event.taskId,
      taskType: event.taskType,
      name: event.name,
      status: 'creating',
      parentAgentId: event.parentAgentId,
      subAgentIds: new Set(),
      createdAt: Date.now(),
    };
    this.tasks.set(event.taskId, task);
    log.info(`AsyncTask created: ${event.taskId} type=${event.taskType} name=${event.name}`);
    this.notify(task, event);
    return task;
  }

  private handleSubAgentStarted(event: AsyncTaskEvent & { type: 'SUBAGENT_STARTED' }): AsyncTaskState | null {
    const task = this.tasks.get(event.taskId);
    if (!task) {
      log.warn(`SUBAGENT_STARTED for unknown task: ${event.taskId}`);
      return null;
    }
    task.status = 'running';
    task.subAgentIds.add(event.subAgentId);
    this.notify(task, event);
    return task;
  }

  private handleSubAgentEnded(event: AsyncTaskEvent & { type: 'SUBAGENT_ENDED' }): AsyncTaskState | null {
    const task = this.tasks.get(event.taskId);
    if (!task) {
      log.warn(`SUBAGENT_ENDED for unknown task: ${event.taskId}`);
      return null;
    }
    this.notify(task, event);
    return task;
  }

  private handleTaskCompleted(event: { type: 'TASK_COMPLETED'; taskId: string }): AsyncTaskState | null {
    const task = this.tasks.get(event.taskId);
    if (!task) {
      log.warn(`TASK_COMPLETED for unknown task: ${event.taskId}`);
      return null;
    }
    task.status = 'completed';
    task.completedAt = Date.now();
    log.info(`AsyncTask completed: ${event.taskId}`);
    this.notify(task, event);
    return task;
  }

  private handleTaskFailed(event: AsyncTaskEvent & { type: 'TASK_FAILED' }): AsyncTaskState | null {
    const task = this.tasks.get(event.taskId);
    if (!task) {
      log.warn(`TASK_FAILED for unknown task: ${event.taskId}`);
      return null;
    }
    task.status = 'failed';
    task.error = event.error;
    task.completedAt = Date.now();
    log.info(`AsyncTask failed: ${event.taskId} error=${event.error}`);
    this.notify(task, event);
    return task;
  }

  private handleSummarizeStarted(event: { type: 'SUMMARIZE_STARTED'; taskId: string }): AsyncTaskState | null {
    const task = this.tasks.get(event.taskId);
    if (!task) return null;
    task.status = 'summarizing';
    this.notify(task, event);
    return task;
  }

  private handleSummarizeCompleted(event: { type: 'SUMMARIZE_COMPLETED'; taskId: string }): AsyncTaskState | null {
    const task = this.tasks.get(event.taskId);
    if (!task) return null;
    task.status = 'completed';
    task.completedAt = Date.now();
    this.notify(task, event);
    return task;
  }

  private handleTaskCancelled(event: { type: 'TASK_CANCELLED'; taskId: string }): AsyncTaskState | null {
    const task = this.tasks.get(event.taskId);
    if (!task) return null;
    task.status = 'cancelled';
    task.completedAt = Date.now();
    log.info(`AsyncTask cancelled: ${event.taskId}`);
    this.notify(task, event);
    return task;
  }

  private notify(task: AsyncTaskState, event: AsyncTaskEvent): void {
    try {
      this._onTaskStateChanged?.(task, event);
    } catch (err) {
      log.error('onTaskStateChanged callback error:', err);
    }
  }
}
