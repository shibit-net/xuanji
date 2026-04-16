// ============================================================
// MemoryFormatter — M5 分层记忆格式化器
// ============================================================
// 输出结构（优先级从高到低）：
//   🚫 核心规则（始终在最前，由 CoreRuleStore 提供）
//   👤 用户画像（profile 层，按 categoryLabel 分组）
//   💡 相关知识（knowledge 层：经验教训 / 历史决策）
//   📅 近期上下文（episode 层：最近 3 天）
//   ⏰ 待处理事项（unfinished_task）
// ============================================================

import type { MemoryEntry, MemoryEntryType, DecisionContext } from './types';
import type { CoreRule } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'memory-formatter' });

/** 记忆类型中文标签（向后兼容） */
const TYPE_LABELS: Partial<Record<MemoryEntryType, string>> = {
  user_preference:  '用户偏好',
  user_fact:        '用户事实',
  relationship:     '人际关系',
  important_date:   '重要日期',
  decision:         '决策',
  tool_pattern:     '工具模式',
  error_resolution: '错误解决',
  project_fact:     '项目事实',
  session_summary:  '会话摘要',
  agent_knowledge:  'Agent 知识',
  lesson_learned:   '经验教训',
  reusable_pattern: '可复用方案',
  domain_knowledge: '领域知识',
  unfinished_task:  '未完成任务',
};

export class MemoryFormatter {
  /**
   * 格式化完整记忆上下文（主入口）
   * 直接接收 DecisionContext，输出完整的注入文本
   */
  formatDecisionContext(ctx: DecisionContext): string {
    const sections: string[] = [];

    // 1. 核心规则（始终在最前）
    if (ctx.activeRules.length > 0) {
      sections.push(this.formatCoreRules(ctx.activeRules));
    }

    // 2. 用户画像摘要
    if (ctx.profileSummary) {
      sections.push(`### 👤 关于你\n\n${ctx.profileSummary}`);
    }

    // 3. 相关经验教训
    if (ctx.relevantLessons.length > 0) {
      sections.push(this.formatLessons(ctx.relevantLessons));
    }

    // 4. 相关历史决策
    if (ctx.relevantDecisions.length > 0) {
      sections.push(this.formatDecisions(ctx.relevantDecisions));
    }

    // 5. 待处理事项
    if (ctx.pendingTasks.length > 0) {
      sections.push(this.formatPendingTasks(ctx.pendingTasks));
    }

    if (sections.length === 0) return '';

    return sections.join('\n\n---\n\n');
  }

  /**
   * 格式化普通记忆列表（向后兼容，供 MemoryManager.formatForPrompt 使用）
   */
  formatForPrompt(memories: MemoryEntry[]): string {
    if (memories.length === 0) return '';

    // 按 scope 分层
    const profile   = memories.filter((m) => m.scope === 'profile' || this.isProfileType(m.type));
    const knowledge = memories.filter((m) => m.scope === 'knowledge' || this.isKnowledgeType(m.type));
    const episode   = memories.filter((m) =>
      !profile.includes(m) && !knowledge.includes(m) && m.type !== 'unfinished_task',
    );
    const tasks     = memories.filter((m) => m.type === 'unfinished_task');

    const sections: string[] = [];

    if (profile.length > 0)   sections.push(this.formatProfileEntries(profile));
    if (knowledge.length > 0) sections.push(this.formatKnowledgeEntries(knowledge));
    if (episode.length > 0)   sections.push(this.formatTimeline(episode));
    if (tasks.length > 0)     sections.push(this.formatPendingTasks(tasks));

    if (sections.length === 0) return '';

    return `### Relevant Past Context\n\n${sections.join('\n\n---\n\n')}`;
  }

  // ────────── 分区格式化 ──────────

  private formatCoreRules(rules: CoreRule[]): string {
    const lines = rules.map((r, i) => `${i + 1}. ${r.rule}`);
    return `### 🚫 核心规则（必须严格遵守）\n\n${lines.join('\n')}`;
  }

  private formatLessons(lessons: MemoryEntry[]): string {
    const items = lessons.slice(0, 5).map((m) => {
      const label = m.categoryLabel ?? TYPE_LABELS[m.type] ?? m.type;
      const accessed = m.accessCount > 3 ? ` (已应用 ${m.accessCount} 次)` : '';
      return `- **[${label}]** ${m.content}${accessed}`;
    });
    return `### 💡 相关经验\n\n${items.join('\n')}`;
  }

  private formatDecisions(decisions: MemoryEntry[]): string {
    const items = decisions.slice(0, 5).map((m) => {
      const label = m.categoryLabel ?? TYPE_LABELS[m.type] ?? m.type;
      return `- **[${label}]** ${m.content}`;
    });
    return `### 📋 相关历史决策\n\n${items.join('\n')}`;
  }

  private formatPendingTasks(tasks: MemoryEntry[]): string {
    const items = tasks.slice(0, 5).map((m) => {
      const age = this.relativeTime(m.createdAt);
      return `- ${m.content}（${age}）`;
    });
    return `### ⏰ 待处理事项\n\n${items.join('\n')}`;
  }

  private formatProfileEntries(entries: MemoryEntry[]): string {
    // 按 categoryLabel 分组
    const groups = new Map<string, MemoryEntry[]>();
    for (const e of entries) {
      const key = e.categoryLabel ?? TYPE_LABELS[e.type] ?? '其他';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }

    const sections = Array.from(groups.entries()).map(([label, items]) => {
      const lines = items.map((m) => {
        const star = (m.significance ?? 0) >= 0.8 ? '⭐ ' : '';
        return `  - ${star}${m.content}`;
      });
      return `**${label}**:\n${lines.join('\n')}`;
    });

    return `### 👤 User Facts\n\n${sections.join('\n\n')}`;
  }

  private formatKnowledgeEntries(entries: MemoryEntry[]): string {
    const groups = new Map<string, MemoryEntry[]>();
    for (const e of entries) {
      const key = e.categoryLabel ?? TYPE_LABELS[e.type] ?? '知识';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    }

    const sections = Array.from(groups.entries()).map(([label, items]) => {
      const sorted = [...items].sort((a, b) => b.accessCount - a.accessCount);
      const lines = sorted.map((m) => {
        const accessed = m.accessCount > 10 ? ` (used ${m.accessCount} times)` : '';
        return `  - ${m.content}${accessed}`;
      });
      return `**${label}**:\n${lines.join('\n')}`;
    });

    return `### 📚 Knowledge & Preferences\n\n${sections.join('\n\n')}`;
  }

  private formatTimeline(entries: MemoryEntry[]): string {
    const byDay = new Map<string, MemoryEntry[]>();
    for (const e of entries) {
      const day = e.dayKey ?? e.createdAt.split('T')[0] ?? 'unknown';
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(e);
    }

    const recentDays = Array.from(byDay.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 3);

    const items = recentDays.map(([day, mems]) => {
      const label = this.formatDayLabel(day);
      const lines = mems.slice(0, 5).map((m) => {
        const text = m.content.length > 80 ? m.content.slice(0, 77) + '...' : m.content;
        return `  - ${text}`;
      });
      if (mems.length > 5) lines.push(`  - ... and ${mems.length - 5} more`);
      return `**${label}**:\n${lines.join('\n')}`;
    });

    return `### 📅 Recent Context\n\n${items.join('\n\n')}`;
  }

  // ────────── 辅助 ──────────

  private isProfileType(type: MemoryEntryType): boolean {
    return ['user_fact', 'user_preference', 'relationship', 'important_date'].includes(type);
  }

  private isKnowledgeType(type: MemoryEntryType): boolean {
    return ['lesson_learned', 'reusable_pattern', 'domain_knowledge', 'agent_knowledge', 'decision', 'error_resolution'].includes(type);
  }

  private relativeTime(isoDate: string): string {
    const ageDays = (Date.now() - new Date(isoDate).getTime()) / 86_400_000;
    if (ageDays < 1)  return '今天';
    if (ageDays < 2)  return '昨天';
    if (ageDays < 7)  return `${Math.floor(ageDays)} 天前`;
    if (ageDays < 30) return `${Math.floor(ageDays / 7)} 周前`;
    return `${Math.floor(ageDays / 30)} 个月前`;
  }

  private formatDayLabel(dayKey: string): string {
    try {
      const ageDays = (Date.now() - new Date(dayKey).getTime()) / 86_400_000;
      if (ageDays < 1) return 'Today';
      if (ageDays < 2) return 'Yesterday';
      if (ageDays < 7) return `${Math.floor(ageDays)} days ago`;
      return new Date(dayKey).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    } catch {
      return dayKey;
    }
  }
}
