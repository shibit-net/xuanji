/**
 * 跨平台工具函数 — 进程管理、Shell 适配
 *
 * Windows 不支持 POSIX 信号（SIGTERM/SIGKILL/SIGINT），
 * 需要根据平台选择对应的进程终止方式和 Shell 命令。
 */

import { type ChildProcess } from 'node:child_process';
import { execSync } from 'node:child_process';

const isWindows = process.platform === 'win32';

// ============================================================
// Shell 检测与适配
// ============================================================

/** 缓存 bash 可用性检测结果 */
let bashAvailable: boolean | null = null;

/** 检测 bash 是否可用（Windows 上需要 Git Bash 或 WSL） */
export function isBashAvailable(): boolean {
  if (bashAvailable !== null) return bashAvailable;
  try {
    execSync(isWindows ? 'where bash' : 'which bash', { stdio: 'ignore', timeout: 3000 });
    bashAvailable = true;
  } catch {
    bashAvailable = false;
  }
  return bashAvailable;
}

/** 重置 bash 可用性缓存（用于测试） */
export function resetBashAvailableCache(): void {
  bashAvailable = null;
}

/** 获取平台对应的 Shell 可执行文件路径 */
export function getPlatformShell(): string {
  if (isWindows) {
    return isBashAvailable() ? 'bash' : 'cmd.exe';
  }
  return 'bash';
}

/** 获取 Shell 启动参数 */
export function getShellArgs(): string[] {
  if (isWindows && !isBashAvailable()) {
    // cmd.exe: /q 关闭回显, /k 保持运行（交互式）, /d 跳过 AutoRun
    return ['/q', '/d'];
  }
  // bash: 无编辑、无 profile、无 rc
  return ['--noediting', '--noprofile', '--norc'];
}

/** 获取在 Shell 中执行单条命令的包装方式 */
export function getShellCommandWrapper(command: string): string {
  if (isWindows && !isBashAvailable()) {
    return `cmd.exe /q /c ${command}`;
  }
  return `bash -c ${JSON.stringify(command)}`;
}

/** 获取 Shell spawn 选项的 env 补充 */
export function getShellEnv(): Record<string, string> {
  if (isWindows && !isBashAvailable()) {
    return { PROMPT: '$P$G' };
  }
  return { PS1: '', PS2: '', PROMPT_COMMAND: '' };
}

// ============================================================
// cd 命令适配
// ============================================================

/** 获取 cd 命令（cmd.exe 需要 /d 以切换驱动器） */
export function getCdCommand(dir: string): string {
  if (isWindows && !isBashAvailable()) {
    return `cd /d ${JSON.stringify(dir)}`;
  }
  return `cd ${JSON.stringify(dir)}`;
}

/** 获取 cd + 错误处理命令 */
export function getCdWithErrorHandling(dir: string): string {
  if (isWindows && !isBashAvailable()) {
    return `cd /d ${JSON.stringify(dir)} 2>nul || (echo ERROR: Cannot cd to ${JSON.stringify(dir)} & exit 1)`;
  }
  return `cd ${JSON.stringify(dir)} 2>/dev/null || { echo "ERROR: Cannot cd to ${JSON.stringify(dir)}"; exit 1; }`;
}

// ============================================================
// 标记协议（退出码 + 工作目录）
// ============================================================

/** 获取输出标记命令（输出 exitCode:cwd 用于解析） */
export function getMarkerCommand(marker: string): string {
  if (isWindows && !isBashAvailable()) {
    return `echo ${marker}:%errorlevel%:%cd%`;
  }
  return `echo "${marker}:$?:$(pwd)"`;
}

// ============================================================
// 进程终止
// ============================================================

/**
 * 跨平台强制终止子进程
 *
 * Windows: 不支持 POSIX 信号，SIGTERM/SIGKILL/SIGINT 会抛出 ERR_UNKNOWN_SIGNAL。
 * 使用 taskkill /F /T 强制终止进程树。
 *
 * POSIX: 依次尝试 SIGTERM（优雅关闭），等待后 SIGKILL（强制终止）
 */
export function crossPlatformKill(proc: ChildProcess, signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT'): void {
  if (isWindows) {
    try {
      execSync(`taskkill /F /T /PID ${proc.pid}`, {
        timeout: 3000,
        stdio: 'ignore',
      });
    } catch {
      // taskkill 失败时回退到 Node.js 默认 kill（无信号）
      try { proc.kill(); } catch { /* 进程可能已退出 */ }
    }
  } else {
    try {
      proc.kill(signal || 'SIGTERM');
    } catch {
      // 进程可能已退出
    }
  }
}

/**
 * 跨平台优雅终止子进程（先 SIGTERM，Windows 上用 taskkill 不带 /F）
 */
export function crossPlatformTerminate(proc: ChildProcess): boolean {
  if (proc.killed || proc.exitCode !== null) return false;

  if (isWindows) {
    try {
      // Windows: taskkill 不带 /F 发送 WM_CLOSE（类似 SIGTERM）
      execSync(`taskkill /PID ${proc.pid}`, {
        timeout: 3000,
        stdio: 'ignore',
      });
      return true;
    } catch {
      try { proc.kill(); } catch { /* ignore */ }
      return false;
    }
  } else {
    return proc.kill('SIGTERM');
  }
}

/**
 * 跨平台中断子进程（发送 SIGINT / Ctrl+C）
 */
export function crossPlatformInterrupt(proc: ChildProcess): boolean {
  if (proc.killed || proc.exitCode !== null) return false;

  if (isWindows) {
    // Windows 不支持 SIGINT，使用 taskkill 不带 /F
    try {
      execSync(`taskkill /PID ${proc.pid}`, {
        timeout: 3000,
        stdio: 'ignore',
      });
      return true;
    } catch {
      try { proc.kill(); } catch { /* ignore */ }
      return false;
    }
  } else {
    return proc.kill('SIGINT');
  }
}

/**
 * 获取 Node.js exec/spawn 的 shell 路径
 */
export function getExecShellPath(): string {
  if (isWindows) {
    // Windows: 如果 bash 可用，优先使用 bash；否则用 cmd.exe
    if (isBashAvailable()) return 'bash';
    // 获取 COMSPEC 环境变量（通常是 cmd.exe）
    return process.env.COMSPEC || 'cmd.exe';
  }
  return '/bin/sh';
}

/**
 * 获取 spawn 的 shell 选项（可以传 true 让 Node 自动检测）
 */
export function getSpawnShellOption(): string | boolean {
  if (isWindows) {
    return isBashAvailable() ? 'bash' : true;
  }
  return '/bin/sh';
}
