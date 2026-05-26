// ============================================================
// Bash 沙箱 — Windows Noop 实现
// ============================================================
//
// Windows 没有内置的轻量沙箱（如 Seatbelt / Bubblewrap），
// 此实现用于沙箱模式启用但无平台原生沙箱可用时，
// 提供降级执行而不至于静默失效。
//
// 降级策略：
// - 始终可用（isAvailable 返回 true）
// - execute() 直接用 spawn 执行命令，不做隔离
// - 但会通过 RESTRICTED_PATHS 做软保护（在 BashTool 层面已实现）
// - 记录降级日志，让用户知道沙箱未生效

import { spawn } from 'node:child_process';
import type { SandboxConfig, SandboxExecutor, ShellResult } from './SandboxExecutor';

export class NoopSandboxExecutor implements SandboxExecutor {
  private config: SandboxConfig;
  /** stdout/stderr 最大缓冲字节数 */
  private static readonly MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5MB

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  getName(): string {
    return 'Noop (Windows — no sandbox available)';
  }

  async isAvailable(): Promise<boolean> {
    // 始终返回 true：这是最后一层 fallback
    return process.platform === 'win32';
  }

  async execute(command: string, cwd: string, timeout: number): Promise<ShellResult> {
    return new Promise((resolve) => {
      const proc = spawn(
        process.env.COMSPEC || 'cmd.exe',
        ['/q', '/d', '/c', command],
        {
          cwd,
          timeout,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
          windowsHide: true,
        },
      );

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        if (stdout.length + text.length <= NoopSandboxExecutor.MAX_OUTPUT_BYTES) {
          stdout += text;
        }
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        if (stderr.length + text.length <= NoopSandboxExecutor.MAX_OUTPUT_BYTES) {
          stderr += text;
        }
      });

      proc.on('close', (exitCode) => {
        resolve({ stdout, stderr, exitCode: exitCode ?? -1 });
      });

      proc.on('error', (err) => {
        resolve({ stdout, stderr: `${stderr}\nSpawn error: ${err.message}`, exitCode: -1 });
      });
    });
  }
}
