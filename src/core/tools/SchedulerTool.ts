/**
 * SchedulerTool — 定时任务管理工具
 *
 * Agent 调用此工具创建、查看、更新、删除定时任务。
 * 支持一次性任务（精确到年月日+时分）和周期性任务（每天/每周/每月/每年）。
 */

import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { getMemoryManager } from '@/core/memory/globals';
import type { CronJob } from '@/core/scheduler/types';

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export class SchedulerTool extends BaseTool {
  readonly name = 'scheduler';
  readonly description = [
    'Manage scheduled tasks. You can create, view, update, and delete scheduled tasks, allowing the system to automatically execute actions at a future time.',
    '',
    'Supports five scheduling types:',
    '- once: One-time task, requires exact date (YYYY-MM-DD) and time (HH:mm)',
    '- daily: Daily scheduled execution, only requires hour and minute',
    '- weekly: Weekly scheduled execution, requires day of week (0=Sunday, 1=Monday...6=Saturday), hour, minute',
    '- monthly: Execute on a specific day each month, requires dayOfMonth (1-31), hour, minute. E.g. 1st of month, 15th of month',
    '- yearly: Execute on a specific month and day each year, requires month (1-12), dayOfMonth (1-31), hour, minute. E.g. March 15th each year',
    '',
    'Usage examples:',
    '- User says "remind me to stand-up at 9am every day" → action: create, type: daily, hour: 9, minute: 0',
    '- User says "auto learn at 5pm every Friday" → action: create, type: weekly, dayOfWeek: 5, hour: 17, minute: 0',
    '- User says "generate monthly report at 10am on the 1st" → action: create, type: monthly, dayOfMonth: 1, hour: 10, minute: 0',
    '- User says "do annual review at 8pm on Dec 31st" → action: create, type: yearly, month: 12, dayOfMonth: 31, hour: 20, minute: 0',
    '- User says "help me organize code at 3pm next Wednesday" → action: create, type: once, scheduledDate: "2026-05-21", scheduledTime: "15:00"',
    '- User says "what scheduled tasks do I have" → action: list',
    '- User says "check GitHub issues for me at 9am every day" → action: create, type: daily, hour: 9, minute: 0, message: "Check today\'s GitHub issues for me"',
    '- User says "cancel the daily-care task" → action: delete',
    '',
    'Note: If a custom type task has no handler but has a message, the timer will inject the message into the current session on trigger, starting a full agent conversation. This is the most common pattern — trigger agent to execute custom tasks via scheduled messages.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'update', 'delete'],
        description: 'Action type. create=create, list=list, update=update, delete=delete.',
      },
      // create / update 参数
      id: {
        type: 'string',
        description: 'Task ID. Optional for create (auto-generated if not provided), required for update/delete.',
      },
      description: {
        type: 'string',
        description: 'Task description, explaining the purpose of this task.',
      },
      type: {
        type: 'string',
        enum: ['once', 'daily', 'weekly', 'monthly', 'yearly'],
        description: 'Schedule type. once=one-time, daily=daily, weekly=weekly, monthly=monthly, yearly=yearly. Required for create.',
      },
      // 一次性任务：精确日期+时间
      scheduledDate: {
        type: 'string',
        description: 'Execution date (only for once type), format: YYYY-MM-DD, e.g. "2026-05-21". Specify exact year-month-day.',
      },
      scheduledTime: {
        type: 'string',
        description: 'Execution time, format: HH:mm, e.g. "15:30", "09:07". Required for all types (for once type, combined with scheduledDate; for daily/weekly/monthly/yearly, as daily trigger time).',
      },
      // 周期性任务参数
      hour: {
        type: 'number',
        description: 'Execution hour (0-23). E.g. 9 means 9am. Used for daily/weekly/monthly/yearly types.',
      },
      minute: {
        type: 'number',
        description: 'Execution minute (0-59). Used for daily/weekly/monthly/yearly types.',
      },
      dayOfWeek: {
        type: 'number',
        description: 'Day of week (0=Sunday, 1=Monday, ..., 6=Saturday), required for weekly type only.',
      },
      dayOfMonth: {
        type: 'number',
        description: 'Day of month (1-31), required for monthly/yearly types only. E.g. 1 means the 1st, 15 means the 15th.',
      },
      month: {
        type: 'number',
        description: 'Month (1-12), required for yearly type only. E.g. 3 for March, 12 for December.',
      },
      // 动作配置
      taskAction: {
        type: 'string',
        enum: ['learn', 'custom'],
        description: 'Task action type. learn=auto learn, custom=custom callback. Default custom.',
        default: 'custom',
      },
      handler: {
        type: 'string',
        description: 'Custom handler name (used when taskAction=custom). Options: daily-care, subagent-cleanup, memory-maintenance, or custom name.',
      },
      prompt: {
        type: 'string',
        description: 'Learning goal (used when taskAction=learn), describes what to learn.',
      },
      message: {
        type: 'string',
        description: 'Message sent to the AI when triggering the agent. When filled, the scheduled task injects this message into the current session, starting a full agent conversation loop. For example: "Analyze today\'s GitHub issues for me", "Compile this week\'s work summary". If not filled, only the handler or learn action executes.',
      },
      enabled: {
        type: 'boolean',
        description: 'Whether enabled. Default true.',
        default: true,
      },
    },
    required: ['action'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const action = input.action as string;
    const mm = getMemoryManager();
    const scheduler = (mm as any)?.scheduler;

    if (!scheduler) {
      return this.error('调度器未初始化，暂时无法管理定时任务。请等待系统完全启动后再试。');
    }

    try {
      switch (action) {
        case 'list':
          return this.handleList(scheduler);
        case 'create':
          return await this.handleCreate(scheduler, input);
        case 'update':
          return await this.handleUpdate(scheduler, input);
        case 'delete':
          return await this.handleDelete(scheduler, input);
        default:
          return this.error(`不支持的操作: ${action}，可选: create, list, update, delete`);
      }
    } catch (err) {
      return this.error(`定时任务操作失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private buildScheduleDesc(job: CronJob): string {
    const time = `${String(job.hour ?? 9).padStart(2, '0')}:${String(job.minute ?? 0).padStart(2, '0')}`;
    switch (job.type) {
      case 'once':
        return job.scheduledAt
          ? new Date(job.scheduledAt).toLocaleString('zh-CN')
          : '一次性 (时间未指定)';
      case 'daily':
        return `每天 ${time}`;
      case 'weekly':
        return `每${DAY_NAMES[job.dayOfWeek ?? 0]} ${time}`;
      case 'monthly':
        return `每月${job.dayOfMonth ?? 1}号 ${time}`;
      case 'yearly':
        return `每年${job.month ?? 1}月${job.dayOfMonth ?? 1}号 ${time}`;
    }
  }

  private handleList(scheduler: any): ToolResult {
    const jobs: CronJob[] = scheduler.getJobs();
    if (jobs.length === 0) {
      return this.success('当前没有定时任务。使用 action: create 来创建一个。');
    }

    const lines = jobs.map(j => {
      const tag = j.system ? ' [系统]' : '';
      const status = j.enabled === false ? ' [已禁用]' : (j.executed ? ' [已完成]' : ' [运行中]');
      const desc = j.description ? ` — ${j.description}` : '';
      const schedule = this.buildScheduleDesc(j);
      const actionDesc = j.system
        ? `系统: ${j.description || ''}`
        : j.action === 'learn'
          ? `学习: ${j.prompt || '无目标'}`
          : j.message
            ? `触发Agent: "${j.message.slice(0, 60)}"`
            : `自定义: ${j.params?.handler || '无handler'}`;
      return `**${j.id}**${tag}${status}${desc}\\n  调度: ${schedule}\\n  动作: ${actionDesc}`;
    });

    return this.success(lines.join('\n\n'), { count: jobs.length });
  }

  private async handleCreate(scheduler: any, input: Record<string, unknown>): Promise<ToolResult> {
    const type = input.type as string;
    if (!type || !['once', 'daily', 'weekly', 'monthly', 'yearly'].includes(type)) {
      return this.error('缺少必需参数 type。可选值: once, daily, weekly, monthly, yearly。');
    }

    const userId = (scheduler.getJobs()[0] as CronJob)?.userId || 'default';

    const job: CronJob = {
      id: (input.id as string) || `cron-${Date.now().toString(36)}`,
      userId,
      type: type as CronJob['type'],
      action: (input.taskAction as string || 'custom') as 'learn' | 'custom',
      description: (input.description as string) || undefined,
      enabled: input.enabled !== false,
    };

    if (type === 'once') {
      const date = input.scheduledDate as string;
      const time = input.scheduledTime as string;
      if (!date || !time) {
        return this.error('一次性任务需要指定 scheduledDate (YYYY-MM-DD) 和 scheduledTime (HH:mm)。例如: scheduledDate: "2026-05-21", scheduledTime: "15:30"');
      }
      job.scheduledAt = new Date(`${date}T${time}:00`).getTime();
    } else {
      job.hour = (input.hour as number) ?? 9;
      job.minute = (input.minute as number) ?? 0;

      if (type === 'weekly') {
        job.dayOfWeek = input.dayOfWeek as number;
        if (job.dayOfWeek === undefined || job.dayOfWeek < 0 || job.dayOfWeek > 6) {
          return this.error('weekly 类型需要指定 dayOfWeek (0=周日, 1=周一, ..., 6=周六)。');
        }
      }

      if (type === 'monthly') {
        job.dayOfMonth = input.dayOfMonth as number;
        if (!job.dayOfMonth || job.dayOfMonth < 1 || job.dayOfMonth > 31) {
          return this.error('monthly 类型需要指定 dayOfMonth (1-31)，如 dayOfMonth: 15 表示每月15号。');
        }
      }

      if (type === 'yearly') {
        job.month = input.month as number;
        job.dayOfMonth = input.dayOfMonth as number;
        if (!job.month || job.month < 1 || job.month > 12) {
          return this.error('yearly 类型需要指定 month (1-12)。');
        }
        if (!job.dayOfMonth || job.dayOfMonth < 1 || job.dayOfMonth > 31) {
          return this.error('yearly 类型需要指定 dayOfMonth (1-31)。');
        }
      }
    }

    if (input.message) {
      job.message = input.message as string;
    }

    if (job.action === 'custom') {
      const handler = input.handler as string;
      job.params = handler ? { handler } : {};
    } else {
      job.prompt = (input.prompt as string) || 'daily learning';
    }

    await scheduler.addCron(job);

    const scheduleDesc = this.buildScheduleDesc(job);

    return this.success(
      `定时任务已创建: **${job.id}**\n调度: ${scheduleDesc}\n${job.description ? `描述: ${job.description}` : ''}`,
      { id: job.id, type, schedule: scheduleDesc }
    );
  }

  private async handleUpdate(scheduler: any, input: Record<string, unknown>): Promise<ToolResult> {
    const id = input.id as string;
    if (!id) return this.error('update 操作需要指定 id。');

    const jobs: CronJob[] = scheduler.getJobs();
    const target = jobs.find(j => j.id === id);
    if (target?.system) {
      return this.error(`系统级任务 ${id} 不能修改。系统任务由代码自动管理。`);
    }

    const updates: Record<string, unknown> = {};

    if (input.description !== undefined) updates.description = input.description;
    if (input.enabled !== undefined) updates.enabled = input.enabled;
    if (input.type !== undefined) updates.type = input.type;
    if (input.hour !== undefined) updates.hour = input.hour;
    if (input.minute !== undefined) updates.minute = input.minute;
    if (input.dayOfWeek !== undefined) updates.dayOfWeek = input.dayOfWeek;
    if (input.dayOfMonth !== undefined) updates.dayOfMonth = input.dayOfMonth;
    if (input.month !== undefined) updates.month = input.month;
    if (input.taskAction !== undefined) updates.action = input.taskAction;
    if (input.prompt !== undefined) updates.prompt = input.prompt;
    if (input.handler !== undefined) updates.params = { handler: input.handler };
    if (input.message !== undefined) updates.message = input.message;

    if (input.scheduledDate && input.scheduledTime) {
      updates.scheduledAt = new Date(`${input.scheduledDate}T${input.scheduledTime}:00`).getTime();
    }

    await scheduler.updateCron(id, updates);
    return this.success(`定时任务 **${id}** 已更新。`, { id });
  }

  private async handleDelete(scheduler: any, input: Record<string, unknown>): Promise<ToolResult> {
    const id = input.id as string;
    if (!id) return this.error('delete 操作需要指定 id。使用 action: list 查看所有任务及其 ID。');

    // 阻止删除系统级任务
    const jobs: CronJob[] = scheduler.getJobs();
    const target = jobs.find(j => j.id === id);
    if (target?.system) {
      return this.error(`系统级任务 ${id} 不能删除。系统任务由代码自动管理。`);
    }

    await scheduler.removeCron(id);
    return this.success(`定时任务 **${id}** 已删除。`, { id });
  }
}
