// ============================================================
// MessageBus - 消息总线
// ============================================================
// 统一的消息管理，解决 AgentLoop、SessionManager、ShortTermMemory
// 中重复的消息管理逻辑
//
// 特性:
// - 发布/订阅模式
// - 消息历史管理
// - 消息过滤和查询
// - 类型安全
// ============================================================

import { logger } from '@/core/logger';

const log = logger.child({ module: 'MessageBus' });

/**
 * 消息
 */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * 消息过滤器
 */
export interface MessageFilter {
  role?: 'user' | 'assistant' | 'system';
  after?: Date;
  before?: Date;
  limit?: number;
  offset?: number;
}

/**
 * 消息处理器
 */
export type MessageHandler = (message: Message) => void | Promise<void>;

/**
 * MessageBus - 消息总线
 */
export class MessageBus {
  private messages: Message[] = [];
  private handlers = new Set<MessageHandler>();
  private maxMessages: number;

  constructor(maxMessages = 1000) {
    this.maxMessages = maxMessages;
  }

  /**
   * 发布消息
   */
  publish(message: Message): void {
    // 1. 添加到历史
    this.messages.push(message);

    // 2. 限制历史大小
    if (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }

    // 3. 通知所有订阅者
    for (const handler of this.handlers) {
      try {
        const result = handler(message);
        if (result instanceof Promise) {
          result.catch(error => {
            log.error('Error in message handler:', error);
          });
        }
      } catch (error) {
        log.error('Error in message handler:', error);
      }
    }

    log.debug(`Message published: ${message.role}`);
  }

  /**
   * 订阅消息
   */
  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    log.debug('Handler subscribed');

    // 返回取消订阅函数
    return () => {
      this.handlers.delete(handler);
      log.debug('Handler unsubscribed');
    };
  }

  /**
   * 获取消息历史
   */
  getHistory(filter?: MessageFilter): Message[] {
    let results = [...this.messages];

    // 角色过滤
    if (filter?.role) {
      results = results.filter(m => m.role === filter.role);
    }

    // 时间范围过滤
    if (filter?.after) {
      results = results.filter(m => m.timestamp >= filter.after!.getTime());
    }
    if (filter?.before) {
      results = results.filter(m => m.timestamp <= filter.before!.getTime());
    }

    // offset + limit
    const offset = filter?.offset || 0;
    const limit = filter?.limit || results.length;
    return results.slice(offset, offset + limit);
  }

  /**
   * 获取最近的消息
   */
  getRecent(count: number): Message[] {
    return this.messages.slice(-count);
  }

  /**
   * 清空消息历史
   */
  clear(): void {
    this.messages = [];
    log.debug('Message history cleared');
  }

  /**
   * 获取消息数量
   */
  size(): number {
    return this.messages.length;
  }

  /**
   * 获取订阅者数量
   */
  subscriberCount(): number {
    return this.handlers.size;
  }
}
