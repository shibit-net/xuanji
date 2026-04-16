/**
 * SubAgentFactory - 统一的子代理工厂
 *
 * 职责：
 * 1. 统一子 Agent 创建入口（融合硬编码角色 + 可配置 Agent）
 * 2. 配置优先策略：AgentRegistry (project/global/builtin) > 默认配置
 * 3. 动态降级：找不到配置时降级到 general-purpose
 * 4. Provider 配置继承策略（移除"全局 light 配置"概念）：
 *    - 预置 Agent（有 provider.apiKey）→ 使用独立 provider
 *    - 临时 Agent（无 provider 配置）→ 继承父 agent 的 provider
 *    - 错误情况（临时 Agent 且无父 provider）→ 抛出错误
 *
 * 架构优势：
 * - ✅ 废弃 lightProvider（每个 Agent 配置自己的 model）
 * - ✅ 支持用户自定义 Agent（.xuanji/agents/*.json5）
 * - ✅ 统一代码路径（消除 executePresetAgent / executeDynamicAgent 分支）
 * - ✅ 易于测试和维护
 *
 * 迁移策略：
 * - SubAgentFactory.createAndRun() - 新接口，推荐使用
 * - runSubAgent() - 保留作为向后兼容（标记 @deprecated）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ILLMProvider, IToolRegistry, AgentConfig } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import type { ConfigurableAgentConfig } from './types';
import type { AgentRegistry } from './AgentRegistry';
import type { ProviderManager } from '@/core/providers/ProviderManager';
import type { LayeredPromptBuilder } from '@/core/prompt/LayeredPromptBuilder';
import { SubAgentContext, type IsolationMode, type AgentRoleType } from './SubAgentContext';
import { AgentLoop } from './AgentLoop';
import { ProjectScanner } from '@/context/ProjectScanner';
import { RulesLoader } from '@/core/config/RulesLoader';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SubAgentFactory' });

/**
 * 子代理创建选项
 */
export interface SubAgentFactoryOptions {
  /** 任务描述 */
  task: string;
  /** 超时（毫秒） */
  timeout?: number;
  /** 最大迭代次数 */
  maxIterations?: number;
  /** 嵌套深度 */
  depth?: number;
  /** 隔离模式 */
  isolation?: IsolationMode;
  /** 父代理配置（用于继承部分配置） */
  parentConfig?: AgentConfig;
  /**
   * 动态 System Prompt（覆盖配置文件中的 systemPrompt）
   * 找不到预置配置时，作为子 Agent 的完整 system prompt
   */
  systemPrompt?: string;
  /**
   * 动态工具白名单（覆盖配置文件中的 tools）
   * 找不到预置配置时，作为子 Agent 的工具列表
   */
  tools?: string[];
  /**
   * 是否禁用 SubAgentStart Hook（用于 TeamManager，避免重复事件）
   */
  skipSubAgentStartHook?: boolean;
  /**
   * 父 Agent ID（用于 WorkspaceMonitor 显示层级关系）
   */
  parentAgentId?: string;
}

/**
 * 子代理创建结果
 */
export interface SubAgentInstance {
  /** AgentLoop 实例 */
  agentLoop: AgentLoop;
  /** 使用的配置 */
  config: ConfigurableAgentConfig;
  /** 上下文 */
  context: SubAgentContext;
  /** 子代理 ID */
  subAgentId: string;
}

/**
 * 工具过滤的注册表代理
 */
class FilteredToolRegistry implements IToolRegistry {
  private inner: IToolRegistry;
  private allowedTools: Set<string>;

  constructor(inner: IToolRegistry, allowedTools: string[], isSystemAgent = false) {
    this.inner = inner;
    this.allowedTools = new Set(allowedTools);

    // 自动注入基础工具（除非是系统内部 Agent）
    if (!isSystemAgent) {
      // 记忆工具作为基础能力，所有非系统 Agent 都可用
      this.allowedTools.add('memory_search');
      this.allowedTools.add('memory_store');
      this.allowedTools.add('retrieve_memory');
    }
  }

  register(): void {
    throw new Error('Sub-agent cannot register tools');
  }

  unregister(): void {
    throw new Error('Sub-agent cannot unregister tools');
  }

  get(name: string): any | undefined {
    if (!this.allowedTools.has(name)) return undefined;
    return this.inner.get(name);
  }

  getAll(): any[] {
    return this.inner.getAll().filter((t: any) => this.allowedTools.has(t.name));
  }

  getSchemas(): any[] {
    return this.getAll().map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));
  }

  has(name: string): boolean {
    return this.allowedTools.has(name) && this.inner.has(name);
  }

  async execute(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
    if (!this.allowedTools.has(name)) {
      return {
        content: `Tool "${name}" is not available in this sub-agent.`,
        isError: true,
      };
    }
    return this.inner.execute(name, input, signal);
  }
}

/**
 * SubAgentFactory
 */
export class SubAgentFactory {
  private promptBuilder: LayeredPromptBuilder | null = null;
  private parentProvider: ILLMProvider | null = null;

  constructor(
    public agentRegistry: AgentRegistry, // 改为 public，允许 TeamManager 访问
    private providerManager: ProviderManager,
    private baseRegistry: IToolRegistry,
    private hookRegistry?: HookRegistry | null,
    private memoryStore?: IMemoryStore | null,
    parentProvider?: ILLMProvider | null,
  ) {
    // 防御性检查：确保 agentRegistry 不是 undefined
    if (!agentRegistry) {
      const error = new Error('SubAgentFactory: agentRegistry is undefined or null');
      console.error('[SubAgentFactory] 构造函数收到 undefined/null agentRegistry', error.stack);
      throw error;
    }
    this.parentProvider = parentProvider ?? null;
  }

  /**
   * 注入 LayeredPromptBuilder（由 ChatSession 调用）
   * 用于为子 Agent 构建统一的基础 prompt
   */
  setPromptBuilder(builder: LayeredPromptBuilder): void {
    this.promptBuilder = builder;
  }

  /**
   * 创建子代理实例
   *
   * @param agentIdOrRole - Agent ID 或角色类型（优先查 AgentRegistry，找不到降级到 builtin）
   * @param options - 创建选项
   */
  async createSubAgent(
    agentIdOrRole: string,
    options: SubAgentFactoryOptions,
  ): Promise<SubAgentInstance> {
    const startTime = Date.now();

    // 1. 查找 Agent 配置（优先级：project > global > builtin）
    const agentConfig = this.resolveAgentConfig(agentIdOrRole);

    if (!agentConfig) {
      throw new Error(`Agent configuration not found: ${agentIdOrRole}`);
    }

    log.info(`🤖 Creating sub-agent: ${agentConfig.name} (${agentConfig.id})`);
    log.debug(`  Model: ${agentConfig.model.primary}`);
    log.debug(`  Tools: ${agentConfig.tools.length} tools`);
    log.debug(`  Source: ${agentConfig.metadata?.source || 'unknown'}`);

    // 2. 创建 SubAgentContext（深度控制、工具过滤）
    const context = new SubAgentContext({
      task: options.task,
      timeout: options.timeout ?? agentConfig.execution.timeout,
      maxIterations: options.maxIterations ?? agentConfig.execution.maxIterations,
      depth: options.depth ?? 0,
      isolation: options.isolation ?? 'none',
      role: agentIdOrRole as AgentRoleType,  // 保留角色信息用于日志
    });

    // 检查深度
    if (context.isDepthExceeded()) {
      throw new Error(`Maximum nesting depth exceeded (depth=${context.depth})`);
    }

    // 3. 创建 Provider（配置继承策略）
    // 策略：
    // - 预置 Agent（配置了独立 provider.apiKey/baseURL/adapter）→ 使用 ProviderManager 创建独立 provider
    // - 临时 Agent（无 provider 配置）→ 沿用父 Agent 的 provider
    // - 错误情况：临时 Agent 且无父 provider → 抛出错误（不再有"全局 light 配置"概念）
    let provider: ILLMProvider;

    // 🔍 调试：检查 provider 配置
    log.debug(`  Agent config provider:`, JSON.stringify((agentConfig as any).provider, null, 2));

    const hasIndependentProvider = !!(agentConfig as any).provider?.apiKey
      || !!(agentConfig as any).provider?.baseURL
      || !!(agentConfig as any).provider?.adapter;

    log.debug(`  hasIndependentProvider: ${hasIndependentProvider}`);

    if (hasIndependentProvider) {
      // 预置 Agent：有独立配置
      log.debug(`  Using independent provider for agent: ${agentConfig.id}`);
      provider = this.providerManager.getProvider({
        id: agentConfig.id,
        model: agentConfig.model,
        provider: (agentConfig as any).provider,
      } as any);
    } else {
      // 临时 Agent：必须复用父 Provider
      if (this.parentProvider) {
        log.debug(`  Using parent provider for temporary agent: ${agentConfig.id}`);
        provider = this.parentProvider;
      } else {
        // 错误：临时 Agent 无法创建（缺少 API Key 配置）
        throw new Error(
          `Cannot create temporary agent "${agentConfig.id}" without parent provider. ` +
          `Either configure a preset agent with provider.apiKey in agent config, ` +
          `or ensure parent agent has valid provider configuration.`
        );
      }
    }

    // 4. 创建过滤后的工具注册表
    // 优先用参数指定的工具列表，其次用配置文件中的工具列表
    const allowedTools = options.tools && options.tools.length > 0
      ? options.tools
      : agentConfig.tools.map((t) => t.name);

    // 判断是否为系统内部 Agent
    const isSystemAgent = agentConfig.metadata?.internal === true;
    const filteredRegistry = new FilteredToolRegistry(this.baseRegistry, allowedTools, isSystemAgent);

    // 5. 构建完整的 System Prompt
    // 如果有 LayeredPromptBuilder，使用统一的基础层 + 角色专用层
    // 否则回退到旧的 buildSystemPrompt 方法
    let systemPrompt: string;
    const isInternalAgent = agentConfig.metadata?.internal === true;

    if (this.promptBuilder && !isInternalAgent && !options.systemPrompt) {
      // 使用 LayeredPromptBuilder 构建统一 prompt（基础层 + 角色专用层）
      try {
        const buildResult = await this.promptBuilder.buildForSubAgent({
          agentId: agentConfig.id,
          agentConfig,
          includeProjectContext: !isInternalAgent,
        });
        systemPrompt = buildResult.prompt;

        // 追加子代理模式标记和项目规则
        const projectRules = this.loadProjectRules();
        if (projectRules) {
          systemPrompt += `\n\n---\n[Project Rules]\n${projectRules}`;
        }
        const depth = options.depth ?? 0;
        systemPrompt += `\n\n---\n[SubAgent Mode - Depth: ${depth}, Role: ${agentConfig.id}]\nDo NOT ask clarifying questions. Do NOT start new sub-tasks.`;

        log.debug(`  Prompt built via LayeredPromptBuilder: ${buildResult.components.join(', ')}`);
      } catch (err) {
        log.warn(`Failed to build prompt via LayeredPromptBuilder, falling back:`, err);
        const baseSystemPrompt = agentConfig.systemPrompt ?? '';
        systemPrompt = this.buildSystemPrompt(
          { ...agentConfig, systemPrompt: baseSystemPrompt },
          options,
        );
      }
    } else {
      // 回退：使用旧的 buildSystemPrompt 方法
      const baseSystemPrompt = options.systemPrompt ?? agentConfig.systemPrompt ?? '';
      systemPrompt = this.buildSystemPrompt(
        { ...agentConfig, systemPrompt: baseSystemPrompt },
        options,
      );
    }

    // 6. 构建 AgentConfig
    const thinkingRaw = agentConfig.model.thinking;
    const thinking = thinkingRaw?.type && thinkingRaw.type !== 'disabled'
      ? thinkingRaw as import('@/core/types').ThinkingConfig
      : undefined;

    // 从 agent 配置中提取 provider 信息（apiKey/baseURL）
    const agentProvider = (agentConfig as any).provider;

    const runtimeConfig: AgentConfig = {
      model: agentConfig.model.primary,
      systemPrompt,
      maxIterations: context.maxIterations,
      temperature: agentConfig.model.temperature,
      maxTokens: agentConfig.model.maxTokens,
      thinking,
      // 添加 provider 配置（如果存在）
      apiKey: agentProvider?.apiKey,
      baseURL: agentProvider?.baseURL,
    };

    // 7. 创建 AgentLoop
    const agentLoop = new AgentLoop(
      provider,
      filteredRegistry,
      runtimeConfig,
      undefined,  // 子 Agent 不自动注入记忆
    );

    // 8. 注入 Hook
    if (this.hookRegistry) {
      agentLoop.setHookRegistry(this.hookRegistry);
    }

    const subAgentId = `subagent-${agentConfig.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    log.debug(`✓ Sub-agent created in ${Date.now() - startTime}ms: ${subAgentId}`);

    return {
      agentLoop,
      config: agentConfig,
      context,
      subAgentId,
    };
  }

  /**
   * 解析 Agent 配置
   *
   * 从 AgentRegistry 查找配置，找不到则报错
   */
  private resolveAgentConfig(agentIdOrRole: string): ConfigurableAgentConfig | null {
    const config = this.agentRegistry.get(agentIdOrRole);

    if (!config) {
      log.error(`❌ Agent 配置不存在: ${agentIdOrRole}`);
      return null;
    }

    log.debug(`✓ 找到 Agent 配置: ${agentIdOrRole}`);

    // 🔍 调试：检查 provider 配置是否存在
    const hasProvider = !!(config as any).provider;
    const hasApiKey = !!(config as any).provider?.apiKey;
    log.debug(`  Provider 配置存在: ${hasProvider}, 有 apiKey: ${hasApiKey}`);
    if (hasProvider) {
      log.debug(`  Provider 详情:`, {
        adapter: (config as any).provider.adapter,
        baseURL: (config as any).provider.baseURL,
        apiKeyPreview: (config as any).provider.apiKey?.slice(0, 15) + '...',
      });
    }

    return config;
  }

  /**
   * 构建完整的 System Prompt
   *
   * 合并：
   * - Agent 配置的 systemPrompt
   * - 项目规则（XUANJI.md + rules.md，轻量注入）
   * - 子代理标记（深度、角色）
   */
  private buildSystemPrompt(
    agentConfig: ConfigurableAgentConfig,
    options: SubAgentFactoryOptions,
  ): string {
    let prompt = agentConfig.systemPrompt || '';

    // 注入项目规则（XUANJI.md + rules.md）
    const projectRules = this.loadProjectRules();
    if (projectRules) {
      prompt += `\n\n---\n[Project Rules]\n${projectRules}`;
    }

    // 追加子代理模式标记
    const depth = options.depth ?? 0;
    const subAgentHeader = [
      `\n\n---\n[SubAgent Mode - Depth: ${depth}, Role: ${agentConfig.id}]`,
      `Do NOT ask clarifying questions. Do NOT start new sub-tasks.`,
    ].join('\n');

    prompt += subAgentHeader;

    return prompt;
  }

  /**
   * 同步加载项目规则文件（XUANJI.md + .xuanji/rules.md + ~/.xuanji/rules.md）
   * 轻量版：不做文件索引，只注入规则文本
   */
  private loadProjectRules(): string {
    try {
      const scanner = new ProjectScanner();
      const { rootPath } = scanner.scan();
      const loader = new RulesLoader();
      return loader.loadAsTextSync(rootPath);
    } catch {
      return '';
    }
  }

  /**
   * 创建并执行子代理（一步到位）
   *
   * 封装 createSubAgent + agentLoop.run 的完整流程，包括：
   * - Hook 事件触发（SubAgentStart/SubAgentEnd）
   * - 超时控制
   * - 输出收集
   * - 错误处理
   *
   * @returns SubAgentResult
   */
  async createAndRun(
    agentIdOrRole: string,
    options: SubAgentFactoryOptions,
    externalSignal?: AbortSignal, // 🔧 添加外部 AbortSignal
  ): Promise<{
    result: string;
    tokensUsed: { input: number; output: number };
    duration: number;
    timedOut: boolean;
    iterations: number;
  }> {
    const startTime = Date.now();

    // 1. 创建子代理实例
    const { agentLoop, config, context, subAgentId } = await this.createSubAgent(
      agentIdOrRole,
      options,
    );

    // 2. 收集输出
    let outputText = '';
    let timedOut = false;

    agentLoop.on({
      onText: (text) => {
        outputText += text;
      },
      onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
        // 触发 ToolStart Hook，传递给前端（带 subAgentId）
        if (this.hookRegistry) {
          this.hookRegistry.emit('ToolStart', {
            subAgentId,
            toolId: id,
            toolName: name,
            toolInput: input,
          }).catch((err) => {
            log.warn('ToolStart Hook failed:', err);
          });
        }
      },
      onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
        // 触发 ToolEnd Hook，传递给前端（带 subAgentId）
        if (this.hookRegistry) {
          this.hookRegistry.emit('ToolEnd', {
            subAgentId,
            toolId: id,
            toolName: name,
            toolResult: result,
            toolIsError: isError,
          }).catch((err) => {
            log.warn('ToolEnd Hook failed:', err);
          });
        }
      },
    });

    // 3. 触发 SubAgentStart Hook（除非被禁用）
    if (this.hookRegistry && !options.skipSubAgentStartHook) {
      this.hookRegistry.emit('SubAgentStart', {
        subAgentId,
        data: {
          task: options.task,
          depth: context.depth,
          role: config.id,
          name: config.name, // 传递 Agent 名称
          builtin: config.metadata?.builtin === true, // 传递是否为内置 Agent
          parentAgentId: options.parentAgentId || 'main', // 🔧 传递父 Agent ID
        },
      }).catch((err) => {
        log.debug('SubAgentStart hook emit failed:', err);
      });
    }

    log.info(`[${subAgentId}] Starting sub-agent (depth=${context.depth}, timeout=${context.timeout}ms)`);

    // 4. 带超时执行
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let externalAborted = false;
    const onExternalAbort = () => {
      agentLoop.stop();
      externalAborted = true;
      log.warn(`[${subAgentId}] Sub-agent aborted by external signal`);
    };
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const runPromise = agentLoop.run(options.task);
      runPromise.catch(() => {});  // 防止 unhandled rejection

      if (context.timeout > 0) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(() => {
            agentLoop.stop();
            timedOut = true;
            reject(new Error(`Sub-agent timed out after ${context.timeout}ms`));
          }, context.timeout);
        });

        await Promise.race([runPromise, timeoutPromise]);
      } else {
        await runPromise;
      }
    } catch (error: any) {
      if (externalAborted) {
        log.warn(`[${subAgentId}] Aborted by user`);
        outputText += `\n\n[Aborted by user]`;
      } else if (!timedOut) {
        log.error(`[${subAgentId}] Error:`, error.message);
        outputText += `\n\n[Error] ${error.message}`;
      }
    } finally {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }

    const duration = Date.now() - startTime;
    const state = agentLoop.getState();

    // 5. 触发 SubAgentEnd Hook
    if (this.hookRegistry) {
      this.hookRegistry.emit('SubAgentEnd', {
        subAgentId,
        data: {
          task: options.task,
          depth: context.depth,
          duration,
          timedOut,
          iterations: state.currentIteration,
        },
      }).catch(() => {});
    }

    log.info(
      `[${subAgentId}] Finished in ${duration}ms (${state.currentIteration} iterations, timedOut=${timedOut})`,
    );

    // 6. 返回结果
    return {
      result: outputText || (timedOut ? `Timed out after ${context.timeout}ms` : 'No output'),
      tokensUsed: state.tokenUsage,
      duration,
      timedOut,
      iterations: state.currentIteration,
    };
  }
}
