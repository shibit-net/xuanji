/**
 * ============================================================
 * MCP Gateway Tool - 统一的 MCP 工具调用入口
 * ============================================================
 * 替代逐个注册 MCP 工具为 function-calling tool 的方案。
 * LLM 通过此单一工具调用所有 MCP 服务器的工具。
 * 可用 MCP 工具的 schema 通过 system prompt 注入。
 */

import { BaseTool } from '@/tools/BaseTool';
import type { ToolResult, JSONSchema } from '@/core/types';
import { getMCPManager } from './MCPManager';

export class MCPCallTool extends BaseTool {
  readonly name = 'mcp_call';
  readonly description =
    'Call an MCP (Model Context Protocol) tool from an installed server. ' +
    'Use `mcp_settings(list)` to discover available MCP servers and their tools first.';
  readonly readonly = true;

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      server: {
        type: 'string',
        description: 'The MCP server name. Use mcp_settings(list) to discover available servers.',
      },
      tool: {
        type: 'string',
        description: 'The tool name to call on that server. Use mcp_settings(status, serverName="xxx") to see tool details.',
      },
      arguments: {
        type: 'object',
        description: 'Arguments for the MCP tool, matching the parameter schema shown in the system prompt',
      },
    },
    required: ['server', 'tool', 'arguments'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const manager = getMCPManager();

    const server = input.server as string;
    const tool = input.tool as string;
    const args = (input.arguments ?? {}) as Record<string, unknown>;

    if (!server || !tool) {
      return this.error(
        'Missing required parameters: "server" and "tool" are required. Use mcp_settings(list) to discover available MCP tools.',
      );
    }

    try {
      const result = await manager.callTool(server, tool, args);

      const textContents = result.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n');

      if (result.isError) {
        return this.error(textContents || `MCP tool "${server}:${tool}" returned an error`);
      }

      return this.success(textContents || 'Tool executed successfully', {
        serverName: server,
        toolName: tool,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes('not found')) {
        return this.error(
          `MCP server "${server}" not found. Check available servers in the system prompt or use mcp_settings to see installed servers.`,
          { serverName: server, toolName: tool },
        );
      }

      return this.error(`MCP tool call failed: ${message}`, {
        serverName: server,
        toolName: tool,
      });
    }
  }
}
