/**
 * Provider 管理器
 *
 * 职责：
 * 1. 根据 Agent 配置按需创建 Provider
 * 2. 支持每个 Agent 独立的 apiKey、baseURL、adapter
 * 3. 字段级配置合并（Agent 配置 > 全局配置）
 *
 * @example
 * const provider = providerManager.getProvider(agentConfig);
 * // provider = OpenAIProvider with merged credentials
 */

import type { AppConfig, ILLMProvider, ProviderConfig } from '@/core/types';
import type { ConfigurableAgentConfig } from '@/core/agent/types';
import { AnthropicProvider } from './AnthropicProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { GeminiProvider } from './GeminiProvider';
import { LocalLlamaAdapter } from './LocalLlamaAdapter';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ProviderManager' });

/**
 * Agent Provider 配置（扩展 ProviderConfig）
 */
export interface AgentProviderConfig {
  apiKey?: string;
  baseURL?: string;
  adapter?: string;
  model?: string;
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
  [key: string]: any;
}

/**
 * Provider Manager
 *
 * 管理 Provider 配置的合并和获取
 * 每个 Agent 配置上已有 adapter 字段，直接按 adapter 创建 Provider。
 */
export class ProviderManager {
  private globalConfig: AppConfig;

  constructor(globalConfig: AppConfig) {
    this.globalConfig = globalConfig;
    log.debug('ProviderManager initialized', {
      globalModel: globalConfig.provider.model,
      globalAdapter: (globalConfig.provider as any).adapter || 'auto',
    });
  }

  /**
   * 获取 Agent 专用的 Provider
   *
   * 合并逻辑：
   * 1. 以全局配置为基准
   * 2. Agent 配置覆盖全局配置
   * 3. 最终确定 adapter → 创建对应 Provider
   */
  getProvider(agentConfig?: ConfigurableAgentConfig): ILLMProvider {
    const merged = this.mergeConfig(agentConfig);
    log.info(`ProviderManager.getProvider: adapter=${merged.adapter}, model=${merged.model}, baseURL=${merged.baseURL}, hasAgentConfig=${!!agentConfig}`);
    const provider = this.createProviderByAdapter(merged.adapter);
    log.info(`ProviderManager created: ${provider.name} (${provider.constructor.name})`);
    return provider;
  }

  /**
   * 合并 Agent 配置和全局配置
   */
  private mergeConfig(agentConfig?: ConfigurableAgentConfig): ProviderConfig {
    const global = this.globalConfig.provider;

    // 如果 Agent 没有独立配置，直接返回全局配置
    if (!agentConfig?.provider) {
      return { ...global } as ProviderConfig;
    }

    const agent = agentConfig.provider as AgentProviderConfig;

    return {
      adapter: agent.adapter || (global as any).adapter || 'openai',
      model: agent.model || global.model || 'gpt-4',
      apiKey: agent.apiKey || global.apiKey,
      baseURL: agent.baseURL || global.baseURL,
      maxTokens: agent.maxTokens || global.maxTokens,
      timeout: agent.timeout || (global as any).timeout,
      temperature: agent.temperature ?? (global as any).temperature,
    } as ProviderConfig;
  }

  /**
   * 根据 adapter 名称创建 Provider 实例
   */
  private createProviderByAdapter(adapter?: string): ILLMProvider {
    switch (adapter) {
      case 'anthropic':
        return new AnthropicProvider();
      case 'gemini':
        return new GeminiProvider();
      case 'local-llama':
        return new LocalLlamaAdapter();
      case 'openai':
      case 'openai-response':
      default:
        return new OpenAIProvider();
    }
  }
}
