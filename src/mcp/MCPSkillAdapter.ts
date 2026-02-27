/**
 * ============================================================
 * MCP Skill Adapter - Bridge MCP Prompts to Skill
 * ============================================================
 * 将 MCP Prompt 适配为璇玑的 Skill 接口
 */

import type { Skill, SkillParameter, SkillRenderOptions } from '@/core/skills/types';
import { getMCPManager } from './MCPManager';
import type { MCPPrompt } from './types';

/**
 * MCP Skill 适配器
 *
 * 将 MCP Prompt 包装为 Skill，使其能够在璇玑的 Skill 系统中使用
 * Skill ID 格式: {serverName}:{promptName} (如 market:trading_strategy)
 */
export class MCPSkillAdapter implements Skill {
  readonly id: string;
  readonly name: string;
  readonly version: string = '1.0.0';
  readonly description: string;
  readonly category: 'prompt' = 'prompt';
  readonly tags: string[];
  readonly enabled: boolean = true;
  readonly priority: number = 70; // 低于内置 Skills（默认 80-100）

  private serverName: string;
  private mcpPrompt: MCPPrompt;

  // 参数定义（从 MCP Prompt 的 arguments 转换）
  readonly parameters?: Record<string, SkillParameter>;

  constructor(serverName: string, mcpPrompt: MCPPrompt) {
    this.serverName = serverName;
    this.mcpPrompt = mcpPrompt;

    // Skill ID: serverName:promptName
    this.id = `${serverName}:${mcpPrompt.name}`;
    this.name = `${serverName}/${mcpPrompt.name}`;
    this.description = mcpPrompt.description ?? `MCP prompt from ${serverName}`;
    this.tags = ['mcp', serverName];

    // 转换参数定义
    if (mcpPrompt.arguments && mcpPrompt.arguments.length > 0) {
      this.parameters = {};
      for (const arg of mcpPrompt.arguments) {
        this.parameters[arg.name] = {
          name: arg.name,
          type: 'string', // MCP Prompt 参数都是字符串
          description: arg.description ?? '',
          required: arg.required ?? false,
        };
      }
    }
  }

  /**
   * 渲染 Skill（调用 MCP prompts/get）
   */
  async render(options?: SkillRenderOptions): Promise<string> {
    const manager = getMCPManager();

    try {
      // 提取参数（只传递字符串类型）
      const args: Record<string, string> = {};
      if (options?.params) {
        for (const [key, value] of Object.entries(options.params)) {
          if (typeof value === 'string') {
            args[key] = value;
          } else if (value != null) {
            args[key] = String(value);
          }
        }
      }

      const result = await manager.getPrompt(this.serverName, this.mcpPrompt.name, args);

      // 合并所有消息内容
      const contents: string[] = [];
      for (const message of result.messages) {
        if (message.content.type === 'text' && message.content.text) {
          // 添加角色前缀（如果有多条消息）
          if (result.messages.length > 1) {
            contents.push(`[${message.role}]`);
          }
          contents.push(message.content.text);
        }
      }

      return contents.join('\n\n');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[MCPSkillAdapter] Failed to render skill "${this.id}":`, message);
      return `<!-- MCP Skill Error: ${message} -->`;
    }
  }

  /**
   * 获取服务器名称
   */
  getServerName(): string {
    return this.serverName;
  }

  /**
   * 获取原始 MCP Prompt 定义
   */
  getMCPPrompt(): MCPPrompt {
    return this.mcpPrompt;
  }
}
