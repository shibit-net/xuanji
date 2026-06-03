/**
 * MCPSettingsTool — MCP 服务器管理工具
 *
 * Agent 通过此工具管理已安装的 MCP 服务器：
 *  - 列出所有已安装的 MCP 服务器及其状态
 *  - 启用/禁用指定 MCP 服务器
 *  - 查看 MCP 配置详情
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'MCPSettingsTool' });

function maskSensitiveConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSensitiveConfig);
  if (!value || typeof value !== 'object') return value;

  const masked: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/api[_-]?key|token|secret|password|credential|auth/i.test(key)) {
      masked[key] = entry ? '[REDACTED]' : entry;
    } else {
      masked[key] = maskSensitiveConfig(entry);
    }
  }
  return masked;
}

function configNeedsCredentials(config: unknown): boolean {
  if (!config || typeof config !== 'object') return false;
  return Object.keys(config as Record<string, unknown>).some((key) => /api[_-]?key|token|secret|password|credential|auth/i.test(key));
}

export class MCPSettingsTool extends BaseTool {
  readonly name = 'mcp_settings';
  readonly description = [
    'Manage installed MCP servers. Supports the following operations:',
    '',
    '- **list** — List all MCP servers (name, transport, status)',
    '- **status** — View detailed status of a specific server',
    '- **enable** — Enable a specific server',
    '- **disable** — Disable a specific server',
    '- **config** — View config template for a specific server',
    '',
    'Call this tool when the user says "list MCP servers", "check installed MCP", "enable/disable XXX MCP".',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'status', 'enable', 'disable', 'config'],
        description: 'Operation type',
      },
      serverName: {
        type: 'string',
        description: 'MCP server name (required when action=status/enable/disable/config)',
      },
    },
    required: ['action'],
  };

  private mcpManager: any;

  setDependencies(deps: { mcpManager: any }): void {
    this.mcpManager = deps.mcpManager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;
    const serverName = input.serverName as string | undefined;

    if (!this.mcpManager) {
      return this.error('MCPManager not initialized');
    }

    switch (action) {
      case 'list': return this.listServers();
      case 'status': return this.serverStatus(serverName);
      case 'enable': return this.toggleServer(serverName!, true);
      case 'disable': return this.toggleServer(serverName!, false);
      case 'config': return this.showConfig(serverName!);
      default: return this.error(`Unknown action: ${action}`);
    }
  }

  private async listServers(): Promise<ToolResult> {
    try {
      const servers = this.mcpManager.servers || [];
      if (servers.length === 0) {
        return this.success('No MCP servers installed.\nUse the install tool to install from marketplace.');
      }

      const lines: string[] = [`## Installed MCP Servers (${servers.length})`, ''];
      for (const s of servers) {
        const status = s.enabled !== false ? 'enabled' : 'disabled';
        const transport = s.transport || 'stdio';
        const tools = Array.isArray(s.tools) ? s.tools : [];
        const needsCredentials = configNeedsCredentials(s.config) ? 'yes' : 'no/unknown';
        lines.push(`### ${s.name}`);
        lines.push(`- **server**: \`${s.name}\``);
        lines.push(`- **transport/status**: ${transport} / ${status}`);
        lines.push(`- **toolCount**: ${tools.length}`);
        lines.push(`- **needsCredentials**: ${needsCredentials}`);
        if (tools.length) {
          lines.push('- **tools**:');
          for (const t of tools.slice(0, 8)) {
            lines.push(`  - \`${t.name}\`: ${t.description || '-'}`);
          }
          if (tools.length > 8) lines.push(`  - ... ${tools.length - 8} more`);
        }
        lines.push('');
      }
      return this.success(lines.join('\n'));
    } catch (err) {
      return this.error(`Failed to list MCP servers: ${err}`);
    }
  }

  private async serverStatus(serverName?: string): Promise<ToolResult> {
    if (!serverName) return this.error('Please specify server name (serverName)');

    try {
      const server = this.findServer(serverName);
      if (!server) return this.error(`MCP server not found: ${serverName}`);

      const lines = [
        `## ${server.name}`,
        `- **Status**: ${server.enabled !== false ? 'Enabled' : 'Disabled'}`,
        `- **Transport**: ${server.transport || 'stdio'}`,
        `- **Command**: ${server.command || 'N/A'}`,
        `- **Tools**: ${server.tools?.length || 0}`,
        `- **Needs credentials**: ${configNeedsCredentials(server.config) ? 'yes' : 'no/unknown'}`,
      ];

      if (server.tools?.length) {
        lines.push('', '### Tool List');
        for (const t of server.tools) {
          lines.push(`- **${t.name}**: ${t.description || ''}`);
        }
      }

      return this.success(lines.join('\n'));
    } catch (err) {
      return this.error(`Failed to query server status: ${err}`);
    }
  }

  private async toggleServer(serverName: string, enable: boolean): Promise<ToolResult> {
    if (!serverName) return this.error('Please specify server name (serverName)');

    try {
      const server = this.findServer(serverName);
      if (!server) return this.error(`MCP server not found: ${serverName}`);

      server.enabled = enable;
      // Persist update
      if (typeof this.mcpManager.updateServer === 'function') {
        await this.mcpManager.updateServer(serverName, { enabled: enable });
      }
      return this.success(`MCP server "${serverName}" ${enable ? 'enabled' : 'disabled'}`);
    } catch (err) {
      return this.error(`Failed to ${enable ? 'enable' : 'disable'} server: ${err}`);
    }
  }

  private async showConfig(serverName?: string): Promise<ToolResult> {
    if (!serverName) return this.error('Please specify server name (serverName)');

    try {
      const server = this.findServer(serverName);
      if (!server) return this.error(`MCP server not found: ${serverName}`);

      const maskedConfig = maskSensitiveConfig(server.config || {});
      return this.success(`## ${server.name} Config\n\`\`\`json\n${JSON.stringify(maskedConfig, null, 2)}\n\`\`\``);
    } catch (err) {
      return this.error(`Failed to view config: ${err}`);
    }
  }

  private findServer(name: string): any {
    const servers = this.mcpManager.servers || [];
    return servers.find((s: any) => s.name === name);
  }
}
