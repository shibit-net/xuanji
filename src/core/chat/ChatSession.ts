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
import { createDefaultRegistry } from '@/core/tools/ToolRegistry';

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

    // 4. 初始化 AgentLoop
    this.agentLoop = new AgentLoop(this.provider, this.registry, {
      model: this.config.provider.model,
      maxTokens: this.config.provider.maxTokens,
      temperature: this.config.provider.temperature,
    });

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
