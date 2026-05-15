// ============================================================
// M6 工具系统 — PersistentShell 持久化 Shell 会话
// ============================================================
//
// 维护一个长驻 bash 子进程，cwd 和环境变量跨调用保持。
// 使用 stdin/stdout 管道通信，通过唯一标记行分隔输出。
//
// 跨平台: Windows 无 bash（Git Bash/WSL）时降级为一次性 exec 模式。

import { spawn, exec, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { logger } from '@/core/logger';
import {
  crossPlatformKill,
  crossPlatformInterrupt,
  crossPlatformTerminate,
  detectShell,
  getPlatformShell,
  getShellArgs,
  getShellEnv,
  getCdCommand,
  getCdWithErrorHandling,
  getMarkerCommand,
} from '@/shared/utils/crossPlatform';

const log = logger.child({ module: 'PersistentShell' });

/**
 * 需要从 Shell 子进程中清除的敏感环境变量
 * 防止通过 `env` 或 `printenv` 泄漏凭据
 */
const SENSITIVE_ENV_VARS = [
  'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN', 'GH_TOKEN', 'GITLAB_TOKEN',
  'NPM_TOKEN', 'PYPI_TOKEN',
  'DATABASE_URL', 'DATABASE_PASSWORD',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'XUANJI_API_KEY',
  'JASYPT_ENCRYPTOR_PASSWORD',
];

/**
 * 持久化 Shell 执行结果
 */
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** 检测当前平台是否支持持久化 Shell（需要 bash 或 pwsh） */
function supportsPersistentShell(): boolean {
  if (process.platform !== 'win32') return true;
  const shell = detectShell();
  return shell === 'bash' || shell === 'pwsh';
}

/**
 * 持久化 Shell — 维护长驻 bash 子进程
 *
 * 特点:
 * - cwd / 环境变量 / alias 跨调用保持
 * - 通过标记行分隔每次命令的输出
 * - 超时保护
 * - 自动重启（进程异常退出时）
 * - Windows 无 bash 时自动降级为一次性 exec
 */
export class PersistentShell {
  private proc: ChildProcess | null = null;
  private initialCwd: string;
  private _ready = false;
  /** 并发保护：当前是否有命令正在执行 */
  private _executing = false;
  /** 超时后需要重建 Shell（防止 stdout 残留污染下次命令） */
  private _needsReset = false;
  /** 最后已知的工作目录（reset 时用于恢复） */
  private _lastKnownCwd: string;
  /** 排队等待执行的命令 */
  private _queue: Array<{
    command: string;
    timeout: number;
    cwd?: string;
    resolve: (result: ShellResult) => void;
    reject: (error: Error) => void;
  }> = [];
  /** Windows 降级模式：是否使用一次性 exec 而非持久化 shell */
  private readonly _fallbackMode: boolean;

  constructor(cwd?: string) {
    this.initialCwd = cwd ?? process.cwd();
    this._lastKnownCwd = this.initialCwd;
    this._fallbackMode = !supportsPersistentShell();
  }

  /**
   * 确保 shell 进程已启动
   */
  private ensureRunning(): void {
    if (this._fallbackMode) return; // 降级模式无需持久进程
    if (this.proc && !this.proc.killed && this.proc.exitCode === null) {
      return;
    }
    this.spawn();
  }

  /**
   * 启动 bash 子进程
   */
  private spawn(): void {
    // 清理敏感环境变量，防止通过 env/printenv 泄漏
    const cleanEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !SENSITIVE_ENV_VARS.includes(key)) {
        cleanEnv[key] = value;
      }
    }

    this.proc = spawn(getPlatformShell(), getShellArgs(), {
      cwd: this.initialCwd,
      env: { ...cleanEnv, ...getShellEnv() },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.on('exit', (code) => {
      log.debug(`Shell process exited with code ${code}`);
      this._ready = false;
    });

    this.proc.on('error', (err) => {
      log.warn('Shell process error:', err.message);
      this._ready = false;
    });

    this._ready = true;
    log.debug(`Shell spawned (pid=${this.proc.pid}, cwd=${this.initialCwd})`);
  }

  /**
   * 执行命令并等待结果（带并发排队保护）
   */
  async execute(command: string, timeout: number, cwd?: string): Promise<ShellResult> {
    // 如果已有命令在执行，排队等待
    if (this._executing) {
      return new Promise<ShellResult>((resolve, reject) => {
        this._queue.push({ command, timeout, cwd, resolve, reject });
      });
    }

    this._executing = true;
    try {
      return await this._executeInternal(command, timeout, cwd);
    } finally {
      this._executing = false;
      // 处理排队的下一个命令
      this._processQueue();
    }
  }

  /**
   * 处理排队的命令
   */
  private _processQueue(): void {
    if (this._queue.length === 0) return;
    const next = this._queue.shift()!;
    // 使用 execute 而非 _executeInternal 以保持互斥
    this.execute(next.command, next.timeout, next.cwd).then(next.resolve, next.reject);
  }

  /**
   * 内部执行命令（无并发保护）
   */
  private async _executeInternal(command: string, timeout: number, cwd?: string): Promise<ShellResult> {
    // 降级模式：使用 exec 一次性执行
    if (this._fallbackMode) {
      return this._executeFallback(command, timeout, cwd);
    }

    // 超时后重建 Shell，防止残留 stdout 污染
    if (this._needsReset) {
      this._needsReset = false;
      this.reset();
    }

    // 如果指定了 cwd 且与 shell 当前目录不同，先 cd 切换
    if (cwd && cwd !== this._lastKnownCwd) {
      command = `${getCdWithErrorHandling(cwd)}\n${command}`;
      this._lastKnownCwd = cwd;
    }

    this.ensureRunning();

    const proc = this.proc!;
    if (!proc.stdin || !proc.stdout || !proc.stderr) {
      throw new Error('Shell process stdio not available');
    }

    // 唯一标记
    const marker = `__XUANJI_MARKER_${randomBytes(16).toString('hex')}__`;

    return new Promise<ShellResult>((resolve, reject) => {
      let stdoutBuf = '';
      let stderrBuf = '';
      let settled = false;

      const cleanup = () => {
        proc.stdout?.removeListener('data', onStdout);
        proc.stderr?.removeListener('data', onStderr);
        proc.removeListener('exit', onExit);
        clearTimeout(timer);
      };

      const settle = (result: ShellResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        // 超时：中断当前命令（不杀 shell 进程）
        crossPlatformInterrupt(proc);
        // 标记需要重建 Shell（防止残留 stdout 污染下次命令）
        this._needsReset = true;
        reject(new Error(`命令超时 (${timeout}ms)`));
      }, timeout);

      const onStdout = (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf-8');

        // 检查是否包含标记行
        const markerPattern = `${marker}:`;
        const idx = stdoutBuf.indexOf(markerPattern);
        if (idx !== -1) {
          // 找到标记行 -> 提取退出码和当前工作目录
          // 格式: marker:exitCode:cwd
          const afterMarker = stdoutBuf.slice(idx + markerPattern.length);
          const newlineIdx = afterMarker.indexOf('\n');
          const markerData = newlineIdx !== -1
            ? afterMarker.slice(0, newlineIdx).trim()
            : afterMarker.trim();

          // 解析 exitCode:cwd（cwd 本身可能包含冒号，只按第一个冒号分割）
          const firstColon = markerData.indexOf(':');
          const exitCodeStr = firstColon !== -1 ? markerData.slice(0, firstColon) : markerData;
          const cwdStr = firstColon !== -1 ? markerData.slice(firstColon + 1) : '';
          const exitCode = parseInt(exitCodeStr, 10);

          // 更新最后已知的工作目录
          if (cwdStr) {
            this._lastKnownCwd = cwdStr;
          }

          // 标记行之前的内容是命令输出
          const output = stdoutBuf.slice(0, idx);

          // 给 stderr 一点时间到达
          setTimeout(() => {
            settle({
              stdout: output.replace(/\n$/, ''),
              stderr: stderrBuf.replace(/\n$/, ''),
              exitCode: isNaN(exitCode) ? 1 : exitCode,
            });
          }, 10);
        }
      };

      const onStderr = (chunk: Buffer) => {
        stderrBuf += chunk.toString('utf-8');
      };

      proc.stdout?.on('data', onStdout);
      proc.stderr?.on('data', onStderr);

      // 处理进程意外退出
      const onExit = (code: number | null) => {
        if (!settled) {
          settled = true;
          cleanup();
          proc.removeListener('exit', onExit);
          resolve({
            stdout: stdoutBuf,
            stderr: stderrBuf,
            exitCode: code ?? 1,
          });
        }
      };
      proc.once('exit', onExit);

      // 写入命令：执行命令后输出标记行+退出码+当前工作目录
      const wrappedCmd = `${command}\n${getMarkerCommand(marker)}\n`;
      proc.stdin!.write(wrappedCmd);
    });
  }

  /**
   * 降级模式：使用 child_process.exec 一次性执行命令
   */
  private _executeFallback(command: string, timeout: number, cwd?: string): Promise<ShellResult> {
    const workDir = cwd ?? this._lastKnownCwd;
    return new Promise<ShellResult>((resolve) => {
      const child = exec(
        command,
        {
          cwd: workDir,
          timeout,
          maxBuffer: 10 * 1024 * 1024, // 10MB
          env: { ...process.env },
        },
        (error, stdout, stderr) => {
          if (error) {
            resolve({
              stdout: stdout?.toString() ?? '',
              stderr: stderr?.toString() ?? (error.message || ''),
              exitCode: (error as any).code ?? 1,
            });
            return;
          }
          resolve({
            stdout: stdout?.toString() ?? '',
            stderr: stderr?.toString() ?? '',
            exitCode: 0,
          });
        },
      );
    });
  }

  /**
   * 重置 Shell（销毁重建，恢复到最后已知的工作目录）
   */
  reset(): void {
    if (this._fallbackMode) return; // 降级模式无需重置
    const cwdToRestore = this._lastKnownCwd;
    this.close();
    this.spawn();
    // 如果最后已知的 cwd 与初始 cwd 不同，在新 shell 中恢复目录
    if (cwdToRestore !== this.initialCwd && this.proc?.stdin) {
      this.proc.stdin.write(`${getCdCommand(cwdToRestore)}\n`);
    }
  }

  /**
   * 关闭 Shell
   */
  close(): void {
    // 拒绝所有排队中的命令，防止 Promise 永远 pending（内存泄漏）
    const pendingQueue = this._queue.splice(0);
    for (const item of pendingQueue) {
      item.reject(new Error('Shell closed'));
    }

    if (this.proc && !this.proc.killed) {
      this.proc.stdin?.end();
      crossPlatformTerminate(this.proc);
      this.proc = null;
    }
    this._ready = false;
  }

  /**
   * 是否就绪
   */
  get ready(): boolean {
    return this._fallbackMode || (this._ready && this.proc !== null && !this.proc.killed);
  }
}

// ─── 全局单例 ─────────────────────────────────────────

let sharedShell: PersistentShell | null = null;

/**
 * 获取共享的持久化 Shell 实例
 */
export function getSharedShell(cwd?: string): PersistentShell {
  if (!sharedShell || !sharedShell.ready) {
    sharedShell = new PersistentShell(cwd);
  }
  return sharedShell;
}

/**
 * 关闭共享 Shell（进程退出时调用）
 */
export function closeSharedShell(): void {
  if (sharedShell) {
    sharedShell.close();
    sharedShell = null;
  }
}
