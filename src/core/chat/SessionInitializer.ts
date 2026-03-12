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
import { MCPSkillAdapter } from '@/mcp/MCPSkillAdapter';
import { createEnhancedWebSearchTool } from '@/mcp/search';
import { MemoryStoreTool } from '@/core/tools/MemoryStoreTool';
import { MemorySearchTool } from '@/core/tools/MemorySearchTool';
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
  lightProvider: ILLMProvider;
  baseRegistry: ToolRegistry;
  registry: IToolRegistry;
  permissionController: IPermissionController;
  skillRegistry: SkillRegistry | null;
  memoryManager: IMemoryStore | null;
  reminderEngine: import('@/reminder').IReminderEngine | null;
  reminderContext: string | null;
  proactiveButler: import('@/butler').IProactiveButler | null;
  mcpManager: MCPManager | null;
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
    // 1. 加载配置
    const config = await this.initConfig();

    // 2. 初始化 Provider
    const { provider, lightProvider } = this.initProvider(config);

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

    // 9. 初始化 Web Search
    this.initWebSearch(config, baseRegistry, mcpManager);

    // 10. 等待 Ignore Filter 加载完成（不阻塞）
    await ignoreFilterPromise.catch((err) => {
      log.warn('Failed to init ignore filter:', err);
    });

    return {
      config,
      provider,
      lightProvider,
      baseRegistry,
      registry,
      permissionController,
      skillRegistry,
      memoryManager,
      reminderEngine,
      reminderContext,
      proactiveButler,
      mcpManager,
      _MemoryManagerClass,
    };
  }

  // ─── 子初始化方法 ──────────────────────────────────

  private async initConfig(): Promise<AppConfig> {
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
    // ✅ 允许无 API Key 启动，在实际调用 LLM 时再检查
    // 用户可以启动后通过 /settings 配置 API Key
    return config;
  }

  private initProvider(config: AppConfig): {
    provider: ILLMProvider;
    lightProvider: ILLMProvider;
  } {
    if (this.options.provider) {
      return {
        provider: this.options.provider,
        lightProvider: this.options.provider,
      };
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

    // 初始化 lightProvider（用于压缩、子代理等低复杂度任务）
    let lightProvider: ILLMProvider;
    if (config.provider.lightModel) {
      const light = providerFactory.getByModel(config.provider.lightModel);
      if (!light) {
        log.warn(
          `lightModel "${config.provider.lightModel}" not supported, fallback to main provider`,
        );
        lightProvider = provider;
      } else {
        lightProvider = light;
      }
    } else {
      lightProvider = provider;
    }

    return { provider, lightProvider };
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
      memoryStoreTool.setMemoryManager(memoryManager);
      memorySearchTool.setMemoryManager(memoryManager);
      baseRegistry.register(memoryStoreTool);
      baseRegistry.register(memorySearchTool);

      // 初始化 SmartMemoryExtractor V2（LLM 主动决策版）
      if (memoryManager instanceof MemoryManager) {
        try {
          const useV2 = config.features?.smartMemoryV2 || false;

          if (useV2) {
            const { SmartMemoryExtractorV2 } = await import('@/memory');
            const smartExtractorV2 = new SmartMemoryExtractorV2(
              provider,
              {
                model: config.provider.model,
                apiKey: config.provider.apiKey,
                baseURL: config.provider.baseURL,
                maxTokens: config.provider.maxTokens,
                temperature: config.provider.temperature,
                adapter: config.provider.adapter,
              },
              memoryManager.getConfig(),
              config.projectRoot,
            );
            memoryManager.setSmartExtractorV2(smartExtractorV2);
            log.info('✨ SmartMemoryExtractor V2 启用（LLM 主动决策）');
          } else {
            // 使用 V1（规则 + LLM 辅助提取）
            const { SmartMemoryExtractor } = await import('@/memory');
            const smartExtractor = new SmartMemoryExtractor(
              provider,
              {
                model: config.provider.model,
                apiKey: config.provider.apiKey,
                baseURL: config.provider.baseURL,
                maxTokens: config.provider.maxTokens,
                temperature: config.provider.temperature,
                adapter: config.provider.adapter,
              },
              memoryManager.getConfig(),
              config.projectRoot,
            );
            memoryManager.setSmartExtractor(smartExtractor);
            log.info('✨ SmartMemoryExtractor V1 启用（规则 + LLM 提取）');
          }
        } catch (err) {
          log.warn('Failed to init SmartMemoryExtractor:', err);
        }
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

      // 注册 MCP Prompts 到 SkillRegistry
      if (skillRegistry) {
        const mcpPrompts = await mcpManager.getAllPrompts();
        for (const { serverName, prompt } of mcpPrompts) {
          const skillAdapter = new MCPSkillAdapter(serverName, prompt);
          skillRegistry.register(skillAdapter);
        }
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
   * 构建 System Prompt（基于启用的 Skill）
   */
  async buildSystemPrompt(
    skillRegistry: SkillRegistry,
    registry: IToolRegistry,
    config: AppConfig,
  ): Promise<string | undefined> {
    const skillsConfig = config.skills;
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
            toolList: registry.getSchemas(),
            language: config.ui.language ?? 'zh',
          },
        });
      }
    }
    return systemPrompt;
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
    registry: IToolRegistry,
    config: AppConfig,
    systemPrompt: string | undefined,
    hookRegistry: HookRegistry,
    memoryManager: IMemoryStore | null,
  ): void {
    if (!taskTool) return;
    taskTool.setDependencies({
      provider,
      registry,
      agentConfig: {
        model: config.provider.model,
        apiKey: config.provider.apiKey,
        baseURL: config.provider.baseURL,
        maxTokens: config.provider.maxTokens,
        temperature: config.provider.temperature,
        systemPrompt,
      },
      hookRegistry,
      memoryStore: memoryManager,
    });
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
