// ============================================================
// SessionFactory - 会话工厂
// ============================================================

import type { AppConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { IPermissionController } from '@/permission/types';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { DependencyContainer } from '@/core/di';
import { ConfigLoader } from '@/core/config/ConfigLoader';
import { getConfigManager } from '@/core/config/ConfigManager';
import { setRuntimeConfig } from '@/core/config/RuntimeConfig';
import { ProviderManager } from '@/core/providers/ProviderManager';
import { createDefaultRegistry } from '@/core/tools/ToolRegistry';
import { PermissionController } from '@/permission/PermissionController';
import { SessionManager } from '@/session/SessionManager';
import { getUserSessionsDir, getUserConfigPath, getUserMemoryPath, getUserMemoryDir, getUserAgentsDir } from '@/core/config/PathManager';
import { HookRegistry } from '@/hooks/HookRegistry';
import { AgentLoop } from '@/core/agent/AgentLoop';
import { StateTracker } from '@/core/state/StateTracker';
import { TaskOrchestrator } from '@/core/task/TaskOrchestrator';
import { ChatSession, type SessionCallbacks } from './ChatSession';
import { SessionStateMachine } from '@/core/state/SessionStateMachine';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
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
import { MemoryManager } from '@/core/memory/MemoryManager';
import { registerMemoryManager, setMemoryInitError } from '@/core/memory/globals';
import { UpdatePersonaTool } from '@/core/tools/UpdatePersonaTool';
import { SubAgentResultStore } from '@/core/memory/SubAgentResultStore';
import { MCPManager, TiangongMarket, MCPInstaller, UpdateChecker } from '@/mcp';
import { SkillInstaller, SkillRegistry } from '@/core/skills';

const log = logger.child({ module: 'SessionFactory' });

export interface SessionOptions {
  userId?: string;
  userName?: string;
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
  private _scheduler: any = null;

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

    // 3.5. Skill 系统
    // SkillRegistry: 所有 Skill 的唯一注册入口
    this.container.register('skillRegistry', () => new SkillRegistry({ autoLoad: false }));
    log.debug('SkillRegistry registered');

    // 3.6. MCP 商城模块
    // mcpManager 是 MCP 运行时的统一入口（单例）
    this.container.register('mcpManager', () => MCPManager.getInstance());
    log.debug('MCPManager registered');

    // tiangongMarket + mcpInstaller 仅在配置了 marketplace baseUrl 时才注册
    const marketplaceConfig = config.mcp?.marketplace;
    if (marketplaceConfig?.enabled !== false && marketplaceConfig?.baseUrl) {
      this.container.register('tiangongMarket', () => new TiangongMarket({
        baseUrl: marketplaceConfig.baseUrl,
        apiKey: marketplaceConfig.apiKey,
      }));
      log.debug('TiangongMarket registered');

      this.container.register('mcpInstaller', async () => {
        const market = await this.container.resolve<TiangongMarket>('tiangongMarket');
        const mgr = await this.container.resolve<MCPManager>('mcpManager');
        return new MCPInstaller(market, mgr);
      });
      log.debug('MCPInstaller registered');

      this.container.register('skillInstaller', async () => {
        const market = await this.container.resolve<TiangongMarket>('tiangongMarket');
        const registry = await this.container.resolve<SkillRegistry>('skillRegistry');
        return new SkillInstaller(market, registry);
      });
      log.debug('SkillInstaller registered');

      this.container.register('updateChecker', async () => {
        const market = await this.container.resolve<TiangongMarket>('tiangongMarket');
        const mgr = await this.container.resolve<MCPManager>('mcpManager');
        const registry = await this.container.resolve<SkillRegistry>('skillRegistry');
        return new UpdateChecker(market, mgr, registry);
      });
      log.debug('UpdateChecker registered');
    } else {
      log.debug('Marketplace config not found or disabled — skipping TiangongMarket/MCPInstaller');
    }

    // 4. 注入权限控制器
    const registry = await this.container.resolve<IToolRegistry>('toolRegistry');
    const permissionController = await this.container.resolve<IPermissionController>('permissionController');
    registry.setPermissionController?.(permissionController);

    // 4.5. 注册 AgentFactory（统一 Agent 创建入口）
    this.container.registerSingleton('agentFactory', () => new AgentFactory(registry));

    // 5. 预先 resolve layeredPromptBuilder，确保它进入 singleton 缓存
    const layeredPromptBuilder = await this.container.resolve('layeredPromptBuilder') as import('@/core/prompt/LayeredPromptBuilder').LayeredPromptBuilder;

    // 6. 注册高级工具（传入 layeredPromptBuilder，确保 sub-agent 也能用分层 prompt）
    await this.registerAdvancedTools(config, options, agentId, layeredPromptBuilder);
    const hookRegistry = await this.container.resolve<HookRegistry>('hookRegistry');
    const agentRegistry = await this.container.resolve('agentRegistry') as import('@/core/agent/AgentRegistry').AgentRegistry;

    // 7. 创建 StateTracker（旧路径）/ SessionStateMachine（新路径）
    const stateTracker = new StateTracker();
    const useStateMachine = process.env.USE_SESSION_STATE_MACHINE !== 'false';
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

    // 从 agent YAML 配置获取工具白名单
    const cfgMgr = getConfigManager();
    const agentCfg = cfgMgr.getAgentConfig(this.agentId);
    const agentTools = agentCfg?.tools
      ? (agentCfg.tools as Array<{ name: string }>).map(t => t.name)
      : [];

    // 先构建 prompt 以获取 L0 组件声明的 requiredTools（如 memory_search、memory_store）
    let promptRequiredTools: string[] = [];
    let systemPrompt: string | undefined;
    try {
      const prompt = await layeredPromptBuilder.build({ persona: (config as any).persona });
      if (prompt.prompt) {
        systemPrompt = prompt.prompt;
        promptRequiredTools = prompt.requiredTools || [];
        log.info(`Main agent prompt built: ${prompt.components.length} components, ~${prompt.estimatedTokens} tokens, requiredTools=[${promptRequiredTools.join(', ')}]`);
      }
    } catch (err) {
      log.warn('Failed to build initial system prompt:', err);
    }

    // 合并 agent 配置工具 + prompt 要求的工具，再自动补齐
    const allTools = [...new Set([...agentTools, ...promptRequiredTools])];
    const augmentedTools = augmentToolList(allTools);

    const trackedRegistry = new FilteredToolRegistry(
      registry,
      augmentedTools,
      { agentId: this.agentId, agentName: this.agentId },
      process.cwd(),
    );

    const agentLoop = new AgentLoop(provider, trackedRegistry, agentConfig, userId);
    agentLoop.setHookRegistry(hookRegistry);

    if (systemPrompt) {
      agentLoop.getContextManager().updateSystemPrompt(systemPrompt);
    }

    // 11. 初始化 TaskCompletionHandler — 后台任务完成通知
    // 后台任务完成时自动注入到 system prompt，主 agent 空闲时自动触发汇总
    const contextManager = agentLoop.getContextManager();
    const completionHandler = taskOrchestrator.initCompletionHandler(contextManager);

    // 12. 初始化 MemoryManager 并注入到各模块
    await this.initMemoryManager(config, contextManager, layeredPromptBuilder, userId, options.userName, hookRegistry, provider, options.embeddingProvider ?? null);

    // 12.5 接线 persona 更新回调
    const updatePersonaTool = registry.get('update_persona') as UpdatePersonaTool | undefined;
    if (updatePersonaTool) {
      updatePersonaTool.setOnUpdate(async (persona) => {
        // 1. 持久化到 config.json
        const configPath = getUserConfigPath(userId);
        try {
          const raw = JSON.parse(await readFile(configPath, 'utf-8'));
          raw.persona = persona;
          await writeFile(configPath, JSON.stringify(raw, null, 2), 'utf-8');
          log.info('Persona config saved');
        } catch (err) {
          log.error('Failed to save persona config:', err);
        }

        // 2. 重建 system prompt 并即时生效
        try {
          const prompt = await layeredPromptBuilder.build({ persona });
          if (prompt.prompt) {
            agentLoop.getContextManager().updateSystemPrompt(prompt.prompt);
            log.info('System prompt updated with new persona');
          }
        } catch (err) {
          log.error('Failed to rebuild prompt with persona:', err);
        }
      });
    }

    // 14. 初始化 TodoManager（用户维度隔离）
    getTodoManager(userId);

    // 15. 创建会话
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

    // 15.5. 接线：异步任务生命周期 → SessionStateMachine
    // 确保 _pendingAsyncTaskIds 正确追踪异步任务，handleAgentCompleted() 能正确进入 waiting_async
    if (stateMachine) {
      // 异步子 agent 启动时注册到状态机
      const unsubStart = eventBus.on(XuanjiEvent.HOOK_SUBAGENT_START, (ctx: any) => {
        if (ctx?.data?.isAsync) {
          stateMachine.registerAsyncTask(ctx.subAgentId);
        }
      });
      // 异步任务完成时通知状态机
      const unsubComplete = eventBus.on(XuanjiEvent.ASYNC_TASK_COMPLETED, (payload: any) => {
        const taskId = payload?.subAgentId || payload?.groupId;
        if (taskId) {
          stateMachine.completeAsyncTask(taskId);
          stateMachine.transition({ type: 'ASYNC_TASK_COMPLETED', taskId });
        }
      });
      const unsubFail = eventBus.on(XuanjiEvent.ASYNC_TASK_FAILED, (payload: any) => {
        const taskId = payload?.subAgentId || payload?.groupId;
        if (taskId) {
          stateMachine.completeAsyncTask(taskId);
          stateMachine.transition({ type: 'ASYNC_TASK_COMPLETED', taskId });
        }
      });
      // 将取消订阅挂在 session 上，session 销毁时清理
      (session as any)._stateMachineEventUnsubs = [unsubStart, unsubComplete, unsubFail];
    }

    // 16. 将 scheduler 挂到 session 上，供 agent-bridge 接线 sessionTrigger
    if (this._scheduler) {
      (session as any)._scheduler = this._scheduler;
    }

    log.info('Session created successfully');
    return session;
  }

  private async registerAdvancedTools(config: AppConfig, options: SessionOptions, agentId: string, layeredPromptBuilder?: import('@/core/prompt/LayeredPromptBuilder').LayeredPromptBuilder): Promise<void> {
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
        layeredPromptBuilder,
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
        layeredPromptBuilder,
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

  private async initMemoryManager(
    config: AppConfig,
    contextManager: any,
    layeredPromptBuilder: import('@/core/prompt/LayeredPromptBuilder').LayeredPromptBuilder,
    userId: string,
    userName: string | undefined,
    hookRegistry: HookRegistry,
    provider: ILLMProvider,
    embeddingProvider: EmbeddingProviderInterface | null,
  ): Promise<void> {
    try {
      // 确保记忆目录存在（better-sqlite3 不会自动创建父目录）
      const memDir = getUserMemoryDir(userId);
      if (!existsSync(memDir)) {
        mkdirSync(memDir, { recursive: true });
      }

      // 创建 CheapLLMProvider — 分别加载 memory-manager 和 context-compressor 配置
      const { CheapLLMProvider } = await import('@/core/providers/CheapLLMProvider');
      const { parse: parseYaml } = await import('yaml');

      const loadAgentModel = async (agentId: string, defaults: { model: string; temperature: number; maxTokens: number }) => {
        try {
          const yamlPath = join(getUserAgentsDir(userId), `${agentId}.yaml`);
          if (!existsSync(yamlPath)) return defaults;
          let c = parseYaml(readFileSync(yamlPath, 'utf-8'));

          // 合并 agent-overrides/json5（与 ConfigManager 三层合并逻辑一致）
          const overridesDir = join(getUserAgentsDir(userId), '..', 'agent-overrides');
          const overridePath = join(overridesDir, `${agentId}.json5`);
          if (existsSync(overridePath)) {
            const JSON5 = await import('json5');
            const override = JSON5.default.parse(readFileSync(overridePath, 'utf-8'));
            if (override.model) {
              c.model = { ...c.model, ...override.model };
            }
            if (override.provider) {
              c.provider = { ...c.provider, ...override.provider };
            }
          }

          if (c?.model?.primary) {
            // apiKey/baseURL 优先取 agent config，没有则回退到主 provider 配置
            const apiKey = c.provider?.apiKey || config.provider.apiKey;
            const baseURL = c.provider?.baseURL || config.provider.baseURL;
            if (!apiKey || !baseURL) {
              throw new Error(`[${agentId}] provider.apiKey 或 baseURL 未配置，请在 agent-overrides/${agentId}.json5 中设置`);
            }
            return {
              model: c.model.primary as string,
              temperature: (c.model.temperature ?? defaults.temperature) as number,
              maxTokens: (c.model.maxTokens ?? defaults.maxTokens) as number,
              apiKey,
              baseURL,
            };
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error(`加载 ${agentId} 配置失败: ${msg}`);
          throw err;
        }
        throw new Error(`[${agentId}] 未找到有效的 model.primary 配置`);
      };

      // 记忆提取 → memory-manager agent
      const memCfg = await loadAgentModel('memory-manager', {
        model: config.provider.model, temperature: 0.3, maxTokens: 1024,
      });
      const cheapLLM = new CheapLLMProvider(provider, {
        model: memCfg.model,
        apiKey: memCfg.apiKey,
        baseURL: memCfg.baseURL,
        temperature: memCfg.temperature,
        maxTokens: memCfg.maxTokens,
      });
      log.info(`Memory LLM: ${memCfg.model}`);

      // 上下文压缩 → context-compressor agent
      const compCfg = await loadAgentModel('context-compressor', {
        model: config.provider.model, temperature: 0.3, maxTokens: 1024,
      });
      const compressionLLM = new CheapLLMProvider(provider, {
        model: compCfg.model,
        apiKey: compCfg.apiKey,
        baseURL: compCfg.baseURL,
        temperature: compCfg.temperature,
        maxTokens: compCfg.maxTokens,
      });
      log.info(`Compression LLM: ${compCfg.model}`);

      // 记忆提取用的 systemPrompt（从 memory-manager.yaml 加载）
      let memoryExtractionPrompt: string | undefined;
      // 上下文压缩用的 systemPrompt（从 context-compressor.yaml 加载）
      let compressionPrompt: string | undefined;

      // 创建 SemanticIndex（如果 embeddingProvider 可用）
      let semanticIndex: any = undefined;
      if (embeddingProvider) {
        const { SemanticIndex } = await import('@/core/memory/SemanticIndex');
        semanticIndex = new SemanticIndex(embeddingProvider, memDir);
        await semanticIndex.init();
      }

      // 加载 memory-manager 模板的 systemPrompt，注入到 MemoryManager
      try {
        const memTemplatePath = join(getUserAgentsDir(userId), 'memory-manager.yaml');
        if (existsSync(memTemplatePath)) {
          const memTemplate = parseYaml(readFileSync(memTemplatePath, 'utf-8'));
          if (memTemplate?.systemPrompt) {
            memoryExtractionPrompt = memTemplate.systemPrompt as string;
          }
        }
      } catch (err) {
        log.warn('加载 memory-manager.yaml systemPrompt 失败:', err);
      }

      // 加载 context-compressor 模板的 systemPrompt
      try {
        const compTemplatePath = join(getUserAgentsDir(userId), 'context-compressor.yaml');
        if (existsSync(compTemplatePath)) {
          const compTemplate = parseYaml(readFileSync(compTemplatePath, 'utf-8'));
          if (compTemplate?.systemPrompt) {
            compressionPrompt = compTemplate.systemPrompt as string;
          }
        }
      } catch (err) {
        log.warn('加载 context-compressor.yaml systemPrompt 失败:', err);
      }

      const dbPath = getUserMemoryPath(userId);
      const memoryManager = new MemoryManager(dbPath, cheapLLM, hookRegistry);
      memoryManager.compressionLLM = compressionLLM;
      memoryManager.memoryExtractionPrompt = memoryExtractionPrompt;
      memoryManager.compressionPrompt = compressionPrompt;
      memoryManager.provider = provider;
      await memoryManager.init();

      // 将用户 ID 注入 MemoryManager，用于知识图谱的"我"锚定
      memoryManager.setUserId(userId);

      // 如果 auth 提供了昵称，将用户实体从数字 ID 重命名为人类可读名称
      if (userName) {
        await memoryManager.setUserName(userName);
      }

      // 注入 SemanticIndex
      if (semanticIndex) {
        memoryManager.semanticIndex = semanticIndex;
      }

      // 创建 CareManager 并注入到 MemoryManager
      const { CareManager } = await import('@/core/memory/CareManager');
      const careManager = new CareManager(memoryManager.dbInstance, memoryManager.episodicMemory);
      (memoryManager as any).careManager = careManager;

      // 注入到 ContextManager（archiveDelegate）
      contextManager.setArchiveDelegate(memoryManager);

      // 注入到 LayeredPromptBuilder（重新获取 builder 以设置 memoryManager）
      (layeredPromptBuilder as any).memoryManager = memoryManager;

      // 注册全局引用（供工具使用）
      registerMemoryManager(memoryManager);

      // 初始化 SubAgentResultStore 并注入到 MemoryManager
      const subAgentDir = join(getUserMemoryDir(userId), 'subagent_results');
      const subAgentStore = new SubAgentResultStore(subAgentDir);
      memoryManager.subAgentStore = subAgentStore;

      // 通过 EventBus 监听 Agent 工具结束事件，桥接到 SubAgentResultStore
      const subAgentToolNames = ['task', 'agent_team'];
      eventBus.on(XuanjiEvent.AGENT_TOOL_END, (payload: any) => {
        if (payload.name && subAgentToolNames.includes(payload.name)) {
          subAgentStore.store({
            sessionId: payload.agentId || '',
            agentId: payload.agentId || payload.name,
            toolName: payload.name,
            input: payload.metadata?.input || {},
            output: payload.result,
            duration: 0,
            timestamp: Date.now(),
            error: payload.isError ? payload.result : undefined,
          }).catch(err => log.error('SubAgentResultStore failed:', err));
        }
      });

      // ─── 记忆事件订阅者（日志 + 统计） ────────────────────
      eventBus.on(XuanjiEvent.MEMORY_STORED, (payload: any) => {
        log.debug(`[Memory] Stored: ${payload.type} id=${payload.id} scene=${payload.scene_tag || '-'}`);
      });
      eventBus.on(XuanjiEvent.MEMORY_SEARCHED, (payload: any) => {
        log.debug(`[Memory] Searched: "${payload.query}" type=${payload.type} → ${payload.resultCount} results`);
      });
      eventBus.on(XuanjiEvent.MEMORY_EXTRACTED, (payload: any) => {
        log.info(`[Memory] Extracted from session=${payload.sessionId}: ${payload.entityCount}E/${payload.factCount}F/${payload.eventCount}Ev`);
      });
      eventBus.on(XuanjiEvent.MEMORY_LEARNING_PROGRESS, (payload: any) => {
        const emoji = payload.stage === 'started' ? '▶' : payload.stage === 'completed' ? '✓' : '✗';
        log.info(`[Memory] Learning ${emoji} goal="${payload.goal}" stage=${payload.stage}${payload.error ? ' err=' + payload.error : ''}`);
      });

      // ─── 启动 Scheduler ────────────────────────────────────
      try {
        const { Scheduler } = await import('@/core/scheduler/Scheduler');
        const scheduler = new Scheduler(
          memoryManager.dbInstance,
          undefined, // sessionManager
          cheapLLM,
          undefined, // learnTool — 稍后注入
          eventBus,
          new Set([userId]),
        );

        // 注册自定义 action 处理器
        scheduler.customActions.set('subagent-cleanup', async () => {
          const count = await subAgentStore.cleanExpired();
          if (count > 0) {
            log.info(`[Memory] SubAgentResultStore cleaned ${count} expired entries`);
            eventBus.emitSync(XuanjiEvent.MEMORY_MAINTENANCE, {
              action: 'subagent-cleanup',
              detail: `Cleaned ${count} expired sub-agent results`,
            });
          }
        });

        scheduler.customActions.set('memory-maintenance', async () => {
          log.info('[Memory] Weekly maintenance triggered — sending to agent');
          try {
            const stats = memoryManager.getStats();
            const message = `请执行记忆维护任务：

## 当前记忆统计
- 实体数: ${stats.entityCount}
- 事实数: ${stats.factCount}
- 事件数: ${stats.eventCount}
- 关系数: ${stats.relationCount}
- 叙事数: ${stats.episodeCount}

请委派记忆管理机器人完成以下任务：

1. **去重**：查找 name+type 重复的实体，合并为一个，更新所有关联关系
2. **合并**：查找 content 相似度高的 facts（Jaccard > 0.8），合并为单一事实
3. **关联**：检查是否存在以下情况，如果有则建立 relation：
   - 两个实体有相同或相似的 category 但没有关联关系 → 建立 relation(实体A -同属于→ 类别)
   - 事件中提到的实体之间没有明确的关系 → 根据事件上下文推断并建立
   - 用户频繁同时提到两个实体（多次共现）→ 建立 relation(实体A -相关于→ 实体B)
4. **清理**：标记 importance <= 2 且超过 90 天未更新的低价值数据`;

            if (scheduler.sessionTrigger) {
              await scheduler.sessionTrigger(message);
            } else {
              log.warn('[Memory] No sessionTrigger available for maintenance');
            }
          } catch (err) {
            log.error('[Memory] Weekly maintenance failed:', err);
          }
        });

        // 注册默认定时任务（系统级任务，带 system: true 标记）
        await scheduler.addCron({
          id: 'subagent-cleanup',
          userId,
          type: 'daily',
          hour: 1,
          minute: 0,
          action: 'custom',
          params: { handler: 'subagent-cleanup' },
          system: true,
        });
        await scheduler.addCron({
          id: 'memory-maintenance',
          userId,
          type: 'daily',
          hour: 3,
          minute: 0,
          action: 'custom',
          params: { handler: 'memory-maintenance' },
          system: true,
        });

        await scheduler.start();
        (memoryManager as any).scheduler = scheduler;
        this._scheduler = scheduler;
        log.info('Scheduler started with default memory jobs');
      } catch (err) {
        log.warn('Scheduler initialization failed (non-critical):', err);
      }

      log.info('MemoryManager + CareManager + Scheduler + SubAgentResultStore initialized');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Failed to initialize MemoryManager: ${msg}`);
      log.error(`Memory DB path: ${getUserMemoryPath(userId)}`);
      console.error('[MemoryManager] INIT FAILED:', msg);
      console.error('[MemoryManager] DB path:', getUserMemoryPath(userId));
      if (err instanceof Error && err.stack) {
        console.error('[MemoryManager] Stack:', err.stack);
      }
      setMemoryInitError(msg);
    }
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
