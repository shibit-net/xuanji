// ============================================================
// Bash 沙箱 — macOS Seatbelt 实现
// ============================================================

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import type { SandboxConfig, SandboxExecutor, ShellResult } from './SandboxExecutor';

/**
 * macOS Seatbelt (sandbox-exec) 沙箱执行器
 *
 * 使用 macOS 内置的 sandbox-exec 命令隔离 Bash 命令
 */
export class SeatbeltExecutor implements SandboxExecutor {
  private config: SandboxConfig;
  /** stdout/stderr 最大缓冲字节数（防止内存溢出） */
  private static readonly MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5MB

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  getName(): string {
    return 'Seatbelt (macOS)';
  }

  async isAvailable(): Promise<boolean> {
    if (process.platform !== 'darwin') {
      return false;
    }

    // 检查 sandbox-exec 是否可用
    return new Promise((resolve) => {
      const proc = spawn('which', ['sandbox-exec']);
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  async execute(command: string, cwd: string, timeout: number): Promise<ShellResult> {
    const profile = this.generateProfile();

    return new Promise((resolve, reject) => {
      const proc = spawn(
        'sandbox-exec',
        ['-p', profile, 'bash', '-c', command],
        {
          cwd,
          timeout,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        },
      );

      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;

      proc.stdout.on('data', (data: Buffer) => {
        stdoutBytes += data.length;
        if (stdoutBytes <= SeatbeltExecutor.MAX_OUTPUT_BYTES) {
          stdout += data.toString();
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderrBytes += data.length;
        if (stderrBytes <= SeatbeltExecutor.MAX_OUTPUT_BYTES) {
          stderr += data.toString();
        }
      });

      proc.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      });

      proc.on('error', (err) => {
        resolve({
          stdout,
          stderr: stderr || err.message,
          exitCode: 1,
        });
      });
    });
  }

  /**
   * 生成 Seatbelt profile
   */
  private generateProfile(): string {
    const home = homedir();
    const allowedPaths = this.config.allowedPaths
      .map((p) => this.expandPath(p, home))
      .map((p) => this.escapeSbplString(p)); // 转义防注入

    const lines: string[] = [
      '(version 1)',
      '(deny default)',
      '',
      '; 允许读取所有文件',
      '(allow file-read*)',
      '',
      '; 允许写入指定路径',
    ];

    for (const p of allowedPaths) {
      lines.push(`(allow file-write* (subpath "${p}"))`);
    }
    lines.push('(allow file-write* (subpath "/tmp/"))');
    lines.push('(allow file-write* (subpath "/private/tmp/"))');
    lines.push(`(allow file-write* (subpath "${this.escapeSbplString(home + '/.xuanji/')}"))`);

    lines.push('');
    lines.push('; 允许执行常用命令');
    lines.push('(allow process-exec)');
    lines.push('(allow process-fork)');
    lines.push('(allow process-info*)');
    lines.push('(allow sysctl-read)');
    lines.push('(allow mach-lookup)');

    // 网络访问控制
    lines.push('');
    if (this.config.denyNetwork) {
      lines.push('; 禁止网络访问');
      lines.push('(deny network*)');
    } else {
      lines.push('; 允许网络访问');
      lines.push('(allow network*)');
    }

    // 系统路径保护
    if (this.config.denySystemPaths) {
      lines.push('');
      lines.push('; 禁止系统路径写入');
      lines.push('(deny file-write* (subpath "/etc/"))');
      lines.push('(deny file-write* (subpath "/System/"))');
      lines.push('(deny file-write* (subpath "/Library/"))');
      lines.push('(deny file-write* (subpath "/usr/"))');
      lines.push('(deny file-write* (subpath "/bin/"))');
      lines.push('(deny file-write* (subpath "/sbin/"))');
    }

    return lines.join('\n');
  }

  /**
   * 转义 SBPL 字符串中的特殊字符（防止注入）
   */
  private escapeSbplString(str: string): string {
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /**
   * 展开路径中的 ~
   */
  private expandPath(path: string, home: string): string {
    if (path.startsWith('~')) {
      return home + path.slice(1);
    }
    return path;
  }
}
