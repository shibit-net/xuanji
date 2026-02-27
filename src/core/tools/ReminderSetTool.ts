// ============================================================
// M6 工具系统 — ReminderSetTool 设置提醒
// ============================================================

import type { JSONSchema, ToolResult } from '@/core/types';
import type { IReminderEngine, ReminderRecurring, ReminderSource } from '@/reminder/types';
import { BaseTool } from './BaseTool';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'reminder-set-tool' });

/**
 * ReminderSetTool — LLM 设置提醒
 *
 * 适用场景：
 * - 用户明确要求："提醒我周五交报告"
 * - LLM 发现重要日期："Alice 生日是 3 月 8 号" → 自动设置提醒
 * - 截止日期："项目 3 月 15 号交付" → 设置到期提醒
 */
export class ReminderSetTool extends BaseTool {
  readonly name = 'reminder_set';
  readonly description = [
    'Set a reminder that will be shown when the user starts a future session.',
    '',
    'Use this when:',
    '- User explicitly asks: "remind me to...", "don\'t let me forget..."',
    '- You discover an important date (birthday, anniversary, deadline)',
    '- A deadline is mentioned in conversation',
    '- User mentions wanting to reconnect with someone',
    '',
    'The reminder will appear in the Reminder Context at session start.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: [
          'What to remind about (concise, actionable).',
          'Examples:',
          '- "Submit weekly report"',
          '- "Alice\'s birthday — consider preparing a gift"',
          '- "Project deadline: deliver v2.0"',
        ].join('\n'),
      },
      triggerDate: {
        type: 'string',
        description: [
          'When to trigger the reminder (ISO date format: YYYY-MM-DD).',
          'Examples:',
          '- "2026-03-08" (specific date)',
          '- Use today\'s date for immediate reminders',
        ].join('\n'),
      },
      recurring: {
        type: 'string',
        enum: ['once', 'daily', 'weekly', 'monthly', 'yearly'],
        description: [
          'Recurrence pattern (default: "once"):',
          '- "once": One-time reminder',
          '- "daily": Every day',
          '- "weekly": Every week',
          '- "monthly": Every month',
          '- "yearly": Every year (great for birthdays)',
        ].join('\n'),
      },
      source: {
        type: 'string',
        enum: ['user_explicit', 'auto_extracted'],
        description: '"user_explicit" if user asked, "auto_extracted" if you inferred it',
      },
    },
    required: ['content', 'triggerDate'],
  };

  /** 写工具：会修改状态 */
  readonly readonly = false;

  private reminderEngine: IReminderEngine | null = null;

  /**
   * 注入提醒引擎（由 ChatSession 调用）
   */
  setReminderEngine(engine: IReminderEngine): void {
    this.reminderEngine = engine;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const content = input.content as string;
    const triggerDate = input.triggerDate as string;
    const recurring = (input.recurring as ReminderRecurring | undefined) ?? 'once';
    const source = (input.source as ReminderSource | undefined) ?? 'user_explicit';

    // 参数验证
    if (!content?.trim()) {
      return this.error('Parameter "content" is required and cannot be empty');
    }

    if (!triggerDate?.trim()) {
      return this.error('Parameter "triggerDate" is required (format: YYYY-MM-DD)');
    }

    // 验证日期格式
    if (!/^\d{4}-\d{2}-\d{2}$/.test(triggerDate)) {
      return this.error('Parameter "triggerDate" must be in YYYY-MM-DD format');
    }

    // 验证日期有效性
    const dateObj = new Date(triggerDate + 'T00:00:00');
    if (isNaN(dateObj.getTime())) {
      return this.error(`Invalid date: ${triggerDate}`);
    }

    if (!this.reminderEngine) {
      return this.error('Reminder system is not available');
    }

    try {
      const reminder = await this.reminderEngine.setReminder({
        content: content.trim(),
        triggerDate,
        recurring,
        source,
      });

      const recurringLabel = recurring === 'once' ? '' : ` (${recurring})`;

      log.info(`Reminder set: "${content}" on ${triggerDate}${recurringLabel}`);

      return this.success(
        `Reminder set: "${content}" on ${triggerDate}${recurringLabel}`,
        {
          id: reminder.id,
          triggerDate,
          recurring,
          source,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Failed to set reminder:', err);
      return this.error(`Failed to set reminder: ${message}`);
    }
  }
}
