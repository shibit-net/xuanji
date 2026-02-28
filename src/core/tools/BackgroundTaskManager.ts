// ============================================================
// M6 工具系统 — 后台任务管理器
// ============================================================

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getToolTimeouts, getConcurrencyConfig } from '@/core/config/RuntimeConfig';

/** 后台任务最大生存时间 (ms) — 1 小时 */
const MAX_TASK_LIFETIME = 3_600_000;

/** 最大同时运行的后台任务数 */
const MAX_CONCURRENT_TASKS = 5;

/** 单个任务输出上限 (bytes) — 10MB */
const MAX_OUTPUT_SIZE = 10 * 1024 * 1024;

/** 自动清理时保留的已完成任务数上限 */
const MAX_COMPLETED_TASKS = 50;

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
  /** 已累积的总输出大小（bytes） */
  outputSize: number;
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
   * 重置单例（停止所有任务并销毁实例）
   * 用于进程退出或测试场景
   */
  static resetInstance(): void {
    if (BackgroundTaskManager.instance) {
      BackgroundTaskManager.instance.stopAll();
      BackgroundTaskManager.instance = null;
    }
  }

  /**
   * 启动后台任务
   */
  startTask(command: string, env?: Record<string, string>): BackgroundTaskResult {
    const maxConcurrent = getConcurrencyConfig()?.maxBackgroundTasks ?? MAX_CONCURRENT_TASKS;
    // 检查并发限制
    const runningCount = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'running',
    ).length;
    if (runningCount >= maxConcurrent) {
      return {
        taskId: '',
        status: 'failed',
        command,
        startedAt: Date.now(),
        stderr: `已达后台任务上限 (${maxConcurrent})，请等待现有任务完成或使用 task_output 查看结果后再试。`,
      };
    }

    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const proc = spawn('bash', ['-c', command], {
      cwd: process.cwd(),
      env: env ?? { ...process.env },
    });

    const entry: TaskEntry = {
      taskId,
      command,
      process: proc,
      startedAt: Date.now(),
      status: 'running',
      stdoutChunks: [],
      stderrChunks: [],
      outputSize: 0,
      resolvers: [],
      lifetimeTimer: setTimeout(() => {
        this.timeoutTask(taskId);
      }, getToolTimeouts()?.backgroundTask ?? MAX_TASK_LIFETIME),
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      entry.outputSize += chunk.byteLength;
      if (entry.outputSize <= MAX_OUTPUT_SIZE) {
        entry.stdoutChunks.push(chunk);
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      entry.outputSize += chunk.byteLength;
      if (entry.outputSize <= MAX_OUTPUT_SIZE) {
        entry.stderrChunks.push(chunk);
      }
    });

    proc.on('close', (exitCode) => {
      // 如果已被标记为 timeout，不覆盖状态
      if (entry.status === 'timeout') return;
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
      this.autoCleanup();
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
      this.autoCleanup();
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
      const resolver = (result: BackgroundTaskResult) => {
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        // 超时：从 resolvers 中移除自己，防止闭包泄漏
        const idx = entry.resolvers.indexOf(resolver);
        if (idx !== -1) entry.resolvers.splice(idx, 1);
        resolve({
          taskId,
          status: 'running',
          command: entry.command,
          startedAt: entry.startedAt,
          stdout: Buffer.concat(entry.stdoutChunks).toString('utf-8'),
          stderr: `等待超时 (${timeout}ms)，任务仍在运行中`,
        });
      }, timeout);

      entry.resolvers.push(resolver);
    });
  }

  /**
   * 列出所有任务
   */
  listTasks(): BackgroundTaskResult[] {
    return Array.from(this.tasks.values()).map((entry) => {
      // 运行中的任务返回轻量结果，避免频繁 Buffer.concat
      if (entry.status === 'running') {
        return {
          taskId: entry.taskId,
          status: entry.status,
          command: entry.command,
          startedAt: entry.startedAt,
          stdout: `[运行中，已输出 ${entry.outputSize} bytes]`,
          stderr: '',
        };
      }
      return this.buildResult(entry);
    });
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
   * 确保所有 getResult() 等待者收到结果，不会永久 pending
   */
  stopAll(): void {
    for (const entry of this.tasks.values()) {
      clearTimeout(entry.lifetimeTimer);
      if (entry.status === 'running') {
        entry.process.kill('SIGTERM');
        entry.status = 'failed';
        entry.completedAt = Date.now();
      }

      // 通知所有等待者，防止 Promise 永久 pending
      if (entry.resolvers.length > 0) {
        const result = this.buildResult(entry);
        for (const resolver of entry.resolvers) {
          resolver(result);
        }
        entry.resolvers = [];
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

  /** 自动清理旧的已完成任务（保留最近 MAX_COMPLETED_TASKS 个） */
  private autoCleanup(): void {
    const completed = Array.from(this.tasks.entries())
      .filter(([, e]) => e.status !== 'running')
      .sort((a, b) => (b[1].completedAt ?? 0) - (a[1].completedAt ?? 0));

    if (completed.length > MAX_COMPLETED_TASKS) {
      for (const [id] of completed.slice(MAX_COMPLETED_TASKS)) {
        this.tasks.delete(id);
      }
    }
  }
}
