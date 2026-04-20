// ============================================================
// SessionFactory - 会话工厂（贾维斯架构版）
// ============================================================
// 负责创建和初始化 ChatSession 及其所有依赖
//
// 🎯 简化版：删除 SessionOrchestrator、SkillRouter、PromptOrchestrator
// 🎯 集成 MainAgent：主调度Agent架构
// ============================================================

import type { AppConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { IPermissionController } from '@/permission/types';
import { DependencyContainer } from '@/core/di';
import { ConfigLoader } from '@/core/config/ConfigLoader';
import { ProviderManager } from '@/core/providers/ProviderManager';
import { ToolRegistry, createDefaultRegistry } from '@/core/tools/ToolRegistry';
import { MemoryManager } from '@/memory/MemoryManager';
import { PermissionController } from '@/permission/PermissionController';
import { SessionManager } from '@/session/SessionManager';
import { HookRegistry } from '@/hooks/HookRegistry';
import { AgentLoop } from '@/core/agent/AgentLoop';
import { TeamManager } from '@/core/agent/team/TeamManager';
import { IntentRouter } from '@/core/intent/IntentRouter';
import { IntentAnalyzer } from '@/core/prompt/IntentAnalyzer';
import { LayeredPromptBuilder } from '@/core/prompt/LayeredPromptBuilder';
import { MainAgent } from '@/core/agent/jarvis/MainAgent';
import { PromptStore } from '@/core/agent/jarvis/PromptStore';
import { TaskPlanner } from '@/core/agent/jarvis/TaskPlanner';
import { ResultAggregator } from '@/core/agent/jarvis/ResultAggregator';
import { getCodingSceneConfigs } from '@/core/prompt/components/l1-coding-scenes';
import { ChatSession, type SessionCallbacks } from './ChatSession';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SessionFactory' });

/**
 * 会话创建选项
 */
export interface SessionOptions {
  /** 用户 ID */
  userId?: string;
  /** Agent ID（默认为 'xuanji'） */
  agentId?: string;
  /** 模型覆盖 */
  model?: string;
  /** 已有的配置（跳过加载） */
  config?: AppConfig;
  /** 已有的 Provider（跳过创建） */
  provider?: ILLMProvider;
  /** 已有的 ToolRegistry（跳过创建） */
  registry?: IToolRegistry;
  /** 会话回调 */
  callbacks?: SessionCallbacks;
  /** 项目根目录 */
  projectRoot?: string;
}

/**
 * SessionFactory - 会话工厂（贾维斯架构版）
 */
export class SessionFactory {
  private container: DependencyContainer;
  private userId: string;
  private agentId: string;

  constructor(userId: string, agentId: string = 'xuanji') {
    this.container = new DependencyContainer();
    this.userId = userId;
    this.agentId = agentId;
  }

  /**
   * 创建会话
   */
  async create(options: SessionOptions = {}): Promise<ChatSession> {
    const userId = options.userId || this.userId;
    const agentId = options.agentId || this.agentId;

    log.info(`Creating session for user: ${userId}, agent: ${agentId} (Jarvis Mode)`);

    // 1. 加载配置
    const config = await this.loadConfig({ ...options, userId, agentId });
    this.container.registerSingleton('config', config);

    // 2. 初始化基础设施
    await this.initInfrastructure(config, options, userId);

    // 3. 初始化领域服务
    await this.initDomainServices(config, options);

    // 4. 初始化应用服务
    await this.initApplicationServices(config, options);

    // 5. 注册高级工具
    await this.registerAdvancedTools(config);

    // 6. 创建 MainAgent（贾维斯架构 - 默认模式）
    const mainAgent = await this.createMainAgent(config);

    // 7. 创建会话
    const agentLoop = await this.container.resolve<AgentLoop>('agentLoop');
    const session = new ChatSession(
      mainAgent,
      agentLoop,
      this.container,
      options.callbacks
    );

    log.info('Session created successfully');
    return session;
  }

  /**
   * 创建 MainAgent（贾维斯架构）
   */
  private async createMainAgent(config: AppConfig): Promise<MainAgent> {
    log.debug('Creating MainAgent (Jarvis Architecture)...');

    const provider = await this.container.resolve<ILLMProvider>('provider');
    const agentRegistry = await this.container.resolve('agentRegistry') as import('@/core/agent/AgentRegistry').AgentRegistry;

    // 1. 初始化 IntentRouter
    const intentRouter = new IntentRouter(agentRegistry, config.provider);
    await intentRouter.init();
    log.debug('IntentRouter initialized');

    // 2. 初始化 IntentAnalyzer
    const embeddingService = null; // TODO: 注入 EmbeddingService
    const intentAnalyzer = new IntentAnalyzer(embeddingService);

    // 注册编程场景
    const sceneConfigs = getCodingSceneConfigs();
    for (const [scene, sceneConfig] of sceneConfigs) {
      intentAnalyzer.registerScene(scene, sceneConfig);
    }
    await intentAnalyzer.init();
    log.debug('IntentAnalyzer initialized with coding scenes');

    // 3. 创建 LayeredPromptBuilder
    const promptBuilder = new LayeredPromptBuilder();
    await promptBuilder.init();
    log.debug('LayeredPromptBuilder initialized');

    // 4. 创建 PromptStore
    const promptStore = new PromptStore(promptBuilder);

    // 5. 创建 TaskPlanner
    const taskPlanner = new TaskPlanner(provider);

    // 6. 创建 ResultAggregator
    const resultAggregator = new ResultAggregator(provider);

    // 7. 创建 TeamManager
    const registry = await this.container.resolve<IToolRegistry>('toolRegistry');
    const memoryManager = await this.container.resolve<IMemoryStore>('memoryManager');
    const hookRegistry = await this.container.resolve<HookRegistry>('hookRegistry');
    const providerManager = new ProviderManager(config);

    const teamManager = new TeamManager(
      provider,
      registry,
      {
        model: config.provider.model,
        apiKey: config.provider.apiKey,
        baseURL: config.provider.baseURL,
        maxTokens: config.provider.maxTokens,
        temperature: config.provider.temperature,
      },
      hookRegistry,
      memoryManager,
      0, // depth
      agentRegistry,
      providerManager
    );

    // 8. 创建 MainAgent
    const mainAgent = new MainAgent(
      intentRouter,
      intentAnalyzer,
      teamManager,
      promptStore,
      taskPlanner,
      resultAggregator,
      {
        enableIntentRouter: true,
        enableSceneAnalysis: true,
        enableTaskDecomposition: true,
        enableResultAggregation: true,
      }
    );

    log.info('MainAgent created successfully');
    return mainAgent;
  }

  /**
   * 加载配置
   */
  private async loadConfig(options: SessionOptions): Promise<AppConfig> {
    if (options.config) {
      log.debug('Using provided config');
      return options.config;
    }

    const userId = options.userId;
    const agentId = options.agentId || 'xuanji';
    if (!userId) {
      throw new Error('userId is required');
    }
    log.debug(`Loading config for user: ${userId}, agent: ${agentId}`);
    const loader = new ConfigLoader(userId, agentId);
    const config = await loader.load();

    // 模型覆盖
    if (options.model) {
      config.provider.model = options.model;
    }

    return config;
  }

  /**
   * 初始化基础设施层
   */
  private async initInfrastructure(config: AppConfig, options: SessionOptions, userId: string): Promise<void> {
    log.debug('Initializing infrastructure...');

    // SessionManager
    this.container.register('sessionManager', () => {
      return new SessionManager({
        sessionConfig: config.session
      });
    });

    // HookRegistry
    this.container.register('hookRegistry', () => {
      return new HookRegistry();
    });
  }

  /**
   * 初始化领域服务层
   */
  private async initDomainServices(config: AppConfig, options: SessionOptions): Promise<void> {
    log.debug('Initializing domain services...');

    // Provider
    this.container.register('provider', async () => {
      if (options.provider) {
        log.debug('Using provided provider');
        return options.provider;
      }

      const providerManager = new ProviderManager(config);
      return providerManager.getProvider();
    });

    // ToolRegistry
    this.container.register('toolRegistry', () => {
      if (options.registry) {
        log.debug('Using provided registry');
        return options.registry;
      }

      return createDefaultRegistry(config, options.projectRoot);
    });

    // MemoryManager
    this.container.register('memoryManager', () => {
      return new MemoryManager(config);
    });

    // PermissionController
    this.container.register('permissionController', () => {
      return new PermissionController(config.permission);
    });

    // AgentRegistry
    this.container.register('agentRegistry', async () => {
      const { AgentRegistry } = await import('@/core/agent/AgentRegistry');
      const agentRegistry = new AgentRegistry();
      await agentRegistry.init();
      return agentRegistry;
    });
  }

  /**
   * 初始化应用服务层
   */
  private async initApplicationServices(config: AppConfig, options: SessionOptions): Promise<void> {
    log.debug('Initializing application services...');

    const provider = await this.container.resolve<ILLMProvider>('provider');
    const registry = await this.container.resolve<IToolRegistry>('toolRegistry');
    const memoryManager = await this.container.resolve<IMemoryStore>('memoryManager');
    const permissionController = await this.container.resolve<IPermissionController>('permissionController');
    const hookRegistry = await this.container.resolve<HookRegistry>('hookRegistry');

    // 注入权限控制器到 ToolRegistry
    registry.setPermissionController?.(permissionController);

    // AgentLoop
    this.container.register('agentLoop', () => {
      const agentConfig: import('@/core/types').AgentConfig = {
        model: config.provider.model,
        apiKey: config.provider.apiKey,
        baseURL: config.provider.baseURL,
        maxTokens: config.provider.maxTokens,
        temperature: config.provider.temperature,
        maxIterations: config.agent?.maxIterations,
        compressor: config.agent?.compressor ? {
          enabled: config.agent.compressor.enabled ?? false,
          keepRecentRounds: 2,
          compressionThreshold: 0.8,
          minMessagesToCompress: 10,
          summaryMaxLength: 500,
        } : undefined,
        thinking: config.provider.thinking,
      };

      return new AgentLoop(
        provider,
        registry,
        agentConfig,
        memoryManager
      );
    });
  }

  /**
   * 注册高级工具（需要依赖注入）
   */
  private async registerAdvancedTools(config: AppConfig): Promise<void> {
    log.debug('Registering advanced tools...');

    const registry = await this.container.resolve<IToolRegistry>('toolRegistry');
    const provider = await this.container.resolve<ILLMProvider>('provider');
    const agentRegistry = await this.container.resolve('agentRegistry') as import('@/core/agent/AgentRegistry').AgentRegistry;
    const hookRegistry = await this.container.resolve<HookRegistry>('hookRegistry');
    const memoryManager = await this.container.resolve<IMemoryStore>('memoryManager');

    // ProviderManager
    const providerManager = new ProviderManager(config);

    // 动态导入工具类
    const { SubAgentFactory } = await import('@/core/agent/SubAgentFactory');
    const { TaskTool } = await import('@/core/tools/TaskTool');
    const { TeamTool } = await import('@/core/tools/TeamTool');

    // SubAgentFactory
    const subAgentFactory = new SubAgentFactory(
      agentRegistry,
      providerManager,
      registry,
      hookRegistry,
      memoryManager,
      provider,
      config.provider
    );

    // 注册 Task 工具
    const taskTool = new TaskTool(subAgentFactory);
    registry.register(taskTool);

    // 注册 Team 工具
    const teamTool = new TeamTool(
      provider,
      registry,
      config.provider,
      hookRegistry,
      memoryManager,
      agentRegistry,
      providerManager
    );
    registry.register(teamTool);

    log.debug('Advanced tools registered');
  }
}
