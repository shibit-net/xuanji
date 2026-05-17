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
    '管理定时任务。你可以创建、查看、更新、删除定时任务，让系统在未来某个时间自动执行操作。',
    '',
    '支持五种调度类型：',
    '- once: 一次性任务，需要指定精确的日期（YYYY-MM-DD）和时间（HH:mm）',
    '- daily: 每天定时执行，只需指定时和分',
    '- weekly: 每周定时执行，需要指定星期几（0=周日, 1=周一...6=周六）、时、分',
    '- monthly: 每月几号定时执行，需要指定 dayOfMonth（1-31）、时、分。如每月1号、每月15号',
    '- yearly: 每年几月几号定时执行，需要指定 month（1-12）、dayOfMonth（1-31）、时、分。如每年3月15号',
    '',
    '使用场景示例：',
    '- 用户说"每天早上9点提醒我站会" → action: create, type: daily, hour: 9, minute: 0',
    '- 用户说"每周五下午5点自动学习" → action: create, type: weekly, dayOfWeek: 5, hour: 17, minute: 0',
    '- 用户说"每月1号上午10点生成月报" → action: create, type: monthly, dayOfMonth: 1, hour: 10, minute: 0',
    '- 用户说"每年12月31号晚上8点做年度总结" → action: create, type: yearly, month: 12, dayOfMonth: 31, hour: 20, minute: 0',
    '- 用户说"下周三下午3点帮我整理代码" → action: create, type: once, scheduledDate: "2026-05-21", scheduledTime: "15:00"',
    '- 用户说"我有哪些定时任务" → action: list',
    '- 用户说"每天早上9点帮我看看GitHub issues" → action: create, type: daily, hour: 9, minute: 0, message: "帮我看看今天的GitHub issues"',
    '- 用户说"取消那个daily-care任务" → action: delete',
    '',
    '注意：如果 custom 类型任务没有 handler 但有 message，定时器触发时会将 message 注入当前会话，启动完整 agent 对话。这是最常用的模式——通过定时消息触发 agent 执行自定义任务。',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'update', 'delete'],
        description: '操作类型。create=新建, list=查看列表, update=修改, delete=删除。',
      },
      // create / update 参数
      id: {
        type: 'string',
        description: '任务 ID。create 时可选（不填自动生成），update/delete 时必填。',
      },
      description: {
        type: 'string',
        description: '任务描述，说明这个任务的用途。',
      },
      type: {
        type: 'string',
        enum: ['once', 'daily', 'weekly', 'monthly', 'yearly'],
        description: '调度类型。once=一次性, daily=每天, weekly=每周, monthly=每月几号, yearly=每年几月几号。create 时必填。',
      },
      // 一次性任务：精确日期+时间
      scheduledDate: {
        type: 'string',
        description: '执行日期（仅 once 类型），格式: YYYY-MM-DD，如 "2026-05-21"。指定具体年月日。',
      },
      scheduledTime: {
        type: 'string',
        description: '执行时间，格式: HH:mm，如 "15:30"、"09:07"。所有类型都需要指定（once 类型与 scheduledDate 配合，daily/weekly/monthly/yearly 作为每天的触发时间）。',
      },
      // 周期性任务参数
      hour: {
        type: 'number',
        description: '执行小时 (0-23)。如 9 表示早上 9 点。daily/weekly/monthly/yearly 类型使用。',
      },
      minute: {
        type: 'number',
        description: '执行分钟 (0-59)。daily/weekly/monthly/yearly 类型使用。',
      },
      dayOfWeek: {
        type: 'number',
        description: '星期几 (0=周日, 1=周一, ..., 6=周六)，仅 weekly 类型需要。',
      },
      dayOfMonth: {
        type: 'number',
        description: '每月几号 (1-31)，仅 monthly/yearly 类型需要。如 1 表示每月1号，15 表示每月15号。',
      },
      month: {
        type: 'number',
        description: '月份 (1-12)，仅 yearly 类型需要。如 3 表示三月，12 表示十二月。',
      },
      // 动作配置
      taskAction: {
        type: 'string',
        enum: ['learn', 'custom'],
        description: '任务执行的动作类型。learn=自动学习, custom=自定义回调。默认 custom。',
        default: 'custom',
      },
      handler: {
        type: 'string',
        description: '自定义 handler 名称（taskAction=custom 时使用）。可选: daily-care, subagent-cleanup, memory-maintenance，或自定义名称。',
      },
      prompt: {
        type: 'string',
        description: '学习目标（taskAction=learn 时使用），描述需要学习的内容。',
      },
      message: {
        type: 'string',
        description: '触发 agent 时发送给 AI 的消息。填入此字段后，定时任务触发时会将此消息注入当前会话，启动完整的 agent 对话循环。例如："帮我分析今天的 GitHub issues"、"整理本周的工作总结"。如果不填，则只执行 handler 或 learn 动作。',
      },
      enabled: {
        type: 'boolean',
        description: '是否启用。默认 true。',
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
      const actionDesc = j.action === 'learn'
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
