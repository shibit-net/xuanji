/**
 * 模板仓库 - 管理 MCP Prompts
 *
 * 职责：
 * 1. 从 MCPManager 获取所有 MCP Prompts
 * 2. 提供模板列表查询
 * 3. 提供模板渲染（支持参数替换）
 */

import type { MCPManager } from '@/mcp/MCPManager';
import type { Template, RenderedTemplate, TemplateMessage } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'template-repo' });

export class TemplateRepo {
  constructor(private mcpManager: MCPManager) {}

  /**
   * 列出所有模板
   */
  async list(): Promise<Template[]> {
    try {
      const mcpPrompts = await this.mcpManager.getAllPrompts();

      return mcpPrompts.map(({ serverName, prompt }) => ({
        id: `${serverName}:${prompt.name}`,
        name: prompt.name,
        serverName,
        description: prompt.description,
        arguments: prompt.arguments?.map(arg => ({
          name: arg.name,
          description: arg.description,
          required: arg.required,
        })),
      }));
    } catch (error) {
      log.error('Failed to list templates:', error);
      return [];
    }
  }

  /**
   * 获取并渲染模板
   *
   * @param templateId 模板 ID（格式：serverName:promptName）
   * @param args 模板参数
   * @returns 渲染后的模板
   */
  async get(templateId: string, args?: Record<string, string>): Promise<RenderedTemplate> {
    const [serverName, promptName] = templateId.split(':');

    if (!serverName || !promptName) {
      throw new Error(
        `Invalid template ID: "${templateId}". Expected format: "serverName:promptName"`
      );
    }

    // 查找模板定义
    const templates = await this.list();
    const template = templates.find(t => t.id === templateId);

    if (!template) {
      throw new Error(`Template not found: "${templateId}"`);
    }

    // 验证必填参数
    const missingArgs = template.arguments
      ?.filter(arg => arg.required && !(args && args[arg.name]))
      .map(arg => arg.name);

    if (missingArgs && missingArgs.length > 0) {
      throw new Error(`Missing required arguments: ${missingArgs.join(', ')}`);
    }

    // 调用 MCP prompts/get 获取渲染后的消息
    try {
      const client = this.mcpManager.getClient(serverName);
      if (!client) {
        throw new Error(`MCP server not found: "${serverName}"`);
      }

      const promptResult = await client.getPrompt(promptName, args);

      // 转换消息格式
      const messages: TemplateMessage[] = promptResult.messages.map(msg => {
        // 提取文本内容
        let content = '';
        if (msg.content.type === 'text' && msg.content.text) {
          content = msg.content.text;
        } else {
          // 其他类型（image, resource）暂不支持，记录警告
          log.warn(`Unsupported content type: ${msg.content.type}`);
          content = JSON.stringify(msg.content);
        }

        return {
          role: msg.role,
          content,
        };
      });

      return {
        template,
        messages,
        description: promptResult.description,
      };
    } catch (error) {
      log.error(`Failed to get template "${templateId}":`, error);
      throw error;
    }
  }

  /**
   * 搜索模板
   *
   * @param query 搜索关键词（匹配名称或描述）
   * @returns 匹配的模板列表
   */
  async search(query: string): Promise<Template[]> {
    const templates = await this.list();
    const lowerQuery = query.toLowerCase();

    return templates.filter(
      t =>
        t.name.toLowerCase().includes(lowerQuery) ||
        t.description?.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 按服务器名称过滤模板
   *
   * @param serverName 服务器名称
   * @returns 该服务器的所有模板
   */
  async listByServer(serverName: string): Promise<Template[]> {
    const templates = await this.list();
    return templates.filter(t => t.serverName === serverName);
  }
}
