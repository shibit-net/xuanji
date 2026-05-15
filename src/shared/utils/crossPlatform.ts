/**
 * 跨平台工具函数 — 进程管理、Shell 适配
 *
 * Windows 不支持 POSIX 信号（SIGTERM/SIGKILL/SIGINT），
 * 需要根据平台选择对应的进程终止方式和 Shell 命令。
 *
 * Shell 优先级: bash > pwsh (PowerShell) > cmd.exe
 */

import { type ChildProcess } from 'node:child_process';
import { execSync } from 'node:child_process';

const isWindows = process.platform === 'win32';

// ============================================================
// Shell 类型与检测
// ============================================================

/** 支持的 Shell 类型 */
export type ShellType = 'bash' | 'pwsh' | 'cmd';

/** 缓存的 Shell 类型 */
let _shellType: ShellType | null = null;

/** 缓存的 PowerShell 二进制名称: 'pwsh' (Core) 或 'powershell.exe' (Windows PS 5.1) */
let _pwshBinary: string | null = null;

/** 缓存 bash 可用性检测结果 */
let bashAvailable: boolean | null = null;

// ============================================================
// 检测函数
// ============================================================

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

/** 检测 PowerShell 是否可用（优先 pwsh Core，回退 powershell.exe） */
export function isPowerShellAvailable(): boolean {
  try {
    execSync(
      isWindows ? 'where pwsh 2>nul || where powershell 2>nul' : 'which pwsh',
      { stdio: 'ignore', timeout: 3000, shell: isWindows ? 'cmd.exe' : '/bin/sh' },
    );
    return true;
  } catch {
    return false;
  }
}

/** 获取 PowerShell 二进制名称（pwsh 优先） */
export function getPowerShellBinary(): string {
  if (_pwshBinary !== null) return _pwshBinary;
  try {
    execSync(isWindows ? 'where pwsh 2>nul' : 'which pwsh', {
      stdio: 'ignore',
      timeout: 3000,
      shell: isWindows ? 'cmd.exe' : '/bin/sh',
    });
    _pwshBinary = 'pwsh';
  } catch {
    _pwshBinary = 'powershell.exe';
  }
  return _pwshBinary;
}

/**
 * 检测最佳可用 Shell（带缓存）
 * 优先级: bash > pwsh > cmd.exe
 */
export function detectShell(_shellTypeHint?: ShellType): ShellType {
  if (_shellTypeHint) return _shellTypeHint;
  if (_shellType !== null) return _shellType;
  if (!isWindows) { _shellType = 'bash'; return 'bash'; }
  if (isBashAvailable()) { _shellType = 'bash'; return 'bash'; }
  if (isPowerShellAvailable()) { _shellType = 'pwsh'; return 'pwsh'; }
  _shellType = 'cmd';
  return 'cmd';
}

// ============================================================
// Shell 适配
// ============================================================

/** 获取平台对应的 Shell 可执行文件路径 */
export function getPlatformShell(): string {
  const shell = detectShell();
  switch (shell) {
    case 'bash': return 'bash';
    case 'pwsh': return getPowerShellBinary();
    case 'cmd':  return 'cmd.exe';
  }
}

/** 获取 Shell 启动参数（持久化 stdin 模式） */
export function getShellArgs(): string[] {
  const shell = detectShell();
  switch (shell) {
    case 'bash': return ['--noediting', '--noprofile', '--norc'];
    case 'pwsh': return ['-NoProfile', '-NoLogo', '-Command', '-'];
    case 'cmd':  return ['/q', '/d'];
  }
}

/** 获取执行单条命令的 spawn 参数 */
export function getShellExecArgs(command: string): string[] {
  const shell = detectShell();
  switch (shell) {
    case 'bash': return ['-c', command];
    case 'pwsh': return ['-NoProfile', '-NoLogo', '-Command', command];
    case 'cmd':  return ['/q', '/c', command];
  }
}

/** 获取在 Shell 中执行单条命令的包装方式（用于 exec 返回的命令行字符串） */
export function getShellCommandWrapper(command: string): string {
  const shell = detectShell();
  switch (shell) {
    case 'bash': return `bash -c ${JSON.stringify(command)}`;
    case 'pwsh': return `${getPowerShellBinary()} -NoProfile -NoLogo -Command ${JSON.stringify(command)}`;
    case 'cmd':  return `cmd.exe /q /c ${command}`;
  }
}

/** 获取 Shell spawn 选项的 env 补充 */
export function getShellEnv(): Record<string, string> {
  const shell = detectShell();
  switch (shell) {
    case 'bash': return { PS1: '', PS2: '', PROMPT_COMMAND: '' };
    case 'pwsh': return {}; // stdin 模式无需抑制提示符
    case 'cmd':  return { PROMPT: '$P$G' };
  }
}

// ============================================================
// cd 命令适配
// ============================================================

/** 获取 cd 命令 */
export function getCdCommand(dir: string, shellType?: ShellType): string {
  const shell = detectShell(shellType);
  switch (shell) {
    case 'bash': return `cd ${JSON.stringify(dir)}`;
    case 'pwsh': return `Set-Location -Path ${JSON.stringify(dir)}`;
    case 'cmd':  return `cd /d ${JSON.stringify(dir)}`;
  }
}

/** 获取 cd + 错误处理命令 */
export function getCdWithErrorHandling(dir: string, shellType?: ShellType): string {
  const shell = detectShell(shellType);
  switch (shell) {
    case 'bash':
      return `cd ${JSON.stringify(dir)} 2>/dev/null || { echo "ERROR: Cannot cd to ${JSON.stringify(dir)}"; exit 1; }`;
    case 'pwsh':
      return `try { Set-Location -Path ${JSON.stringify(dir)} -ErrorAction Stop } catch { Write-Error "ERROR: Cannot cd to ${JSON.stringify(dir)}"; exit 1 }`;
    case 'cmd':
      return `cd /d ${JSON.stringify(dir)} 2>nul || (echo ERROR: Cannot cd to ${JSON.stringify(dir)} & exit 1)`;
  }
}

// ============================================================
// 标记协议（退出码 + 工作目录）
// ============================================================

/**
 * 获取输出标记命令（输出 exitCode:cwd 用于解析）
 *
 * 所有 shell 输出统一格式: marker:exitCode:cwd
 * PersistentShell._executeInternal() 解析此格式。
 */
export function getMarkerCommand(marker: string, shellType?: ShellType): string {
  const shell = detectShell(shellType);
  switch (shell) {
    case 'bash':
      return `echo "${marker}:$?:$(pwd)"`;
    case 'pwsh':
      // PowerShell 分 $LASTEXITCODE（原生命令退出码）和 $?（PS cmdlet 成功/失败）
      // 合并逻辑: 非零 $LASTEXITCODE 优先，否则 $? → 0 或 1
      return `$ec = if ($LASTEXITCODE) { $LASTEXITCODE } else { if ($?) { 0 } else { 1 } }; Write-Output "${marker}:$ec:$(Get-Location)"`;
    case 'cmd':
      return `echo ${marker}:%errorlevel%:%cd%`;
  }
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
  if (!isWindows) return '/bin/sh';
  const shell = detectShell();
  if (shell === 'bash') return 'bash';
  if (shell === 'pwsh') return getPowerShellBinary();
  return process.env.COMSPEC || 'cmd.exe';
}

/**
 * 获取 spawn 的 shell 选项
 */
export function getSpawnShellOption(): string | boolean {
  if (!isWindows) return '/bin/sh';
  const shell = detectShell();
  if (shell === 'bash') return 'bash';
  if (shell === 'pwsh') return getPowerShellBinary();
  return true; // Let Node auto-detect via COMSPEC
}

// ============================================================
// 测试辅助
// ============================================================

/** 重置所有缓存（用于测试） */
export function resetShellTypeCache(): void {
  _shellType = null;
  _pwshBinary = null;
  bashAvailable = null;
}
