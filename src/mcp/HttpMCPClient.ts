/**
 * ============================================================
 * HTTP MCP Client - 基于 HttpTransport 的 MCP 客户端
 * ============================================================
 * 使用 HttpTransport 实现远程 MCP Server 连接
 */

import { EventEmitter } from 'node:events';
import { logger } from '@/infrastructure/logger';
import { HttpTransport, type HttpTransportOptions } from './transports/HttpTransport';
import type {
  MCPTool,
  MCPPrompt,
  MCPResource,
  ResourceContent,
  ListToolsResult,
  ListPromptsResult,
  ListResourcesResult,
  CallToolParams,
  CallToolResult,
  GetPromptParams,
  GetPromptResult,
  ReadResourceParams,
  ReadResourceResult,
  MCPServerConfig,
  MCPServerState,
} from './types';

/** MCP 协议版本 */
const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * HttpMCPClient 配置
 */
export interface HttpMCPClientOptions {
  /** 服务器配置 */
  config: MCPServerConfig;
  /** 超时时间（毫秒，默认 30000） */
  timeout?: number;
  /** 是否启用调试日志 */
  debug?: boolean;
}

/**
 * HTTP MCP 客户端
 *
 * 提供与 MCPClient 一致的接口，底层使用 HttpTransport 实现。
 */
export class HttpMCPClient extends EventEmitter {
  private config: MCPServerConfig;
  private timeout: number;
  private debug: boolean;
  private transport: HttpTransport;

  // 缓存
  private toolsCache?: MCPTool[];
  private promptsCache?: MCPPrompt[];
  private resourcesCache?: MCPResource[];

  // 服务器信息
  private serverCapabilities?: Record<string, unknown>;
  private serverInfo?: { name: string; version: string };

  // 正在 start 时的 Promise（供并发调用者等待）
  private startPromise?: Promise<void>;

  constructor(options: HttpMCPClientOptions) {
    super();
    this.config = options.config;
    this.timeout = options.timeout ?? 30_000;
    this.debug = options.debug ?? false;

    // 创建 HttpTransport
    const transportOptions: HttpTransportOptions = {
      url: this.config.url ?? this.config.httpUrl ?? '',
      headers: this.config.headers ?? {},
      timeout: this.config.timeout ?? this.timeout,
      enableSSE: this.config.transport === 'sse',
      debug: this.debug,
    };

    // 如果是 SSE 模式且配置了 sseUrl，更新 ssePath
    if (this.config.transport === 'sse' && this.config.sseUrl) {
      const sseUrl = new URL(this.config.sseUrl);
      transportOptions.ssePath = sseUrl.pathname;
    }

    this.transport = new HttpTransport(transportOptions);

    // 转发 transport 事件
    this.transport.on('reconnecting', (data) => this.emit('reconnecting', { name: this.config.name, ...data }));
    this.transport.on('reconnected', () => this.emit('reconnected', this.config.name));
    this.transport.on('reconnect_failed', () => this.emit('reconnect_failed', this.config.name));
  }

  /**
   * 启动 MCP 服务器
   */
  async start(): Promise<void> {
    if (this.getState() === 'ready') {
      return; // 已启动
    }

    if (this.getState() === 'starting') {
      // 等待正在进行的 start() 完成
      if (this.startPromise) {
        return this.startPromise;
      }
      throw new Error(`HTTP MCP server "${this.config.name}" is already starting`);
    }

    this.log('Starting HTTP MCP client...');

    this.startPromise = this._startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  /**
   * 内部启动逻辑
   */
  private async _startInternal(): Promise<void> {
    try {
      // 初始化 transport
      await this.transport.initialize();

      // 发送 MCP initialize 握手
      await this.performInitialize();

      this.log('HTTP MCP client started successfully');
    } catch (error) {
      this.log(`Failed to start: ${error}`, 'error');
      throw error;
    }
  }

  /**
   * MCP 协议 initialize 握手
   */
  private async performInitialize(): Promise<void> {
    try {
      const result = await this.transport.request('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: true },
          resources: { subscribe: true },
        },
        clientInfo: {
          name: 'xuanji',
          version: '0.9.0',
        },
      }) as {
        protocolVersion: string;
        capabilities: Record<string, unknown>;
        serverInfo: { name: string; version: string };
      };

      this.serverCapabilities = result.capabilities;
      this.serverInfo = result.serverInfo;
      this.log(`Initialize successful: server=${result.serverInfo?.name ?? 'unknown'}, protocol=${result.protocolVersion}`);

      // 发送 initialized 通知（如果 transport 是 SSE 模式）
      if (this.config.transport === 'sse') {
        await this.transport.request('notifications/initialized', {});
      }
    } catch (error) {
      // 如果服务器不支持 initialize（旧版 MCP），降级处理
      this.log(`Initialize failed (falling back to direct mode): ${error}`, 'warn');
    }
  }

  /**
   * 获取工具列表
   */
  async listTools(): Promise<MCPTool[]> {
    if (this.toolsCache) {
      return this.toolsCache;
    }

    if (this.getState() !== 'ready') {
      await this.start();
    }

    const result = await this.transport.request('tools/list', {}) as ListToolsResult;
    this.toolsCache = result.tools ?? [];
    return this.toolsCache;
  }

  /**
   * 获取 Prompt 列表
   */
  async listPrompts(): Promise<MCPPrompt[]> {
    if (this.promptsCache) {
      return this.promptsCache;
    }

    if (this.getState() !== 'ready') {
      await this.start();
    }

    const result = await this.transport.request('prompts/list', {}) as ListPromptsResult;
    this.promptsCache = result.prompts ?? [];
    return this.promptsCache;
  }

  /**
   * 获取资源列表
   */
  async listResources(): Promise<MCPResource[]> {
    if (this.resourcesCache) {
      return this.resourcesCache;
    }

    if (this.getState() !== 'ready') {
      await this.start();
    }

    const result = await this.transport.request('resources/list', {}) as ListResourcesResult;
    this.resourcesCache = result.resources ?? [];
    return this.resourcesCache;
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult> {
    if (this.getState() !== 'ready') {
      await this.start();
    }

    const params: Record<string, unknown> = {
      name,
      arguments: args,
    };
    return this.transport.request('tools/call', params) as Promise<CallToolResult>;
  }

  /**
   * 获取 Prompt
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    if (this.getState() !== 'ready') {
      await this.start();
    }

    const params: Record<string, unknown> = {
      name,
      arguments: args,
    };
    return this.transport.request('prompts/get', params) as Promise<GetPromptResult>;
  }

  /**
   * 读取资源
   */
  async readResource(uri: string): Promise<ResourceContent[]> {
    if (this.getState() !== 'ready') {
      await this.start();
    }

    const params: Record<string, unknown> = { uri };
    const result = await this.transport.request('resources/read', params) as ReadResourceResult;
    return result.contents ?? [];
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    this.log('Closing HTTP MCP client...');
    await this.transport.close();
    this.log('HTTP MCP client closed');
  }

  /**
   * 获取当前状态
   */
  getState(): MCPServerState {
    return this.transport.getState();
  }

  /**
   * 获取服务器名称
   */
  getName(): string {
    return this.config.name;
  }

  /**
   * 获取服务器信息（initialize 握手后可用）
   */
  getServerInfo(): { name: string; version: string } | undefined {
    return this.serverInfo;
  }

  /**
   * 获取服务器能力（initialize 握手后可用）
   */
  getServerCapabilities(): Record<string, unknown> | undefined {
    return this.serverCapabilities;
  }

  /**
   * 获取当前重连尝试次数
   */
  getReconnectAttempts(): number {
    return 0; // HttpTransport 内部管理重连，暂不暴露
  }

  /**
   * 清除工具列表缓存
   */
  invalidateToolsCache(): void {
    this.toolsCache = undefined;
  }

  /**
   * 清除资源列表缓存
   */
  invalidateResourcesCache(): void {
    this.resourcesCache = undefined;
  }

  /**
   * 日志输出
   */
  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.debug && level === 'info') {
      return;
    }

    const mcpLog = logger.child({ module: `HttpMCPClient:${this.config.name}` });
    switch (level) {
      case 'error':
        mcpLog.error(message);
        break;
      case 'warn':
        mcpLog.warn(message);
        break;
      default:
        mcpLog.debug(message);
    }
  }
}
