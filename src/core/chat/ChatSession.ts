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
import { ConfigLoader } from '@/core/config/ConfigLoader';
import { ProviderFactory } from '@/core/providers/ProviderFactory';
import { createDefaultRegistry, ToolRegistry } from '@/core/tools/ToolRegistry';
import { AskUserTool, type AskUserHandler } from '@/core/tools/AskUserTool';
import { PermissionController } from '@/permission/PermissionController';
import type { IPermissionController, ConfirmationHandler, PlanReviewHandler } from '@/permission/types';
import type { SkillRegistry } from '@/core/skills';
import type { VectorSkillMatcher } from '@/core/skills/VectorSkillMatcher';
import type { IMemoryStore } from '@/memory/types';
import { DEFAULT_MEMORY_CONFIG } from '@/memory/types';
import { MCPManager } from '@/mcp/MCPManager';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ChatSession' });
import { MCPToolAdapter } from '@/mcp/MCPToolAdapter';
import { MCPSkillAdapter } from '@/mcp/MCPSkillAdapter';
import { createWebSearchTool } from '@/mcp/tools/WebSearchTool';
import { MemoryStoreTool } from '@/core/tools/MemoryStoreTool';
import { MemorySearchTool } from '@/core/tools/MemorySearchTool';
import { ReminderSetTool } from '@/core/tools/ReminderSetTool';
import { ReminderCheckTool } from '@/core/tools/ReminderCheckTool';
import { SessionManager } from '@/session/SessionManager';
import { CheckpointManager } from '@/session/CheckpointManager';
import type { SessionListItem, Checkpoint, Message as SessionMessage } from '@/session/types';
import { HookRegistry } from '@/hooks/HookRegistry';
import { HookConfigLoader } from '@/hooks/ConfigLoader';
import { PricingResolver } from '@/core/agent/PricingResolver';

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
  private vectorSkillMatcher: VectorSkillMatcher | null = null;
  private permissionController: IPermissionController | null = null;
  private memoryManager: IMemoryStore | null = null;
  private reminderContext: string | null = null;
  private mcpManager: MCPManager | null = null;
  private config: AppConfig | null = null;
  private provider: ILLMProvider | null = null;
  private registry: IToolRegistry | null = null;
  private sessionManager: SessionManager;
  private checkpointManager: CheckpointManager;
  private hookRegistry: HookRegistry;
  private pricingResolver: PricingResolver | null = null;
  private _taskTool: import('@/core/tools/TaskTool').TaskTool | null = null;
  private initialized = false;
  private options: ChatSessionOptions;
  /** 是否已完成首条消息的意图路由 */
  private intentRouted = false;
  /** 缓存 MemoryManager 类引用，避免重复 dynamic import */
  private _MemoryManagerClass: (typeof import('@/memory'))['MemoryManager'] | null = null;

  constructor(options: ChatSessionOptions = {}) {
    this.options = options;
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

    // 1. 加载配置 + Provider + ToolRegistry
    await this.initConfig();
    this.initProvider();
    this.initToolRegistry();

    // 设置运行时配置（供工具模块读取）
    const { setRuntimeConfig } = await import('@/core/config/RuntimeConfig');
    setRuntimeConfig(this.config!);

    // 2. 初始化 Skill 系统
    const skillRegistry = await this.initSkillSystem();

    // 3. 初始化记忆、提醒、MCP 等扩展子系统
    await this.initMemorySystem();
    this.initVectorSkillMatcherAsync(skillRegistry);
    await this.initReminderSystem();
    await this.initMCPSystem(skillRegistry);
    this.initWebSearch();
    await this.initTaskTool();

    // 4. 构建 System Prompt + 创建 AgentLoop
    const systemPrompt = await this.buildSystemPrompt(skillRegistry);
    this.createAgentLoop(systemPrompt);
    this.skillRegistry = skillRegistry;

    // 5. 注入 TaskTool 依赖 + Hook 系统
    this.injectTaskToolDeps(systemPrompt);
    await this.initHookSystem();

    this.initialized = true;

    // 触发 SessionStart Hook
    this.hookRegistry.emit('SessionStart', {
      sessionId: this.sessionManager.getActiveSessionId() ?? undefined,
    }).catch(() => {});
  }

  // ─── init() 子方法 ──────────────────────────────────

  private async initConfig(): Promise<void> {
    if (this.options.config) {
      this.config = this.options.config;
    } else {
      const configLoader = new ConfigLoader();
      this.config = await configLoader.load();
    }
    if (this.options.model) {
      this.config.provider.model = this.options.model;
    }
    if (!this.config.provider.apiKey) {
      throw new Error('未找到 API Key，请设置环境变量 XUANJI_API_KEY');
    }
  }

  private initProvider(): void {
    if (this.options.provider) {
      this.provider = this.options.provider;
      return;
    }
    const providerFactory = new ProviderFactory();
    let provider: ILLMProvider | undefined;
    if (this.config!.provider.adapter) {
      provider = providerFactory.getByAdapter(this.config!.provider.adapter);
    }
    if (!provider) {
      provider = providerFactory.getByModel(this.config!.provider.model);
    }
    if (!provider) {
      throw new Error(`不支持的模型: ${this.config!.provider.model}`);
    }
    this.provider = provider;
  }

  private initToolRegistry(): void {
    this.registry = this.options.registry ?? createDefaultRegistry();
    const permissionConfig = this.config!.tools.permissions;
    this.permissionController = new PermissionController(permissionConfig);
    if (this.registry instanceof ToolRegistry) {
      this.registry.setPermissionController(this.permissionController);
    }
  }

  private async initSkillSystem(): Promise<InstanceType<typeof import('@/core/skills').SkillRegistry>> {
    const { SkillRegistry, SkillLoader, initializeBuiltinSkills } = await import(
      '@/core/skills'
    );
    const skillRegistry = new SkillRegistry();
    initializeBuiltinSkills(skillRegistry);

    const skillsConfig = this.config!.skills;
    if (skillsConfig?.loadCustom && skillsConfig.customPath) {
      const loader = new SkillLoader(skillRegistry);
      await loader.load({
        loadBuiltin: false,
        loadCustom: true,
        customPath: skillsConfig.customPath,
      });
    }
    return skillRegistry;
  }

  private async initMemorySystem(): Promise<void> {
    const memoryConfig = this.config!.memory ?? DEFAULT_MEMORY_CONFIG;
    if (!memoryConfig.enabled) return;

    try {
      const memoryModule = await import('@/memory');
      const { MemoryManager } = memoryModule;
      this._MemoryManagerClass = MemoryManager;
      this.memoryManager = new MemoryManager(memoryConfig, process.cwd());
      await this.memoryManager.init();

      // 注册记忆工具
      if (this.registry instanceof ToolRegistry) {
        const memoryStoreTool = new MemoryStoreTool();
        const memorySearchTool = new MemorySearchTool();
        memoryStoreTool.setMemoryManager(this.memoryManager);
        memorySearchTool.setMemoryManager(this.memoryManager);
        this.registry.register(memoryStoreTool);
        this.registry.register(memorySearchTool);
      }

      // 初始化 SmartMemoryExtractor
      if (this.provider && this.memoryManager instanceof MemoryManager) {
        try {
          const { SmartMemoryExtractor } = await import('@/memory');
          const smartExtractor = new SmartMemoryExtractor(
            this.provider,
            this.config!.provider,
            memoryConfig,
            process.cwd(),
          );
          const mm = this.memoryManager as InstanceType<typeof MemoryManager>;
          mm.setSmartExtractor(smartExtractor);
          mm.setProvider(this.provider, this.config!.provider);
        } catch (err) {
          log.warn('SmartMemoryExtractor init failed:', err);
        }
      }
    } catch {
      this.memoryManager = null;
    }
  }

  private initVectorSkillMatcherAsync(skillRegistry: SkillRegistry): void {
    if (this.memoryManager) {
      this.initVectorSkillMatcher(skillRegistry).catch((err) => {
        log.warn('VectorSkillMatcher init failed:', err);
      });
    }
  }

  private async initReminderSystem(): Promise<void> {
    try {
      const { ReminderEngine } = await import('@/reminder');
      const reminderEngine = new ReminderEngine();
      await reminderEngine.init();

      // 注册提醒工具
      if (this.registry instanceof ToolRegistry) {
        const reminderSetTool = new ReminderSetTool();
        const reminderCheckTool = new ReminderCheckTool();
        reminderSetTool.setReminderEngine(reminderEngine);
        reminderCheckTool.setReminderEngine(reminderEngine);
        this.registry.register(reminderSetTool);
        this.registry.register(reminderCheckTool);
      }

      // 启动时检查提醒
      const context = await reminderEngine.checkOnStartup();

      // 检查关系维护
      if (this.memoryManager) {
        try {
          const relationshipMemories = await this.memoryManager.retrieve('relationship', {
            maxResults: 50,
            types: ['relationship'],
          });
          if (relationshipMemories.length > 0) {
            context.neglectedRelationships = await reminderEngine.checkNeglectedRelationships(
              undefined,
              relationshipMemories,
            );
          }
        } catch (relErr) {
          log.debug('Failed to check neglected relationships:', relErr);
        }
      }

      const reminderPrompt = reminderEngine.formatForPrompt(context);
      if (reminderPrompt) {
        this.reminderContext = reminderPrompt;
      }
    } catch (err) {
      log.warn('Reminder system init failed:', err);
    }
  }

  private async initMCPSystem(skillRegistry: SkillRegistry): Promise<void> {
    if (!this.config!.mcp || this.config!.mcp.servers.length === 0) return;

    try {
      this.mcpManager = MCPManager.getInstance();
      await this.mcpManager.initialize(this.config!.mcp);

      const mcpTools = await this.mcpManager.getAllTools();
      if (this.registry instanceof ToolRegistry) {
        for (const { serverName, tool } of mcpTools) {
          this.registry.register(new MCPToolAdapter(serverName, tool));
        }
      }

      const mcpPrompts = await this.mcpManager.getAllPrompts();
      for (const { serverName, prompt } of mcpPrompts) {
        skillRegistry.register(new MCPSkillAdapter(serverName, prompt));
      }
    } catch (error) {
      log.warn('Failed to initialize MCP:', error);
      this.mcpManager = null;
    }
  }

  private initWebSearch(): void {
    const webSearchTool = createWebSearchTool(this.config!.webSearch);
    if (webSearchTool && this.registry instanceof ToolRegistry) {
      this.registry.register(webSearchTool);
    }
  }

  private async initTaskTool(): Promise<void> {
    if (this.registry instanceof ToolRegistry) {
      const { TaskTool } = await import('@/core/tools/TaskTool');
      const taskTool = new TaskTool();
      this.registry.register(taskTool);
      this._taskTool = taskTool;
    }
  }

  private async buildSystemPrompt(skillRegistry: SkillRegistry): Promise<string | undefined> {
    const skillsConfig = this.config!.skills;
    const enabledIds = skillsConfig?.enabled ?? [];
    let systemPrompt: string | undefined = undefined;

    if (enabledIds.length > 0) {
      const promptSkillIds = enabledIds.filter((id) => {
        const skill = skillRegistry.get(id);
        return skill && skill.category === 'prompt' && (skill.enabled ?? true);
      });
      if (promptSkillIds.length > 0) {
        systemPrompt = await skillRegistry.composeBatch(promptSkillIds, {
          params: {
            toolList: this.registry!.getSchemas(),
            language: this.config!.ui.language ?? 'zh',
          },
        });
      }
    }

    // 追加提醒上下文
    if (this.reminderContext && systemPrompt) {
      systemPrompt = systemPrompt + '\n\n' + this.reminderContext;
    } else if (this.reminderContext) {
      systemPrompt = this.reminderContext;
    }

    return systemPrompt;
  }

  private createAgentLoop(systemPrompt: string | undefined): void {
    this.agentLoop = new AgentLoop(this.provider!, this.registry!, {
      model: this.config!.provider.model,
      apiKey: this.config!.provider.apiKey,
      baseURL: this.config!.provider.baseURL,
      maxTokens: this.config!.provider.maxTokens,
      temperature: this.config!.provider.temperature,
      systemPrompt,
    }, this.memoryManager ?? undefined);

    // 初始化动态定价
    this.pricingResolver = new PricingResolver(
      this.config!.pricing,
      this.config!.provider.baseURL,
    );
    this.pricingResolver.init().catch((err) => {
      log.debug('PricingResolver init failed:', err);
    });
    this.agentLoop.setPricingResolver(this.pricingResolver);
  }

  private injectTaskToolDeps(systemPrompt: string | undefined): void {
    if (!this._taskTool || !this.provider || !this.registry) return;
    this._taskTool.setDependencies({
      provider: this.provider,
      registry: this.registry,
      agentConfig: {
        model: this.config!.provider.model,
        apiKey: this.config!.provider.apiKey,
        baseURL: this.config!.provider.baseURL,
        maxTokens: this.config!.provider.maxTokens,
        temperature: this.config!.provider.temperature,
        systemPrompt,
      },
      hookRegistry: this.hookRegistry,
      memoryStore: this.memoryManager,
    });
  }

  private async initHookSystem(): Promise<void> {
    try {
      const hookConfigLoader = new HookConfigLoader();
      const hookConfig = await hookConfigLoader.load();
      this.hookRegistry.loadConfig(hookConfig);

      this.hookRegistry.setPromptInjector((content) => {
        if (this.agentLoop) {
          this.agentLoop.getMessageManager().setSystemPromptSuffix(content, 'hook');
        }
      });

      this.agentLoop!.setHookRegistry(this.hookRegistry);
      this.checkpointManager.setHookRegistry(this.hookRegistry);

      if (this.provider) {
        this.hookRegistry.setAgentHandlerDeps({
          provider: this.provider,
          providerConfig: {
            model: this.config!.provider.model,
            apiKey: this.config!.provider.apiKey,
            baseURL: this.config!.provider.baseURL,
            maxTokens: this.config!.provider.maxTokens,
            temperature: this.config!.provider.temperature,
          },
        });
      }

      if (this.memoryManager && this._MemoryManagerClass) {
        if (this.memoryManager instanceof this._MemoryManagerClass) {
          (this.memoryManager as InstanceType<typeof this._MemoryManagerClass>).setHookRegistry(this.hookRegistry);
        }
      }
    } catch (err) {
      log.warn('Hook system init failed:', err);
    }
  }

  /**
   * 注册回调
   */
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

    // 首条消息：基于意图动态过滤 Skill，重建 system prompt
    if (!this.intentRouted && this.skillRegistry && this.config) {
      this.intentRouted = true;
      try {
        const skillsConfig = this.config.skills;
        const enabledIds = skillsConfig?.enabled ?? [];

        // 优先使用向量匹配，降级到正则匹配
        let filteredIds: string[];
        if (this.vectorSkillMatcher?.isInitialized()) {
          filteredIds = await this.vectorSkillMatcher.matchSkills(enabledIds, userMessage);
        } else {
          filteredIds = this.skillRegistry.filterByIntent(enabledIds, userMessage);
        }

        // 如果意图过滤后 Skill 列表有变化，重新渲染 system prompt
        if (filteredIds.length < enabledIds.length) {
          const promptSkillIds = filteredIds.filter((id) => {
            const skill = this.skillRegistry!.get(id);
            return skill && skill.category === 'prompt' && (skill.enabled ?? true);
          });

          if (promptSkillIds.length > 0) {
            let systemPrompt = await this.skillRegistry.composeBatch(promptSkillIds, {
              params: {
                toolList: this.registry!.getSchemas(),
                language: this.config.ui.language ?? 'zh',
              },
            });

            if (this.reminderContext) {
              systemPrompt = systemPrompt + '\n\n' + this.reminderContext;
            }

            this.agentLoop!.getMessageManager().setSystemPrompt(systemPrompt);
          }
        }
      } catch (routeErr) {
        log.debug('Intent routing failed, using full system prompt:', routeErr);
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
          // 本轮无相关记忆，清除上一轮的 memory suffix
          this.agentLoop!.getMessageManager().setSystemPromptSuffix('', 'memory');
        }
      } catch (memErr) {
        log.debug('Memory retrieval failed:', memErr);
      }
    }

    await this.agentLoop!.run(userMessage);
  }

  /**
   * 停止当前运行
   */
  stop(): void {
    this.agentLoop?.stop();
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
    this.vectorSkillMatcher = null;
    this.permissionController = null;
    this.memoryManager = null;
    this.reminderContext = null;
    this.pricingResolver = null;
    this.config = null;
    this.provider = null;
    this.registry = null;
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

    // 关闭 PersistentShell（bash 子进程）
    try {
      const { closeSharedShell } = await import('@/core/tools/PersistentShell');
      closeSharedShell();
    } catch {
      // PersistentShell 未初始化时忽略
    }

    // 清理 TaskTool 引用
    this._taskTool = null;

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
   * @returns 会话 ID
   */
  async saveSession(name?: string): Promise<string> {
    this.ensureInitialized();
    const messages = this.agentLoop!.getMessageHistory();
    return this.sessionManager.save(messages as SessionMessage[], name);
  }

  /**
   * 恢复已保存的会话
   */
  async resumeSession(sessionId: string): Promise<number> {
    this.ensureInitialized();
    const messages = await this.sessionManager.resume(sessionId);
    // 恢复消息历史到 AgentLoop
    this.agentLoop!.restoreMessages(messages as unknown as import('@/core/types').Message[]);
    // 标记为已路由（恢复的会话不需要重新意图路由）
    this.intentRouted = true;
    return messages.length;
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
    const messages = await this.sessionManager.resume(sessionId);
    this.agentLoop!.restoreMessages(messages as unknown as import('@/core/types').Message[]);

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
    if (this.registry instanceof ToolRegistry) {
      const askUserTool = this.registry.get('ask_user');
      if (askUserTool && askUserTool instanceof AskUserTool) {
        (askUserTool as AskUserTool).setHandler(handler);
      }
    }
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

  /**
   * 异步初始化 VectorSkillMatcher（不阻塞启动）
   */
  private async initVectorSkillMatcher(skillRegistry: SkillRegistry): Promise<void> {
    if (!this._MemoryManagerClass) return;
    if (!(this.memoryManager instanceof this._MemoryManagerClass)) return;

    const mm = this.memoryManager as InstanceType<typeof this._MemoryManagerClass>;

    // 等待向量系统就绪（通过 Promise，不再轮询）
    const ready = await mm.waitForVectorReady();
    if (!ready) return;

    const embeddingService = mm.getEmbeddingService();
    const vectorStore = mm.getVectorStore();
    if (!embeddingService || !vectorStore) return;

    const { VectorSkillMatcher } = await import('@/core/skills/VectorSkillMatcher');
    this.vectorSkillMatcher = new VectorSkillMatcher(embeddingService, vectorStore);
    await this.vectorSkillMatcher.init(skillRegistry);
  }
}
