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
} from '@/core/types';
import { AgentLoop, type AgentCallbacks } from '@/core/agent/AgentLoop';
import { ToolRegistry } from '@/core/tools/ToolRegistry';
import { AskUserTool, type AskUserHandler } from '@/core/tools/AskUserTool';
import type { IPermissionController, ConfirmationHandler, PlanReviewHandler } from '@/permission/types';
import type { SkillRegistry } from '@/core/skills';
import type { IMemoryStore } from '@/memory/types';
import { MCPManager } from '@/mcp/MCPManager';
import { logger } from '@/core/logger';
import { SessionInitializer, type InitOptions } from './SessionInitializer';
import { generateDiagnostics, type DiagnosticsContext } from './SessionDiagnostics';
import { SessionManager } from '@/session/SessionManager';
import { CheckpointManager } from '@/session/CheckpointManager';
import type { SessionListItem, Checkpoint, Message as SessionMessage, SessionUsage, HistoryMessage, ResumedSessionContext } from '@/session/types';
import { HookRegistry } from '@/hooks/HookRegistry';
import { PricingResolver } from '@/core/agent/PricingResolver';
import { BackgroundTaskManager } from '@/core/tools/BackgroundTaskManager';

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
  /** 恢复上次对话通知 */
  onResumeNotification?: (summary: string, memoryCount: number) => void;

  /** 自动归档通知 */
  onArchiveNotification?: (result: {
    archivedCount: number;
    memoriesExtracted: number;
    summary?: string;
  }) => void;
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
  /** 会话回调 */
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
  private taskRouter: import('@/core/routing').TaskRouter | null = null;
  private planner: import('@/core/planner').Planner | null = null;
  private executor: import('@/core/executor').Executor | null = null;
  private onPlanConfirm: PlanConfirmHandler | null = null;
  private agentRegistry: import('@/core/agent/AgentRegistry').AgentRegistry | null = null;
  private providerManager: import('@/core/providers/ProviderManager').ProviderManager | null = null;
  private intentRouter: import('@/core/intent').IntentRouter | null = null;
  private config: AppConfig | null = null;
  private provider: ILLMProvider | null = null;
  /** 轻量 Provider（用于压缩、子代理等低复杂度任务） */
  private lightProvider: ILLMProvider | null = null;
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
  private _quickTeamTool: import('@/core/tools/QuickTeamTool').QuickTeamTool | null = null;
  private initialized = false;
  private options: ChatSessionOptions;
  /** 是否已完成首条消息的意图路由 */
  private intentRouted = false;
  /** 会话轮次计数（用于自动保存） */
  private turnCount = 0;
  /** ignore filter 初始化 Promise（用于在 init() 中 await） */
  private _ignoreFilterPromise: Promise<void> | null = null;
  /** 缓存 MemoryManager 类引用，避免重复 dynamic import */
  private _MemoryManagerClass: (typeof import('@/memory'))['MemoryManager'] | null = null;
  /** 上次记忆刷新时间（用于 IntelligentMemoryFlush 触发条件） */
  private lastFlushTime: number = Date.now();
  /** 会话回调 */
  private sessionCallbacks?: SessionCallbacks;

  constructor(options: ChatSessionOptions = {}) {
    this.options = options;
    this.sessionCallbacks = options.callbacks;
    this.sessionManager = new SessionManager();
    this.checkpointManager = new CheckpointManager(this.sessionManager.getStorage());
    this.hookRegistry = new HookRegistry();
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
    this.lightProvider = initResult.lightProvider;
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

    // 初始化 Task Tool
    await this.initTaskTool();

    // 初始化 Agent Registry（用于管理 Agent Profile）— 提前到 DynamicToolFilter 之前
    try {
      const { AgentRegistry } = await import('@/core/agent/AgentRegistry');
      this.agentRegistry = new AgentRegistry();
      await this.agentRegistry.init();

      log.info('🤖 Agent Registry initialized');
    } catch (err) {
      log.warn('Agent Registry init failed:', err);
    }

    // 初始化 Multi-Agent 工具（条件：features.multiAgentTools）
    await this.initMultiAgentTools();

    // 如果启用动态工具加载，包装为 DynamicToolFilter
    if (this.config.features?.dynamicToolLoading) {
      const { DynamicToolFilter } = await import('@/core/tools/DynamicToolFilter');
      const filter = new DynamicToolFilter(this.baseRegistry!);
      this.registry = filter;
      log.debug('DynamicToolFilter enabled');
    }

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
    initializer.injectTaskToolDeps(
      this._taskTool,
      this.provider!,
      this.registry!,
      this.config,
      systemPrompt,
      this.hookRegistry,
      this.memoryManager
    );

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
        this.intentRouter.init().catch(err => {
          log.warn('IntentRouter init failed:', err);
          this.intentRouter = null;
        });
        log.info('🎯 IntentRouter initialized (async)');
      } catch (err) {
        log.warn('IntentRouter init failed:', err);
      }
    }

    // 初始化 TaskRouter, Planner, Executor（任务分解系统）
    try {
      const { TaskRouter, DEFAULT_ROUTING_CONFIG } = await import('@/core/routing/TaskRouter');
      const { Planner } = await import('@/core/planner/Planner');
      const { Executor } = await import('@/core/executor/Executor');

      // 创建 TaskRouter（用于路由决策）
      const routingConfig = this.config.routing || DEFAULT_ROUTING_CONFIG;
      this.taskRouter = new TaskRouter(routingConfig, this.provider!);

      // 创建 Planner（用于任务规划）
      this.planner = new Planner(
        this.provider!,
        this.config.planner,
      );

      // 创建 Executor（用于任务执行）
      // 构建 AgentConfig（用于 Worker Agent）
      const agentConfig = {
        model: this.config.provider.model,
        apiKey: this.config.provider.apiKey,
        baseURL: this.config.provider.baseURL,
        maxTokens: this.config.provider.maxTokens,
        temperature: this.config.provider.temperature,
        // systemPrompt 由 SubAgentLoop 动态构建
        maxIterations: this.config.agent?.maxIterations,
      };

      this.executor = new Executor(
        this.provider!,
        this.lightProvider!,
        this.registry!,
        agentConfig,
        this.config.executor,
      );

      log.info('🎯 TaskRouter, Planner, Executor initialized');
    } catch (err) {
      log.warn('Task decomposition system init failed:', err);
    }

    this.initialized = true;

    // 🆕 尝试恢复上一次对话（连续会话模式）
    console.log('[ChatSession] Checking auto-resume...', {
      hasSessionManager: !!this.sessionManager,
      hasSessionConfig: !!this.config.session,
    });

    if (this.sessionManager && this.config.session) {
      try {
        console.log('[ChatSession] Calling SessionManager.initialize()...');
        const resumeResult = await this.sessionManager.initialize();
        console.log('[ChatSession] SessionManager.initialize() result:', resumeResult);

        if (resumeResult.resumed && resumeResult.sessionId) {
          console.log(`[ChatSession] 📂 Auto-resumed session ${resumeResult.sessionId}`);
          log.info(`📂 Auto-resumed session ${resumeResult.sessionId}`);

          // 注入恢复的记忆到 system prompt
          if (resumeResult.memories && resumeResult.memories.length > 0 && this.agentLoop) {
            if (this._MemoryManagerClass && this.memoryManager instanceof this._MemoryManagerClass) {
              const memoryPrompt = (this.memoryManager as InstanceType<typeof this._MemoryManagerClass>).formatForPrompt(resumeResult.memories);
              // 通过 MessageManager 注入 system prompt suffix
              this.agentLoop.getMessageManager().setSystemPromptSuffix(memoryPrompt, 'resumed-memories');
              log.debug(`Injected ${resumeResult.memories.length} memories to system prompt`);
            }
          }

          // 显示恢复提示（通过 callbacks.onResumeNotification）
          console.log('[ChatSession] Checking notification callback...', {
            showNotification: this.config.session?.showResumeNotification,
            hasCallback: !!this.sessionCallbacks?.onResumeNotification,
          });

          if (this.config.session?.showResumeNotification && this.sessionCallbacks?.onResumeNotification) {
            console.log('[ChatSession] Calling onResumeNotification...');
            this.sessionCallbacks.onResumeNotification(
              resumeResult.summary || '继续上次对话...',
              resumeResult.memories?.length || 0
            );
          }
        } else {
          console.log('[ChatSession] No session to resume');
        }
      } catch (err) {
        console.error('[ChatSession] Failed to auto-resume session:', err);
        log.warn('Failed to auto-resume session:', err);
      }
    } else {
      console.log('[ChatSession] Auto-resume skipped (no SessionManager or config)');
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
   * 初始化 Task 相关工具 (TaskTool, TeamTool, QuickTeamTool)
   */
  private async initTaskTool(): Promise<void> {
    if (!this.baseRegistry) return;

    const { TaskTool } = await import('@/core/tools/TaskTool');
    const taskTool = new TaskTool();
    this.baseRegistry.register(taskTool);
    this._taskTool = taskTool;

    const { TeamTool } = await import('@/core/tools/TeamTool');
    const teamTool = new TeamTool();
    this.baseRegistry.register(teamTool);
    this._teamTool = teamTool;

    const { QuickTeamTool } = await import('@/core/tools/QuickTeamTool');
    const quickTeamTool = new QuickTeamTool();
    this.baseRegistry.register(quickTeamTool);
    this._quickTeamTool = quickTeamTool;
  }

  /**
   * 初始化 Multi-Agent 工具（条件：features.multiAgentTools）
   */
  private async initMultiAgentTools(): Promise<void> {
    if (!this.config?.features?.multiAgentTools) return;
    if (!this.agentRegistry || !this.providerManager || !this.baseRegistry) return;

    const agentConfig = {
      model: this.config.provider.model,
      apiKey: this.config.provider.apiKey,
      baseURL: this.config.provider.baseURL,
      maxTokens: this.config.provider.maxTokens,
      temperature: this.config.provider.temperature,
      maxIterations: this.config.agent?.maxIterations,
    };

    const deps = {
      providerManager: this.providerManager,
      agentRegistry: this.agentRegistry,
      registry: this.baseRegistry as IToolRegistry,
      agentConfig,
      hookRegistry: this.hookRegistry,
      memoryStore: this.memoryManager,
    };

    try {
      // DelegateTool
      const { DelegateTool } = await import('@/core/tools/DelegateTool');
      const delegateTool = new DelegateTool();
      delegateTool.setDependencies(deps);
      this.baseRegistry.register(delegateTool);

      // ListAgentsTool
      const { ListAgentsTool } = await import('@/core/tools/ListAgentsTool');
      const listAgentsTool = new ListAgentsTool();
      listAgentsTool.setAgentRegistry(this.agentRegistry);
      this.baseRegistry.register(listAgentsTool);

      // MatchAgentTool
      const { MatchAgentTool } = await import('@/core/tools/MatchAgentTool');
      const matchAgentTool = new MatchAgentTool();
      matchAgentTool.setDependencies({ agentRegistry: this.agentRegistry });
      this.baseRegistry.register(matchAgentTool);

      // OrchestrateTool
      const { OrchestrateTool } = await import('@/core/tools/OrchestrateTool');
      const orchestrateTool = new OrchestrateTool();
      orchestrateTool.setDependencies(deps);
      this.baseRegistry.register(orchestrateTool);

      // PipelineTool
      const { PipelineTool } = await import('@/core/tools/PipelineTool');
      const pipelineTool = new PipelineTool();
      pipelineTool.setDependencies(deps);
      this.baseRegistry.register(pipelineTool);

      log.info('🤖 Multi-Agent tools registered (5 tools)');
    } catch (err) {
      log.warn('Multi-Agent tools init failed:', err);
    }
  }

  /**
   * 初始化 Hook 系统（内部方法）
   */
  private async initHookSystemInternal(): Promise<void> {
    try {
      await new SessionInitializer({}).initHookSystem(
        this.hookRegistry,
        this.agentLoop,
        this.checkpointManager,
        this.provider!,
        this.config!,
        this.memoryManager,
        this._MemoryManagerClass,
      );
    } catch (err) {
      log.warn('Hook system init failed:', err);
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

    // ✅ 运行时检查 API Key（允许无 Key 启动，但调用时必须配置）
    if (!this.config?.provider.apiKey) {
      throw new Error('❌ 未配置 API Key，请使用 /settings 命令配置');
    }

    // 🆕 任务路由决策（如果 TaskRouter 可用）
    if (this.taskRouter && this.config.routing?.mode !== 'never') {
      try {
        const decision = await this.taskRouter.route(userMessage, {
          sessionId: this.sessionManager.getActiveSessionId() ?? 'unknown',
          messageCount: this.agentLoop!.getMessageHistory().length,
          usedAgents: [],
          currentMode: 'direct',
        });

        log.info(`🎯 Routing decision: ${decision.mode} (reason: ${decision.reason})`);

        // decompose 模式：任务分解执行
        if (decision.mode === 'decompose') {
          await this.runWithPlanner(userMessage, decision);
          return;
        }

        // direct 模式：继续执行 runSingleAgent
      } catch (routeErr) {
        log.warn('Routing failed, fallback to direct mode:', routeErr);
      }
    }

    // 单 Agent 模式（统一执行路径）
    await this.runSingleAgent(userMessage);
  }

  private async runSingleAgent(userMessage: string): Promise<void> {
    // 首条消息：基于意图动态选择场景，重建 system prompt
    if (!this.intentRouted && this.config) {
      this.intentRouted = true;
      try {
        await this.routeWithLayeredPrompt(userMessage);
      } catch (routeErr) {
        log.debug('Intent routing failed, using default prompt:', routeErr);
      }
    }

    // 检索相关记忆并动态注入到 system prompt
    if (this.memoryManager) {
      try {
        const memories = await this.memoryManager.retrieve(userMessage, {
          maxResults: 10,
          minConfidence: 0.3,
        });
        if (memories.length > 0 && this._MemoryManagerClass && this.memoryManager instanceof this._MemoryManagerClass) {
          const memorySummary = (this.memoryManager as InstanceType<typeof this._MemoryManagerClass>).formatForPrompt(memories);
          this.agentLoop!.getMessageManager().setSystemPromptSuffix(memorySummary, 'memory');
        } else {
          this.agentLoop!.getMessageManager().setSystemPromptSuffix('', 'memory');
        }
      } catch (memErr) {
        log.debug('Memory retrieval failed:', memErr);
      }
    }

    await this.agentLoop!.run(userMessage);

    // 自动保存会话
    this.turnCount++;
    // 连续会话模式下，自动保存已被归档机制取代
    // 但为了兼容性，仍然在每轮后保存（用于中途退出恢复）
    this.autoSaveAfterTurn().catch((err) => {
      log.warn('Auto-save failed:', err instanceof Error ? err.message : String(err));
    });

    // 智能记忆刷新（OpenClaw 启发）
    await this.checkAndFlushMemory();

    // 消息淘汰检查
    await this.evictIfNeeded();

    // 🆕 连续会话归档检查
    await this.checkAndArchive();
  }

  /**
   * 新路由：使用 LayeredPromptBuilder + IntentAnalyzer
   */
  private async routeWithLayeredPrompt(userMessage: string): Promise<void> {
    const { LayeredPromptBuilder } = await import('@/core/prompt');

    // 创建 builder（内置 IntentAnalyzer）
    const builder = new LayeredPromptBuilder();

    // 尝试初始化 Embedding（不阻塞）
    try {
      const { EmbeddingService } = await import('@/embedding/EmbeddingService');
      const embeddingService = EmbeddingService.getInstance();
      if (embeddingService.isReady()) {
        builder.getIntentAnalyzer().constructor.prototype.embeddingService = embeddingService;
      }
    } catch (err) {
      log.debug('Embedding service not available, using keyword-only matching:', err);
    }

    await builder.init();

    // 构建 prompt（自动分析意图）
    const result = await builder.build({
      userMessage,
      language: this.config!.ui.language ?? 'zh',
      toolList: this.registry!.getSchemas(),
    });

    log.info(
      `Intent analysis: scene=${result.scene}, complexity=${result.complexity}, ` +
      `components=${result.components.length}, tokens~${result.estimatedTokens}`,
    );

    // 更新工具过滤器（基于场景）
    if (this.config!.features?.dynamicToolLoading && this.registry) {
      const { DynamicToolFilter } = await import('@/core/tools/DynamicToolFilter');
      if (this.registry instanceof DynamicToolFilter) {
        if (result.scene) {
          this.registry.setScene(result.scene, result.requiredTools);
          log.info(`Scene routing: ${result.scene} → ${this.registry.getSchemas().length} tools`);
        }
      }
    }

    // 设置 thinking 配置
    if (result.thinking) {
      this.agentLoop!.setThinking(result.thinking);
      log.info(
        `Extended Thinking: ${result.thinking.type}` +
        `${result.thinking.type === 'adaptive' ? `, effort=${result.thinking.effort}` : ''}`,
      );
    } else {
      this.agentLoop!.setThinking(this.config!.provider.thinking);
    }

    // 更新 system prompt
    let finalPrompt = result.prompt;
    if (this.reminderContext) {
      finalPrompt = finalPrompt + '\n\n' + this.reminderContext;
    }
    this.agentLoop!.getMessageManager().setSystemPrompt(finalPrompt);
  }

  /**
   * 🆕 使用 Planner + Executor 执行任务分解
   */
  private async runWithPlanner(
    userMessage: string,
    decision: import('@/core/routing/types').RoutingDecision
  ): Promise<void> {
    if (!this.planner || !this.executor) {
      throw new Error('Planner or Executor not initialized');
    }

    log.info('🎯 Starting task decomposition...');

    // 1. 生成执行计划
    const plan = await this.planner.plan({
      userInput: userMessage,
      complexity: decision.complexity!,
      availableAgents: this.agentRegistry ? this.agentRegistry.getAllIds() : [],
    });

    log.info(`📋 Generated plan: ${plan.steps.length} steps`);

    // 2. 如果配置要求确认计划，调用 UI 回调
    if (this.config?.planner?.requireConfirmation && this.onPlanConfirm) {
      log.info('⏸️  Waiting for user confirmation...');
      const confirmed = await this.onPlanConfirm(plan);
      if (!confirmed) {
        log.info('❌ Plan rejected by user');
        // 将拒绝消息添加到历史
        if (this.agentLoop) {
          this.agentLoop.getMessageManager().addAssistantMessage([
            { type: 'text', text: '已取消任务执行。' },
          ]);
        }
        return;
      }
      log.info('✅ Plan confirmed by user');
    }

    // 3. 执行计划
    const result = await this.executor.execute(plan, {
      onSubTaskStart: (order, description) => {
        log.debug(`📌 SubTask ${order} started: ${description}`);
        // TODO: 通过回调更新 UI 进度
      },
      onSubTaskComplete: (taskResult) => {
        const status = taskResult.status === 'success' ? '✅' : taskResult.status === 'failed' ? '❌' : '⏭️';
        log.debug(`${status} SubTask ${taskResult.order} completed`);
        // TODO: 通过回调更新 UI 进度
      },
      onProgress: (current, total) => {
        log.debug(`📊 Progress: ${current}/${total}`);
        // TODO: 通过回调更新 UI 进度
      },
    });

    log.info(`🎉 Plan executed: ${result.status} (${result.subTaskResults.length} tasks)`);

    // 4. 将执行结果注入到 AgentLoop 的历史中（作为 assistant 消息）
    if (this.agentLoop) {
      this.agentLoop.getMessageManager().addAssistantMessage([
        { type: 'text', text: result.summary },
      ]);
    }

    // 5. 自动保存会话
    this.turnCount++;
    // 连续会话模式下，自动保存作为备份机制
    this.autoSaveAfterTurn().catch((err) => {
      log.warn('Auto-save failed:', err instanceof Error ? err.message : String(err));
    });

    // 6. 消息淘汰检查
    await this.evictIfNeeded();
  }

  /**
   * 停止当前运行
   */
  stop(): void {
    this.agentLoop?.stop();
  }

  /**
   * 自动保存当前会话（每轮对话后调用）
   *
   * 连续会话模式下，用于中途退出恢复，不再作为主要的持久化机制
   */
  private async autoSaveAfterTurn(): Promise<void> {
    if (!this.agentLoop) return;

    const messages = this.agentLoop.getMessageHistory();
    if (messages.length === 0) return;

    // 连续会话模式：每轮都保存（作为备份机制）
    const state = this.agentLoop.getState();
    // 从 LLM 消息中提取 UI 可展示的历史消息
    const historyMessages = this.extractHistoryMessages(messages as SessionMessage[]);
    await this.sessionManager.save(messages as SessionMessage[], undefined, {
      usage: {
        input: state.tokenUsage.input,
        output: state.tokenUsage.output,
        cost: state.cost,
        cacheRead: state.tokenUsage.cacheRead,
        cacheWrite: state.tokenUsage.cacheWrite,
      },
      historyMessages,
    });
    log.debug(`Auto-saved session (turn ${this.turnCount})`);
  }

  /**
   * 从 LLM 消息历史中提取 UI 可展示的历史消息
   * 只保留 user 和 assistant 的文本内容
   */
  /**
   * 从 LLM 消息历史中提取 UI 可展示的历史消息
   * 只保留 user 和 assistant 的文本内容
   */
  private extractHistoryMessages(messages: SessionMessage[]): HistoryMessage[] {
    try {
      const result: HistoryMessage[] = [];

      for (const msg of messages) {
        if (msg.role !== 'user' && msg.role !== 'assistant') continue;

        let text = '';
        if (typeof msg.content === 'string') {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          // ContentBlock[] — 提取文本块（过滤掉 thinking 等其他类型）
          const textBlocks = msg.content.filter((block: any) => block.type === 'text' && block.text);
          text = textBlocks.map((block: any) => block.text).join('\n');
        }

        if (!text.trim()) continue;

        result.push({
          role: msg.role as 'user' | 'assistant',
          content: text,
          timestamp: Date.now(),
        });
      }

      return result;
    } catch (error) {
      log.error('Extract history messages failed:', error instanceof Error ? error.message : String(error));
      return []; // 返回空数组而不是抛出异常
    }
  }

  /**
   * 智能记忆刷新（OpenClaw 启发 + LLM 价值评估）
   *
   * 触发条件：
   * - 上下文超过 75%
   * - 距上次刷新超过 30 分钟
   *
   * 执行流程：
   * 1. 调用 IntelligentMemoryFlush.checkAndFlush()
   * 2. LLM 评估对话价值
   * 3. 分类归档（topic / timeline / discard）
   * 4. 清理消息历史（保留最近 N 条）
   * 5. 更新 lastFlushTime
   */
  private async checkAndFlushMemory(): Promise<void> {
    if (!this.memoryManager || !this._MemoryManagerClass || !(this.memoryManager instanceof this._MemoryManagerClass)) {
      return;
    }

    // 检查配置是否启用智能刷新
    const flushConfig = this.config?.memory?.intelligentFlush;
    if (flushConfig && flushConfig.enabled === false) {
      return;
    }

    try {
      const memoryManager = this.memoryManager as InstanceType<typeof this._MemoryManagerClass>;
      const intelligentFlush = memoryManager.getIntelligentFlush();

      if (!intelligentFlush || !this.agentLoop) {
        return;
      }

      const messages = this.agentLoop.getMessageHistory();
      const currentTokens = this.estimateTokens(messages);
      const maxTokens = this.config?.provider.maxTokens || 200000;
      const timeSinceLastFlush = Date.now() - this.lastFlushTime;
      const sessionId = this.sessionManager.getActiveSessionId() ?? undefined;

      const context = {
        messages: messages as import('@/core/types').Message[],
        currentTokens,
        maxTokens,
        timeSinceLastFlush,
        sessionId,
      };

      const flushed = await intelligentFlush.checkAndFlush(context);

      if (flushed) {
        this.lastFlushTime = Date.now();
        log.info('Memory flushed successfully', {
          currentTokens,
          maxTokens,
          timeSinceLastFlush: Math.round(timeSinceLastFlush / 60000) + ' min',
        });
      }
    } catch (err) {
      log.warn('Failed to check and flush memory:', err);
    }
  }

  /**
   * 估算当前消息的 token 数量
   *
   * 简单实现：字符数 / N（可配置）
   * 更精确的实现可以使用 tiktoken 库
   */
  private estimateTokens(messages: any[]): number {
    let totalChars = 0;

    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.text) {
            totalChars += block.text.length;
          }
          if (block.thinking) {
            totalChars += block.thinking.length;
          }
        }
      }
    }

    // 从配置读取 charsPerToken 比例（默认 3）
    const charsPerToken = this.config?.memory?.tokenEstimation?.charsPerToken ?? 3;
    return Math.ceil(totalChars / charsPerToken);
  }

  /**
   * 从 timeline 记忆中提取主题（OpenClaw 启发）
   *
   * 通常在会话结束、保存或淘汰时调用，
   * 自动从今天的 timeline 记忆中提取可复用的 topic 记忆。
   *
   * @param dayKey 可选，指定要提取的日期（默认今天）
   */
  private async extractTopicsFromTimeline(dayKey?: string): Promise<void> {
    if (!this.memoryManager || !this._MemoryManagerClass || !(this.memoryManager instanceof this._MemoryManagerClass)) {
      return;
    }

    // 检查配置是否启用主题提取
    const topicConfig = this.config?.memory?.topicExtraction;
    if (topicConfig && topicConfig.enabled === false) {
      return;
    }

    try {
      const memoryManager = this.memoryManager as InstanceType<typeof this._MemoryManagerClass>;
      const topics = await memoryManager.extractTopics(dayKey);

      if (topics.length > 0) {
        log.info(`Extracted ${topics.length} topics from timeline memories`);
      }
    } catch (err) {
      log.warn('Failed to extract topics from timeline:', err);
    }
  }

  /**
   * 消息淘汰检查：达到上限时归档当前会话并创建新的空会话
   *
   * 流程:
   * 1. 检查消息数是否达到 maxMessages 上限
   * 2. 调用 agentLoop.compact() 生成当前会话的 LLM 压缩摘要
   * 3. 保存当前完整会话到 SessionManager（归档）
   * 4. 重置 AgentLoop（清空消息历史 + token/费用计数）
   * 5. 将压缩摘要作为 system prompt 后缀注入新会话（上下文延续）
   * 6. 重置轮次计数，断开旧会话 ID 关联
   */
  private async evictIfNeeded(): Promise<void> {
    if (!this.agentLoop) return;

    const maxMessages = this.config?.session?.maxMessages ?? 100;
    if (maxMessages <= 0) return; // 0 = 不限制

    const messages = this.agentLoop.getMessageHistory();
    if (messages.length < maxMessages) return;

    log.info(`Message eviction triggered: ${messages.length} messages >= limit ${maxMessages}`);

    try {
      // 1. 生成压缩摘要（复用已有的 LLM 语义压缩）
      let summary = '';
      try {
        const compactResult = await this.agentLoop.compact();
        if (compactResult && compactResult.summary) {
          // compact() 会修改 MessageManager 内部状态，取压缩后的摘要
          // 但我们需要的是完整摘要文本而非压缩后的消息，所以用原始消息重新生成
          summary = compactResult.summary;
        }
      } catch (compactErr) {
        log.debug('Compact failed during eviction, proceeding without summary:', compactErr);
      }

      // 如果 compact 未产出有效摘要，构造一个简单摘要
      if (!summary) {
        const userMessages = messages
          .filter(m => m.role === 'user' && typeof m.content === 'string')
          .slice(-3)
          .map(m => (m.content as string).slice(0, 100));
        summary = `[上一个会话包含 ${messages.length} 条消息]\n主要话题: ${userMessages.join('; ')}`;
      }

      // 2. 保存当前会话（确保归档完整）
      const state = this.agentLoop.getState();
      const fullMessages = this.agentLoop.getMessageHistory();
      await this.sessionManager.save(fullMessages as SessionMessage[], undefined, {
        usage: {
          input: state.tokenUsage.input,
          output: state.tokenUsage.output,
          cost: state.cost,
          cacheRead: state.tokenUsage.cacheRead,
          cacheWrite: state.tokenUsage.cacheWrite,
        },
      });
      log.debug('Eviction: archived current session');

      // 2.5. 从 timeline 记忆中提取主题（OpenClaw 启发）
      await this.extractTopicsFromTimeline().catch((extractErr) => {
        log.debug('Topic extraction failed during eviction:', extractErr);
      });

      // 3. 重置 AgentLoop（清空消息、token 计数、费用）
      this.agentLoop.reset();
      this.agentLoop.getTokenManager().reset();
      this.agentLoop.getCostTracker().restore(0);

      // 4. 断开旧会话关联（下次保存时生成新 session ID）
      this.sessionManager.setActiveSessionId(null);

      // 5. 将压缩摘要注入新会话的 system prompt 后缀（保持上下文延续）
      this.agentLoop.getMessageManager().setSystemPromptSuffix(
        `### Previous Session Context\n\n${summary}`,
        'previous-session',
      );

      // 6. 重置轮次计数
      this.turnCount = 0;
      this.intentRouted = true; // 新会话不需要重新意图路由

      log.info('Message eviction complete: started new session with context summary');
    } catch (err) {
      log.warn('Message eviction failed:', err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * 检查并执行归档（连续会话模式）
   */
  private async checkAndArchive(): Promise<void> {
    if (!this.agentLoop || !this.sessionManager || !this.config?.session) {
      return;
    }

    const messageCount = this.agentLoop.getMessageHistory().length;
    const state = this.agentLoop.getState();
    const tokenCount = state.tokenUsage.input + state.tokenUsage.output;

    // 检查是否需要归档
    if (!this.sessionManager.shouldArchive(messageCount, tokenCount)) {
      return;
    }

    log.info('📦 Archive condition met, archiving in background...');

    // 异步归档（不阻塞用户）
    this.archiveInBackground(messageCount).catch((err) => {
      log.warn('Background archive failed:', err instanceof Error ? err.message : String(err));
    });
  }

  /**
   * 后台归档流程
   */
  private async archiveInBackground(currentMessageIndex: number): Promise<void> {
    if (!this.agentLoop || !this.sessionManager || !this.config?.session) {
      return;
    }

    try {
      const messages = this.agentLoop.getMessageHistory();

      const result = await this.sessionManager.archive(
        messages as SessionMessage[],
        currentMessageIndex
      );

      log.info(
        `✓ Archived ${result.archivedCount} messages, ` +
        `extracted ${result.memoriesExtracted} memories`
      );

      // 截断 AgentLoop 中的旧消息（保留最近的）
      const keepCount = this.config.session.archiveStrategy?.keepRecentMessages ?? 10;
      const keptMessages = messages.slice(-keepCount);

      // 使用 replaceMessages 替换消息历史
      this.agentLoop.getMessageManager().replaceMessages(keptMessages);

      log.debug(`Kept recent ${keepCount} messages after archive`);

      // 通知用户归档完成
      if (this.sessionCallbacks?.onArchiveNotification) {
        this.sessionCallbacks.onArchiveNotification(result);
      }
    } catch (err) {
      log.warn('Archive failed:', err instanceof Error ? err.message : String(err));
    }
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
    this.intentRouted = false;
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
    this.intentRouted = false;
    this.config = null;
    this.provider = null;
    this.registry = null;
    this.agentRegistry = null;
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
    // ✨ 退出时最终保存会话（连续模式：始终保存）
    if (this.agentLoop) {
      const messages = this.agentLoop.getMessageHistory();
      if (messages.length > 0) {
        try {
          const state = this.agentLoop.getState();
          const historyMessages = this.extractHistoryMessages(messages as SessionMessage[]);
          await this.sessionManager.save(messages as SessionMessage[], undefined, {
            usage: {
              input: state.tokenUsage.input,
              output: state.tokenUsage.output,
              cost: state.cost,
              cacheRead: state.tokenUsage.cacheRead,
              cacheWrite: state.tokenUsage.cacheWrite,
            },
            historyMessages,
          });
          log.debug('Final session save on cleanup');
        } catch (err) {
          log.warn('Final session save failed:', err instanceof Error ? err.message : String(err));
        }
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
    this.providerManager = null;

    // 关闭 PersistentShell（bash 子进程）
    try {
      const { closeSharedShell } = await import('@/core/tools/PersistentShell');
      closeSharedShell();
    } catch {
      // PersistentShell 未初始化时忽略
    }

    // 清理 TaskTool、TeamTool 和 QuickTeamTool 引用
    this._taskTool = null;
    this._teamTool = null;
    this._quickTeamTool = null;

    // 清理后台任务管理器
    BackgroundTaskManager.resetInstance();

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
    this.intentRouted = true;
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
    return generateDiagnostics({
      config: this.config!,
      mcpManager: this.mcpManager,
      skillRegistry: this.skillRegistry,
      memoryManager: this.memoryManager,
      permissionController: this.permissionController,
      initialized: this.initialized,
    });
  }
}
