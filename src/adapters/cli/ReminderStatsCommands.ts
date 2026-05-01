// ============================================================
// CLI 终端 — 提醒统计命令集合
// ============================================================
//
// /reminders                  显示今日提醒统计
// /reminders stats            查看全量提醒统计
// /reminders stats active     仅统计活跃提醒
// /reminders stats week       最近 7 天的统计
// /reminders stats month      最近 30 天的统计
//

import type { SlashCommand } from './SlashCommands';
import type { IReminderStatsService, StatsQueryOptions } from '@/reminder/types';
import { formatReminderStats } from '@/reminder/ReminderStatsFormatter';

/**
 * 计算距今 N 天前的日期字符串 (YYYY-MM-DD)
 */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0]!;
}

/**
 * 获取今天的日期字符串 (YYYY-MM-DD)
 */
function today(): string {
  return new Date().toISOString().split('T')[0]!;
}

/**
 * 创建提醒统计命令列表
 *
 * @param service 提醒统计服务实例
 * @param onOutput 输出回调，将格式化后的 Markdown 文本输出到终端
 * @returns 斜杠命令数组
 */
export function createReminderStatsCommands(
  service: IReminderStatsService,
  onOutput: (text: string) => void,
): SlashCommand[] {
  return [
    {
      name: '/reminders',
      description: '查看提醒统计',
      group: '提醒',
      icon: '📋',
      usage: '/reminders [stats|stats active|stats week|stats month]',
      aliases: ['/remind'],
      handler: async (args: string) => {
        const trimmed = args.trim().toLowerCase();

        // 未指定子命令时：显示今日统计
        if (trimmed === '') {
          const options: StatsQueryOptions = {
            dateFrom: today(),
            dateTo: today(),
          };
          const stats = await service.getStats(options);
          onOutput(formatReminderStats(stats));
          return;
        }

        // 解析子命令
        const parts = trimmed.split(/\s+/);
        const subCmd = parts[0];
        const subFilter = parts[1];

        switch (subCmd) {
          case 'stats': {
            const options: StatsQueryOptions = {};

            if (subFilter === 'active') {
              options.status = 'active';
            } else if (subFilter === 'week') {
              options.dateFrom = daysAgo(6);
              options.dateTo = today();
            } else if (subFilter === 'month') {
              options.dateFrom = daysAgo(29);
              options.dateTo = today();
            } else if (subFilter && subFilter !== '') {
              onOutput([
                '未知筛选条件。用法:',
                '  /reminders stats            查看全量统计',
                '  /reminders stats active      仅统计活跃提醒',
                '  /reminders stats week        最近 7 天统计',
                '  /reminders stats month       最近 30 天统计',
              ].join('\n'));
              return;
            }

            const stats = await service.getStats(options);
            onOutput(formatReminderStats(stats));
            break;
          }

          default: {
            onOutput([
              '未知子命令。用法:',
              '  /reminders                   查看今日提醒统计',
              '  /reminders stats             查看全量提醒统计',
              '  /reminders stats active      仅统计活跃提醒',
              '  /reminders stats week        最近 7 天统计',
              '  /reminders stats month       最近 30 天统计',
            ].join('\n'));
            break;
          }
        }
      },
    },
  ];
}
