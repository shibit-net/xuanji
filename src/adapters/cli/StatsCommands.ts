// ============================================================
// M1 终端 UI — 统计命令集合
// ============================================================
//
// /stats            查看今日使用统计
// /stats today      查看今日统计
// /stats week       查看最近 7 天趋势
// /stats month      查看最近 30 天趋势
// /stats model      查看模型使用汇总
// /stats tools      查看最常用工具 Top 10
// /stats update     重新聚合统计数据
//

import type { SlashCommand } from './SlashCommands';
import type { DailyUsageStats } from '@/core/telemetry/DailyUsageStats';
import {
  formatDailyStats,
  formatCostTrend,
  formatTopTools,
  formatModelSummary,
} from './StatsFormatter';

/**
 * 创建统计命令列表
 * @param stats DailyUsageStats 实例
 * @param onOutput 输出回调
 */
export function createStatsCommands(
  stats: DailyUsageStats,
  onOutput: (text: string) => void,
): SlashCommand[] {
  return [
    {
      name: '/stats',
      description: '查看今日使用统计',
      group: '统计',
      icon: '📊',
      usage: '/stats [today|week|month|model|tools|update]',
      aliases: ['/usage'],
      handler: async (args: string) => {
        const subCmd = args.trim().toLowerCase();

        switch (subCmd) {
          case '':
          case 'today': {
            const today = new Date().toISOString().split('T')[0]!;
            const records = await stats.getDaily(today);
            onOutput(formatDailyStats(records));
            break;
          }

          case 'week': {
            const trend = await stats.getCostTrend(7);
            onOutput(formatCostTrend(trend, 7));
            break;
          }

          case 'month': {
            const trend = await stats.getCostTrend(30);
            onOutput(formatCostTrend(trend, 30));
            break;
          }

          case 'model': {
            const endDate = new Date().toISOString().split('T')[0]!;
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 30);
            const startStr = startDate.toISOString().split('T')[0]!;
            const records = await stats.getRange(startStr, endDate);
            onOutput(formatModelSummary(records));
            break;
          }

          case 'tools': {
            const topTools = await stats.getTopTools(10);
            onOutput(formatTopTools(topTools, 10));
            break;
          }

          case 'update': {
            onOutput('正在聚合统计数据...');
            await stats.aggregateAndSave();
            onOutput('✅ 统计数据已更新');
            break;
          }

          default: {
            // 尝试作为日期解析
            if (/^\d{4}-\d{2}-\d{2}$/.test(subCmd)) {
              const records = await stats.getDaily(subCmd);
              onOutput(formatDailyStats(records));
            } else {
              onOutput([
                '未知子命令。可用命令:',
                '  /stats          查看今日统计',
                '  /stats today    查看今日统计',
                '  /stats week     查看最近 7 天趋势',
                '  /stats month    查看最近 30 天趋势',
                '  /stats model    查看模型使用汇总',
                '  /stats tools    查看最常用工具 Top 10',
                '  /stats update   重新聚合统计数据',
                '  /stats 2026-03-09  查看指定日期统计',
              ].join('\n'));
            }
            break;
          }
        }
      },
    },
  ];
}
