// ============================================================
// SessionFactory - 会话工厂
// ============================================================

import type { AppConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { IPermissionController } from '@/permission/types';
import { DependencyContainer } from '@/core/di';
import { ConfigLoader } from '@/core/config/ConfigLoader';
import { ProviderManager } from '@/core/providers/ProviderManager';
import { createDefaultRegistry } from '@/core/tools/ToolRegistry';
import { PermissionController } from '@/permission/PermissionController';
import { SessionManager } from '@/session/SessionManager';
import { HookRegistry } from '@/hooks/HookRegistry';
import { MainAgent } from '@/core/agent/dispatch/MainAgent';
import { ChatSession, type SessionCallbacks } from './ChatSession';
import { logger } from '@/core/logger';
import { TaskTool } from '@/core/tools/TaskTool';
import { TeamTool } from '@/core/tools/TeamTool';
import { ListAgentsTool } from '@/core/tools/ListAgentsTool';
import { ListScenesTool } from '@/core/tools/ListScenesTool';
import { MatchAgentTool } from '@/core/tools/MatchAgentTool';

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

    // 2. 基础设施
    this.container.register('sessionManager', () => new SessionManager({ sessionConfig: config.session }));
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

    this.container.register('permissionController', () => new PermissionController(config.permission));

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
      const builder = new LayeredPromptBuilder(
        undefined,
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

    // 8. 创建会话
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

    const mainAgent = new MainAgent({
      provider,
      registry,
      config: agentConfig,
      agentRegistry: await this.container.resolve('agentRegistry') as import('@/core/agent/AgentRegistry').AgentRegistry,
      hookRegistry,
      promptBuilder: layeredPromptBuilder,
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
