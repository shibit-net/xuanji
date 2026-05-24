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
   * 根据 Agent 自身 provider 配置创建 Provider
   *
   * agentProvider 来自 agent 的 YAML 配置文件 + agent-overrides 合并结果。
   * 每个 agent 的配置文件一定存在（首次登录从模板复制），不存在全局兜底。
   */
  static getProvider(agentProvider?: AgentProviderConfig): ILLMProvider {
    if (!agentProvider?.adapter) {
      throw new Error('Agent 未配置 provider adapter，请在配置页面设置');
    }

    const provider = createProviderByAdapter(agentProvider.adapter);
    log.info(`ProviderManager created: ${provider.name} for adapter=${agentProvider.adapter}`);
    return provider;
  }
}
