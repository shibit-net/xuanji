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
import { AgentLoop } from '@/core/agent/AgentLoop';
import { ConversationManager } from '@/core/conversation/ConversationManager';
import { TaskOrchestrator } from '@/core/task/TaskOrchestrator';
import { ChatSession, type SessionCallbacks } from './ChatSession';
import { logger } from '@/core/logger';
import { TaskTool } from '@/core/tools/TaskTool';
import { TeamTool } from '@/core/tools/TeamTool';
import { ListAgentsTool } from '@/core/tools/ListAgentsTool';
import { ListScenesTool } from '@/core/tools/ListScenesTool';
import { MatchAgentTool } from '@/core/tools/MatchAgentTool';
import { FilteredToolRegistry } from '@/core/tools/FilteredToolRegistry';
import { getTodoManager } from '@/core/tools/TodoManager';
import { AgentFactory } from '@/core/agent/factory/AgentFactory';

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

      let intentAnalyzer: import('@/core/prompt/IntentAnalyzer').IntentAnalyzer | undefined;
      try {
        const embeddingProvider = getEmbeddingProvider(config.embedding);
        intentAnalyzer = new IntentAnalyzer(embeddingProvider, agentRegistry);
        await intentAnalyzer.init();
        log.info('[SessionFactory] IntentAnalyzer created with embedding support (will init on first use)');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn(`[SessionFactory] Failed to create IntentAnalyzer with embeddings, using keyword-only mode: ${errMsg}`);
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

    // 4.5. 注册 AgentFactory（统一 Agent 创建入口）
    this.container.registerSingleton('agentFactory', () => new AgentFactory(registry));

    // 5. 注册高级工具
    await this.registerAdvancedTools(config, options, agentId);

    // 6. 预先 resolve layeredPromptBuilder，确保它进入 singleton 缓存
    const layeredPromptBuilder = await this.container.resolve('layeredPromptBuilder') as import('@/core/prompt/LayeredPromptBuilder').LayeredPromptBuilder;
    const hookRegistry = await this.container.resolve<HookRegistry>('hookRegistry');
    const agentRegistry = await this.container.resolve('agentRegistry') as import('@/core/agent/AgentRegistry').AgentRegistry;

    // 7. 创建 ConversationManager
    const conversationManager = new ConversationManager();
    conversationManager.setPromptBuilder(layeredPromptBuilder);

    // 8. 创建 TaskOrchestrator
    const taskOrchestrator = new TaskOrchestrator();

    // 9. 创建 AgentLoop
    const provider = await this.container.resolve<ILLMProvider>('provider');

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

    const trackedRegistry = new FilteredToolRegistry(
      registry,
      null,
      { agentId: this.agentId, agentName: this.agentId },
      process.cwd(),
    );

    const agentLoop = new AgentLoop(provider, trackedRegistry, agentConfig, userId);
    agentLoop.setHookRegistry(hookRegistry);

    // 10. 构建主 agent system prompt（L0 only）
    // scene 知识通过 list_scenes 工具按需获取，不做意图分析
    try {
      const prompt = await layeredPromptBuilder.build({});
      if (prompt.prompt) {
        agentLoop.getContextManager().updateSystemPrompt(prompt.prompt);
        log.info(`Main agent prompt built: ${prompt.components.length} components, ~${prompt.estimatedTokens} tokens`);
      }
    } catch (err) {
      log.warn('Failed to build initial system prompt:', err);
    }

    // 11. 初始化 TaskCompletionHandler — 后台任务完成通知
    // 后台任务完成时自动注入到 system prompt，主 agent 空闲时自动触发汇总
    const contextManager = agentLoop.getContextManager();
    taskOrchestrator.setContextManager(contextManager);
    // 重设 onRun，让后台任务完成时自动触发 ChatSession.run
    const taskCompletionHandler = (taskOrchestrator as any).taskCompletionHandler as import('@/core/agent/async/TaskCompletionHandler').TaskCompletionHandler;
    if (taskCompletionHandler) {
      // onRun 由 ChatSession 通过 checkPendingCompletions 触发
      // handleCompletion 中当主 agent 空闲时也会自动触发
      log.info('TaskCompletionHandler initialized for async task notifications');
    }

    // 12. 初始化 TodoManager（用户维度隔离）
    getTodoManager(userId);

    // 13. 创建会话
    const session = new ChatSession(agentLoop, this.container, conversationManager, taskOrchestrator, options.callbacks);
    log.info('Session created successfully');
    return session;
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
        agentId,
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

    const listAgentsTool = new ListAgentsTool();
    listAgentsTool.setAgentRegistry(agentRegistry);
    registry.register(listAgentsTool);

    const matchAgentTool = new MatchAgentTool();
    matchAgentTool.setDependencies({ agentRegistry });
    registry.register(matchAgentTool);

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
