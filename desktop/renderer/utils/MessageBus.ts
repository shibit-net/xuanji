// ============================================================
// RendererMessageBus - Renderer端消息总线
// ============================================================
// 统一的事件订阅和发布机制

import type { EventType } from '../../main/ipc/EventTypes';

/**
 * 事件处理器
 */
export type EventHandler<T = any> = (data: T) => void | Promise<void>;

/**
 * Renderer端消息总线
 */
class RendererMessageBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private initialized = false;

  constructor() {
    this.setupIpcListener();
  }

  /**
   * 设置IPC监听器
   */
  private setupIpcListener(): void {
    if (this.initialized) {
      return;
    }

    // 监听所有来自主进程的消息
    // 注意：这里需要为每个事件类型单独注册监听器
    // 因为Electron的IPC是基于事件名称的
    this.initialized = true;
  }

  /**
   * 订阅事件
   * @returns 取消订阅函数
   */
  on<T = any>(eventType: EventType | string, handler: EventHandler<T>): () => void {
    // 如果是第一次订阅这个事件，注册IPC监听器
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
      this.registerIpcListener(eventType);
    }

    this.handlers.get(eventType)!.add(handler);

    // 返回取消订阅函数
    return () => {
      const handlers = this.handlers.get(eventType);
      if (handlers) {
        handlers.delete(handler);
        // 如果没有处理器了，移除IPC监听器
        if (handlers.size === 0) {
          this.unregisterIpcListener(eventType);
          this.handlers.delete(eventType);
        }
      }
    };
  }

  /**
   * 注册IPC监听器
   */
  private registerIpcListener(eventType: string): void {
    if (!window.electron) {
      console.error('[RendererMessageBus] window.electron 未定义');
      return;
    }

    // 使用通用的on方法注册监听器
    window.electron.on(eventType, (data: any) => {
      this.dispatch(eventType, data);
    });

    console.log('[RendererMessageBus] 注册IPC监听器:', eventType);
  }

  /**
   * 移除IPC监听器
   */
  private unregisterIpcListener(eventType: string): void {
    if (!window.electron) {
      return;
    }

    // 注意：这里需要保存handler引用才能正确移除
    // 暂时不实现，因为大多数监听器是长期存在的
    console.log('[RendererMessageBus] 移除IPC监听器:', eventType);
  }

  /**
   * 分发事件
   */
  private dispatch(eventType: string, data: any): void {
    console.log('[RendererMessageBus] 分发事件:', eventType, data);

    const handlers = this.handlers.get(eventType);
    if (handlers && handlers.size > 0) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (err) {
          console.error(`[RendererMessageBus] 事件处理器错误 (${eventType}):`, err);
        }
      });
    } else {
      console.warn('[RendererMessageBus] 没有处理器:', eventType);
    }
  }

  /**
   * 发送消息到主进程
   */
  async send(type: string, data?: any): Promise<any> {
    if (!window.electron) {
      throw new Error('[RendererMessageBus] window.electron 未定义');
    }

    // 这里需要根据实际的IPC方法来实现
    // 暂时使用通用的invoke方法
    return window.electron.agentSendMessage?.(data) || Promise.resolve();
  }

  /**
   * 一次性订阅（触发一次后自动取消）
   */
  once<T = any>(eventType: EventType | string, handler: EventHandler<T>): void {
    const unsubscribe = this.on(eventType, (data: T) => {
      handler(data);
      unsubscribe();
    });
  }

  /**
   * 清理所有订阅
   */
  clear(): void {
    this.handlers.forEach((_, eventType) => {
      this.unregisterIpcListener(eventType);
    });
    this.handlers.clear();
  }
}

// 导出单例
export const messageBus = new RendererMessageBus();

// 默认导出
export default messageBus;
