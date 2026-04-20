// ============================================================
// M7 LLM Provider — Provider 工厂
// ============================================================

import type { ILLMProvider, ProviderConfig } from '@/core/types';
import { AnthropicProvider } from './AnthropicProvider';
import { OpenAIProvider } from './OpenAIProvider';

/**
 * Provider 工厂
 * 根据模型名称或 adapter 标识路由到对应 Provider
 *
 * 采用懒加载模式，只在需要时才创建 Provider 实例
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
    // 不再在构造函数中预注册所有 Provider
    // 改为懒加载模式，按需创建
  }

  /**
   * 注册 Provider
   */
  register(provider: ILLMProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * 根据模型名称获取 Provider（懒加载）
   */
  getByModel(model: string): ILLMProvider | undefined {
    // 先检查已缓存的 Provider
    for (const provider of this.providers.values()) {
      if (provider.isSupported(model)) {
        return provider;
      }
    }

    // 未找到，尝试懒加载
    let provider: ILLMProvider | undefined;

    if (model.includes('claude-')) {
      provider = this.getOrCreateProvider('anthropic', () => new AnthropicProvider());
    } else if (model.includes('gpt-') || model.includes('o1-') || model.includes('o3-')) {
      provider = this.getOrCreateProvider('openai', () => new OpenAIProvider());
    }

    return provider;
  }

  /**
   * 根据 adapter 标识获取 Provider（懒加载）
   */
  getByAdapter(adapter: string): ILLMProvider | undefined {
    const providerName = ProviderFactory.ADAPTER_MAP[adapter];
    if (!providerName) {
      return undefined;
    }

    // 先检查缓存
    let provider = this.providers.get(providerName);
    if (provider) {
      return provider;
    }

    // 懒加载
    if (providerName === 'anthropic') {
      provider = this.getOrCreateProvider('anthropic', () => new AnthropicProvider());
    } else if (providerName === 'openai') {
      provider = this.getOrCreateProvider('openai', () => new OpenAIProvider());
    }

    return provider;
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
   * 懒加载辅助方法：获取或创建 Provider
   */
  private getOrCreateProvider(name: string, factory: () => ILLMProvider): ILLMProvider {
    let provider = this.providers.get(name);
    if (!provider) {
      provider = factory();
      this.providers.set(name, provider);
    }
    return provider;
  }
}
