// ============================================================
// PTY Shell — 基于 node-pty 的一次性命令执行
// ============================================================
//
// 每次 execute() 通过 PTY spawn 独立 bash 进程，
// 拥有真实的 TTY，支持 ssh / scp 等交互式命令。
// 输出通过 onData 收集，退出码通过 onExit 获取。
//
// node-pty 加载失败时降级为 child_process.exec（无 TTY）。

import { exec } from 'node:child_process';
import { logger } from '@/core/logger';
import {
  getPlatformShell,
  getShellExecArgs,
} from '@/shared/utils/crossPlatform';

const log = logger.child({ module: 'PtyShell' });

/** 需要从子进程中清除的敏感环境变量 */
const SENSITIVE_ENV_VARS = [
  'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'GITHUB_TOKEN', 'GH_TOKEN', 'GITLAB_TOKEN',
  'NPM_TOKEN', 'PYPI_TOKEN',
  'DATABASE_URL', 'DATABASE_PASSWORD',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'XUANJI_API_KEY',
  'JASYPT_ENCRYPTOR_PASSWORD',
];

/** node-pty 延迟加载 */
let _ptyModule: typeof import('node-pty') | null = undefined as any;
let _ptyLoadAttempted = false;

function loadPty(): typeof import('node-pty') | null {
  if (!_ptyLoadAttempted) {
    _ptyLoadAttempted = true;
    try {
      _ptyModule = require('node-pty');
    } catch {
      log.warn('node-pty unavailable, falling back to child_process.exec (no TTY)');
    }
  }
  return _ptyModule;
}

/** 清理环境变量 */
function cleanEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SENSITIVE_ENV_VARS.includes(key)) {
      env[key] = value;
    }
  }
  return env;
}

/** 命令执行结果 */
export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * PTY Shell — 每次命令独立 spawn，无持久状态
 *
 * 与旧 PersistentShell 保持相同 API，
 * 但不再维护长驻 bash 进程。
 */
export class PersistentShell {
  private initialCwd: string;

  constructor(cwd?: string) {
    this.initialCwd = cwd ?? process.cwd();
  }

  get ready(): boolean {
    return true;
  }

  /** 关闭（无操作，保留兼容性） */
  close(): void {}

  /** 重置（无操作，保留兼容性） */
  reset(): void {}

  /** 执行命令 */
  async execute(command: string, timeout: number, cwd?: string): Promise<ShellResult> {
    const workDir = cwd ?? this.initialCwd;

    const ptyMod = loadPty();
    if (!ptyMod) {
      return this.executeFallback(command, timeout, workDir);
    }

    return this.executePty(ptyMod, command, timeout, workDir);
  }

  private executePty(
    ptyMod: typeof import('node-pty'),
    command: string,
    timeout: number,
    cwd: string,
  ): Promise<ShellResult> {
    return new Promise((resolve, reject) => {
      let output = '';
      let settled = false;
      let ptyProcess: import('node-pty').IPty | null = null;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ptyProcess?.kill(); } catch { /* ignore */ }
        reject(new Error(`命令超时 (${timeout}ms)`));
      }, timeout);

      try {
        ptyProcess = ptyMod.spawn(getPlatformShell(), getShellExecArgs(command), {
          cwd,
          cols: 120,
          rows: 40,
          env: cleanEnv(),
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      const dataDisposable = ptyProcess.onData((data: string) => {
        output += data;
      });

      const exitDisposable = ptyProcess.onExit(({ exitCode, signal }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        dataDisposable.dispose();
        exitDisposable.dispose();

        resolve({
          stdout: output.trimEnd(),
          stderr: '', // PTY 合并 stderr 到 stdout
          exitCode: exitCode ?? (signal ? 1 : 0),
        });
      });
    });
  }

  /** 降级：child_process.exec（无 TTY） */
  private executeFallback(command: string, timeout: number, cwd: string): Promise<ShellResult> {
    return new Promise((resolve) => {
      exec(
        command,
        { cwd, timeout, maxBuffer: 10 * 1024 * 1024, env: process.env as any },
        (error, stdout, stderr) => {
          if (error) {
            resolve({
              stdout: stdout ?? '',
              stderr: stderr ?? (error.message || ''),
              exitCode: (error as any).code ?? 1,
            });
            return;
          }
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 });
        },
      );
    });
  }
}

// ─── 全局单例 ─────────────────────────────────────────

let sharedShell: PersistentShell | null = null;

/** 获取共享的 Shell 实例 */
export function getSharedShell(cwd?: string): PersistentShell {
  if (!sharedShell) {
    sharedShell = new PersistentShell(cwd);
  }
  return sharedShell;
}

/** 关闭共享 Shell */
export function closeSharedShell(): void {
  if (sharedShell) {
    sharedShell.close();
    sharedShell = null;
  }
}
