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
  DeniedOperation,
  DeniedOperationInfo,
} from './types';
import { FileGuard } from './guards/FileGuard';
import { CommandGuard } from './guards/CommandGuard';
import { PolicyEngine } from './policies/PolicyEngine';
import { DecisionStore, AuditLogEntry, AuditQueryOptions, AuditStats } from './DecisionStore';
import { PermissionAudit } from './audit/PermissionAudit';
import { EventBus } from '@/infrastructure/messaging';
import { logger } from '@/core/logger';
import { t } from '@/core/i18n';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';

/**
 * 权限检查事件
 */
export interface PermissionCheckedEvent {
  request: PermissionRequest;
  result: PermissionResult;
  guardResult: GuardCheckResult | null;
  rememberChoice?: boolean;
  timestamp: Date;
}

/**
 * 计划审查事件
 */
export interface PlanReviewedEvent {
  plan: string;
  result: PlanReviewResult;
  timestamp: Date;
}

/**
 * PermissionController — 权限决策核心
 */
export class PermissionController implements IPermissionController {
  private log = logger.child({ module: 'PermissionController' });
  private fileGuard: FileGuard;
  private commandGuard: CommandGuard;
  private policyEngine: PolicyEngine;
  private eventBus: EventBus;
  private confirmationHandler: ConfirmationHandler | null = null;
  private planReviewHandler: PlanReviewHandler | null = null;
  private config: PermissionConfig;

  /** 决策缓存最大容量 */
  private static readonly MAX_DECISION_CACHE = 500;

  /** 确认超时时间（毫秒），超时后自动拒绝 */
  private static readonly CONFIRMATION_TIMEOUT_MS = 60_000;

  /** 计划审查超时时间（毫秒），超时后自动拒绝 */
  private static readonly PLAN_REVIEW_TIMEOUT_MS = 300_000;

  /** 会话级决策缓存: cacheKey → allowed */
  private decisionCache: Map<string, boolean> = new Map();

  /** 持久化决策存储（可选） */
  private decisionStore: DecisionStore | null = null;

  /** 权限审计 */
  private permissionAudit: PermissionAudit;

  /** 用户拒绝的操作记录 */
  private deniedOperations: Map<string, DeniedOperation> = new Map();

  /** 当前用户意图上下文（用于跟踪同一意图下的多次操作尝试） */
  private currentUserIntent: string | null = null;

  /** 当前意图下被拒绝的操作类型（用于阻止同一意图的其他实现方式） */
  private deniedIntentOperations: Set<string> = new Set();

  /** 确认队列: 保证同一时刻只有一个确认框 */
  private confirmationQueue: Promise<void> = Promise.resolve();

  /** 当前登录用户 ID，用于决策记录的按用户隔离存储 */
  private userId: string;

  constructor(config: PermissionConfig, userId?: string, eventBus?: EventBus) {
    this.userId = userId || 'default';
    this.config = config;
    this.fileGuard = new FileGuard();
    this.commandGuard = new CommandGuard();
    this.policyEngine = new PolicyEngine(config);
    this.eventBus = eventBus ?? new EventBus();
    this.permissionAudit = new PermissionAudit();

    // 初始化持久化存储（异步），初始化完成后会自动加载拒绝操作记录
    this.initDecisionStore().catch((err) => {
      this.log.warn('Failed to init decision store:', err);
    });
  }

  /**
   * 获取 EventBus 实例（供外部订阅事件）
   */
  getEventBus(): EventBus {
    return this.eventBus;
  }

  /**
   * 初始化持久化决策存储（异步）
   */
  private async initDecisionStore(): Promise<void> {
    if (!this.config.persistDecisions) {
      return;
    }

    try {
      const dbPath = this.config.decisionsFile
        ? resolve(this.config.decisionsFile)
        : join(homedir(), '.xuanji', this.userId, 'permission-decisions.db');

      this.decisionStore = new DecisionStore(dbPath);
      await this.decisionStore.init();

      // 将 DecisionStore 传递给 PermissionAudit
      this.permissionAudit.setDecisionStore(this.decisionStore);

      this.log.debug(`Decision store initialized: ${dbPath}`);

      // 初始化后加载拒绝操作记录
      await this.loadDeniedOperations();
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
   * 设置当前用户意图（由 AgentLoop 在处理新用户消息时调用）
   */
  setCurrentUserIntent(intent: string | null): void {
    if (intent !== this.currentUserIntent) {
      // 新的用户意图，清空之前的拒绝记录
      this.currentUserIntent = intent;
      this.deniedIntentOperations.clear();
      this.log.debug(`User intent changed: ${intent ? intent.slice(0, 50) : 'null'}`);
    }
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

    // 第 0 步: 检查操作黑名单
    const guardResult = this.evaluateGuard(toolName, input);
    if (guardResult && this.isDeniedOperation(guardResult.category, guardResult.cacheKey)) {
      const result: PermissionResult = {
        allowed: false,
        reason: '此操作已被用户明确拒绝',
        checkedBy: 'DeniedOperationFilter',
      };
      this.logAuditEvent(request, result, guardResult);
      return result;
    }

    // 第 0.5 步: 检查当前意图下是否已拒绝同类操作
    if (guardResult && this.currentUserIntent && guardResult.context?.operationType) {
      const operationType = guardResult.context.operationType;
      if (this.deniedIntentOperations.has(operationType)) {
        this.log.warn(`Blocking ${operationType} operation - user already denied this type of operation for current intent`);
        const result: PermissionResult = {
          allowed: false,
          reason: `您已拒绝当前任务中的${this.getOperationTypeLabel(operationType)}操作，AI 不会尝试其他方式来完成此操作`,
          checkedBy: 'DeniedIntentFilter',
        };
        this.logAuditEvent(request, result, guardResult);
        return result;
      }
    }

    // 第 1 步: 守卫评估风险级别
    if (!guardResult) {
      // 无需权限检查的工具 (如未识别的工具名、plan_review 等)
      const result: PermissionResult = { allowed: true, checkedBy: 'no-guard' };
      this.logAuditEvent(request, result, null);
      this.eventBus.emit('permission:checked', {
        request,
        result,
        guardResult: null,
        timestamp: new Date(),
      });
      return result;
    }

    // 第 1.5 步: 基础权限配置检查
    const permissionLevel = this.policyEngine.getLevel(guardResult.category);

    if (permissionLevel === 'never') {
      // 用户配置为禁止此类操作
      const result: PermissionResult = {
        allowed: false,
        reason: t('perm.denied_policy', { category: guardResult.category }),
        checkedBy: 'policy-never',
      };
      this.logAuditEvent(request, result, guardResult);
      this.eventBus.emit('permission:checked', {
        request,
        result,
        guardResult,
        timestamp: new Date(),
      });
      return result;
    }

    if (permissionLevel === 'always') {
      // 用户配置为始终允许此类操作
      const result: PermissionResult = { allowed: true, checkedBy: 'policy-always' };
      this.logAuditEvent(request, result, guardResult);
      this.eventBus.emit('permission:checked', {
        request,
        result,
        guardResult,
        timestamp: new Date(),
      });
      return result;
    }

    // permissionLevel === 'ask'，继续走风险级别判断流程

    // 第 2 步: safe 级别处理
    // safe + fileRead — 始终自动放行
    if (guardResult.riskLevel === 'safe' && guardResult.category === 'fileRead') {
      const result: PermissionResult = { allowed: true, checkedBy: 'auto-safe-read' };
      this.logAuditEvent(request, result, guardResult);
      this.eventBus.emit('permission:checked', {
        request,
        result,
        guardResult,
        timestamp: new Date(),
      });
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
          this.logAuditEvent(request, result, guardResult);
          this.eventBus.emit('permission:checked', {
            request,
            result,
            guardResult,
            timestamp: new Date(),
          });
          return result;
        }

        // confirmWrite === 'auto'，自动放行
        const result: PermissionResult = { allowed: true, checkedBy: 'auto-write' };
        this.logAuditEvent(request, result, guardResult);
        this.eventBus.emit('permission:checked', {
          request,
          result,
          guardResult,
          timestamp: new Date(),
        });
        return result;
      }
    }

    // safe + bashExec — 自动放行
    if (guardResult.riskLevel === 'safe') {
      const result: PermissionResult = { allowed: true, checkedBy: 'auto-safe' };
      this.logAuditEvent(request, result, guardResult);
      this.eventBus.emit('permission:checked', {
        request,
        result,
        guardResult,
        timestamp: new Date(),
      });
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
          this.logAuditEvent(request, result, guardResult);
          this.eventBus.emit('permission:checked', {
            request,
            result,
            guardResult,
            timestamp: new Date(),
          });
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
            this.logAuditEvent(request, result, guardResult);
            this.eventBus.emit('permission:checked', {
              request,
              result,
              guardResult,
              timestamp: new Date(),
            });
            return result;
          }
        }

        // 触发 UI 确认
        return this.requestConfirmation(request, guardResult);
      }

      // warnLevel === 'auto-allow'，自动放行
      this.log.debug(`Auto-allowing warn-level operation: ${guardResult.description}`);
      const result: PermissionResult = { allowed: true, checkedBy: 'auto-warn' };
      this.logAuditEvent(request, result, guardResult);
      this.eventBus.emit('permission:checked', {
        request,
        result,
        guardResult,
        timestamp: new Date(),
      });
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
      this.logAuditEvent(request, result, guardResult);
      this.eventBus.emit('permission:checked', {
        request,
        result,
        guardResult,
        timestamp: new Date(),
      });
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
        this.logAuditEvent(request, result, guardResult);
        this.eventBus.emit('permission:checked', {
          request,
          result,
          guardResult,
          timestamp: new Date(),
        });
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
      const result = this.commandGuard.check(command, this.policyEngine);
      const operationInfo = this.commandGuard.detectOperationType(command);
      result.context = {
        ...result.context,
        operationType: operationInfo.type,
        operationTargets: operationInfo.targets,
      };
      return result;
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
      const result: PermissionResult = {
        allowed: false,
        reason: t('perm.denied_no_handler'),
        checkedBy: 'no-handler',
      };
      this.logAuditEvent(request, result, guardResult);
      return result;
    }

    // 串行化: 等待前一个确认完成后再弹出新的
    return new Promise<PermissionResult>((resolve) => {
      this.confirmationQueue = this.confirmationQueue.then(async () => {
        try {
          // 添加超时保护：60秒未响应则自动拒绝，防止 UI 崩溃导致永久阻塞
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Confirmation timeout')), PermissionController.CONFIRMATION_TIMEOUT_MS);
          });
          const confirmation = await Promise.race([
            this.confirmationHandler!(request, guardResult),
            timeoutPromise,
          ]);

          // 更新缓存 (如果用户选择了 Always/Never)
          if (confirmation.remember) {
            if (this.decisionCache.size >= PermissionController.MAX_DECISION_CACHE) {
              // 逐出最早的条目（FIFO），避免全量清空导致大量重新确认
              const firstKey = this.decisionCache.keys().next().value;
              if (firstKey !== undefined) {
                this.decisionCache.delete(firstKey);
              }
            }
            this.decisionCache.set(guardResult.cacheKey, confirmation.allowed);
            this.log.debug(`Session cache set: ${guardResult.cacheKey} → ${confirmation.allowed}`);

            // 持久化存储
            if (this.decisionStore) {
              this.decisionStore.set(guardResult.cacheKey, confirmation.allowed, request.toolName).catch((err) => {
                this.log.warn('Failed to persist decision:', err);
              });
            }
            
            // 如果用户拒绝，记录到拒绝操作列表
            if (!confirmation.allowed) {
              this.recordDeniedOperation(
                guardResult.category,
                guardResult.cacheKey,
                `用户拒绝: ${guardResult.description}`,
                false
              );

              // 记录当前意图下被拒绝的操作类型
              if (this.currentUserIntent && guardResult.context?.operationType) {
                this.deniedIntentOperations.add(guardResult.context.operationType);
                this.log.debug(`Recorded denied operation type for current intent: ${guardResult.context.operationType}`);
              }
            }
          } else if (!confirmation.allowed) {
            // 仅会话级拒绝
            this.recordDeniedOperation(
              guardResult.category,
              guardResult.cacheKey,
              `用户拒绝（本会话）: ${guardResult.description}`,
              true
            );

            // 记录当前意图下被拒绝的操作类型
            if (this.currentUserIntent && guardResult.context?.operationType) {
              this.deniedIntentOperations.add(guardResult.context.operationType);
              this.log.debug(`Recorded denied operation type for current intent (session only): ${guardResult.context.operationType}`);
            }
          }

          const permResult: PermissionResult = {
            allowed: confirmation.allowed,
            reason: confirmation.allowed ? undefined : t('perm.denied_user', { desc: guardResult.description }),
            checkedBy: 'user-confirmation',
          };
          this.logAuditEvent(request, permResult, guardResult);
          this.eventBus.emit('permission:checked', {
            request,
            result: permResult,
            guardResult,
            rememberChoice: confirmation.remember,
            timestamp: new Date(),
          });
          resolve(permResult);
        } catch (err) {
          // handler 异常: 自动拒绝
          this.log.warn('Confirmation handler error, denying:', err);
          const permResult: PermissionResult = {
            allowed: false,
            reason: t('perm.denied_timeout'),
            checkedBy: 'timeout',
          };
          this.logAuditEvent(request, permResult, guardResult);
          this.eventBus.emit('permission:checked', {
            request,
            result: permResult,
            guardResult,
            timestamp: new Date(),
          });
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
      this.eventBus.emit('plan:reviewed', {
        plan,
        result,
        timestamp: new Date(),
      });
      return result;
    }

    try {
      // 超时保护：PLAN_REVIEW_TIMEOUT_MS 内未响应则自动拒绝，防止 UI 崩溃/用户离开导致永久阻塞
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error('Plan review timeout')),
          PermissionController.PLAN_REVIEW_TIMEOUT_MS,
        );
      });
      const result = await Promise.race([
        this.planReviewHandler(plan),
        timeoutPromise,
      ]);
      this.eventBus.emit('plan:reviewed', {
        plan,
        result,
        timestamp: new Date(),
      });
      return result;
    } catch (err) {
      this.log.warn('Plan review timeout/error, auto-rejecting:', err);
      const result: PlanReviewResult = { decision: 'reject' };
      this.eventBus.emit('plan:reviewed', {
        plan,
        result,
        timestamp: new Date(),
      });
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

  // ============================================================
  // 拒绝操作管理方法
  // ============================================================

  /**
   * 从 DecisionStore 加载拒绝操作记录
   */
  private async loadDeniedOperations(): Promise<void> {
    if (!this.decisionStore) return;

    try {
      const deniedOpsMap = this.decisionStore.loadDeniedOperations();
      this.deniedOperations.clear();

      for (const [key, op] of deniedOpsMap) {
        this.deniedOperations.set(key, {
          pattern: op.pattern,
          reason: op.reason,
          timestamp: op.timestamp,
          sessionOnly: false,
        });
      }

      this.log.debug(`Loaded ${deniedOpsMap.size} denied operations`);
    } catch (err) {
      this.log.error('Failed to load denied operations:', err);
    }
  }

  /**
   * 记录用户拒绝的操作
   */
  recordDeniedOperation(
    category: string,
    pattern: string,
    reason: string,
    sessionOnly: boolean = true
  ): void {
    const key = `${category}:${pattern}`;
    const deniedOp: DeniedOperation = {
      pattern,
      reason,
      timestamp: Date.now(),
      sessionOnly,
    };

    this.deniedOperations.set(key, deniedOp);
    this.log.info(`Recorded denied operation: ${key} (sessionOnly=${sessionOnly})`);

    // 持久化存储（仅非会话级）
    if (!sessionOnly && this.decisionStore) {
      this.decisionStore.saveDeniedOperation(category, pattern, reason).catch((err) => {
        this.log.warn('Failed to persist denied operation:', err);
      });
    }
  }

  /**
   * 检查操作是否被用户拒绝
   */
  isDeniedOperation(category: string, target: string): boolean {
    for (const [key, denied] of this.deniedOperations) {
      const [deniedCategory, deniedPattern] = key.split(':', 2);
      if (deniedCategory === category && this.matchPattern(deniedPattern, target)) {
        this.log.debug(`Operation denied by pattern: ${deniedPattern} matches ${target}`);
        return true;
      }
    }
    return false;
  }

  /**
   * 模式匹配（支持通配符）
   */
  private matchPattern(pattern: string, target: string): boolean {
    // 精确匹配
    if (pattern === target) return true;

    // 简单通配符匹配（* 匹配任意字符）
    const regexPattern = pattern.replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(target);
  }

  /**
   * 列出所有拒绝的操作
   */
  listDeniedOperations(): DeniedOperationInfo[] {
    const result: DeniedOperationInfo[] = [];
    
    for (const [key, denied] of this.deniedOperations) {
      const [category, pattern] = key.split(':', 2);
      result.push({
        key,
        category: category || '',
        pattern: denied.pattern,
        reason: denied.reason,
        timestamp: new Date(denied.timestamp).toISOString(),
        sessionOnly: denied.sessionOnly,
      });
    }
    
    return result;
  }

  /**
   * 删除指定拒绝记录
   */
  async deleteDeniedOperation(key: string): Promise<void> {
    this.deniedOperations.delete(key);
    
    if (this.decisionStore) {
      await this.decisionStore.deleteDeniedOperation(key);
    }
    
    this.log.info(`Deleted denied operation: ${key}`);
  }

  /**
   * 清空所有拒绝记录
   */
  async clearDeniedOperations(): Promise<void> {
    this.deniedOperations.clear();

    if (this.decisionStore) {
      await this.decisionStore.clearDeniedOperations();
    }

    this.log.info('Cleared all denied operations');
  }

  /**
   * 获取操作类型的中文标签
   */
  private getOperationTypeLabel(operationType: string): string {
    const labels: Record<string, string> = {
      delete: '删除',
      write: '写入',
      read: '读取',
      execute: '执行',
      unknown: '未知',
    };
    return labels[operationType] || operationType;
  }

  // ============================================================
  // 审计日志方法
  // ============================================================

  /**
   * 记录审计事件（内部辅助方法）
   */
  private logAuditEvent(
    request: PermissionRequest,
    result: PermissionResult,
    guardResult: GuardCheckResult | null
  ): void {
    const event = {
      timestamp: Date.now(),
      request,
      result: result.allowed ? 'allowed' as const : 'denied' as const,
      source: result.checkedBy as any,
      reason: result.reason,
    };
    this.permissionAudit.log(event);
  }

  /**
   * 查询审计日志（从持久化存储）
   */
  listAuditLogs(options: AuditQueryOptions = {}): AuditLogEntry[] {
    if (this.decisionStore) {
      return this.decisionStore.queryAuditLogs(options);
    }
    return [];
  }

  /**
   * 获取审计统计
   */
  getAuditStats(): AuditStats {
    return this.permissionAudit.getStats();
  }

  /**
   * 清除审计日志
   */
  async clearAuditLogs(): Promise<void> {
    this.permissionAudit.clear();
  }
}
