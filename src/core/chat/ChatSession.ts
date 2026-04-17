// ============================================================
// ChatSession — 交互方式无关的会话抽象
// ============================================================
//
// 所有适配器（CLI、IM 机器人、Electron GUI）的统一入口。
// 封装 AgentLoop 的初始化和回调注册。
//

import type {
  AgentConfig,
  AgentState,
  TokenUsage,
  ILLMProvider,
  IToolRegistry,
  AppConfig,
  Message,
} from '@/core/types';
import { AgentLoop, type AgentCallbacks } from '@/core/agent/AgentLoop';
import { ToolRegistry } from '@/core/tools/ToolRegistry';
import { AskUserTool, type AskUserHandler } from '@/core/tools/AskUserTool';
import { EnterPlanModeTool, type PlanModeEnterHandler } from '@/core/tools/EnterPlanModeTool';
import { ExitPlanModeTool, type PlanModeExitHandler } from '@/core/tools/ExitPlanModeTool';
import type { IPermissionController, ConfirmationHandler, PlanReviewHandler } from '@/permission/types';
import type { SkillRegistry } from '@/core/skills';
import type { IMemoryStore } from '@/memory/types';
import { MCPManager } from '@/mcp/MCPManager';
import { logger } from '@/core/logger';
import { SessionInitializer, type InitOptions } from './SessionInitializer';
import { SessionManager } from '@/session/SessionManager';
import { CheckpointManager } from '@/session/CheckpointManager';
import type { SessionListItem, Checkpoint, Message as SessionMessage, SessionUsage, HistoryMessage, ResumedSessionContext } from '@/session/types';
import { HookRegistry } from '@/hooks/HookRegistry';
import { PricingResolver } from '@/core/agent/PricingResolver';
import { BackgroundTaskManager } from '@/core/tools/BackgroundTaskManager';
import { TaskRouterService } from '@/core/routing/TaskRouterService';
import { MemoryService } from '@/memory/MemoryService';
import { SystemDiagnostics } from './SystemDiagnostics';
import { SkillRouter } from './SkillRouter';
import { PromptOrchestrator } from './PromptOrchestrator';
import { TurnLifecycleManager } from './TurnLifecycleManager';

const log = logger.child({ module: 'ChatSession' });

/**
 * 计划确认处理器
 * @param plan 执行计划
 * @returns Promise<boolean> true=确认执行，false=取消执行
 */
export type PlanConfirmHandler = (
  plan: import('@/core/routing/types').ExecutionPlan
) => Promise<boolean>;

/**
 * 会话级别的回调接口
 */
export interface SessionCallbacks {
  /** 启动引导：开始回忆（展示思考状态） */
  onBootThinking?: () => void;
  /** 启动引导消息（作为 assistant 消息展示在对话框） */
  onBootGuide?: (message: string) => void;

  /** 自动归档通知 */
  onArchiveNotification?: (result: {
    archivedCount: number;
    memoriesExtracted: number;
    summary?: string;
  }) => void;

  /** 恢复消息历史到 GUI */
  onMessagesRestored?: (messages: import('@/session/types').HistoryMessage[]) => void;

  /**
   * Skill 路由确认（confidence 0.6-0.9 时触发）
   * 返回 true 表示用户确认执行，false 表示跳过走 AgentLoop
   */
  onSkillConfirm?: (skill: { id: string; name: string; description: string; slashCommand?: string }, confidence: number) => Promise<boolean>;
}

/**
 * ChatSession 初始化选项
 */
export interface ChatSessionOptions {
  /** 模型覆盖 */
  model?: string;
  /** 已有的 Provider 实例 (跳过自动创建) */
  provider?: ILLMProvider;
  /** 已有的工具注册表 (跳过自动创建) */
  registry?: IToolRegistry;
  /** 已有的配置 (跳过自动加载) */
  config?: AppConfig;
  /** 回调函数 */
  callbacks?: SessionCallbacks;
}

/**
 * ChatSession — 与交互方式无关的会话管理器
 *
 * 职责:
 * 1. 加载配置、初始化 Provider 和 ToolRegistry
 * 2. 管理 AgentLoop 实例
 * 3. 提供统一的 run/stop/reset 接口
 * 4. 让各适配器不需要了解初始化细节
 */
export class ChatSession {
  private agentLoop: AgentLoop | null = null;
  private skillRegistry: SkillRegistry | null = null;
  private permissionController: IPermissionController | null = null;
  private memoryManager: IMemoryStore | null = null;
  private reminderContext: string | null = null;
  private reminderEngine: import('@/reminder').IReminderEngine | null = null;
  private proactiveButler: import('@/butler').IProactiveButler | null = null;
  private mcpManager: MCPManager | null = null;
  private templateRepo: import('@/core/template').TemplateRepo | null = null;
  private onPlanConfirm: PlanConfirmHandler | null = null;
  private agentRegistry: import('@/core/agent/AgentRegistry').AgentRegistry | null = null;
  private subAgentFactory: import('@/core/agent/SubAgentFactory').SubAgentFactory | null = null;
  private providerManager: import('@/core/providers/ProviderManager').ProviderManager | null = null;
  private intentRouter: import('@/core/intent').IntentRouter | null = null;
  private config: AppConfig | null = null;
  private provider: ILLMProvider | null = null;
  /** 基础工具注册表（全量工具，用于注册） */
  private baseRegistry: ToolRegistry | null = null;
  /** 生效工具注册表（可能是 DynamicToolFilter 包装器，用于 AgentLoop） */
  private registry: IToolRegistry | null = null;
  /** 工具 Schema 优化器（简化工具描述） */
  private toolSchemaOptimizer: import('@/core/tools/ToolSchemaOptimizer').ToolSchemaOptimizer | null = null;
  private sessionManager: SessionManager;
  private checkpointManager: CheckpointManager;
  private hookRegistry: HookRegistry;
  private pricingResolver: PricingResolver | null = null;
  private _taskTool: import('@/core/tools/TaskTool').TaskTool | null = null;
  private _teamTool: import('@/core/tools/TeamTool').TeamTool | null = null;
  /** 任务路由服务 */
  private taskRouterService: TaskRouterService | null = null;
  /** 记忆服务 */
  private memoryService: MemoryService;
  /** 系统诊断服务 */
  private systemDiagnostics: SystemDiagnostics;
  private skillRouter: SkillRouter | null = null;
  private promptOrchestrator: PromptOrchestrator | null = null;
  private turnLifecycleManager: TurnLifecycleManager | null = null;
  private initialized = false;
  private options: ChatSessionOptions;
  /** 会话轮次计数（用于自动保存） */
  private turnCount = 0;
  /** ignore filter 初始化 Promise（用于在 init() 中 await） */
  private _ignoreFilterPromise: Promise<void> | null = null;
  /** 缓存 MemoryManager 类引用，避免重复 dynamic import */
  private _MemoryManagerClass: (typeof import('@/memory'))['MemoryManager'] | null = null;
  /** 会话回调 */
  private sessionCallbacks?: SessionCallbacks;

  constructor(options: ChatSessionOptions = {}) {
    this.options = options;
    this.sessionCallbacks = options.callbacks;
    this.sessionManager = new SessionManager();
    this.checkpointManager = new CheckpointManager(this.sessionManager.getStorage());
    this.hookRegistry = new HookRegistry();
    this.memoryService = new MemoryService();
    this.systemDiagnostics = new SystemDiagnostics();
  }

  /**
   * 初始化会话 (加载配置、创建 Provider 和 AgentLoop)
   * 必须在 run() 之前调用
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // 使用 SessionInitializer 进行初始化
    const initializer = new SessionInitializer({
      model: this.options.model,
      provider: this.options.provider,
      registry: this.options.registry,
      config: this.options.config,
    });

    const initResult = await initializer.initialize();

    // 设置初始化结果
    this.config = initResult.config;
    this.provider = initResult.provider;
    this.baseRegistry = initResult.baseRegistry;
    this.registry = initResult.registry;
    this.permissionController = initResult.permissionController;
    this.skillRegistry = initResult.skillRegistry;
    this.memoryManager = initResult.memoryManager;
    this.reminderEngine = initResult.reminderEngine;
    this.reminderContext = initResult.reminderContext;
    this.proactiveButler = initResult.proactiveButler;
    this.mcpManager = initResult.mcpManager;
    this.templateRepo = initResult.templateRepo;
    this._MemoryManagerClass = initResult._MemoryManagerClass;
    this.providerManager = initResult.providerManager;

    // 🆕 重建 SessionManager（注入配置、Provider、MemoryManager）
    this.sessionManager = new SessionManager({
      sessionConfig: this.config.session,
      provider: this.provider,
      providerConfig: this.config.provider,
      memoryManager: this.memoryManager || undefined,
    });
    this.checkpointManager = new CheckpointManager(this.sessionManager.getStorage());

    // 设置运行时配置（供工具模块读取）
    const { setRuntimeConfig } = await import('@/core/config/RuntimeConfig');
    setRuntimeConfig(this.config);

    // 初始化 Agent Registry（用于管理 Agent Profile）— 必须在 TaskTool 之前初始化
    try {
      const { AgentRegistry } = await import('@/core/agent/AgentRegistry');
      this.agentRegistry = new AgentRegistry();
      await this.agentRegistry.init();

      log.info('🤖 Agent Registry initialized');
    } catch (err) {
      log.warn('Agent Registry init failed:', err);
    }

    // 初始化 Task Tool（依赖 agentRegistry）
    await this.initTaskTool();

    // 初始化 SubAgentFactory（统一子代理创建入口）
    if (this.agentRegistry && this.providerManager) {
      try {
        const { SubAgentFactory } = await import('@/core/agent/SubAgentFactory');
        this.subAgentFactory = new SubAgentFactory(
          this.agentRegistry,
          this.providerManager,
          this.baseRegistry!,
          this.hookRegistry,
          this.memoryManager,
          this.provider,  // 传递主 agent 的 provider
          this.config.provider,  // 🔧 传递主 agent 的 provider 配置
        );
        log.info('🏭 SubAgentFactory initialized');
      } catch (err) {
        log.warn('SubAgentFactory init failed:', err);
      }
    }

    // 3.0 新增：注入 SubAgentFactory 到 MemoryManager
    if (this.subAgentFactory && this.memoryManager) {
      this.memoryManager.setSubAgentFactory(this.subAgentFactory);
      log.info('🧠 Memory 3.0 features enabled');

      // 记录用户活动（用于做梦调度）
      const dreamScheduler = this.memoryManager.getDreamScheduler();
      if (dreamScheduler) {
        dreamScheduler.recordActivity();
      }
    }

    // 包装为 DynamicToolFilter（场景感知工具过滤）
    const { DynamicToolFilter } = await import('@/core/tools/DynamicToolFilter');
    this.registry = new DynamicToolFilter(this.baseRegistry!);

    // 如果启用 Schema 优化，初始化 ToolSchemaOptimizer
    const schemaMode = this.config.tools?.schemaMode;
    if (schemaMode && schemaMode !== 'detailed') {
      const { ToolSchemaOptimizer } = await import('@/core/tools/ToolSchemaOptimizer');
      this.toolSchemaOptimizer = new ToolSchemaOptimizer(schemaMode);
      log.debug(`ToolSchemaOptimizer enabled with mode: ${schemaMode}`);

      // 包装 registry.getSchemas() 方法
      const originalGetSchemas = this.registry!.getSchemas.bind(this.registry!);
      this.registry!.getSchemas = () => {
        const schemas = originalGetSchemas();
        return this.toolSchemaOptimizer!.simplifyBatch(schemas);
      };
    }

    // 构建 System Prompt
    const systemPrompt = this.skillRegistry
      ? await initializer.buildSystemPrompt(this.skillRegistry, this.registry!, this.config)
      : undefined;

    // 创建 AgentLoop
    this.agentLoop = initializer.createAgentLoop(
      this.provider!,
      this.registry!,
      this.config,
      systemPrompt,
      this.memoryManager
    );

    // 初始化动态定价
    this.pricingResolver = new PricingResolver(
      this.config.pricing,
      this.config.provider.baseURL,
    );
    this.pricingResolver.init().catch((err) => {
      log.debug('PricingResolver init failed:', err);
    });
    this.agentLoop.setPricingResolver(this.pricingResolver);

    // 注入 TaskTool 依赖
    // ⚠️ 已废弃：TaskTool 依赖在 initTaskTool() 中已经设置，无需重复注入
    // initTaskTool() 使用新架构（providerManager + agentRegistry），
    // 而 injectTaskToolDeps() 使用旧架构（provider + lightProvider），会导致冲突
    /*
    if (!this.agentRegistry) {
      throw new Error('AgentRegistry not initialized before injecting TaskTool dependencies');
    }
    if (!this.providerManager) {
      throw new Error('ProviderManager not initialized before injecting TaskTool dependencies');
    }

    initializer.injectTaskToolDeps(
      this._taskTool,
      this.provider!,
      this.lightProvider!,
      this.registry!,
      this.config,
      systemPrompt,
      this.hookRegistry,
      this.memoryManager,
      this.providerManager,
      this.agentRegistry
    );
    */

    // 初始化 Hook 系统
    await initializer.initHookSystem(
      this.hookRegistry,
      this.agentLoop,
      this.checkpointManager,
      this.provider!,
      this.config,
      this.memoryManager,
      this._MemoryManagerClass
    );

    // 初始化 IntentRouter（意图路由系统）
    if (this.config.features?.intentRouter && this.agentRegistry) {
      try {
        const { IntentRouter } = await import('@/core/intent');
        this.intentRouter = new IntentRouter(this.agentRegistry, this.config.provider);

        // 将 SkillRegistry 中有 intentMeta 的 skill 注册到 IntentRouter
        if (this.skillRegistry) {
          const skillsWithIntent = this.skillRegistry.list().filter(
            (s): s is typeof s & { intentMeta: NonNullable<typeof s.intentMeta> } =>
              s.intentMeta != null && s.moduleType === 'skill'
          );
          if (skillsWithIntent.length > 0) {
            this.intentRouter.registerExternalModules(skillsWithIntent as any);
            log.debug(`IntentRouter: 注册 ${skillsWithIntent.length} 个 skill 模块`);
          }
        }

        this.intentRouter.init().catch(err => {
          log.warn('IntentRouter init failed:', err);
          this.intentRouter = null;
        });
        log.info('🎯 IntentRouter initialized (async)');
      } catch (err) {
        log.warn('IntentRouter init failed:', err);
      }
    }

    // 初始化 TaskRouterService（任务分解系统）
    try {
      this.taskRouterService = new TaskRouterService({
        provider: this.provider!,
        registry: this.registry!,
        config: this.config,
        subAgentFactory: this.subAgentFactory ?? undefined,
      });
      log.info('🎯 TaskRouterService initialized');
    } catch (err) {
      log.warn('TaskRouterService init failed:', err);
    }

    // 初始化 MemoryService
    if (this.memoryManager) {
      this.memoryService.setMemoryManager(this.memoryManager as import('@/memory/MemoryManager').MemoryManager);
    }
    if (this.subAgentFactory && this.memoryManager && this._MemoryManagerClass && this.memoryManager instanceof this._MemoryManagerClass) {
      this.memoryService.initMemoryFlushAgent({
        subAgentFactory: this.subAgentFactory,
      });
    }

    this.initialized = true;

    // 初始化 SkillRouter（Skill 路由器）
    if (this.intentRouter && this.skillRegistry && this.agentLoop) {
      const mmInstance = (this._MemoryManagerClass && this.memoryManager instanceof this._MemoryManagerClass)
        ? this.memoryManager as import('@/memory/MemoryManager').MemoryManager
        : undefined;
      this.skillRouter = new SkillRouter(
        this.agentLoop,
        this.skillRegistry,
        this.intentRouter,
        this.sessionCallbacks,
        () => { this.turnCount++; this.turnLifecycleManager?.afterTurn(this.turnCount).catch(err => log.warn('Auto-save failed:', err)); },
        mmInstance,
      );
    }

    // 初始化 PromptOrchestrator（Prompt 编排器）
    if (this.agentLoop && this.registry) {
      this.promptOrchestrator = new PromptOrchestrator(
        this.config!,
        this.agentLoop,
        this.registry,
        () => this.reminderContext,
        this.sessionCallbacks?.onBootThinking,
      );
      // 注入 MemoryManager，启用 DecisionContext 注入
      if (this._MemoryManagerClass && this.memoryManager instanceof this._MemoryManagerClass) {
        this.promptOrchestrator.setMemoryManager(
          this.memoryManager as import('@/memory/MemoryManager').MemoryManager,
        );
      }

      // 注入 PromptBuilder 到 SubAgentFactory（用于子 Agent 统一 prompt 构建）
      if (this.subAgentFactory) {
        try {
          const { LayeredPromptBuilder } = await import('@/core/prompt');
          const builder = new LayeredPromptBuilder();
          await builder.init();
          this.subAgentFactory.setPromptBuilder(builder);
          log.info('✓ PromptBuilder injected into SubAgentFactory');
        } catch (err) {
          log.warn('Failed to inject PromptBuilder into SubAgentFactory:', err);
        }
      }
    }

    // 初始化 TurnLifecycleManager（轮次生命周期管理器）
    if (this.agentLoop) {
      this.turnLifecycleManager = new TurnLifecycleManager(
        this.agentLoop,
        this.sessionManager,
        this.config!,
        () => this.sessionCallbacks,
      );
    }

    // 恢复会话上下文
    // 规则：记忆始终加载，会话上下文仅在文件非空时加载（即上次未被记忆化）
    // onboarding 未完成时跳过恢复：避免旧对话历史污染新用户引导流程
    if (this.sessionManager && this.config.session && this.config.onboardingDone !== false) {
      try {
        const resumeResult = await this.sessionManager.initialize();

        if (resumeResult.resumed && resumeResult.sessionId) {
          // 会话上下文非空 = 上次未被记忆化（异常退出），恢复到 AgentLoop + GUI
          const messagesToRestore = resumeResult.messages;
          if (messagesToRestore && messagesToRestore.length > 0) {
            if (this.agentLoop) {
              this.agentLoop.restoreMessages(messagesToRestore);
              // 消息本身已包含上下文，清除 boot guide suffix 避免冗余
              this.agentLoop.getMessageManager().setSystemPromptSuffix('', 'boot-guide');
              this.agentLoop.getMessageManager().setSystemPromptSuffix('', 'resumed-memories');
              log.info(`📂 Restored ${messagesToRestore.length} unflushed messages from session ${resumeResult.sessionId}`);
            }
            if (resumeResult.historyMessages && resumeResult.historyMessages.length > 0 && this.sessionCallbacks?.onMessagesRestored) {
              this.sessionCallbacks.onMessagesRestored(resumeResult.historyMessages);
            }
          } else {
            log.debug(`Session ${resumeResult.sessionId} was fully memorized, no messages to restore`);
          }
        }
      } catch (err) {
        log.warn('Failed to auto-resume session:', err);
      }
    }

    // 🔥 启动 ProactiveButler 后台服务
    if (this.proactiveButler && this.config.butler?.enabled) {
      try {
        await this.proactiveButler.startDaemon();
        log.info('✨ ProactiveButler 后台服务已启动');
      } catch (err) {
        log.warn('Failed to start ProactiveButler daemon:', err);
      }
    }

    // 触发 SessionStart Hook
    this.hookRegistry.emit('SessionStart', {
      sessionId: this.sessionManager.getActiveSessionId() ?? undefined,
    }).catch(() => {});
  }

  // ─── 保留的辅助初始化方法 ──────────────────────────────────

  /**
   * 初始化 Task 相关工具 (TaskTool, TeamTool)
   */
  private async initTaskTool(): Promise<void> {
    if (!this.baseRegistry) return;

    // 为 SubAgent 工具准备依赖
    if (this.providerManager && this.config) {
      const agentConfig = {
        model: this.config.provider.model,
        apiKey: this.config.provider.apiKey,
        baseURL: this.config.provider.baseURL,
        maxTokens: this.config.provider.maxTokens,
        temperature: this.config.provider.temperature,
        maxIterations: this.config.agent?.maxIterations,
      };

      let mainProvider: ILLMProvider;
      try {
        mainProvider = this.providerManager.getProvider();
      } catch {
        // 测试环境或 mock provider 场景：降级到已注入的 provider
        mainProvider = this.provider!;
      }

      // 依赖对象（TaskTool 用新架构，其他工具保持旧依赖）
      const deps = {
        provider: mainProvider,
        registry: this.baseRegistry as IToolRegistry,
        agentConfig,
        hookRegistry: this.hookRegistry,
        memoryStore: this.memoryManager,
        depth: 0,
      };

      // TaskTool - 使用新架构（需要 providerManager + agentRegistry）
      const { TaskTool } = await import('@/core/tools/TaskTool');
      const taskTool = new TaskTool();

      // 确保 agentRegistry 已初始化
      if (!this.agentRegistry) {
        throw new Error('AgentRegistry not initialized. Cannot register TaskTool.');
      }

      taskTool.setDependencies({
        providerManager: this.providerManager,
        agentRegistry: this.agentRegistry,
        registry: this.baseRegistry as IToolRegistry,
        agentConfig,
        parentProvider: mainProvider,
        hookRegistry: this.hookRegistry,
        memoryStore: this.memoryManager,
        depth: 0,
        agentId: 'main', // 🔧 主 Agent ID
      });
      this.baseRegistry.register(taskTool);
      this._taskTool = taskTool;

      // TeamTool
      const { TeamTool } = await import('@/core/tools/TeamTool');
      const teamTool = new TeamTool();

      // 确保 agentRegistry 已初始化
      if (!this.agentRegistry) {
        throw new Error('AgentRegistry not initialized. Cannot register TeamTool.');
      }

      teamTool.setDependencies({
        providerManager: this.providerManager,
        agentRegistry: this.agentRegistry,
        provider: mainProvider,
        registry: this.baseRegistry as IToolRegistry,
        agentConfig,
        hookRegistry: this.hookRegistry,
        memoryStore: this.memoryManager,
        depth: 0,
      });
      this.baseRegistry.register(teamTool);
      this._teamTool = teamTool;

      // ListAgentsTool + MatchAgentTool — 与 task/agent_team 一起注册，无需 feature flag
      // 主 Agent 需要用这两个工具查询预置 Agent，再决定调用 task/agent_team 时用哪个
      if (this.agentRegistry) {
        const { ListAgentsTool } = await import('@/core/tools/ListAgentsTool');
        const listAgentsTool = new ListAgentsTool();
        listAgentsTool.setAgentRegistry(this.agentRegistry);
        this.baseRegistry.register(listAgentsTool);

        const { MatchAgentTool } = await import('@/core/tools/MatchAgentTool');
        const matchAgentTool = new MatchAgentTool();
        matchAgentTool.setDependencies({ agentRegistry: this.agentRegistry });
        this.baseRegistry.register(matchAgentTool);
      }
    }
  }

  on(callbacks: AgentCallbacks): void {
    this.ensureInitialized();
    this.agentLoop!.on(callbacks);
  }

  /**
   * 移除回调（IM Bot 清理时调用）
   */
  removeListener(): void {
    if (this.agentLoop) {
      this.agentLoop.on({});
    }
  }

  /**
   * 运行一轮对话
   */
  async run(userMessage: string): Promise<void> {
    this.ensureInitialized();

    if (!this.config?.provider.apiKey) {
      throw new Error('❌ 未配置 API Key，请使用 /settings 命令配置');
    }

    // __startup__ 是内部触发信号，直接走 AgentLoop，跳过所有路由层
    // 同时把传给 LLM 的消息替换为空字符串，不让 LLM 看到这个内部标识
    if (userMessage === '__startup__') {
      await this.runSingleAgent('__startup__');
      return;
    }

    // ── 第一步：向量路由（零 LLM，纯规则） ──────────────────────────
    // IntentRouter 已就绪时，尝试直接路由到 Skill
    if (this.intentRouter?.isInitialized() && this.skillRegistry && this.skillRouter) {
      const skillExecuted = await this.skillRouter.tryRouteToSkill(userMessage);
      if (skillExecuted) return;
    }

    // ── 第二步：触发词路由（/plan 等 → 任务分解） ────────────────────
    if (this.taskRouterService && this.config.routing?.mode !== 'never') {
      let decision: import('@/core/routing/types').RoutingDecision | null = null;

      try {
        decision = await this.taskRouterService.route(userMessage, {
          sessionId: this.sessionManager.getActiveSessionId() ?? 'unknown',
          messageCount: this.agentLoop!.getMessageHistory().length,
          usedAgents: [],
          currentMode: 'direct',
        });

        log.info(`🎯 Routing decision: ${decision.mode} (reason: ${decision.reason})`);
      } catch (routeErr) {
        // 路由决策失败，降级到 direct 模式
        log.warn('Routing decision failed, fallback to direct mode:', routeErr);
      }

      // 如果决策成功且需要任务分解，执行 Planner（异常会向上抛出）
      if (decision && decision.mode === 'decompose') {
        await this.runWithPlanner(userMessage, decision);
        return;
      }
    }

    // ── 第三步：AgentLoop（LLM 自行决策工具/执行路径） ──────────────
    await this.runSingleAgent(userMessage);
  }

  private async runSingleAgent(userMessage: string): Promise<void> {
    // __startup__ 是内部触发信号，传给 LLM 时替换为自然的启动触发语
    // PromptOrchestrator 用原始 __startup__ 识别场景并注入对应指令
    const llmMessage = userMessage === '__startup__' ? '你好' : userMessage;
    const isStartup = userMessage === '__startup__';

    // 每次对话开始重建 system prompt（场景感知）
    // 注意：onBootThinking 回调现在在 PromptOrchestrator.buildAndApply() 中触发
    if (this.promptOrchestrator) {
      try {
        await this.promptOrchestrator.buildAndApply(userMessage);
      } catch (routeErr) {
        log.debug('Prompt build failed, using default prompt:', routeErr);
      }
    }

    // 检索相关记忆并动态注入到 system prompt
    await this.memoryService.injectMemories(llmMessage, this.agentLoop!);

    await this.agentLoop!.run(llmMessage);

    // 🆕 检查是否有待处理的追加消息（用户在 agent 总结时输入的新内容）
    // 如果有，立即触发新一轮对话，避免用户输入被忽略
    const pendingMessage = this.agentLoop!.consumePendingAppend();
    if (pendingMessage) {
      log.info(`⚡ Detected pending append message after run(), triggering new run() with: "${pendingMessage.slice(0, 50)}"`);
      // 递归调用 runSingleAgent，处理待处理的消息
      await this.runSingleAgent(pendingMessage);
      return; // 递归调用会处理后续逻辑，这里直接返回
    }

    // 如果是启动场景，触发 onBootGuide 回调（传递 LLM 生成的引导语）
    if (isStartup && this.sessionCallbacks?.onBootGuide) {
      const messages = this.agentLoop!.getMessageHistory();
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.role === 'assistant') {
        // 提取文本内容
        let guideText = '';
        if (Array.isArray(lastMessage.content)) {
          for (const block of lastMessage.content) {
            if (block.type === 'text') {
              guideText += block.text;
            }
          }
        } else if (typeof lastMessage.content === 'string') {
          guideText = lastMessage.content;
        }

        if (guideText) {
          log.info('🎉 Startup guide generated, triggering onBootGuide callback');
          this.sessionCallbacks.onBootGuide(guideText);
        }
      }
    }

    // 自动保存会话 + 消息淘汰 + 归档检查
    this.turnCount++;
    this.turnLifecycleManager?.afterTurn(this.turnCount).catch((err) => {
      log.warn('Turn lifecycle failed:', err instanceof Error ? err.message : String(err));
    });

    // 智能记忆刷新（OpenClaw 启发）
    await this.memoryService.checkAndFlushMemory(this.agentLoop!);
  }

  /**
   * 🆕 使用 TaskRouterService 执行任务分解
   */
  private async runWithPlanner(
    userMessage: string,
    decision: import('@/core/routing/types').RoutingDecision
  ): Promise<void> {
    log.info('🎯 Starting task decomposition...');

    try {
      // 使用 TaskRouterService 执行任务
      await this.taskRouterService!.executeWithPlanner(userMessage, decision);

      log.info(`🎉 Task executed successfully`);

      // 将执行完成消息注入到 AgentLoop 的历史中
      if (this.agentLoop) {
        this.agentLoop.getMessageManager().addAssistantMessage([
          { type: 'text', text: '任务分解执行完成' },
        ]);
      }

      // 5. 自动保存会话
      this.turnCount++;
      this.turnLifecycleManager?.afterTurn(this.turnCount).catch((err) => {
        log.warn('Turn lifecycle failed:', err instanceof Error ? err.message : String(err));
      });

      // 6. 消息淘汰检查（由 afterTurn 统一处理，此处不重复）
    } catch (err) {
      log.error('Task execution failed:', err);

      // 将错误消息添加到历史（用户可见）
      if (this.agentLoop) {
        this.agentLoop.getMessageManager().addAssistantMessage([
          { type: 'text', text: `❌ 任务执行失败: ${err instanceof Error ? err.message : String(err)}` },
        ]);
      }

      // 向上抛出异常，让调用者处理（显示错误通知）
      throw err;
    }
  }

  /**
   * 停止当前运行
   */
  stop(): void {
    this.agentLoop?.stop();
  }

  /**
   * 设置会话回调
   */
  setSessionCallbacks(callbacks: SessionCallbacks): void {
    this.sessionCallbacks = callbacks;
  }

  /**
   * 重置会话 (清空历史)
   */
  reset(): void {
    this.agentLoop?.reset();
  }

  /**
   * 重新初始化会话 (配置改变后调用)
   * 清空所有状态，重新加载配置并创建新的 Provider 和 AgentLoop
   */
  async reinitialize(newConfig?: AppConfig): Promise<void> {
    // 触发 SessionEnd Hook
    await this.hookRegistry.emit('SessionEnd', {
      sessionId: this.sessionManager.getActiveSessionId() ?? undefined,
    }).catch((err) => {
      log.warn('SessionEnd hook error:', err instanceof Error ? err.message : String(err));
    });

    // 关闭 MCP 连接
    if (this.mcpManager) {
      await this.mcpManager.shutdown();
      this.mcpManager = null;
    }

    // 关闭 MemoryManager 资源（VectorStore 数据库连接等）
    if (this.memoryManager && this._MemoryManagerClass && this.memoryManager instanceof this._MemoryManagerClass) {
      await (this.memoryManager as InstanceType<typeof this._MemoryManagerClass>).shutdown().catch((err: unknown) => {
        log.warn('MemoryManager shutdown error:', err instanceof Error ? err.message : String(err));
      });
    }

    // 清空当前状态
    this.agentLoop = null;
    this.skillRegistry = null;
    this.permissionController = null;
    this.memoryManager = null;
    this.reminderContext = null;
    this.pricingResolver = null;
    this.config = null;
    this.provider = null;
    this.registry = null;
    this.agentRegistry = null;
    this.subAgentFactory = null;
    this.providerManager = null;
    this.intentRouter = null;
    this.hookRegistry = new HookRegistry(); // 重建 HookRegistry，防止 handler 重复注册
    this.initialized = false;

    // 如果提供了新配置，更新选项
    if (newConfig) {
      this.options.config = newConfig;
    }

    // 重新初始化
    await this.init();
  }

  /**
   * 清理所有资源（退出时调用）
   *
   * 关闭 MCP 子进程、MemoryManager 数据库连接、
   * PersistentShell bash 进程等资源。
   */
  async cleanup(): Promise<void> {
    log.info('ChatSession cleanup started');

    if (this.agentLoop) {
      const messages = this.agentLoop.getMessageHistory();
      if (messages.length > 0) {
        const sessionId = this.sessionManager.getActiveSessionId() ?? undefined;
        const state = this.agentLoop.getState();
        const usageData = {
          input: state.tokenUsage.input,
          output: state.tokenUsage.output,
          cost: state.cost,
          cacheRead: state.tokenUsage.cacheRead,
          cacheWrite: state.tokenUsage.cacheWrite,
        };

        // ── 步骤 1：安全网 —— 快速保存完整上下文（跳过 summarizer LLM 调用） ──
        // 确保进程被杀前磁盘上至少有一份完整会话数据
        // 临时禁用 summarizer 以加快速度（cleanup 场景优先保证数据安全）
        const saveStartTime = Date.now();
        try {
          const originalConfig = this.sessionManager.getMemoryDrivenConfig();
          this.sessionManager.updateMemoryDrivenConfig({ generateSummaryOnSave: false });
          await this.sessionManager.save(messages as SessionMessage[], undefined, {
            usage: usageData,
          });
          this.sessionManager.updateMemoryDrivenConfig({ generateSummaryOnSave: originalConfig.generateSummaryOnSave });
          log.info(`Step 1: Session context saved as safety net (${Date.now() - saveStartTime}ms)`);
        } catch (err) {
          log.warn(`Step 1 failed (${Date.now() - saveStartTime}ms):`, err instanceof Error ? err.message : String(err));
        }

        // ── 步骤 2：记忆化 —— 通过 LLM 提取记忆（慢速） ──
        // 若进程在此期间被杀，步骤 1 的完整上下文已在磁盘上，
        // 下次启动时走「异常关闭 → 恢复上下文」路径
        const flushStartTime = Date.now();
        let flushed = false;
        try {
          log.info(`Step 2: Starting memory flush (${messages.length} messages)...`);
          const result = await this.memoryService.flushOnExit(
            messages as Message[],
            sessionId,
          );
          flushed = result.extractedMemories > 0;
          log.info(`Step 2: Memory flush completed (${Date.now() - flushStartTime}ms): ${result.extractedMemories} memories, ${result.extractedLessons} lessons`);
        } catch (err) {
          log.warn(`Step 2 failed (${Date.now() - flushStartTime}ms):`, err instanceof Error ? err.message : String(err));
        }

        // ── 步骤 3：记忆化成功 → 清空上下文（覆盖步骤 1 的安全网） ──
        // 下次启动时走「正常关闭 → 触发回忆」路径
        if (flushed) {
          try {
            await this.sessionManager.save([] as SessionMessage[], undefined, {
              usage: usageData,
              historyMessages: [],
            });
            log.info('Step 3: Session context cleared after successful memory flush');
          } catch (err) {
            log.warn('Step 3 failed:', err instanceof Error ? err.message : String(err));
          }
        } else {
          log.info('Step 3 skipped: memory flush did not extract memories, context preserved');
        }
      } else {
        log.info('No messages to save, skipping session save and memory flush');
      }
    }

    // 触发 SessionEnd Hook
    await this.hookRegistry.emit('SessionEnd', {
      sessionId: this.sessionManager.getActiveSessionId() ?? undefined,
    }).catch(() => {});

    // 关闭 MCP 连接
    if (this.mcpManager) {
      await this.mcpManager.shutdown().catch((err) => {
        log.warn('MCP shutdown error:', err instanceof Error ? err.message : String(err));
      });
    }

    // 关闭 MemoryManager 资源
    if (this.memoryManager && this._MemoryManagerClass && this.memoryManager instanceof this._MemoryManagerClass) {
      await (this.memoryManager as InstanceType<typeof this._MemoryManagerClass>).shutdown().catch((err: unknown) => {
        log.warn('MemoryManager shutdown error:', err instanceof Error ? err.message : String(err));
      });
    }

    // 停止 AgentLoop
    if (this.agentLoop) {
      this.agentLoop.stop();
    }

    if (this.agentRegistry) {
      // AgentRegistry 清理（停止文件监听）
      this.agentRegistry.dispose();
      this.agentRegistry = null;
    }

    // 清理 IntentRouter
    this.intentRouter = null;
    this.subAgentFactory = null;
    this.providerManager = null;

    // 关闭 PersistentShell（bash 子进程）
    try {
      const { closeSharedShell } = await import('@/core/tools/PersistentShell');
      closeSharedShell();
    } catch {
      // PersistentShell 未初始化时忽略
    }

    // 清理 TaskTool、TeamTool 引用
    this._taskTool = null;
    this._teamTool = null;

    // 清理后台任务管理器
    BackgroundTaskManager.resetInstance();

    // 清理 MemoryService 资源
    this.memoryService.dispose();

    log.info('ChatSession resources cleaned up');
  }

  /**
   * 获取当前状态
   */
  getState(): AgentState {
    this.ensureInitialized();
    return this.agentLoop!.getState();
  }

  /**
   * 获取 AgentLoop 实例 (高级用法)
   */
  getAgentLoop(): AgentLoop {
    this.ensureInitialized();
    return this.agentLoop!;
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<AppConfig> {
    if (!this.config) {
      throw new Error('ChatSession 尚未初始化，请先调用 init()');
    }
    return this.config;
  }

  /**
   * 获取 SkillRegistry 实例 (用于 CLI 命令和高级用法)
   */
  getSkillRegistry(): SkillRegistry {
    if (!this.skillRegistry) {
      throw new Error('ChatSession 尚未初始化或 Skill 系统未加载，请先调用 init()');
    }
    return this.skillRegistry;
  }

  /**
   * 获取权限控制器 (用于 UI 层注入确认处理器)
   */
  getPermissionController(): IPermissionController | null {
    return this.permissionController;
  }

  /**
   * 获取记忆管理器
   */
  getMemoryManager(): IMemoryStore | null {
    return this.memoryManager;
  }

  // ─── 会话持久化 API ──────────────────────────────────

  /**
   * 保存当前会话
   * @param name - 可选会话名称
   * @param options - 额外保存选项（usage、historyMessages 由 UI 层传入）
   * @returns 会话 ID
   */
  async saveSession(
    name?: string,
    options?: { usage?: SessionUsage; historyMessages?: HistoryMessage[] },
  ): Promise<string> {
    this.ensureInitialized();
    const messages = this.agentLoop!.getMessageHistory();

    // 如果 UI 层没有传入 usage，从 AgentLoop 状态中提取
    const state = this.agentLoop!.getState();
    const usage = options?.usage ?? {
      input: state.tokenUsage.input,
      output: state.tokenUsage.output,
      cost: state.cost,
      cacheRead: state.tokenUsage.cacheRead,
      cacheWrite: state.tokenUsage.cacheWrite,
    };

    return this.sessionManager.save(
      messages as SessionMessage[],
      name,
      { usage, historyMessages: options?.historyMessages },
    );
  }

  /**
   * 恢复已保存的会话
   * @returns 恢复的会话上下文（含 messages、usage、historyMessages）
   */
  async resumeSession(sessionId: string): Promise<ResumedSessionContext> {
    this.ensureInitialized();
    const context = await this.sessionManager.resume(sessionId);
    // 恢复消息历史到 AgentLoop
    this.agentLoop!.restoreMessages(context.messages as unknown as import('@/core/types').Message[]);
    // 恢复 TokenManager 和 CostTracker
    if (context.usage) {
      this.agentLoop!.getTokenManager().restoreUsage(context.usage);
      this.agentLoop!.getCostTracker().restore(context.usage.cost);
    }
    // 标记为已路由（恢复的会话不需要重新意图路由）
    return context;
  }

  /**
   * 列出所有已保存会话
   */
  async listSessions(): Promise<SessionListItem[]> {
    return this.sessionManager.list();
  }

  /**
   * 删除已保存会话
   */
  async deleteSession(sessionId: string): Promise<void> {
    return this.sessionManager.delete(sessionId);
  }

  /**
   * 创建 checkpoint
   * @returns checkpoint ID
   */
  async createCheckpoint(label?: string): Promise<string> {
    this.ensureInitialized();
    const sessionId = this.sessionManager.getActiveSessionId();
    if (!sessionId) {
      // 未保存过的会话，先自动保存
      await this.saveSession();
    }
    const activeId = this.sessionManager.getActiveSessionId()!;
    const messages = this.agentLoop!.getMessageHistory();
    return this.checkpointManager.create(activeId, messages as SessionMessage[], label);
  }

  /**
   * 回滚到指定 checkpoint
   * @returns 回滚后的消息数量
   */
  async rewindToCheckpoint(checkpointId: string): Promise<number> {
    this.ensureInitialized();
    const sessionId = this.sessionManager.getActiveSessionId();
    if (!sessionId) {
      throw new Error('当前没有活跃会话，无法回滚');
    }

    const messageCount = await this.checkpointManager.restore(sessionId, checkpointId);

    // 从存储重新加载消息并恢复到 AgentLoop
    const context = await this.sessionManager.resume(sessionId);
    this.agentLoop!.restoreMessages(context.messages as unknown as import('@/core/types').Message[]);

    return messageCount;
  }

  /**
   * 列出当前会话的 checkpoint
   */
  async listCheckpoints(): Promise<Checkpoint[]> {
    const sessionId = this.sessionManager.getActiveSessionId();
    if (!sessionId) return [];
    return this.checkpointManager.list(sessionId);
  }

  /**
   * 获取 SessionManager（高级用法）
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * 获取 HookRegistry（用于外部触发事件或查询配置）
   */
  getHookRegistry(): HookRegistry {
    return this.hookRegistry;
  }

  /**
   * 设置权限确认处理器 (由 UI 层调用)
   */
  setConfirmationHandler(handler: ConfirmationHandler): void {
    if (this.permissionController) {
      this.permissionController.setConfirmationHandler(handler);
    }
  }

  /**
   * 设置计划审查处理器 (由 UI 层调用)
   */
  setPlanReviewHandler(handler: PlanReviewHandler): void {
    if (this.permissionController) {
      this.permissionController.setPlanReviewHandler(handler);
    }
  }

  /**
   * 设置用户提问处理器 (由 UI 层调用)
   */
  setAskUserHandler(handler: AskUserHandler): void {
    if (this.baseRegistry) {
      const askUserTool = this.baseRegistry.get('ask_user');
      if (askUserTool && askUserTool instanceof AskUserTool) {
        (askUserTool as AskUserTool).setHandler(handler);
      }
    }
  }

  /**
   * 设置计划确认处理器 (由 UI 层调用)
   */
  setPlanConfirmHandler(handler: PlanConfirmHandler): void {
    this.onPlanConfirm = handler;
  }

  /**
   * 设置进入 Plan Mode 处理器 (由 UI 层调用)
   *
   * 包装逻辑：先切换 ToolRegistry 的 planMode 标志，再通知 UI 层。
   * 这样写操作拦截（ToolRegistry.execute 的 planMode 检查）可以立即生效。
   */
  setPlanModeEnterHandler(handler: PlanModeEnterHandler): void {
    if (this.baseRegistry) {
      const enterTool = this.baseRegistry.get('enter_plan_mode');
      if (enterTool && enterTool instanceof EnterPlanModeTool) {
        (enterTool as EnterPlanModeTool).setHandler(async () => {
          this.baseRegistry!.enterPlanMode();
          return handler();
        });
      }
    }
  }

  /**
   * 设置退出 Plan Mode 处理器 (由 UI 层调用)
   */
  setPlanModeExitHandler(handler: PlanModeExitHandler): void {
    if (this.baseRegistry) {
      const exitTool = this.baseRegistry.get('exit_plan_mode');
      if (exitTool && exitTool instanceof ExitPlanModeTool) {
        (exitTool as ExitPlanModeTool).setHandler(async () => {
          this.baseRegistry!.exitPlanMode();
          return handler();
        });
      }
    }
  }

  /**
   * 获取 Agent Registry（用于 IPC 接口）
   */
  getAgentRegistry(): import('@/core/agent/AgentRegistry').AgentRegistry | null {
    return this.agentRegistry;
  }

  /**
   * 获取基础工具注册表（用于 IPC 接口）
   */
  getBaseRegistry(): ToolRegistry | null {
    return this.baseRegistry;
  }

  /**
   * 获取 MCP Manager（用于 IPC 接口）
   */
  getMCPManager(): MCPManager | null {
    return this.mcpManager;
  }

  /**
   * 获取 TemplateRepo（用于 CLI 命令）
   */
  getTemplateRepo(): import('@/core/template').TemplateRepo | null {
    return this.templateRepo;
  }

  /**
   * 是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.agentLoop) {
      throw new Error('ChatSession 尚未初始化，请先调用 init()');
    }
  }

  // ============================================================
  // 系统诊断
  // ============================================================

  /**
   * 获取系统诊断信息（供 /doctor 命令使用）
   */
  async getDiagnostics(): Promise<string> {
    return this.systemDiagnostics.getDiagnostics({
      config: this.config!,
      mcpManager: this.mcpManager,
      skillRegistry: this.skillRegistry,
      memoryManager: this.memoryManager,
      permissionController: this.permissionController,
      initialized: this.initialized,
    });
  }
}
