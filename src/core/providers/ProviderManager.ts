/**
 * Provider 管理器
 *
 * 职责：
 * 1. 根据 Agent 配置按需创建 Provider
 * 2. 支持每个 Agent 独立的 apiKey、baseURL、adapter
 * 3. 字段级配置合并（Agent 配置 > 全局配置）
 * 4. Provider 缓存（按配置哈希）
 *
 * @example
 * // Agent 独立配置
 * const agentConfig = {
 *   id: 'coder',
 *   provider: {
 *     apiKey: 'sk-openai-xxx',
 *     baseURL: 'https://api.openai.com/v1',
 *     adapter: 'openai',
 *     model: 'gpt-4',
 *   }
 * };
 *
 * const provider = providerManager.getProvider(agentConfig);
 * // provider = OpenAIProvider with OpenAI credentials
 */

import type { AppConfig, ILLMProvider, ProviderConfig } from '@/core/types';
import type { ConfigurableAgentConfig } from '@/core/agent/types';
import { ProviderFactory } from './ProviderFactory';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ProviderManager' });

/**
 * Agent Provider 配置（扩展 ProviderConfig）
 *
 * 支持 Agent 独立的 provider 配置
 */
export interface AgentProviderConfig {
  /** API Key（Agent 专用） */
  apiKey?: string;
  /** API Base URL（Agent 专用） */
  baseURL?: string;
  /** Provider 适配器（Agent 专用） */
  adapter?: string;
  /** 主模型 */
  model?: string;
  /** 最大 token 数 */
  maxTokens?: number;
  /** 请求超时（ms） */
  timeout?: number;
  /** 温度参数 */
  temperature?: number;
  /** 其他自定义参数 */
  [key: string]: any;
}

/**
 * 合并后的完整 Provider 配置
 */
export interface MergedProviderConfig extends ProviderConfig {}

/**
 * Provider Manager
 *
 * 管理 Provider 配置的合并和获取
 *
 * 注意：ProviderFactory 对每个 adapter 类型（anthropic/openai）已使用单例模式，
 * 所以 ProviderManager 不需要缓存 Provider 实例，只需要提供配置合并和 Provider 获取服务。
 */
export class ProviderManager {
  private providerFactory: ProviderFactory;
  private globalConfig: AppConfig;

  constructor(globalConfig: AppConfig) {
    this.providerFactory = new ProviderFactory();
    this.globalConfig = globalConfig;

    log.debug('ProviderManager initialized', {
      globalModel: globalConfig.provider.model,
    });
  }

  /**
   * 根据 Agent 配置获取 Provider
   *
   * 优先级：
   * 1. agentConfig.provider.model (Agent 专用模型)
   * 2. agentConfig.model.primary (向后兼容)
   * 3. globalConfig.provider.model (全局默认)
   *
   * @param agentConfig Agent 配置（可选）
   * @returns Provider 实例
   */
  getProvider(agentConfig?: ConfigurableAgentConfig): ILLMProvider {
    // 1. 合并配置（Agent 配置 > 全局配置）
    const mergedConfig = this.mergeProviderConfig(agentConfig);

    // 2. 创建 provider（ProviderFactory 已单例）
    log.debug('Getting provider', {
      model: mergedConfig.model,
      adapter: mergedConfig.adapter,
      baseURL: mergedConfig.baseURL,
    });

    const provider = this.createProvider(mergedConfig);

    return provider;
  }

  // ─── 私有方法 ─────────────────────────────────────────

  /**
   * 合并 Provider 配置（字段级）
   *
   * 优先级：Agent 配置 > 全局配置
   *
   * @param agentConfig Agent 配置
   * @returns 合并后的配置
   */
  private mergeProviderConfig(agentConfig?: ConfigurableAgentConfig): MergedProviderConfig {
    const agentProvider = (agentConfig as any)?.provider as AgentProviderConfig | undefined;
    const globalProvider = this.globalConfig.provider;

    // 向后兼容：支持旧的 agentConfig.model 字段
    const legacyModel = (agentConfig as any)?.model?.primary;
    const legacyMaxTokens = (agentConfig as any)?.model?.maxTokens;

    // 🔍 调试日志：检查 API Key 来源
    log.debug('Merging provider config', {
      agentHasApiKey: !!agentProvider?.apiKey,
      globalHasApiKey: !!globalProvider.apiKey,
      globalApiKeyPreview: globalProvider.apiKey?.slice(0, 15) + '...',
    });

    const mergedConfig: MergedProviderConfig = {
      // 认证信息（优先使用 Agent 配置）
      apiKey: agentProvider?.apiKey ?? globalProvider.apiKey,
      baseURL: agentProvider?.baseURL ?? globalProvider.baseURL,

      // Provider 类型（优先使用 Agent 配置）
      adapter: agentProvider?.adapter ?? globalProvider.adapter,

      // 模型配置（优先级：agent.provider.model > agent.model.primary > global.model）
      model: agentProvider?.model ?? legacyModel ?? globalProvider.model,

      // 调用参数
      maxTokens:
        agentProvider?.maxTokens ?? legacyMaxTokens ?? globalProvider.maxTokens,
      timeout: agentProvider?.timeout ?? globalProvider.timeout,
      temperature: agentProvider?.temperature ?? globalProvider.temperature,

      // Extended Thinking（保留全局配置）
      thinking: globalProvider.thinking,
    };

    // 合并其他自定义参数
    if (agentProvider) {
      const standardKeys = [
        'apiKey',
        'baseURL',
        'adapter',
        'model',
        'maxTokens',
        'timeout',
        'temperature',
      ];

      for (const [key, value] of Object.entries(agentProvider)) {
        if (!standardKeys.includes(key) && value !== undefined) {
          (mergedConfig as any)[key] = value;
        }
      }
    }

    return mergedConfig;
  }

  /**
   * 创建 Provider 实例
   *
   * @param config 合并后的配置
   * @returns Provider 实例
   */
  private createProvider(config: MergedProviderConfig): ILLMProvider {
    // 1. 选择 adapter
    let provider: ILLMProvider | undefined;

    if (config.adapter) {
      provider = this.providerFactory.getByAdapter(config.adapter);
      if (!provider) {
        log.warn(`Adapter "${config.adapter}" not found, trying model-based resolution`);
      }
    }

    if (!provider && config.model) {
      provider = this.providerFactory.getByModel(config.model);
    }

    if (!provider) {
      throw new Error(
        `Unsupported provider: adapter=${config.adapter}, model=${config.model}`
      );
    }

    // 2. Provider 已创建，配置会在调用 stream() 时传入
    // ILLMProvider 接口设计为无状态，每次调用传入配置
    // 所以这里不需要调用 configure()

    log.info('Provider created', {
      providerName: provider.name,
      model: config.model,
      hasCustomApiKey: !!config.apiKey && config.apiKey !== this.globalConfig.provider.apiKey,
      hasCustomBaseURL: !!config.baseURL && config.baseURL !== this.globalConfig.provider.baseURL,
    });

    return provider;
  }

  /**
   * 获取 Provider 配置（用于调试）
   *
   * @param agentConfig Agent 配置
   * @returns 合并后的配置
   */
  getResolvedConfig(agentConfig?: ConfigurableAgentConfig): MergedProviderConfig {
    return this.mergeProviderConfig(agentConfig);
  }
}
