/**
 * CareManager — 时间感知 + 纪念日 + 日常关怀
 *
 * 在 Agent 启动时构建时间感知上下文和经济日提醒。
 * 设计文档：docs/memory-system-part-9-daily-care.md §3
 */

import type Database from 'better-sqlite3';
import { logger } from '@/core/logger';
import type { EpisodicMemory } from '@/core/memory/EpisodicMemory';

const log = logger.child({ module: 'CareManager' });

export class CareManager {
  constructor(
    private db: Database.Database,
    private episodicMemory?: EpisodicMemory,
  ) {}

  /**
   * 构建每日关怀消息
   * 检查今天的纪念日并返回提醒文本，未找到时返回 null
   */
  async buildDailyCare(): Promise<string | null> {
    const now = new Date();
    const monthDay = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // 查询今天的纪念日（events 表 month-day 匹配，仅 importance >= 4）
    const anniversaryEvents = this.db.prepare(`
      SELECT id, content, time, scene_tag, reminded_at, importance
      FROM events
      WHERE strftime('%m-%d', time / 1000, 'unixepoch') = ?
        AND importance >= 4
      ORDER BY time DESC
      LIMIT 5
    `).all(monthDay) as any[];

    if (anniversaryEvents.length === 0) return null;

    const parts: string[] = [];
    const today = Date.now();
    const oneYearMs = 365 * 24 * 3600 * 1000;

    for (const ev of anniversaryEvents) {
      // 防重复提醒
      if (ev.reminded_at) {
        const remindedDate = new Date(ev.reminded_at);
        const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (remindedDate >= todayDate) continue;
      }

      const yearsAgo = Math.floor((today - ev.time) / oneYearMs);
      if (yearsAgo > 0) {
        parts.push(`📅 **${yearsAgo}年前的今天**: ${ev.content}`);
      } else {
        parts.push(`📅 **今天**: ${ev.content}`);
      }

      // 标记已提醒
      this.db.prepare('UPDATE events SET reminded_at = ? WHERE id = ?').run(today, ev.id);
    }

    if (parts.length === 0) return null;

    // 如果有叙事记忆，追加情景回忆
    if (this.episodicMemory && parts.length > 0) {
      try {
        for (const ev of anniversaryEvents.slice(0, 1)) {
          const episodes = await this.episodicMemory.findByEvent(ev.id, 1);
          if (episodes.length > 0) {
            parts.push(`\n📖 **相关回忆**: ${episodes[0].title}`);
          }
        }
      } catch (err) {
        log.warn('Failed to fetch episodes for daily care:', err);
      }
    }

    return parts.join('\n\n');
  }

  /**
   * 构建时间感知上下文
   *
   * @param lastActiveAt 上次活跃时间戳
   * @returns 时间感知文本，30 分钟内返回 null
   */
  buildTimeAwareness(lastActiveAt: number): string | null {
    const now = Date.now();
    const idleMs = now - lastActiveAt;

    // 30 分钟内不显示
    if (idleMs < 30 * 60 * 1000) return null;

    const idleMinutes = Math.floor(idleMs / 60000);
    const nowDate = new Date(now);
    const lastDate = new Date(lastActiveAt);

    const timeStr = nowDate.toLocaleString('zh-CN', {
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      month: 'long',
      day: 'numeric',
    });

    if (idleMinutes < 120) {
      return `[时间感知：你上一次活跃在 ${idleMinutes} 分钟前，现在是 ${timeStr}]`;
    } else if (lastDate.toDateString() === nowDate.toDateString()) {
      const hours = Math.floor(idleMinutes / 60);
      return `[时间感知：你上一次活跃在 ${hours} 小时前（今天），现在是 ${timeStr}]`;
    } else {
      const days = Math.floor(idleMinutes / 1440);
      return `[时间感知：你上一次活跃在 ${days} 天前，现在是 ${timeStr}]`;
    }
  }
}
