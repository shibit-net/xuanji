/**
 * ============================================================
 * MCP Manager - Multi-Server Manager (Singleton)
 * ============================================================
 * 管理多个 MCP 服务器，提供统一的工具调用接口
 */

import { MCPClient } from './MCPClient';
import { MCPSSEClient } from './MCPSSEClient';
import type {
  MCPConfig,
  MCPTool,
  MCPPrompt,
  CallToolResult,
  GetPromptResult,
  MCPServerRuntime,
  IMCPClient,
} from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MCPManager' });

/**
 * MCP 管理器（单例）
 */
export class MCPManager {
  private static instance?: MCPManager;

  private clients = new Map<string, IMCPClient>();
  private config?: MCPConfig;
  private initialized = false;
  private _shutdown = false;

  private constructor() {
    // 私有构造函数，防止外部实例化
  }

  /**
   * 获取单例实例
   */
  static getInstance(): MCPManager {
    if (!MCPManager.instance) {
      MCPManager.instance = new MCPManager();
    }
    return MCPManager.instance;
  }

  /**
   * 初始化 MCP 管理器
   * @param config MCP 配置
   */
  async initialize(config: MCPConfig): Promise<void> {
    if (this.initialized) {
      log.warn('Already initialized, skipping');
      return;
    }

    this.config = config;

    // 创建所有 MCPClient（但不启动）
    for (const serverConfig of config.servers) {
      if (serverConfig.disabled) {
        log.debug(`Skipping disabled server: ${serverConfig.name}`);
        continue;
      }

      try {
        let client: IMCPClient;

        if (serverConfig.transport === 'sse') {
          // SSE transport
          client = new MCPSSEClient({
            config: serverConfig,
            timeout: config.timeout,
            debug: process.env.MCP_DEBUG === 'true',
          });
        } else {
          // stdio transport (默认)
          client = new MCPClient({
            config: serverConfig,
            timeout: config.timeout,
            debug: process.env.MCP_DEBUG === 'true',
          });
        }

        this.clients.set(serverConfig.name, client);

        // 监听重连失败事件，从工具列表移除不可用的服务器
        if (client instanceof MCPClient) {
          client.on('reconnect_failed', (name: string) => {
            log.error(`MCP server "${name}" reconnect failed, removing from active clients`);
            this.clients.delete(name);
          });
        }

        log.info(`Registered MCP server: ${serverConfig.name} (transport: ${serverConfig.transport ?? 'stdio'})`);
      } catch (error) {
        log.warn(`Failed to register server "${serverConfig.name}":`, error);
        // 继续注册其他服务器
      }
    }

    this.initialized = true;
    log.info(`Initialized with ${this.clients.size} server(s)`);
  }

  /**
   * 获取所有工具（跨所有服务器）
   */
  async getAllTools(): Promise<Array<{ serverName: string; tool: MCPTool }>> {
    const allTools: Array<{ serverName: string; tool: MCPTool }> = [];

    for (const [serverName, client] of this.clients.entries()) {
      try {
        const tools = await client.listTools();
        for (const tool of tools) {
          allTools.push({ serverName, tool });
        }
      } catch (error) {
        log.warn(`Failed to list tools from "${serverName}":`, error);
        // 继续处理其他服务器
      }
    }

    return allTools;
  }

  /**
   * 获取所有 Prompts（跨所有服务器）
   */
  async getAllPrompts(): Promise<Array<{ serverName: string; prompt: MCPPrompt }>> {
    const allPrompts: Array<{ serverName: string; prompt: MCPPrompt }> = [];

    for (const [serverName, client] of this.clients.entries()) {
      try {
        const prompts = await client.listPrompts();
        for (const prompt of prompts) {
          allPrompts.push({ serverName, prompt });
        }
      } catch (error) {
        log.warn(`Failed to list prompts from "${serverName}":`, error);
        // 继续处理其他服务器
      }
    }

    return allPrompts;
  }

  /**
   * 调用工具
   * @param serverName 服务器名称
   * @param toolName 工具名称
   * @param args 工具参数
   */
  async callTool(
    serverName: string,
    toolName: string,
    args?: Record<string, unknown>
  ): Promise<CallToolResult> {
    if (this._shutdown) {
      throw new Error('MCPManager has been shut down');
    }
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server "${serverName}" not found`);
    }

    try {
      return await client.callTool(toolName, args);
    } catch (error) {
      log.error(`Failed to call tool "${serverName}:${toolName}":`, error);
      throw error;
    }
  }

  /**
   * 获取 Prompt
   * @param serverName 服务器名称
   * @param promptName Prompt 名称
   * @param args Prompt 参数
   */
  async getPrompt(
    serverName: string,
    promptName: string,
    args?: Record<string, string>
  ): Promise<GetPromptResult> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server "${serverName}" not found`);
    }

    try {
      return await client.getPrompt(promptName, args);
    } catch (error) {
      log.error(`Failed to get prompt "${serverName}:${promptName}":`, error);
      throw error;
    }
  }

  /**
   * 获取服务器运行时信息
   */
  getServerRuntimes(): MCPServerRuntime[] {
    const runtimes: MCPServerRuntime[] = [];

    for (const [name, client] of this.clients.entries()) {
      const serverConfig = this.config?.servers.find((s) => s.name === name);
      if (!serverConfig) continue;

      runtimes.push({
        name,
        config: serverConfig,
        state: client.getState(),
      });
    }

    return runtimes;
  }

  /**
   * 获取指定服务器的客户端
   */
  getClient(serverName: string): IMCPClient | undefined {
    return this.clients.get(serverName);
  }

  /**
   * 关闭所有 MCP 连接
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down all MCP servers...');

    const shutdownPromises: Promise<void>[] = [];

    for (const [serverName, client] of this.clients.entries()) {
      shutdownPromises.push(
        client.close().catch((error) => {
          log.warn(`Failed to close server "${serverName}":`, error);
        })
      );
    }

    await Promise.all(shutdownPromises);

    this.clients.clear();
    this.initialized = false;
    this._shutdown = true;
    MCPManager.instance = undefined;
    log.info('All MCP servers shut down');
  }

  /**
   * 检查是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 获取已注册的服务器数量
   */
  getServerCount(): number {
    return this.clients.size;
  }

  /**
   * 重置单例实例（仅用于测试）
   */
  static resetInstance(): void {
    MCPManager.instance = undefined;
  }
}

/**
 * 导出单例获取函数
 */
export function getMCPManager(): MCPManager {
  return MCPManager.getInstance();
}
