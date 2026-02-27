// ============================================================
// M6 工具系统 — ReminderCheckTool 检查提醒
// ============================================================

import type { JSONSchema, ToolResult } from '@/core/types';
import type { IReminderEngine } from '@/reminder/types';
import { BaseTool } from './BaseTool';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'reminder-check-tool' });

/**
 * ReminderCheckTool — 检查提醒
 *
 * 启动时由代码调用，也可由 LLM 主动调用。
 * 返回到期、即将到来的提醒列表。
 */
export class ReminderCheckTool extends BaseTool {
  readonly name = 'reminder_check';
  readonly description = [
    'Check active reminders. Returns due, upcoming reminders and relationship maintenance suggestions.',
    '',
    'This is automatically called at session start, but you can also call it:',
    '- When user asks about their schedule or reminders',
    '- When you need to check if there are relevant reminders for the current context',
    '- When user asks "what do I need to do?" or "what\'s coming up?"',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      includeUpcoming: {
        type: 'number',
        description: 'Include reminders for the next N days (default: 7)',
      },
      markDoneId: {
        type: 'string',
        description: 'Optional: mark a specific reminder as done by its ID',
      },
      dismissId: {
        type: 'string',
        description: 'Optional: dismiss a specific reminder by its ID',
      },
    },
    required: [],
  };

  /** 只读工具（除非传 markDoneId/dismissId） */
  readonly readonly = true;

  private reminderEngine: IReminderEngine | null = null;

  /**
   * 注入提醒引擎（由 ChatSession 调用）
   */
  setReminderEngine(engine: IReminderEngine): void {
    this.reminderEngine = engine;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.reminderEngine) {
      return this.error('Reminder system is not available');
    }

    const markDoneId = input.markDoneId as string | undefined;
    const dismissId = input.dismissId as string | undefined;

    try {
      // 处理标记完成/忽略操作
      if (markDoneId) {
        await this.reminderEngine.markDone(markDoneId);
        return this.success(`Reminder ${markDoneId} marked as done.`, { action: 'markDone', id: markDoneId });
      }

      if (dismissId) {
        await this.reminderEngine.dismiss(dismissId);
        return this.success(`Reminder ${dismissId} dismissed.`, { action: 'dismiss', id: dismissId });
      }

      // 检查提醒
      const context = await this.reminderEngine.checkOnStartup();

      // 也检查关系维护
      const neglected = await this.reminderEngine.checkNeglectedRelationships();
      context.neglectedRelationships = neglected;

      const total = context.dueReminders.length + context.upcomingReminders.length + context.neglectedRelationships.length;

      if (total === 0) {
        log.debug('No active reminders');
        return this.success('No active reminders or upcoming items.', { count: 0 });
      }

      // 格式化输出
      const formatted = this.reminderEngine.formatForPrompt(context);

      log.debug(`Found ${total} reminder items`);

      return this.success(formatted, {
        dueCount: context.dueReminders.length,
        upcomingCount: context.upcomingReminders.length,
        neglectedCount: context.neglectedRelationships.length,
        totalCount: total,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Failed to check reminders:', err);
      return this.error(`Failed to check reminders: ${message}`);
    }
  }
}
