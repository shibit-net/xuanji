/**
 * TimelineInference — 时间锚点推理引擎
 *
 * 职责：time_anchors CRUD + 到期提醒检查 + 冲突检测
 * 对应设计文档 §5.2
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { logger } from '@/core/logger';
import type { TimeAnchor, TimeAnchorInput } from '@/core/memory/types';

const log = logger.child({ module: 'TimelineInference' });

export interface Reminder {
  anchorId: string;
  targetId: string;
  description: string;
  triggerIn: number; // ms until trigger
  conflictGroup?: string;
  priority: number;
}

export interface Conflict {
  anchorA: TimeAnchor;
  anchorB: TimeAnchor;
  overlapMs: number;
  severity: 'high' | 'medium' | 'low';
}

export class TimelineInference {
  constructor(private db: Database.Database) {}

  /** 注册时间锚点 */
  addAnchor(input: TimeAnchorInput): TimeAnchor {
    const now = Date.now();
    const id = randomUUID();

    this.db.prepare(`
      INSERT INTO time_anchors (id, anchor_type, target_type, target_id, trigger_time, cron_expr,
        grace_minutes, reason, conflict_group, priority, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.anchor_type, input.target_type, input.target_id,
      input.trigger_time ?? null, input.cron_expr ?? null,
      input.grace_minutes ?? 0, input.reason ?? null,
      input.conflict_group ?? null, input.priority ?? 3,
      input.metadata ? (typeof input.metadata === 'string' ? input.metadata : JSON.stringify(input.metadata)) : null,
      now, now
    );

    return this.db.prepare('SELECT * FROM time_anchors WHERE id = ?').get(id) as any as TimeAnchor;
  }

  /** 检查即将到期的提醒 */
  checkUpcoming(windowHours: number = 24): Reminder[] {
    const now = Date.now();
    const windowEnd = now + windowHours * 3600000;

    const rows = this.db.prepare(`
      SELECT * FROM time_anchors
      WHERE is_active = 1
        AND anchor_type IN ('deadline', 'schedule')
        AND trigger_time IS NOT NULL
        AND trigger_time > ?
        AND trigger_time <= ?
      ORDER BY trigger_time ASC
      LIMIT 10
    `).all(now, windowEnd) as any[];

    return rows.map((r: any) => ({
      anchorId: r.id,
      targetId: r.target_id,
      description: r.reason || `${r.anchor_type}: ${r.target_id}`,
      triggerIn: Math.max(0, r.trigger_time - now),
      conflictGroup: r.conflict_group ?? undefined,
      priority: r.priority,
    }));
  }

  /** 冲突检测：查找与给定锚点时间重叠的其他锚点 */
  detectConflicts(anchorId: string): Conflict[] {
    const anchor = this.db.prepare('SELECT * FROM time_anchors WHERE id = ?').get(anchorId) as any;
    if (!anchor || !anchor.trigger_time) return [];

    const graceMs = (anchor.grace_minutes || 0) * 60000;
    const startA = anchor.trigger_time - graceMs;
    const endA = anchor.trigger_time + graceMs;

    const candidates = this.db.prepare(`
      SELECT * FROM time_anchors
      WHERE is_active = 1
        AND id != ?
        AND trigger_time IS NOT NULL
        AND conflict_group != ?
      ORDER BY trigger_time ASC
    `).all(anchorId, anchor.conflict_group || '__none__') as any[];

    const conflicts: Conflict[] = [];
    for (const c of candidates) {
      const cGrace = (c.grace_minutes || 0) * 60000;
      const startB = c.trigger_time - cGrace;
      const endB = c.trigger_time + cGrace;

      const overlapStart = Math.max(startA, startB);
      const overlapEnd = Math.min(endA, endB);
      if (overlapStart < overlapEnd) {
        const overlapMs = overlapEnd - overlapStart;
        const totalSpan = Math.max(endA - startA, endB - startB);
        const ratio = overlapMs / totalSpan;

        conflicts.push({
          anchorA: anchor as TimeAnchor,
          anchorB: c as TimeAnchor,
          overlapMs,
          severity: ratio > 0.5 ? 'high' : ratio > 0.2 ? 'medium' : 'low',
        });
      }
    }

    return conflicts;
  }

  /** 标记锚点为已触发 */
  markTriggered(anchorId: string): void {
    this.db.prepare(
      'UPDATE time_anchors SET last_triggered = ?, updated_at = ? WHERE id = ?'
    ).run(Date.now(), Date.now(), anchorId);
  }

  /** 停用锚点 */
  deactivateAnchor(anchorId: string): void {
    this.db.prepare(
      'UPDATE time_anchors SET is_active = 0, updated_at = ? WHERE id = ?'
    ).run(Date.now(), anchorId);
  }

  /** 获取活跃锚点列表 */
  getActiveAnchors(targetType?: string, targetId?: string): TimeAnchor[] {
    let sql = 'SELECT * FROM time_anchors WHERE is_active = 1';
    const params: any[] = [];
    if (targetType) {
      sql += ' AND target_type = ?';
      params.push(targetType);
    }
    if (targetId) {
      sql += ' AND target_id = ?';
      params.push(targetId);
    }
    sql += ' ORDER BY trigger_time ASC';
    return this.db.prepare(sql).all(...params) as any as TimeAnchor[];
  }
}
