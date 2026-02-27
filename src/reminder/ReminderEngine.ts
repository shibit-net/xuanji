// ============================================================
// 提醒系统 — ReminderEngine 引擎
// ============================================================

import { homedir } from 'node:os';
import { join } from 'node:path';
import { StorageBackend } from '@/memory/StorageBackend';
import type { MemoryEntry } from '@/memory/types';
import type {
  Reminder,
  ReminderInput,
  ReminderConfig,
  ReminderContext,
  RelationshipReminder,
  IReminderEngine,
} from './types';
import { DEFAULT_REMINDER_CONFIG } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'reminder-engine' });

/**
 * ReminderEngine — 提醒管理引擎
 *
 * 负责：
 * - 提醒 CRUD（set / markDone / dismiss）
 * - 启动时检查到期/即将到来的提醒
 * - 关系维护检查（扫描 relationship 记忆中超过阈值天数未联系的人）
 * - 格式化提醒为 System Prompt 注入内容
 *
 * 存储：~/.xuanji/reminders.jsonl
 */
export class ReminderEngine implements IReminderEngine {
  private storage: StorageBackend;
  private config: ReminderConfig;
  private filePath: string;
  private reminders: Reminder[] = [];
  private initialized = false;

  /**
   * @param config 提醒配置
   * @param storage 可选：注入 StorageBackend 实例（测试用）
   */
  constructor(config?: Partial<ReminderConfig>, storage?: StorageBackend) {
    this.config = { ...DEFAULT_REMINDER_CONFIG, ...config };
    this.storage = storage ?? new StorageBackend();
    this.filePath = join(homedir(), '.xuanji', this.config.storageFile);
  }

  /** 初始化：加载已有提醒 */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      this.reminders = await this.storage.readAll<Reminder>(this.filePath);
      log.info(`Reminder engine initialized: ${this.reminders.length} reminders loaded`);
      this.initialized = true;
    } catch (error) {
      log.warn('Failed to initialize reminder engine:', error);
      this.reminders = [];
      this.initialized = true;
    }
  }

  /**
   * 启动时检查：返回到期 + 即将到来的提醒
   */
  async checkOnStartup(): Promise<ReminderContext> {
    if (!this.initialized) await this.init();

    const today = this.getToday();
    const upcomingLimit = this.addDays(today, this.config.upcomingDays);

    const activeReminders = this.reminders.filter((r) => r.status === 'active');

    // 到期提醒：triggerDate <= 今天
    const dueReminders = activeReminders.filter((r) => r.triggerDate <= today);

    // 即将到来：今天 < triggerDate <= 未来 N 天
    const upcomingReminders = activeReminders.filter(
      (r) => r.triggerDate > today && r.triggerDate <= upcomingLimit,
    );

    log.debug(`Startup check: ${dueReminders.length} due, ${upcomingReminders.length} upcoming`);

    return {
      dueReminders,
      upcomingReminders,
      neglectedRelationships: [], // 由 checkNeglectedRelationships 单独填充
    };
  }

  /**
   * 设置新提醒
   */
  async setReminder(input: ReminderInput): Promise<Reminder> {
    if (!this.initialized) await this.init();

    const reminder: Reminder = {
      ...input,
      id: this.generateId(),
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    // 持久化
    await this.storage.append(this.filePath, reminder);

    // 更新内存缓存
    this.reminders.push(reminder);

    log.info(`Reminder set: "${reminder.content}" on ${reminder.triggerDate} (${reminder.recurring})`);

    return reminder;
  }

  /**
   * 标记提醒为已完成
   */
  async markDone(id: string): Promise<void> {
    await this.updateStatus(id, 'done');
  }

  /**
   * 忽略提醒
   */
  async dismiss(id: string): Promise<void> {
    await this.updateStatus(id, 'dismissed');
  }

  /**
   * 检查关系维护提醒
   *
   * 扫描 relationship 类型的记忆条目，找出超过阈值天数未更新的联系人。
   * 需要外部传入 relationship 类型的记忆列表。
   */
  async checkNeglectedRelationships(
    thresholdDays?: number,
    relationshipMemories?: MemoryEntry[],
  ): Promise<RelationshipReminder[]> {
    const threshold = thresholdDays ?? this.config.neglectThresholdDays;

    if (!relationshipMemories || relationshipMemories.length === 0) {
      return [];
    }

    const today = new Date();
    const results: RelationshipReminder[] = [];

    for (const mem of relationshipMemories) {
      const lastAccessed = new Date(mem.lastAccessedAt || mem.createdAt);
      const daysSince = Math.floor((today.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24));

      if (daysSince >= threshold) {
        // 从记忆内容中提取联系人名称（取 keywords 中的第一个大写词或第一个 keyword）
        const name = this.extractNameFromMemory(mem);

        results.push({
          name,
          daysSinceLastContact: daysSince,
          memoryContent: mem.content,
          memoryId: mem.id,
        });
      }
    }

    log.debug(`Neglected relationships: ${results.length} found (threshold: ${threshold} days)`);

    return results;
  }

  /**
   * 格式化提醒上下文为 Markdown（注入 System Prompt）
   */
  formatForPrompt(context: ReminderContext): string {
    const sections: string[] = [];

    // 到期提醒
    if (context.dueReminders.length > 0) {
      const lines = context.dueReminders.map((r) => {
        const overdue = r.triggerDate < this.getToday();
        const prefix = overdue ? '⚠️ OVERDUE' : '📅 TODAY';
        return `- ${prefix}: ${r.content} (${r.triggerDate})`;
      });
      sections.push(`**Due Reminders:**\n${lines.join('\n')}`);
    }

    // 即将到来
    if (context.upcomingReminders.length > 0) {
      const lines = context.upcomingReminders.map((r) => {
        const daysUntil = this.daysUntil(r.triggerDate);
        return `- 📋 In ${daysUntil} day${daysUntil > 1 ? 's' : ''}: ${r.content} (${r.triggerDate})`;
      });
      sections.push(`**Upcoming:**\n${lines.join('\n')}`);
    }

    // 关系维护
    if (context.neglectedRelationships.length > 0) {
      const lines = context.neglectedRelationships.map(
        (r) => `- 👤 ${r.name}: ${r.daysSinceLastContact} days since last contact`,
      );
      sections.push(`**Relationship Check:**\n${lines.join('\n')}`);
    }

    if (sections.length === 0) return '';

    return `### Reminder Context\n\n${sections.join('\n\n')}`;
  }

  /**
   * 获取所有活跃提醒
   */
  getActiveReminders(): Reminder[] {
    return this.reminders.filter((r) => r.status === 'active');
  }

  /**
   * 获取文件路径（测试用）
   */
  getFilePath(): string {
    return this.filePath;
  }

  // ────────── 私有方法 ──────────

  /** 更新提醒状态并持久化 */
  private async updateStatus(id: string, status: Reminder['status']): Promise<void> {
    if (!this.initialized) await this.init();

    const reminder = this.reminders.find((r) => r.id === id);
    if (!reminder) {
      log.warn(`Reminder not found: ${id}`);
      return;
    }

    reminder.status = status;

    // 处理循环提醒：完成后自动创建下一个
    if (status === 'done' && reminder.recurring !== 'once') {
      const nextDate = this.getNextTriggerDate(reminder.triggerDate, reminder.recurring);
      await this.setReminder({
        content: reminder.content,
        triggerDate: nextDate,
        recurring: reminder.recurring,
        source: reminder.source,
        relatedMemoryId: reminder.relatedMemoryId,
      });
    }

    // 覆盖写入全部提醒
    await this.storage.overwrite(this.filePath, this.reminders);

    log.debug(`Reminder ${id} marked as ${status}`);
  }

  /** 计算循环提醒的下一个触发日期 */
  private getNextTriggerDate(currentDate: string, recurring: string): string {
    // 使用 UTC 避免时区偏移导致日期偏差
    const [yearStr, monthStr, dayStr] = currentDate.split('-');
    let year = Number(yearStr);
    let month = Number(monthStr);
    const day = Number(dayStr);

    switch (recurring) {
      case 'daily': {
        const date = new Date(Date.UTC(year, month - 1, day + 1));
        return date.toISOString().split('T')[0]!;
      }
      case 'weekly': {
        const date = new Date(Date.UTC(year, month - 1, day + 7));
        return date.toISOString().split('T')[0]!;
      }
      case 'monthly':
        month += 1;
        if (month > 12) { month = 1; year += 1; }
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      case 'yearly':
        year += 1;
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      default:
        return currentDate;
    }
  }

  /** 从记忆条目中提取联系人名称 */
  private extractNameFromMemory(mem: MemoryEntry): string {
    // 优先从 keywords 中找名称（通常是第一个关键词）
    if (mem.keywords.length > 0) {
      // 找第一个像名字的 keyword（首字母大写或非英文）
      const nameKeyword = mem.keywords.find(
        (k) => /^[A-Z]/.test(k) || /[\u4e00-\u9fa5]/.test(k),
      );
      if (nameKeyword) return nameKeyword;
    }

    // 回退：从内容中提取第一个词
    const firstWord = mem.content.split(/[\s,.:]+/)[0];
    return firstWord ?? 'Unknown';
  }

  /** 获取今天日期字符串 (YYYY-MM-DD) */
  private getToday(): string {
    return new Date().toISOString().split('T')[0]!;
  }

  /** 计算从今天到目标日期的天数 */
  private daysUntil(dateStr: string): number {
    const target = new Date(dateStr + 'T00:00:00');
    const today = new Date(this.getToday() + 'T00:00:00');
    return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  /** 在日期上增加天数 */
  private addDays(dateStr: string, days: number): string {
    const date = new Date(dateStr + 'T00:00:00');
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0]!;
  }

  /** 生成唯一 ID */
  private generateId(): string {
    return `rem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
