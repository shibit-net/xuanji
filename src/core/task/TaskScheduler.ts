import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import type { Task } from './types';
import type { ExecutionEngine } from './ExecutionEngine';

export class TaskScheduler {
  private syncQueue: Task[] = [];
  private asyncPool: Task[] = [];
  private maxAsyncConcurrent = 3;
  private engine: ExecutionEngine | null = null;

  setEngine(engine: ExecutionEngine): void { this.engine = engine; }

  schedule(task: Task): void {
    if (task.type === 'async') {
      if (this.asyncPool.length >= this.maxAsyncConcurrent) {
        this.asyncPool.push(task);
        eventBus.emit(XuanjiEvent.TASK_QUEUED, { taskId: task.id });
      } else {
        this.asyncPool.push(task);
        this.executeAsync(task);
      }
    } else {
      this.syncQueue.push(task);
      eventBus.emit(XuanjiEvent.TASK_QUEUED, { taskId: task.id });
      if (this.syncQueue.length === 1) this.executeNextSync();
    }
  }

  private async executeNextSync(): Promise<void> {
    const task = this.syncQueue[0];
    if (!task || !this.engine) return;
    try {
      await this.engine.execute(task);
    } finally {
      this.syncQueue.shift();
      if (this.syncQueue.length > 0) this.executeNextSync();
    }
  }

  private async executeAsync(task: Task): Promise<void> {
    if (!this.engine) return;
    try {
      await this.engine.execute(task);
    } finally {
      const idx = this.asyncPool.findIndex(t => t.id === task.id);
      if (idx >= 0) this.asyncPool.splice(idx, 1);
    }
  }

  drainSyncQueue(): Task[] {
    const tasks = [...this.syncQueue];
    this.syncQueue = [];
    return tasks;
  }

  cancelAll(): void {
    for (const task of [...this.syncQueue, ...this.asyncPool]) {
      task.abortController.abort();
      task.status = 'cancelled';
      eventBus.emit(XuanjiEvent.TASK_CANCELLED, { taskId: task.id, reason: 'user_cancelled' });
    }
    this.syncQueue = [];
    this.asyncPool = [];
  }
}
