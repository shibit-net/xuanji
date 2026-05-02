/**
 * PermissionController — 权限控制器
 *
 * 职责：工具执行前的权限检查、用户确认、操作审批。
 */

import { logger } from '@/core/logger';
import type { PermissionResult, PermissionRule, ConfirmationRequest, ConfirmationHandler, PlanReviewHandler } from './types';

const log = logger.child({ module: 'PermissionController' });

export class PermissionController {
  private rules: PermissionRule[] = [];
  private confirmationHandler: ConfirmationHandler | null = null;
  private planReviewHandler: PlanReviewHandler | null = null;
  private denialTracker = new Map<string, number>();
  private maxDenials = 3;
  private planMode = false;

  // 默认高风险工具列表
  private static HIGH_RISK_TOOLS = new Set([
    'bash', 'write', 'edit', 'multi_edit', 'notebook_edit',
    'task', 'team', 'web_fetch', 'worktree', 'delete',
  ]);

  check(toolName: string, input: Record<string, unknown>): PermissionResult {
    // Plan mode: 只读工具白名单
    if (this.planMode && !this.isReadonly(toolName)) {
      return 'denied';
    }

    // 检查用户自定义规则
    for (const rule of this.rules) {
      if (rule.toolName !== toolName) continue;
      if (rule.pattern) {
        const inputStr = JSON.stringify(input);
        if (!rule.pattern.test(inputStr)) continue;
      }
      if (rule.autoAllow) return 'allowed';
      if (rule.autoDeny) return 'denied';
      if (rule.requireConfirmation) return 'confirm';
    }

    // 自动拒绝：同一意图连续拒绝过多
    if (this.shouldAutoDeny(toolName)) return 'denied';

    // 默认策略：高风险工具需要确认
    if (PermissionController.HIGH_RISK_TOOLS.has(toolName)) {
      return 'confirm';
    }

    return 'allowed';
  }

  async requestConfirmation(request: ConfirmationRequest): Promise<boolean> {
    if (!this.confirmationHandler) return true; // 无 handler 时默认允许
    try {
      return await this.confirmationHandler(request);
    } catch {
      log.warn('Confirmation handler failed, defaulting to deny');
      return false;
    }
  }

  setRule(rule: PermissionRule): void {
    const idx = this.rules.findIndex(r => r.toolName === rule.toolName);
    if (idx >= 0) {
      this.rules[idx] = rule;
    } else {
      this.rules.push(rule);
    }
  }

  removeRule(toolName: string): void {
    this.rules = this.rules.filter(r => r.toolName !== toolName);
  }

  setConfirmationHandler(handler: ConfirmationHandler): void {
    this.confirmationHandler = handler;
  }

  setPlanReviewHandler(handler: PlanReviewHandler): void {
    this.planReviewHandler = handler;
  }

  async requestPlanReview(plan: any): Promise<boolean> {
    if (!this.planReviewHandler) return true;
    try {
      return await this.planReviewHandler(plan);
    } catch {
      return false;
    }
  }

  enterPlanMode(): void {
    this.planMode = true;
  }

  exitPlanMode(): void {
    this.planMode = false;
  }

  isPlanMode(): boolean {
    return this.planMode;
  }

  trackDenial(toolName: string): void {
    this.denialTracker.set(toolName, (this.denialTracker.get(toolName) ?? 0) + 1);
  }

  shouldAutoDeny(toolName: string): boolean {
    return (this.denialTracker.get(toolName) ?? 0) >= this.maxDenials;
  }

  resetDenials(): void {
    this.denialTracker.clear();
  }

  private isReadonly(toolName: string): boolean {
    const readonlyTools = new Set([
      'read', 'glob', 'grep', 'ls', 'list_agents', 'list_scenes',
      'match_agent', 'todo_list', 'task_output', 'plan_review',
    ]);
    return readonlyTools.has(toolName);
  }
}
