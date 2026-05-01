/**
 * AsyncAgentTaskManager — 异步 Agent 任务管理器
 *
 * 单例模式，管理后台运行的 Agent 任务组（team/task）。
 * 对标 BackgroundTaskManager，提供启动、查询进度、获取结果、取消功能。
 */

import { randomUUID } from 'node:crypto';
import { getRuntimeConfig } from '@/core/config/RuntimeConfig';
import { logger } from '@/core/logger';
import type {
  AgentTaskGroup,
  AgentTaskStatus,
  AgentTaskProgress,
  AgentTaskMemberStatus,
  AgentTaskMember,
  AgentTaskCompletionCallback,
  AgentTaskCompletionResult,
  StartAgentTaskOptions,
  AsyncAgentTaskConfig,
} from './types';

const log = logger.child({ module: 'AsyncAgentTaskManager' });

/** 默认配置 */
const DEFAULT_CONFIG: AsyncAgentTaskConfig = {
  maxConcurrent: 3,
  maxLifetimeMs: 4 * 3600_000, // 4 小时
  maxCompletedTasks: 20,
};

export class AsyncAgentTaskManager {
  private static instance: AsyncAgentTaskManager | null = null;

  private tasks: Map<string, AgentTaskGroup> = new Map();
  private config: AsyncAgentTaskConfig;
  /** 全局完成回调（通知 AgentLoop） */
  private globalCompletionCallback: AgentTaskCompletionCallback | null = null;

  private constructor(config?: Partial<AsyncAgentTaskConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  static getInstance(config?: Partial<AsyncAgentTaskConfig>): AsyncAgentTaskManager {
    if (!AsyncAgentTaskManager.instance) {
      AsyncAgentTaskManager.instance = new AsyncAgentTaskManager(config);
    }
    return AsyncAgentTaskManager.instance;
  }

  static resetInstance(): void {
    if (AsyncAgentTaskManager.instance) {
      AsyncAgentTaskManager.instance.stopAll();
      AsyncAgentTaskManager.instance = null;
    }
  }

  /** 注册全局完成回调（AgentLoop 设置） */
  onTaskCompleted(callback: AgentTaskCompletionCallback): void {
    this.globalCompletionCallback = callback;
  }

  /** 启动后台 Agent 任务 */
  startTask(options: StartAgentTaskOptions): { groupId: string; error?: string } {
    const maxConcurrent = this.getConfigValue('maxConcurrent');

    const runningCount = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'running',
    ).length;
    if (runningCount >= maxConcurrent) {
      return {
        groupId: '',
        error: `已达后台任务上限 (${maxConcurrent})，请等待现有任务完成或使用 task_control 取消后再试。`,
      };
    }

    const groupId = `at-${randomUUID().slice(0, 8)}`;
    const abortController = new AbortController();

    const now = Date.now();
    const progress: AgentTaskProgress = {
      phase: 'setup',
      totalMembers: options.members?.length ?? 1,
      completedMembers: 0,
      elapsed: 0,
    };

    const taskGroup: AgentTaskGroup = {
      groupId,
      type: options.type,
      goal: options.goal,
      status: 'running',
      progress,
      members: options.members ?? [],
      startedAt: now,
      abortController,
      workingDir: options.workingDir,
      isolation: options.isolation,
      completionCallbacks: new Set(),
    };

    this.tasks.set(groupId, taskGroup);

    // 后台启动执行
    this.runTask(taskGroup, options.executor);

    return { groupId };
  }

  /** 查询任务进度 */
  getProgress(groupId: string): {
    found: boolean;
    status?: AgentTaskStatus;
    progress?: AgentTaskProgress;
    goal?: string;
    type?: string;
    startedAt?: number;
    completedAt?: number;
    error?: string;
  } {
    const task = this.tasks.get(groupId);
    if (!task) {
      return { found: false, error: `任务组 ${groupId} 不存在` };
    }

    task.progress.elapsed = Date.now() - task.startedAt;

    return {
      found: true,
      status: task.status,
      progress: { ...task.progress },
      goal: task.goal,
      type: task.type,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    };
  }

  /** 获取任务结果（可阻塞等待） */
  async getResult(
    groupId: string,
    block: boolean = true,
    timeout: number = 30_000,
  ): Promise<{ found: boolean; status?: AgentTaskStatus; result?: string; error?: string }> {
    const task = this.tasks.get(groupId);
    if (!task) {
      return { found: false, error: `任务组 ${groupId} 不存在` };
    }

    if (task.status !== 'running') {
      return {
        found: true,
        status: task.status,
        result: task.result?.content,
        error: task.status === 'failed' ? (task.result?.content ?? '未知错误') : undefined,
      };
    }

    if (!block) {
      return { found: true, status: 'running', result: '任务仍在运行中' };
    }

    // 阻塞等待完成
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        task.completionCallbacks.delete(callback);
        resolve({
          found: true,
          status: 'running',
          result: `等待超时 (${timeout}ms)，任务仍在运行中`,
        });
      }, timeout);

      const callback: AgentTaskCompletionCallback = (result) => {
        clearTimeout(timer);
        resolve({
          found: true,
          status: result.status,
          result: result.result?.content,
          error: result.error,
        });
      };

      task.completionCallbacks.add(callback);
    });
  }

  /** 取消任务组 */
  cancelTask(groupId: string): { success: boolean; error?: string } {
    const task = this.tasks.get(groupId);
    if (!task) {
      return { success: false, error: `任务组 ${groupId} 不存在` };
    }

    if (task.status !== 'running') {
      return { success: false, error: `任务组 ${groupId} 已结束 (${task.status})` };
    }

    task.abortController.abort();
    task.status = 'cancelled';
    task.completedAt = Date.now();
    task.progress.phase = 'synthesizing';

    this.notifyCompletion(task, 'cancelled');
    this.autoCleanup();

    return { success: true };
  }

  /** 列出所有任务组 */
  listTasks(): Array<{
    groupId: string;
    type: string;
    goal: string;
    status: AgentTaskStatus;
    progress: AgentTaskProgress;
    startedAt: number;
    completedAt?: number;
  }> {
    return Array.from(this.tasks.values()).map((t) => ({
      groupId: t.groupId,
      type: t.type,
      goal: t.goal,
      status: t.status,
      progress: { ...t.progress, elapsed: Date.now() - t.startedAt },
      startedAt: t.startedAt,
      completedAt: t.completedAt,
    }));
  }

  /** 停止所有任务（进程退出时调用） */
  stopAll(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'running') {
        task.abortController.abort();
        task.status = 'cancelled';
        task.completedAt = Date.now();
      }
      this.notifyCompletion(task, task.status);
    }
    this.tasks.clear();
  }

  /** 更新任务成员状态 */
  updateMemberStatus(groupId: string, memberId: string, status: AgentTaskMemberStatus): void {
    const task = this.tasks.get(groupId);
    if (!task) return;

    const member = task.members.find((m) => m.id === memberId);
    if (member) {
      member.status = status;
      if (status === 'running' && !member.startTime) {
        member.startTime = Date.now();
      }
      if (status === 'completed' || status === 'failed') {
        member.endTime = Date.now();
      }
    }
  }

  // ─── 私有方法 ─────────────────────────────────────────

  /** 后台执行任务 */
  private async runTask(
    task: AgentTaskGroup,
    executor: StartAgentTaskOptions['executor'],
  ): Promise<void> {
    const maxLifetime = this.getConfigValue('maxLifetimeMs');
    const timeoutTimer = setTimeout(() => {
      if (task.status === 'running') {
        log.warn(`Task ${task.groupId} timed out after ${maxLifetime}ms`);
        task.abortController.abort();
        task.status = 'failed';
        task.completedAt = Date.now();
        task.result = {
          content: `后台任务超时 (${Math.round(maxLifetime / 3600_000)}小时)，已自动取消`,
          isError: true,
        };
        this.notifyCompletion(task, 'failed');
        this.autoCleanup();
      }
    }, maxLifetime);

    try {
      task.progress.phase = 'executing';
      const result = await executor(task.abortController.signal, (progressUpdate) => {
        Object.assign(task.progress, progressUpdate);
        task.progress.elapsed = Date.now() - task.startedAt;
      }, task.groupId);

      clearTimeout(timeoutTimer);

      if (task.status === 'cancelled') {
        return; // 执行期间被取消
      }

      task.status = result.isError ? 'failed' : 'completed';
      task.result = result;
      task.completedAt = Date.now();
      task.progress.phase = 'synthesizing';
      task.progress.completedMembers = task.progress.totalMembers;

      this.notifyCompletion(task, task.status);
    } catch (err) {
      clearTimeout(timeoutTimer);

      if (task.status === 'cancelled') {
        return;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('abort') || errMsg.includes('AbortError')) {
        task.status = 'cancelled';
      } else {
        task.status = 'failed';
      }
      task.completedAt = Date.now();
      task.result = {
        content: `后台任务执行失败: ${errMsg}`,
        isError: true,
      };

      this.notifyCompletion(task, task.status);
    } finally {
      this.autoCleanup();
    }
  }

  /** 通知完成 */
  private notifyCompletion(task: AgentTaskGroup, status: AgentTaskStatus): void {
    const completionResult: AgentTaskCompletionResult = {
      groupId: task.groupId,
      status,
      result: task.result,
      error: status === 'failed' ? (task.result?.content ?? '未知错误') : undefined,
      completedAt: task.completedAt ?? Date.now(),
    };

    // 通知任务特定的回调
    for (const callback of task.completionCallbacks) {
      callback(completionResult);
    }
    task.completionCallbacks.clear();

    // 通知全局回调（AgentLoop）
    if (this.globalCompletionCallback) {
      this.globalCompletionCallback(completionResult);
    }
  }

  /** 自动清理旧任务 */
  private autoCleanup(): void {
    const maxCompleted = this.getConfigValue('maxCompletedTasks');
    const completed = Array.from(this.tasks.entries())
      .filter(([, t]) => t.status !== 'running')
      .sort((a, b) => (b[1].completedAt ?? 0) - (a[1].completedAt ?? 0));

    if (completed.length > maxCompleted) {
      for (const [id] of completed.slice(maxCompleted)) {
        this.tasks.delete(id);
      }
    }
  }

  /** 从 RuntimeConfig 读取配置值 */
  private getConfigValue<K extends keyof AsyncAgentTaskConfig>(key: K): AsyncAgentTaskConfig[K] {
    const runtimeConfig = getRuntimeConfig();
    const asyncConfig = runtimeConfig?.agent?.asyncAgentTasks;
    if (asyncConfig && key in asyncConfig) {
      return asyncConfig[key] as AsyncAgentTaskConfig[K];
    }
    return this.config[key];
  }
}
