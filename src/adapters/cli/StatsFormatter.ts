// ============================================================
// M1 终端 UI — 统计信息格式化
// ============================================================

import type { DailyUsageRecord } from '@/core/telemetry/DailyUsageStats';

/**
 * 格式化按天统计信息
 */
export function formatDailyStats(records: DailyUsageRecord[]): string {
  if (records.length === 0) {
    return '📊 暂无使用统计';
  }

  const lines: string[] = [];
  lines.push('📊 使用统计');
  lines.push('');

  for (const record of records) {
    lines.push(`日期: ${record.date}`);
    lines.push(`模型: ${record.model}`);
    lines.push(`调用: ${record.totalCalls} 次`);
    lines.push(`Token: ${record.totalTokens.toLocaleString()}`);
    lines.push(`  - 输入: ${record.inputTokens.toLocaleString()}`);
    lines.push(`  - 输出: ${record.outputTokens.toLocaleString()}`);
    if (record.cacheReadTokens > 0 || record.cacheWriteTokens > 0) {
      if (record.cacheReadTokens > 0) {
        lines.push(`  - 缓存读: ${record.cacheReadTokens.toLocaleString()}`);
      }
      if (record.cacheWriteTokens > 0) {
        lines.push(`  - 缓存写: ${record.cacheWriteTokens.toLocaleString()}`);
      }
    }

    if (record.avgIterations > 0) {
      lines.push(`平均迭代: ${record.avgIterations} 轮`);
    }

    if (Object.keys(record.tools).length > 0) {
      lines.push('工具使用:');
      const sorted = Object.entries(record.tools)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      for (const [name, count] of sorted) {
        lines.push(`  - ${name}: ${count} 次`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 格式化费用趋势
 * @deprecated 费用功能已移除
 */
export function formatCostTrend(
  trend: { date: string; cost: number }[],
  days: number,
): string {
  return `📈 最近 ${days} 天趋势\n\n费用功能已移除`;
}

/**
 * 格式化工具排行
 */
export function formatTopTools(
  tools: { name: string; count: number }[],
  limit: number,
): string {
  if (tools.length === 0) {
    return `🔧 最常用工具 (Top ${limit})\n\n暂无数据`;
  }

  const lines: string[] = [];
  lines.push(`🔧 最常用工具 (Top ${limit})`);
  lines.push('');

  const maxCount = tools[0]?.count ?? 0;
  let rank = 1;
  for (const tool of tools) {
    const bar = generateBar(tool.count, maxCount);
    lines.push(`${rank}. ${tool.name.padEnd(20)}  ${tool.count.toString().padStart(5)} 次  ${bar}`);
    rank++;
  }

  return lines.join('\n');
}

/**
 * 格式化按模型汇总
 */
export function formatModelSummary(records: DailyUsageRecord[]): string {
  if (records.length === 0) {
    return '📋 模型使用汇总\n\n暂无数据';
  }

  const lines: string[] = [];
  lines.push('📋 模型使用汇总');
  lines.push('');

  // 按模型聚合
  const byModel = new Map<string, {
    calls: number;
    tokens: number;
  }>();

  for (const record of records) {
    if (!byModel.has(record.model)) {
      byModel.set(record.model, { calls: 0, tokens: 0 });
    }
    const summary = byModel.get(record.model)!;
    summary.calls += record.totalCalls;
    summary.tokens += record.totalTokens;
  }

  // 按 token 降序排序
  const sorted = Array.from(byModel.entries())
    .sort((a, b) => b[1].tokens - a[1].tokens);

  for (const [model, summary] of sorted) {
    lines.push(`模型: ${model}`);
    lines.push(`  调用: ${summary.calls} 次`);
    lines.push(`  Token: ${summary.tokens.toLocaleString()}`);
    lines.push('');
  }

  // 总计
  const totalCalls = Array.from(byModel.values()).reduce((sum, s) => sum + s.calls, 0);
  const totalTokens = Array.from(byModel.values()).reduce((sum, s) => sum + s.tokens, 0);

  lines.push('总计:');
  lines.push(`  调用: ${totalCalls} 次`);
  lines.push(`  Token: ${totalTokens.toLocaleString()}`);

  return lines.join('\n');
}

/**
 * 生成简单的条形图
 */
function generateBar(value: number, max: number, width = 20): string {
  if (max === 0) return '';
  const ratio = value / max;
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
