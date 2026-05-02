/**
 * Permission 模块类型定义
 */

export type PermissionResult = 'allowed' | 'denied' | 'confirm';

export interface PermissionRule {
  toolName: string;
  pattern?: RegExp;
  autoAllow?: boolean;
  autoDeny?: boolean;
  requireConfirmation?: boolean;
}

export interface ConfirmationRequest {
  toolName: string;
  toolInput: Record<string, unknown>;
  reason: string;
  risk: 'low' | 'medium' | 'high';
}

export type ConfirmationHandler = (request: ConfirmationRequest) => Promise<boolean>;
export type PlanReviewHandler = (plan: any) => Promise<boolean>;

export interface PermissionConfig {
  planMode: boolean;
  maxAutoDenials: number;
  rules: PermissionRule[];
}
