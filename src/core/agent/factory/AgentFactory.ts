/**
 * AgentFactory — Agent 工厂
 *
 * 职责：创建完整的、配置正确的 AgentLoop 实例。
 * 替代旧的 SubAgentFactory / TemporaryAgentFactory，统一主 Agent 和子 Agent 的创建流程。
 */

import type { ILLMProvider, IToolRegistry, AgentConfig } from '@/core/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import type { ConfigurableAgentConfig } from '@/core/agent/types';
import { AgentLoop } from '../AgentLoop';
import { SilentAgentLoop } from '../SilentAgentLoop';
import { logger } from '@/core/logger';
import { setLogContext } from '@/core/logger/implementations/PinoLogger';
import { getConfigManager, type ConfigManager } from '@/core/config/ConfigManager';
import { ProviderPool } from '@/core/providers/ProviderPool';
import type { LayeredPromptBuilder } from '@/core/prompt/LayeredPromptBuilder';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import { AcpProcessManager } from '@/core/acp/AcpProcessManager';
import { DEFAULT_SUBAGENT_TOOLS, augmentToolList } from '@/core/tools/FilteredToolRegistry';

const log = logger.child({ module: 'AgentFactory' });

/** 占位 Provider：允许新用户未配置 apiKey/baseURL 时也能初始化会话，访问设置页面 */
function createUnconfiguredProvider(agentName: string): ILLMProvider {
  return {
    name: 'unconfigured',
    models: [],
    isSupported: () => false,
    stream: async function* () {
      throw new Error(
        `Agent "${agentName}" 未配置 apiKey/baseURL，请在设置页面配置后重新初始化会话`,
      );
    },
  };
}

export interface TemporaryAgentOptions {
  role: string;
  capabilities: string[];
  scene?: string;
  taskDescription?: string;
  model?: string;
  parentConfig?: ConfigurableAgentConfig;
}

export interface AgentCreateOptions {
  parentProvider?: ILLMProvider;
  parentConfig?: AgentConfig;
  scene?: string;
  complexity?: 'simple' | 'standard' | 'complex';
  taskDescription?: string;
  depth?: number;
  toolWhitelist?: string[];
  workingDir?: string;
  timeout?: number;
  maxIterations?: number;
  streamToUser?: boolean;
  parentAgentId?: string;
  subAgentId?: string;
  /** 严格工具模式：仅使用 toolWhitelist，不合并 YAML config tools */
  strictTools?: boolean;
  /** 覆盖 maxTokens（上下文窗口大小） */
  maxTokens?: number;
  /** 覆盖 system prompt（跳过工厂内部的 prompt 构建） */
  systemPromptOverride?: string;
  /** 上下文压缩器配置（来自 session 级 global config） */
  compressor?: import('@/shared/types/agent').CompressorConfig;
}

export interface AgentInstance {
  agentLoop: AgentLoop;
  config: AgentConfig;
  subAgentId: string;
  depth: number;
}

export interface CreateAndRunOptions {
  task: string;
  timeout?: number;
  depth?: number;
  parentConfig?: AgentConfig;
  parentProvider?: ILLMProvider;
  systemPrompt?: string;
  scene?: string;
  /** 多场景列表（优先级高于 scene，会加载多个 L1 并拼接） */
  scenes?: string[];
  scenePrompt?: string;
  tools?: string[];
  skipSubAgentStartHook?: boolean;
  parentAgentId?: string;
  streamToUser?: boolean;
  workingDir?: string;
  maxIterations?: number;
  subAgentId?: string;
  /** 异步任务：主 agent 不等待，子 agent 输出走 TaskCompletionHandler；同步任务：主 agent 阻塞等待 */
  isAsync?: boolean;
  /** 强制走 in-process（跳过 ACP fork），用于 hierarchical leader 等需要完整工具权限的场景 */
  forceInProcess?: boolean;
  /** 严格工具模式：仅使用 whitelist 中的工具，不合并 YAML config tools */
  strictTools?: boolean;
  /** 覆盖 maxTokens（上下文窗口大小），用于层级策略 Leader 等需要更大预算的场景 */
  maxTokens?: number;
}

export interface CreateAndRunResult {
  result: string;
  tokensUsed: { input: number; output: number };
  duration: number;
  timedOut: boolean;
  iterations: number;
  success: boolean;
}

export type SubAgentResult = CreateAndRunResult;

export interface MemoryAgentCreateOptions {
  parentConfig?: AgentConfig;
  systemPrompt: string;
  workingDir?: string;
  maxIterations?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface AcpAgentCreateOptions {
  /** 父进程传入的配置（含 adapter, model, apiKey, baseURL 等） */
  parentConfig: Record<string, any>;
  systemPrompt?: string;
  tools?: string[];
  workingDir?: string;
  maxIterations?: number;
}

export class AgentFactory {
  private providerPool: ProviderPool;
  private layeredPromptBuilder: LayeredPromptBuilder | null = null;
  private baseRegistry: IToolRegistry;
  private hookRegistry: HookRegistry | null = null;
  private temporaryAgents = new Map<string, ConfigurableAgentConfig>();
  private _parentProvider?: ILLMProvider;
  private _parentConfig?: AgentConfig;
  private _fallbackProviderConfig?: { adapter: string; apiKey?: string; baseURL?: string; model?: string };

  constructor(baseRegistry: IToolRegistry) {
    this.baseRegistry = baseRegistry;
    this.providerPool = new ProviderPool(
      (config) => {
        const { createProviderByAdapter } = require('@/core/providers/ProviderRegistry');
        return createProviderByAdapter(config.adapter);
      },
    );
  }

  setLayeredPromptBuilder(builder: LayeredPromptBuilder): void {
    this.layeredPromptBuilder = builder;
  }

  setHookRegistry(hooks: HookRegistry): void {
    this.hookRegistry = hooks;
  }

  setParentProvider(provider: ILLMProvider): void {
    this._parentProvider = provider;
  }

  setParentConfig(config: AgentConfig): void {
    this._parentConfig = config;
  }

  setFallbackProviderConfig(config: { adapter: string; apiKey?: string; baseURL?: string; model?: string } | undefined): void {
    this._fallbackProviderConfig = config;
  }

  getFallbackProviderConfig(): { adapter: string; apiKey?: string; baseURL?: string; model?: string } | undefined {
    return this._fallbackProviderConfig;
  }

  /**
   * 统一 create 入口（设计指定）
   */
  async create(agentId: string, options: AgentCreateOptions): Promise<AgentInstance> {
    if (agentId === 'main' || options.depth === 0) {
      return this.createMainAgent(agentId, options);
    }
    return this.createSubAgent(agentId, options);
  }

  /**
   * 为已注册 agent 解析 provider + 工具列表（供 switchForegroundAgent 等运行时热切换使用）。
   * 不走 parentProvider 兜底 — 已注册 agent 必须有独立配置。
   */
  resolveAgentComponents(agentId: string, complexity?: string): { provider: ILLMProvider; toolNames: string[] } {
    const cfgMgr = getConfigManager();
    const agentCfg = cfgMgr.getAgentConfig(agentId);
    if (!agentCfg || agentCfg.enabled === false) {
      throw new Error(`Agent "${agentId}" not found or disabled`);
    }
    this.ensureProviderComplete(agentCfg);
    const provider = this.resolveProvider(agentCfg);
    const yamlTools = (agentCfg.tools as any[])?.filter((t: any) => t.enabled !== false).map((t: any) => t.name) || [];
    const toolNames = augmentToolList(yamlTools, complexity);
    return { provider, toolNames };
  }

  /**
   * 创建主 Agent（用于对话管理中心的顶层 Agent）
   */
  async createMainAgent(agentId: string, options: AgentCreateOptions): Promise<AgentInstance> {
    const cfgMgr = getConfigManager();
    const agentCfg = cfgMgr.getAgentConfig(agentId);

    if (!agentCfg || agentCfg.enabled === false) {
      throw new Error(`Agent "${agentId}" not found or disabled`);
    }

    // 系统 agent 自身凭证缺失时，用兜底 provider 替换 agentCfg.provider
    this.ensureProviderComplete(agentCfg);

    const provider = this.resolveProvider(agentCfg);

    // 构建 system prompt
    const systemPrompt = await this.buildMainPrompt(agentCfg, options);

    // 过滤工具（strictTools 模式下仅用 whitelist，不合并 YAML config tools）
    const allowedTools = options.strictTools
      ? (options.toolWhitelist || [])
      : this.resolveTools(agentCfg, options.toolWhitelist);
    const registry = this.createFilteredRegistry(allowedTools, {
      agentId,
      workingDir: options.workingDir,
    });

    // 构建 AgentConfig（此时 agentCfg.provider 已确保完整，apiKey/baseURL 来自兜底）
    const runtimeConfig = this.buildRuntimeConfig(agentCfg, {
      systemPrompt,
      workingDir: options.workingDir,
      maxIterations: options.maxIterations ?? agentCfg.execution?.maxIterations ?? 50,
      temperature: agentCfg.model?.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? agentCfg.model?.maxTokens,
    });

    // session 级 compressor 配置（不来自 agent YAML）
    if (options.compressor) {
      runtimeConfig.compressor = options.compressor;
    }

    const mainAgentId = options.subAgentId || agentId;

    const agentLoop = new AgentLoop(provider, registry, runtimeConfig, mainAgentId);

    if (this.hookRegistry) {
      agentLoop.setHookRegistry(this.hookRegistry);
    }

    return {
      agentLoop,
      config: runtimeConfig,
      subAgentId: mainAgentId,
      depth: options.depth ?? 0,
    };
  }

  /**
   * 创建子 Agent（用于 task/team 工具创建的临时或预置 Agent）
   */
  async createSubAgent(agentId: string, options: AgentCreateOptions): Promise<AgentInstance> {
    let agentCfg: ReturnType<ConfigManager['getAgentConfig']> = null;
    try {
      const cfgMgr = getConfigManager();
      agentCfg = cfgMgr.getAgentConfig(agentId);
    } catch (err) {
      log.warn(`[createSubAgent] ConfigManager.getAgentConfig failed for "${agentId}":`, err);
    }

    log.debug(`[createSubAgent] entry`, {
      agentId,
      hasAgentCfg: !!agentCfg,
      agentCfgName: agentCfg?.name,
      hasParentProvider: !!options.parentProvider,
      hasParentConfig: !!options.parentConfig,
      depth: options.depth,
      scene: options.scene,
      toolWhitelist: options.toolWhitelist,
      subAgentId: options.subAgentId,
    });

    // 空 ID 或未注册（临时 agent），仅继承 provider 和适配器
    if (!agentCfg) {
      log.debug(`[createSubAgent] 进入临时 agent 路径`, {
        agentId,
        hasParentProvider: !!options.parentProvider,
        parentProviderType: options.parentProvider?.constructor?.name || 'unknown',
        depth: options.depth,
      });

      if (!options.parentProvider) {
        log.warn(`[createSubAgent] 临时 agent 缺少 parentProvider`, { agentId });
        throw new Error(`Agent "${agentId}" not found and no parentProvider to inherit`);
      }
      // 临时 agent: 继承父 provider 和父配置（model / provider / tools 等），LLM 分配的 system prompt 由调用方传入
      const provider = options.parentProvider;
      const subAgentId = options.subAgentId || `subagent-temp-${agentId || 'unknown'}-${Date.now()}`;

      const runtimeConfig = this.buildRuntimeConfig(options.parentConfig as any, {
        systemPrompt: '',
        workingDir: options.workingDir,
        maxIterations: options.maxIterations ?? 100,
        maxTokens: options.maxTokens ?? (options.parentConfig as any)?.model?.maxTokens,
      });

      const allowedTools = options.strictTools
        ? (options.toolWhitelist || [])
        : this.resolveTools((options.parentConfig as any) ?? null, options.toolWhitelist);
      const effectiveTools = options.strictTools
        ? allowedTools
        : augmentToolList(allowedTools.length > 0 ? allowedTools : DEFAULT_SUBAGENT_TOOLS);
      log.debug(`[createSubAgent] 临时 agent 工具解析完成`, {
        agentId,
        strictTools: options.strictTools,
        toolWhitelist: options.toolWhitelist,
        resolvedTools: allowedTools,
        effectiveTools,
      });
      const registry = this.createFilteredRegistry(effectiveTools, {
        agentId,
        workingDir: options.workingDir,
      });

      const agentLoop = new AgentLoop(provider, registry, runtimeConfig, subAgentId);
      if (this.hookRegistry) agentLoop.setHookRegistry(this.hookRegistry);

      log.debug(`[createSubAgent] 临时 agent 创建成功`, {
        agentId,
        subAgentId,
        depth: options.depth,
        providerType: provider.constructor?.name,
        model: runtimeConfig.model,
        toolCount: allowedTools.length,
      });

      return { agentLoop, config: runtimeConfig, subAgentId, depth: options.depth ?? 0 };
    }

    log.debug(`[createSubAgent] 进入预置 agent 路径`, {
      agentId,
      agentName: agentCfg.name,
      enabled: agentCfg.enabled,
      hasIndependentProvider: !!(agentCfg.provider?.apiKey || agentCfg.provider?.baseURL),
      hasParentProvider: !!options.parentProvider,
    });

    if (agentCfg.enabled === false) {
      throw new Error(`Agent "${agentCfg.name}" is disabled`);
    }

    // 系统 agent 自身凭证缺失时，用兜底 provider 替换 agentCfg.provider
    this.ensureProviderComplete(agentCfg);

    // 解析 provider（agentCfg.provider 已确保完整，仅非系统 agent 可能需继承父 provider）
    let provider: ILLMProvider;
    if (AgentFactory.isProviderComplete(agentCfg)) {
      provider = this.providerPool.getProvider({
        adapter: agentCfg.provider!.adapter!,
        model: agentCfg.model!.primary!,
        apiKey: agentCfg.provider!.apiKey!,
        baseURL: agentCfg.provider!.baseURL!,
      });
    } else if (options.parentProvider) {
      provider = options.parentProvider;
    } else {
      throw new Error(`子 Agent "${agentCfg.name}" 未配置 apiKey/baseURL，请在配置页面设置`);
    }

    // 构建 system prompt
    const systemPrompt = await this.buildSubPrompt(agentCfg, options);

    // 解析工具（strictTools 模式下仅用 whitelist，不合并 YAML 也不自动补齐）
    const allowedTools = options.strictTools
      ? (options.toolWhitelist || [])
      : this.resolveTools(agentCfg, options.toolWhitelist);
    const effectiveTools = options.strictTools ? allowedTools : augmentToolList(allowedTools);
    log.debug(`[createSubAgent] 工具解析完成`, {
      agentId,
      agentName: agentCfg.name,
      strictTools: options.strictTools,
      toolWhitelist: options.toolWhitelist,
      resolvedTools: allowedTools,
      effectiveTools,
    });
    const registry = this.createFilteredRegistry(effectiveTools, {
      agentId,
      workingDir: options.workingDir,
    });

    const subAgentId = options.subAgentId || `subagent-${agentId}-${Date.now()}`;

    // 构建 runtime config（此时 agentCfg.provider 已确保完整）
    const runtimeConfig = this.buildRuntimeConfig(agentCfg, {
      systemPrompt,
      workingDir: options.workingDir,
      maxIterations: options.maxIterations ?? agentCfg.execution?.maxIterations ?? 100,
      temperature: agentCfg.model?.temperature,
      maxTokens: options.maxTokens ?? agentCfg.model?.maxTokens,
    });

    const agentLoop = new AgentLoop(provider, registry, runtimeConfig, subAgentId);

    if (this.hookRegistry) {
      agentLoop.setHookRegistry(this.hookRegistry);
    }

    return {
      agentLoop,
      config: runtimeConfig,
      subAgentId,
      depth: options.depth ?? 0,
    };
  }

  /**
   * createAndRun — 创建子 Agent 并运行，封装完整生命周期
   *
   * 包括：场景加载 → 创建 → Hook 事件 → 超时控制 → 输出收集 → 清理
   */
  async createAndRun(
    agentIdOrRole: string,
    options: CreateAndRunOptions,
    externalSignal?: AbortSignal,
  ): Promise<CreateAndRunResult> {
    const startTime = Date.now();
    let subAgentId: string | null = null;

    // 1. 获取 agent 配置（用于 Hook 元数据）
    let agentConfig: ReturnType<ConfigManager['getAgentConfig']> = null;
    try {
      const cfgMgr = getConfigManager();
      agentConfig = cfgMgr.getAgentConfig(agentIdOrRole);
    } catch (err) {
      log.warn(`[createAndRun] ConfigManager.getAgentConfig failed for "${agentIdOrRole}":`, err);
    }
    const isTemporary = this.isTemporaryAgent(agentIdOrRole);

    // 3. 解析 parentProvider（options 优先，其次 setters）
    const parentProvider = options.parentProvider ?? this._parentProvider;
    const parentConfig = options.parentConfig ?? this._parentConfig;

    log.debug(`[createAndRun] provider 解析`, {
      agentId: agentIdOrRole,
      isTemporary,
      hasOptionsProvider: !!options.parentProvider,
      hasInternalProvider: !!this._parentProvider,
      hasParentConfig: !!parentConfig,
      agentConfigFound: !!agentConfig,
    });

    if (!agentConfig && !isTemporary && !parentProvider) {
      log.warn(`[createAndRun] agent 未找到且无 parentProvider`, {
        agentId: agentIdOrRole,
        isTemporary,
      });
      throw new Error(`Agent "${agentIdOrRole}" not found`);
    }

    // 4. 创建子 Agent
    let agentLoop: AgentLoop;
    try {
      const result = await this.createSubAgent(agentIdOrRole, {
        parentProvider,
        parentConfig,
        scene: options.scene,
        taskDescription: options.task,
        depth: options.depth ?? 0,
        toolWhitelist: options.tools,
        workingDir: options.workingDir,
        timeout: options.timeout,
        maxIterations: options.maxIterations,
        streamToUser: options.streamToUser,
        parentAgentId: options.parentAgentId,
        subAgentId: options.subAgentId,
        strictTools: options.strictTools,
        maxTokens: options.maxTokens,
      });
      agentLoop = result.agentLoop;
      subAgentId = result.subAgentId;

      // 将 layered prompt 注入 options，确保 ACP 子进程也能使用
      if (!options.systemPrompt && result.config.systemPrompt) {
        options.systemPrompt = result.config.systemPrompt;
      }
    } catch (error: any) {
      const duration = Date.now() - startTime;
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : '';
      log.error(`createAndRun failed`, {
        agentId: agentIdOrRole,
        depth: options.depth,
        isTemporary,
        subAgentId,
        taskPreview: (options.task || '').slice(0, 120),
        error: errMsg,
        stack: errStack,
        duration,
      });
      console.error(`[AgentFactory] createAndRun 失败: agentId=${agentIdOrRole}, depth=${options.depth}, error=${errMsg}`);
      return {
        result: `[Error] Failed to create sub-agent: ${errMsg}`,
        tokensUsed: { input: 0, output: 0 },
        duration,
        timedOut: false,
        iterations: 0,
        success: false,
      };
    }

    // 5. 注册流回调
    let outputText = '';

    agentLoop.on({
      onText: (text) => {
        outputText += text;
        if (options.streamToUser && this.hookRegistry) {
          this.hookRegistry.emit('SubAgentText', { subAgentId, text }).catch(() => {});
        }
      },
      onThinking: (thinking) => {
        if (this.hookRegistry) {
          this.hookRegistry.emit('AgentThinking', { subAgentId, thinkingContent: thinking }).catch(() => {});
        }
      },
      onToolStart: (id, name, input) => {
        if (this.hookRegistry) {
          this.hookRegistry.emit('ToolStart', { subAgentId, toolId: id, toolName: name, toolInput: input }).catch(() => {});
        }
      },
      onToolEnd: (id, name, result, isError, metadata, contentBlocks) => {
        if (this.hookRegistry) {
          this.hookRegistry.emit('ToolEnd', { subAgentId, toolId: id, toolName: name, toolResult: result, toolIsError: isError }).catch(() => {});
        }
      },
    });

    // 6. 触发 SubAgentStart Hook + EventBus
    const agentType = !agentConfig ? 'temporary' :
      isTemporary ? 'temporary' :
      (agentConfig as any).metadata?.category === 'system' ? 'builtin' :
      (agentConfig as any).metadata?.category === 'app' ? 'preset' : 'custom';

    // 子 agent 走 ACP 子进程执行，避免阻塞主进程事件循环
    // 但若当前已在 ACP worker 中，则禁止递归 fork，走 in-process
    // forceInProcess：leader in-process 执行（需要完整工具权限），不触发 ACP fork
    const isInAcpWorker = typeof process.send === 'function';
    const useAcp = !options.forceInProcess && !isInAcpWorker && !!options.subAgentId && !!subAgentId;

    const subAgentStartPayload = {
      task: options.task,
      depth: options.depth ?? 0,
      role: agentConfig?.id || agentIdOrRole,
      name: agentConfig?.name || agentIdOrRole,
      agentType,
      parentAgentId: options.parentAgentId || 'main',
      streamToUser: options.streamToUser || false,
      isAsync: options.isAsync || false,
      scene: options.scene?.replace(/^l[12]-/, ''),
      executionMode: (useAcp ? 'acp' : 'in-process') as 'acp' | 'in-process',
    };

    if (this.hookRegistry && !options.skipSubAgentStartHook) {
      this.hookRegistry.emit('SubAgentStart', {
        subAgentId,
        data: subAgentStartPayload,
      }).catch(() => {});
    }
    // 团队成员由 TeamMemberStart/TeamMemberEnd 管理生命周期，不发送 SubAgentStart/End
    if (!options.skipSubAgentStartHook) {
      eventBus.emitSync(XuanjiEvent.HOOK_SUBAGENT_START, {
        subAgentId,
        data: subAgentStartPayload,
      });
    }

    // 7. 带超时执行
    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    if (useAcp) {
      try {
        const acpResult = await this.executeViaAcp(agentIdOrRole, options, subAgentId!, outputText, startTime);
        return acpResult;
      } catch (acpErr) {
        log.warn(`ACP execution failed, falling back to in-process: ${acpErr}`);
        // fall through
      }
    }

    const onExternalAbort = () => {
      agentLoop.stop();
    };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });


    try {
      // 更新日志上下文中的 depth，子 agent 内的 AgentLoop 写日志时自动带上
      setLogContext({ depth: options.depth ?? 0 });
      const runPromise = agentLoop.run(options.task, externalSignal);
      runPromise.catch(() => {});

      const timeout = options.timeout || 600000;
      if (timeout > 0) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => {
            agentLoop.stop();
            timedOut = true;
            reject(new Error(`Sub-agent timed out after ${timeout}ms`));
          }, timeout);
        });
        await Promise.race([runPromise, timeoutPromise]);
      } else {
        await runPromise;
      }
    } catch (error: any) {
      if (!timedOut) {
        outputText += `\n\n[Error] ${error.message}`;
      }
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }

    const duration = Date.now() - startTime;
    const state = agentLoop.getState();

    // 8. 触发 SubAgentEnd Hook + EventBus
    const endPayload = {
      task: options.task,
      depth: options.depth ?? 0,
      duration,
      timedOut,
      success: !timedOut,
      iterations: state.currentIteration,
      result: outputText,
      tokensUsed: state.tokenUsage,
    };
    if (!options.skipSubAgentStartHook) {
      if (this.hookRegistry) {
        this.hookRegistry.emit('SubAgentEnd', {
          subAgentId,
          data: endPayload,
        }).catch(() => {});
      }
      eventBus.emit(XuanjiEvent.HOOK_SUBAGENT_END, {
        subAgentId,
        data: endPayload,
      });
    }

    // 9. 清理临时 Agent
    if (isTemporary) {
      this.cleanupTemporaryAgent(agentIdOrRole);
    }

    return {
      result: outputText || (timedOut ? `Timed out after ${options.timeout || 600000}ms` : 'No output'),
      tokensUsed: state.tokenUsage,
      duration,
      timedOut,
      iterations: state.currentIteration,
      success: !timedOut,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // 统一配置加载 + 校验
  // ═══════════════════════════════════════════════════════════════

  /**
   * 加载 agent 配置，缺失关键字段则抛异常（无兜底）。
   *
   * 加载链路：ConfigManager.getAgentConfig(agentId)
   *   → YAML + JSON + agent-overrides 三层合并
   */
  loadAgentConfigOrThrow(agentId: string): ReturnType<ConfigManager['getAgentConfig']> & {} {
    const cfgMgr = getConfigManager();
    const config = cfgMgr.getAgentConfig(agentId);

    if (!config) {
      throw new Error(
        `Agent "${agentId}" 配置文件未找到。请在 ~/.xuanji/users/{userId}/agents/ 下创建 ${agentId}.yaml`,
      );
    }
    if (config.enabled === false) {
      throw new Error(`Agent "${config.name || agentId}" 已被禁用，请在配置页面启用`);
    }
    if (!config.model?.primary) {
      throw new Error(`Agent "${config.name || agentId}" 未配置 model.primary`);
    }
    if (!config.provider?.adapter) {
      throw new Error(`Agent "${config.name || agentId}" 未配置 provider.adapter`);
    }

    return config;
  }

  /**
   * 创建 CheapLLMProvider（单轮 LLM 调用，供 MemoryManager/EpisodicMemory/TopicContinuity 等使用）。
   *
   * 从 agent YAML 配置读取 adapter/model/apiKey/baseURL，创建独立的 provider。
   */
  async createCheapLLMProvider(
    agentId: string,
    defaults: { temperature: number; maxTokens: number },
  ): Promise<any> {
    const c = this.loadAgentConfigOrThrow(agentId);
    const { CheapLLMProvider } = await import('@/core/providers/CheapLLMProvider');
    const { ProviderManager } = await import('@/core/providers/ProviderManager');

    const agentProvider = ProviderManager.getProvider(
      { adapter: c.provider!.adapter!, apiKey: c.provider!.apiKey, baseURL: c.provider!.baseURL },
      this._fallbackProviderConfig,
    );

    if (!agentProvider) {
      log.warn(`[createCheapLLMProvider] ${agentId}: 未配置 provider，使用占位 CheapLLM`);
      return {
        complete: async () => {
          throw new Error(`Agent "${agentId}" 未配置 provider，请在设置页面配置`);
        },
      };
    }

    const llm = new CheapLLMProvider(agentProvider, {
      model: c.model!.primary!,
      apiKey: c.provider!.apiKey || this._fallbackProviderConfig?.apiKey || '',
      baseURL: c.provider!.baseURL || this._fallbackProviderConfig?.baseURL || '',
      temperature: (c.model!.temperature ?? defaults.temperature) as number,
      maxTokens: (c.model!.maxTokens ?? defaults.maxTokens) as number,
      contextSize: (c.model as any)?.contextSize,
    });
    log.debug(`[createCheapLLMProvider] ${agentId}: ${c.model!.primary} (adapter=${c.provider!.adapter})`);
    return llm;
  }

  // ═══════════════════════════════════════════════════════════════
  // 专用 Agent 创建方法
  // ═══════════════════════════════════════════════════════════════

  /**
   * 创建 memory-manager Agent（供 MemoryManager 使用）。
   */
  async createMemoryAgent(
    agentId: string,
    options: MemoryAgentCreateOptions,
  ): Promise<AgentInstance> {
    return this.createSilentAgent(agentId, {
      systemPrompt: options.systemPrompt,
      workingDir: options.workingDir,
      toolNames: ['memory_search', 'memory_store', 'memory_stats'],
      maxIterations: options.maxIterations ?? 60,
      temperature: undefined,
      maxTokens: options.maxTokens,
      idPrefix: 'memory',
      parentConfig: options.parentConfig,
    });
  }

  private async createSilentAgent(
    agentId: string,
    opts: {
      systemPrompt: string;
      workingDir?: string;
      toolNames: string[];
      maxIterations: number;
      temperature: number | undefined;
      maxTokens: number;
      idPrefix: string;
      parentConfig?: AgentConfig;
    },
  ): Promise<AgentInstance> {
    const agentCfg = this.loadAgentConfigOrThrow(agentId);

    const registry = this.createFilteredRegistry(opts.toolNames, {
      agentId,
      workingDir: opts.workingDir,
    });

    // 系统 agent 自身凭证缺失时，用兜底 provider 替换 agentCfg.provider
    this.ensureProviderComplete(agentCfg);

    const provider = this.resolveProvider(agentCfg);

    const runtimeConfig = this.buildRuntimeConfig(agentCfg, {
      systemPrompt: opts.systemPrompt,
      workingDir: opts.workingDir,
      maxIterations: opts.maxIterations,
      temperature: opts.temperature ?? agentCfg.model?.temperature,
      maxTokens: opts.maxTokens ?? agentCfg.model?.maxTokens,
    });

    if (!runtimeConfig.apiKey && opts.parentConfig?.apiKey) {
      runtimeConfig.apiKey = opts.parentConfig.apiKey;
    }
    if (!runtimeConfig.baseURL && opts.parentConfig?.baseURL) {
      runtimeConfig.baseURL = opts.parentConfig.baseURL;
    }

    const subAgentId = `${opts.idPrefix}-${agentId}-${Date.now()}`;
    const agentLoop = new SilentAgentLoop(provider, registry, runtimeConfig, subAgentId);

    log.debug(`[createSilentAgent] ${opts.idPrefix} 创建完成`, {
      agentId,
      subAgentId,
      model: runtimeConfig.model,
      adapter: agentCfg.provider?.adapter,
      maxTokens: runtimeConfig.maxTokens,
      temperature: runtimeConfig.temperature,
    });

    return { agentLoop, config: runtimeConfig, subAgentId, depth: 0 };
  }

  /**
   * 创建 ACP 子进程 Agent（供 acp-worker.ts 使用）。
   *
   * 自动判断 agentId 对应的是已注册 agent 还是临时 agent：
   * - 已注册 agent：使用自身 YAML + overrides 配置（必须有独立 apiKey/baseURL）
   * - 临时 agent：使用 parentConfig（主进程传入）
   */
  async createAcpAgent(
    agentId: string,
    options: AcpAgentCreateOptions,
  ): Promise<AgentInstance> {
    let agentCfg: ReturnType<ConfigManager['getAgentConfig']> = null;
    try {
      agentCfg = this.loadAgentConfigOrThrow(agentId);
    } catch (err) {
      log.warn(`[createAcpAgent] Agent "${agentId}" 未注册，使用 parentConfig 作为临时 agent`);
    }

    let provider: ILLMProvider;
    let runtimeConfig: AgentConfig;
    let effectiveTools: string[];

    if (agentCfg) {
      // 系统 agent 自身凭证缺失时，用兜底 provider 替换 agentCfg.provider
      this.ensureProviderComplete(agentCfg);

      if (!AgentFactory.isProviderComplete(agentCfg)) {
        throw new Error(
          `ACP: 已注册 Agent "${agentCfg.name || agentId}" 未配置 apiKey/baseURL，请在配置页面设置`,
        );
      }

      provider = this.providerPool.getProvider({
        adapter: agentCfg.provider!.adapter!,
        model: agentCfg.model!.primary!,
        apiKey: agentCfg.provider!.apiKey!,
        baseURL: agentCfg.provider!.baseURL!,
      });

      const configTools = (agentCfg.tools as any[])?.map((t: any) => t.name) || [];
      effectiveTools = augmentToolList(
        [...new Set([...configTools, ...(options.tools || [])])],
      );

      runtimeConfig = this.buildRuntimeConfig(agentCfg, {
        systemPrompt: options.systemPrompt || '',
        workingDir: options.workingDir,
        maxIterations: options.maxIterations ?? agentCfg.execution?.maxIterations ?? 50,
        temperature: agentCfg.model?.temperature,
        maxTokens: agentCfg.model?.maxTokens,
      });
    } else {
      const pc = options.parentConfig;
      const adapter: string = pc?.adapter || '';
      const model: string = pc?.model || '';

      if (!adapter) throw new Error('ACP: parentConfig 缺少 adapter');
      if (!model) throw new Error('ACP: parentConfig 缺少 model');

      provider = this.providerPool.getProvider({
        adapter,
        model,
        apiKey: pc?.apiKey || '',
        baseURL: pc?.baseURL || '',
        maxTokens: pc?.maxTokens,
        temperature: pc?.temperature,
      });

      effectiveTools = augmentToolList(
        options.tools && options.tools.length > 0 ? options.tools : DEFAULT_SUBAGENT_TOOLS,
      );

      runtimeConfig = {
        model,
        systemPrompt: options.systemPrompt || '',
        maxIterations: options.maxIterations ?? 50,
        temperature: pc?.temperature ?? 0.7,
        maxTokens: pc?.maxTokens,
        workingDir: options.workingDir,
        apiKey: pc?.apiKey || '',
        baseURL: pc?.baseURL || '',
      };
    }

    const registry = this.createFilteredRegistry(effectiveTools, {
      agentId,
      workingDir: options.workingDir,
    });

    const subAgentId = `acp-${agentId}-${Date.now()}`;
    const agentLoop = new AgentLoop(provider, registry, runtimeConfig, subAgentId);

    if (this.hookRegistry) {
      agentLoop.setHookRegistry(this.hookRegistry);
    }

    log.debug(`[createAcpAgent] 创建完成`, {
      agentId,
      subAgentId,
      isRegistered: !!agentCfg,
      model: runtimeConfig.model,
      toolCount: effectiveTools.length,
    });

    return { agentLoop, config: runtimeConfig, subAgentId, depth: 0 };
  }

  /**
   * 通过 ACP 子进程执行子 agent
   * 主进程透传 provider 配置（含 apiKey）
   */
  private async executeViaAcp(
    agentIdOrRole: string,
    options: CreateAndRunOptions,
    subAgentId: string,
    outputText: string,
    startTime: number,
  ): Promise<CreateAndRunResult> {
    const acp = AcpProcessManager.getInstance();

    // 先查已注册 agent 的配置
    let registeredConfig: ReturnType<ConfigManager['getAgentConfig']> = null;
    try {
      const cfgMgr = getConfigManager();
      registeredConfig = cfgMgr.getAgentConfig(agentIdOrRole);
    } catch (err) {
      log.warn(`[executeViaAcp] ConfigManager.getAgentConfig failed for "${agentIdOrRole}":`, err);
    }
    const isTemporary = this.isTemporaryAgent(agentIdOrRole);

    // 工具解析：注册 agent 合并 YAML tools + whitelist，临时 agent 用 whitelist（兜底默认集）
    let tools: string[];
    if (!isTemporary && registeredConfig) {
      const yamlTools = (registeredConfig.tools as Array<{ name: string }>)?.map(t => t.name) || [];
      const whitelist = options.tools || [];
      tools = [...new Set([...yamlTools, ...whitelist])];
    } else {
      tools = options.tools && options.tools.length > 0 ? options.tools : DEFAULT_SUBAGENT_TOOLS;
    }
    tools = augmentToolList(tools);

    // 已注册 agent 用自有配置，临时 agent 继承父配置
    const fallbackConfig = options.parentConfig ?? this._parentConfig;
    log.debug(`executeViaAcp: agentId="${agentIdOrRole}" isTemporary=${isTemporary} hasRegistered=!!${!!registeredConfig} fallbackConfig=${fallbackConfig ? 'yes' : 'no'} fallbackProvider=${JSON.stringify((fallbackConfig as any)?.provider)}`);
    let agentProviderConfig: Record<string, any> | undefined;

    if (registeredConfig && !isTemporary) {
      this.ensureProviderComplete(registeredConfig);
      agentProviderConfig = {
        adapter: (registeredConfig as any).provider?.adapter,
        model: (registeredConfig as any).model?.primary,
        apiKey: (registeredConfig as any).provider?.apiKey || '',
        baseURL: (registeredConfig as any).provider?.baseURL || '',
        maxTokens: (registeredConfig as any).model?.maxTokens,
        temperature: (registeredConfig as any).model?.temperature,
      };
    } else if (isTemporary && fallbackConfig) {
      agentProviderConfig = {
        adapter: (fallbackConfig as any).adapter || '',
        model: (fallbackConfig as any).model || '',
        apiKey: (fallbackConfig as any).apiKey || '',
        baseURL: (fallbackConfig as any).baseURL || '',
        maxTokens: (fallbackConfig as any).maxTokens,
        temperature: (fallbackConfig as any).temperature,
      };
    } else {
      throw new Error(`ACP: 子 Agent "${agentIdOrRole}" 未注册且无父配置，无法执行`);
    }

    const result = await acp.run(agentIdOrRole, options.task, {
      userId: (() => { try { return getConfigManager().getUserId() || undefined; } catch { return undefined; } })(),
      systemPrompt: options.systemPrompt,
      scenePrompt: options.scenePrompt,
      tools,
      timeout: options.timeout,
      maxIterations: options.maxIterations,
      workingDir: options.workingDir,
      parentConfig: agentProviderConfig,
      onEvent: (event) => {
        forwardAcpEvent(event.payload.eventType, event.payload.data, subAgentId, this.hookRegistry);
      },
    });

    const duration = Date.now() - startTime;

    // 触发 SubAgentEnd Hook + EventBus
    const acpEndPayload = {
      task: options.task,
      depth: options.depth ?? 0,
      duration,
      timedOut: result.payload.timedOut,
      success: result.payload.success,
      iterations: result.payload.iterations,
      result: result.payload.output,
      tokensUsed: result.payload.tokensUsed,
    };
    if (!options.skipSubAgentStartHook) {
      if (this.hookRegistry) {
        this.hookRegistry.emit('SubAgentEnd', {
          subAgentId,
          data: acpEndPayload,
        }).catch(() => {});
      }
      eventBus.emit(XuanjiEvent.HOOK_SUBAGENT_END, {
        subAgentId,
        data: acpEndPayload,
      });
    }

    return {
      result: result.payload.output,
      tokensUsed: result.payload.tokensUsed,
      duration,
      timedOut: result.payload.timedOut,
      iterations: result.payload.iterations,
      success: result.payload.success,
    };
  }


  // ─── Temporary Agent (接管自 TemporaryAgentFactory) ─────

  createTemporaryAgentConfig(options: TemporaryAgentOptions): ConfigurableAgentConfig {
    const { role, capabilities, scene, taskDescription, model, parentConfig } = options;
    const tempId = `temp-${role.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

    const systemPrompt = this.generateTempSystemPrompt(role, capabilities, taskDescription);

    const provider = parentConfig?.provider
      ? { ...parentConfig.provider }
      : {};

    const tempAgent: ConfigurableAgentConfig = {
      id: tempId,
      name: role,
      description: `临时创建的 ${role}，用于完成特定任务`,
      avatar: '🤖',
      color: 'from-gray-500 to-gray-600',
      category: 'custom',
      model: {
        primary: model || parentConfig?.model?.primary || '',
        maxTokens: 64000,
        thinking: { type: 'adaptive' as const, effort: 'medium' as const },
      },
      provider,
      systemPrompt,
      capabilities,
      tools: [
        { name: 'read_file' },
        { name: 'grep' },
        { name: 'glob' },
      ],
      execution: {
        mode: 'react',
        maxIterations: 100,
        timeout: 600000,
        streaming: true,
        parallelTools: true,
      },
      permissions: {
        fileRead: 'always',
        fileWrite: 'ask',
        bashExec: 'ask',
        network: 'ask',
        allowedPaths: [],
        deniedPaths: [],
        allowedCommands: [],
        deniedCommands: [],
      },
      enabled: true,
      metadata: { isTemporary: true, createdAt: new Date().toISOString(), scene },
    };

    this.temporaryAgents.set(tempId, tempAgent);
    return tempAgent;
  }

  cleanupTemporaryAgent(id: string): void {
    if (this.temporaryAgents.has(id)) {
      this.temporaryAgents.delete(id);
    }
  }

  isTemporaryAgent(id: string): boolean {
    return id.startsWith('temp-') || this.temporaryAgents.has(id);
  }

  // ─── Private ────────────────────────────────────────────

  private generateTempSystemPrompt(role: string, capabilities: string[], taskDescription?: string): string {
    const prompt = `你是一位 ${role}。

## 核心职责

${capabilities.map(cap => `- ${cap}`).join('\n')}

## 工作原则

- 专注于你的职责范围
- 提供高质量的输出
- 遵循最佳实践
- 清晰明了地表达

## 工作方式

你会根据任务需求，采用合适的方法完成工作。
具体的场景指导会通过 Scene 动态加载。

${taskDescription ? `\n## 当前任务\n\n${taskDescription}\n` : ''}`;

    return prompt.trim();
  }

  private static LOCAL_ADAPTERS = new Set(['ollama', 'vllm', 'lmstudio', 'local-llama']);

  /** 检查 agent 自身的 provider 配置是否完整（本地 adapter 不需要 apiKey） */
  private static isProviderComplete(agentCfg: ReturnType<ConfigManager['getAgentConfig']>): boolean {
    const adapter = agentCfg?.provider?.adapter;
    if (!adapter) return false;
    if (AgentFactory.LOCAL_ADAPTERS.has(adapter)) return true;
    return !!(agentCfg?.provider?.apiKey || agentCfg?.provider?.baseURL);
  }

  /**
   * 确保 agent 的 provider 配置完整。
   * 系统 agent 自身凭证缺失时，用兜底 provider 直接替换 agentCfg.provider，
   * 使后续 buildRuntimeConfig / resolveProvider 自动拿到正确值，无需事后打补丁。
   */
  private ensureProviderComplete(agentCfg: ReturnType<ConfigManager['getAgentConfig']>): void {
    if (!agentCfg) return;

    const agentName = agentCfg.name || agentCfg.id || 'unknown';
    const category = agentCfg.metadata?.category;
    const isSystem = category === 'system';
    const isComplete = AgentFactory.isProviderComplete(agentCfg);
    const hasFallback = !!this._fallbackProviderConfig?.adapter;

    log.debug(`[ensureProviderComplete] agent=${agentName} category=${category} isSystem=${isSystem} isComplete=${isComplete} hasFallback=${hasFallback} fallbackAdapter=${this._fallbackProviderConfig?.adapter || 'none'}`);

    if (isComplete) return;
    if (!isSystem) return;
    if (!hasFallback) return;

    log.debug(`Agent "${agentName}" provider 不完整，替换为兜底 provider: ${this._fallbackProviderConfig!.adapter}`);
    agentCfg.provider = {
      adapter: this._fallbackProviderConfig!.adapter,
      apiKey: this._fallbackProviderConfig!.apiKey || '',
      baseURL: this._fallbackProviderConfig!.baseURL || '',
    };
    if (this._fallbackProviderConfig!.model) {
      agentCfg.model = { ...agentCfg.model, primary: this._fallbackProviderConfig!.model };
    }
  }

  private resolveProvider(agentCfg: ReturnType<ConfigManager['getAgentConfig']>): ILLMProvider {
    const adapter = agentCfg?.provider?.adapter;
    if (!adapter) {
      const agentName = agentCfg?.name || agentCfg?.id || 'unknown';
      log.warn(`Agent "${agentName}" 未配置 provider adapter，使用占位 Provider`);
      return createUnconfiguredProvider(agentName);
    }
    return this.providerPool.getProvider({
      adapter,
      model: agentCfg!.model!.primary!,
      apiKey: agentCfg!.provider!.apiKey!,
      baseURL: agentCfg!.provider!.baseURL!,
    });
  }

  private async buildMainPrompt(
    agentCfg: NonNullable<ReturnType<ConfigManager['getAgentConfig']>>,
    options: AgentCreateOptions,
  ): Promise<string> {
    if (options.systemPromptOverride) return options.systemPromptOverride;

    if (this.layeredPromptBuilder) {
      const result = await this.layeredPromptBuilder.build({
        scene: options.scene || 'coding',
        complexity: options.complexity || 'standard',
      });
      return result.prompt;
    }

    return (agentCfg as any).systemPrompt || '';
  }

  private async buildSubPrompt(
    agentCfg: NonNullable<ReturnType<ConfigManager['getAgentConfig']>>,
    options: AgentCreateOptions,
  ): Promise<string> {
    let prompt = '';

    if (this.layeredPromptBuilder) {
      const result = await this.layeredPromptBuilder.buildForSubAgent({
        agentId: agentCfg.id,
        agentConfig: agentCfg,
        scene: options.scene || 'coding',
        includeProjectContext: true,
      });
      prompt = result.prompt;
    } else {
      prompt = (agentCfg as any).systemPrompt || '';
    }

    prompt += `\n\n---\n# SubAgent Mode\nDepth: ${options.depth ?? 0}, Role: ${agentCfg.id}\nDo not ask clarifying questions. Focus on completing the assigned task.`;

    return prompt;
  }

  private resolveTools(
    agentCfg: { tools?: Array<{ name: string }> } | null,
    whitelist?: string[],
  ): string[] {
    const configTools = (agentCfg?.tools as any[])?.map((t: any) => t.name) || [];
    return [...new Set([...configTools, ...(whitelist || [])])];
  }

  private createFilteredRegistry(allowedTools: string[], context: { agentId: string; workingDir?: string }): IToolRegistry {
    const { FilteredToolRegistry } = require('@/core/tools/FilteredToolRegistry');
    return new FilteredToolRegistry(
      this.baseRegistry,
      allowedTools,
      { agentId: context.agentId, agentName: context.agentId },
      context.workingDir || process.cwd(),
    );
  }

  private buildRuntimeConfig(
    agentCfg: ReturnType<ConfigManager['getAgentConfig']>,
    overrides: {
      systemPrompt: string;
      workingDir?: string;
      maxIterations: number;
      temperature?: number;
      maxTokens?: number;
    },
  ): AgentConfig {
    const cfg = agentCfg as any;
    // 兼容两种 config 格式：YAML 配置 (model: { primary: string }) 和运行时配置 (model: string)
    const model = typeof cfg?.model === 'string' ? cfg.model : cfg?.model?.primary;
    const thinkingRaw = typeof cfg?.model === 'object' ? cfg?.model?.thinking : cfg?.thinking;
    const thinking = thinkingRaw?.type && thinkingRaw.type !== 'disabled' ? thinkingRaw : undefined;

    const contextSize = typeof cfg?.model === 'object' ? cfg?.model?.contextSize : undefined;
    const runtimeConfig: AgentConfig = {
      model: model!,
      systemPrompt: overrides.systemPrompt,
      maxIterations: overrides.maxIterations,
      temperature: overrides.temperature,
      maxTokens: overrides.maxTokens ?? (typeof cfg?.model === 'object' ? cfg?.model?.maxTokens : (cfg?.maxTokens ?? undefined)),
      thinking,
      workingDir: overrides.workingDir,
      apiKey: cfg?.provider?.apiKey ?? cfg?.apiKey!,
      baseURL: cfg?.provider?.baseURL ?? cfg?.baseURL!,
      contextSize,
    };

    log.debug(`[buildRuntimeConfig] model=${runtimeConfig.model} baseURL=${runtimeConfig.baseURL || 'none'}`);

    return runtimeConfig;
  }

}

// ─── ACP 事件转发映射 ─────────────────────────────────────

const ACP_EVENT_BUS_MAP: Record<string, [string, (data: any, agentId: string) => Record<string, unknown>]> = {
  text: [XuanjiEvent.AGENT_TEXT_DELTA, (d, id) => ({ text: d.text, agentId: id })],
  thinking: [XuanjiEvent.AGENT_THINKING_DELTA, (d, id) => ({ content: d.content, agentId: id })],
  tool_start: [XuanjiEvent.AGENT_TOOL_START, (d, id) => ({ id: d.id, name: d.name, input: d.input, agentId: id })],
  tool_end: [XuanjiEvent.AGENT_TOOL_END, (d, id) => ({ id: d.id, name: d.name, result: d.result, isError: d.isError, agentId: id, metadata: d.metadata })],
  tool_delta: [XuanjiEvent.AGENT_TOOL_DELTA, (d, id) => ({ id: d.id, name: d.name, receivedBytes: d.receivedBytes })],
};

const ACP_HOOK_MAP: Record<string, [string, (data: any, agentId: string) => Record<string, unknown>]> = {
  text: ['SubAgentText', (d, id) => ({ subAgentId: id, text: d.text })],
  thinking: ['AgentThinking', (d, id) => ({ subAgentId: id, thinkingContent: d.content })],
  tool_start: ['ToolStart', (d, id) => ({ subAgentId: id, toolId: d.id, toolName: d.name, toolInput: d.input })],
  tool_end: ['ToolEnd', (d, id) => ({ subAgentId: id, toolId: d.id, toolName: d.name, toolResult: d.result, toolIsError: d.isError })],
};

function forwardAcpEvent(eventType: string, data: any, agentId: string, hookRegistry: HookRegistry | null): void {
  const busEntry = ACP_EVENT_BUS_MAP[eventType];
  if (busEntry) eventBus.emitSync(busEntry[0], busEntry[1](data, agentId));
  const hookEntry = ACP_HOOK_MAP[eventType];
  if (hookEntry && hookRegistry) {
    hookRegistry.emit(hookEntry[0] as any, hookEntry[1](data, agentId)).catch(() => {});
  }
}
