// ============================================================
// M7 LLM Provider — Provider 工厂
// ============================================================

import type { ILLMProvider, ProviderConfig } from '@/core/types';
import { AnthropicProvider } from './AnthropicProvider';
import { OpenAIProvider } from './OpenAIProvider';

/**
 * Provider 工厂
 * 根据模型名称或 adapter 标识路由到对应 Provider
 */
export class ProviderFactory {
  private providers: Map<string, ILLMProvider> = new Map();

  /** adapter 标识 → provider name 的映射 */
  private static readonly ADAPTER_MAP: Record<string, string> = {
    'anthropic': 'anthropic',
    'openai': 'openai',
    'openai-response': 'openai',  // OpenAI Responses 仍使用 OpenAI Provider
  };

  constructor() {
    // 默认注册 Anthropic Provider
    this.register(new AnthropicProvider());
    // 注册 OpenAI Provider
    this.register(new OpenAIProvider());
  }

  /**
   * 注册 Provider
   */
  register(provider: ILLMProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * 根据模型名称获取 Provider
   */
  getByModel(model: string): ILLMProvider | undefined {
    for (const provider of this.providers.values()) {
      if (provider.isSupported(model)) {
        return provider;
      }
    }
    return undefined;
  }

  /**
   * 根据 adapter 标识获取 Provider
   */
  getByAdapter(adapter: string): ILLMProvider | undefined {
    const providerName = ProviderFactory.ADAPTER_MAP[adapter];
    if (providerName) {
      return this.providers.get(providerName);
    }
    return undefined;
  }

  /**
   * 根据 Provider 名称获取
   */
  getByName(name: string): ILLMProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * 获取所有已注册的 Provider
   */
  getAll(): ILLMProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 解析 Provider 实例
   * 优先按 adapter，其次按 model 名匹配
   */
  resolve(config: ProviderConfig): ILLMProvider | undefined {
    if (config.adapter) {
      return this.getByAdapter(config.adapter);
    }
    return this.getByModel(config.model);
  }

  /**
   * 创建轻量模型的 ProviderConfig
   * 如果配置了 lightModel，返回使用 lightModel 的配置副本
   * 否则返回原始配置（主模型充当轻量模型）
   */
  static createLightConfig(config: ProviderConfig): ProviderConfig {
    if (!config.lightModel) {
      return config;
    }
    return {
      ...config,
      model: config.lightModel,
      // 轻量模型使用更小的 maxTokens
      maxTokens: Math.min(config.maxTokens ?? 16384, 16384),
    };
  }
}
