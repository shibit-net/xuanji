// ============================================================
// CLI 工具 — 使用统计格式化
// ============================================================

import type { AggregatedStats } from '@/core/telemetry';

/**
 * 格式化使用统计为可读文本
 *
 * @param stats 聚合统计数据
 * @param days 查询天数 (用于标题显示)
 */
export function formatUsageStats(stats: AggregatedStats, days: number): string {
  const lines: string[] = [];

  // 标题
  lines.push(`📊 使用统计（最近 ${days} 天）`);
  lines.push('');

  // 无数据
  if (stats.total.sessionCount === 0) {
    lines.push('暂无使用记录');
    return lines.join('\n');
  }

  // 总计
  lines.push(`总会话: ${stats.total.sessionCount}`);
  lines.push(`总输入 token: ${formatNumber(stats.total.input)}`);
  lines.push(`总输出 token: ${formatNumber(stats.total.output)}`);
  if (stats.total.cacheRead > 0 || stats.total.cacheWrite > 0) {
    lines.push(`缓存读取: ${formatNumber(stats.total.cacheRead)}`);
    lines.push(`缓存写入: ${formatNumber(stats.total.cacheWrite)}`);
  }
  lines.push(`总迭代: ${stats.total.iterations}`);
  lines.push(`总耗时: ${formatDuration(stats.total.durationMs)}`);

  // 按模型
  const modelEntries = Object.entries(stats.byModel);
  if (modelEntries.length > 0) {
    lines.push('');
    lines.push('按模型:');
    for (const [model, ms] of modelEntries) {
      lines.push(`  ${model}:`);
      lines.push(`    会话: ${ms.sessionCount}`);
      lines.push(`    输入: ${formatNumber(ms.totalInput)}`);
      lines.push(`    输出: ${formatNumber(ms.totalOutput)}`);
      if (ms.totalCacheRead > 0 || ms.totalCacheWrite > 0) {
        lines.push(`    缓存: ${formatNumber(ms.totalCacheRead)} 读 / ${formatNumber(ms.totalCacheWrite)} 写`);
      }
      lines.push(`    耗时: ${formatDuration(ms.totalDurationMs)}`);
    }
  }

  // 按工具
  const toolEntries = Object.entries(stats.byTool);
  if (toolEntries.length > 0) {
    lines.push('');
    lines.push('按工具:');
    for (const [tool, ts] of toolEntries) {
      const errorSuffix = ts.errorCount > 0 ? ` (失败 ${ts.errorCount})` : '';
      lines.push(`  ${tool}: ${ts.callCount} 次${errorSuffix} · 平均 ${formatDuration(ts.avgDurationMs)}`);
    }
  }

  return lines.join('\n');
}

/** 格式化数字 (千分位) */
function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** 格式化耗时 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${seconds}s`;
}
