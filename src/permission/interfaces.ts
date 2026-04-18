// ============================================================
// Permission 接口定义
// ============================================================

import type { PermissionRequest, PermissionResult, GuardCheckResult } from '@/permission/types';

/**
 * 守卫接口
 */
export interface IPermissionGuard {
  check(request: PermissionRequest): GuardCheckResult;
}

/**
 * 策略接口
 */
export interface IPermissionPolicy {
  evaluate(request: PermissionRequest): PolicyResult;
}

/**
 * 缓存接口
 */
export interface IPermissionCache {
  get(key: string): boolean | undefined;
  set(key: string, value: boolean, ttl?: number): void;
  clear(): void;
}

/**
 * 审计接口
 */
export interface IPermissionAudit {
  log(event: PermissionEvent): void;
  query(filter: AuditFilter): Promise<PermissionEvent[]>;
}

/**
 * 确认服务接口
 */
export interface IConfirmationService {
  confirm(request: ConfirmationRequest): Promise<ConfirmationResult>;
}

/**
 * 策略结果
 */
export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  matchedRule?: string;
}

/**
 * 权限事件
 */
export interface PermissionEvent {
  timestamp: number;
  request: PermissionRequest;
  result: 'allowed' | 'denied';
  source: 'guard' | 'policy' | 'user' | 'cache' | 'default';
  reason?: string;
}

/**
 * 审计过滤器
 */
export interface AuditFilter {
  startTime?: number;
  endTime?: number;
  result?: 'allowed' | 'denied';
  source?: string;
}

/**
 * 确认请求
 */
export interface ConfirmationRequest {
  request: PermissionRequest;
  reason?: string;
  level: 'safe' | 'warn' | 'danger';
}

/**
 * 确认结果
 */
export interface ConfirmationResult {
  allowed: boolean;
  remember?: boolean;
}
