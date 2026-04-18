// ============================================================
// GreetingService — 启动引导语服务
// ============================================================

import type { IMemoryStore } from '@/memory/types';
import type { IReminderEngine } from '@/reminder/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'GreetingService' });

export interface GreetingData {
  /** 最近工作信息 */
  recentWork: string[];
  /** 生活相关信息 */
  lifeInfo: string[];
  /** 今日待办事项 */
  todayTodos: Array<{ title: string; time?: string }>;
  /** 即将到来的提醒 */
  upcomingReminders: Array<{ title: string; time: string }>;
}

/**
 * GreetingService — 收集启动引导语所需信息
 */
export class GreetingService {
  constructor(
    private memoryManager?: IMemoryStore,
    private reminderEngine?: IReminderEngine,
  ) {}

  /**
   * 收集引导语数据
   */
  async collect(): Promise<GreetingData> {
    const [recentWork, lifeInfo, todayTodos, upcomingReminders] = await Promise.all([
      this.getRecentWork(),
      this.getLifeInfo(),
      this.getTodayTodos(),
      this.getUpcomingReminders(),
    ]);

    return {
      recentWork,
      lifeInfo,
      todayTodos,
      upcomingReminders,
    };
  }

  /**
   * 获取最近工作信息（从 memory 中检索）
   */
  private async getRecentWork(): Promise<string[]> {
    if (!this.memoryManager) return [];

    try {
      // 检索最近的工作相关记忆（project 类型）
      const memories = await this.memoryManager.retrieve({
        query: '最近的工作 项目进展 开发任务',
        limit: 3,
        types: ['project'],
      });

      return memories
        .filter(m => m.content && m.content.trim().length > 0)
        .map(m => m.content)
        .slice(0, 3);
    } catch (error) {
      log.warn('获取最近工作信息失败:', error);
      return [];
    }
  }

  /**
   * 获取生活相关信息（从 memory 中检索）
   */
  private async getLifeInfo(): Promise<string[]> {
    if (!this.memoryManager) return [];

    try {
      // 检索生活相关记忆（user 类型）
      const memories = await this.memoryManager.retrieve({
        query: '生活 日常 个人',
        limit: 2,
        types: ['user'],
      });

      return memories
        .filter(m => m.content && m.content.trim().length > 0)
        .map(m => m.content)
        .slice(0, 2);
    } catch (error) {
      log.warn('获取生活信息失败:', error);
      return [];
    }
  }

  /**
   * 获取今日待办事项
   */
  private async getTodayTodos(): Promise<Array<{ title: string; time?: string }>> {
    if (!this.reminderEngine) return [];

    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart);
      todayEnd.setDate(todayEnd.getDate() + 1);

      const reminders = await this.reminderEngine.getReminders({
        status: 'pending',
        startTime: todayStart,
        endTime: todayEnd,
      });

      return reminders
        .slice(0, 5)
        .map(r => ({
          title: r.title,
          time: r.time ? this.formatTime(new Date(r.time)) : undefined,
        }));
    } catch (error) {
      log.warn('获取今日待办失败:', error);
      return [];
    }
  }

  /**
   * 获取即将到来的提醒（未来 3 天内）
   */
  private async getUpcomingReminders(): Promise<Array<{ title: string; time: string }>> {
    if (!this.reminderEngine) return [];

    try {
      const now = new Date();
      const threeDaysLater = new Date(now);
      threeDaysLater.setDate(threeDaysLater.getDate() + 3);

      const reminders = await this.reminderEngine.getReminders({
        status: 'pending',
        startTime: now,
        endTime: threeDaysLater,
      });

      return reminders
        .slice(0, 3)
        .map(r => ({
          title: r.title,
          time: this.formatDateTime(new Date(r.time)),
        }));
    } catch (error) {
      log.warn('获取即将到来的提醒失败:', error);
      return [];
    }
  }

  /**
   * 格式化时间（HH:mm）
   */
  private formatTime(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  /**
   * 格式化日期时间（MM-DD HH:mm）
   */
  private formatDateTime(date: Date): string {
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${month}-${day} ${hours}:${minutes}`;
  }
}
