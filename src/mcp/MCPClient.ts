/**
 * ============================================================
 * MCP Client - stdio JSON-RPC Client
 * ============================================================
 * 通过 stdio 进行 JSON-RPC 2.0 通信的 MCP 客户端
 * 支持 MCP 协议 initialize 握手和自动重连
 */

import { spawn, type ChildProcess } from 'node:child_process';
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
 * MCPClient 配置
 */
export interface MCPClientOptions {
  /** 服务器配置 */
  config: MCPServerConfig;
  /** 超时时间（毫秒，默认 30000） */
  timeout?: number;
  /** 是否启用调试日志 */
  debug?: boolean;
}

/**
 * MCP 客户端
 */
export class MCPClient extends EventEmitter {
  protected config: MCPServerConfig;
  protected timeout: number;
  protected debug: boolean;

  private process?: ChildProcess;
  private state: MCPServerState = 'uninitialized';
  private nextId = 1;
  private pendingRequests = new Map<number | string, PendingRequest>();

  // 缓存的工具和 Prompt 列表
  private toolsCache?: MCPTool[];
  private promptsCache?: MCPPrompt[];

  // 输出缓冲区（处理不完整的 JSON）
  private outputBuffer = '';

  // 重连状态
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private reconnecting = false;

  // 服务器能力（initialize 握手后获取）
  private serverCapabilities?: Record<string, unknown>;
  private serverInfo?: { name: string; version: string };

  constructor(options: MCPClientOptions) {
    super();
    this.config = options.config;
    this.timeout = options.timeout ?? 30_000;
    this.debug = options.debug ?? false;
  }

  /**
   * 启动 MCP 服务器
   */
  async start(): Promise<void> {
    if (this.state === 'ready') {
      return; // 已启动
    }

    if (this.state === 'starting') {
      throw new Error(`MCP server "${this.config.name}" is already starting`);
    }

    this.state = 'starting';
    this.intentionalClose = false;
    this.log('Starting MCP server...');

    try {
      // 合并环境变量
      const env = {
        ...process.env,
        ...this.config.env,
      };

      // 启动子进程
      this.process = spawn(this.config.command, this.config.args ?? [], {
        cwd: this.config.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
      });

      // 监听输出
      this.process.stdout?.setEncoding('utf-8');
      this.process.stdout?.on('data', (chunk) => this.handleOutput(chunk));

      // 监听错误输出
      this.process.stderr?.setEncoding('utf-8');
      this.process.stderr?.on('data', (chunk) => {
        this.log(`[stderr] ${chunk}`, 'warn');
      });

      // 监听进程退出 — 触发自动重连
      this.process.on('exit', (code, signal) => {
        this.log(`Process exited with code ${code}, signal ${signal}`, 'warn');
        const prevState = this.state;
        this.state = 'closed';
        this.rejectAllPending(new Error(`MCP server process exited: ${code ?? signal}`));

        // 非主动关闭且之前是 ready 状态 → 尝试重连
        if (!this.intentionalClose && prevState === 'ready') {
          this.reconnect();
        }
      });

      // 监听进程错误
      this.process.on('error', (error) => {
        this.log(`Process error: ${error.message}`, 'error');
        this.state = 'error';
        this.rejectAllPending(error);
      });

      // 发送 MCP initialize 握手
      await this.performInitialize();

      this.reconnectAttempts = 0; // 成功连接后重置重连计数
      this.log('MCP server started successfully');
    } catch (error) {
      this.state = 'error';
      this.log(`Failed to start: ${error}`, 'error');
      throw error;
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
          resources: { subscribe: true },
        },
        clientInfo: {
          name: 'xuanji',
          version: '0.9.0',
        },
      });

      this.serverCapabilities = result.capabilities;
      this.serverInfo = result.serverInfo;
      this.log(`Initialize successful: server=${result.serverInfo?.name ?? 'unknown'}, protocol=${result.protocolVersion}`);

      // 发送 initialized 通知
      this.sendNotification('notifications/initialized');

      this.state = 'ready';
    } catch (error) {
      // 如果服务器不支持 initialize（旧版 MCP），降级处理
      this.log(`Initialize failed (falling back to direct mode): ${error}`, 'warn');
      this.state = 'ready';
    }
  }

  /**
   * 发送 JSON-RPC 通知（无 id，不期望响应）
   */
  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.process?.stdin) return;

    const notification = {
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    };

    this.log(`-> notification: ${JSON.stringify(notification)}`);
    this.process.stdin.write(JSON.stringify(notification) + '\n');
  }

  /**
   * 自动重连
   */
  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.intentionalClose) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.log(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached for "${this.config.name}"`, 'error');
      this.state = 'error';
      this.emit('reconnect_failed', this.config.name);
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), MAX_RECONNECT_DELAY);

    this.log(`Reconnecting "${this.config.name}" in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`, 'warn');
    this.emit('reconnecting', { name: this.config.name, attempt: this.reconnectAttempts, delay });

    await new Promise((resolve) => setTimeout(resolve, delay));

    // 清理状态
    this.state = 'uninitialized';
    this.outputBuffer = '';
    this.toolsCache = undefined;
    this.promptsCache = undefined;
    this.reconnecting = false;

    try {
      await this.start();
      this.log(`Reconnected to "${this.config.name}" successfully`);
      this.emit('reconnected', this.config.name);
    } catch (error) {
      this.log(`Reconnect failed: ${error}`, 'error');
      // start() 内部会在 exit 时再次触发 reconnect
    }
  }

  /**
   * 获取工具列表
   */
  async listTools(): Promise<MCPTool[]> {
    if (this.toolsCache) {
      return this.toolsCache;
    }

    const result = await this.call<ListToolsResult>('tools/list');
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

    const result = await this.call<ListPromptsResult>('prompts/list');
    this.promptsCache = result.prompts ?? [];
    return this.promptsCache;
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult> {
    const params: CallToolParams = {
      name,
      arguments: args,
    };
    return this.call<CallToolResult>('tools/call', params);
  }

  /**
   * 获取 Prompt
   */
  async getPrompt(name: string, args?: Record<string, string>): Promise<GetPromptResult> {
    const params: GetPromptParams = {
      name,
      arguments: args,
    };
    return this.call<GetPromptResult>('prompts/get', params);
  }

  /**
   * 发送 JSON-RPC 请求
   */
  private async call<T>(method: string, params?: unknown): Promise<T> {
    if (this.state !== 'ready' && method !== 'initialize') {
      await this.start();
    }

    if (!this.process?.stdin) {
      throw new Error('MCP server stdin is not available');
    }

    const id = this.nextId++;
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params: params as Record<string, unknown>,
    };

    this.log(`-> ${JSON.stringify(request)}`);

    // 创建 Promise
    const promise = new Promise<T>((resolve, reject) => {
      // 设置超时
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.timeout);

      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    });

    // 发送请求
    this.process.stdin.write(JSON.stringify(request) + '\n');

    return promise;
  }

  /**
   * 处理输出（支持多行 JSON）
   */
  private handleOutput(chunk: string): void {
    this.outputBuffer += chunk;

    // 尝试解析完整的 JSON 行
    const lines = this.outputBuffer.split('\n');
    this.outputBuffer = lines.pop() ?? ''; // 保留最后一个不完整的行

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response = JSON.parse(trimmed) as JSONRPCResponse;
        this.handleResponse(response);
      } catch (error) {
        this.log(`Failed to parse JSON: ${trimmed}`, 'error');
      }
    }
  }

  /**
   * 处理响应
   */
  private handleResponse(response: JSONRPCResponse): void {
    this.log(`<- ${JSON.stringify(response)}`);

    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      this.log(`Received response for unknown request ID: ${response.id}`, 'warn');
      return;
    }

    // 清理
    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);

    // 判断是否为错误
    const isError = (resp: JSONRPCResponse): resp is { jsonrpc: '2.0'; id: number | string; error: { code: number; message: string; data?: unknown } } => {
      return 'error' in resp;
    };

    if (isError(response)) {
      pending.reject(new Error(`MCP Error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * 拒绝所有待处理的请求
   */
  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    if (this.state === 'closed') {
      return;
    }

    this.log('Closing MCP server...');
    this.intentionalClose = true; // 防止触发重连

    // 拒绝所有待处理的请求
    this.rejectAllPending(new Error('MCP client is closing'));

    // 关闭进程
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = undefined;
    }

    this.state = 'closed';
    this.log('MCP server closed');
  }

  /**
   * 获取当前状态
   */
  getState(): MCPServerState {
    return this.state;
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
    return this.reconnectAttempts;
  }

  /**
   * 日志输出
   */
  protected log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.debug && level === 'info') {
      return;
    }

    const mcpLog = logger.child({ module: `MCPClient:${this.config.name}` });
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
