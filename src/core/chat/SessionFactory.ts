// ============================================================
// SessionFactory - 会话工厂
// ============================================================

import type { AppConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { IPermissionController } from '@/permission/types';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { DependencyContainer } from '@/core/di';
import { ConfigLoader } from '@/core/config/ConfigLoader';
import { getConfigManager } from '@/core/config/ConfigManager';
import { setRuntimeConfig } from '@/core/config/RuntimeConfig';
import { ProviderManager } from '@/provider/ProviderManager';
import { ToolConfigManager } from '@/tools/ToolConfigManager';
import { createDefaultRegistry } from '@/tools/ToolRegistry';
import { PermissionController } from '@/permission/PermissionController';
import { SessionManager } from '@/session/SessionManager';
import { getUserSessionsDir, getUserConfigPath, getUserMemoryPath, getUserMemoryDir } from '@/core/config/PathManager';
import { HookRegistry } from '@/hooks/HookRegistry';
import { StateTracker } from '@/core/state/StateTracker';
import { TaskOrchestrator } from '@/core/task/TaskOrchestrator';
import { ChatSession, type SessionCallbacks } from './ChatSession';
import { SessionStateMachine } from '@/core/state/SessionStateMachine';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import { logger } from '@/core/logger';
import { TaskTool } from '@/tools/TaskTool';
import { TeamTool } from '@/tools/TeamTool';
import { ListAgentsTool } from '@/tools/ListAgentsTool';
import { ListScenesTool } from '@/tools/ListScenesTool';
import { MatchAgentTool } from '@/tools/MatchAgentTool';
import { MatchSceneTool } from '@/tools/MatchSceneTool';
import type { EmbeddingProviderInterface } from '@/core/embedding/EmbeddingProvider';
import { augmentToolList } from '@/tools/FilteredToolRegistry';
import { getTodoManager } from '@/tools/TodoManager';
import { AgentFactory } from '@/agent/factory/AgentFactory';
import { MemoryManager } from '@/memory/MemoryManager';
import { registerMemoryManager, setMemoryInitError } from '@/memory/globals';
import { UpdatePersonaTool } from '@/tools/UpdatePersonaTool';
import { SubAgentResultStore } from '@/memory/SubAgentResultStore';
import { MCPManager, TiangongMarket, MCPInstaller, UpdateChecker } from '@/mcp';
import { SkillInstaller, SkillRegistry, SkillSandbox } from '@/skills';
import { InstallTool } from '@/tools/InstallTool';
import { UninstallTool } from '@/tools/UninstallTool';

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

/**
 * 构建 MCP Tools 的 system prompt 段（精简版，引导 agent 自行发现）
 * 不再将所有 MCP 工具列在 prompt 中，而是提示使用 mcp_settings 和 mcp_call
 */
function buildMCPSystemPromptSection(registry: IToolRegistry): string {
  const mcpSchemas = (registry as any).getMCPSchemas?.() ?? [];
  if (mcpSchemas.length === 0) return '';

  // 统计服务器和工具数量
  const servers = new Set<string>();
  let toolCount = 0;
  for (const s of mcpSchemas) {
    servers.add(s.serverName);
    toolCount++;
  }

  const sections: string[] = [
    '',
    '## MCP Tools',
    '',
    `You have ${toolCount} MCP tool(s) across ${servers.size} server(s): ${[...servers].map(s => `\`${s}\``).join(', ')}.`,
    'Use `mcp_settings(list)` to discover available MCP servers and their tools at runtime.',
    'Use `mcp_call(server="<name>", tool="<name>", arguments={...})` to call a specific MCP tool.',
  ];

  return sections.join('\n');
}

/**
 * 构建 Skills 的 system prompt 段（精简版，引导 agent 自行发现）
 * 不再将所有 Skill 列在 prompt 中，而是提示使用 skill_manage 和 skill_call
 */
function buildSkillSystemPromptSection(skillRegistry: any): string {
  if (!skillRegistry) return '';
  const skills: any[] = skillRegistry.list?.() ?? [];
  const enabled = skills.filter((s: any) => s.enabled !== false);
  if (enabled.length === 0) return '';

  const sections: string[] = [
    '',
    '## Skills',
    '',
    `You have ${enabled.length} installed Skill(s). Use \`skill_manage(list)\` to discover available Skills and their descriptions at runtime.`,
    'Use `skill_call(skillId="<id>")` to invoke a Skill once you know its ID.',
    'Use the backtick-quoted `id` for `uninstall` and `skill_call`.',
  ];

  return sections.join('\n');
}

function appendCapabilityPromptSections(systemPrompt: string | undefined, registry: IToolRegistry, skillRegistry: any): string | undefined {
  if (!systemPrompt) return systemPrompt;
  const sections = [
    buildMCPSystemPromptSection(registry),
    buildSkillSystemPromptSection(skillRegistry),
  ].filter(Boolean);
  return sections.length > 0 ? `${systemPrompt}\n${sections.join('\n')}` : systemPrompt;
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

    log.debug(`Creating session for user: ${userId}, agent: ${agentId}`);

    // 1. 加载配置
    const config = await this.loadConfig({ ...options, userId, agentId });
    this.container.registerSingleton('config', config);
    setRuntimeConfig(config);
    log.debug('RuntimeConfig initialized');

    // 2. 基础设施
    this.container.register('sessionManager', () => new SessionManager({
      sessionConfig: config.session,
      baseDir: getUserSessionsDir(userId),
    }));
    this.container.register('hookRegistry', () => new HookRegistry());

    // 3. 领域服务
    this.container.register('provider', async () => {
      if (options.provider) return options.provider;
      const { ProviderManager } = await import('@/core/providers/ProviderManager');
      return ProviderManager.getProvider(
        config.provider as any,
        config.fallbackProvider as any,
      );
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
    this.container.register('skillRegistry', () => new SkillRegistry({ autoLoad: true }));
    log.debug('SkillRegistry registered');

    // 3.6. MCP 商城模块
    // mcpManager 是 MCP 运行时的统一入口（单例）
    this.container.register('mcpManager', () => MCPManager.getInstance());
    log.debug('MCPManager registered');

    // tiangongMarket + mcpInstaller：优先用配置的 URL，否则用默认地址
    const marketplaceConfig = config.mcp?.marketplace?.baseUrl
      ? config.mcp.marketplace
      : { baseUrl: 'https://shibit.net/api/tiangong' };
    if (marketplaceConfig.enabled !== false && marketplaceConfig.baseUrl) {
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

      this.container.register('skillSandbox', async () => {
        return new SkillSandbox();
      });
      log.debug('SkillSandbox registered');

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
    this.container.registerSingleton('agentFactory', new AgentFactory(registry));

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

    // 9. 创建 AgentLoop（通过 AgentFactory 统一创建）
    const provider = await this.container.resolve<ILLMProvider>('provider');

    // 从 agent YAML 配置获取工具白名单
    const cfgMgr = getConfigManager();
    const agentCfg = cfgMgr.getAgentConfig(this.agentId);
    const agentTools = agentCfg?.tools
      ? (agentCfg.tools as Array<{ name: string }>).map(t => t.name)
      : [];

    // 加载媒体生成工具的配置
    // 优先级：RuntimeConfig.modelProviders.media > Agent YAML tools[].config
    ToolConfigManager.getInstance().loadFromModelProviders();
    if (agentCfg?.tools) {
      ToolConfigManager.getInstance().loadFromAgentConfig(
        agentCfg.tools as Array<{ name: string; config?: Record<string, unknown> }>,
      );
    }

    // 先构建 prompt 以获取 L0 组件声明的 requiredTools（如 memory_search、memory_store）
    let promptRequiredTools: string[] = [];
    let systemPrompt: string | undefined;
    try {
      const prompt = await layeredPromptBuilder.build({ persona: (config as any).persona });
      if (prompt.prompt) {
        systemPrompt = prompt.prompt;
        promptRequiredTools = prompt.requiredTools || [];
        log.debug(`Main agent prompt built: ${prompt.components.length} components, ~${prompt.estimatedTokens} tokens, requiredTools=[${promptRequiredTools.join(', ')}]`);
      }
    } catch (err) {
      log.warn('Failed to build initial system prompt:', err);
    }

    // 同步 MCP 工具元数据到 registry
    try {
      await (registry as any).syncMCPTools(MCPManager.getInstance());
    } catch (err) {
      log.warn('Failed to sync MCP tools during session creation:', err);
    }

    let skillRegistry: any = null;
    try { skillRegistry = await this.container.resolve('skillRegistry'); } catch { /* not registered */ }
    systemPrompt = appendCapabilityPromptSections(systemPrompt, registry, skillRegistry);

    // 合并 agent 配置工具 + prompt 要求的工具 + MCP/Skill gateway
    const mcpSchemas = (registry as any).getMCPSchemas?.() ?? [];
    const mcpGatewayTools = mcpSchemas.length > 0 ? ['mcp_call'] : [];
    const skillCount = skillRegistry?.list?.().filter((s: any) => s.enabled !== false).length ?? 0;
    const skillGatewayTools = skillCount > 0 ? ['skill_call'] : [];
    const alwaysAvailable = ['mcp_call', 'skill_call', 'skill_manage', 'mcp_settings', 'install', 'uninstall'];
    const allTools = [...new Set([...agentTools, ...promptRequiredTools, ...mcpGatewayTools, ...skillGatewayTools, ...alwaysAvailable])];
    const augmentedTools = augmentToolList(allTools);

    // 通过 AgentFactory 创建主 AgentLoop
    const agentFactory = await this.container.resolve<AgentFactory>('agentFactory');
    agentFactory.setHookRegistry(hookRegistry);
    agentFactory.setLayeredPromptBuilder(layeredPromptBuilder);
    // 注入兜底 provider 配置（仅对系统 agent 生效）
    console.log(`[DIAG] SessionFactory: config.fallbackProvider=`, JSON.stringify(config.fallbackProvider));
    if (config.fallbackProvider?.adapter) {
      agentFactory.setFallbackProviderConfig({
        adapter: config.fallbackProvider.adapter,
        apiKey: config.fallbackProvider.apiKey,
        baseURL: config.fallbackProvider.baseURL,
        model: config.fallbackProvider.model,
      });
    }
    // 设置父 provider，供子 agent 继承
    agentFactory.setParentProvider(provider);

    const { agentLoop, config: agentConfig } = await agentFactory.createMainAgent(this.agentId, {
      parentProvider: provider,
      toolWhitelist: augmentedTools,
      strictTools: true,
      systemPromptOverride: systemPrompt,
      workingDir: process.cwd(),
      maxIterations: config.agent?.maxIterations,
      compressor: config.agent?.compressor ? {
        enabled: config.agent.compressor.enabled ?? false,
        keepRecentRounds: 2,
        compressionThreshold: 0.8,
        minMessagesToCompress: 10,
        summaryMaxLength: 500,
      } : undefined,
    });
    // 设置父 config，供子 agent 继承
    agentFactory.setParentConfig(agentConfig);

    // 11. 初始化 TaskCompletionHandler — 后台任务完成通知
    // 后台任务完成时自动注入到 system prompt，主 agent 空闲时自动触发汇总
    const contextManager = agentLoop.getContextManager();
    const completionHandler = taskOrchestrator.initCompletionHandler(contextManager);

    // 12. 初始化 MemoryManager 并注入到各模块
    await this.initMemoryManager(config, contextManager, layeredPromptBuilder, userId, options.userName, hookRegistry, provider, options.embeddingProvider ?? null, agentConfig);

    try {
      const rebuiltPrompt = await layeredPromptBuilder.build({ persona: (config as any).persona });
      const promptWithCapabilities = appendCapabilityPromptSections(rebuiltPrompt.prompt, registry, skillRegistry);
      if (promptWithCapabilities) {
        contextManager.updateSystemPrompt(promptWithCapabilities);
        log.debug(`Main agent prompt rebuilt after MemoryManager init: ${rebuiltPrompt.components.length} components, ~${rebuiltPrompt.estimatedTokens} tokens`);
      }
    } catch (err) {
      log.warn('Failed to rebuild system prompt after MemoryManager init:', err);
    }

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
          log.debug('Persona config saved');
        } catch (err) {
          log.error('Failed to save persona config:', err);
        }

        // 2. 重建 system prompt 并即时生效
        try {
          const prompt = await layeredPromptBuilder.build({ persona });
          const updatedPrompt = appendCapabilityPromptSections(prompt.prompt, registry, skillRegistry);
          if (updatedPrompt) {
            agentLoop.getContextManager().updateSystemPrompt(updatedPrompt);
            log.debug('System prompt updated with new persona');
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
      log.debug('TaskCompletionHandler onRun + onAutoSummarize + onCitationData hooked');
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

    // 17. MCP 工具热重载 — 延迟到 init-complete 之后（避免阻塞会话初始化）
    // 见 agent-bridge.ts handleInit 中的 scheduleMCPToolSync()

    log.debug('Session created successfully');
    return session;
  }

  private async registerAdvancedTools(config: AppConfig, options: SessionOptions, agentId: string, layeredPromptBuilder?: import('@/core/prompt/LayeredPromptBuilder').LayeredPromptBuilder): Promise<void> {
    const registry = await this.container.resolve<IToolRegistry>('toolRegistry');
    const provider = await this.container.resolve<ILLMProvider>('provider');
    const agentRegistry = await this.container.resolve('agentRegistry') as import('@/core/agent/AgentRegistry').AgentRegistry;
    const promptRegistry = await this.container.resolve('promptRegistry') as import('@/core/prompt/PromptComponentRegistry').PromptComponentRegistry;
    const hookRegistry = await this.container.resolve<HookRegistry>('hookRegistry');
    const providerManager = ProviderManager;

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

    const matchSceneTool = new MatchSceneTool();
    matchSceneTool.setEmbedder(options.embeddingProvider ?? null);
    // 从 PromptComponentRegistry 获取场景列表（L1 组件）
    const sceneComponents = Array.from(promptRegistry.getComponents().values())
      .filter(c => c.layer === 'L1' && !c.internal)
      .flatMap(c => (c.scenes ?? [c.id]).map(scene => ({
        scene,
        description: c.match?.description,
        keywords: c.match?.keywords,
      })));
    matchSceneTool.setSceneList(sceneComponents);
    registry.register(matchSceneTool);

    log.debug('Advanced tools registered (including list_agents, match_agent, list_scenes, and match_scene)');

    const mcpSettingsTool = registry.get('mcp_settings') as any;
    if (mcpSettingsTool && typeof mcpSettingsTool.setDependencies === 'function') {
      const mcpManager = await this.container.resolve<MCPManager>('mcpManager');
      mcpSettingsTool.setDependencies({ mcpManager });
      log.debug('MCPSettingsTool dependencies injected');
    }

    const skillManageTool = registry.get('skill_manage') as any;
    if (skillManageTool && typeof skillManageTool.setDependencies === 'function') {
      const skillRegistry = await this.container.resolve<SkillRegistry>('skillRegistry');
      let tiangongMarket: TiangongMarket | undefined;
      try { tiangongMarket = await this.container.resolve<TiangongMarket>('tiangongMarket'); } catch { /* marketplace optional */ }
      skillManageTool.setDependencies({ skillRegistry, tiangongMarket });
      log.debug('SkillManageTool dependencies injected');
    }

    const skillCallTool = registry.get('skill_call') as any;
    if (skillCallTool && typeof skillCallTool.setDependencies === 'function') {
      const skillRegistry = await this.container.resolve<SkillRegistry>('skillRegistry');
      skillCallTool.setDependencies({ skillRegistry });
      log.debug('SkillCallTool dependencies injected');
    }

    // ── 注入 InstallTool / UninstallTool 的 marketplace 依赖 ─────
    try {
      const tiangongMarket = await this.container.resolve<TiangongMarket>('tiangongMarket');
      const mcpInstaller = await this.container.resolve<MCPInstaller>('mcpInstaller');
      const skillInstaller = await this.container.resolve<SkillInstaller>('skillInstaller');

      const installTool = registry.get('install') as InstallTool | undefined;
      if (installTool && typeof (installTool as any).setDependencies === 'function') {
        (installTool as InstallTool).setDependencies({
          market: tiangongMarket,
          mcpInstaller,
          skillInstaller,
        });
        log.debug('InstallTool marketplace dependencies injected');
      }

      const uninstallTool = registry.get('uninstall') as UninstallTool | undefined;
      if (uninstallTool && typeof (uninstallTool as any).setDependencies === 'function') {
        (uninstallTool as UninstallTool).setDependencies({
          mcpInstaller,
          skillInstaller,
        });
        log.debug('UninstallTool marketplace dependencies injected');
      }
    } catch (err) {
      log.debug('Marketplace not configured, InstallTool/UninstallTool running in degraded mode');
    }
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
    agentConfig: import('@/core/types').AgentConfig,
  ): Promise<void> {
    try {
      // 确保记忆目录存在（better-sqlite3 不会自动创建父目录）
      const memDir = getUserMemoryDir(userId);
      if (!existsSync(memDir)) {
        mkdirSync(memDir, { recursive: true });
      }

      // 通过 AgentFactory 统一创建 CheapLLMProvider
      const agentFactory = await this.container.resolve('agentFactory') as import('@/core/agent/factory/AgentFactory').AgentFactory;
      const cheapLLM = await agentFactory.createCheapLLMProvider('memory-manager', { temperature: 0.3, maxTokens: 1024 });

      // 创建 SemanticIndex（如果 embeddingProvider 可用）
      let semanticIndex: any = undefined;
      if (embeddingProvider) {
        const { SemanticIndex } = await import('@/core/memory/SemanticIndex');
        semanticIndex = new SemanticIndex(embeddingProvider, memDir);
        await semanticIndex.init();
      }

      const dbPath = getUserMemoryPath(userId);
      const memoryManager = new MemoryManager(dbPath, cheapLLM, hookRegistry);
      log.debug('[initMemoryManager] step=created');
      memoryManager.agentFactory = agentFactory;
      memoryManager.parentProvider = provider;
      memoryManager.parentConfig = agentConfig;
      memoryManager.layeredPromptBuilder = layeredPromptBuilder;
      await memoryManager.init();
      log.debug('[initMemoryManager] step=memoryManager.init done');
      // 处理上次未完成的记忆提取任务（进程意外退出补偿）
      memoryManager.processPendingExtractions().catch(err => log.error('processPendingExtractions failed:', err));

      // 将用户 ID 注入 MemoryManager，用于知识图谱的"我"锚定
      memoryManager.setUserId(userId);
      log.debug('[initMemoryManager] step=setUserId done');

      // 如果 auth 提供了昵称，将用户实体从数字 ID 重命名为人类可读名称
      if (userName) {
        await memoryManager.setUserName(userName);
        log.debug('[initMemoryManager] step=setUserName done');
      }

      // 确保用户实体已创建，作为知识图谱的根节点
      // 所有后续记忆（实体、事实、关系）都将锚定到此用户节点
      await memoryManager.ensureUserEntity();
      log.debug('[initMemoryManager] step=ensureUserEntity done');

      // 注入 SemanticIndex
      if (semanticIndex) {
        memoryManager.semanticIndex = semanticIndex;
      }
      log.debug('[initMemoryManager] step=semanticIndex done');

      // 创建 CareManager 并注入到 MemoryManager
      const { CareManager } = await import('@/core/memory/CareManager');
      const careManager = new CareManager(memoryManager.dbInstance, memoryManager.episodicMemory);
      (memoryManager as any).careManager = careManager;
      log.debug('[initMemoryManager] step=careManager done');

      // 注入到 ContextManager（archiveDelegate）
      contextManager.setArchiveDelegate(memoryManager);
      log.debug('[initMemoryManager] step=setArchiveDelegate done');

      // 注入到 LayeredPromptBuilder（重新获取 builder 以设置 memoryManager）
      (layeredPromptBuilder as any).memoryManager = memoryManager;
      log.debug('[initMemoryManager] step=layeredPromptBuilder.memoryManager done');

      // 注册全局引用（供工具使用）
      registerMemoryManager(memoryManager);
      log.debug('[initMemoryManager] step=registerMemoryManager done');

      // 初始化 SubAgentResultStore 并注入到 MemoryManager
      const subAgentDir = join(getUserMemoryDir(userId), 'subagent_results');
      const subAgentStore = new SubAgentResultStore(subAgentDir);
      memoryManager.subAgentStore = subAgentStore;

      // ─── 注入 Skills & MCP 依赖到 MemoryManager（供 agent-bridge IPC 访问） ───
      try {
        memoryManager.skillRegistry = await this.container.resolve<SkillRegistry>('skillRegistry');
      } catch (err) { log.warn('skillRegistry not registered:', err); }
      try {
        memoryManager.mcpManager = await this.container.resolve<MCPManager>('mcpManager');
        // MCP 初始化可能很慢（串行启动多个服务器），用 10 秒超时防止阻塞
        await Promise.race([
          memoryManager.mcpManager.initialize(),
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error('MCP init timeout (10s)')), 10000)),
        ]);
      } catch (err) { log.warn('mcpManager not registered or init failed:', err); }
      try {
        memoryManager.tiangongMarket = await this.container.resolve<TiangongMarket>('tiangongMarket');
        memoryManager.mcpInstaller = await this.container.resolve<MCPInstaller>('mcpInstaller');
        memoryManager.skillInstaller = await this.container.resolve<SkillInstaller>('skillInstaller');
      } catch (err) { log.warn('tiangong dependencies not configured:', err); }

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
        log.debug(`[Memory] Extracted from session=${payload.sessionId}: ${payload.entityCount}E/${payload.factCount}F/${payload.eventCount}Ev`);
      });

      // ─── 启动 Scheduler ────────────────────────────────────
      try {
        const { Scheduler } = await import('@/core/scheduler/Scheduler');
        const scheduler = new Scheduler(
          memoryManager.dbInstance,
          undefined, // sessionManager
          cheapLLM,
          eventBus,
          new Set([userId]),
          join(homedir(), '.xuanji', 'scheduler', userId), // 用户隔离的 jobs 存储目录
        );

        // 注册自定义 action 处理器
        scheduler.customActions.set('subagent-cleanup', async () => {
          const count = await subAgentStore.cleanExpired();
          if (count > 0) {
            log.debug(`[Memory] SubAgentResultStore cleaned ${count} expired entries`);
            eventBus.emitSync(XuanjiEvent.MEMORY_MAINTENANCE, {
              action: 'subagent-cleanup',
              detail: `Cleaned ${count} expired sub-agent results`,
            });
          }
        });

        scheduler.customActions.set('memory-maintenance', async () => {
          log.debug('[Memory] Daily maintenance triggered');
          try {
            memoryManager.decayFactAccess();
            memoryManager.runDailyMaintenance();
          } catch (err) {
            log.error('[Memory] Daily maintenance failed:', err);
          }
        });

        scheduler.customActions.set('daily-llm-maintenance', async () => {
          log.debug('[Memory] Daily LLM maintenance triggered');
          try {
            await memoryManager.runMaintenanceAgent();
          } catch (err) {
            log.error('[Memory] Daily LLM maintenance failed:', err);
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
          id: 'memory-maintenance-daily',
          userId,
          type: 'daily',
          hour: 3,
          minute: 0,
          action: 'custom',
          params: { handler: 'memory-maintenance' },
          description: '每日记忆维护：置信度衰减 + 行为模式提取 + 话题静默标记',
          system: true,
        });

        await scheduler.addCron({
          id: 'memory-maintenance-daily-llm',
          userId,
          type: 'daily',
          hour: 3,
          minute: 30,
          action: 'custom',
          params: { handler: 'daily-llm-maintenance' },
          message: '请委派记忆管理机器人执行每日记忆深度精炼：1.去重 2.跨名用户识别 3.合并 4.关联 5.清理 6.画像更新',
          description: '每日记忆深度精炼：LLM 去重/合并/跨名用户识别 + 关系链接 + 数据清理 + 画像更新',
          system: true,
        });

        // scheduler.start() 延迟到 agent-bridge 接线 sessionTrigger 之后调用
        (memoryManager as any).scheduler = scheduler;
        this._scheduler = scheduler;
        log.debug('Scheduler created with default memory jobs (start deferred)');
      } catch (err) {
        log.warn('Scheduler initialization failed (non-critical):', err);
      }

      log.debug('MemoryManager + CareManager + Scheduler + SubAgentResultStore initialized');
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
