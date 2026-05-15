// ============================================================
// SessionFactory - 会话工厂
// ============================================================

import type { AppConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { IPermissionController } from '@/permission/types';
import { DependencyContainer } from '@/core/di';
import { ConfigLoader } from '@/core/config/ConfigLoader';
import { getConfigManager } from '@/core/config/ConfigManager';
import { setRuntimeConfig } from '@/core/config/RuntimeConfig';
import { ProviderManager } from '@/core/providers/ProviderManager';
import { createDefaultRegistry } from '@/core/tools/ToolRegistry';
import { PermissionController } from '@/permission/PermissionController';
import { SessionManager } from '@/session/SessionManager';
import { getUserSessionsDir } from '@/core/config/PathManager';
import { HookRegistry } from '@/hooks/HookRegistry';
import { AgentLoop } from '@/core/agent/AgentLoop';
import { StateTracker } from '@/core/state/StateTracker';
import { TaskOrchestrator } from '@/core/task/TaskOrchestrator';
import { ChatSession, type SessionCallbacks } from './ChatSession';
import { SessionStateMachine } from '@/core/state/SessionStateMachine';
import { logger } from '@/core/logger';
import { TaskTool } from '@/core/tools/TaskTool';
import { TeamTool } from '@/core/tools/TeamTool';
import { ListAgentsTool } from '@/core/tools/ListAgentsTool';
import { ListScenesTool } from '@/core/tools/ListScenesTool';
import { MatchAgentTool } from '@/core/tools/MatchAgentTool';
import type { EmbeddingProviderInterface } from '@/core/embedding/EmbeddingProvider';
import { FilteredToolRegistry, augmentToolList } from '@/core/tools/FilteredToolRegistry';
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
  embeddingProvider?: EmbeddingProviderInterface | null;
  onMissingEmbedding?: () => void;
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
      const agentRegistry = await this.container.resolve<import('@/core/agent/AgentRegistry').AgentRegistry>('agentRegistry');

      const builder = new LayeredPromptBuilder(
        userId,
        options.projectRoot,
        this.agentId,
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

    // 7. 创建 StateTracker（旧路径）/ SessionStateMachine（新路径）
    const stateTracker = new StateTracker();
    const useStateMachine = process.env.USE_SESSION_STATE_MACHINE === 'true';
    const stateMachine = useStateMachine ? new SessionStateMachine() : undefined;

    // 8. 获取 TaskOrchestrator 单例（统一后台任务管理器）
    const taskOrchestrator = TaskOrchestrator.getInstance();

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

    // 从 agent YAML 配置获取工具白名单，自动补齐
    const cfgMgr = getConfigManager();
    const agentCfg = cfgMgr.getAgentConfig(this.agentId);
    const agentTools = agentCfg?.tools
      ? (agentCfg.tools as Array<{ name: string }>).map(t => t.name)
      : [];
    const augmentedTools = augmentToolList(agentTools);

    const trackedRegistry = new FilteredToolRegistry(
      registry,
      augmentedTools,
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
    const completionHandler = taskOrchestrator.initCompletionHandler(contextManager);
    // 12. 初始化 TodoManager（用户维度隔离）
    getTodoManager(userId);

    // 13. 创建会话
    const session = new ChatSession(agentLoop, this.container, stateTracker, options.callbacks, stateMachine);

    // 重设 onRun + onAutoSummarize + onCitationData，让后台任务完成时自动触发 ChatSession.run + 通知渲染器
    const taskCompletionHandler = completionHandler;
    if (taskCompletionHandler) {
      const bridgeAutoSummarize = (options.callbacks as any)?.onAutoSummarize;
      const bridgeCitationData = (options.callbacks as any)?.onCitationData;
      (taskCompletionHandler as any).callbacks = {
        ...(taskCompletionHandler as any).callbacks,
        onAutoSummarize: (subAgentId?: string, groupId?: string) => {
          bridgeAutoSummarize?.(subAgentId, groupId);
        },
        onCitationData: (citations: Array<{ agentName: string; originalOutput: string; duration: number; tokensUsed: { input: number; output: number } }>) => {
          bridgeCitationData?.(citations);
        },
        onRun: async (message: string) => {
          try {
            await session.run(message);
          } catch (err) {
            log.error('TaskCompletionHandler onRun failed:', err);
          }
        },
        isRunning: () => (agentLoop as any).running ?? false,
      };
      log.info('TaskCompletionHandler onRun + onAutoSummarize + onCitationData hooked');
    }

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
    matchAgentTool.setDependencies({
      agentRegistry,
      embeddingProvider: options.embeddingProvider,
      onMissingEmbedding: options.onMissingEmbedding,
    });
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
