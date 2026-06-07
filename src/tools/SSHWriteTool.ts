// ============================================================
// SSHWriteTool — 远端文件写入
// ============================================================

import { BaseTool } from './BaseTool';
import { SSHConnectionManager } from '@/infrastructure/ssh/SSHConnectionManager';
import { SSHConfigStore } from '@/infrastructure/ssh/SSHConfigStore';
import { getSSHConfig } from '@/infrastructure/config/RuntimeConfig';
import type { ToolResult, JSONSchema } from '@/infrastructure/core-types';

const SENSITIVE_PATHS = [
  '/etc/shadow', '/etc/passwd', '/etc/ssh/', '/etc/sudoers',
  '/root/.ssh/', '/boot/', '/sys/', '/proc/',
];

export class SSHWriteTool extends BaseTool {
  readonly name = 'ssh_write';
  // 非只读：写操作需要在 Plan Mode 中被拦截
  readonly readonly = false;

  readonly description = [
    'Write content to a file on a remote server via SFTP.',
    'Creates parent directories automatically if they do not exist.',
    'For editing existing files, use ssh_read first, then ssh_write.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      host: {
        type: 'string',
        description: 'SSH host ID.',
      },
      path: {
        type: 'string',
        description: 'Absolute path to the file on the remote server.',
      },
      content: {
        type: 'string',
        description: 'Content to write to the remote file.',
      },
      mode: {
        type: 'number',
        description: 'File permissions in octal (e.g., 420 = 0o644). Default: 0o644 (rw-r--r--).',
      },
    },
    required: ['host', 'path', 'content'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const sshConfig = getSSHConfig();
    if (sshConfig && !sshConfig.enabled) {
      return this.error('SSH tools are disabled. Set "tools.ssh.enabled": true in your config to enable remote server operations.');
    }

    const hostId = input.host as string;
    const filePath = input.path as string;
    const content = input.content as string;
    const mode = (input.mode as number) ?? 0o644;

    if (!filePath.startsWith('/')) {
      return this.error('Remote path must be absolute (e.g., /home/user/file.txt)');
    }

    // 敏感路径拦截
    for (const sp of SENSITIVE_PATHS) {
      if (filePath.startsWith(sp) || filePath === sp.replace(/\/$/, '')) {
        return this.error(`Cannot write to sensitive path: "${filePath}". This path is protected to prevent system compromise.`);
      }
    }

    const configStore = new SSHConfigStore();
    const host = await configStore.getHost(hostId);
    if (!host) {
      return this.error(`SSH host "${hostId}" not found.`);
    }

    const manager = SSHConnectionManager.getInstance();
    manager.registerHost(host);

    try {
      await manager.withSFTP(hostId, async (sftp) => {
        // 确保父目录存在
        const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
        if (parentDir) {
          await new Promise<void>((resolve, reject) => {
            sftp.mkdir(parentDir, { mode: 0o755 }, (err) => {
              // 忽略目录已存在的错误
              if (err && !err.message.includes('already exists') && !err.message.includes('file already exists')) {
                reject(err);
              } else {
                resolve();
              }
            });
          });
        }

        // 写入文件
        await new Promise<void>((resolve, reject) => {
          sftp.writeFile(filePath, Buffer.from(content, 'utf-8'), { mode }, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      });

      const sizeBytes = Buffer.byteLength(content, 'utf-8');
      return this.success(`File written successfully on "${hostId}": ${filePath} (${sizeBytes} bytes)`, {
        host: hostId,
        path: filePath,
        size: sizeBytes,
      });
    } catch (err) {
      const msg = (err as Error).message || String(err);
      if (msg.includes('Permission denied') || msg.includes('EACCES')) {
        return this.error(`Permission denied writing to: ${filePath} on "${hostId}"`);
      }
      return this.error(`SSH write failed on "${hostId}": ${msg}`);
    }
  }
}
