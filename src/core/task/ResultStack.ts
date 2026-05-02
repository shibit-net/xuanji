import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import type { CompletedAsyncTask } from './types';

export class ResultStack {
  private pending: CompletedAsyncTask[] = [];
  private maxSize = 50;

  push(task: CompletedAsyncTask): void {
    this.pending.push(task);
    if (this.pending.length > this.maxSize) this.pending.shift();
    eventBus.emit(XuanjiEvent.ASYNC_TASK_COMPLETED, { taskId: task.id });
  }

  hasPending(): boolean { return this.pending.length > 0; }
  pop(): CompletedAsyncTask | null { return this.pending.shift() ?? null; }

  drain(): CompletedAsyncTask[] {
    const tasks = [...this.pending];
    this.pending = [];
    return tasks;
  }

  peek(): CompletedAsyncTask | null { return this.pending[0] ?? null; }
  get size(): number { return this.pending.length; }
}
