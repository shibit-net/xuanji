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
  PersistedDecisionInfo,
} from './types';
import { FileGuard } from './guards/FileGuard';
import { CommandGuard } from './guards/CommandGuard';
import { PolicyEngine } from './policies/PolicyEngine';
import { DecisionStore } from './DecisionStore';
import { AuditLogger } from '@/core/telemetry';
import { logger } from '@/core/logger';
import { t } from '@/core/i18n';
import { join } from 'node:path';
import { resolve } from 'node:path';

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

  /** 持久化决策存储（可选） */
  private decisionStore: DecisionStore | null = null;

  /** 确认队列: 保证同一时刻只有一个确认框 */
  private confirmationQueue: Promise<void> = Promise.resolve();

  constructor(config: PermissionConfig) {
    this.config = config;
    this.fileGuard = new FileGuard();
    this.commandGuard = new CommandGuard();
    this.policyEngine = new PolicyEngine(config);
    this.auditLogger = new AuditLogger();

    // 初始化持久化存储（异步）
    this.initDecisionStore().catch((err) => {
      this.log.warn('Failed to init decision store:', err);
    });
  }

  /**
   * 初始化持久化决策存储（异步）
   */
  private async initDecisionStore(): Promise<void> {
    if (!this.config.persistDecisions) {
      return;
    }

    try {
      const filePath = this.config.decisionsFile
        ? resolve(this.config.decisionsFile)
        : join(process.cwd(), '.xuanji', 'permission-decisions.json');

      this.decisionStore = new DecisionStore(filePath);
      await this.decisionStore.load();

      this.log.debug(`Decision store initialized: ${filePath}`);
    } catch (err) {
      this.log.warn('Decision store init failed:', err);
      this.decisionStore = null;
    }
  }

  /**
   * 设置 UI 确认回调 (由 App.tsx 注入)
   */
  setConfirmationHandler(handler: ConfirmationHandler): void {
    this.confirmationHandler = handler;
  }

  /**
   * 设置 IgnoreFilter 到 FileGuard（公开方法，替代 as any 强制转换）
   */
  setIgnoreFilter(filter: { isIgnored(path: string): boolean }): void {
    this.fileGuard.setIgnoreFilter(filter);
  }

  /**
   * 更新配置
   */
  updateConfig(config: PermissionConfig): void {
    this.config = config;
    this.policyEngine.updateConfig(config);
    // 配置变更时清空缓存
    this.decisionCache.clear();
    // 重新初始化 DecisionStore
    this.initDecisionStore().catch(() => {});
  }

  /**
   * 获取当前配置
   */
  getConfig(): PermissionConfig {
    return this.config;
  }

  /**
   * 检查权限 (主入口)
   *
   * 优化后的决策逻辑:
   *   - danger: 强制用户确认（不可绕过的安全兜底）
   *   - warn: 根据 warnLevel 配置决策（ask=确认, auto-allow=放行）
   *   - safe + fileWrite + 项目内: 根据 confirmWrite 配置决策
   *     - ask: 需要确认
   *     - plan-only: 依赖 LLM 通过 plan_review（自动放行，但 prompt 引导）
   *     - auto: 自动放行
   *   - safe + fileRead: 自动放行
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

    // 第 2 步: safe 级别处理
    // safe + fileRead — 始终自动放行
    if (guardResult.riskLevel === 'safe' && guardResult.category === 'fileRead') {
      const result: PermissionResult = { allowed: true, checkedBy: 'auto-safe-read' };
      this.auditLogger.recordPermissionCheck(request, result, guardResult).catch(() => {});
      return result;
    }

    // safe + fileWrite — 根据 confirmWrite 配置决策
    if (guardResult.riskLevel === 'safe' && guardResult.category === 'fileWrite') {
      const isProjectPath = guardResult.context?.isProjectPath ?? true;
      
      if (isProjectPath) {
        const confirmWrite = this.config.confirmWrite ?? 'plan-only';

        if (confirmWrite === 'ask') {
          // 需要用户确认
          this.log.debug(`Write operation requires confirmation (confirmWrite=ask): ${guardResult.description}`);
          return this.requestConfirmation(request, guardResult);
        }

        if (confirmWrite === 'plan-only') {
          // 依赖 LLM 通过 plan_review 主动确认，此处自动放行
          const result: PermissionResult = { allowed: true, checkedBy: 'plan-delegated' };
          this.auditLogger.recordPermissionCheck(request, result, guardResult).catch(() => {});
          return result;
        }

        // confirmWrite === 'auto'，自动放行
        const result: PermissionResult = { allowed: true, checkedBy: 'auto-write' };
        this.auditLogger.recordPermissionCheck(request, result, guardResult).catch(() => {});
        return result;
      }
    }

    // safe + bashExec — 自动放行
    if (guardResult.riskLevel === 'safe') {
      const result: PermissionResult = { allowed: true, checkedBy: 'auto-safe' };
      this.auditLogger.recordPermissionCheck(request, result, guardResult).catch(() => {});
      return result;
    }

    // 第 3 步: warn 级别 — 根据 warnLevel 配置决策
    if (guardResult.riskLevel === 'warn') {
      const warnLevel = this.config.warnLevel ?? 'ask'; // 默认改为 ask（更保守）

      if (warnLevel === 'ask') {
        // 用户配置为需要确认，进入确认流程
        this.log.debug(`Warn-level operation requires confirmation: ${guardResult.description}`);

        // 检查会话缓存
        const cachedSession = this.decisionCache.get(guardResult.cacheKey);
        if (cachedSession !== undefined) {
          this.log.debug(`Session cache hit: ${guardResult.cacheKey} → ${cachedSession}`);
          const result: PermissionResult = {
            allowed: cachedSession,
            reason: cachedSession ? undefined : t('perm.denied_cache', { desc: guardResult.description }),
            checkedBy: 'session-cache',
          };
          this.auditLogger.recordPermissionCheck(request, result, guardResult).catch(() => {});
          return result;
        }

        // 检查持久化缓存（新增）
        if (this.decisionStore?.isLoaded()) {
          const cachedPersist = this.decisionStore.get(guardResult.cacheKey);
          if (cachedPersist !== undefined) {
            this.log.debug(`Persistent cache hit: ${guardResult.cacheKey} → ${cachedPersist}`);
            // 回填会话缓存
            this.decisionCache.set(guardResult.cacheKey, cachedPersist);
            const result: PermissionResult = {
              allowed: cachedPersist,
              reason: cachedPersist ? undefined : t('perm.denied_cache', { desc: guardResult.description }),
              checkedBy: 'persist-cache',
            };
            this.auditLogger.recordPermissionCheck(request, result, guardResult).catch(() => {});
            return result;
          }
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

    // 第 4 步: danger 级别 — 强制确认（安全兜底）
    // 先检查会话缓存（用户之前选择了 Always/Never）
    const cachedSession = this.decisionCache.get(guardResult.cacheKey);
    if (cachedSession !== undefined) {
      this.log.debug(`Session cache hit: ${guardResult.cacheKey} → ${cachedSession}`);
      const result: PermissionResult = {
        allowed: cachedSession,
        reason: cachedSession ? undefined : t('perm.denied_cache', { desc: guardResult.description }),
        checkedBy: 'session-cache',
      };
      this.auditLogger.recordPermissionCheck(request, result, guardResult).catch(() => {});
      return result;
    }

    // 检查持久化缓存（新增）
    if (this.decisionStore?.isLoaded()) {
      const cachedPersist = this.decisionStore.get(guardResult.cacheKey);
      if (cachedPersist !== undefined) {
        this.log.debug(`Persistent cache hit: ${guardResult.cacheKey} → ${cachedPersist}`);
        // 回填会话缓存
        this.decisionCache.set(guardResult.cacheKey, cachedPersist);
        const result: PermissionResult = {
          allowed: cachedPersist,
          reason: cachedPersist ? undefined : t('perm.denied_cache', { desc: guardResult.description }),
          checkedBy: 'persist-cache',
        };
        this.auditLogger.recordPermissionCheck(request, result, guardResult).catch(() => {});
        return result;
      }
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
          // 直接 await handler，超时逻辑由 UI 层（App.tsx）负责
          const confirmation = await this.confirmationHandler!(request, guardResult);

          // 更新缓存 (如果用户选择了 Always/Never)
          if (confirmation.remember) {
            if (this.decisionCache.size >= PermissionController.MAX_DECISION_CACHE) {
              // 清空重建（与 PathMatcher 策略一致）
              this.decisionCache.clear();
            }
            this.decisionCache.set(guardResult.cacheKey, confirmation.allowed);
            this.log.debug(`Session cache set: ${guardResult.cacheKey} → ${confirmation.allowed}`);

            // 持久化存储
            if (this.decisionStore) {
              this.decisionStore.set(guardResult.cacheKey, confirmation.allowed, request.toolName).catch((err) => {
                this.log.warn('Failed to persist decision:', err);
              });
            }
          }

          const permResult: PermissionResult = {
            allowed: confirmation.allowed,
            reason: confirmation.allowed ? undefined : t('perm.denied_user', { desc: guardResult.description }),
            checkedBy: 'user-confirmation',
          };
          this.auditLogger.recordPermissionCheck(request, permResult, guardResult, confirmation.remember).catch(() => {});
          resolve(permResult);
        } catch (err) {
          // handler 异常: 自动拒绝
          this.log.warn('Confirmation handler error, denying:', err);
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

    // 直接 await handler，超时逻辑由 UI 层（App.tsx）负责
    try {
      const result = await this.planReviewHandler(plan);
      this.auditLogger.recordPlanReview(plan, result).catch(() => {});
      return result;
    } catch (err) {
      this.log.warn('Plan review handler error, rejecting:', err);
      const result: PlanReviewResult = { decision: 'reject' };
      this.auditLogger.recordPlanReview(plan, result).catch(() => {});
      return result;
    }
  }

  // ============================================================
  // 权限规则管理方法
  // ============================================================

  /**
   * 列出所有持久化决策（供管理 UI 展示）
   */
  listDecisions(): PersistedDecisionInfo[] {
    return this.decisionStore?.getAll() ?? [];
  }

  /**
   * 删除指定决策（同时清除会话级缓存）
   */
  async deleteDecision(cacheKey: string): Promise<void> {
    // 清除会话缓存
    this.decisionCache.delete(cacheKey);
    // 清除持久化存储
    if (this.decisionStore) {
      await this.decisionStore.delete(cacheKey);
    }
  }

  /**
   * 清空所有决策（同时清除会话级缓存）
   */
  async clearDecisions(): Promise<void> {
    // 清空会话缓存
    this.decisionCache.clear();
    // 清空持久化存储
    if (this.decisionStore) {
      await this.decisionStore.clear();
    }
  }
}
