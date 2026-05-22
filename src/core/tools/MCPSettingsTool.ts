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
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MCPSettingsTool' });

export class MCPSettingsTool extends BaseTool {
  readonly name = 'mcp_settings';
  readonly description = [
    '管理已安装的 MCP 服务器。支持以下操作：',
    '',
    '- **list** — 列出所有 MCP 服务器（名称、传输方式、状态）',
    '- **status** — 查看指定服务器的详细状态',
    '- **enable** — 启用指定服务器',
    '- **disable** — 禁用指定服务器',
    '- **config** — 查看指定服务器的配置模板',
    '',
    '当用户说"看看已安装的 MCP"、"列出 MCP 服务器"、"启用/禁用 XXX MCP"时调用此工具。',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'status', 'enable', 'disable', 'config'],
        description: '操作类型',
      },
      serverName: {
        type: 'string',
        description: 'MCP 服务器名称（action=status/enable/disable/config 时必填）',
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
      return this.error('MCPManager 未初始化');
    }

    switch (action) {
      case 'list': return this.listServers();
      case 'status': return this.serverStatus(serverName);
      case 'enable': return this.toggleServer(serverName!, true);
      case 'disable': return this.toggleServer(serverName!, false);
      case 'config': return this.showConfig(serverName!);
      default: return this.error(`未知操作: ${action}`);
    }
  }

  private async listServers(): Promise<ToolResult> {
    try {
      const servers = this.mcpManager.servers || [];
      if (servers.length === 0) {
        return this.success('当前没有安装任何 MCP 服务器。\n使用 install 工具从市场安装。');
      }

      const lines: string[] = [`## 已安装 MCP 服务器 (${servers.length})`, ''];
      for (const s of servers) {
        const status = s.enabled !== false ? '✅ 启用' : '⏸️ 禁用';
        const transport = s.transport || 'stdio';
        const toolCount = s.tools?.length || 0;
        lines.push(`- **${s.name}** — ${status} | 传输: ${transport} | 工具: ${toolCount} 个`);
      }
      return this.success(lines.join('\n'));
    } catch (err) {
      return this.error(`列出 MCP 服务器失败: ${err}`);
    }
  }

  private async serverStatus(serverName?: string): Promise<ToolResult> {
    if (!serverName) return this.error('请指定服务器名称（serverName）');

    try {
      const server = this.findServer(serverName);
      if (!server) return this.error(`未找到 MCP 服务器: ${serverName}`);

      const lines = [
        `## ${server.name}`,
        `- **状态**: ${server.enabled !== false ? '✅ 启用' : '⏸️ 禁用'}`,
        `- **传输**: ${server.transport || 'stdio'}`,
        `- **命令行**: ${server.command || 'N/A'}`,
        `- **工具数**: ${server.tools?.length || 0}`,
      ];

      if (server.tools?.length) {
        lines.push('', '### 工具列表');
        for (const t of server.tools) {
          lines.push(`- **${t.name}**: ${t.description || ''}`);
        }
      }

      return this.success(lines.join('\n'));
    } catch (err) {
      return this.error(`查询服务器状态失败: ${err}`);
    }
  }

  private async toggleServer(serverName: string, enable: boolean): Promise<ToolResult> {
    if (!serverName) return this.error('请指定服务器名称（serverName）');

    try {
      const server = this.findServer(serverName);
      if (!server) return this.error(`未找到 MCP 服务器: ${serverName}`);

      server.enabled = enable;
      // 持久化更新
      if (typeof this.mcpManager.updateServer === 'function') {
        await this.mcpManager.updateServer(serverName, { enabled: enable });
      }
      return this.success(`MCP 服务器 "${serverName}" 已${enable ? '启用' : '禁用'}`);
    } catch (err) {
      return this.error(`${enable ? '启用' : '禁用'}服务器失败: ${err}`);
    }
  }

  private async showConfig(serverName?: string): Promise<ToolResult> {
    if (!serverName) return this.error('请指定服务器名称（serverName）');

    try {
      const server = this.findServer(serverName);
      if (!server) return this.error(`未找到 MCP 服务器: ${serverName}`);

      return this.success(`## ${server.name} 配置\n\`\`\`json\n${JSON.stringify(server.config || {}, null, 2)}\n\`\`\``);
    } catch (err) {
      return this.error(`查看配置失败: ${err}`);
    }
  }

  private findServer(name: string): any {
    const servers = this.mcpManager.servers || [];
    return servers.find((s: any) => s.name === name);
  }
}
