/**
 * AgentFactory — Agent 工厂
 *
 * 职责：创建完整的、配置正确的 AgentLoop 实例。
 * 替代旧的 SubAgentFactory / TemporaryAgentFactory，统一主 Agent 和子 Agent 的创建流程。
 */

import type { ILLMProvider, IToolRegistry, AgentConfig, ToolSchema } from '@/core/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import type { ConfigurableAgentConfig } from '@/core/agent/types';
import { AgentLoop } from '../AgentLoop';
import { logger } from '@/core/logger';
import { setLogContext } from '@/core/logger/implementations/PinoLogger';
import { getConfigManager } from '@/core/config/ConfigManager';
import { ProviderPool } from '@/core/providers/ProviderPool';
import { ProviderFactory } from '@/core/providers/ProviderFactory';
import type { PromptComposer, ComposeContext, SubAgentComposeContext } from '@/core/prompt/PromptComposer';

const log = logger.child({ module: 'AgentFactory' });

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

interface PooledAgent {
  agent: AgentLoop;
  inUse: boolean;
  lastUsed: number;
}

export class AgentFactory {
  private providerPool: ProviderPool;
  private promptComposer: PromptComposer | null = null;
  private baseRegistry: IToolRegistry;
  private agentPool = new Map<string, PooledAgent>();
  private maxPoolSize = 10;
  private maxIdleMs = 5 * 60 * 1000;
  private hookRegistry: HookRegistry | null = null;
  private temporaryAgents = new Map<string, ConfigurableAgentConfig>();
  private scenePromptCache = new Map<string, string>();
  private _parentProvider?: ILLMProvider;
  private _parentConfig?: AgentConfig;

  constructor(baseRegistry: IToolRegistry) {
    this.baseRegistry = baseRegistry;
    const providerFactory = new ProviderFactory();
    this.providerPool = new ProviderPool(
      (config) => providerFactory.create(config),
    );
  }

  setPromptComposer(composer: PromptComposer): void {
    this.promptComposer = composer;
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
   * 创建主 Agent（用于对话管理中心的顶层 Agent）
   */
  async createMainAgent(agentId: string, options: AgentCreateOptions): Promise<AgentInstance> {
    const cfgMgr = getConfigManager();
    const agentCfg = cfgMgr.getAgentConfig(agentId);
    const settings = cfgMgr.getSettings();

    if (!agentCfg || agentCfg.enabled === false) {
      throw new Error(`Agent "${agentId}" not found or disabled`);
    }

    // 解析 provider
    const provider = this.resolveProvider(agentCfg, options.parentProvider);

    // 构建 system prompt
    const systemPrompt = await this.buildMainPrompt(agentCfg, options);

    // 过滤工具
    const allowedTools = this.resolveTools(agentCfg, options.toolWhitelist);
    const registry = this.createFilteredRegistry(allowedTools, {
      agentId,
      workingDir: options.workingDir,
    });

    // 构建 AgentConfig
    const runtimeConfig = this.buildRuntimeConfig(agentCfg, {
      systemPrompt,
      workingDir: options.workingDir,
      maxIterations: options.maxIterations ?? agentCfg.execution?.maxIterations ?? settings.maxIterations,
      temperature: agentCfg.model?.temperature ?? settings.temperature,
      maxTokens: agentCfg.model?.maxTokens ?? settings.maxTokens,
    }, provider);

    const agentLoop = new AgentLoop(provider, registry, runtimeConfig);

    if (this.hookRegistry) {
      agentLoop.setHookRegistry(this.hookRegistry);
    }

    return {
      agentLoop,
      config: runtimeConfig,
      subAgentId: options.subAgentId || agentId,
      depth: options.depth ?? 0,
    };
  }

  /**
   * 创建子 Agent（用于 task/team 工具创建的临时或预置 Agent）
   */
  async createSubAgent(agentId: string, options: AgentCreateOptions): Promise<AgentInstance> {
    const cfgMgr = getConfigManager();
    let agentCfg = cfgMgr.getAgentConfig(agentId);

    if (!agentCfg) {
      // 找不到配置，降级到 general-purpose
      agentCfg = cfgMgr.getAgentConfig('general-purpose');
      if (!agentCfg) {
        throw new Error(`Agent "${agentId}" not found and no fallback`);
      }
      log.warn(`Agent "${agentId}" not found, falling back to general-purpose`);
    }

    if (agentCfg.enabled === false) {
      throw new Error(`Agent "${agentCfg.name}" is disabled`);
    }

    // 解析 provider（子 Agent 可继承父 provider）
    const hasIndependentProvider = !!(agentCfg.provider?.apiKey || agentCfg.provider?.baseURL || agentCfg.provider?.adapter);
    let provider: ILLMProvider;

    if (hasIndependentProvider) {
      provider = this.providerPool.getProvider({
        adapter: agentCfg.provider?.adapter ?? 'anthropic',
        model: agentCfg.model?.primary ?? 'claude-sonnet-4-6',
        apiKey: agentCfg.provider?.apiKey ?? '',
        baseURL: agentCfg.provider?.baseURL ?? '',
      });
    } else if (options.parentProvider) {
      provider = options.parentProvider;
    } else {
      throw new Error(`Cannot create sub-agent "${agentId}" without provider config or parent provider`);
    }

    // 构建 system prompt
    const systemPrompt = await this.buildSubPrompt(agentCfg, options);

    // 解析工具（合并 required 工具和 whitelist）
    const allowedTools = this.resolveTools(agentCfg, options.toolWhitelist);
    const registry = this.createFilteredRegistry(allowedTools, {
      agentId,
      workingDir: options.workingDir,
    });

    // 构建 runtime config
    const runtimeConfig = this.buildRuntimeConfig(agentCfg, {
      systemPrompt,
      workingDir: options.workingDir,
      maxIterations: options.maxIterations ?? agentCfg.execution?.maxIterations ?? 20,
      temperature: agentCfg.model?.temperature,
      maxTokens: agentCfg.model?.maxTokens,
    }, provider);

    const agentLoop = new AgentLoop(provider, registry, runtimeConfig);

    if (this.hookRegistry) {
      agentLoop.setHookRegistry(this.hookRegistry);
    }

    const subAgentId = options.subAgentId || `subagent-${agentId}-${Date.now()}`;

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

    // 1. 场景 prompt 加载
    const scenesToLoad = options.scenes && options.scenes.length > 0
      ? options.scenes
      : options.scene ? [options.scene] : [];
    if (scenesToLoad.length > 0 && !options.scenePrompt && this.promptComposer) {
      try {
        const loadedScenes: string[] = [];
        for (const rawScene of scenesToLoad) {
          const normalizedScene = rawScene.replace(/^l[12]-/, '');
          const sceneContent = await this.loadScenePrompt(normalizedScene);
          if (sceneContent) {
            loadedScenes.push(sceneContent);
          }
        }
        if (loadedScenes.length > 0) {
          options.scenePrompt = loadedScenes.join('\n\n');
        }
      } catch (err) {
        log.warn(`Failed to load scene prompts:`, err);
      }
    }

    // 2. 获取 agent 配置（用于 Hook 元数据）
    const cfgMgr = getConfigManager();
    let agentConfig = cfgMgr.getAgentConfig(agentIdOrRole);
    const isTemporary = this.isTemporaryAgent(agentIdOrRole);

    if (!agentConfig && !isTemporary) {
      agentConfig = cfgMgr.getAgentConfig('general-purpose');
    }

    // 3. 解析 parentProvider（options 优先，其次 setters）
    const parentProvider = options.parentProvider ?? this._parentProvider;
    const parentConfig = options.parentConfig ?? this._parentConfig;

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
      });
      agentLoop = result.agentLoop;
      subAgentId = result.subAgentId;
    } catch (error: any) {
      const duration = Date.now() - startTime;
      return {
        result: `[Error] Failed to create sub-agent: ${error.message}`,
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
      onToolEnd: (id, name, result, isError) => {
        if (this.hookRegistry) {
          this.hookRegistry.emit('ToolEnd', { subAgentId, toolId: id, toolName: name, toolResult: result, toolIsError: isError }).catch(() => {});
        }
      },
    });

    // 6. 触发 SubAgentStart Hook
    if (this.hookRegistry && !options.skipSubAgentStartHook && agentConfig) {
      const category = (agentConfig as any).metadata?.category || 'custom';
      const agentType = isTemporary ? 'temporary' :
        category === 'system' ? 'builtin' :
        category === 'app' ? 'preset' : 'custom';

      this.hookRegistry.emit('SubAgentStart', {
        subAgentId,
        data: {
          task: options.task,
          depth: options.depth ?? 0,
          role: agentConfig.id,
          name: agentConfig.name,
          agentType,
          parentAgentId: options.parentAgentId || 'main',
          streamToUser: options.streamToUser || false,
          scene: options.scene,
        },
      }).catch(() => {});
    }

    // 7. 带超时执行
    let timedOut = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

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

    // 8. 触发 SubAgentEnd Hook
    if (this.hookRegistry) {
      this.hookRegistry.emit('SubAgentEnd', {
        subAgentId,
        data: {
          task: options.task,
          depth: options.depth ?? 0,
          duration,
          timedOut,
          success: !timedOut,
          iterations: state.currentIteration,
          result: outputText,
          tokensUsed: state.tokenUsage,
        },
      }).catch(() => {});
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

  /** AgentPool: 获取或复用已创建的 agent */
  acquire(agentId: string): AgentLoop | undefined {
    const entry = this.agentPool.get(agentId);
    if (entry && !entry.inUse) {
      entry.inUse = true;
      entry.lastUsed = Date.now();
      return entry.agent;
    }
    return undefined;
  }

  /** AgentPool: 释放引用 */
  release(agentId: string): void {
    const entry = this.agentPool.get(agentId);
    if (entry) entry.inUse = false;
  }

  /** AgentPool: 缓存 agent */
  cache(agentId: string, agent: AgentLoop): void {
    if (this.agentPool.size >= this.maxPoolSize) {
      this.evictOne();
    }
    this.agentPool.set(agentId, { agent, inUse: false, lastUsed: Date.now() });
  }

  abortAll(): void {
    for (const [, entry] of this.agentPool) {
      try { entry.agent.stop(); } catch { /* ignore */ }
    }
    this.agentPool.clear();
  }

  evictIdle(): void {
    const now = Date.now();
    for (const [key, entry] of this.agentPool) {
      if (!entry.inUse && now - entry.lastUsed > this.maxIdleMs) {
        this.agentPool.delete(key);
      }
    }
  }

  // ─── Temporary Agent (接管自 TemporaryAgentFactory) ─────

  createTemporaryAgentConfig(options: TemporaryAgentOptions): ConfigurableAgentConfig {
    const { role, capabilities, scene, taskDescription, model, parentConfig } = options;
    const tempId = `temp-${role.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

    const systemPrompt = this.generateTempSystemPrompt(role, capabilities, taskDescription);

    const provider = parentConfig?.provider
      ? { ...parentConfig.provider }
      : { adapter: 'anthropic' as const };

    const tempAgent: ConfigurableAgentConfig = {
      id: tempId,
      name: role,
      description: `临时创建的 ${role}，用于完成特定任务`,
      avatar: '🤖',
      color: 'from-gray-500 to-gray-600',
      category: 'custom',
      model: {
        primary: model || parentConfig?.model?.primary || 'claude-sonnet-4-6',
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
        maxIterations: 20,
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

  getTemporaryAgent(id: string): ConfigurableAgentConfig | undefined {
    return this.temporaryAgents.get(id);
  }

  cleanupTemporaryAgent(id: string): void {
    if (this.temporaryAgents.has(id)) {
      this.temporaryAgents.delete(id);
    }
  }

  cleanupAllTemporary(): void {
    this.temporaryAgents.clear();
  }

  isTemporaryAgent(id: string): boolean {
    return id.startsWith('temp-') || this.temporaryAgents.has(id);
  }

  getAllTemporaryAgents(): ConfigurableAgentConfig[] {
    return Array.from(this.temporaryAgents.values());
  }

  // ─── Private ────────────────────────────────────────────

  /** 加载场景 prompt（带缓存） */
  private async loadScenePrompt(scene: string): Promise<string | undefined> {
    const cached = this.scenePromptCache.get(scene);
    if (cached !== undefined) return cached || undefined;

    if (!this.promptComposer) {
      this.scenePromptCache.set(scene, '');
      return undefined;
    }

    try {
      const l1Components = (this.promptComposer as any).l1Components;
      if (!l1Components) {
        this.scenePromptCache.set(scene, '');
        return undefined;
      }

      for (const comp of l1Components.values()) {
        if (comp.scenes?.includes(scene)) {
          const content = await comp.render({});
          this.scenePromptCache.set(scene, content || '');
          return content || undefined;
        }
      }
      this.scenePromptCache.set(scene, '');
      return undefined;
    } catch {
      this.scenePromptCache.set(scene, '');
      return undefined;
    }
  }

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

  private resolveProvider(agentCfg: ReturnType<typeof getConfigManager>['getAgentConfig'], parentProvider?: ILLMProvider): ILLMProvider {
    const hasIndependent = !!(agentCfg?.provider?.apiKey || agentCfg?.provider?.baseURL);
    if (hasIndependent && agentCfg?.provider) {
      return this.providerPool.getProvider({
        adapter: agentCfg.provider.adapter ?? 'anthropic',
        model: agentCfg.model?.primary ?? 'claude-sonnet-4-6',
        apiKey: agentCfg.provider.apiKey ?? '',
        baseURL: agentCfg.provider.baseURL ?? '',
      });
    }
    if (parentProvider) return parentProvider;
    throw new Error('No provider available for agent');
  }

  private async buildMainPrompt(
    agentCfg: NonNullable<ReturnType<typeof getConfigManager>['getAgentConfig']>,
    options: AgentCreateOptions,
  ): Promise<string> {
    // Agent 自身的 systemPrompt
    let prompt = (agentCfg as any).systemPrompt || '';

    if (this.promptComposer) {
      const composed = await this.promptComposer.composeForMainAgent({
        userMessage: options.taskDescription || '',
        scene: options.scene || 'coding',
        complexity: options.complexity || 'standard',
        agent: agentCfg.id,
        intentHint: '',
      });
      prompt = composed.systemPrompt + '\n\n' + prompt;
    }

    return prompt;
  }

  private async buildSubPrompt(
    agentCfg: NonNullable<ReturnType<typeof getConfigManager>['getAgentConfig']>,
    options: AgentCreateOptions,
  ): Promise<string> {
    let prompt = (agentCfg as any).systemPrompt || '';

    if (this.promptComposer) {
      const composed = await this.promptComposer.composeForSubAgent({
        agentId: agentCfg.id,
        scene: options.scene || 'coding',
        taskDescription: options.taskDescription || '',
        depth: options.depth ?? 0,
      });
      prompt = composed.systemPrompt + '\n\n' + prompt;
    }

    prompt += `\n\n---\n# SubAgent 模式\nDepth: ${options.depth ?? 0}, Role: ${agentCfg.id}\n不要提出澄清问题，专注于完成分配的任务。`;

    return prompt;
  }

  private resolveTools(
    agentCfg: NonNullable<ReturnType<typeof getConfigManager>['getAgentConfig']>,
    whitelist?: string[],
  ): string[] {
    const configTools = (agentCfg.tools as any[])?.map((t: any) => t.name) || [];
    if (whitelist && whitelist.length > 0) {
      const requiredTools = (agentCfg.tools as any[])
        ?.filter((t: any) => t.required)
        ?.map((t: any) => t.name) || [];
      return [...new Set([...whitelist, ...requiredTools])];
    }
    return configTools;
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
    agentCfg: NonNullable<ReturnType<typeof getConfigManager>['getAgentConfig']>,
    overrides: {
      systemPrompt: string;
      workingDir?: string;
      maxIterations: number;
      temperature?: number;
      maxTokens?: number;
    },
    _provider: ILLMProvider,
  ): AgentConfig {
    const thinkingRaw = (agentCfg.model as any)?.thinking;
    const thinking = thinkingRaw?.type && thinkingRaw.type !== 'disabled' ? thinkingRaw : undefined;

    return {
      model: agentCfg.model?.primary ?? 'claude-sonnet-4-6',
      systemPrompt: overrides.systemPrompt,
      maxIterations: overrides.maxIterations,
      temperature: overrides.temperature,
      maxTokens: overrides.maxTokens,
      thinking,
      workingDir: overrides.workingDir,
      apiKey: agentCfg.provider?.apiKey,
      baseURL: agentCfg.provider?.baseURL,
    };
  }

  private evictOne(): void {
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [key, entry] of this.agentPool) {
      if (!entry.inUse && entry.lastUsed < oldestTime) {
        oldestKey = key;
        oldestTime = entry.lastUsed;
      }
    }
    if (oldestKey) this.agentPool.delete(oldestKey);
  }
}
