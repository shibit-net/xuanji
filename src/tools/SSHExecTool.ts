// ============================================================
// SSHExecTool — 远端命令执行
// ============================================================

import { BaseTool } from './BaseTool';
import { SSHConnectionManager } from '@/infrastructure/ssh/SSHConnectionManager';
import { SSHConfigStore } from '@/infrastructure/ssh/SSHConfigStore';
import { getSSHConfig } from '@/infrastructure/config/RuntimeConfig';
import { middleTruncate, getMaxToolOutputLength } from '@/shared/utils/truncation';
import type { ToolResult, JSONSchema } from '@/infrastructure/core-types';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'SSHExecTool' });

export class SSHExecTool extends BaseTool {
  readonly name = 'ssh_exec';
  readonly description = [
    'Execute a command on a remote server via SSH.',
    'Requires a pre-configured SSH host. Use ssh_list (without arguments) to see available hosts.',
    '',
    'Use cases: deploy, manage remote services, check remote logs, run builds on remote servers.',
    'For file operations use ssh_read / ssh_write / ssh_list.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      host: {
        type: 'string',
        description: 'SSH host ID (from configured hosts). Use ssh_list with no arguments to list hosts.',
      },
      command: {
        type: 'string',
        description: 'Command to execute on the remote server.',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds. Default 120000 (2 min), max 600000 (10 min).',
        default: 120000,
      },
      description: {
        type: 'string',
        description: 'Brief description of what this command does (for permission confirmation UI).',
      },
      run_in_background: {
        type: 'boolean',
        description: 'Run in background for long-running commands. Returns a background task reference. Default false.',
        default: false,
      },
    },
    required: ['host', 'command'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const sshConfig = getSSHConfig();
    if (!sshConfig?.enabled) {
      return this.error('SSH tools are not enabled. Set "tools.ssh.enabled": true in your config to use remote server operations.');
    }

    const hostId = input.host as string;
    const command = input.command as string;
    const timeout = Math.min(
      (input.timeout as number) ?? sshConfig?.execTimeout ?? 120_000,
      600_000,
    );
    const runInBackground = input.run_in_background === true;

    // 验证主机存在
    const configStore = new SSHConfigStore();
    const host = await configStore.getHost(hostId);
    if (!host) {
      return this.error(`SSH host "${hostId}" not found. Use ssh_list (without arguments) to see configured hosts.`);
    }

    // 注册主机到连接管理器
    const manager = SSHConnectionManager.getInstance();
    manager.registerHost(host);

    if (runInBackground) {
      const escapedCmd = command.replace(/'/g, "'\\''");
      // 使用 shell 的临时目录（${TMPDIR:-/tmp}）而非硬编码 /tmp/
      // macOS 默认 TMPDIR=/var/folders/...，Linux 默认 /tmp/
      // TMPDIR 环境变量通常由 SSH 会话继承
      const logFile = `xuanji-ssh-bg-${Date.now()}.log`;
      const bgCommand = `nohup bash -c '${escapedCmd}' > "\${TMPDIR:-/tmp}/${logFile}" 2>&1 & echo "PID:$!"`;
      try {
        const result = await manager.exec(hostId, bgCommand, 10000);
        return this.success(`Remote background task started on "${hostId}".\nCommand: ${command}\n${result.stdout.trim()}`);
      } catch (err) {
        return this.error(`Failed to start background task on "${hostId}": ${(err as Error).message}`);
      }
    }

    // 检测 sudo
    const sudoWarning = /\bsudo\b/.test(command)
      ? '[SUDO WARNING] This command uses sudo — elevated privileges on the remote server.'
      : null;

    try {
      const result = await manager.exec(hostId, command, timeout);

      let output = '';
      if (result.stdout) output += result.stdout;
      if (result.stderr) {
        output += (output ? '\n' : '') + `[stderr]\n${result.stderr}`;
      }
      output = middleTruncate(output, getMaxToolOutputLength() ?? 50000);

      if (result.exitCode !== 0) {
        return this.error(
          `Remote exit code: ${result.exitCode}${result.signal ? ` (signal: ${result.signal})` : ''}\n${output}`,
          { exitCode: result.exitCode, host: hostId },
        );
      }

      const meta: Record<string, unknown> = { exitCode: result.exitCode, host: hostId };
      if (sudoWarning) meta.sudoWarning = sudoWarning;

      return this.success(output || '(no output)', meta);
    } catch (err) {
      return this.error(`SSH execution failed on "${hostId}": ${(err as Error).message}`);
    }
  }
}
