/**
 * AsyncTaskStore — 替代 backgroundTaskStore，统一管理 task/team 后台任务。
 *
 * 事件驱动的生命周期: creating → running → completed → cleared
 *                                        ↘ cancelled → cleared
 *
 * 改进：
 * - taskType 字段替代 type，统一表示 task/team
 * - 单层 tasks Record（不再有 tasks[] + teams[] 两数组）
 * - transition(event) 事件驱动
 */

import { create } from 'zustand';

export type TaskLifecycle = 'creating' | 'running' | 'completed' | 'cancelled' | 'cleared';

export interface TaskMember {
  id: string;
  name: string;
  lifecycle: TaskLifecycle;
  failureReason?: string;
  retryCount?: number;
}

export interface AsyncTask {
  id: string;
  taskType: 'task' | 'team';
  name: string;
  lifecycle: TaskLifecycle;
  strategy?: string;
  subAgentId?: string;
  groupId?: string;
  parentAgentId?: string;
  members: TaskMember[];
  createdAt: number;
  completedAt?: number;
  clearedAt?: number;
}

export type AsyncTaskStoreEvent =
  | { type: 'TASK_CREATED'; taskId: string; taskType: 'task' | 'team'; name: string; parentAgentId?: string; groupId?: string; strategy?: string; members?: TaskMember[] }
  | { type: 'TASK_STARTED'; taskId: string; subAgentId?: string }
  | { type: 'TASK_COMPLETED'; taskId: string }
  | { type: 'TASK_FAILED'; taskId: string; error?: string }
  | { type: 'TASK_CANCELLED'; taskId: string }
  | { type: 'TASK_CLEARED'; taskId: string }
  | { type: 'MEMBER_STATE_CHANGED'; taskId: string; memberId: string; lifecycle: TaskLifecycle; failureReason?: string; retryCount?: number };

interface AsyncTaskStoreState {
  tasks: Record<string, AsyncTask>;

  transition: (event: AsyncTaskStoreEvent) => void;
  getRunningCount: () => number;
  getCompletedCount: () => number;
  getCancelledCount: () => number;
  hasTasks: () => boolean;
  getActiveTasks: () => AsyncTask[];
}

const MAX_COMPLETED_TASKS = 50;

export const useAsyncTaskStore = create<AsyncTaskStoreState>((set, get) => ({
  tasks: {},

  transition: (event) => {
    set((s) => {
      switch (event.type) {
        case 'TASK_CREATED': {
          const task: AsyncTask = {
            id: event.taskId,
            taskType: event.taskType,
            name: event.name,
            lifecycle: 'creating',
            strategy: event.strategy,
            subAgentId: undefined,
            groupId: event.groupId,
            parentAgentId: event.parentAgentId,
            members: event.members ?? [],
            createdAt: Date.now(),
          };
          return { tasks: { ...s.tasks, [event.taskId]: task } };
        }

        case 'TASK_STARTED': {
          const existing = s.tasks[event.taskId];
          if (!existing) return s;
          if (existing.lifecycle === 'cleared') return s;
          const updated = { ...existing, lifecycle: 'running' as TaskLifecycle };
          if (event.subAgentId) updated.subAgentId = event.subAgentId;
          return { tasks: { ...s.tasks, [event.taskId]: updated } };
        }

        case 'TASK_COMPLETED':
        case 'TASK_FAILED':
        case 'TASK_CANCELLED': {
          const existing = s.tasks[event.taskId];
          if (!existing || existing.lifecycle === 'cleared') return s;
          const lifecycle = event.type === 'TASK_COMPLETED' ? 'completed'
            : event.type === 'TASK_FAILED' ? 'cancelled'
            : 'cancelled';
          const updated = { ...existing, lifecycle: lifecycle as TaskLifecycle, completedAt: Date.now() };
          return pruneCompletedTasks(s.tasks, event.taskId, updated);
        }

        case 'TASK_CLEARED': {
          const existing = s.tasks[event.taskId];
          if (!existing) return s;
          const updated = { ...existing, lifecycle: 'cleared' as TaskLifecycle, clearedAt: Date.now() };
          return { tasks: { ...s.tasks, [event.taskId]: updated } };
        }

        case 'MEMBER_STATE_CHANGED': {
          const task = s.tasks[event.taskId];
          if (!task || task.taskType !== 'team') return s;
          const members = task.members.map((m) =>
            m.id === event.memberId
              ? { ...m, lifecycle: event.lifecycle, ...(event.failureReason ? { failureReason: event.failureReason } : {}), ...(event.retryCount !== undefined ? { retryCount: event.retryCount } : {}) }
              : m
          );
          return { tasks: { ...s.tasks, [event.taskId]: { ...task, members } } };
        }

        default:
          return s;
      }
    });
  },

  getRunningCount: () => {
    let count = 0;
    for (const t of Object.values(get().tasks)) {
      if (t.lifecycle === 'cleared') continue;
      if (t.taskType === 'task') {
        if (t.lifecycle === 'creating' || t.lifecycle === 'running') count++;
      } else {
        if (t.members.some((m) => m.lifecycle === 'creating' || m.lifecycle === 'running')) count++;
      }
    }
    return count;
  },

  getCompletedCount: () => {
    let count = 0;
    for (const t of Object.values(get().tasks)) {
      if (t.lifecycle === 'cleared') continue;
      if (t.taskType === 'task') {
        if (t.lifecycle === 'completed' || t.lifecycle === 'cancelled') count++;
      } else {
        if (t.members.length > 0 && t.members.every((m) => m.lifecycle === 'completed' || m.lifecycle === 'cancelled')) count++;
      }
    }
    return count;
  },

  getCancelledCount: () => {
    let count = 0;
    for (const t of Object.values(get().tasks)) {
      if (t.lifecycle === 'cleared') continue;
      if (t.lifecycle === 'cancelled') count++;
    }
    return count;
  },

  hasTasks: () => get().getRunningCount() > 0 || get().getCompletedCount() > 0,

  getActiveTasks: () => Object.values(get().tasks).filter((t) => t.lifecycle !== 'cleared'),
}));

function pruneCompletedTasks(
  tasks: Record<string, AsyncTask>,
  updatedId: string,
  updated: AsyncTask,
): { tasks: Record<string, AsyncTask> } {
  const completedIds = Object.keys(tasks).filter(
    (key) => {
      const lc = tasks[key].lifecycle;
      return lc === 'completed' || lc === 'cancelled' || lc === 'cleared';
    }
  );
  const totalCompleted = completedIds.includes(updatedId) ? completedIds.length : completedIds.length + 1;
  if (totalCompleted <= MAX_COMPLETED_TASKS) {
    return { tasks: { ...tasks, [updatedId]: updated } };
  }
  const newTasks = { ...tasks, [updatedId]: updated };
  const toRemove = completedIds.slice(0, totalCompleted - MAX_COMPLETED_TASKS);
  for (const rid of toRemove) delete newTasks[rid];
  return { tasks: newTasks };
}
