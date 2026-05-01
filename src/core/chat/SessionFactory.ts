// ============================================================
// SessionFactory - 会话工厂
// ============================================================

import type { AppConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { IPermissionController } from '@/permission/types';
import { DependencyContainer } from '@/core/di';
import { ConfigLoader } from '@/core/config/ConfigLoader';
import { setRuntimeConfig } from '@/core/config/RuntimeConfig';
import { ProviderManager } from '@/core/providers/ProviderManager';
import { createDefaultRegistry } from '@/core/tools/ToolRegistry';
import { PermissionController } from '@/permission/PermissionController';
import { SessionManager } from '@/session/SessionManager';
import { getUserSessionsDir } from '@/core/config/PathManager';
import { HookRegistry } from '@/hooks/HookRegistry';
import { MainAgent } from '@/core/agent/dispatch/MainAgent';
import { ChatSession, type SessionCallbacks } from './ChatSession';
import { logger } from '@/core/logger';
import { TaskTool } from '@/core/tools/TaskTool';
import { TeamTool } from '@/core/tools/TeamTool';
import { ListAgentsTool } from '@/core/tools/ListAgentsTool';
import { ListScenesTool } from '@/core/tools/ListScenesTool';
import { MatchAgentTool } from '@/core/tools/MatchAgentTool';
import { FilteredToolRegistry } from '@/core/tools/FilteredToolRegistry';
import { getTodoManager } from '@/core/tools/TodoManager';

const log = logger.child({ module: 'SessionFactory' });

export interface SessionOptions {
  userId?: string;
  agentId?: string;
  model?: string;
  config?: AppConfig;
  provider?: ILLMProvider;
  registry?: IToolRegistry;
  callbacks?: SessionCallbacks;
  projectRoot?: string;
}

export class SessionFactory {
  private container: DependencyContainer;
  private userId: string;
  private agentId: string;

  constructor(userId: string, agentId: string = 'xuanji') {
    this.container = new DependencyContainer();
    this.userId = userId;
    this.agentId = agentId;
  }

  async create(options: SessionOptions = {}): Promise<ChatSession> {
    const userId = options.userId || this.userId;
    const agentId = options.agentId || this.agentId;

    log.info(`Creating session for user: ${userId}, agent: ${agentId}`);

    // 1. 加载配置
    const config = await this.loadConfig({ ...options, userId, agentId });
    this.container.registerSingleton('config', config);
    setRuntimeConfig(config);
    log.info('RuntimeConfig initialized');

    // 2. 基础设施
    this.container.register('sessionManager', () => new SessionManager({
      sessionConfig: config.session,
      baseDir: getUserSessionsDir(userId),
    }));
    this.container.register('hookRegistry', () => new HookRegistry());

    // 3. 领域服务
    this.container.register('provider', async () => {
      if (options.provider) return options.provider;
      const providerManager = new ProviderManager(config);
      return providerManager.getProvider();
    });

    this.container.register('toolRegistry', () => {
      if (options.registry) return options.registry;
      return createDefaultRegistry();
    });

    this.container.register('permissionController', () => new PermissionController(config.permission, userId));

    this.container.register('agentRegistry', async () => {
      const { AgentRegistry } = await import('@/core/agent/AgentRegistry');
      const agentRegistry = new AgentRegistry(userId);
      await agentRegistry.init();
      return agentRegistry;
    });

    this.container.register('promptRegistry', async () => {
      const { PromptComponentRegistry } = await import('@/core/prompt/PromptComponentRegistry');
      const registry = new PromptComponentRegistry(userId, options.projectRoot);
      await registry.init();
      return registry;
    });

    this.container.register('layeredPromptBuilder', async () => {
      const { LayeredPromptBuilder } = await import('@/core/prompt/LayeredPromptBuilder');
      const { IntentAnalyzer } = await import('@/core/prompt/IntentAnalyzer');
      const { getEmbeddingProvider } = await import('@/embedding/EmbeddingProvider');
      const agentRegistry = await this.container.resolve<import('@/core/agent/AgentRegistry').AgentRegistry>('agentRegistry');

      // 🔧 创建 EmbeddingProvider 和 IntentAnalyzer
      let intentAnalyzer: import('@/core/prompt/IntentAnalyzer').IntentAnalyzer | undefined;
      try {
        // 传递配置给 EmbeddingProvider（但不立即初始化）
        const embeddingProvider = getEmbeddingProvider(config.embedding);
        // 不在这里调用 init()，让 IntentAnalyzer 在第一次使用时才初始化
        // await embeddingProvider.init();
        intentAnalyzer = new IntentAnalyzer(embeddingProvider, agentRegistry);
        // IntentAnalyzer 会在第一次使用时自动初始化 embeddingProvider
        await intentAnalyzer.init();
        log.info('[SessionFactory] IntentAnalyzer created with embedding support (will init on first use)');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const errStack = err instanceof Error ? err.stack : '';
        log.warn(`[SessionFactory] Failed to create IntentAnalyzer with embeddings, using keyword-only mode: ${errMsg}`);
        if (errStack) {
          log.debug(`[SessionFactory] Error stack: ${errStack}`);
        }
        intentAnalyzer = new IntentAnalyzer(undefined, agentRegistry);
      }

      const builder = new LayeredPromptBuilder(
        intentAnalyzer,
        userId,
        options.projectRoot,
        this.agentId,
        {
          defaultComplexity: config.prompt?.defaultComplexity,
          defaultScene: config.prompt?.defaultScene,
        }
      );
      await builder.init();
      return builder;
    });

    // 4. 注入权限控制器
    const registry = await this.container.resolve<IToolRegistry>('toolRegistry');
    const permissionController = await this.container.resolve<IPermissionController>('permissionController');
    registry.setPermissionController?.(permissionController);

    // 5. 注册高级工具
    await this.registerAdvancedTools(config, options, agentId);

    // 6. 预先 resolve layeredPromptBuilder，确保它进入 singleton 缓存
    await this.container.resolve('layeredPromptBuilder');

    // 7. 创建 MainAgent
    const mainAgent = await this.createMainAgent(config);

    // 8. 初始化 TodoManager（用户维度隔离）
    getTodoManager(userId);

    // 9. 创建会话
    const session = new ChatSession(mainAgent, this.container, options.callbacks);
    log.info('Session created successfully');
    return session;
  }

  private async createMainAgent(config: AppConfig): Promise<MainAgent> {
    const provider = await this.container.resolve<ILLMProvider>('provider');
    const registry = await this.container.resolve<IToolRegistry>('toolRegistry');
    const hookRegistry = await this.container.resolve<HookRegistry>('hookRegistry');
    const layeredPromptBuilder = await this.container.resolve('layeredPromptBuilder') as import('@/core/prompt/LayeredPromptBuilder').LayeredPromptBuilder;

    const agentConfig = {
      model: config.provider.model,
      apiKey: config.provider.apiKey,
      baseURL: config.provider.baseURL,
      maxTokens: config.provider.maxTokens,
      temperature: config.provider.temperature,
      maxIterations: config.agent?.maxIterations,
      thinking: config.provider.thinking,
      compressor: config.agent?.compressor ? {
        enabled: config.agent.compressor.enabled ?? false,
        keepRecentRounds: 2,
        compressionThreshold: 0.8,
        minMessagesToCompress: 10,
        summaryMaxLength: 500,
      } : undefined,
    };

    // 包裹 FilteredToolRegistry，让主 agent 拥有独立的工作目录管理
    // 避免 sub-agent 的 change_directory 影响主 agent 的 cwd
    const trackedRegistry = new FilteredToolRegistry(
      registry,
      null,  // allowAll: 主 agent 可使用所有工具
      { agentId: this.agentId, agentName: this.agentId },
      process.cwd(),  // 初始工作目录
    );

    const mainAgent = new MainAgent({
      provider,
      registry: trackedRegistry,
      config: agentConfig,
      agentRegistry: await this.container.resolve('agentRegistry') as import('@/core/agent/AgentRegistry').AgentRegistry,
      hookRegistry,
      promptBuilder: layeredPromptBuilder,
      userId: this.userId,
    });

    log.info('MainAgent created');
    return mainAgent;
  }

  private async registerAdvancedTools(config: AppConfig, options: SessionOptions, agentId: string): Promise<void> {
    const registry = await this.container.resolve<IToolRegistry>('toolRegistry');
    const provider = await this.container.resolve<ILLMProvider>('provider');
    const agentRegistry = await this.container.resolve('agentRegistry') as import('@/core/agent/AgentRegistry').AgentRegistry;
    const promptRegistry = await this.container.resolve('promptRegistry') as import('@/core/prompt/PromptComponentRegistry').PromptComponentRegistry;
    const hookRegistry = await this.container.resolve<HookRegistry>('hookRegistry');
    const providerManager = new ProviderManager(config);

    registry.register(new TaskTool());
    const taskTool = registry.get('task') as TaskTool;
    if (taskTool && 'setDependencies' in taskTool) {
      taskTool.setDependencies({
        providerManager,
        agentRegistry,
        registry,
        agentConfig: config.provider,
        parentProvider: provider,
        hookRegistry,
        agentId, // 🔧 传递主 Agent ID（从配置读取，如 'xuanji'）
      });
    }

    registry.register(new TeamTool());
    const teamTool = registry.get('agent_team') as TeamTool;
    if (teamTool && 'setDependencies' in teamTool) {
      teamTool.setDependencies({
        provider,
        providerManager,
        agentRegistry,
        registry,
        agentConfig: config.provider,
        hookRegistry,
      });
    }

    // 注册 Agent 发现工具
    const listAgentsTool = new ListAgentsTool();
    listAgentsTool.setAgentRegistry(agentRegistry);
    registry.register(listAgentsTool);

    const matchAgentTool = new MatchAgentTool();
    matchAgentTool.setDependencies({ agentRegistry });
    registry.register(matchAgentTool);

    // 注册 Scene 发现工具
    const listScenesTool = new ListScenesTool();
    listScenesTool.setPromptRegistry(promptRegistry);
    registry.register(listScenesTool);

    log.debug('Advanced tools registered (including list_agents, match_agent, and list_scenes)');
  }

  private async loadConfig(options: SessionOptions & { userId: string; agentId: string }): Promise<AppConfig> {
    if (options.config) return options.config;

    const loader = new ConfigLoader(options.userId, options.agentId);
    const config = await loader.load();

    if (options.model) {
      config.provider.model = options.model;
    }

    return config;
  }
}
