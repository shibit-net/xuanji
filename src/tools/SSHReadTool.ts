// ============================================================
// SSHReadTool — 远端文件读取
// ============================================================

import { BaseTool } from './BaseTool';
import { SSHConnectionManager } from '@/core/ssh/SSHConnectionManager';
import { SSHConfigStore } from '@/core/ssh/SSHConfigStore';
import { getSSHConfig } from '@/core/config/RuntimeConfig';
import { middleTruncate, getMaxToolOutputLength } from '@/shared/utils/truncation';
import type { ToolResult, JSONSchema } from '@/core/types';

const MAX_FORMAT_LINES = 2000;

export class SSHReadTool extends BaseTool {
  readonly name = 'ssh_read';
  readonly readonly = true;

  readonly description = [
    'Read a file from a remote server via SFTP.',
    'Returns file content with line numbers (formatted as "cat -n").',
    'For large files use offset/limit to read specific sections.',
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
      offset: {
        type: 'number',
        description: 'Start reading from this line number (1-indexed). Default 1.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read. Default: all, up to 2000.',
      },
      encoding: {
        type: 'string',
        description: 'File encoding. Default utf-8.',
        default: 'utf-8',
      },
    },
    required: ['host', 'path'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const sshConfig = getSSHConfig();
    if (!sshConfig?.enabled) {
      return this.error('SSH tools are not enabled. Set "tools.ssh.enabled": true in your config.');
    }

    const hostId = input.host as string;
    const filePath = input.path as string;
    const offset = (input.offset as number) ?? 1;
    const limit = (input.limit as number | undefined);

    if (!filePath.startsWith('/')) {
      return this.error('Remote path must be absolute (e.g., /home/user/file.txt)');
    }

    const configStore = new SSHConfigStore();
    const host = await configStore.getHost(hostId);
    if (!host) {
      return this.error(`SSH host "${hostId}" not found.`);
    }

    const manager = SSHConnectionManager.getInstance();
    manager.registerHost(host);

    try {
      const content = await manager.withSFTP(hostId, async (sftp) => {
        return new Promise<string>((resolve, reject) => {
          sftp.readFile(filePath, { encoding: 'utf-8' }, (err, data) => {
            if (err) reject(err);
            else resolve(data as unknown as string);
          });
        });
      });

      const lines = content.split('\n');
      const startIdx = Math.max(0, offset - 1);
      const endIdx = limit ? startIdx + limit : Math.min(startIdx + MAX_FORMAT_LINES, lines.length);
      const selected = lines.slice(startIdx, endIdx);

      let output = '';
      for (let i = 0; i < selected.length; i++) {
        const lineNum = startIdx + i + 1;
        output += `${String(lineNum).padStart(6)}\t${selected[i]}\n`;
      }

      if (!limit && lines.length > startIdx + MAX_FORMAT_LINES) {
        const remaining = lines.length - (startIdx + MAX_FORMAT_LINES);
        output += `\n... [file truncated, ${remaining} remaining lines. Use offset/limit for pagination, e.g., offset=${startIdx + MAX_FORMAT_LINES + 1} limit=500]`;
      }

      output = middleTruncate(output, getMaxToolOutputLength() ?? 50000);

      return this.success(output, {
        host: hostId,
        path: filePath,
        totalLines: lines.length,
        readLines: selected.length,
        startLine: startIdx + 1,
      });
    } catch (err) {
      const msg = (err as Error).message || String(err);
      if (msg.includes('No such file') || msg.includes('ENOENT')) {
        return this.error(`Remote file not found: ${filePath} on "${hostId}"`);
      }
      if (msg.includes('Permission denied') || msg.includes('EACCES')) {
        return this.error(`Permission denied reading: ${filePath} on "${hostId}"`);
      }
      return this.error(`SSH read failed on "${hostId}": ${msg}`);
    }
  }
}
