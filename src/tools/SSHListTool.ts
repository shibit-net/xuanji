// ============================================================
// SSHListTool — 远端主机/目录列表
// ============================================================

import { BaseTool } from './BaseTool';
import { SSHConnectionManager } from '@/infrastructure/ssh/SSHConnectionManager';
import { SSHConfigStore } from '@/infrastructure/ssh/SSHConfigStore';
import { getSSHConfig } from '@/infrastructure/config/RuntimeConfig';
import { middleTruncate, getMaxToolOutputLength } from '@/shared/utils/truncation';
import type { ToolResult, JSONSchema } from '@/infrastructure/core-types';
import type { SSHFileStat } from '@/infrastructure/ssh/types';

const MAX_ENTRIES = 1000;

export class SSHListTool extends BaseTool {
  readonly name = 'ssh_list';
  readonly readonly = true;

  readonly description = [
    'List configured SSH hosts or browse a remote directory via SFTP.',
    '',
    'Without arguments: lists all configured SSH hosts with their details.',
    'With "host" argument: lists files/directories on the remote server.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      host: {
        type: 'string',
        description: 'SSH host ID. Omit to list configured hosts instead of remote files.',
      },
      path: {
        type: 'string',
        description: 'Remote directory path. Default: home directory.',
      },
      filter: {
        type: 'string',
        description: 'Glob pattern filter, e.g. "*.log" or "app*".',
      },
      recursive: {
        type: 'boolean',
        description: 'Recursively list subdirectories. Default false.',
      },
      max_depth: {
        type: 'number',
        description: 'Max recursion depth (default 3). Only used when recursive=true.',
      },
    },
    required: [],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const sshConfig = getSSHConfig();
    if (!sshConfig?.enabled) {
      return this.error('SSH tools are not enabled. Set "tools.ssh.enabled": true in your config.');
    }

    const hostId = input.host as string | undefined;

    // 无 host → 列出已配置的 SSH 主机
    if (!hostId) {
      return this.listHosts();
    }

    // 有 host → 列出远端目录
    return this.listRemoteDirectory(hostId, input);
  }

  private async listHosts(): Promise<ToolResult> {
    const configStore = new SSHConfigStore();
    const hosts = await configStore.loadHosts();

    if (hosts.length === 0) {
      return this.success('No SSH hosts configured. Use the SSH config UI to add a host, or edit ~/.xuanji/ssh/hosts.json directly.', {
        hostCount: 0,
      });
    }

    const lines: string[] = [];
    lines.push(`Configured SSH Hosts (${hosts.length}):`);
    lines.push('─'.repeat(70));

    for (const h of hosts) {
      const authType = h.auth?.type || 'key';
      const authLabel = authType === 'key' ? 'key' : authType === 'password' ? 'password' : 'agent';
      lines.push(`  [${h.id}] ${h.name}`);
      lines.push(`       ${h.username}@${h.hostname}:${h.port || 22}  auth: ${authLabel}`);
      if (h.tags && h.tags.length > 0) {
        lines.push(`       tags: ${h.tags.join(', ')}`);
      }
      lines.push('');
    }

    return this.success(lines.join('\n'), {
      hostCount: hosts.length,
      hosts: hosts.map(h => ({ id: h.id, name: h.name, hostname: h.hostname, username: h.username, port: h.port })),
    });
  }

  private async listRemoteDirectory(hostId: string, input: Record<string, unknown>): Promise<ToolResult> {
    const configStore = new SSHConfigStore();
    const host = await configStore.getHost(hostId);
    if (!host) {
      return this.error(`SSH host "${hostId}" not found. Use ssh_list (without arguments) to see configured hosts.`);
    }

    const remotePath = (input.path as string) || '.';
    const filter = input.filter as string | undefined;
    const recursive = input.recursive === true;
    const maxDepth = (input.max_depth as number) ?? 3;

    const manager = SSHConnectionManager.getInstance();
    manager.registerHost(host);

    try {
      const entries = await manager.withSFTP(hostId, async (sftp) => {
        const allEntries: SSHFileStat[] = [];
        await this.collectEntries(sftp, remotePath, remotePath, filter, recursive, maxDepth, 0, allEntries);
        return allEntries;
      });

      // 排序
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const truncated = entries.length > MAX_ENTRIES;
      const displayEntries = truncated ? entries.slice(0, MAX_ENTRIES) : entries;

      let output = this.formatTable(displayEntries);

      if (truncated) {
        output += `\n\n[Showing ${MAX_ENTRIES} of ${entries.length} total entries]`;
      }

      if (displayEntries.length === 0) {
        output = `(empty directory: ${remotePath})`;
      }

      output = middleTruncate(output, getMaxToolOutputLength() ?? 50000);

      return this.success(output, {
        host: hostId,
        path: remotePath,
        totalEntries: entries.length,
        shownEntries: displayEntries.length,
        truncated,
      });
    } catch (err) {
      const msg = (err as Error).message || String(err);
      if (msg.includes('No such file') || msg.includes('ENOENT')) {
        return this.error(`Remote directory not found: ${remotePath} on "${hostId}"`);
      }
      if (msg.includes('Permission denied') || msg.includes('EACCES')) {
        return this.error(`Permission denied listing: ${remotePath} on "${hostId}"`);
      }
      return this.error(`SSH list failed on "${hostId}": ${msg}`);
    }
  }

  private async collectEntries(
    sftp: any,
    basePath: string,
    currentPath: string,
    filter: string | undefined,
    recursive: boolean,
    maxDepth: number,
    currentDepth: number,
    result: SSHFileStat[],
  ): Promise<void> {
    if (result.length >= MAX_ENTRIES * 2) return; // 安全阀

    const entries: Array<{ filename: string; longname: string; attrs: any }> = await new Promise((resolve, reject) => {
      sftp.readdir(currentPath, (err: Error | null, list: any[]) => {
        if (err) reject(err);
        else resolve(list || []);
      });
    });

    // 编译过滤函数
    let matchFn: ((name: string) => boolean) | null = null;
    if (filter) {
      const picomatch = (await import('picomatch')).default;
      matchFn = picomatch(filter, { dot: false });
    }

    for (const entry of entries) {
      if (entry.filename === '.' || entry.filename === '..') continue;
      if (result.length >= MAX_ENTRIES * 2) break;
      if (matchFn && !matchFn(entry.filename)) continue;

      const remoteRelPath = currentPath === basePath
        ? entry.filename
        : currentPath.replace(/\/$/, '') + '/' + entry.filename;

      const attrs = entry.attrs;
      const isDir = attrs.isDirectory?.() ?? ((attrs.mode ?? 0) & 0o4000) !== 0;
      const isLink = attrs.isSymbolicLink?.() ?? ((attrs.mode ?? 0) & 0o120000) !== 0;

      result.push({
        type: isDir ? 'directory' : isLink ? 'symlink' : 'file',
        name: entry.filename,
        size: attrs.size ?? 0,
        modifyTime: (attrs.mtime ?? 0) * 1000,
        accessTime: (attrs.atime ?? 0) * 1000,
        permissions: this.formatPerms(attrs.mode ?? 0, isDir),
        owner: attrs.uid ?? 0,
        group: attrs.gid ?? 0,
        relativePath: remoteRelPath,
      });

      if (recursive && isDir && !isLink && currentDepth < maxDepth) {
        await this.collectEntries(sftp, basePath, remoteRelPath, filter, recursive, maxDepth, currentDepth + 1, result);
      }
    }
  }

  private formatPerms(mode: number, isDir: boolean): string {
    const type = isDir ? 'd' : '-';
    const r = (m: number, s: number) => (m & s) ? 'r' : '-';
    const w = (m: number, s: number) => (m & s) ? 'w' : '-';
    const x = (m: number, s: number) => (m & s) ? 'x' : '-';
    return type
      + r(mode, 0o400) + w(mode, 0o200) + x(mode, 0o100)
      + r(mode, 0o040) + w(mode, 0o020) + x(mode, 0o010)
      + r(mode, 0o004) + w(mode, 0o002) + x(mode, 0o001);
  }

  private formatTable(entries: SSHFileStat[]): string {
    const header = 'Type  Size       Modified             Name';
    const separator = '────  ─────────  ───────────────────  ────';
    const rows = entries.map((e) => {
      const typeIcon = e.type === 'directory' ? 'd' : e.type === 'symlink' ? 'l' : 'f';
      const size = this.formatSize(e.size);
      const mtime = this.formatDate(new Date(e.modifyTime));
      return `${typeIcon}     ${size.padEnd(10)}  ${mtime}  ${e.relativePath}`;
    });

    return [header, separator, ...rows].join('\n');
  }

  private formatSize(bytes: number): string {
    if (bytes === 0) return '-';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
  }

  private formatDate(date: Date): string {
    const now = new Date();
    if (date.getFullYear() === now.getFullYear()) {
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${month}-${day} ${hours}:${minutes}`;
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
