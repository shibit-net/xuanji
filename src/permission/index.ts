// ============================================================
// M5 权限控制 — 模块导出
// ============================================================

export { PermissionController } from './PermissionController';
export { FileGuard } from './guards/FileGuard';
export { CommandGuard } from './guards/CommandGuard';
export { PolicyEngine } from './policies/PolicyEngine';
export { PathMatcher, globToRegex } from './policies/PathMatcher';
export { PermissionPrompt } from './ui/PermissionPrompt';
export { PlanReview } from './ui/PlanReview';

export type {
  IPermissionController,
  PermissionRequest,
  PermissionResult,
  GuardCheckResult,
  UserConfirmation,
  ConfirmationHandler,
  PlanReviewResult,
  PlanReviewHandler,
} from './types';
