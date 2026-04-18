// ============================================================
// PermissionAudit - 权限审计实现
// ============================================================

import type { IPermissionAudit, PermissionEvent, AuditFilter } from '../interfaces';
import { AuditLogger } from '@/core/telemetry';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'PermissionAudit' });

/**
 * PermissionAudit - 权限审计
 */
export class PermissionAudit implements IPermissionAudit {
  private auditLogger: AuditLogger;
  private events: PermissionEvent[] = [];
  private maxEvents: number;

  constructor(maxEvents = 1000) {
    this.auditLogger = new AuditLogger();
    this.maxEvents = maxEvents;
  }

  log(event: PermissionEvent): void {
    // 1. 记录到审计日志
    this.auditLogger.log({
      timestamp: event.timestamp,
      type: 'permission',
      operation: event.request.operation,
      result: event.result,
      source: event.source,
      reason: event.reason,
      metadata: event.request
    });

    // 2. 保存到内存（用于查询）
    this.events.push(event);

    // 3. 限制内存大小
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  async query(filter: AuditFilter): Promise<PermissionEvent[]> {
    let results = [...this.events];

    // 时间范围过滤
    if (filter.startTime) {
      results = results.filter(e => e.timestamp >= filter.startTime!);
    }
    if (filter.endTime) {
      results = results.filter(e => e.timestamp <= filter.endTime!);
    }

    // 结果过滤
    if (filter.result) {
      results = results.filter(e => e.result === filter.result);
    }

    // 来源过滤
    if (filter.source) {
      results = results.filter(e => e.source === filter.source);
    }

    return results;
  }

  /**
   * 获取审计统计
   */
  getStats() {
    const total = this.events.length;
    const allowed = this.events.filter(e => e.result === 'allowed').length;
    const denied = this.events.filter(e => e.result === 'denied').length;

    return {
      total,
      allowed,
      denied,
      allowRate: total > 0 ? allowed / total : 0
    };
  }

  /**
   * 清空审计记录
   */
  clear(): void {
    this.events = [];
    log.debug('Audit records cleared');
  }
}
