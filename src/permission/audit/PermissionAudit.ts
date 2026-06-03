// ============================================================
// PermissionAudit - 权限审计实现
// ============================================================

import type { IPermissionAudit, PermissionEvent, AuditFilter } from '../interfaces';
import type { DecisionStore, AuditLogEntry } from '../DecisionStore';
import { AuditLogger } from '@/infrastructure/telemetry';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'PermissionAudit' });

/**
 * PermissionAudit - 权限审计
 */
export class PermissionAudit implements IPermissionAudit {
  private auditLogger: AuditLogger;
  /** 环形缓冲区，避免 shift() O(n) 开销 */
  private events: PermissionEvent[] = [];
  private writeIndex = 0;
  private eventCount = 0;
  private maxEvents: number;
  private decisionStore: DecisionStore | null = null;

  constructor(maxEvents = 1000, decisionStore?: DecisionStore) {
    this.auditLogger = new AuditLogger();
    this.maxEvents = maxEvents;
    this.decisionStore = decisionStore ?? null;
  }

  /**
   * 设置 DecisionStore（用于持久化）
   */
  setDecisionStore(store: DecisionStore): void {
    this.decisionStore = store;
  }

  log(event: PermissionEvent): void {
    // 1. 记录到审计日志
    const permissionResult = {
      allowed: event.result === 'allowed',
      reason: event.reason,
      checkedBy: event.source
    };

    this.auditLogger.recordPermissionCheck(
      event.request,
      permissionResult,
      null,
      false
    ).catch(err => {
      log.error('Failed to record permission check:', err);
    });

    // 2. 保存到内存（环形缓冲区，O(1) 写入）
    this.events[this.writeIndex] = event;
    this.writeIndex = (this.writeIndex + 1) % this.maxEvents;
    if (this.eventCount < this.maxEvents) {
      this.eventCount++;
    }

    // 4. 持久化到数据库
    if (this.decisionStore) {
      const auditEntry: AuditLogEntry = {
        eventType: 'permission_check',
        toolName: event.request.toolName,
        category: this.extractCategory(event.request),
        riskLevel: this.extractRiskLevel(event),
        decision: event.result,
        reason: event.reason,
        target: this.extractTarget(event.request),
        userAction: event.source === 'user' ? 'manual_decision' : undefined,
        timestamp: event.timestamp,
        sessionId: event.request.requestId,
      };

      this.decisionStore.saveAuditLog(auditEntry).catch(err => {
        log.error('Failed to persist audit log:', err);
      });
    }
  }

  /** 获取环形缓冲区中所有有效事件（按时间顺序） */
  private getOrderedEvents(): PermissionEvent[] {
    if (this.eventCount === 0) return [];
    const result: PermissionEvent[] = [];
    const start = this.eventCount < this.maxEvents ? 0 : this.writeIndex;
    for (let i = 0; i < this.eventCount; i++) {
      result.push(this.events[(start + i) % this.maxEvents]!);
    }
    return result;
  }

  async query(filter: AuditFilter): Promise<PermissionEvent[]> {
    let results = this.getOrderedEvents();

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
    // 优先从持久化存储获取统计
    if (this.decisionStore) {
      try {
        return this.decisionStore.getAuditStats();
      } catch (err) {
        log.warn('Failed to get stats from DecisionStore, falling back to memory:', err);
      }
    }

    // 回退到内存统计
    const total = this.eventCount;
    const orderedEvents = this.getOrderedEvents();
    const allowed = orderedEvents.filter(e => e.result === 'allowed').length;
    const denied = orderedEvents.filter(e => e.result === 'denied').length;

    return {
      totalChecks: total,
      allowedCount: allowed,
      deniedCount: denied,
      allowRate: total > 0 ? allowed / total : 0
    };
  }

  /**
   * 清空审计记录
   */
  clear(): void {
    this.events = [];
    this.writeIndex = 0;
    this.eventCount = 0;

    // 同时清空持久化存储
    if (this.decisionStore) {
      this.decisionStore.clearAuditLogs().catch(err => {
        log.error('Failed to clear audit logs from DecisionStore:', err);
      });
    }

    log.debug('Audit records cleared');
  }

  /**
   * 从请求中提取操作类别
   */
  private extractCategory(request: any): string | undefined {
    const toolName = request.toolName;
    if (['read_file', 'glob', 'grep'].includes(toolName)) {
      return 'fileRead';
    }
    if (['write_file', 'edit_file', 'notebook_edit'].includes(toolName)) {
      return 'fileWrite';
    }
    if (toolName === 'bash') {
      return 'bashExec';
    }
    return undefined;
  }

  /**
   * 从事件中提取风险级别
   */
  private extractRiskLevel(event: PermissionEvent): string | undefined {
    // 从 reason 中推断风险级别（简化实现）
    if (event.reason?.includes('danger') || event.reason?.includes('危险')) {
      return 'danger';
    }
    if (event.reason?.includes('warn') || event.reason?.includes('警告')) {
      return 'warn';
    }
    if (event.source === 'user') {
      return 'danger'; // 需要用户确认的通常是危险操作
    }
    return 'safe';
  }

  /**
   * 从请求中提取操作目标
   */
  private extractTarget(request: any): string | undefined {
    const input = request.input;
    if (!input) return undefined;

    // 文件操作
    if (input.file_path || input.path) {
      return input.file_path || input.path;
    }

    // Bash 命令
    if (input.command || input.cmd) {
      const cmd = input.command || input.cmd;
      return cmd.length > 100 ? cmd.substring(0, 100) + '...' : cmd;
    }

    return undefined;
  }
}
