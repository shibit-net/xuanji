/**
 * ============================================================
 * MCP Tool Adapter - Bridge MCP Tools to BaseTool
 * ============================================================
 * 将 MCP 工具适配为璇玑的 BaseTool 接口
 */

import { BaseTool } from '@/core/tools/BaseTool';
import type { ToolResult, JSONSchema } from '@/core/types';
import { getMCPManager } from './MCPManager';
import type { MCPTool } from './types';

/**
 * MCP 工具适配器
 *
 * 将 MCP 工具包装为 BaseTool，使其能够在璇玑的工具系统中使用
 * 工具名格式: {serverName}:{toolName} (如 market:stock_price)
 */
export class MCPToolAdapter extends BaseTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: JSONSchema;
  readonly readonly: boolean = true; // MCP 工具默认为只读（并行执行）

  private serverName: string;
  private mcpTool: MCPTool;

  constructor(serverName: string, mcpTool: MCPTool) {
    super();
    this.serverName = serverName;
    this.mcpTool = mcpTool;

    // 工具名: serverName:toolName
    this.name = `${serverName}:${mcpTool.name}`;
    this.description = mcpTool.description ?? `MCP tool from ${serverName}`;
    this.input_schema = mcpTool.inputSchema as JSONSchema;
  }

  /**
   * 执行工具
   */
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const manager = getMCPManager();

    try {
      const result = await manager.callTool(this.serverName, this.mcpTool.name, input);

      // 解析返回内容
      const textContents = result.content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text)
        .join('\n');

      if (result.isError) {
        return this.error(textContents || 'MCP tool execution failed');
      }

      return this.success(textContents || 'Tool executed successfully', {
        serverName: this.serverName,
        toolName: this.mcpTool.name,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.error(`MCP tool execution failed: ${message}`, {
        serverName: this.serverName,
        toolName: this.mcpTool.name,
      });
    }
  }

  /**
   * 获取服务器名称
   */
  getServerName(): string {
    return this.serverName;
  }

  /**
   * 获取原始 MCP 工具定义
   */
  getMCPTool(): MCPTool {
    return this.mcpTool;
  }
}
