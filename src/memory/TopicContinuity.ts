/**
 * TopicContinuity — 开放式话题追踪引擎
 *
 * 职责：从会话中检测开放式话题（目标/计划/兴趣/待决策），管理话题生命周期
 * 对应设计文档 §5.3
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { logger } from '@/core/logger';
import type { TopicTracker, TopicTrackerInput } from '@/memory/types';

const log = logger.child({ module: 'TopicContinuity' });

/** 关键词初筛集（§5.3 步骤①） */
const TOPIC_KEYWORDS = ['想', '打算', '考虑', '要不要', '有空去', '有空来', '找个时间', '计划', '目标', '学', '试试'];
const EXCLUDE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /看看.*(?:文件|代码|日志|函数|参数|报错)/, reason: '当前任务-查看' },
  { pattern: /试一下.*(?:方案|方法|工具|命令)/, reason: '技术决策' },
  { pattern: /帮我[看做].*(?:代码|任务|文件|bug)/, reason: '当前任务-操作' },
];

export interface TopicSignal {
  topic: string;
  topicType: 'goal' | 'plan' | 'interest' | 'decision_pending';
  priority: number;
  contextSummary?: string;
}

export interface PendingTopic {
  id: string;
  topic: string;
  topicType: string;
  status: string;
  priority: number;
  contextSummary: string | null;
  mentionCount: number;
  lastMentionedAt: number;
  lastFollowupAt: number | null;
}

export class TopicContinuity {
  constructor(
    private db: Database.Database,
    private cheapLLM?: any,
    private semanticIndex?: any,
  ) {}

  /** 从会话消息中检测开放式话题（关键词初筛 → LLM 确认） */
  async extractTopics(messages: any[]): Promise<TopicSignal[]> {
    const signals: TopicSignal[] = [];

    // 步骤①：关键词初筛（纯统计，零成本）
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (!text || text.length < 4) continue;

      // 仅检查 user 消息
      if (msg.role !== 'user') continue;

      // 排除操作性表述
      const isExcluded = EXCLUDE_PATTERNS.some(({ pattern }) => pattern.test(text));
      if (isExcluded) continue;

      // 关键词命中
      const hit = TOPIC_KEYWORDS.some(kw => text.includes(kw));
      if (!hit) continue;

      // 步骤②：LLM 确认（如果有 cheapLLM）
      if (this.cheapLLM) {
        try {
          const confirmed = await this.confirmTopic(text);
          if (confirmed) {
            signals.push({
              topic: confirmed.topic,
              topicType: confirmed.topicType,
              priority: this.assignPriority(confirmed.topicType),
              contextSummary: text.slice(0, 200),
            });
          }
        } catch (err) {
          log.warn('LLM topic confirmation failed, falling back to keyword-only', err);
          // Fallback: 纯关键词判定（降低优先级）
          signals.push({
            topic: text.slice(0, 80),
            topicType: 'interest',
            priority: 2,
            contextSummary: text.slice(0, 200),
          });
        }
      } else {
        // 无 LLM 时：直接以原文片段作为话题，类型默认 interest
        signals.push({
          topic: text.slice(0, 80),
          topicType: 'interest',
          priority: 2,
          contextSummary: text.slice(0, 200),
        });
      }
    }

    // 写入 topic_tracker 表
    for (const s of signals) {
      this.upsertTopic(s);
    }

    return signals;
  }

  /** 获取待跟进话题列表（buildContext Stage E 调用） */
  getPendingTopics(limit: number = 5): PendingTopic[] {
    const rows = this.db.prepare(`
      SELECT * FROM topic_tracker
      WHERE status IN ('open', 'followed_up')
      ORDER BY priority DESC, last_mentioned_at DESC
      LIMIT ?
    `).all(limit) as any[];

    return rows.map((r: any) => ({
      id: r.id,
      topic: r.topic,
      topicType: r.topic_type,
      status: r.status,
      priority: r.priority,
      contextSummary: r.context_summary ?? null,
      mentionCount: r.mention_count,
      lastMentionedAt: r.last_mentioned_at,
      lastFollowupAt: r.last_followup_at ?? null,
    }));
  }

  /** 标记话题为已跟进 */
  markFollowedUp(topicId: string): void {
    const now = Date.now();
    this.db.prepare(
      `UPDATE topic_tracker SET status = 'followed_up', last_followup_at = ?, mention_count = mention_count + 1 WHERE id = ?`
    ).run(now, topicId);
  }

  /** 标记话题为已解决 */
  resolveTopic(topicId: string): void {
    this.db.prepare(
      `UPDATE topic_tracker SET status = 'resolved' WHERE id = ?`
    ).run(topicId);
  }

  /** 标记话题为已放弃 */
  abandonTopic(topicId: string): void {
    this.db.prepare(
      `UPDATE topic_tracker SET status = 'abandoned' WHERE id = ?`
    ).run(topicId);
  }

  /**
   * 自动清理：标记长期未提及的话题为 abandoned
   *
   * 启发式近似"连续 3 次会话未提及"（§5.3 步骤④）：
   * 3 天内未提及 + mention_count <= 2 → 对每日使用的用户 ≈ 3 次会话无互动
   */
  autoAbandonStaleTopics(_currentSessionCount: number): void {
    this.db.prepare(`
      UPDATE topic_tracker SET status = 'abandoned'
      WHERE status = 'open' AND mention_count <= 2 AND last_mentioned_at < ?
    `).run(Date.now() - 3 * 24 * 3600000);
  }

  // ─── 公开写入口 ──────────────────────────────────────────────

  upsertTopic(signal: TopicSignal): TopicTracker {
    const now = Date.now();
    const existing = this.db.prepare(
      'SELECT id, mention_count FROM topic_tracker WHERE topic = ? AND topic_type = ? AND status IN (?, ?)'
    ).get(signal.topic, signal.topicType, 'open', 'followed_up') as any;

    if (existing) {
      this.db.prepare(`
        UPDATE topic_tracker SET mention_count = ?, last_mentioned_at = ?, priority = ? WHERE id = ?
      `).run(existing.mention_count + 1, now, signal.priority, existing.id);
      return this.db.prepare('SELECT * FROM topic_tracker WHERE id = ?').get(existing.id) as any as TopicTracker;
    }

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO topic_tracker (id, topic, topic_type, status, priority, context_summary, mention_count, last_mentioned_at, created_at)
      VALUES (?, ?, ?, 'open', ?, ?, 1, ?, ?)
    `).run(id, signal.topic, signal.topicType, signal.priority, signal.contextSummary ?? null, now, now);
    return this.db.prepare('SELECT * FROM topic_tracker WHERE id = ?').get(id) as any as TopicTracker;
  }

  private assignPriority(topicType: string): number {
    switch (topicType) {
      case 'goal': return 5;
      case 'plan': return 4;
      case 'decision_pending': return 4;
      case 'interest': return 3;
      default: return 3;
    }
  }

  private async confirmTopic(text: string): Promise<{ topic: string; topicType: TopicSignal['topicType'] } | null> {
    if (!this.cheapLLM) return null;

    const prompt = `判断以下用户消息是否表达了人生目标、计划、兴趣或待决策的议题（非当前任务操作）。

消息："${text.slice(0, 300)}"

如果是，请返回 JSON：{"topic": "简短话题名", "type": "goal|plan|interest|decision_pending"}
如果不是（比如是当前代码任务、文件操作、技术调试），返回：{"topic": null}
只返回 JSON，不要其他文字。`;

    try {
      const result = await this.cheapLLM.chat(prompt);
      // 提取 JSON
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.topic) return null;

      const validTypes = ['goal', 'plan', 'interest', 'decision_pending'];
      return {
        topic: parsed.topic.slice(0, 100),
        topicType: validTypes.includes(parsed.type) ? parsed.type : 'interest',
      };
    } catch {
      log.debug('LLM topic confirmation parse failed');
      return null;
    }
  }
}
