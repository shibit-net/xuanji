// ============================================================
// SessionInitializer — ChatSession 初始化逻辑封装
// ============================================================
//
// 将 ChatSession 的各种 init 方法抽取到独立模块，
// 减少主类复杂度，提升可维护性。

import type {
  AppConfig,
  ILLMProvider,
  IToolRegistry,
} from '@/core/types';
import { ConfigLoader } from '@/core/config/ConfigLoader';
import { ProviderFactory } from '@/core/providers/ProviderFactory';
import { createDefaultRegistry, ToolRegistry } from '@/core/tools/ToolRegistry';
import { PermissionController } from '@/permission/PermissionController';
import type { IPermissionController } from '@/permission/types';
import type { SkillRegistry } from '@/core/skills';
import type { IMemoryStore } from '@/memory/types';
import { DEFAULT_MEMORY_CONFIG } from '@/memory/types';
import { MCPManager } from '@/mcp/MCPManager';
import { logger } from '@/core/logger';
import { MCPToolAdapter } from '@/mcp/MCPToolAdapter';
import { createEnhancedWebSearchTool } from '@/mcp/search';
import { MemoryStoreTool } from '@/core/tools/MemoryStoreTool';
import { MemorySearchTool } from '@/core/tools/MemorySearchTool';
import { RetrieveMemoryTool } from '@/core/tools/RetrieveMemoryTool';
import { ReminderSetTool } from '@/core/tools/ReminderSetTool';
import { ReminderCheckTool } from '@/core/tools/ReminderCheckTool';
import { HookRegistry } from '@/hooks/HookRegistry';
import { HookConfigLoader } from '@/hooks/ConfigLoader';
import { AgentLoop } from '@/core/agent/AgentLoop';

const log = logger.child({ module: 'SessionInitializer' });

/**
 * 初始化选项
 */
export interface InitOptions {
  model?: string;
  provider?: ILLMProvider;
  registry?: IToolRegistry;
  config?: AppConfig;
}

/**
 * 初始化结果
 */
export interface InitResult {
  config: AppConfig;
  provider: ILLMProvider;
  baseRegistry: ToolRegistry;
  registry: IToolRegistry;
  permissionController: IPermissionController;
  skillRegistry: SkillRegistry | null;
  memoryManager: IMemoryStore | null;
  reminderEngine: import('@/reminder').IReminderEngine | null;
  reminderContext: string | null;
  proactiveButler: import('@/butler').IProactiveButler | null;
  mcpManager: MCPManager | null;
  templateRepo: import('@/core/template').TemplateRepo | null;
  providerManager: import('@/core/providers/ProviderManager').ProviderManager | null;
  _MemoryManagerClass: (typeof import('@/memory'))['MemoryManager'] | null;
}

/**
 * SessionInitializer — 封装所有 ChatSession 的初始化逻辑
 */
export class SessionInitializer {
  private options: InitOptions;

  constructor(options: InitOptions = {}) {
    this.options = options;
  }

  /**
   * 执行完整初始化流程
   */
  async initialize(): Promise<InitResult> {
    // 0. 尝试加载 xuanji agent 配置（如果存在，将作为主配置源）
    let xuanjiAgent: import('@/core/agent/types').ConfigurableAgentConfig | null = null;
    try {
      const { AgentRegistry } = await import('@/core/agent/AgentRegistry');
      const agentRegistry = new AgentRegistry();
      await agentRegistry.init();
      const agent = agentRegistry.get('xuanji');
      xuanjiAgent = agent || null;
      if (xuanjiAgent) {
        log.info('🔧 Using xuanji agent configuration');
      }
    } catch (err) {
      log.debug('Failed to load xuanji agent config:', err);
    }

    // 1. 加载配置（如果有 xuanji agent 配置，将合并其配置）
    const config = await this.initConfig(xuanjiAgent);

    // 2. 初始化 Provider
    const provider = this.initProvider(config);

    // 2.5 创建 ProviderManager（用于 Multi-Agent 工具）
    let providerManager: import('@/core/providers/ProviderManager').ProviderManager | null = null;
    try {
      const { ProviderManager } = await import('@/core/providers/ProviderManager');
      providerManager = new ProviderManager(config);
    } catch (err) {
      log.warn('ProviderManager init failed:', err);
    }

    // 3. 初始化工具注册表
    const { baseRegistry, registry, permissionController, ignoreFilterPromise } =
      this.initToolRegistry(config);

    // 4. 初始化 Skill 系统
    const skillRegistry = await this.initSkillSystem(config);

    // 5. 初始化记忆系统
    const { memoryManager, _MemoryManagerClass } = await this.initMemorySystem(
      config,
      provider,
      baseRegistry,
    );

    // 6. 初始化提醒系统
    const { reminderEngine, reminderContext } = await this.initReminderSystem(
      config,
      memoryManager,
      baseRegistry,
    );

    // 7. 初始化主动管家（需要 reminderEngine 和 memoryManager）
    const proactiveButler = reminderEngine
      ? await this.initProactiveButler(config, provider, reminderEngine, memoryManager)
      : null;

    // 8. 初始化 MCP 系统
    const mcpManager = await this.initMCPSystem(config, skillRegistry, baseRegistry);

    // 9. 初始化 TemplateRepo（依赖 MCP 系统）
    const templateRepo = mcpManager ? await this.initTemplateRepo(mcpManager) : null;

    // 10. 初始化 Web Search
    this.initWebSearch(config, baseRegistry, mcpManager);

    // 11. 等待 Ignore Filter 加载完成（不阻塞）
    await ignoreFilterPromise.catch((err) => {
      log.warn('Failed to init ignore filter:', err);
    });


    return {
      config,
      provider,
      baseRegistry,
      registry,
      permissionController,
      skillRegistry,
      memoryManager,
      reminderEngine,
      reminderContext,
      proactiveButler,
      mcpManager,
      templateRepo,
      providerManager,
      _MemoryManagerClass,
    };
  }

  // ─── 子初始化方法 ──────────────────────────────────

  private async initConfig(xuanjiAgent?: import('@/core/agent/types').ConfigurableAgentConfig | null): Promise<AppConfig> {
    let config: AppConfig;
    if (this.options.config) {
      config = this.options.config;
    } else {
      const configLoader = new ConfigLoader();
      config = await configLoader.load();
    }
    if (this.options.model) {
      config.provider.model = this.options.model;
    }

    // 🆕 如果有 xuanji agent 配置，合并其配置（agent 配置优先）
    if (xuanjiAgent) {
      log.info('🔧 Merging xuanji agent configuration');

      // 1. Provider 配置
      if ((xuanjiAgent as any).provider) {
        const agentProvider = (xuanjiAgent as any).provider;
        if (agentProvider.adapter) {
          config.provider.adapter = agentProvider.adapter;
        }
        if (agentProvider.baseURL) {
          config.provider.baseURL = agentProvider.baseURL;
          log.info(`  baseURL: ${agentProvider.baseURL}`);
        }
        if (agentProvider.apiKey) {
          config.provider.apiKey = agentProvider.apiKey;
        }
        if (agentProvider.model) {
          config.provider.model = agentProvider.model;
        }
      }

      // 2. 模型配置
      if (xuanjiAgent.model) {
        if (xuanjiAgent.model.primary && !this.options.model) {
          config.provider.model = xuanjiAgent.model.primary;
          log.info(`  model: ${xuanjiAgent.model.primary}`);
        }
        if (xuanjiAgent.model.maxTokens) {
          config.provider.maxTokens = xuanjiAgent.model.maxTokens;
        }
        if (xuanjiAgent.model.temperature !== undefined) {
          config.provider.temperature = xuanjiAgent.model.temperature;
        }
        if (xuanjiAgent.model.thinking) {
          config.provider.thinking = xuanjiAgent.model.thinking as any;
        }
      }

      // 3. 执行配置
      if (xuanjiAgent.execution) {
        if (!config.agent) {
          config.agent = {} as any;
        }
        if (xuanjiAgent.execution.maxIterations !== undefined) {
          (config.agent as any).maxIterations = xuanjiAgent.execution.maxIterations;
        }
        // timeout 不在 AgentTuningConfig 中，跳过
      }

      // 4. 权限配置
      if (xuanjiAgent.permissions) {
        if (!config.tools) {
          config.tools = {} as any;
        }
        if (!config.tools.permissions) {
          config.tools.permissions = {} as any;
        }
        if (xuanjiAgent.permissions.fileRead) {
          (config.tools.permissions as any).fileRead = xuanjiAgent.permissions.fileRead;
        }
        if (xuanjiAgent.permissions.fileWrite) {
          (config.tools.permissions as any).fileWrite = xuanjiAgent.permissions.fileWrite;
        }
        if (xuanjiAgent.permissions.bashExec) {
          (config.tools.permissions as any).bashExec = xuanjiAgent.permissions.bashExec;
        }
        if (xuanjiAgent.permissions.allowedPaths) {
          (config.tools.permissions as any).allowedPaths = xuanjiAgent.permissions.allowedPaths;
        }
        if (xuanjiAgent.permissions.deniedPaths) {
          (config.tools.permissions as any).deniedPaths = xuanjiAgent.permissions.deniedPaths;
        }
        if (xuanjiAgent.permissions.allowedCommands) {
          (config.tools.permissions as any).allowedCommands = xuanjiAgent.permissions.allowedCommands;
        }
        if (xuanjiAgent.permissions.deniedCommands) {
          (config.tools.permissions as any).deniedCommands = xuanjiAgent.permissions.deniedCommands;
        }
      }

      log.info('✅ Xuanji agent configuration merged');
    }

    // ✅ 允许无 API Key 启动，在实际调用 LLM 时再检查
    // 用户可以启动后通过 /settings 配置 API Key
    return config;
  }

  private initProvider(config: AppConfig): ILLMProvider {
    if (this.options.provider) {
      return this.options.provider;
    }

    const providerFactory = new ProviderFactory();
    let provider: ILLMProvider | undefined;

    if (config.provider.adapter) {
      provider = providerFactory.getByAdapter(config.provider.adapter);
    }
    if (!provider) {
      provider = providerFactory.getByModel(config.provider.model);
    }
    if (!provider) {
      throw new Error(`不支持的模型: ${config.provider.model}`);
    }

    return provider;
  }

  private initToolRegistry(config: AppConfig): {
    baseRegistry: ToolRegistry;
    registry: IToolRegistry;
    permissionController: IPermissionController;
    ignoreFilterPromise: Promise<void>;
  } {
    // 初始化基础注册表（全量工具）
    const rawRegistry = this.options.registry ?? createDefaultRegistry();
    if (!(rawRegistry instanceof ToolRegistry)) {
      throw new Error('ChatSession requires a ToolRegistry instance');
    }
    const baseRegistry = rawRegistry;
    const registry: IToolRegistry = rawRegistry;

    // 初始化权限控制器
    const permissionConfig = config.tools.permissions;
    const permissionController = new PermissionController(permissionConfig);
    baseRegistry.setPermissionController(permissionController);

    // 加载 .xuanji/ignore 文件（不阻塞）
    const ignoreFilterPromise = this.initIgnoreFilter(permissionController);

    return { baseRegistry, registry, permissionController, ignoreFilterPromise };
  }

  /**
   * 初始化 Ignore 过滤器（异步，不阻塞启动）
   */
  private async initIgnoreFilter(
    permissionController: IPermissionController,
  ): Promise<void> {
    try {
      const { IgnoreFilter } = await import('@/permission/policies/IgnoreFilter');
      const ignoreFilter = new IgnoreFilter(process.cwd());

      // 加载项目级 .xuanji/ignore（如果存在）
      const { join } = await import('node:path');
      await ignoreFilter.loadFromFile(join(process.cwd(), '.xuanji', 'ignore'));

      // 加载全局 ~/.xuanji/ignore（如果存在）
      const { homedir } = await import('node:os');
      await ignoreFilter.loadFromFile(join(homedir(), '.xuanji', 'ignore'));

      // 注入到 PermissionController
      permissionController.setIgnoreFilter(ignoreFilter);
      log.debug('Ignore filter initialized');
    } catch (err) {
      log.debug('Ignore filter init skipped:', err);
    }
  }

  private async initSkillSystem(
    config: AppConfig,
  ): Promise<InstanceType<typeof import('@/core/skills').SkillRegistry>> {
    const { SkillRegistry, SkillLoader, initializeBuiltinSkills } = await import(
      '@/core/skills'
    );
    const skillRegistry = new SkillRegistry();
    initializeBuiltinSkills(skillRegistry);

    const skillsConfig = config.skills;
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

  private async initMemorySystem(
    config: AppConfig,
    provider: ILLMProvider,
    baseRegistry: ToolRegistry,
  ): Promise<{
    memoryManager: IMemoryStore | null;
    _MemoryManagerClass: (typeof import('@/memory'))['MemoryManager'] | null;
  }> {
    const memoryConfig = config.memory ?? DEFAULT_MEMORY_CONFIG;
    if (!memoryConfig.enabled) {
      return { memoryManager: null, _MemoryManagerClass: null };
    }

    try {
      const memoryModule = await import('@/memory');
      const { MemoryManager } = memoryModule;
      const memoryManager = new MemoryManager(memoryConfig, process.cwd());
      await memoryManager.init();

      // 注册记忆工具
      const memoryStoreTool = new MemoryStoreTool();
      const memorySearchTool = new MemorySearchTool();
      const retrieveMemoryTool = new RetrieveMemoryTool();
      memoryStoreTool.setMemoryManager(memoryManager);
      memorySearchTool.setMemoryManager(memoryManager);
      retrieveMemoryTool.setMemoryStore(memoryManager);
      baseRegistry.register(memoryStoreTool);
      baseRegistry.register(memorySearchTool);
      baseRegistry.register(retrieveMemoryTool);

      // 3.0 新增：注入 MemoryStore 到新工具
      const memoryUpdateTool = baseRegistry.get('memory_update');
      const memoryDeleteTool = baseRegistry.get('memory_delete');
      if (memoryUpdateTool && 'setMemoryStore' in memoryUpdateTool) {
        (memoryUpdateTool as any).setMemoryStore(memoryManager.getStore());
      }
      if (memoryDeleteTool && 'setMemoryStore' in memoryDeleteTool) {
        (memoryDeleteTool as any).setMemoryStore(memoryManager.getStore());
      }

      return { memoryManager, _MemoryManagerClass: MemoryManager };
    } catch (err) {
      log.warn('Failed to init memory system:', err);
      return { memoryManager: null, _MemoryManagerClass: null };
    }
  }

  private async initReminderSystem(
    config: AppConfig,
    memoryManager: IMemoryStore | null,
    baseRegistry: ToolRegistry,
  ): Promise<{
    reminderEngine: import('@/reminder').IReminderEngine | null;
    reminderContext: string | null;
  }> {
    // Reminder 系统目前未在 AppConfig 中定义，暂时禁用
    const reminderConfig = (config as AppConfig & { reminder?: { enabled?: boolean } }).reminder;
    if (!reminderConfig?.enabled || !memoryManager) {
      return { reminderEngine: null, reminderContext: null };
    }

    try {
      const { ReminderEngine } = await import('@/reminder');
      const reminderEngine = new ReminderEngine(reminderConfig);
      await reminderEngine.init();

      // 获取提醒上下文（用于首轮对话）
      // getContext() 方法目前在接口中未定义，使用 any 类型规避
      const context = (reminderEngine as any).getContext?.() ?? { due: [] };
      const reminderContext = context.due?.length > 0 ? reminderEngine.formatForPrompt(context) : null;

      // 注册提醒工具
      const reminderSetTool = new ReminderSetTool();
      const reminderCheckTool = new ReminderCheckTool();
      reminderSetTool.setReminderEngine(reminderEngine);
      reminderCheckTool.setReminderEngine(reminderEngine);
      baseRegistry.register(reminderSetTool);
      baseRegistry.register(reminderCheckTool);

      return { reminderEngine, reminderContext };
    } catch (err) {
      log.warn('Failed to init reminder system:', err);
      return { reminderEngine: null, reminderContext: null };
    }
  }

  private async initProactiveButler(
    config: AppConfig,
    provider: ILLMProvider,
    reminderEngine: import('@/reminder').IReminderEngine,
    memoryManager: IMemoryStore | null,
  ): Promise<import('@/butler').IProactiveButler | null> {
    const butlerConfig = config.butler;
    if (!butlerConfig?.enabled) {
      return null;
    }

    try {
      const { ProactiveButler } = await import('@/butler');
      const proactiveButler = new ProactiveButler(butlerConfig);
      
      // ✅ 注入依赖
      proactiveButler.setDependencies({
        llmProvider: provider,
        reminderEngine,
        memoryManager: memoryManager ?? undefined,
      });
      
      // 初始化
      await proactiveButler.init();
      
      log.info('✨ ProactiveButler 已初始化');
      return proactiveButler;
    } catch (err) {
      log.warn('Failed to init proactive butler:', err);
      return null;
    }
  }

  private async initMCPSystem(
    config: AppConfig,
    skillRegistry: SkillRegistry | null,
    baseRegistry: ToolRegistry,
  ): Promise<MCPManager | null> {
    const mcpConfig = config.mcp;
    if (!mcpConfig?.enabled || !mcpConfig.servers || mcpConfig.servers.length === 0) {
      return null;
    }

    try {
      const mcpManager = MCPManager.getInstance();
      await mcpManager.initialize(mcpConfig);

      // 注册 MCP 工具到 ToolRegistry
      const mcpTools = await mcpManager.getAllTools();
      for (const { serverName, tool } of mcpTools) {
        const adapter = new MCPToolAdapter(serverName, tool);
        baseRegistry.register(adapter);
      }

      log.info(`✨ MCP 系统已启用 (${mcpConfig.servers.length} 个服务器)`);
      return mcpManager;
    } catch (err) {
      log.warn('Failed to init MCP system:', err);
      return null;
    }
  }

  private initWebSearch(
    config: AppConfig,
    baseRegistry: ToolRegistry,
    mcpManager: MCPManager | null,
  ): void {
    // webSearch 配置在 AppConfig.webSearch 而非 config.tools.webSearch
    const webSearchConfig = config.webSearch;
    if (!webSearchConfig) return;

    // 优先使用 MCP 提供的 web_search（如果可用）
    if (mcpManager) {
      const existingTool = baseRegistry.get('web_search');
      if (existingTool) {
        log.info('✨ Web Search: Using MCP-provided tool');
        return;
      }
    }

    // 降级到内置实现
    try {
      const webSearchTool = createEnhancedWebSearchTool(config.webSearch);
      baseRegistry.register(webSearchTool);
      const stats = webSearchTool.stats();
      log.info(`✨ Web Search: Using enhanced implementation (${stats.availableEngines.join(', ')})`);
    } catch (err) {
      log.warn('Failed to init web search:', err);
    }
  }

  /**
   * 构建 System Prompt（基于 LayeredPromptBuilder）
   *
   * 初始构建使用 standard 复杂度 + coding 场景（默认）。
   * 每轮对话时 ChatSession.runSingleAgent 会根据用户消息重新分析意图。
   */
  async buildSystemPrompt(
    _skillRegistry: SkillRegistry,
    registry: IToolRegistry,
    config: AppConfig,
  ): Promise<string | undefined> {
    const { LayeredPromptBuilder } = await import('@/core/prompt');
    const builder = new LayeredPromptBuilder();
    await builder.init();
    const result = await builder.build({
      scene: 'coding',
      complexity: 'standard',
      language: config.ui.language ?? 'zh',
      toolList: registry.getSchemas(),
    });
    if (result.prompt) {
      log.info(`System prompt built via LayeredPromptBuilder: ${result.components.length} components, ~${result.estimatedTokens} tokens`);
      return result.prompt;
    }
    return undefined;
  }

  /**
   * 创建 AgentLoop 实例
   */
  createAgentLoop(
    provider: ILLMProvider,
    registry: IToolRegistry,
    config: AppConfig,
    systemPrompt: string | undefined,
    memoryManager: IMemoryStore | null,
  ): AgentLoop {
    const agentLoop = new AgentLoop(provider, registry, {
      model: config.provider.model,
      apiKey: config.provider.apiKey,
      baseURL: config.provider.baseURL,
      maxTokens: config.provider.maxTokens,
      temperature: config.provider.temperature,
      systemPrompt,
      maxIterations: config.agent?.maxIterations,
      compressor: config.agent?.compressor,
    }, memoryManager ?? undefined);

    // 设置 Extended Thinking 配置（如果启用）
    if (config.provider.thinking) {
      agentLoop.setThinking(config.provider.thinking);
    }

    return agentLoop;
  }

  /**
   * 注入 TaskTool 依赖
   */
  injectTaskToolDeps(
    taskTool: any,
    provider: ILLMProvider,
    lightProvider: ILLMProvider,
    registry: IToolRegistry,
    config: AppConfig,
    systemPrompt: string | undefined,
    hookRegistry: HookRegistry,
    memoryManager: IMemoryStore | null,
    providerManager: import('@/core/providers/ProviderManager').ProviderManager,
    agentRegistry: import('@/core/agent/AgentRegistry').AgentRegistry,
  ): void {
    if (!taskTool) return;
    taskTool.setDependencies({
      providerManager,
      agentRegistry,
      registry,
      agentConfig: {
        model: config.provider.model,
        apiKey: config.provider.apiKey,
        baseURL: config.provider.baseURL,
        maxTokens: config.provider.maxTokens,
        temperature: config.provider.temperature,
        systemPrompt,
      },
      parentProvider: provider,
      hookRegistry,
      memoryStore: memoryManager,
      depth: 0,
      agentId: 'main', // 🔧 主 Agent ID
    });
  }

  /**
   * 初始化模板仓库（依赖 MCP 系统）
   */
  private async initTemplateRepo(
    mcpManager: MCPManager,
  ): Promise<import('@/core/template').TemplateRepo | null> {
    try {
      const { TemplateRepo } = await import('@/core/template');
      const templateRepo = new TemplateRepo(mcpManager);
      log.info('✨ TemplateRepo initialized');
      return templateRepo;
    } catch (err) {
      log.warn('Failed to init TemplateRepo:', err);
      return null;
    }
  }

  /**
   * 初始化 Hook 系统
   */
  async initHookSystem(
    hookRegistry: HookRegistry,
    agentLoop: any,
    checkpointManager: any,
    provider: ILLMProvider,
    config: AppConfig,
    memoryManager: IMemoryStore | null,
    _MemoryManagerClass: (typeof import('@/memory'))['MemoryManager'] | null,
  ): Promise<void> {
    try {
      const hookConfigLoader = new HookConfigLoader();
      const hookConfig = await hookConfigLoader.load();
      hookRegistry.loadConfig(hookConfig);

      hookRegistry.setPromptInjector((content) => {
        if (agentLoop) {
          agentLoop.getMessageManager().setSystemPromptSuffix(content, 'hook');
        }
      });

      agentLoop.setHookRegistry(hookRegistry);
      checkpointManager.setHookRegistry(hookRegistry);

      if (provider) {
        hookRegistry.setAgentHandlerDeps({
          provider: provider,
          providerConfig: {
            model: config.provider.model,
            apiKey: config.provider.apiKey,
            baseURL: config.provider.baseURL,
            maxTokens: config.provider.maxTokens,
            temperature: config.provider.temperature,
          },
        });
      }

      if (memoryManager && _MemoryManagerClass && memoryManager instanceof _MemoryManagerClass) {
        (memoryManager as InstanceType<typeof _MemoryManagerClass>).setHookRegistry(
          hookRegistry,
        );
      }
    } catch (err) {
      log.warn('Hook system init failed:', err);
    }
  }


}
