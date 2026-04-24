// ============================================================
// EnhancedMessageBus - 增强的消息总线
// ============================================================
// 在原有MessageBus基础上添加：
// 1. 事件订阅/发布机制
// 2. 自动转发到renderer
// 3. 类型安全的事件处理

import { MessageChannel, type ChannelOptions, type Message } from './MessageBus';
import type { BrowserWindow } from 'electron';
import type { EventType, BaseEvent } from './EventTypes';

/**
 * 事件处理器
 */
export type EventHandler<T = any> = (data: T) => void | Promise<void>;

/**
 * 增强的消息通道配置
 */
export interface EnhancedChannelOptions extends ChannelOptions {
  autoForwardToRenderer?: boolean;  // 是否自动转发到renderer
  mainWindow?: BrowserWindow | null; // 主窗口引用
}

/**
 * 增强的消息通道
 * 支持事件订阅和自动转发到renderer
 */
export class EnhancedMessageChannel extends MessageChannel {
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private autoForwardToRenderer: boolean;
  private mainWindow: BrowserWindow | null = null;

  constructor(options: EnhancedChannelOptions = {}) {
    super(options);
    this.autoForwardToRenderer = options.autoForwardToRenderer !== false;
    this.mainWindow = options.mainWindow || null;
  }

  /**
   * 设置主窗口引用
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /**
   * 订阅事件
   * @returns 取消订阅函数
   */
  subscribe<T = any>(eventType: EventType, handler: EventHandler<T>): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);

    // 返回取消订阅函数
    return () => {
      this.eventHandlers.get(eventType)?.delete(handler);
    };
  }

  /**
   * 发布事件
   */
  publish(eventType: EventType, data: any): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (err) {
          console.error(`[EnhancedMessageBus] 事件处理器错误 (${eventType}):`, err);
        }
      });
    }
  }

  /**
   * 发送消息（重写以支持自动转发）
   */
  override send(type: string, data?: any): boolean {
    // 发送到子进程
    const sent = super.send(type, data);

    // 发布事件给本地订阅者
    this.publish(type as EventType, data);

    // 自动转发到renderer
    if (this.autoForwardToRenderer && this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send(type, data);
      } catch (err) {
        console.error(`[EnhancedMessageBus] 转发到renderer失败 (${type}):`, err);
      }
    }

    return sent;
  }

  /**
   * 发送事件（语义化的send方法）
   */
  sendEvent(event: BaseEvent): boolean {
    return this.send(event.type, event.data);
  }

  /**
   * 清理资源
   */
  override detach(): void {
    super.detach();
    this.eventHandlers.clear();
  }
}

/**
 * 创建增强的消息通道
 */
export function createEnhancedChannel(options: EnhancedChannelOptions = {}): EnhancedMessageChannel {
  return new EnhancedMessageChannel(options);
}
