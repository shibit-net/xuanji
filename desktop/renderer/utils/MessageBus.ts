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
  /** 存储 IPC 监听器引用，用于正确移除 */
  private ipcListeners = new Map<string, (...args: any[]) => void>();
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

    const listener = (data: any) => {
      this.dispatch(eventType, data);
    };
    this.ipcListeners.set(eventType, listener);
    window.electron.on(eventType, listener);

  }

  /**
   * 移除IPC监听器
   */
  private unregisterIpcListener(eventType: string): void {
    if (!window.electron) {
      return;
    }

    const listener = this.ipcListeners.get(eventType);
    if (listener) {
      window.electron.off(eventType, listener);
      this.ipcListeners.delete(eventType);
    }
  }

  /**
   * 分发事件
   */
  private dispatch(eventType: string, data: any): void {
    // 只记录关键事件，减少日志噪音
    if (eventType.startsWith('agent:') && (eventType === 'agent:end' || eventType === 'agent:auto-summarize-start' || eventType === 'agent:thinking')) {
      // console.log(`[MessageBus] dispatch: ${eventType}`);
    }

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
      // console.warn('[RendererMessageBus] 没有处理器:', eventType);
    }
  }

  /**
   * 发送消息到主进程
   */
  async send(_type: string, data?: any): Promise<any> {
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
    // 清理可能残留的 IPC 监听器
    this.ipcListeners.forEach((listener, eventType) => {
      if (window.electron) {
        window.electron.off(eventType, listener);
      }
    });
    this.ipcListeners.clear();
  }
}

// 导出单例
export const messageBus = new RendererMessageBus();

// 默认导出
export default messageBus;
