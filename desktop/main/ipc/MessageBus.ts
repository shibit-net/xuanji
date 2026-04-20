// ============================================================
// MessageBus - 消息总线系统
// ============================================================
// 参考 Electron IPC、gRPC 和 EventEmitter 设计的消息管理系统
// 支持主子进程双向通信、消息注册、监听、请求响应、重试等功能

import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// ============================================================
// 类型定义
// ============================================================

/**
 * 消息类型
 */
export interface Message {
  type: string;          // 消息类型
  requestId?: string;    // 请求 ID（用于请求响应模式）
  data?: any;            // 消息数据
  timestamp?: number;    // 时间戳
}

/**
 * 消息处理器
 */
export type MessageHandler<T = any, R = any> = (data: T) => R | Promise<R>;

/**
 * 消息通道配置
 */
export interface ChannelOptions {
  name?: string;              // 通道名称
  timeout?: number;           // 默认超时时间（毫秒）
  maxRetries?: number;        // 最大重试次数
  retryDelay?: number;        // 重试延迟（毫秒）
  enableLogging?: boolean;    // 是否启用日志
}

/**
 * 待处理请求
 */
interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  retryCount: number;
  maxRetries: number;
  type: string;
  data?: any;
  timestamp: number;
}

// ============================================================
// MessageChannel - 主进程端消息通道
// ============================================================

/**
 * 主进程端消息通道
 * 用于主进程与子进程通信
 */
export class MessageChannel extends EventEmitter {
  private name: string;
  private process: ChildProcess | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private requestIdCounter = 0;
  private handlers = new Map<string, MessageHandler>();

  // 配置
  private timeout: number;
  private maxRetries: number;
  private retryDelay: number;
  private enableLogging: boolean;

  constructor(options: ChannelOptions = {}) {
    super();
    this.name = options.name || 'MessageChannel';
    this.timeout = options.timeout || 30000;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.enableLogging = options.enableLogging !== false;
  }

  /**
   * 绑定子进程
   */
  attach(childProcess: ChildProcess): void {
    if (this.process) {
      this.detach();
    }

    this.process = childProcess;

    // 监听子进程消息
    this.process.on('message', (msg: Message) => {
      this.handleMessage(msg);
    });

    // 监听子进程退出
    this.process.on('exit', (code, signal) => {
      this.log('子进程退出', { code, signal });
      this.cleanup();
      this.emit('process-exit', { code, signal });
    });

    // 监听子进程错误
    this.process.on('error', (err) => {
      this.log('子进程错误', err, 'error');
      this.emit('process-error', err);
    });

    this.log('已绑定子进程');
  }

  /**
   * 解绑子进程
   */
  detach(): void {
    if (this.process) {
      this.process.removeAllListeners('message');
      this.process.removeAllListeners('exit');
      this.process.removeAllListeners('error');
      this.process = null;
    }
    this.cleanup();
    this.log('已解绑子进程');
  }

  /**
   * 注册消息处理器
   */
  handle<T = any, R = any>(type: string, handler: MessageHandler<T, R>): void {
    this.handlers.set(type, handler);
    this.log(`注册处理器: ${type}`);
  }

  /**
   * 取消注册消息处理器
   */
  unhandle(type: string): void {
    this.handlers.delete(type);
    this.log(`取消注册处理器: ${type}`);
  }

  /**
   * 发送消息（不等待响应）
   */
  send(type: string, data?: any): boolean {
    if (!this.process || !this.process.connected) {
      this.log(`子进程未连接，无法发送消息: ${type}`, null, 'warn');
      return false;
    }

    try {
      const message: Message = {
        type,
        data,
        timestamp: Date.now(),
      };
      this.process.send(message);
      this.log(`发送消息: ${type}`, data);
      return true;
    } catch (err) {
      this.log(`发送消息失败: ${type}`, err, 'error');
      return false;
    }
  }

  /**
   * 发送请求并等待响应（支持重试）
   */
  request<T = any>(type: string, data?: any, timeout?: number, maxRetries?: number): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.connected) {
        reject(new Error('子进程未连接'));
        return;
      }

      const requestId = this.generateRequestId();
      const timeoutMs = timeout || this.timeout;
      const retries = maxRetries !== undefined ? maxRetries : this.maxRetries;

      // 发送请求的内部函数
      const sendRequest = (retryCount: number) => {
        // 设置超时
        const timer = setTimeout(() => {
          const pending = this.pendingRequests.get(requestId);
          if (!pending) return;

          // 如果还有重试次数，进行重试
          if (retryCount < retries) {
            this.log(`请求超时，重试 ${retryCount + 1}/${retries}: ${type}`, null, 'warn');
            setTimeout(() => {
              sendRequest(retryCount + 1);
            }, this.retryDelay);
          } else {
            // 没有重试次数了，拒绝请求
            this.pendingRequests.delete(requestId);
            reject(new Error(`请求超时（已重试 ${retries} 次）: ${type} (${timeoutMs}ms)`));
          }
        }, timeoutMs);

        // 保存请求
        this.pendingRequests.set(requestId, {
          resolve,
          reject,
          timer,
          retryCount,
          maxRetries: retries,
          type,
          data,
          timestamp: Date.now(),
        });

        // 发送请求
        try {
          if (this.process && this.process.connected) {
            const message: Message = {
              type,
              requestId,
              data,
              timestamp: Date.now(),
            };
            this.process.send(message);
            this.log(`发送请求: ${type}`, { requestId, data });
          } else {
            this.pendingRequests.delete(requestId);
            clearTimeout(timer);
            reject(new Error('子进程已断开连接'));
          }
        } catch (err) {
          this.pendingRequests.delete(requestId);
          clearTimeout(timer);
          reject(err);
        }
      };

      // 开始发送请求
      sendRequest(0);
    });
  }

  /**
   * 处理接收到的消息
   */
  private async handleMessage(msg: Message): Promise<void> {
    this.log(`收到消息: ${msg.type}`, msg);

    // 如果是响应消息（有 requestId）
    if (msg.requestId) {
      const pending = this.pendingRequests.get(msg.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.requestId);
        pending.resolve(msg.data);
        return;
      }
    }

    // 如果有注册的处理器，调用它
    const handler = this.handlers.get(msg.type);
    if (handler) {
      try {
        const result = await handler(msg.data);
        // 如果是请求消息，发送响应
        if (msg.requestId) {
          this.respond(msg.requestId, result);
        }
      } catch (err) {
        this.log(`处理消息失败: ${msg.type}`, err, 'error');
        // 如果是请求消息，发送错误响应
        if (msg.requestId) {
          this.respond(msg.requestId, {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return;
    }

    // 触发事件（兼容旧代码）
    this.emit(msg.type, msg.data);
    this.emit('message', msg);
  }

  /**
   * 响应请求
   */
  private respond(requestId: string, data: any): void {
    if (!this.process || !this.process.connected) {
      this.log('子进程未连接，无法发送响应', null, 'warn');
      return;
    }

    try {
      const message: Message = {
        type: 'response',
        requestId,
        data,
        timestamp: Date.now(),
      };
      this.process.send(message);
      this.log(`发送响应: ${requestId}`, data);
    } catch (err) {
      this.log(`发送响应失败: ${requestId}`, err, 'error');
    }
  }

  /**
   * 生成请求 ID
   */
  private generateRequestId(): string {
    return `${this.name}_${Date.now()}_${++this.requestIdCounter}`;
  }

  /**
   * 清理所有待处理的请求
   */
  private cleanup(): void {
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('子进程已断开连接'));
    }
    this.pendingRequests.clear();
  }

  /**
   * 日志输出
   */
  private log(message: string, data?: any, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.enableLogging) return;

    const prefix = `[${this.name}]`;
    if (level === 'error') {
      console.error(prefix, message, data || '');
    } else if (level === 'warn') {
      console.warn(prefix, message, data || '');
    } else {
      console.log(prefix, message, data || '');
    }
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.process !== null && this.process.connected;
  }

  /**
   * 获取待处理请求数量
   */
  getPendingCount(): number {
    return this.pendingRequests.size;
  }

  /**
   * 获取待处理请求列表（用于调试）
   */
  getPendingRequests(): Array<{ requestId: string; type: string; retryCount: number; age: number }> {
    const now = Date.now();
    const result: Array<{ requestId: string; type: string; retryCount: number; age: number }> = [];
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      result.push({
        requestId,
        type: pending.type,
        retryCount: pending.retryCount,
        age: now - pending.timestamp,
      });
    }
    return result;
  }

  /**
   * 取消指定的请求
   */
  cancelRequest(requestId: string): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);
      pending.reject(new Error('请求已取消'));
      return true;
    }
    return false;
  }

  /**
   * 取消所有待处理的请求
   */
  cancelAllRequests(): void {
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('所有请求已取消'));
    }
    this.pendingRequests.clear();
  }

  /**
   * 获取通道名称
   */
  getName(): string {
    return this.name;
  }
}

// ============================================================
// ChildMessageChannel - 子进程端消息通道
// ============================================================

/**
 * 子进程端消息通道
 * 用于子进程与主进程通信
 */
export class ChildMessageChannel extends EventEmitter {
  private name: string;
  private handlers = new Map<string, MessageHandler>();
  private enableLogging: boolean;

  constructor(options: ChannelOptions = {}) {
    super();
    this.name = options.name || 'ChildMessageChannel';
    this.enableLogging = options.enableLogging !== false;
    this.setupMessageListener();
  }

  /**
   * 设置消息监听器
   */
  private setupMessageListener(): void {
    process.on('message', (msg: Message) => {
      this.handleMessage(msg);
    });

    this.log('消息监听器已设置');
  }

  /**
   * 注册消息处理器
   */
  handle<T = any, R = any>(type: string, handler: MessageHandler<T, R>): void {
    this.handlers.set(type, handler);
    this.log(`注册处理器: ${type}`);
  }

  /**
   * 取消注册消息处理器
   */
  unhandle(type: string): void {
    this.handlers.delete(type);
    this.log(`取消注册处理器: ${type}`);
  }

  /**
   * 发送消息（不等待响应）
   */
  send(type: string, data?: any): boolean {
    const message: Message = {
      type,
      data,
      timestamp: Date.now(),
    };
    return this.safeSend(message);
  }

  /**
   * 响应请求
   */
  respond(requestId: string, data: any): boolean {
    const message: Message = {
      type: 'response',
      requestId,
      data,
      timestamp: Date.now(),
    };
    return this.safeSend(message);
  }

  /**
   * 处理接收到的消息
   */
  private async handleMessage(msg: Message): Promise<void> {
    this.log(`收到消息: ${msg.type}`, msg);

    // 如果有注册的处理器，调用它
    const handler = this.handlers.get(msg.type);
    if (handler) {
      try {
        const result = await handler(msg.data);
        // 如果是请求消息，发送响应
        if (msg.requestId) {
          this.respond(msg.requestId, result);
        }
      } catch (err) {
        this.log(`处理消息失败: ${msg.type}`, err, 'error');
        // 如果是请求消息，发送错误响应
        if (msg.requestId) {
          this.respond(msg.requestId, {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return;
    }

    // 触发事件（兼容旧代码）
    this.emit(msg.type, msg);
    this.emit('message', msg);
  }

  /**
   * 安全地发送消息到主进程
   */
  private safeSend(message: Message): boolean {
    try {
      if (process.send && process.connected) {
        process.send(message);
        this.log(`发送消息: ${message.type}`, message);
        return true;
      } else {
        this.log('进程未连接，无法发送消息', null, 'warn');
        return false;
      }
    } catch (err: any) {
      // 忽略 EPIPE 错误（管道已关闭，通常是主进程退出）
      if (err.code !== 'EPIPE') {
        this.log('发送消息失败', err, 'error');
      }
      return false;
    }
  }

  /**
   * 日志输出
   */
  private log(message: string, data?: any, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.enableLogging) return;

    const prefix = `[${this.name}]`;
    if (level === 'error') {
      console.error(prefix, message, data || '');
    } else if (level === 'warn') {
      console.warn(prefix, message, data || '');
    } else {
      console.log(prefix, message, data || '');
    }
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return process.connected;
  }

  /**
   * 获取已注册的处理器列表
   */
  getHandlers(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * 获取通道名称
   */
  getName(): string {
    return this.name;
  }
}

// ============================================================
// MessageBus - 消息总线（管理多个通道）
// ============================================================

/**
 * 消息总线
 * 管理多个消息通道
 */
export class MessageBus {
  private channels = new Map<string, MessageChannel>();

  /**
   * 创建消息通道
   */
  createChannel(name: string, options?: ChannelOptions): MessageChannel {
    if (this.channels.has(name)) {
      throw new Error(`消息通道已存在: ${name}`);
    }

    const channel = new MessageChannel({ ...options, name });
    this.channels.set(name, channel);
    return channel;
  }

  /**
   * 获取消息通道
   */
  getChannel(name: string): MessageChannel | undefined {
    return this.channels.get(name);
  }

  /**
   * 删除消息通道
   */
  deleteChannel(name: string): boolean {
    const channel = this.channels.get(name);
    if (channel) {
      channel.detach();
      channel.removeAllListeners();
      this.channels.delete(name);
      return true;
    }
    return false;
  }

  /**
   * 获取所有通道名称
   */
  getChannelNames(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * 清理所有通道
   */
  cleanup(): void {
    for (const [name, channel] of this.channels.entries()) {
      channel.detach();
      channel.removeAllListeners();
    }
    this.channels.clear();
  }
}

// ============================================================
// 导出
// ============================================================

// 全局消息总线实例
export const messageBus = new MessageBus();

// 默认消息通道（兼容旧代码）
export const messageChannel = messageBus.createChannel('default', {
  timeout: 30000,
  maxRetries: 3,
  retryDelay: 1000,
  enableLogging: true,
});

// 子进程端默认通道（兼容旧代码）
export const childMessageChannel = new ChildMessageChannel({
  name: 'default',
  enableLogging: true,
});
