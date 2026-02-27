/**
 * ============================================================
 * MCP SSE Client - HTTP + Server-Sent Events Transport
 * ============================================================
 * 通过 HTTP POST 发送请求，通过 SSE 接收响应
 */

import { EventEmitter } from 'node:events';
import { logger } from '@/core/logger';
import type {
  JSONRPCRequest,
  JSONRPCResponse,
  MCPTool,
  MCPPrompt,
  ListToolsResult,
  ListPromptsResult,
  CallToolParams,
  CallToolResult,
  GetPromptParams,
  GetPromptResult,
  MCPServerConfig,
  MCPServerState,
} from './types';

/** 最大重连次数 */
const MAX_RECONNECT_ATTEMPTS = 10;

/** 最大重连延迟（毫秒） */
const MAX_RECONNECT_DELAY = 30_000;

/** MCP 协议版本 */
const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * 待处理的 RPC 请求
 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * MCPSSEClient 配置
 */
export interface MCPSSEClientOptions {
  /** 服务器配置（必须包含 sseUrl 和 httpUrl） */
  config: MCPServerConfig;
  /** 超时时间（毫秒，默认 30000） */
  timeout?: number;
  /** 是否启用调试日志 */
  debug?: boolean;
}

/**
 * MCP SSE 客户端
 *
 * 使用 HTTP POST 发送 JSON-RPC 请求，通过 SSE 接收响应。
 */
export class MCPSSEClient extends EventEmitter {
  private config: MCPServerConfig;
  private timeout: number;
  private debug: boolean;

  private state: MCPServerState = 'uninitialized';
  private nextId = 1;
  private pendingRequests = new Map<number | string, PendingRequest>();

  // 缓存
  private toolsCache?: MCPTool[];
  private promptsCache?: MCPPrompt[];

  // 重连
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private reconnecting = false;

  // SSE 连接
  private abortController?: AbortController;

  // 服务器信息
  private serverCapabilities?: Record<string, unknown>;
  private serverInfo?: { name: string; version: string };

  constructor(options: MCPSSEClientOptions) {
    super();
    this.config = options.config;
    this.timeout = options.timeout ?? 30_000;
    this.debug = options.debug ?? false;

    if (!this.config.sseUrl || !this.config.httpUrl) {
      throw new Error(`MCPSSEClient requires sseUrl and httpUrl for server "${this.config.name}"`);
    }
  }

  /**
   * 启动 SSE 连接
   */
  async start(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.state === 'starting') {
      throw new Error(`MCP SSE server "${this.config.name}" is already starting`);
    }

    this.state = 'starting';
    this.intentionalClose = false;
    this.log('Connecting to SSE endpoint...');

    try {
      // 启动 SSE 监听
      await this.connectSSE();

      // 发送 initialize 握手
      await this.performInitialize();

      this.reconnectAttempts = 0;
      this.log('SSE connection established');
    } catch (error) {
      this.state = 'error';
      this.log(`Failed to connect: ${error}`, 'error');
      throw error;
    }
  }

  /**
   * 建立 SSE 连接
   */
  private async connectSSE(): Promise<void> {
    this.abortController = new AbortController();

    try {
      const response = await fetch(this.config.sseUrl!, {
        headers: { Accept: 'text/event-stream' },
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('SSE response has no body');
      }

      // 异步读取 SSE 流
      this.readSSEStream(response.body);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      throw error;
    }
  }

  /**
   * 读取 SSE 流
   */
  private async readSSEStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processChunk = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // 解析 SSE 事件
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';

          for (const event of events) {
            this.handleSSEEvent(event);
          }
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        this.log(`SSE stream error: ${error}`, 'error');

        if (!this.intentionalClose) {
          this.state = 'closed';
          this.reconnect();
        }
      }
    };

    // 不阻塞 start()，异步处理 SSE 流
    processChunk();
  }

  /**
   * 处理单个 SSE 事件
   */
  private handleSSEEvent(event: string): void {
    let data = '';
    for (const line of event.split('\n')) {
      if (line.startsWith('data: ')) {
        data += line.slice(6);
      }
    }

    if (!data) return;

    try {
      const response = JSON.parse(data) as JSONRPCResponse;
      this.handleResponse(response);
    } catch (error) {
      this.log(`Failed to parse SSE data: ${data}`, 'error');
    }
  }

  /**
   * 处理 JSON-RPC 响应
   */
  private handleResponse(response: JSONRPCResponse): void {
    this.log(`<- ${JSON.stringify(response)}`);

    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      this.log(`Received response for unknown request ID: ${response.id}`, 'warn');
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);

    if ('error' in response) {
      pending.reject(new Error(`MCP Error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * MCP 协议 initialize 握手
   */
  private async performInitialize(): Promise<void> {
    try {
      const result = await this.call<{
        protocolVersion: string;
        capabilities: Record<string, unknown>;
        serverInfo: { name: string; version: string };
      }>('initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: true },
        },
        clientInfo: {
          name: 'xuanji',
          version: '0.9.0',
        },
      });

      this.serverCapabilities = result.capabilities;
      this.serverInfo = result.serverInfo;
      this.log(`Initialize successful: server=${result.serverInfo?.name ?? 'unknown'}`);

      // 发送 initialized 通知
      await this.sendHTTP({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      } as JSONRPCRequest);

      this.state = 'ready';
    } catch (error) {
      this.log(`Initialize failed (falling back): ${error}`, 'warn');
      this.state = 'ready';
    }
  }

  /**
   * 发送 JSON-RPC 请求（通过 HTTP POST）
   */
  private async call<T>(method: string, params?: unknown): Promise<T> {
    if (this.state !== 'ready' && method !== 'initialize') {
      await this.start();
    }

    const id = this.nextId++;
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params: params as Record<string, unknown>,
    };

    this.log(`-> ${JSON.stringify(request)}`);

    // 创建 pending promise
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.timeout);

      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    });

    // 发送 HTTP POST
    await this.sendHTTP(request);

    return promise;
  }

  /**
   * 通过 HTTP POST 发送请求
   */
  private async sendHTTP(request: JSONRPCRequest): Promise<void> {
    const response = await fetch(this.config.httpUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP POST failed: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * 自动重连
   */
  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.intentionalClose) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.log(`Max reconnect attempts reached for "${this.config.name}"`, 'error');
      this.state = 'error';
      this.emit('reconnect_failed', this.config.name);
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), MAX_RECONNECT_DELAY);

    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`, 'warn');
    this.emit('reconnecting', { name: this.config.name, attempt: this.reconnectAttempts, delay });

    await new Promise((resolve) => setTimeout(resolve, delay));

    this.state = 'uninitialized';
    this.toolsCache = undefined;
    this.promptsCache = undefined;
    this.reconnecting = false;

    try {
      await this.start();
      this.emit('reconnected', this.config.name);
    } catch (reconnectErr) {
      this.log(`Reconnect failed: ${reconnectErr instanceof Error ? reconnectErr.message : String(reconnectErr)}`, 'warn');
    }
  }

  // ─── 公共 API（与 MCPClient 接口一致）─────────────────

  async listTools(): Promise<MCPTool[]> {
    if (this.toolsCache) return this.toolsCache;
    const result = await this.call<ListToolsResult>('tools/list');
    this.toolsCache = result.tools ?? [];
    return this.toolsCache;
  }

  async listPrompts(): Promise<MCPPrompt[]> {
    if (this.promptsCache) return this.promptsCache;
    const result = await this.call<ListPromptsResult>('prompts/list');
    this.promptsCache = result.prompts ?? [];
    return this.promptsCache;
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult> {
    return this.call<CallToolResult>('tools/call', { name, arguments: args } as CallToolParams);
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    return this.call<GetPromptResult>('prompts/get', { name, arguments: args } as GetPromptParams);
  }

  async close(): Promise<void> {
    if (this.state === 'closed') return;

    this.intentionalClose = true;
    this.abortController?.abort();

    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('MCP SSE client is closing'));
    }
    this.pendingRequests.clear();

    this.state = 'closed';
    this.log('SSE connection closed');
  }

  getState(): MCPServerState { return this.state; }
  getName(): string { return this.config.name; }
  getServerInfo() { return this.serverInfo; }
  getServerCapabilities() { return this.serverCapabilities; }
  getReconnectAttempts(): number { return this.reconnectAttempts; }

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.debug && level === 'info') return;
    const mcpLog = logger.child({ module: `MCPSSEClient:${this.config.name}` });
    switch (level) {
      case 'error': mcpLog.error(message); break;
      case 'warn': mcpLog.warn(message); break;
      default: mcpLog.debug(message);
    }
  }
}
