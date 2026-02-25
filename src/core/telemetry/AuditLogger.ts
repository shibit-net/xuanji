// ============================================================
// M10 遥测 — 审计日志 (AuditLog)
// ============================================================
//
// 记录所有权限决策事件和计划审查事件到 JSONL 文件。
//
// 特性:
// - 异步追加写入 (appendFile)，不阻塞主流程
// - 写入失败静默处理，不影响权限决策
// - 敏感数据自动脱敏（长文本截断到 200 字符）
// - 支持按时间、工具名、风险级别过滤查询
//

import { homedir } from 'node:os';
import { join } from 'node:path';
import { appendFile, readFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { PermissionRequest, PermissionResult, GuardCheckResult, PlanReviewResult } from '@/permission/types';

// ── 类型定义 ──

/** 审计记录 */
export interface AuditRecord {
  /** 时间戳 (ISO 8601) */
  timestamp: string;
  /** 事件类型 */
  eventType: 'permission_check' | 'plan_review';
  /** 请求 ID */
  requestId: string;

  // ── 权限检查字段 ──
  /** 工具名称 */
  toolName?: string;
  /** 工具输入 (脱敏后) */
  input?: Record<string, unknown>;
  /** 操作类别 */
  category?: 'fileRead' | 'fileWrite' | 'bashExec';
  /** 风险级别 */
  riskLevel?: 'safe' | 'warn' | 'danger';
  /** 描述信息 */
  description?: string;
  /** 缓存 key */
  cacheKey?: string;
  /** 是否允许 */
  allowed: boolean;
  /** 拒绝原因 */
  reason?: string;
  /** 检查方式 */
  checkedBy: string;
  /** 用户是否选择记住 (Always/Never) */
  remembered?: boolean;

  // ── 计划审查字段 ──
  /** 计划文本预览 (脱敏后) */
  planPreview?: string;
  /** 审查决策 */
  decision?: 'approve' | 'reject' | 'supplement';
  /** 是否包含补充文本 */
  hasSupplementText?: boolean;
}

/** 审计查询过滤器 */
export interface AuditQueryFilter {
  /** 事件类型 */
  eventType?: 'permission_check' | 'plan_review';
  /** 工具名称 */
  toolName?: string;
  /** 风险级别 */
  riskLevel?: 'safe' | 'warn' | 'danger';
  /** 是否允许 */
  allowed?: boolean;
  /** 检查方式 */
  checkedBy?: string;
  /** 开始时间 (ISO 8601) */
  startTime?: string;
  /** 结束时间 (ISO 8601) */
  endTime?: string;
  /** 最大条数 */
  limit?: number;
}

/** 脱敏截断最大长度 */
const MAX_SANITIZE_LENGTH = 200;

/**
 * AuditLogger — 审计日志记录器
 *
 * 将权限决策和计划审查事件持久化到 JSONL 文件，
 * 支持查询和过滤。
 */
export class AuditLogger {
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(homedir(), '.xuanji', 'logs', 'audit.log');
  }

  /**
   * 记录权限检查事件
   */
  async recordPermissionCheck(
    request: PermissionRequest,
    result: PermissionResult,
    guardResult?: GuardCheckResult | null,
    remembered?: boolean,
  ): Promise<void> {
    const record: AuditRecord = {
      timestamp: new Date().toISOString(),
      eventType: 'permission_check',
      requestId: request.requestId,
      toolName: request.toolName,
      input: this.sanitizeInput(request.input),
      category: guardResult?.category,
      riskLevel: guardResult?.riskLevel,
      description: guardResult?.description,
      cacheKey: guardResult?.cacheKey,
      allowed: result.allowed,
      reason: result.reason,
      checkedBy: result.checkedBy ?? 'unknown',
      remembered,
    };

    await this.appendRecord(record);
  }

  /**
   * 记录计划审查事件
   */
  async recordPlanReview(
    plan: string,
    result: PlanReviewResult,
  ): Promise<void> {
    const record: AuditRecord = {
      timestamp: new Date().toISOString(),
      eventType: 'plan_review',
      requestId: `plan-${Date.now()}`,
      planPreview: this.truncate(plan, MAX_SANITIZE_LENGTH),
      decision: result.decision,
      hasSupplementText: !!result.supplementText,
      allowed: result.decision === 'approve',
      checkedBy: 'plan-review',
    };

    await this.appendRecord(record);
  }

  /**
   * 查询审计记录
   */
  async query(filter?: AuditQueryFilter): Promise<AuditRecord[]> {
    try {
      if (!existsSync(this.filePath)) {
        return [];
      }

      const text = await readFile(this.filePath, 'utf-8');
      const lines = text.split('\n').filter((l) => l.trim());
      let records: AuditRecord[] = [];

      for (const line of lines) {
        try {
          records.push(JSON.parse(line) as AuditRecord);
        } catch {
          // 跳过格式错误的行
        }
      }

      // 应用过滤器
      if (filter) {
        records = this.applyFilter(records, filter);
      }

      return records;
    } catch {
      return [];
    }
  }

  /**
   * 清空所有审计记录
   */
  async clear(): Promise<void> {
    try {
      if (existsSync(this.filePath)) {
        await unlink(this.filePath);
      }
    } catch {
      // 静默失败
    }
  }

  // ── 私有方法 ──

  /** 追加记录到 JSONL 文件 */
  private async appendRecord(record: AuditRecord): Promise<void> {
    try {
      const dir = join(this.filePath, '..');
      await mkdir(dir, { recursive: true });
      const line = JSON.stringify(record) + '\n';
      await appendFile(this.filePath, line, 'utf-8');
    } catch {
      // 静默失败，不影响主流程
    }
  }

  /** 对输入参数进行脱敏（截断长文本） */
  private sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string') {
        sanitized[key] = this.truncate(value, MAX_SANITIZE_LENGTH);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /** 截断文本到指定长度 */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...[truncated]';
  }

  /** 应用查询过滤器 */
  private applyFilter(records: AuditRecord[], filter: AuditQueryFilter): AuditRecord[] {
    let filtered = records;

    if (filter.eventType) {
      filtered = filtered.filter((r) => r.eventType === filter.eventType);
    }
    if (filter.toolName) {
      filtered = filtered.filter((r) => r.toolName === filter.toolName);
    }
    if (filter.riskLevel) {
      filtered = filtered.filter((r) => r.riskLevel === filter.riskLevel);
    }
    if (filter.allowed !== undefined) {
      filtered = filtered.filter((r) => r.allowed === filter.allowed);
    }
    if (filter.checkedBy) {
      filtered = filtered.filter((r) => r.checkedBy === filter.checkedBy);
    }
    if (filter.startTime) {
      filtered = filtered.filter((r) => r.timestamp >= filter.startTime!);
    }
    if (filter.endTime) {
      filtered = filtered.filter((r) => r.timestamp <= filter.endTime!);
    }
    if (filter.limit) {
      filtered = filtered.slice(-filter.limit);
    }

    return filtered;
  }
}
