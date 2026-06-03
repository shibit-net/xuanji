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
import { createRequire } from 'node:module';
import { logger } from '@/infrastructure/logger';
import {
  getPlatformShell,
  getShellExecArgs,
  getSpawnShellOption,
} from '@/shared/utils/crossPlatform';
import { chmodSync, accessSync, constants } from 'node:fs';
import { join, dirname } from 'node:path';

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

/** 确保 spawn-helper 有执行权限（macOS 上 npm 可能丢失 x 位） */
function ensureSpawnHelperExecutable(ptyModule: typeof import('node-pty')): boolean {
  try {
    // 通过 node-pty 的内部路径推断 spawn-helper 位置
    const req = createRequire(import.meta.url);
    const nativeModulePath = req.resolve('node-pty');
    const ptyDir = dirname(nativeModulePath);
    // node-pty 的 lib/unixTerminal.js 中 helperPath 在 prebuilds/<platform>-<arch>/spawn-helper
    const helperPath = join(ptyDir, '..', 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
    // 检查是否存在
    accessSync(helperPath, constants.F_OK);
    // 检查是否有执行权限并修复
    try {
      accessSync(helperPath, constants.X_OK);
      return true; // 已有执行权限
    } catch {
      // 没有执行权限，尝试修复
      chmodSync(helperPath, 0o755);
      log.info(`Fixed spawn-helper permissions: ${helperPath}`);
      return true;
    }
  } catch (err) {
    log.error(`spawn-helper not found or not fixable: ${err}`);
    return false;
  }
}

function loadPty(): typeof import('node-pty') | null {
  if (!_ptyLoadAttempted) {
    _ptyLoadAttempted = true;
    try {
      const req = createRequire(import.meta.url);
      _ptyModule = req('node-pty');
      // POSIX 上 spawn-helper 可能因 npm 安装时丢失执行权限，
      // 导致 posix_spawn 失败（Permission denied）
      if (process.platform !== 'win32' && _ptyModule && !ensureSpawnHelperExecutable(_ptyModule)) {
        log.warn('node-pty spawn-helper not executable, falling back to child_process.exec');
        _ptyModule = null;
        return null;
      }
      log.info('node-pty loaded');
    } catch (err: any) {
      log.warn(`node-pty unavailable: ${err?.code || err?.message}`);
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
      log.warn('[DIAG] node-pty not loaded, using executeFallback');
      return this.executeFallback(command, timeout, workDir);
    }

    log.info(`[DIAG] Using node-pty, shell=${getPlatformShell()}, PATH=${process.env.PATH?.substring(0, 80)}...`);
    try {
      return await this.executePty(ptyMod, command, timeout, workDir);
    } catch (err) {
      log.warn(`[DIAG] node-pty spawn failed (${(err as Error).message}), falling back to child_process.exec`);
      return this.executeFallback(command, timeout, workDir);
    }
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
        const e = err as any;
        log.error(`[DIAG] node-pty spawn FAILED: message="${e.message}", code=${e.code}, errno=${e.errno}, syscall="${e.syscall}", path="${e.path}", shell=${getPlatformShell()}`);
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
      log.info(`[DIAG] executeFallback: PATH=${process.env.PATH?.substring(0, 80)}..., shell defaults to /bin/sh`);
      exec(
        command,
        { cwd, timeout, maxBuffer: 10 * 1024 * 1024, env: process.env as any, shell: getSpawnShellOption() as string | undefined },
        (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => {
          if (error) {
            const e = error as any;
            log.error(`[DIAG] executeFallback FAILED: message="${e.message}", code=${e.code}, errno=${e.errno}, syscall="${e.syscall}", path="${e.path}", cmd="${e.cmd}"`);
            resolve({
              stdout: stdout?.toString() ?? '',
              stderr: stderr?.toString() ?? (error.message || ''),
              exitCode: (error as any).code ?? 1,
            });
            return;
          }
          resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '', exitCode: 0 });
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
