/**
 * Provider 管理器
 *
 * 职责：
 * 1. 根据 Agent 自身配置按需创建 Provider
 * 2. 每个 Agent 的配置文件（YAML + agent-overrides）中已有 adapter/apiKey/baseURL
 * 3. 所有 agent 的 provider 创建都走此入口，统一管理
 *
 * @example
 * const provider = ProviderManager.getProvider(agentConfig.provider);
 */

import type { ILLMProvider } from '@/core/types';
import { createProviderByAdapter } from './ProviderRegistry';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ProviderManager' });

export interface AgentProviderConfig {
  adapter?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
  [key: string]: any;
}

export class ProviderManager {
  /**
   * 根据 Agent 自身 provider 配置创建 Provider，支持兜底
   *
   * agentProvider 来自 agent 的 YAML 配置文件 + agent-overrides 合并结果。
   * 如果 agent 的 provider 配置不健全（缺 adapter），会尝试使用 fallbackProvider。
   *
   * @param agentProvider  Agent 自身的 provider 配置
   * @param fallbackProvider  用户配置的兜底 provider（可选）
   */
  /** 本地/内网 provider，不需要 apiKey，仅需 adapter + baseURL */
  private static LOCAL_ADAPTERS = new Set(['ollama', 'vllm', 'lmstudio', 'local-llama']);

  /** agent provider 是否有可用凭证（apiKey 或 baseURL），仅有 adapter 不足以发起真实调用 */
  private static hasCredentials(p?: AgentProviderConfig): boolean {
    if (!p?.adapter) return false;
    if (this.LOCAL_ADAPTERS.has(p.adapter)) return true;
    return !!(p.apiKey || p.baseURL);
  }

  static getProvider(agentProvider?: AgentProviderConfig, fallbackProvider?: AgentProviderConfig): ILLMProvider | null {
    // 优先使用 agent 自身的 provider（必须有 adapter + apiKey/baseURL）
    if (this.hasCredentials(agentProvider)) {
      const provider = createProviderByAdapter(agentProvider!.adapter!);
      log.info(`ProviderManager created: ${provider.name} for adapter=${agentProvider!.adapter}`);
      return provider;
    }

    if (agentProvider?.adapter) {
      log.warn(`ProviderManager: agent provider has adapter=${agentProvider.adapter} but no apiKey/baseURL, trying fallback`);
    }

    // 兜底 provider
    if (this.hasCredentials(fallbackProvider)) {
      const provider = createProviderByAdapter(fallbackProvider!.adapter!);
      log.info(`ProviderManager fallback: ${provider.name} for adapter=${fallbackProvider!.adapter}`);
      return provider;
    }

    log.warn('ProviderManager: 未配置 provider adapter 且未配置兜底 provider，返回 null');
    return null;
  }
}
