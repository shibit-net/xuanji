// ============================================================
// M5 权限控制 — 决策核心
// ============================================================
//
// 双层防护设计:
//   第一层 — LLM 主动审查:
//     模型自行判断操作复杂度，通过 plan_review 工具请求用户审查。
//     safe/warn 级别操作完全信任模型判断，不做硬编码拦截。
//
//   第二层 — 硬编码安全兜底:
//     仅 danger 级别操作（rm -rf /、写系统文件等）强制用户确认，
//     模型无法绕过此检查，防止 prompt injection 攻击。
//
// 决策流程:
//   1. 守卫层: FileGuard / CommandGuard 风险评估
//   2. 分流: safe/warn → 自动放行 | danger → 进入确认流程
//   3. 缓存层: 检查运行时决策缓存 (Always/Never)
//   4. 确认层: danger 操作触发 UI 确认
//   5. 缓存层: 用户选择 Always/Never 后更新缓存
//
// 并发处理: 内置确认队列，保证同一时刻只有一个确认框。
//

import type { PermissionConfig } from '@/core/types';
import type {
  IPermissionController,
  PermissionRequest,
  PermissionResult,
  GuardCheckResult,
  ConfirmationHandler,
  PlanReviewResult,
  PlanReviewHandler,
} from './types';
import { FileGuard } from './guards/FileGuard';
import { CommandGuard } from './guards/CommandGuard';
import { PolicyEngine } from './policies/PolicyEngine';
import { AuditLogger } from '@/core/telemetry';
import { logger } from '@/core/logger';
import { t } from '@/core/i18n';

/** 确认超时时间 (ms) */
const CONFIRMATION_TIMEOUT = 60_000;

/** 计划审查超时时间 (ms) — 用户需要阅读+可能输入文本，给 3 倍 */
const PLAN_REVIEW_TIMEOUT = 180_000;

/**
 * PermissionController — 权限决策核心
 */
export class PermissionController implements IPermissionController {
  private log = logger.child({ module: 'PermissionController' });
  private fileGuard: FileGuard;
  private commandGuard: CommandGuard;
  private policyEngine: PolicyEngine;
  private auditLogger: AuditLogger;
  private confirmationHandler: ConfirmationHandler | null = null;
  private planReviewHandler: PlanReviewHandler | null = null;
  private config: PermissionConfig;

  /** 决策缓存最大容量 */
  private static readonly MAX_DECISION_CACHE = 500;

  /** 会话级决策缓存: cacheKey → allowed */
  private decisionCache: Map<string, boolean> = new Map();

  /** 确认队列: 保证同一时刻只有一个确认框 */
  private confirmationQueue: Promise<void> = Promise.resolve();

  constructor(config: PermissionConfig) {
    this.config = config;
    this.fileGuard = new FileGuard();
    this.commandGuard = new CommandGuard();
    this.policyEngine = new PolicyEngine(config);
    this.auditLogger = new AuditLogger();
  }

  /**
   * 设置 UI 确认回调 (由 App.tsx 注入)
   */
  setConfirmationHandler(handler: ConfirmationHandler): void {
    this.confirmationHandler = handler;
  }

  /**
   * 更新配置
   */
  updateConfig(config: PermissionConfig): void {
    this.config = config;
    this.policyEngine.updateConfig(config);
    // 配置变更时清空缓存
    this.decisionCache.clear();
  }

  /**
   * 检查权限 (主入口)
   *
   * 决策逻辑:
   *   - safe/warn: 自动放行，信任模型通过 plan_review 工具主动审查
   *   - danger: 强制用户确认（不可绕过的安全兜底）
   */
  async check(request: PermissionRequest): Promise<PermissionResult> {
    const { toolName, input, requestId } = request;
    this.log.debug(`Permission check: ${requestId} / ${toolName}`);

    // 第 1 步: 守卫评估风险级别
    const guardResult = this.evaluateGuard(toolName, input);
    if (!guardResult) {
      // 无需权限检查的工具 (如未识别的工具名、plan_review 等)
      const result: PermissionResult = { allowed: true, checkedBy: 'no-guard' };
      this.auditLogger.recordPermissionCheck(request, result, null).catch(() => {});
      return result;
    }

    // 第 2 步: safe/warn 级别处理
    // safe 级别 — 始终自动放行
    if (guardResult.riskLevel === 'safe') {
      const result: PermissionResult = { allowed: true, checkedBy: 'auto-safe' };
      this.auditLogger.recordPermissionCheck(request, result, guardResult).catch(() => {});
      return result;
    }

    // warn 级别 — 根据 warnLevel 配置决策
    if (guardResult.riskLevel === 'warn') {
      const warnLevel = this.config.warnLevel ?? 'auto-allow'; // 默认自动放行（向后兼容）

      if (warnLevel === 'ask') {
        // 用户配置为需要确认，进入确认流程
        this.log.debug(`Warn-level operation requires confirmation: ${guardResult.description}`);
        // 检查缓存
        const cached = this.decisionCache.get(guardResult.cacheKey);
        if (cached !== undefined) {
          this.log.debug(`Cache hit: ${guardResult.cacheKey} → ${cached}`);
          const result: PermissionResult = {
            allowed: cached,
            reason: cached ? undefined : t('perm.denied_cache', { desc: guardResult.description }),
            checkedBy: 'cache',
          };
          this.auditLogger.recordPermissionCheck(request, result, guardResult).catch(() => {});
          return result;
        }
        // 触发 UI 确认
        return this.requestConfirmation(request, guardResult);
      }

      // warnLevel === 'auto-allow'，自动放行
      this.log.debug(`Auto-allowing warn-level operation: ${guardResult.description}`);
      const result: PermissionResult = { allowed: true, checkedBy: 'auto-warn' };
      this.auditLogger.recordPermissionCheck(request, result, guardResult).catch(() => {});
      return result;
    }

    // 第 3 步: danger 级别 — 强制确认（安全兜底）
    // 先检查缓存（用户之前选择了 Always/Never）
    const cached = this.decisionCache.get(guardResult.cacheKey);
    if (cached !== undefined) {
      this.log.debug(`Cache hit: ${guardResult.cacheKey} → ${cached}`);
      const result: PermissionResult = {
        allowed: cached,
        reason: cached ? undefined : t('perm.denied_cache', { desc: guardResult.description }),
        checkedBy: 'cache',
      };
      this.auditLogger.recordPermissionCheck(request, result, guardResult).catch(() => {});
      return result;
    }

    // 触发 UI 确认
    return this.requestConfirmation(request, guardResult);
  }

  /**
   * 评估守卫检查
   */
  private evaluateGuard(
    toolName: string,
    input: Record<string, unknown>,
  ): GuardCheckResult | null {
    // 文件操作类工具（包括 notebook_edit 等扩展写入工具）
    if (['read_file', 'write_file', 'edit_file', 'glob', 'grep', 'notebook_edit'].includes(toolName)) {
      return this.fileGuard.check(toolName, input, this.policyEngine);
    }

    // Bash 命令
    if (toolName === 'bash') {
      const command = (input.command ?? input.cmd ?? '') as string;
      if (!command) return null;
      return this.commandGuard.check(command, this.policyEngine);
    }

    return null;
  }

  /**
   * 请求用户确认 (串行化)
   */
  private async requestConfirmation(
    request: PermissionRequest,
    guardResult: GuardCheckResult,
  ): Promise<PermissionResult> {
    if (!this.confirmationHandler) {
      // 无 UI 确认能力时，保守拒绝
      this.log.warn('No confirmation handler, denying by default');
      return {
        allowed: false,
        reason: t('perm.denied_no_handler'),
        checkedBy: 'no-handler',
      };
    }

    // 串行化: 等待前一个确认完成后再弹出新的
    return new Promise<PermissionResult>((resolve) => {
      this.confirmationQueue = this.confirmationQueue.then(async () => {
        try {
          // 带超时的确认
          const confirmation = await this.withTimeout(
            this.confirmationHandler!(request, guardResult),
            CONFIRMATION_TIMEOUT,
          );

          // 更新缓存 (如果用户选择了 Always/Never)
          if (confirmation.remember) {
            if (this.decisionCache.size >= PermissionController.MAX_DECISION_CACHE) {
              // 清空重建（与 PathMatcher 策略一致）
              this.decisionCache.clear();
            }
            this.decisionCache.set(guardResult.cacheKey, confirmation.allowed);
            this.log.debug(`Cache set: ${guardResult.cacheKey} → ${confirmation.allowed}`);
          }

          const permResult: PermissionResult = {
            allowed: confirmation.allowed,
            reason: confirmation.allowed ? undefined : t('perm.denied_user', { desc: guardResult.description }),
            checkedBy: 'user-confirmation',
          };
          this.auditLogger.recordPermissionCheck(request, permResult, guardResult, confirmation.remember).catch(() => {});
          resolve(permResult);
        } catch (err) {
          // 超时或异常: 自动拒绝
          this.log.warn('Confirmation failed, denying:', err);
          const permResult: PermissionResult = {
            allowed: false,
            reason: t('perm.denied_timeout'),
            checkedBy: 'timeout',
          };
          this.auditLogger.recordPermissionCheck(request, permResult, guardResult).catch(() => {});
          resolve(permResult);
        }
      });
    });
  }

  /**
   * 带超时的 Promise
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Confirmation timeout (${ms}ms)`)), ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }

  // ============================================================
  // 计划审查 (Plan Review)
  // ============================================================

  /**
   * 设置计划审查处理器 (由 App.tsx 注入)
   */
  setPlanReviewHandler(handler: PlanReviewHandler): void {
    this.planReviewHandler = handler;
  }

  /**
   * 触发计划审查
   *
   * 由 PlanReviewTool 调用，展示计划文本让用户审查。
   * LLM 自行判断何时需要计划审查，通过 plan_review 工具触发。
   * 返回用户决策: approve / reject / supplement
   */
  async reviewPlan(plan: string): Promise<PlanReviewResult> {
    if (!this.planReviewHandler) {
      this.log.warn('No plan review handler, auto-approving');
      const result: PlanReviewResult = { decision: 'approve' };
      this.auditLogger.recordPlanReview(plan, result).catch(() => {});
      return result;
    }

    try {
      const result = await this.withTimeout(
        this.planReviewHandler(plan),
        PLAN_REVIEW_TIMEOUT,
      );
      this.auditLogger.recordPlanReview(plan, result).catch(() => {});
      return result;
    } catch (err) {
      this.log.warn('Plan review failed, rejecting:', err);
      const result: PlanReviewResult = { decision: 'reject' };
      this.auditLogger.recordPlanReview(plan, result).catch(() => {});
      return result;
    }
  }
}
