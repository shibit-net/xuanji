/**
 * TaskOrchestrator — 后台任务管理器
 *
 * 管理后台运行的 Agent 任务组（team/task）。
 * 单例模式。主 agent 委派后立即返回，任务完成后通过 EventBus 通知 TaskCompletionHandler，
 * 主 agent 空闲时逐个取出结果进行汇总汇报。
 *
 * 统一替代旧的 TaskScheduler / ExecutionEngine / TaskPlanner 体系。
 */

import { randomUUID } from 'node:crypto';
import { getRuntimeConfig } from '@/core/config/RuntimeConfig';
import { logger } from '@/core/logger';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import { TaskCompletionHandler } from '@/core/agent/async/TaskCompletionHandler';
import type {
  TaskGroup,
  TaskStatus,
  TaskProgress,
  TaskMemberStatus,
  TaskMember,
  TaskCompletionCallback,
  TaskCompletionResult,
  StartTaskOptions,
  TaskOrchestratorConfig,
} from './types';
import type { ContextManager } from '@/core/context/ContextManager';

const log = logger.child({ module: 'TaskOrchestrator' });

/** 默认配置 */
const DEFAULT_CONFIG: TaskOrchestratorConfig = {
  maxConcurrent: 3,
  maxLifetimeMs: 4 * 3600_000, // 4 小时
  maxCompletedTasks: 20,
};

export class TaskOrchestrator {
  private static instance: TaskOrchestrator | null = null;

  private tasks: Map<string, TaskGroup> = new Map();
  private config: TaskOrchestratorConfig;
  /** 全局完成回调（通知 TaskCompletionHandler） */
  private globalCompletionCallback: TaskCompletionCallback | null = null;

  /** TaskCompletionHandler — 后台任务完成通知（与主 agent 汇报队列对接） */
  private taskCompletionHandler: TaskCompletionHandler | null = null;

  private constructor(config?: Partial<TaskOrchestratorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  static getInstance(config?: Partial<TaskOrchestratorConfig>): TaskOrchestrator {
    if (!TaskOrchestrator.instance) {
      TaskOrchestrator.instance = new TaskOrchestrator(config);
    }
    return TaskOrchestrator.instance;
  }

  static resetInstance(): void {
    if (TaskOrchestrator.instance) {
      TaskOrchestrator.instance.stopAll();
      TaskOrchestrator.instance = null;
    }
  }

  /** 注册全局完成回调（TaskCompletionHandler 设置） */
  onTaskCompleted(callback: TaskCompletionCallback): void {
    this.globalCompletionCallback = callback;
  }

  /** 初始化 TaskCompletionHandler（由 SessionFactory 在创建会话时调用） */
  initCompletionHandler(contextManager: ContextManager): TaskCompletionHandler {
    if (!this.taskCompletionHandler) {
      this.taskCompletionHandler = new TaskCompletionHandler(contextManager, {
        onAutoSummarize: () => { eventBus.emit(XuanjiEvent.ASYNC_TASK_COMPLETED, { taskId: '' }); },
        onCitationData: () => {},
        onRun: async () => {},
        isRunning: () => false,
      });
      this.taskCompletionHandler.register();
    }
    return this.taskCompletionHandler;
  }

  /** 获取 TaskCompletionHandler（供 SessionFactory 替换 callbacks） */
  getCompletionHandler(): TaskCompletionHandler | null {
    return this.taskCompletionHandler;
  }

  /** 启动后台 Agent 任务 */
  startTask(options: StartTaskOptions): { groupId: string; error?: string } {
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
    const progress: TaskProgress = {
      phase: 'setup',
      totalMembers: options.members?.length ?? 1,
      completedMembers: 0,
      elapsed: 0,
    };

    const taskGroup: TaskGroup = {
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
      subAgentId: options.subAgentId,
    };

    this.tasks.set(groupId, taskGroup);

    // 后台启动执行
    this.runTask(taskGroup, options.executor);

    return { groupId };
  }

  /** 查询任务进度 */
  getProgress(groupId: string): {
    found: boolean;
    status?: TaskStatus;
    progress?: TaskProgress;
    goal?: string;
    type?: string;
    startedAt?: number;
    completedAt?: number;
    members?: TaskMember[];
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
      members: task.members.map(m => ({ ...m })),
    };
  }

  /** 获取任务结果（可阻塞等待） */
  async getResult(
    groupId: string,
    block: boolean = true,
    timeout: number = 30_000,
  ): Promise<{ found: boolean; status?: TaskStatus; result?: string; error?: string }> {
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

      const callback: TaskCompletionCallback = (result) => {
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
    status: TaskStatus;
    progress: TaskProgress;
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
  updateMemberStatus(
    groupId: string,
    memberId: string,
    status: TaskMemberStatus,
    details?: { failureReason?: string; retryCount?: number },
  ): void {
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
      if (details?.failureReason) member.failureReason = details.failureReason;
      if (details?.retryCount !== undefined) member.retryCount = details.retryCount;
    }
  }

  // ─── 私有方法 ─────────────────────────────────────────

  /** 后台执行任务 */
  private async runTask(
    task: TaskGroup,
    executor: StartTaskOptions['executor'],
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
      log.error(`[TaskOrchestrator] Task ${task.groupId} execution failed:`, { error: errMsg, stack: err instanceof Error ? err.stack : undefined });
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
  private notifyCompletion(task: TaskGroup, status: TaskStatus): void {
    const completionResult: TaskCompletionResult = {
      groupId: task.groupId,
      status,
      result: task.result,
      error: status === 'failed' ? (task.result?.content ?? '未知错误') : undefined,
      completedAt: task.completedAt ?? Date.now(),
      subAgentId: task.subAgentId,
    };

    // 通知任务特定的回调
    for (const callback of task.completionCallbacks) {
      callback(completionResult);
    }
    task.completionCallbacks.clear();

    // 通知全局回调（TaskCompletionHandler）
    if (this.globalCompletionCallback) {
      this.globalCompletionCallback(completionResult);
    }

    // 通过 EventBus 发出事件（模块间解耦）
    const event = status === 'completed' ? XuanjiEvent.ASYNC_TASK_COMPLETED : XuanjiEvent.ASYNC_TASK_FAILED;
    eventBus.emit(event, completionResult);
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
  private getConfigValue<K extends keyof TaskOrchestratorConfig>(key: K): TaskOrchestratorConfig[K] {
    const runtimeConfig = getRuntimeConfig();
    const asyncConfig = runtimeConfig?.agent?.asyncAgentTasks;
    if (asyncConfig && key in asyncConfig) {
      return asyncConfig[key] as TaskOrchestratorConfig[K];
    }
    return this.config[key];
  }
}
