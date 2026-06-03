// ============================================================
// EventBus - 事件总线
// ============================================================
// 通用的事件驱动架构，支持类型安全的事件发布和订阅
//
// 特性:
// - 类型安全的事件
// - 支持同步和异步处理器
// - 支持一次性订阅
// - 支持优先级
// - 错误隔离
// ============================================================

import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'EventBus' });

/**
 * 事件处理器
 */
export type EventHandler<T = any> = (event: T) => void | Promise<void>;

/**
 * 事件订阅选项
 */
export interface SubscribeOptions {
  /** 优先级（数字越大优先级越高） */
  priority?: number;
  /** 是否只执行一次 */
  once?: boolean;
}

/**
 * 事件订阅信息
 */
interface Subscription<T = any> {
  handler: EventHandler<T>;
  priority: number;
  once: boolean;
}

/**
 * EventBus - 事件总线
 */
export class EventBus {
  private events = new Map<string, Subscription[]>();

  /**
   * 发布事件
   */
  async emit<T = any>(eventName: string, event: T): Promise<void> {
    const subscriptions = this.events.get(eventName);
    if (!subscriptions || subscriptions.length === 0) {
      return;
    }

    log.debug(`Emitting event: ${eventName}`);

    // 按优先级排序
    const sorted = [...subscriptions].sort((a, b) => b.priority - a.priority);

    // 执行所有处理器
    const toRemove: Subscription[] = [];
    for (const sub of sorted) {
      try {
        const result = sub.handler(event);
        if (result instanceof Promise) {
          await result;
        }

        // 标记一次性订阅
        if (sub.once) {
          toRemove.push(sub);
        }
      } catch (error) {
        log.error(`Error in event handler for ${eventName}:`, error);
      }
    }

    // 移除一次性订阅
    if (toRemove.length > 0) {
      const remaining = subscriptions.filter(s => !toRemove.includes(s));
      if (remaining.length === 0) {
        this.events.delete(eventName);
      } else {
        this.events.set(eventName, remaining);
      }
    }
  }

  /**
   * 同步发布事件（不等待异步处理器）
   */
  emitSync<T = any>(eventName: string, event: T): void {
    const subscriptions = this.events.get(eventName);
    if (!subscriptions || subscriptions.length === 0) {
      return;
    }

    log.debug(`Emitting event (sync): ${eventName}`);

    // 按优先级排序
    const sorted = [...subscriptions].sort((a, b) => b.priority - a.priority);

    // 执行所有处理器
    const toRemove: Subscription[] = [];
    for (const sub of sorted) {
      try {
        const result = sub.handler(event);
        if (result instanceof Promise) {
          result.catch(error => {
            log.error(`Error in async event handler for ${eventName}:`, error);
          });
        }

        // 标记一次性订阅
        if (sub.once) {
          toRemove.push(sub);
        }
      } catch (error) {
        log.error(`Error in event handler for ${eventName}:`, error);
      }
    }

    // 移除一次性订阅
    if (toRemove.length > 0) {
      const remaining = subscriptions.filter(s => !toRemove.includes(s));
      if (remaining.length === 0) {
        this.events.delete(eventName);
      } else {
        this.events.set(eventName, remaining);
      }
    }
  }

  /**
   * 订阅事件
   */
  on<T = any>(
    eventName: string,
    handler: EventHandler<T>,
    options?: SubscribeOptions
  ): () => void {
    const subscription: Subscription<T> = {
      handler,
      priority: options?.priority || 0,
      once: options?.once || false
    };

    const subscriptions = this.events.get(eventName) || [];
    subscriptions.push(subscription);
    this.events.set(eventName, subscriptions);

    log.debug(`Handler subscribed to: ${eventName}`);

    // 返回取消订阅函数
    return () => {
      this.off(eventName, handler);
    };
  }

  /**
   * 一次性订阅
   */
  once<T = any>(eventName: string, handler: EventHandler<T>): () => void {
    return this.on(eventName, handler, { once: true });
  }

  /**
   * 取消订阅
   */
  off<T = any>(eventName: string, handler: EventHandler<T>): void {
    const subscriptions = this.events.get(eventName);
    if (!subscriptions) return;

    const filtered = subscriptions.filter(s => s.handler !== handler);
    if (filtered.length === 0) {
      this.events.delete(eventName);
    } else {
      this.events.set(eventName, filtered);
    }

    log.debug(`Handler unsubscribed from: ${eventName}`);
  }

  /**
   * 取消所有订阅
   */
  offAll(eventName: string): void {
    this.events.delete(eventName);
    log.debug(`All handlers unsubscribed from: ${eventName}`);
  }

  /**
   * 清空所有事件
   */
  clear(): void {
    this.events.clear();
    log.debug('All events cleared');
  }

  /**
   * 获取事件的订阅数量
   */
  listenerCount(eventName: string): number {
    return this.events.get(eventName)?.length || 0;
  }

  /**
   * 获取所有事件名称
   */
  eventNames(): string[] {
    return Array.from(this.events.keys());
  }
}
