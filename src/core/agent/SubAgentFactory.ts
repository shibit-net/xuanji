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
 * 5. 【未来扩展】Skill 加载：创建 Agent 时加载其关联的 Skills
 *
 * 架构优势：
 * - ✅ 废弃 lightProvider（每个 Agent 配置自己的 model）
 * - ✅ 支持用户自定义 Agent（.xuanji/agents/*.json5）
 * - ✅ 统一代码路径（消除 executePresetAgent / executeDynamicAgent 分支）
 * - ✅ 易于测试和维护
 * - 🔮 预留 Skill 接入点（未来支持 clawHub 等 Skill 系统）
 *
 * 迁移策略：
 * - SubAgentFactory.createAndRun() - 新接口，推荐使用
 * - runSubAgent() - 保留作为向后兼容（标记 @deprecated）
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ILLMProvider, IToolRegistry, AgentConfig } from '@/core/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import type { ConfigurableAgentConfig } from './types';
import type { AgentRegistry } from './AgentRegistry';
import type { ProviderManager } from '@/core/providers/ProviderManager';
import type { LayeredPromptBuilder } from '@/core/prompt/LayeredPromptBuilder';
import { SubAgentContext, type IsolationMode, type AgentRoleType } from './SubAgentContext';
import { AgentLoop } from './AgentLoop';
import { ProjectScanner } from '@/context/ProjectScanner';
import { RulesLoader } from '@/core/config/RulesLoader';
import { FilteredToolRegistry } from '@/core/tools/FilteredToolRegistry';
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
   * 动态 System Prompt（Agent 特定的 prompt）
   * 会与 agent 配置中的 systemPrompt 组合
   */
  systemPrompt?: string;
  /**
   * 🆕 场景类型（write_code / debug / review 等）
   */
  scene?: string;
  /**
   * 🆕 场景专用 prompt（L1 层）
   * 会与 agent.systemPrompt 组合
   */
  scenePrompt?: string;
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
  /**
   * 工作目录（用于解析相对路径）
   * 如果不指定，子 agent 将继承父 agent 的工作目录
   */
  workingDir?: string;
  /**
   * 🆕 是否将子 agent 的输出流式展示给用户
   * - true: 子 agent 的文本输出会实时发送到前端（适合单个子 agent 执行独立任务）
   * - false: 子 agent 的输出只返回给主 agent（适合 agent_team 等需要主 agent 总结的场景）
   * 默认：false
   */
  streamToUser?: boolean;
  /**
   * 🆕 预生成的子 agent ID（用于 TeamManager 等场景，确保 Timeline 事件 ID 一致）
   * 如果不指定，createSubAgent 会自动生成
   */
  subAgentId?: string;
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
 * SubAgentFactory
 */
export class SubAgentFactory {
  private promptBuilder: LayeredPromptBuilder | null = null;
  private parentProvider: ILLMProvider | null = null;
  private agentConfig: ConfigurableAgentConfig | null = null; // 🔧 父agent配置（用于继承provider）

  // 缓存：项目规则在 session 内不变，避免每次创建子 agent 时重复读磁盘
  private static projectRulesCache: string | null = null;
  private static projectRulesLoaded = false;

  // 缓存：L0 基础 prompt 按 agentId 缓存，避免重复调用 buildForSubAgent
  private l0PromptCache = new Map<string, string>();

  // 缓存：场景 prompt 按 scene 名称缓存，避免重复异步加载
  private scenePromptCache = new Map<string, string>();

  constructor(
    public agentRegistry: AgentRegistry, // 改为 public，允许 TeamManager 访问
    private providerManager: ProviderManager,
    private baseRegistry: IToolRegistry,
    private hookRegistry?: HookRegistry | null,
    memoryStore?: null,
    parentProvider?: ILLMProvider | null,
    parentAgentConfig?: ConfigurableAgentConfig | null, // 🔧 改为完整的agent配置
  ) {
    // 防御性检查：确保 agentRegistry 不是 undefined
    if (!agentRegistry) {
      const error = new Error('SubAgentFactory: agentRegistry is undefined or null');
      console.error('[SubAgentFactory] 构造函数收到 undefined/null agentRegistry', error.stack);
      throw error;
    }
    this.parentProvider = parentProvider ?? null;
    this.agentConfig = parentAgentConfig ?? null; // 🔧 保存父agent配置

    console.log('[SubAgentFactory] 构造函数调用，hookRegistry:', !!hookRegistry);
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
    const agentConfig = this.resolveAgentConfig(agentIdOrRole, options.systemPrompt);

    if (!agentConfig) {
      throw new Error(`Agent configuration not found: ${agentIdOrRole}`);
    }

    // 🔧 检查 Agent 是否被禁用
    if (agentConfig.enabled === false) {
      throw new Error(
        `Agent "${agentConfig.name}" (${agentConfig.id}) is disabled. ` +
        `Please enable it in Agent Manager or use a different agent.`
      );
    }

    log.info(`[SubAgentFactory] createSubAgent: agentId=${agentConfig.id} name="${agentConfig.name}" model=${agentConfig.model.primary} tools=${agentConfig.tools.length} source=${agentConfig.metadata?.source ?? 'unknown'}`);

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
      log.info(`[SubAgentFactory] provider=独立 agentId=${agentConfig.id} adapter=${(agentConfig as any).provider?.adapter ?? 'auto'} model=${agentConfig.model.primary}`);
      provider = this.providerManager.getProvider({
        id: agentConfig.id,
        model: agentConfig.model,
        provider: (agentConfig as any).provider,
      } as any);
    } else {
      // 临时 Agent：必须复用父 Provider
      if (this.parentProvider) {
        log.info(`[SubAgentFactory] provider=继承父Agent agentId=${agentConfig.id} model=${agentConfig.model.primary}`);
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
    // LLM 指定的 member.tools 与 agent config 中 required: true 的工具做并集
    // 避免 LLM 漏写关键工具导致子 agent 无法正常工作
    let allowedTools: string[];
    if (options.tools && options.tools.length > 0) {
      const requiredTools = (agentConfig.tools as any[])
        .filter((t: any) => t.required)
        .map((t: any) => t.name);
      allowedTools = [...new Set([...options.tools, ...requiredTools])];
    } else {
      allowedTools = (agentConfig.tools as any[]).map((t: any) => t.name);
    }

    log.info(`[SubAgentFactory] tools agentId=${agentConfig.id} count=${allowedTools.length} list=[${allowedTools.slice(0, 8).join(', ')}${allowedTools.length > 8 ? '...' : ''}]`);

    // 🆕 准备 agent 上下文信息
    const agentContext = {
      agentId: agentConfig.id,
      agentName: agentConfig.name || agentConfig.id,
    };

    const filteredRegistry = new FilteredToolRegistry(
      this.baseRegistry,
      allowedTools,
      agentContext,
      options.workingDir || process.cwd(),
    );

    // 5. 构建完整的 System Prompt
    // 🎯 Prompt 组合策略：
    // 子 Agent Prompt = L0（身份） + Agent.systemPrompt（agent 特性） + L1（场景增强）
    let systemPrompt: string;
    const isInternalAgent = agentConfig.metadata?.internal === true;

    // 🆕 使用 LayeredPromptBuilder 构建基础 prompt（L0），按 agentId 缓存
    if (this.promptBuilder && !isInternalAgent) {
      try {
        // 1. 构建 L0 基础层（优先从缓存读取）
        const l0CacheKey = agentConfig.id;
        let l0Prompt = this.l0PromptCache.get(l0CacheKey);
        if (!l0Prompt) {
          const buildResult = await this.promptBuilder.buildForSubAgent({
            agentId: agentConfig.id,
            agentConfig,
            includeProjectContext: !isInternalAgent,
          });
          l0Prompt = buildResult.prompt;
          this.l0PromptCache.set(l0CacheKey, l0Prompt);
        }
        systemPrompt = l0Prompt;  // L0 基础层

        // 2. 追加 Agent 自身的 systemPrompt（agent 特性）
        if (agentConfig.systemPrompt && agentConfig.systemPrompt.trim()) {
          systemPrompt += `\n\n---\n# Agent 特性\n${agentConfig.systemPrompt}`;
        }

        // 3. 追加场景专用 prompt（L1 场景增强）
        if (options.scenePrompt && options.scenePrompt.trim()) {
          systemPrompt += `\n\n---\n# 场景增强\n${options.scenePrompt}`;
        }

        // 4. 追加 options.systemPrompt（额外的动态 prompt，如果有）
        if (options.systemPrompt && options.systemPrompt.trim()) {
          systemPrompt += `\n\n---\n# 任务特定指令\n${options.systemPrompt}`;
        }

        // 5. 追加项目规则
        const projectRules = this.loadProjectRules();
        if (projectRules) {
          systemPrompt += `\n\n---\n# 项目规则\n${projectRules}`;
        }

        // 6. 追加子代理模式标记
        const depth = options.depth ?? 0;
        systemPrompt += `\n\n---\n# SubAgent 模式\nDepth: ${depth}, Role: ${agentConfig.id}\n不要提出澄清问题。当子问题需要不同领域专长或可独立并行执行时，可以使用 task 工具委派给其他 agent。`;

        log.debug(`  Prompt built: L0 + Agent.systemPrompt + Scene.prompt`);
      } catch (err) {
        log.warn(`Failed to build prompt via LayeredPromptBuilder, falling back:`, err);
        // 降级：使用旧的 buildSystemPrompt 方法
        const baseSystemPrompt = agentConfig.systemPrompt ?? '';
        systemPrompt = this.buildSystemPrompt(
          { ...agentConfig, systemPrompt: baseSystemPrompt },
          options,
        );
      }
    } else {
      // 降级：使用旧的 buildSystemPrompt 方法
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

    // 🔧 修复：如果使用 parentProvider，必须从 parentProviderConfig 中提取认证信息
    let apiKey = agentProvider?.apiKey;
    let baseURL = agentProvider?.baseURL;

    if (!hasIndependentProvider) {
      // 使用 parentProvider 时，agentConfig 必须存在
      if (!this.agentConfig?.provider) {
        throw new Error(
          `Cannot create sub-agent "${agentConfig.id}" without parent agent config. ` +
          `SubAgentFactory must be initialized with parent agent config containing provider info.`
        );
      }

      // 直接使用父 Agent 的配置
      apiKey = apiKey ?? this.agentConfig.provider.apiKey;
      baseURL = baseURL ?? this.agentConfig.provider.baseURL;
      log.debug(`  Using parent provider config: apiKey=${!!apiKey}, baseURL=${baseURL}`);
    }

    const runtimeConfig: AgentConfig = {
      model: agentConfig.model.primary,
      systemPrompt,
      maxIterations: context.maxIterations,
      temperature: agentConfig.model.temperature,
      maxTokens: agentConfig.model.maxTokens,
      thinking,
      // 添加 provider 配置（如果存在）
      apiKey,
      baseURL,
      // 🔧 添加工作目录配置（如果指定）
      workingDir: options.workingDir,
    };

    // 7. 创建 AgentLoop
    const agentLoop = new AgentLoop(
      provider,
      filteredRegistry,
      runtimeConfig,
    );

    // 8. 注入 Hook
    if (this.hookRegistry) {
      agentLoop.setHookRegistry(this.hookRegistry);
    }

    const subAgentId = options.subAgentId || `subagent-${agentConfig.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

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
   * 从 AgentRegistry 查找配置，找不到则自动创建临时 Agent
   *
   * @param agentIdOrRole - Agent ID 或角色
   * @param systemPrompt - 临时 Agent 的 system prompt（如果需要创建临时 Agent，此参数必填）
   * @returns Agent 配置，如果找不到且无法创建则返回 null
   */
  private resolveAgentConfig(agentIdOrRole: string, systemPrompt?: string): ConfigurableAgentConfig | null {
    // 1. 先从 AgentRegistry 查找
    const config = this.agentRegistry.get(agentIdOrRole);

    if (config) {
      log.debug(`✓ 找到 Agent 配置: ${agentIdOrRole}`);

      // 🔍 调试：检查 provider 配置是否存在
      const hasProvider = !!(config as any).provider;
      const hasApiKey = !!(config as any).provider?.apiKey;
      log.debug(`  Provider 配置存在: ${hasProvider}, 有 apiKey: ${hasApiKey}`);
      if (hasProvider) {
        log.debug(`  Provider 详情:`, {
          adapter: (config as any).provider.adapter,
          baseURL: (config as any).provider.baseURL,
        });
      }

      return config;
    }

    // 2. 找不到，尝试创建临时 Agent
    log.warn(`❌ Agent 配置不存在: ${agentIdOrRole}，尝试创建临时 Agent`);

    // 验证：创建临时 Agent 必须提供 systemPrompt
    if (!systemPrompt || systemPrompt.trim() === '') {
      log.error(`创建临时 Agent 失败: agent_id="${agentIdOrRole}" 不存在，且未提供 system_prompt 参数`);
      throw new Error(
        `❌ 参数错误: 缺少必需参数 'system_prompt'\n\n` +
        `原因：\n` +
        `创建临时 agent "${agentIdOrRole}" 失败，因为该 agent 不在预置列表中。\n` +
        `创建临时 agent 时必须提供 system_prompt 和 tools 参数。\n\n` +
        `解决方案：\n` +
        `1. 先调用 match_agent 查找合适的预置 agent（推荐）\n` +
        `2. 如果没有合适的预置 agent（匹配分数 < 0.5），提供 system_prompt 和 tools 参数创建临时 agent\n\n` +
        `示例：\n` +
        `task({\n` +
        `  description: "分析代码质量",\n` +
        `  subagent_type: "${agentIdOrRole}",\n` +
        `  system_prompt: "你是一个代码质量分析专家，负责检查代码规范、性能和安全问题。",\n` +
        `  tools: ["read_file", "grep", "glob"]  // 只分配必要的工具\n` +
        `})\n\n` +
        `💡 提示：\n` +
        `临时 agent 只应在没有合适的预置 agent 时使用（match_agent 分数 < 0.5）。\n` +
        `使用 match_agent 工具可以查看所有可用的预置 agent。`
      );
    }

    try {
      const factory = this.agentRegistry.getTemporaryAgentFactory();

      // 从 agentIdOrRole 推断角色和能力
      // 例如：'technical-writer' -> 'Technical Writer', ['技术文档编写']
      const role = agentIdOrRole
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      const capabilities = [role]; // 简单推断，可以后续优化

      // 🔧 调试日志：检查父agent配置
      log.info(`[SubAgentFactory] 创建临时agent，父agent配置:`, {
        hasAgentConfig: !!this.agentConfig,
        hasProvider: !!this.agentConfig?.provider,
        adapter: this.agentConfig?.provider?.adapter,
        hasApiKey: !!this.agentConfig?.provider?.apiKey,
        hasBaseURL: !!this.agentConfig?.provider?.baseURL,
      });

      const tempAgent = factory.createTemporaryAgent({
        role,
        capabilities,
        taskDescription: systemPrompt, // 使用提供的 systemPrompt 作为任务描述
        parentConfig: this.agentConfig ?? undefined, // 🔧 传递父agent配置以继承provider
      });

      log.info(`✓ 创建临时 Agent: ${tempAgent.id} (${tempAgent.name})，继承父 Agent 的 LLM 配置`);

      return tempAgent;
    } catch (error) {
      log.error(`创建临时 Agent 失败: ${agentIdOrRole}`, error);
      return null;
    }
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
      `Do NOT ask clarifying questions. You may use the task tool to delegate to other agents when appropriate.`,
    ].join('\n');

    prompt += subAgentHeader;

    return prompt;
  }

  /**
   * 同步加载项目规则文件（XUANJI.md + .xuanji/rules.md + .xuanji/rules.md）
   * 轻量版：不做文件索引，只注入规则文本
   */
  private loadProjectRules(): string {
    if (SubAgentFactory.projectRulesLoaded) {
      return SubAgentFactory.projectRulesCache ?? '';
    }
    SubAgentFactory.projectRulesLoaded = true;
    try {
      const scanner = new ProjectScanner();
      const { rootPath } = scanner.scan();
      const loader = new RulesLoader();
      SubAgentFactory.projectRulesCache = loader.loadAsTextSync(rootPath);
    } catch {
      SubAgentFactory.projectRulesCache = '';
    }
    return SubAgentFactory.projectRulesCache ?? '';
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
    success: boolean;
  }> {
    log.info(`[SubAgentFactory] createAndRun start: agentId=${agentIdOrRole} task="${options.task.substring(0, 80)}" scene=${options.scene ?? 'none'} depth=${options.depth ?? 0} timeout=${options.timeout ?? 'default'}ms`);
    const startTime = Date.now();
    let subAgentId: string | null = null; // 🔧 提前声明，用于错误处理
    let config: ConfigurableAgentConfig | null = null; // 🔧 提前声明
    let context: SubAgentContext | null = null; // 🔧 提前声明

    // 🆕 如果指定了 scene 但没有 scenePrompt，从缓存或 PromptBuilder 加载
    if (options.scene && !options.scenePrompt && this.promptBuilder) {
      // 标准化 scene：去除可能的 l1-/l2- 前缀
      const rawScene = options.scene;
      const normalizedScene = rawScene.replace(/^l[12]-/, '');
      const cachedScene = this.scenePromptCache.get(normalizedScene);
      if (cachedScene !== undefined) {
        options.scenePrompt = cachedScene || undefined;
      } else {
        try {
          const sceneComponent = await this.promptBuilder.getSceneComponent(normalizedScene);
          if (sceneComponent) {
            const cfg = await this.promptBuilder['userRegistry']?.getComponentConfig(`l1-${normalizedScene}`);
            const content = cfg?.content || '';
            this.scenePromptCache.set(normalizedScene, content);
            if (content) {
              options.scenePrompt = content;
              log.info(`[SubAgentFactory] Loaded scene prompt for scene=${normalizedScene} (raw=${rawScene})`);
            }
          } else {
            this.scenePromptCache.set(normalizedScene, '');
          }
        } catch (err) {
          log.warn(`[SubAgentFactory] Failed to load scene prompt for scene=${normalizedScene}:`, err);
          this.scenePromptCache.set(normalizedScene, '');
        }
      }
    }

    // 1. 创建子代理实例（包裹在 try-catch 中）
    let agentLoop: AgentLoop;
    try {
      const result = await this.createSubAgent(agentIdOrRole, options);
      agentLoop = result.agentLoop;
      config = result.config;
      context = result.context;
      subAgentId = result.subAgentId;
    } catch (error: any) {
      // 🔧 创建失败，直接返回错误（不发送任何 Hook，因为 agent 根本没创建成功）
      log.error(`[SubAgentFactory] Failed to create sub-agent: ${agentIdOrRole}`, error);
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

    // 2. 收集输出
    let outputText = '';
    let timedOut = false;
    let hasError = false; // 🔧 跟踪是否有错误

    agentLoop.on({
      onText: (text) => {
        outputText += text;
        // 🔧 如果启用了 streamToUser，将子 agent 的输出流式发送到前端
        if (options.streamToUser && this.hookRegistry) {
          this.hookRegistry.emit('SubAgentText', {
            subAgentId,
            text,
          }).catch((err) => {
            log.warn('SubAgentText Hook failed:', err);
          });
        }
      },
      onThinking: (thinking) => {
        // 🔧 流式更新子 agent 的思考内容
        if (this.hookRegistry) {
          this.hookRegistry.emit('AgentThinking', {
            subAgentId,
            thinkingContent: thinking,
          }).catch((err) => {
            log.warn('AgentThinking Hook failed:', err);
          });
        }
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
    console.log('[SubAgentFactory] 准备触发 SubAgentStart Hook:', {
      hasHookRegistry: !!this.hookRegistry,
      skipSubAgentStartHook: options.skipSubAgentStartHook,
      subAgentId,
      parentAgentId: options.parentAgentId,
    });

    if (this.hookRegistry && !options.skipSubAgentStartHook) {
      // 判断 Agent 类型
      let agentType: 'preset' | 'builtin' | 'custom' | 'temporary';

      // 🔧 优先检查是否是临时创建的agent
      if (config.metadata?.isTemporary) {
        agentType = 'temporary'; // 临时创建的agent
      } else {
        // 根据category判断已有agent的类型
        const category = config.metadata?.category || 'custom';
        if (category === 'system') {
          agentType = 'builtin'; // 系统内置 agent
        } else if (category === 'app') {
          agentType = 'preset'; // 应用 agent
        } else {
          agentType = 'custom'; // 用户自定义 agent
        }
      }

      console.log('[SubAgentFactory] 触发 SubAgentStart Hook:', {
        subAgentId,
        role: config.id,
        name: config.name,
        agentType,
        isTemporary: config.metadata?.isTemporary,
        category: config.metadata?.category,
        parentAgentId: options.parentAgentId || 'main',
      });

      this.hookRegistry.emit('SubAgentStart', {
        subAgentId,
        data: {
          task: options.task,
          depth: context.depth,
          role: config.id,
          name: config.name,
          agentType,
          parentAgentId: options.parentAgentId || 'main',
          streamToUser: options.streamToUser || false,
          scene: options.scene,
        },
      }).catch((err) => {
        console.error('[SubAgentFactory] SubAgentStart hook emit failed:', err);
        log.debug('SubAgentStart hook emit failed:', err);
      });
    } else {
      console.log('[SubAgentFactory] 跳过 SubAgentStart Hook:', {
        hasHookRegistry: !!this.hookRegistry,
        skipSubAgentStartHook: options.skipSubAgentStartHook,
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
      // 防止 unhandled rejection：如果超时已先触发，runPromise 的后续 reject 会被 Promise.race 忽略
      // 这里捕获并记录，避免 unhandled rejection 警告
      runPromise.catch((err) => {
        log.debug(`[${subAgentId}] Run rejected (may have been superseded by timeout):`, err?.message);
      });

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
      hasError = true; // 🔧 标记有错误
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
          success: !hasError && !timedOut,
          iterations: state.currentIteration,
          result: outputText,
          tokensUsed: state.tokenUsage,
        },
      }).catch(() => {});
    }

    log.info(`[SubAgentFactory] createAndRun done: agentId=${agentIdOrRole} subAgentId=${subAgentId} duration=${duration}ms iterations=${state.currentIteration} timedOut=${timedOut} outputLen=${outputText.length}`);

    // 6. 清理临时 Agent（防止内存泄漏）
    if (config.metadata?.isTemporary) {
      try {
        const tempFactory = this.agentRegistry.getTemporaryAgentFactory();
        tempFactory.cleanupTemporaryAgent(config.id);
        log.info(`[SubAgentFactory] Cleaned up temporary agent: ${config.id}`);
      } catch (err) {
        log.warn(`[SubAgentFactory] Failed to cleanup temporary agent: ${config.id}`, err);
      }
    }

    // 7. 返回结果
    return {
      result: outputText || (timedOut ? `Timed out after ${context.timeout}ms` : 'No output'),
      tokensUsed: state.tokenUsage,
      duration,
      timedOut,
      iterations: state.currentIteration,
      success: !hasError && !timedOut,
    };
  }
}
