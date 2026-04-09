/**
 * ============================================================
 * HTTP Transport - 基于 HTTP/SSE 的 MCP 传输层
 * ============================================================
 * 支持远程 MCP Server，提供 HTTP 请求/响应和 SSE 事件流
 */

import { EventEmitter } from 'node:events';
import { logger } from '@/core/logger';
import { sleep } from '@/core/utils/sleep';
import type {
  JSONRPCRequest,
  JSONRPCResponse,
  MCPServerState,
} from '../types';

/** HTTP 传输配置 */
export interface HttpTransportOptions {
  /** 服务器基础 URL（如 https://mcp.example.com） */
  url: string;
  /** 自定义请求头（如 Authorization） */
  headers?: Record<string, string>;
  /** 请求超时（毫秒，默认 30000） */
  timeout?: number;
  /** 最大重试次数（默认 5） */
  maxRetries?: number;
  /** 是否启用 SSE（默认 false） */
  enableSSE?: boolean;
  /** SSE 端点路径（默认 /sse） */
  ssePath?: string;
  /** 是否启用调试日志 */
  debug?: boolean;
}

/** 待处理的请求 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  retries: number;
}

/**
 * HTTP 传输层
 *
 * 提供两种模式：
 * 1. 纯 HTTP 模式：发送 JSON-RPC 请求，同步等待 HTTP 响应
 * 2. HTTP + SSE 模式：发送 JSON-RPC 请求到 HTTP 端点，通过 SSE 接收异步响应
 */
export class HttpTransport extends EventEmitter {
  private options: Required<HttpTransportOptions>;
  private state: MCPServerState = 'uninitialized';
  private nextId = 1;
  private pendingRequests = new Map<number | string, PendingRequest>();

  // SSE 相关
  private abortController?: AbortController;
  private sseBuffer = '';
  private lastMessageTime = Date.now();
  private heartbeatTimer?: NodeJS.Timeout;

  // 重连相关
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private reconnecting = false;

  constructor(options: HttpTransportOptions) {
    super();

    // 填充默认值
    this.options = {
      url: options.url,
      headers: options.headers ?? {},
      timeout: options.timeout ?? 30_000,
      maxRetries: options.maxRetries ?? 5,
      enableSSE: options.enableSSE ?? false,
      ssePath: options.ssePath ?? '/sse',
      debug: options.debug ?? false,
    };

    this.validateOptions();
  }

  /**
   * 验证配置
   */
  private validateOptions(): void {
    if (!this.options.url) {
      throw new Error('HttpTransport: url is required');
    }

    try {
      new URL(this.options.url);
    } catch {
      throw new Error(`HttpTransport: invalid url "${this.options.url}"`);
    }
  }

  /**
   * 初始化连接
   */
  async initialize(): Promise<void> {
    if (this.state === 'ready') return;
    if (this.state === 'starting') {
      throw new Error('HttpTransport is already initializing');
    }

    this.state = 'starting';
    this.intentionalClose = false;
    this.log('Initializing HTTP transport...');

    try {
      // 如果启用 SSE，建立 SSE 连接
      if (this.options.enableSSE) {
        await this.connectSSE();
        this.startHeartbeat();
      }

      this.state = 'ready';
      this.reconnectAttempts = 0;
      this.log('HTTP transport initialized');
    } catch (error) {
      this.state = 'error';
      this.log(`Failed to initialize: ${error}`, 'error');
      throw error;
    }
  }

  /**
   * 建立 SSE 连接
   */
  private async connectSSE(): Promise<void> {
    this.abortController = new AbortController();

    const sseUrl = new URL(this.options.ssePath, this.options.url).toString();
    this.log(`Connecting to SSE: ${sseUrl}`);

    try {
      const response = await fetch(sseUrl, {
        headers: {
          ...this.options.headers,
          Accept: 'text/event-stream',
        },
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('SSE response has no body');
      }

      // 异步读取 SSE 流
      this.readSSEStream(response.body).catch((err) => {
        this.log(`SSE stream error: ${err}`, 'error');
      });
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

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        this.sseBuffer += decoder.decode(value, { stream: true });
        this.lastMessageTime = Date.now();

        // 解析 SSE 事件
        const events = this.sseBuffer.split('\n\n');
        this.sseBuffer = events.pop() ?? '';

        for (const event of events) {
          this.handleSSEEvent(event);
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      this.log(`SSE stream error: ${error}`, 'error');

      if (!this.intentionalClose) {
        this.state = 'closed';
        this.reconnect().catch((err) => {
          this.log(`Reconnect error: ${err}`, 'error');
        });
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 处理 SSE 事件
   */
  private handleSSEEvent(event: string): void {
    let eventType = 'message';
    let data = '';

    for (const line of event.split('\n')) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        if (data) data += '\n';
        data += line.slice(6);
      }
    }

    if (!data) return;

    // 处理心跳
    if (eventType === 'ping' || data === 'ping') {
      this.log('Received heartbeat');
      return;
    }

    // 处理 JSON-RPC 响应
    try {
      const response = JSON.parse(data) as JSONRPCResponse;
      this.handleResponse(response);
    } catch (error) {
      this.log(`Failed to parse SSE data: ${data}`, 'error');
    }
  }

  /**
   * 启动心跳检测（60s 无消息则重连）
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const elapsed = Date.now() - this.lastMessageTime;
      if (elapsed > 60_000 && !this.intentionalClose) {
        this.log('Heartbeat timeout, reconnecting...', 'warn');
        this.reconnect().catch((err) => {
          this.log(`Reconnect error: ${err}`, 'error');
        });
      }
    }, 30_000);
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * 发送请求
   */
  async request(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
    if (this.state !== 'ready') {
      await this.initialize();
    }

    const id = this.nextId++;
    if (this.nextId > 2_000_000_000) {
      this.nextId = 1;
    }

    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method: endpoint,
      params: body,
    };

    this.log(`-> ${JSON.stringify(request)}`);

    // 创建 pending promise
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${endpoint}`));
      }, this.options.timeout);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timer,
        retries: 0,
      });
    });

    // 发送 HTTP 请求
    try {
      if (this.options.enableSSE) {
        // SSE 模式：只发送请求，响应通过 SSE 接收
        await this.sendHTTP(endpoint, request);
      } else {
        // 纯 HTTP 模式：同步等待响应，与 timeout promise 竞争
        // 这样当 timeout 触发时，fetch 也会被中断，避免 unhandled rejection
        await Promise.race([
          this.sendHTTPSync(endpoint, request).then(response => {
            this.handleResponse(response);
          }),
          promise.catch(err => { throw err; }),
        ]);
        return promise;
      }
    } catch (error) {
      // 发送失败：清理 pending request
      const pending = this.pendingRequests.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(id);
      }
      throw error;
    }

    return promise;
  }

  /**
   * 发送 HTTP 请求（仅发送，不等待响应，响应通过 SSE 接收）
   */
  private async sendHTTP(endpoint: string, request: JSONRPCRequest): Promise<void> {
    const url = new URL(endpoint, this.options.url).toString();

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        ...this.options.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP request failed: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * 发送 HTTP 请求（同步等待响应）
   */
  private async sendHTTPSync(endpoint: string, request: JSONRPCRequest): Promise<JSONRPCResponse> {
    const url = new URL(endpoint, this.options.url).toString();

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        ...this.options.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data as JSONRPCResponse;
  }

  /**
   * 带重试的 fetch
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    retries = 0
  ): Promise<Response> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // 5xx 错误重试
      if (response.status >= 500 && retries < this.options.maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retries), 16_000);
        this.log(`HTTP ${response.status}, retrying in ${delay}ms (${retries + 1}/${this.options.maxRetries})`, 'warn');
        await sleep(delay);
        return this.fetchWithRetry(url, options, retries + 1);
      }

      return response;
    } catch (error) {
      // 网络错误重试
      if (retries < this.options.maxRetries && this.shouldRetry(error)) {
        const delay = Math.min(1000 * Math.pow(2, retries), 16_000);
        this.log(`Network error, retrying in ${delay}ms (${retries + 1}/${this.options.maxRetries})`, 'warn');
        await sleep(delay);
        return this.fetchWithRetry(url, options, retries + 1);
      }

      throw error;
    }
  }

  /**
   * 判断是否应该重试
   */
  private shouldRetry(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    // 超时错误重试
    if (error.name === 'AbortError') return true;

    // 网络错误重试
    const message = error.message.toLowerCase();
    return (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('enotfound')
    );
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

    clearTimeout(pending.timer);
    this.pendingRequests.delete(response.id);

    if ('error' in response) {
      pending.reject(new Error(`MCP Error ${response.error.code}: ${response.error.message}`));
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * 自动重连
   */
  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.intentionalClose) return;

    if (this.reconnectAttempts >= this.options.maxRetries) {
      this.log(`Max reconnect attempts (${this.options.maxRetries}) reached`, 'error');
      this.state = 'error';
      this.emit('reconnect_failed');
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30_000);
    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.options.maxRetries})...`, 'warn');
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });

    await sleep(delay);

    if (this.intentionalClose) {
      this.reconnecting = false;
      return;
    }

    // 清理状态
    this.state = 'uninitialized';
    this.sseBuffer = '';

    try {
      await this.initialize();
      this.log('Reconnected successfully');
      this.emit('reconnected');
    } catch (error) {
      this.log(`Reconnect failed: ${error}`, 'error');
      // 失败后会再次触发 reconnect
    } finally {
      this.reconnecting = false;
    }
  }

  /**
   * 关闭连接
   */
  async close(): Promise<void> {
    if (this.state === 'closed') return;

    this.log('Closing HTTP transport...');
    this.intentionalClose = true;

    // 停止心跳
    this.stopHeartbeat();

    // 中止 SSE 连接
    this.abortController?.abort();

    // 拒绝所有待处理的请求
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('HTTP transport is closing'));
    }
    this.pendingRequests.clear();

    this.state = 'closed';
    this.log('HTTP transport closed');
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.state === 'ready';
  }

  /**
   * 获取当前状态
   */
  getState(): MCPServerState {
    return this.state;
  }

  /**
   * 日志输出
   */
  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.options.debug && level === 'info') return;

    const transportLog = logger.child({ module: 'HttpTransport' });
    switch (level) {
      case 'error':
        transportLog.error(message);
        break;
      case 'warn':
        transportLog.warn(message);
        break;
      default:
        transportLog.debug(message);
    }
  }
}
