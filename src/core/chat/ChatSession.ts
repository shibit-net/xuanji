// ============================================================
// ChatSession — 交互方式无关的会话抽象
// ============================================================
//
// 所有适配器（CLI、IM 机器人、Electron GUI）的统一入口。
// 封装 AgentLoop 的初始化和回调注册。
//

import type {
  AgentConfig,
  AgentState,
  TokenUsage,
  ILLMProvider,
  IToolRegistry,
  AppConfig,
} from '@/core/types';
import { AgentLoop, type AgentCallbacks } from '@/core/agent/AgentLoop';
import { ConfigLoader } from '@/core/config/ConfigLoader';
import { ProviderFactory } from '@/core/providers/ProviderFactory';
import { createDefaultRegistry, ToolRegistry } from '@/core/tools/ToolRegistry';
import { PermissionController } from '@/permission/PermissionController';
import type { IPermissionController, ConfirmationHandler, PlanReviewHandler } from '@/permission/types';
import type { SkillRegistry } from '@/core/skills';
import type { IMemoryStore } from '@/memory/types';
import { DEFAULT_MEMORY_CONFIG } from '@/memory/types';

/**
 * ChatSession 初始化选项
 */
export interface ChatSessionOptions {
  /** 模型覆盖 */
  model?: string;
  /** 已有的 Provider 实例 (跳过自动创建) */
  provider?: ILLMProvider;
  /** 已有的工具注册表 (跳过自动创建) */
  registry?: IToolRegistry;
  /** 已有的配置 (跳过自动加载) */
  config?: AppConfig;
}

/**
 * ChatSession — 与交互方式无关的会话管理器
 *
 * 职责:
 * 1. 加载配置、初始化 Provider 和 ToolRegistry
 * 2. 管理 AgentLoop 实例
 * 3. 提供统一的 run/stop/reset 接口
 * 4. 让各适配器不需要了解初始化细节
 */
export class ChatSession {
  private agentLoop: AgentLoop | null = null;
  private skillRegistry: SkillRegistry | null = null;
  private permissionController: IPermissionController | null = null;
  private memoryManager: IMemoryStore | null = null;
  private config: AppConfig | null = null;
  private provider: ILLMProvider | null = null;
  private registry: IToolRegistry | null = null;
  private initialized = false;
  private options: ChatSessionOptions;

  constructor(options: ChatSessionOptions = {}) {
    this.options = options;
  }

  /**
   * 初始化会话 (加载配置、创建 Provider 和 AgentLoop)
   * 必须在 run() 之前调用
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // 1. 加载配置
    if (this.options.config) {
      this.config = this.options.config;
    } else {
      const configLoader = new ConfigLoader();
      this.config = await configLoader.load();
    }

    // 模型覆盖
    if (this.options.model) {
      this.config.provider.model = this.options.model;
    }

    // 校验 API Key
    if (!this.config.provider.apiKey) {
      throw new Error('未找到 API Key，请设置环境变量 XUANJI_API_KEY');
    }

    // 2. 初始化 Provider
    if (this.options.provider) {
      this.provider = this.options.provider;
    } else {
      const providerFactory = new ProviderFactory();
      // 优先按 adapter 配置查找，fallback 到模型名自动匹配
      let provider: ILLMProvider | undefined;
      if (this.config.provider.adapter) {
        provider = providerFactory.getByAdapter(this.config.provider.adapter);
      }
      if (!provider) {
        provider = providerFactory.getByModel(this.config.provider.model);
      }
      if (!provider) {
        throw new Error(`不支持的模型: ${this.config.provider.model}`);
      }
      this.provider = provider;
    }

    // 3. 初始化 ToolRegistry
    this.registry = this.options.registry ?? createDefaultRegistry();

    // 3.5 初始化权限控制器并注入到 ToolRegistry
    const permissionConfig = this.config.tools.permissions;
    this.permissionController = new PermissionController(permissionConfig);
    if (this.registry instanceof ToolRegistry) {
      (this.registry as ToolRegistry).setPermissionController(this.permissionController);
    }

    // 4. 初始化 Skill 系统 (新增)
    const { SkillRegistry, SkillLoader, initializeBuiltinSkills } = await import(
      '@/core/skills'
    );
    const skillRegistry = new SkillRegistry();
    initializeBuiltinSkills(skillRegistry);

    // 加载用户自定义 Skill (如果启用)
    const skillsConfig = this.config.skills;
    if (skillsConfig?.loadCustom && skillsConfig.customPath) {
      const loader = new SkillLoader(skillRegistry);
      await loader.load({
        loadBuiltin: false, // 已加载
        loadCustom: true,
        customPath: skillsConfig.customPath,
      });
    }

    // 5. 从 Skill 系统渲染 systemPrompt
    //    组合所有启用的 Prompt Skills（按优先级排序）

    // 4.5 初始化记忆系统
    const memoryConfig = this.config.memory ?? DEFAULT_MEMORY_CONFIG;
    if (memoryConfig.enabled) {
      try {
        const { MemoryManager } = await import('@/memory');
        this.memoryManager = new MemoryManager(memoryConfig, process.cwd());
        await this.memoryManager.init();
      } catch {
        // 静默失败，记忆系统初始化失败不影响主流程
        this.memoryManager = null;
      }
    }

    let systemPrompt: string | undefined = undefined;
    const enabledIds = skillsConfig?.enabled ?? [];
    if (enabledIds.length > 0) {
      // 过滤出已注册且 category === 'prompt' 的 Skill
      const promptSkillIds = enabledIds.filter((id) => {
        const skill = skillRegistry.get(id);
        return skill && skill.category === 'prompt' && (skill.enabled ?? true);
      });

      if (promptSkillIds.length > 0) {
        systemPrompt = await skillRegistry.composeBatch(promptSkillIds, {
          params: {
            toolList: this.registry.getSchemas(),
            language: this.config.ui.language ?? 'zh',
          },
        });
      }
    }

    // 6. 初始化 AgentLoop，传递 systemPrompt 和 provider 配置
    this.agentLoop = new AgentLoop(this.provider, this.registry, {
      model: this.config.provider.model,
      apiKey: this.config.provider.apiKey,
      baseURL: this.config.provider.baseURL,
      maxTokens: this.config.provider.maxTokens,
      temperature: this.config.provider.temperature,
      systemPrompt, // ✅ 现在有了
    }, this.memoryManager ?? undefined);

    // 存储 skillRegistry 供后续使用
    this.skillRegistry = skillRegistry;

    this.initialized = true;
  }

  /**
   * 注册回调
   */
  on(callbacks: AgentCallbacks): void {
    this.ensureInitialized();
    this.agentLoop!.on(callbacks);
  }

  /**
   * 运行一轮对话
   */
  async run(userMessage: string): Promise<void> {
    this.ensureInitialized();

    // 检索相关记忆并动态注入到 system prompt
    if (this.memoryManager) {
      try {
        const { MemoryManager } = await import('@/memory');
        const memories = await this.memoryManager.retrieve(userMessage, {
          maxResults: 10,
          minConfidence: 0.3,
        });
        if (memories.length > 0 && this.memoryManager instanceof MemoryManager) {
          const memorySummary = (this.memoryManager as InstanceType<typeof MemoryManager>).formatForPrompt(memories);
          this.agentLoop!.getMessageManager().setSystemPromptSuffix(memorySummary);
        }
      } catch {
        // 静默失败
      }
    }

    await this.agentLoop!.run(userMessage);
  }

  /**
   * 停止当前运行
   */
  stop(): void {
    this.agentLoop?.stop();
  }

  /**
   * 重置会话 (清空历史)
   */
  reset(): void {
    this.agentLoop?.reset();
  }

  /**
   * 重新初始化会话 (配置改变后调用)
   * 清空所有状态，重新加载配置并创建新的 Provider 和 AgentLoop
   */
  async reinitialize(newConfig?: AppConfig): Promise<void> {
    // 清空当前状态
    this.agentLoop = null;
    this.skillRegistry = null;
    this.permissionController = null;
    this.memoryManager = null;
    this.config = null;
    this.provider = null;
    this.registry = null;
    this.initialized = false;

    // 如果提供了新配置，更新选项
    if (newConfig) {
      this.options.config = newConfig;
    }

    // 重新初始化
    await this.init();
  }

  /**
   * 获取当前状态
   */
  getState(): AgentState {
    this.ensureInitialized();
    return this.agentLoop!.getState();
  }

  /**
   * 获取 AgentLoop 实例 (高级用法)
   */
  getAgentLoop(): AgentLoop {
    this.ensureInitialized();
    return this.agentLoop!;
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<AppConfig> {
    if (!this.config) {
      throw new Error('ChatSession 尚未初始化，请先调用 init()');
    }
    return this.config;
  }

  /**
   * 获取 SkillRegistry 实例 (用于 CLI 命令和高级用法)
   */
  getSkillRegistry(): SkillRegistry {
    if (!this.skillRegistry) {
      throw new Error('ChatSession 尚未初始化或 Skill 系统未加载，请先调用 init()');
    }
    return this.skillRegistry;
  }

  /**
   * 获取权限控制器 (用于 UI 层注入确认处理器)
   */
  getPermissionController(): IPermissionController | null {
    return this.permissionController;
  }

  /**
   * 获取记忆管理器
   */
  getMemoryManager(): IMemoryStore | null {
    return this.memoryManager;
  }

  /**
   * 设置权限确认处理器 (由 UI 层调用)
   */
  setConfirmationHandler(handler: ConfirmationHandler): void {
    if (this.permissionController) {
      this.permissionController.setConfirmationHandler(handler);
    }
  }

  /**
   * 设置计划审查处理器 (由 UI 层调用)
   */
  setPlanReviewHandler(handler: PlanReviewHandler): void {
    if (this.permissionController) {
      this.permissionController.setPlanReviewHandler(handler);
    }
  }

  /**
   * 是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.agentLoop) {
      throw new Error('ChatSession 尚未初始化，请先调用 init()');
    }
  }
}
