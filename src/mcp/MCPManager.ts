/**
 * ============================================================
 * MCP Manager - Multi-Server Manager (Singleton)
 * ============================================================
 * 管理多个 MCP 服务器，提供统一的工具调用接口
 */

import { MCPClient } from './MCPClient';
import { MCPSSEClient } from './MCPSSEClient';
import { HttpMCPClient } from './HttpMCPClient';
import type {
  MCPConfig,
  MCPServerConfig,
  MCPTool,
  MCPPrompt,
  CallToolResult,
  GetPromptResult,
  MCPServerRuntime,
  IMCPClient,
} from './types';
import { logger } from '@/infrastructure/logger';
import { mcpSettingsPersistence } from './config/settings-persistence';
import { watchFile } from 'node:fs';

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
  /** 初始化锁，防止并发初始化 */
  private initPromise?: Promise<void>;

  /** reconnect 后工具变更回调 */
  onToolsChanged?: (serverName: string) => void;

  /** 工具变更监听器列表（支持多路监听） */
  private onToolsChangedListeners = new Set<(serverName: string) => void>();

  /** 注册工具变更监听器 */
  onToolsChangedSubscribe(listener: (serverName: string) => void): () => void {
    this.onToolsChangedListeners.add(listener);
    return () => { this.onToolsChangedListeners.delete(listener); };
  }

  /** 通知所有工具变更监听器 */
  private notifyToolsChanged(serverName: string): void {
    this.onToolsChanged?.(serverName);
    for (const listener of this.onToolsChangedListeners) {
      try { listener(serverName); } catch (e) { /* ignore */ }
    }
  }

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
   * @param config MCP 配置（可选，不传则从 ~/.xuanji/mcp.json 加载）
   */
  async initialize(config?: MCPConfig): Promise<void> {
    // 并发安全：如果正在初始化，等待完成
    if (this.initPromise) {
      return this.initPromise;
    }

    if (this.initialized) {
      log.warn('Already initialized, skipping');
      return;
    }

    // 如果未提供 config，从持久化配置加载
    const effectiveConfig = config ?? (await this.loadFromConfig());

    this.initPromise = this._doInitialize(effectiveConfig);
    try {
      await this.initPromise;
      this.startHotReload();
    } finally {
      this.initPromise = undefined;
    }
  }

  /**
   * 内部初始化实现
   */
  private async _doInitialize(config: MCPConfig): Promise<void> {
    this.config = config;

    for (const serverConfig of config.servers) {
      if (serverConfig.disabled) {
        log.debug(`Skipping disabled server: ${serverConfig.name}`);
        continue;
      }

      try {
        const client = this.createClient(serverConfig, config);
        this.clients.set(serverConfig.name, client);

        // 监听重连失败事件
        client.on('reconnect_failed', (name: string) => {
          log.error(`MCP server "${name}" reconnect failed, closing and removing from active clients`);
          client.close().catch(() => {});
          this.clients.delete(name);
        });

        // 监听重连成功事件
        client.on('reconnected', (name: string) => {
          log.info(`MCP server "${name}" reconnected, refreshing tools`);
          this.refreshServerTools(name).catch((err) => {
            log.warn(`Failed to refresh tools for "${name}" after reconnect:`, err);
          });
        });

        log.info(`Registered MCP server: ${serverConfig.name} (transport: ${serverConfig.transport ?? 'stdio'})`);
      } catch (error) {
        log.warn(`Failed to register server "${serverConfig.name}":`, error);
      }
    }

    this.initialized = true;
    log.info(`Initialized with ${this.clients.size} server(s)`);
  }

  /**
   * 创建适配的 MCP 客户端（根据 transport 类型）
   */
  createClient(serverConfig: MCPServerConfig, config?: MCPConfig): IMCPClient {
    const transport = serverConfig.transport ?? 'stdio';
    const timeout = config?.timeout;

    switch (transport) {
      case 'sse':
        return new MCPSSEClient({
          config: serverConfig,
          timeout,
          debug: process.env.MCP_DEBUG === 'true',
        });
      case 'http':
        return new HttpMCPClient({
          config: serverConfig,
          timeout,
          debug: process.env.MCP_DEBUG === 'true',
        });
      default:
        return new MCPClient({
          config: serverConfig,
          timeout,
          debug: process.env.MCP_DEBUG === 'true',
        });
    }
  }

  // ─── 动态服务器管理 ────────────────────────────

  /**
   * 添加一个 MCP 服务器（动态注册）
   * - 如果已存在同名服务器，先关闭旧的再替换
   * - 自动持久化到 ~/.xuanji/mcp.json
   */
  async addServer(serverConfig: MCPServerConfig): Promise<void> {
    if (serverConfig.disabled) {
      log.debug(`Skipping disabled server: ${serverConfig.name}`);
      return;
    }

    // 如果已存在同名客户端，先关闭旧连接
    const existing = this.clients.get(serverConfig.name);
    if (existing) {
      log.info(`Replacing existing server "${serverConfig.name}"`);
      try {
        await existing.close();
      } catch (e) {
        log.warn(`Error closing existing client for "${serverConfig.name}":`, e);
      }
      this.clients.delete(serverConfig.name);
    }

    // 创建新客户端
    const client = this.createClient(serverConfig, this.config);
    this.clients.set(serverConfig.name, client);

    // 绑定事件
    client.on('reconnect_failed', (name: string) => {
      log.error(`MCP server "${name}" reconnect failed, closing and removing`);
      client.close().catch(() => {});
      this.clients.delete(name);
      // 可选：从持久化配置中移除？这里选择保留，下次重启自动跳过
    });

    client.on('reconnected', (name: string) => {
      log.info(`MCP server "${name}" reconnected, refreshing tools`);
      this.refreshServerTools(name).catch((err) => {
        log.warn(`Failed to refresh tools for "${name}" after reconnect:`, err);
      });
    });

    // 更新内存 config
    if (this.config) {
      const idx = this.config.servers.findIndex(s => s.name === serverConfig.name);
      if (idx !== -1) {
        this.config.servers[idx] = serverConfig;
      } else {
        this.config.servers.push(serverConfig);
      }
    } else {
      this.config = { servers: [serverConfig] };
    }

    // 持久化
    await mcpSettingsPersistence.addServer(serverConfig);
    log.info(`Added MCP server: ${serverConfig.name} (transport: ${serverConfig.transport ?? 'stdio'})`);

    // 通知外部工具已变更
    this.notifyToolsChanged(serverConfig.name);
  }

  /**
   * 移除一个 MCP 服务器
   * @returns 是否成功移除（false 表示该服务器不存在）
   */
  async removeServer(name: string): Promise<boolean> {
    // 关闭客户端连接
    const client = this.clients.get(name);
    if (client) {
      try {
        await client.close();
      } catch (e) {
        log.warn(`Error closing client for "${name}":`, e);
      }
      this.clients.delete(name);
    }

    // 从内存 config 中移除
    if (this.config) {
      this.config.servers = this.config.servers.filter(s => s.name !== name);
    }

    // 从持久化中移除
    const removed = await mcpSettingsPersistence.removeServer(name);
    if (removed) {
      log.info(`Removed MCP server: ${name}`);
    }

    // 通知外部工具已变更（即使持久化删除失败，内存中已移除）
    if (this.clients.size > 0 || removed) {
      this.notifyToolsChanged(name);
    }
    return removed;
  }

  // ─── 持久化 ────────────────────────────────────

  /**
   * 从 ~/.xuanji/mcp.json 加载服务器列表
   * 返回一个 MCPConfig，可直接用于 initialize()
   */
  async loadFromConfig(): Promise<MCPConfig> {
    const servers = await mcpSettingsPersistence.listServers();
    const marketplace = await mcpSettingsPersistence.getMarketplaceConfig();
    log.debug(`Loaded ${servers.length} server(s) from config, marketplace: ${marketplace?.baseUrl || 'not set'}`);
    return { servers, marketplace };
  }

  /** 获取天工坊 marketplace 配置 */
  async getMarketplaceConfig(): Promise<MCPConfig['marketplace']> {
    return mcpSettingsPersistence.getMarketplaceConfig();
  }

  /** 设置天工坊 marketplace 配置 */
  async setMarketplaceConfig(marketplace: MCPConfig['marketplace']): Promise<void> {
    await mcpSettingsPersistence.setMarketplaceConfig(marketplace);
    // 更新内存中的 config
    if (this.config) {
      this.config.marketplace = marketplace;
    }
  }

  /**
   * 将当前内存中的服务器列表写入 ~/.xuanji/mcp.json
   */
  async saveToConfig(): Promise<void> {
    if (!this.config) {
      log.warn('No config to save');
      return;
    }
    // 批量写入：清空并重新添加所有服务器
    const currentServers = await mcpSettingsPersistence.listServers();

    // 移除不再存在的
    for (const s of currentServers) {
      if (!this.config.servers.find(cs => cs.name === s.name)) {
        await mcpSettingsPersistence.removeServer(s.name);
      }
    }
    // 添加/更新现有的
    for (const s of this.config.servers) {
      await mcpSettingsPersistence.addServer(s);
    }
    log.debug(`Saved ${this.config.servers.length} server(s) to config`);
  }

  // ─── 热重载 ────────────────────────────────────

  /**
   * 热重载配置：从 ~/.xuanji/mcp.json 重新加载，自动 diff 增删服务器。
   *
   * - 文件中有但内存中没有 → addServer()
   * - 内存中有但文件中没有 → removeServer()
   */

  /**
   * Compare critical fields between two server configs for hot-reload diff.
   * Only compares fields that affect subprocess startup/connection.
   */
  private hasServerConfigChanged(oldCfg: MCPServerConfig, newCfg: MCPServerConfig): boolean {
    const compareKeys: (keyof MCPServerConfig)[] = [
      'command', 'args', 'env', 'cwd', 'transport',
      'sseUrl', 'httpUrl', 'url', 'headers', 'timeout',
      'disabled',
    ];
    for (const key of compareKeys) {
      if (JSON.stringify(oldCfg[key]) !== JSON.stringify(newCfg[key])) {
        return true;
      }
    }
    return false;
  }
  async reloadConfig(): Promise<void> {
    if (!this.initialized) {
      log.debug('Not initialized, skipping hot reload');
      return;
    }

    try {
      // 清除缓存确保读到最新文件内容
      mcpSettingsPersistence.clearCache();
      const fileServers = await mcpSettingsPersistence.listServers();
      const memoryNames = new Set(this.clients.keys());
      const fileNames = new Set(fileServers.map(s => s.name));

      // 新增的 server
      for (const server of fileServers) {
        if (!memoryNames.has(server.name)) {
          log.info(`[hot-reload] Adding new server: ${server.name}`);
          await this.addServer(server);
        }
      }

      // 被移除的 server
      for (const name of memoryNames) {
        if (!fileNames.has(name)) {
          log.info(`[hot-reload] Removing server: ${name}`);
          await this.removeServer(name);
        }
      }

      // Config-changed servers (both sides exist, but args/env/command etc. changed)
      for (const fileServer of fileServers) {
        if (!memoryNames.has(fileServer.name)) continue;
        const memServer = this.config?.servers.find(s => s.name === fileServer.name);
        if (!memServer) continue;

        if (this.hasServerConfigChanged(memServer, fileServer)) {
          log.info(`[hot-reload] Config changed for server: ${fileServer.name}, restarting...`);
          await this.addServer(fileServer);
        }
      }

      log.debug(`Hot reload complete: ${this.clients.size} server(s) active`);
    } catch (err) {
      log.error('Hot reload failed:', err);
    }
  }

  /**
   * 启动文件监控 — 监听 ~/.xuanji/mcp.json 变化，自动热重载。
   *
   * 使用 fs.watchFile 实现，兼容性好，跨平台。
   */
  startHotReload(): void {
    const configPath = mcpSettingsPersistence.configPath;
    log.info(`Watching for MCP config changes: ${configPath}`);

    // 防抖：500ms 内的多次变化只处理一次
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    watchFile(configPath, { interval: 1000 }, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.reloadConfig().catch(err =>
          log.error('Hot reload error:', err),
        );
      }, 500);
    });
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
    // 并发安全：等待初始化完成
    if (this.initPromise) {
      await this.initPromise;
    }

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
    // 并发安全：等待初始化完成
    if (this.initPromise) {
      await this.initPromise;
    }

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
   * 刷新指定服务器的工具列表（reconnect 后调用）
   */
  private async refreshServerTools(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (!client) return;

    try {
      // 先清除缓存，确保获取最新工具列表（防止并发调用填充旧缓存）
      client.invalidateToolsCache();
      await client.listTools();
      log.info(`Refreshed tools for "${serverName}"`);

      // 通知外部工具已变更
      this.notifyToolsChanged(serverName);
    } catch (error) {
      log.warn(`Failed to refresh tools for "${serverName}":`, error);
    }
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
   * 获取所有已配置的服务器（含运行时工具数量）
   */
  get servers(): Array<MCPServerConfig & { tools?: MCPTool[] }> {
    if (!this.config) return [];
    return this.config.servers.map(s => {
      const client = this.clients.get(s.name);
      return { ...s, tools: (client as any)?.toolsCache ?? [] };
    });
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
