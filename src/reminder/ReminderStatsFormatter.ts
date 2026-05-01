// ============================================================
// 提醒系统 — 统计数据 Markdown 格式化器
// ============================================================
//
// 所有导出函数均为纯函数，无副作用，不依赖外部模块。
// 输出标准 GFM Markdown 表格，由终端 MarkdownRenderer 渲染。
//

import type {
  ReminderStats,
  ReminderStatusDistribution,
  ReminderRecurringDistribution,
  ReminderSourceDistribution,
  ReminderDateBucket,
} from './types';

// ============================================================
// 格式化选项
// ============================================================

/**
 * 格式化选项
 */
export interface FormatOptions {
  /** 日期分布表最大行数（默认 14） */
  maxDateRows: number;
  /** 是否显示来源分布表（默认 true） */
  showSource: boolean;
}

const DEFAULT_FORMAT_OPTIONS: FormatOptions = {
  maxDateRows: 14,
  showSource: true,
};

// ============================================================
// 内部辅助函数
// ============================================================

/**
 * 生成简单的条形图
 * @param value 当前值
 * @param max 最大值
 * @param width 条形宽度（默认 10）
 */
function generateBar(value: number, max: number, width = 10): string {
  if (max === 0) return '';
  const ratio = Math.min(value / max, 1);
  const filled = Math.round(ratio * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/**
 * 格式化百分比
 * @param part 部分值
 * @param total 总值
 */
function formatPercent(part: number, total: number): string {
  if (total === 0) return '0.0%';
  return ((part / total) * 100).toFixed(1) + '%';
}

// ============================================================
// 格式化函数
// ============================================================

/**
 * 格式化概览表格
 *
 * 输出总数、时间范围、生成时间
 */
export function formatOverview(stats: ReminderStats): string {
  const lines: string[] = [];
  lines.push('### 📋 概览');
  lines.push('');
  lines.push('| 指标 | 值 |');
  lines.push('|------|-----|');

  lines.push(`| 提醒总数 | ${stats.total} |`);

  if (stats.dateRange) {
    lines.push(`| 时间范围 | ${stats.dateRange.from} ~ ${stats.dateRange.to} |`);
  } else {
    lines.push('| 时间范围 | 无数据 |');
  }

  // 格式化生成时间为更可读的形式
  const generatedDate = new Date(stats.generatedAt);
  const generatedStr = generatedDate.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  lines.push(`| 生成时间 | ${generatedStr} |`);

  return lines.join('\n');
}

/**
 * 格式化状态分布表
 *
 * 3 行：active / done / dismissed
 */
export function formatStatusTable(dist: ReminderStatusDistribution): string {
  const total = dist.active + dist.done + dist.dismissed;
  const lines: string[] = [];
  lines.push('### 🔵 状态分布');
  lines.push('');
  lines.push('| 状态 | 数量 | 占比 |');
  lines.push('|------|------|------|');

  lines.push(
    `| 🔵 活跃 | ${dist.active} | ${formatPercent(dist.active, total)} |`,
  );
  lines.push(
    `| ✅ 已完成 | ${dist.done} | ${formatPercent(dist.done, total)} |`,
  );
  lines.push(
    `| ❌ 已忽略 | ${dist.dismissed} | ${formatPercent(dist.dismissed, total)} |`,
  );

  return lines.join('\n');
}

/**
 * 格式化日期分布表
 *
 * 日期升序，含趋势条。超过 maxRows 时截断。
 */
export function formatDateTable(
  buckets: ReminderDateBucket[],
  maxRows = 14,
): string {
  const lines: string[] = [];
  lines.push('### 📅 日期分布');
  lines.push('');

  if (buckets.length === 0) {
    lines.push('暂无日期分布数据');
    return lines.join('\n');
  }

  lines.push('| 日期 | 数量 | 趋势 |');
  lines.push('|------|------|------|');

  const maxCount = Math.max(...buckets.map((b) => b.count));
  const displayBuckets = buckets.slice(0, maxRows);
  const remaining = buckets.length - maxRows;

  for (const bucket of displayBuckets) {
    const bar = generateBar(bucket.count, maxCount);
    lines.push(`| ${bucket.date} | ${bucket.count} | ${bar} |`);
  }

  if (remaining > 0) {
    lines.push(`| ... | *还有 ${remaining} 条* | |`);
  }

  return lines.join('\n');
}

/**
 * 格式化循环类型分布表
 *
 * 5 行：once / daily / weekly / monthly / yearly
 * 仅显示 count > 0 的行
 */
export function formatRecurringTable(dist: ReminderRecurringDistribution): string {
  const entries: { key: string; label: string; emoji: string; count: number }[] = [
    { key: 'once', label: '单次', emoji: '1️⃣', count: dist.once },
    { key: 'daily', label: '每天', emoji: '🔁', count: dist.daily },
    { key: 'weekly', label: '每周', emoji: '📆', count: dist.weekly },
    { key: 'monthly', label: '每月', emoji: '📅', count: dist.monthly },
    { key: 'yearly', label: '每年', emoji: '🗓️', count: dist.yearly },
  ];

  const total = entries.reduce((sum, e) => sum + e.count, 0);
  const visible = entries.filter((e) => e.count > 0);

  const lines: string[] = [];
  lines.push('### 🔄 循环类型');
  lines.push('');

  if (visible.length === 0) {
    lines.push('暂无循环类型数据');
    return lines.join('\n');
  }

  lines.push('| 类型 | 数量 | 占比 |');
  lines.push('|------|------|------|');

  for (const entry of visible) {
    lines.push(
      `| ${entry.emoji} ${entry.label} | ${entry.count} | ${formatPercent(entry.count, total)} |`,
    );
  }

  return lines.join('\n');
}

/**
 * 格式化来源分布表
 *
 * 2 行：user_explicit / auto_extracted
 */
export function formatSourceTable(dist: ReminderSourceDistribution): string {
  const total = dist.user_explicit + dist.auto_extracted;
  const lines: string[] = [];
  lines.push('### 📌 来源分布');
  lines.push('');
  lines.push('| 来源 | 数量 | 占比 |');
  lines.push('|------|------|------|');

  lines.push(
    `| 👤 用户设置 | ${dist.user_explicit} | ${formatPercent(dist.user_explicit, total)} |`,
  );
  lines.push(
    `| 🤖 自动提取 | ${dist.auto_extracted} | ${formatPercent(dist.auto_extracted, total)} |`,
  );

  return lines.join('\n');
}

/**
 * 格式化摘要脚注
 *
 * 示例：> 统计共 42 条提醒，其中 15 条活跃。
 */
export function formatSummaryFooter(stats: ReminderStats): string {
  const activeCount = stats.byStatus.active;
  return `> 统计共 ${stats.total} 条提醒，其中 ${activeCount} 条活跃。`;
}

/**
 * 格式化完整的提醒统计面板
 *
 * 主入口函数，组装所有子模块输出。
 *
 * @param stats 聚合统计数据
 * @param options 格式化选项
 * @returns Markdown 格式的统计面板文本
 */
export function formatReminderStats(
  stats: ReminderStats,
  options?: Partial<FormatOptions>,
): string {
  const opts: FormatOptions = { ...DEFAULT_FORMAT_OPTIONS, ...options };

  // 空数据友好提示
  if (stats.total === 0) {
    return '📋 暂无提醒统计数据';
  }

  const lines: string[] = [];

  // 标题
  lines.push('## 📋 提醒统计');
  lines.push('');

  // 概览
  lines.push(formatOverview(stats));
  lines.push('');

  // 状态分布表
  lines.push(formatStatusTable(stats.byStatus));
  lines.push('');

  // 日期分布表
  lines.push(formatDateTable(stats.byDate, opts.maxDateRows));
  lines.push('');

  // 循环类型表
  lines.push(formatRecurringTable(stats.byRecurring));
  lines.push('');

  // 来源表（可选）
  if (opts.showSource) {
    lines.push(formatSourceTable(stats.bySource));
    lines.push('');
  }

  // 摘要脚注
  lines.push(formatSummaryFooter(stats));

  return lines.join('\n');
}
