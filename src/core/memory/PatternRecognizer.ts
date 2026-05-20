/**
 * PatternRecognizer — 行为模式识别引擎
 *
 * 职责：从 events 表提取用户行为模式（周期/惯例/偏好），检测模式缺失
 * 对应设计文档 §5.4 — 纯算法，无 LLM，每日运行
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { logger } from '@/core/logger';
import type { BehaviorPattern } from '@/core/memory/types';

const log = logger.child({ module: 'PatternRecognizer' });

/** 置信度上限：保留不确定性给 LLM 决策 */
const MAX_CONFIDENCE = 0.8;

export interface PatternExtraction {
  patternType: 'cycle' | 'routine' | 'preference';
  description: string;
  relatedEntityIds: string[];
  intervalHours?: number;
  nextExpected?: number;
  sampleCount: number;
  confidence: number;
}

export interface MissedBehavior {
  pattern: BehaviorPattern;
  expectedAt: number;
  missedByHours: number;
  suggestion: string;
}

export class PatternRecognizer {
  constructor(private db: Database.Database) {}

  /** 从 events 表提取行为模式（每日运行） */
  extractPatterns(): PatternExtraction[] {
    const patterns: PatternExtraction[] = [];

    // 拉取用户行为事件（最近 30 天）
    const events = this.db.prepare(`
      SELECT * FROM events
      WHERE (operator = 'user' OR operator = 'archive')
        AND time > ?
      ORDER BY time ASC
    `).all(Date.now() - 30 * 24 * 3600000) as any[];

    if (events.length < 2) return patterns;

    // ── cycle 检测：同一事件 ≥3 次，间隔均匀（±20%） ──
    const contentGroups = new Map<string, any[]>();
    for (const ev of events) {
      const key = ev.content.slice(0, 80);
      if (!contentGroups.has(key)) contentGroups.set(key, []);
      contentGroups.get(key)!.push(ev);
    }

    for (const [content, group] of contentGroups) {
      if (group.length < 3) continue;
      const intervals: number[] = [];
      for (let i = 1; i < group.length; i++) {
        intervals.push(group[i].time - group[i - 1].time);
      }
      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const isUniform = intervals.every(iv => Math.abs(iv - avgInterval) / avgInterval < 0.2);
      if (isUniform && avgInterval > 3600000) {
        const intervalHours = Math.round(avgInterval / 3600000);
        const lastEv = group[group.length - 1];
        patterns.push({
          patternType: 'cycle',
          description: `周期性行为: ${content}`,
          relatedEntityIds: parseEntityIds(group[0].entity_ids),
          intervalHours,
          nextExpected: lastEv.time + avgInterval,
          sampleCount: group.length,
          confidence: Math.min(MAX_CONFIDENCE, 0.5 + group.length * 0.05),
        });
      }
    }

    // ── routine 检测：同一事件固定时段出现 ≥2 次 ──
    const hourBuckets = new Map<string, any[]>();
    for (const ev of events) {
      const hour = new Date(ev.time).getHours();
      const key = `${ev.content.slice(0, 60)}@H${hour}`;
      if (!hourBuckets.has(key)) hourBuckets.set(key, []);
      hourBuckets.get(key)!.push(ev);
    }

    for (const [key, group] of hourBuckets) {
      if (group.length < 2) continue;
      const hour = parseInt(key.split('@H')[1], 10);
      const content = key.slice(0, -key.split('@H')[1].length - 3);
      const lastEv = group[group.length - 1];
      const todayHour = new Date();
      todayHour.setHours(hour, 0, 0, 0);
      const nextExpected = todayHour.getTime() > Date.now()
        ? todayHour.getTime()
        : todayHour.getTime() + 24 * 3600000;

      patterns.push({
        patternType: 'routine',
        description: `日常惯例: ${content} (约 ${hour}:00)`,
        relatedEntityIds: parseEntityIds(lastEv.entity_ids),
        intervalHours: 24,
        nextExpected,
        sampleCount: group.length,
        confidence: Math.min(MAX_CONFIDENCE, 0.5 + group.length * 0.1),
      });
    }

    // ── preference 检测：连续选择同一选项 ≥2 次 ──
    // 通过 events 的 entity_ids 关联，检查同类型 entity 的重复选择
    const entitySelections = new Map<string, { count: number; lastEvent: any }>();
    for (const ev of events) {
      const eids = parseEntityIds(ev.entity_ids);
      for (const eid of eids) {
        if (!entitySelections.has(eid)) entitySelections.set(eid, { count: 0, lastEvent: ev });
        const record = entitySelections.get(eid)!;
        record.count++;
        if (ev.time > record.lastEvent.time) record.lastEvent = ev;
      }
    }

    for (const [eid, record] of entitySelections) {
      if (record.count < 2) continue;
      const entity = this.db.prepare('SELECT name, type FROM entities WHERE id = ?').get(eid) as any;
      if (!entity || entity.type === 'user') continue;
      patterns.push({
        patternType: 'preference',
        description: `偏好: ${entity.name} (${entity.type}) — 被选择 ${record.count} 次`,
        relatedEntityIds: [eid],
        sampleCount: record.count,
        confidence: Math.min(MAX_CONFIDENCE, 0.5 + record.count * 0.1),
      });
    }

    // 写入 behavior_patterns 表（去重更新）
    this.persistPatterns(patterns);

    return patterns;
  }

  /** 检测预期行为缺失（每日运行） */
  detectMissedBehaviors(): MissedBehavior[] {
    const now = Date.now();
    const missed: MissedBehavior[] = [];

    const patterns = this.db.prepare(`
      SELECT * FROM behavior_patterns
      WHERE next_expected IS NOT NULL
        AND next_expected < ?
      ORDER BY next_expected ASC
    `).all(now) as any[];

    for (const p of patterns) {
      const hoursMissed = Math.round((now - p.next_expected) / 3600000);
      if (hoursMissed < 1) continue; // 不到 1 小时不算

      missed.push({
        pattern: p as BehaviorPattern,
        expectedAt: p.next_expected,
        missedByHours: hoursMissed,
        suggestion: `已 ${hoursMissed} 小时未执行: ${p.description}`,
      });
    }

    return missed;
  }

  // ─── 内部方法 ──────────────────────────────────────────────

  private persistPatterns(patterns: PatternExtraction[]): void {
    const now = Date.now();
    const insert = this.db.prepare(`
      INSERT INTO behavior_patterns (id, pattern_type, description, related_entity_ids,
        confidence, sample_count, interval_hours, last_observed, next_expected, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const p of patterns) {
      // 去重：相同 description 的 pattern 只更新
      const existing = this.db.prepare(
        'SELECT id, sample_count FROM behavior_patterns WHERE description = ?'
      ).get(p.description) as any;

      if (existing) {
        this.db.prepare(`
          UPDATE behavior_patterns SET sample_count = ?, confidence = ?, next_expected = ?, last_observed = ?, updated_at = ?
          WHERE id = ?
        `).run(p.sampleCount, p.confidence, p.nextExpected ?? null, now, now, existing.id);
      } else {
        insert.run(
          randomUUID(), p.patternType, p.description,
          p.relatedEntityIds.length > 0 ? `,${p.relatedEntityIds.join(',')},` : null,
          p.confidence, p.sampleCount, p.intervalHours ?? null,
          now, p.nextExpected ?? null, now, now
        );
      }
    }
  }
}

function parseEntityIds(ids: string | null): string[] {
  if (!ids) return [];
  return ids.split(',').map(s => s.trim()).filter(Boolean);
}
