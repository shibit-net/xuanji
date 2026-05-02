/**
 * EventBus — 全局事件总线（单例）
 *
 * 模块间解耦通信的唯一中枢。
 * - emit(): 异步发射事件，等待所有处理器完成
 * - emitSync(): 同步发射（fire-and-forget）
 * - request(): 请求-响应模式，等待订阅者返回结果
 */

import { logger } from '@/core/logger';

const log = logger.child({ module: 'EventBus' });

export type EventHandler<T = any> = (payload: T) => void | Promise<void>;
export type Unsubscribe = () => void;

interface SubscribeOptions {
  priority?: number;
  once?: boolean;
}

interface Subscription<T = any> {
  handler: EventHandler<T>;
  priority: number;
  once: boolean;
}

export interface LoggedEvent {
  id: string;
  event: string;
  timestamp: number;
  payload: any;
}

class EventBusImpl {
  private events = new Map<string, Subscription[]>();
  private eventLog: LoggedEvent[] = [];
  private maxLogSize = 200;
  private logCounter = 0;

  /** 发射事件（异步，按优先级顺序执行所有处理器，错误隔离） */
  async emit(event: string, payload?: any): Promise<void> {
    const subscriptions = this.events.get(event);
    if (!subscriptions || subscriptions.length === 0) return;

    this.recordEvent(event, payload);

    const sorted = [...subscriptions].sort((a, b) => b.priority - a.priority);
    const toRemove: Subscription[] = [];

    for (const sub of sorted) {
      try {
        const result = sub.handler(payload);
        if (result instanceof Promise) await result;
      } catch (err) {
        log.error(`EventBus handler error [${event}]:`, err);
      }
      if (sub.once) toRemove.push(sub);
    }

    this.cleanupOnce(event, subscriptions, toRemove);
  }

  /** 同步发射（fire-and-forget，不等待异步处理器） */
  emitSync(event: string, payload?: any): void {
    const subscriptions = this.events.get(event);
    if (!subscriptions || subscriptions.length === 0) return;

    this.recordEvent(event, payload);

    const sorted = [...subscriptions].sort((a, b) => b.priority - a.priority);
    const toRemove: Subscription[] = [];

    for (const sub of sorted) {
      try {
        const result = sub.handler(payload);
        if (result instanceof Promise) {
          result.catch(err => log.error(`EventBus async handler error [${event}]:`, err));
        }
      } catch (err) {
        log.error(`EventBus handler error [${event}]:`, err);
      }
      if (sub.once) toRemove.push(sub);
    }

    this.cleanupOnce(event, subscriptions, toRemove);
  }

  /** 订阅事件，返回取消订阅函数 */
  on<T = any>(event: string, handler: EventHandler<T>, options?: SubscribeOptions): Unsubscribe {
    const sub: Subscription<T> = { handler, priority: options?.priority ?? 0, once: options?.once ?? false };
    const subs = this.events.get(event) ?? [];
    subs.push(sub);
    this.events.set(event, subs);
    return () => this.off(event, handler);
  }

  /** 一次性订阅 */
  once<T = any>(event: string, handler: EventHandler<T>): Unsubscribe {
    return this.on(event, handler, { once: true });
  }

  /** 取消订阅 */
  off<T = any>(event: string, handler: EventHandler<T>): void {
    const subs = this.events.get(event);
    if (!subs) return;
    const filtered = subs.filter(s => s.handler !== handler);
    if (filtered.length === 0) this.events.delete(event);
    else this.events.set(event, filtered);
  }

  /** 取消某事件的所有订阅 */
  offAll(event: string): void {
    this.events.delete(event);
  }

  /** 清空所有事件订阅 */
  clear(): void {
    this.events.clear();
  }

  /** 获取事件订阅数 */
  listenerCount(event: string): number {
    return this.events.get(event)?.length ?? 0;
  }

  /** 获取所有已注册的事件名 */
  eventNames(): string[] {
    return Array.from(this.events.keys());
  }

  /** 获取最近的事件日志（调试用） */
  getRecentEvents(count: number = 50): LoggedEvent[] {
    return this.eventLog.slice(-count);
  }

  /** 清空事件日志 */
  clearLog(): void {
    this.eventLog = [];
  }

  /** 请求-响应模式：发射事件并等待订阅者返回结果 */
  async request<T = any>(event: string, payload?: any, timeout: number = 5000): Promise<T[]> {
    const results: T[] = [];
    const requestEvent = `${event}.request`;
    const responseEvent = `${event}.response`;

    return new Promise<T[]>((resolve) => {
      const timer = setTimeout(() => resolve(results), timeout);

      const unsubscribe = this.on(responseEvent, (response: T) => {
        results.push(response);
      });

      this.emit(requestEvent, { payload, respond: (data: T) => {
        results.push(data);
      } }).finally(() => {
        clearTimeout(timer);
      });

      setTimeout(() => {
        unsubscribe();
        resolve(results);
      }, timeout);
    });
  }

  /** 桥接到 renderer 进程（通过 IPC channel 转发事件） */
  bridge(channel: string): void {
    this.on('*', (_payload: any) => {
      // IPC bridge 由桌面层实现具体转发逻辑
      // 此处注册全局通配符监听，桌面层可通过此接口注入 IPC sender
    });
    log.info(`EventBus bridge registered on channel: ${channel}`);
  }

  private recordEvent(event: string, payload: any): void {
    this.eventLog.push({
      id: `ev-${++this.logCounter}`,
      event,
      timestamp: Date.now(),
      payload,
    });
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }
  }

  private cleanupOnce(event: string, subs: Subscription[], toRemove: Subscription[]): void {
    if (toRemove.length === 0) return;
    const remaining = subs.filter(s => !toRemove.includes(s));
    if (remaining.length === 0) this.events.delete(event);
    else this.events.set(event, remaining);
  }
}

/** 全局单例 */
export const eventBus = new EventBusImpl();
export { EventBusImpl as EventBus };
