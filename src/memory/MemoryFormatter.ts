// ============================================================
// M4 记忆系统 — Markdown 格式化器（OpenClaw 风格）
// ============================================================

import type { MemoryEntry, MemoryCategory } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'memory-formatter' });

/**
 * 记忆格式化器
 *
 * 将 JSONL 存储的记忆格式化为 OpenClaw 风格的 Markdown，
 * 用于传递给 LLM 作为上下文。
 *
 * 借鉴 OpenClaw 的组织方式：
 * - 分类清晰（Facts / Topics / Timeline）
 * - 层级结构（Markdown 标题）
 * - 重要性标记（⭐ emoji）
 * - 访问频次展示（透明化）
 */
export class MemoryFormatter {
  /**
   * 格式化记忆为 Markdown（主入口）
   *
   * 输出格式（OpenClaw 风格）：
   * ```markdown
   * ## 📝 Relevant Past Context
   *
   * ### 👤 User Facts
   * - ⭐ **用户事实1**
   * - **用户事实2**
   *
   * ### 📚 Knowledge & Preferences
   * **主题1**:
   *   - 知识点1 (used 15 times)
   *   - 知识点2
   *
   * ### 📅 Recent Context
   * **Today (2026-03-16)**:
   *   - 对话1
   *   - 对话2
   * ```
   */
  formatForPrompt(memories: MemoryEntry[]): string {
    if (memories.length === 0) {
      return '';
    }

    // 1. 按分类分组
    const byCategory = this.groupByCategory(memories);

    const sections: string[] = [];

    // 2. 用户事实（最重要，优先展示）
    if (byCategory.fact && byCategory.fact.length > 0) {
      sections.push(this.formatFacts(byCategory.fact));
    }

    // 3. 主题知识
    if (byCategory.topic && byCategory.topic.length > 0) {
      sections.push(this.formatTopics(byCategory.topic));
    }

    // 4. 最近对话（如果需要上下文）
    if (byCategory.timeline && byCategory.timeline.length > 0) {
      sections.push(this.formatTimeline(byCategory.timeline));
    }

    if (sections.length === 0) {
      return '';
    }

    return `
## 📝 Relevant Past Context

${sections.join('\n\n---\n\n')}

**Note**: This context is retrieved from your long-term memory based on relevance to the current query.
    `.trim();
  }

  /**
   * 格式化用户事实（OpenClaw 风格）
   */
  private formatFacts(facts: MemoryEntry[]): string {
    // 按重要性排序
    const sorted = [...facts].sort((a, b) => {
      const aImp = a.metadata?.importance === 'high' ? 2 :
                   a.metadata?.importance === 'low' ? 0 : 1;
      const bImp = b.metadata?.importance === 'high' ? 2 :
                   b.metadata?.importance === 'low' ? 0 : 1;
      return bImp - aImp;
    });

    const items = sorted.map(fact => {
      const importance = fact.metadata?.importance === 'high' ? '⭐ ' : '';
      return `- ${importance}**${fact.content}**`;
    });

    return `
### 👤 User Facts

${items.join('\n')}
    `.trim();
  }

  /**
   * 格式化主题知识（OpenClaw 风格）
   */
  private formatTopics(topics: MemoryEntry[]): string {
    // 按主题 ID 分组
    const byTopic = this.groupByTopicId(topics);

    const sections = Array.from(byTopic.entries()).map(([topicId, memories]) => {
      // 主题名称（格式化）
      const topicName = this.getTopicName(topicId);

      // 按访问次数排序
      const sorted = [...memories].sort((a, b) => b.accessCount - a.accessCount);

      const items = sorted.map(m => {
        // 访问次数（如果 > 10 次）
        const accessCount = m.accessCount > 10 ? ` (used ${m.accessCount} times)` : '';

        // 关联记忆（如果有）
        let related = '';
        if (m.relatedMemories && m.relatedMemories.length > 0) {
          const count = m.relatedMemories.length;
          related = ` [+${count} related]`;
        }

        return `  - ${m.content}${accessCount}${related}`;
      });

      return `**${topicName}**:\n${items.join('\n')}`;
    });

    return `
### 📚 Knowledge & Preferences

${sections.join('\n\n')}
    `.trim();
  }

  /**
   * 格式化时间线（OpenClaw 风格，简化版）
   */
  private formatTimeline(timeline: MemoryEntry[]): string {
    // 按日期分组
    const byDay = this.groupByDay(timeline);

    // 只显示最近 3 天
    const recentDays = Array.from(byDay.entries())
      .sort((a, b) => b[0].localeCompare(a[0])) // 降序排列
      .slice(0, 3);

    if (recentDays.length === 0) {
      return '';
    }

    const items = recentDays.map(([day, memories]) => {
      const date = this.formatDate(day);

      // 最多显示 5 条
      const limited = memories.slice(0, 5);

      const content = limited.map(m => {
        // 简化内容（最多 80 字符）
        const text = m.content.length > 80
          ? m.content.slice(0, 77) + '...'
          : m.content;
        return `  - ${text}`;
      }).join('\n');

      // 如果有更多记忆
      const more = memories.length > 5
        ? `  - ... and ${memories.length - 5} more`
        : '';

      return `**${date}**:\n${content}${more ? '\n' + more : ''}`;
    });

    return `
### 📅 Recent Context

${items.join('\n\n')}
    `.trim();
  }

  /**
   * 按分类分组
   */
  private groupByCategory(memories: MemoryEntry[]): Record<MemoryCategory, MemoryEntry[]> {
    const groups: Partial<Record<MemoryCategory, MemoryEntry[]>> = {};

    for (const memory of memories) {
      const category = memory.category || this.inferCategory(memory);

      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category]!.push(memory);
    }

    return groups as Record<MemoryCategory, MemoryEntry[]>;
  }

  /**
   * 推断分类（向后兼容旧记忆）
   */
  private inferCategory(memory: MemoryEntry): MemoryCategory {
    // 根据 type 推断
    if (memory.type === 'user_fact' || memory.type === 'user_preference') {
      return 'fact';
    }

    if (memory.type === 'session_summary') {
      return 'timeline';
    }

    // 默认为 topic
    return 'topic';
  }

  /**
   * 按主题 ID 分组
   */
  private groupByTopicId(topics: MemoryEntry[]): Map<string, MemoryEntry[]> {
    const groups = new Map<string, MemoryEntry[]>();

    for (const topic of topics) {
      const topicId = topic.topicId || 'general';

      if (!groups.has(topicId)) {
        groups.set(topicId, []);
      }
      groups.get(topicId)!.push(topic);
    }

    return groups;
  }

  /**
   * 按日期分组
   */
  private groupByDay(timeline: MemoryEntry[]): Map<string, MemoryEntry[]> {
    const groups = new Map<string, MemoryEntry[]>();

    for (const memory of timeline) {
      const day = memory.dayKey || this.extractDayKey(memory.createdAt);

      if (!groups.has(day)) {
        groups.set(day, []);
      }
      groups.get(day)!.push(memory);
    }

    return groups;
  }

  /**
   * 从 ISO 时间戳提取日期键
   */
  private extractDayKey(isoDate: string): string {
    try {
      return isoDate.split('T')[0]; // "2026-03-16T09:30:00Z" → "2026-03-16"
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  }

  /**
   * 格式化日期显示
   */
  private formatDate(dayKey: string): string {
    try {
      const date = new Date(dayKey);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const targetDate = new Date(date);
      targetDate.setHours(0, 0, 0, 0);

      const diffDays = Math.floor((today.getTime() - targetDate.getTime()) / (24 * 60 * 60 * 1000));

      if (diffDays === 0) {
        return 'Today';
      } else if (diffDays === 1) {
        return 'Yesterday';
      } else if (diffDays < 7) {
        return `${diffDays} days ago`;
      } else {
        // "2026-03-16" → "Mar 16, 2026"
        return date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
      }
    } catch {
      return dayKey;
    }
  }

  /**
   * 获取主题显示名称
   */
  private getTopicName(topicId: string): string {
    // 主题 ID 映射（可配置化）
    const nameMap: Record<string, string> = {
      'user-preferences': 'User Preferences',
      'project-xuanji': 'Project Xuanji',
      'project-knowledge': 'Project Knowledge',
      'coding-patterns': 'Coding Patterns',
      'tool-usage': 'Tool Usage',
      'debugging': 'Debugging',
      'general': 'General',
    };

    // 如果有映射，使用映射名称
    if (nameMap[topicId]) {
      return nameMap[topicId];
    }

    // 否则格式化 ID（kebab-case → Title Case）
    return topicId
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
