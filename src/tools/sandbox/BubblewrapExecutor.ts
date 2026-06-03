// ============================================================
// Bash 沙箱 — Linux Bubblewrap 实现
// ============================================================

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import type { SandboxConfig, SandboxExecutor, ShellResult } from './SandboxExecutor';

/**
 * Linux Bubblewrap (bwrap) 沙箱执行器
 *
 * 使用 bubblewrap 进行 namespace 隔离
 */
export class BubblewrapExecutor implements SandboxExecutor {
  private config: SandboxConfig;
  /** stdout/stderr 最大缓冲字节数（防止内存溢出） */
  private static readonly MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5MB

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  getName(): string {
    return 'Bubblewrap (Linux)';
  }

  async isAvailable(): Promise<boolean> {
    if (process.platform !== 'linux') {
      return false;
    }

    // 检查 bwrap 是否可用
    return new Promise((resolve) => {
      const proc = spawn('which', ['bwrap']);
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }

  async execute(command: string, cwd: string, timeout: number): Promise<ShellResult> {
    const args = this.buildArgs(cwd);
    args.push('bash', '-c', command);

    return new Promise((resolve) => {
      const proc = spawn('bwrap', args, {
        cwd,
        timeout,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      });

      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;

      proc.stdout.on('data', (data: Buffer) => {
        stdoutBytes += data.length;
        if (stdoutBytes <= BubblewrapExecutor.MAX_OUTPUT_BYTES) {
          stdout += data.toString();
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderrBytes += data.length;
        if (stderrBytes <= BubblewrapExecutor.MAX_OUTPUT_BYTES) {
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
   * 构建 bwrap 参数
   */
  private buildArgs(cwd: string): string[] {
    const home = homedir();
    const args: string[] = [
      // 只读绑定系统目录
      '--ro-bind', '/usr', '/usr',
      '--ro-bind', '/bin', '/bin',
      '--ro-bind', '/etc', '/etc',
    ];

    // Linux 特有的目录绑定
    const optionalRoBinds = ['/lib', '/lib64', '/lib32'];
    for (const dir of optionalRoBinds) {
      // 只绑定存在的目录
      args.push('--ro-bind-try', dir, dir);
    }

    // 可写目录（使用 tmpfs 隔离，不共享宿主 /tmp）
    args.push('--tmpfs', '/tmp');
    args.push('--proc', '/proc');
    args.push('--dev', '/dev');
    args.push('--tmpfs', '/run');

    // 添加项目目录（可读写）
    for (const path of this.config.allowedPaths) {
      const expanded = this.expandPath(path, home);
      args.push('--bind', expanded, expanded);
    }

    // 确保 cwd 可写
    if (!this.config.allowedPaths.some((p) => {
      const expanded = this.expandPath(p, home);
      return cwd.startsWith(expanded);
    })) {
      args.push('--bind', cwd, cwd);
    }

    // 确保 xuanji 配置目录可写（仅在目录存在时绑定）
    const xuanjiDir = `${home}/.xuanji`;
    if (existsSync(xuanjiDir)) {
      args.push('--bind', xuanjiDir, xuanjiDir);
    }

    // PID 命名空间隔离
    args.push('--unshare-pid');
    args.push('--die-with-parent');

    // 网络隔离
    if (this.config.denyNetwork) {
      args.push('--unshare-net');
    }

    return args;
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
