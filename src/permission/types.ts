// ============================================================
// M5 权限控制 — 类型定义
// ============================================================

import type { PermissionLevel, PermissionConfig } from '@/core/types';

/**
 * 权限请求 — 由 ToolRegistry 在执行工具前构造
 */
export interface PermissionRequest {
  /** 请求唯一 ID (用于日志追踪) */
  requestId: string;
  /** 工具名称 (e.g. 'write_file', 'bash') */
  toolName: string;
  /** 工具输入参数 */
  input: Record<string, unknown>;
}

/**
 * 权限检查结果
 */
export interface PermissionResult {
  /** 是否允许执行 */
  allowed: boolean;
  /** 拒绝原因（allowed=false 时提供） */
  reason?: string;
  /** 触发的检查层级（用于日志） */
  checkedBy?: string;
}

/**
 * 守卫检查结果
 */
export interface GuardCheckResult {
  /** 操作类别 (用于策略匹配和缓存 key) */
  category: 'fileRead' | 'fileWrite' | 'bashExec';
  /** 风险级别 */
  riskLevel: 'safe' | 'warn' | 'danger';
  /** 描述信息 (展示给用户) */
  description: string;
  /** 缓存 key (e.g. 'bash:git', 'write:/etc/hosts') */
  cacheKey: string;
  /** 上下文信息（新增） */
  context?: {
    /** 是否在项目目录内 */
    isProjectPath?: boolean;
    /** 是否是敏感文件 */
    isSensitiveFile?: boolean;
    /** 受影响的文件列表（批量操作时） */
    affectedFiles?: string[];
  };
}

/**
 * 用户确认结果 (来自 UI)
 */
export interface UserConfirmation {
  /** 是否允许 */
  allowed: boolean;
  /** 是否记住选择 (Always/Never) */
  remember: boolean;
}

/**
 * 确认处理器 — 由 UI 层注入
 * 返回 Promise，等待用户按键后 resolve
 */
export type ConfirmationHandler = (
  request: PermissionRequest,
  guardResult: GuardCheckResult,
) => Promise<UserConfirmation>;

/**
 * 权限控制器接口 (用于 ToolRegistry 依赖注入)
 */
export interface IPermissionController {
  /** 检查权限（可能触发 UI 确认，是异步的） */
  check(request: PermissionRequest): Promise<PermissionResult>;
  /** 设置 UI 确认回调 */
  setConfirmationHandler(handler: ConfirmationHandler): void;
  /** 更新配置 */
  updateConfig(config: PermissionConfig): void;
  /** 获取当前配置 */
  getConfig(): PermissionConfig;
  /** 设置计划审查处理器 */
  setPlanReviewHandler(handler: PlanReviewHandler): void;
  /** 触发计划审查（由 PlanReviewTool 调用，展示计划让用户确认/拒绝/补充） */
  reviewPlan(plan: string): Promise<PlanReviewResult>;
  /** 设置 IgnoreFilter 到 FileGuard */
  setIgnoreFilter(filter: { isIgnored(path: string): boolean }): void;
}

// ============================================================
// 计划审查类型
// ============================================================

/**
 * 计划审查结果
 */
export interface PlanReviewResult {
  /** 用户决策: approve=执行, reject=拒绝, supplement=补充后重新规划 */
  decision: 'approve' | 'reject' | 'supplement';
  /** 用户补充的文本内容 (decision='supplement' 时有值) */
  supplementText?: string;
}

/**
 * 计划审查处理器 — 由 UI 层注入
 * 展示计划文本（markdown），等待用户确认/拒绝/补充
 */
export type PlanReviewHandler = (
  plan: string,
) => Promise<PlanReviewResult>;
