// ============================================================
// M6 工具系统 — 后台任务管理器
// ============================================================

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/** 后台任务最大生存时间 (ms) — 1 小时 */
const MAX_TASK_LIFETIME = 3_600_000;

/** 最大同时运行的后台任务数 */
const MAX_CONCURRENT_TASKS = 5;

/** 后台任务状态 */
export type BackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'timeout';

/** 后台任务结果 */
export interface BackgroundTaskResult {
  taskId: string;
  status: BackgroundTaskStatus;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  command: string;
  startedAt: number;
  completedAt?: number;
}

/** 内部任务条目 */
interface TaskEntry {
  taskId: string;
  command: string;
  process: ChildProcess;
  startedAt: number;
  completedAt?: number;
  status: BackgroundTaskStatus;
  exitCode?: number;
  stdoutChunks: Buffer[];
  stderrChunks: Buffer[];
  lifetimeTimer: ReturnType<typeof setTimeout>;
  resolvers: Array<(result: BackgroundTaskResult) => void>;
}

/**
 * BackgroundTaskManager — 管理后台运行的 Bash 任务
 *
 * 单例模式，生命周期跟随应用。
 */
export class BackgroundTaskManager {
  private static instance: BackgroundTaskManager | null = null;
  private tasks: Map<string, TaskEntry> = new Map();

  static getInstance(): BackgroundTaskManager {
    if (!BackgroundTaskManager.instance) {
      BackgroundTaskManager.instance = new BackgroundTaskManager();
    }
    return BackgroundTaskManager.instance;
  }

  /**
   * 启动后台任务
   */
  startTask(command: string): BackgroundTaskResult {
    // 检查并发限制
    const runningCount = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'running',
    ).length;
    if (runningCount >= MAX_CONCURRENT_TASKS) {
      return {
        taskId: '',
        status: 'failed',
        command,
        startedAt: Date.now(),
        stderr: `已达后台任务上限 (${MAX_CONCURRENT_TASKS})，请等待现有任务完成或使用 task_output 查看结果后再试。`,
      };
    }

    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const proc = spawn('bash', ['-c', command], {
      cwd: process.cwd(),
      env: { ...process.env },
    });

    const entry: TaskEntry = {
      taskId,
      command,
      process: proc,
      startedAt: Date.now(),
      status: 'running',
      stdoutChunks: [],
      stderrChunks: [],
      resolvers: [],
      lifetimeTimer: setTimeout(() => {
        this.timeoutTask(taskId);
      }, MAX_TASK_LIFETIME),
    };

    proc.stdout?.on('data', (chunk: Buffer) => entry.stdoutChunks.push(chunk));
    proc.stderr?.on('data', (chunk: Buffer) => entry.stderrChunks.push(chunk));

    proc.on('close', (exitCode) => {
      entry.status = exitCode === 0 ? 'completed' : 'failed';
      entry.exitCode = exitCode ?? 1;
      entry.completedAt = Date.now();
      clearTimeout(entry.lifetimeTimer);

      // 通知所有等待者
      const result = this.buildResult(entry);
      for (const resolver of entry.resolvers) {
        resolver(result);
      }
      entry.resolvers = [];
    });

    proc.on('error', (err) => {
      entry.status = 'failed';
      entry.completedAt = Date.now();
      entry.stderrChunks.push(Buffer.from(err.message));
      clearTimeout(entry.lifetimeTimer);

      const result = this.buildResult(entry);
      for (const resolver of entry.resolvers) {
        resolver(result);
      }
      entry.resolvers = [];
    });

    this.tasks.set(taskId, entry);

    return {
      taskId,
      status: 'running',
      command,
      startedAt: entry.startedAt,
    };
  }

  /**
   * 获取任务结果
   *
   * @param taskId 任务 ID
   * @param block 是否等待完成（默认 true）
   * @param timeout 最大等待时间 (ms)
   */
  async getResult(
    taskId: string,
    block: boolean = true,
    timeout: number = 30_000,
  ): Promise<BackgroundTaskResult> {
    const entry = this.tasks.get(taskId);
    if (!entry) {
      return {
        taskId,
        status: 'failed',
        command: '',
        startedAt: 0,
        stderr: `任务不存在: ${taskId}`,
      };
    }

    // 已完成直接返回
    if (entry.status !== 'running') {
      return this.buildResult(entry);
    }

    // 不阻塞则返回当前状态
    if (!block) {
      return this.buildResult(entry);
    }

    // 阻塞等待
    return new Promise<BackgroundTaskResult>((resolve) => {
      const timer = setTimeout(() => {
        // 超时但任务还在运行，返回当前状态
        resolve({
          taskId,
          status: 'running',
          command: entry.command,
          startedAt: entry.startedAt,
          stdout: Buffer.concat(entry.stdoutChunks).toString('utf-8'),
          stderr: `等待超时 (${timeout}ms)，任务仍在运行中`,
        });
      }, timeout);

      entry.resolvers.push((result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
  }

  /**
   * 列出所有任务
   */
  listTasks(): BackgroundTaskResult[] {
    return Array.from(this.tasks.values()).map((entry) =>
      this.buildResult(entry),
    );
  }

  /**
   * 清理已完成的任务
   */
  cleanup(): number {
    let count = 0;
    for (const [id, entry] of this.tasks) {
      if (entry.status !== 'running') {
        this.tasks.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * 停止所有任务（应用退出时调用）
   */
  stopAll(): void {
    for (const entry of this.tasks.values()) {
      if (entry.status === 'running') {
        entry.process.kill('SIGTERM');
        clearTimeout(entry.lifetimeTimer);
      }
    }
    this.tasks.clear();
  }

  private timeoutTask(taskId: string): void {
    const entry = this.tasks.get(taskId);
    if (!entry || entry.status !== 'running') return;

    entry.process.kill('SIGTERM');
    entry.status = 'timeout';
    entry.completedAt = Date.now();

    const result = this.buildResult(entry);
    for (const resolver of entry.resolvers) {
      resolver(result);
    }
    entry.resolvers = [];
  }

  private buildResult(entry: TaskEntry): BackgroundTaskResult {
    return {
      taskId: entry.taskId,
      status: entry.status,
      exitCode: entry.exitCode,
      stdout: Buffer.concat(entry.stdoutChunks).toString('utf-8'),
      stderr: Buffer.concat(entry.stderrChunks).toString('utf-8'),
      command: entry.command,
      startedAt: entry.startedAt,
      completedAt: entry.completedAt,
    };
  }
}
