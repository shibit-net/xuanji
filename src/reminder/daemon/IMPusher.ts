// ============================================================
// IM 推送器 (飞书/钉钉/企业微信)
// ============================================================

import { logger } from '@/core/logger';
import type { IPusher, PushNotification } from './types';
import type { FeishuBot } from '@/adapters/im/FeishuBot';
import type { DingtalkBot } from '@/adapters/im/DingtalkBot';
import type { WecomBot } from '@/adapters/im/WecomBot';

const log = logger.child({ module: 'im-pusher' });

/**
 * IMPusher — 通过飞书/钉钉/企业微信机器人推送
 */
export class IMPusher implements IPusher {
  private bot: FeishuBot | DingtalkBot | WecomBot | null = null;
  private type: 'feishu' | 'dingtalk' | 'wecom';

  constructor(type: 'feishu' | 'dingtalk' | 'wecom') {
    this.type = type;
  }

  async init(): Promise<void> {
    try {
      // 动态加载对应的 Bot 实例
      switch (this.type) {
        case 'feishu': {
          const { FeishuBot } = await import('@/adapters/im/FeishuBot');
          this.bot = new FeishuBot();
          break;
        }
        case 'dingtalk': {
          const { DingtalkBot } = await import('@/adapters/im/DingtalkBot');
          this.bot = new DingtalkBot();
          break;
        }
        case 'wecom': {
          const { WecomBot } = await import('@/adapters/im/WecomBot');
          this.bot = new WecomBot();
          break;
        }
      }

      log.info(`IM pusher initialized: ${this.type}`);
    } catch (error) {
      log.warn(`Failed to initialize ${this.type} pusher:`, error);
      this.bot = null;
    }
  }

  isAvailable(): boolean {
    return this.bot !== null;
  }

  async push(notification: PushNotification): Promise<void> {
    if (!this.bot) {
      log.warn(`${this.type} bot not initialized`);
      return;
    }

    try {
      // 格式化消息
      const message = this.formatMessage(notification);
      
      // 发送到机器人的私聊或群组（需要配置 userId 或 groupId）
      // 这里需要根据实际的 IM 适配器实现调整
      // 暂时使用一个占位方法
      await this.sendMessage(message);
      
      log.info(`IM notification sent via ${this.type}: ${notification.title}`);
    } catch (error) {
      log.error(`Failed to send ${this.type} notification:`, error);
    }
  }

  /** 格式化通知为 Markdown 消息 */
  private formatMessage(notification: PushNotification): string {
    const emoji = this.getPriorityEmoji(notification.priority);
    let message = `${emoji} **${notification.title}**\n\n${notification.body}`;
    
    // 添加操作按钮提示
    if (notification.actions && notification.actions.length > 0) {
      message += '\n\n' + notification.actions.map(a => `• ${a.label}`).join('\n');
    }
    
    return message;
  }

  /** 根据优先级返回 emoji */
  private getPriorityEmoji(priority: string): string {
    switch (priority) {
      case 'urgent': return '🚨';
      case 'high': return '⚠️';
      case 'normal': return '📅';
      case 'low': return '💡';
      default: return '📋';
    }
  }

  /** 发送消息（需要根据具体 IM 平台调整） */
  private async sendMessage(message: string): Promise<void> {
    // TODO: 根据实际的 IM Bot API 发送消息
    // 需要配置目标用户 ID 或群组 ID
    // 这里先留空，等待具体实现
    log.debug(`Would send message: ${message}`);
  }
}
