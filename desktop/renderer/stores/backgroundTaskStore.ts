/**
 * backgroundTaskStore — 后台任务生命周期状态机
 *
 * 统一管理 task / agent_team 创建的后台任务，作为 React Flow 节点、
 * 状态栏计数、moment 气泡三个 UI 维度的单一数据源。
 *
 * 生命周期: creating → running → completed → cleared
 */

import { create } from 'zustand';

// ─── 类型 ──────────────────────────────────────────

export type TaskLifecycle = 'creating' | 'running' | 'completed' | 'cleared';

export interface BackgroundTaskMember {
  id: string;
  name: string;
  lifecycle: TaskLifecycle;
  failureReason?: string;
  retryCount?: number;
}

export interface BackgroundTask {
  /** subAgentId（task）或 teamName（agent_team） */
  id: string;
  /** 任务类型 */
  type: 'task' | 'team';
  /** 显示名称 */
  name: string;
  /** 当前生命周期 */
  lifecycle: TaskLifecycle;
  /** agent_team 的策略（仅 team） */
  strategy?: string;
  /** 关联的 subAgentId（仅 task） */
  subAgentId?: string;
  /** 关联的 groupId（TaskOrchestrator 的任务组 ID） */
  groupId?: string;
  /** 团队成员（仅 team） */
  members: BackgroundTaskMember[];
  /** 时间戳 */
  createdAt: number;
  completedAt?: number;
  clearedAt?: number;
}

interface BackgroundTaskState {
  tasks: Record<string, BackgroundTask>;

  // ── 操作方法 ──
  /** 注册一个后台任务 */
  registerTask: (task: BackgroundTask) => void;
  /** 转换任务生命周期 */
  transitionTask: (id: string, to: TaskLifecycle, details?: {
    failureReason?: string;
    retryCount?: number;
    memberId?: string;
  }) => void;
  /** 转换团队成员生命周期 */
  transitionMember: (taskId: string, memberId: string, to: TaskLifecycle, details?: {
    failureReason?: string;
    retryCount?: number;
  }) => void;
  /** 获取运行中的任务数 */
  getRunningCount: () => number;
  /** 获取待汇报的任务数 */
  getCompletedCount: () => number;
  /** 是否有后台任务 */
  hasTasks: () => boolean;
}

// ─── Store ─────────────────────────────────────────

export const useBackgroundTaskStore = create<BackgroundTaskState>((set, get) => ({
  tasks: {},

  registerTask: (task) => {
    set(s => ({
      tasks: { ...s.tasks, [task.id]: task },
    }));
  },

  transitionTask: (id, to) => {
    set(s => {
      const task = s.tasks[id];
      if (!task) return s; // 静默忽略未注册的任务

      const updated = { ...task, lifecycle: to };

      if (to === 'completed') {
        updated.completedAt = Date.now();
      }
      if (to === 'cleared') {
        updated.clearedAt = Date.now();
      }

      return { tasks: { ...s.tasks, [id]: updated } };
    });

    // ── 注意：以下操作依赖 activeAgentStore / runtimeStore ──
    // 由 EventBridge 中的调用方在 transitionTask 之后执行，
    // 保持 store 职责单一。backgroundTaskStore 只管理任务元数据，
    // UI 组件（InputArea / ExecutionFlow）从本 store 读取派生状态。
  },

  transitionMember: (taskId, memberId, to, details) => {
    set(s => {
      const task = s.tasks[taskId];
      if (!task || task.type !== 'team') return s;

      const members = task.members.map(m => {
        if (m.id !== memberId) return m;
        return {
          ...m,
          lifecycle: to,
          ...(details?.failureReason ? { failureReason: details.failureReason } : {}),
          ...(details?.retryCount !== undefined ? { retryCount: details.retryCount } : {}),
        };
      });

      return { tasks: { ...s.tasks, [taskId]: { ...task, members } } };
    });
  },

  getRunningCount: () => {
    const tasks = Object.values(get().tasks);
    let count = 0;
    for (const t of tasks) {
      if (t.lifecycle === 'cleared') continue;
      if (t.type === 'task') {
        if (t.lifecycle === 'creating' || t.lifecycle === 'running') count++;
      } else {
        // team: 只要有成员在 running/creating 就算运行中
        const hasRunning = t.members.some(m => m.lifecycle === 'creating' || m.lifecycle === 'running');
        if (hasRunning) count++;
      }
    }
    return count;
  },

  getCompletedCount: () => {
    const tasks = Object.values(get().tasks);
    let count = 0;
    for (const t of tasks) {
      if (t.lifecycle === 'cleared') continue;
      if (t.type === 'task') {
        if (t.lifecycle === 'completed') count++;
      } else {
        // team: 所有成员都 completed 才算待汇报
        const allDone = t.members.length > 0 && t.members.every(m => m.lifecycle === 'completed');
        if (allDone) count++;
      }
    }
    return count;
  },

  hasTasks: () => {
    return get().getRunningCount() > 0 || get().getCompletedCount() > 0;
  },
}));
