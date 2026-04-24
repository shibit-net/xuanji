/**
 * ProviderManager 测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderManager } from '@/core/providers/ProviderManager';
import type { AppConfig } from '@/core/types';
import type { ConfigurableAgentConfig } from '@/core/agent/types';

describe('ProviderManager', () => {
  let providerManager: ProviderManager;
  let globalConfig: AppConfig;

  beforeEach(() => {
    // 模拟全局配置
    globalConfig = {
      provider: {
        apiKey: 'sk-global-key',
        baseURL: 'https://shibit.net',
        adapter: 'anthropic',
        model: '[CC]claude-sonnet-4-5-20250929',
        lightModel: '[CC]claude-haiku-4-5-20251001',
        maxTokens: 64000,
        timeout: 120000,
      },
      ui: {
        theme: 'dark',
        language: 'zh',
        showTokenUsage: true,
        showCost: true,
        showThinking: false,
      },
      permission: {
        fileRead: 'always',
        fileWrite: 'ask',
        bashExec: 'ask',
      },
      tools: {
        enabled: [],
        permissions: {
          fileRead: 'always',
          fileWrite: 'ask',
          bashExec: 'ask',
        },
      },
      retry: {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2,
        retryableStatusCodes: [429, 500, 502, 503, 504],
      },
    } as AppConfig;

    providerManager = new ProviderManager(globalConfig);
  });

  describe('配置合并', () => {
    it('应该使用全局配置创建 Provider（无 Agent 配置）', () => {
      const provider = providerManager.getProvider();

      expect(provider).toBeDefined();
      expect(provider.name).toBe('anthropic'); // 默认 adapter
    });

    it('应该合并 Agent 配置和全局配置', () => {
      const agentConfig = {
        id: 'coder',
        provider: {
          model: 'gpt-4',
          adapter: 'openai',
          apiKey: 'sk-openai-key',
          baseURL: 'https://api.openai.com/v1',
        },
      } as unknown as ConfigurableAgentConfig;

      const resolvedConfig = providerManager.getResolvedConfig(agentConfig);

      expect(resolvedConfig.model).toBe('gpt-4'); // Agent 配置
      expect(resolvedConfig.adapter).toBe('openai'); // Agent 配置
      expect(resolvedConfig.apiKey).toBe('sk-openai-key'); // Agent 配置
      expect(resolvedConfig.baseURL).toBe('https://api.openai.com/v1'); // Agent 配置
      expect(resolvedConfig.maxTokens).toBe(64000); // 继承全局配置
      expect(resolvedConfig.timeout).toBe(120000); // 继承全局配置
    });

    it('应该支持字段级覆盖（仅覆盖部分字段）', () => {
      const agentConfig= {
        id: 'explore',
        provider: {
          model: '[CC]claude-haiku-4-5-20251001', // 只覆盖 model
          // apiKey, baseURL, adapter 继承全局
        },
      };

      const resolvedConfig = providerManager.getResolvedConfig(
        agentConfig as unknown as ConfigurableAgentConfig
      );

      expect(resolvedConfig.model).toBe('[CC]claude-haiku-4-5-20251001'); // Agent 配置
      expect(resolvedConfig.apiKey).toBe('sk-global-key'); // 继承全局
      expect(resolvedConfig.baseURL).toBe('https://shibit.net'); // 继承全局
      expect(resolvedConfig.adapter).toBe('anthropic'); // 继承全局
    });

    it('应该支持向后兼容的 model.primary 配置', () => {
      const agentConfig= {
        id: 'coder',
        model: {
          primary: 'sonnet',
        },
      };

      const resolvedConfig = providerManager.getResolvedConfig(
        agentConfig as unknown as ConfigurableAgentConfig
      );

      expect(resolvedConfig.model).toBe('sonnet'); // 旧配置格式
    });

    it('provider.model 应该优先于 model.primary', () => {
      const agentConfig= {
        id: 'coder',
        provider: {
          model: 'gpt-4', // 新格式
        },
        model: {
          primary: 'sonnet', // 旧格式
        },
      };

      const resolvedConfig = providerManager.getResolvedConfig(
        agentConfig as unknown as ConfigurableAgentConfig
      );

      expect(resolvedConfig.model).toBe('gpt-4'); // 优先使用新格式
    });
  });

  describe('Provider 获取', () => {
    it('相同 adapter 应该返回同一个 Provider 实例（ProviderFactory 单例）', () => {
      const agentConfig1= {
        id: 'agent1',
        provider: {
          model: '[CC]claude-sonnet-4-5-20250929',
        },
      };

      const agentConfig2= {
        id: 'agent2',
        provider: {
          model: '[CC]claude-haiku-4-5-20251001', // 不同模型，但同 adapter
        },
      };

      const provider1 = providerManager.getProvider(
        agentConfig1 as unknown as ConfigurableAgentConfig
      );
      const provider2 = providerManager.getProvider(
        agentConfig2 as unknown as ConfigurableAgentConfig
      );

      expect(provider1).toBe(provider2); // ProviderFactory 对 anthropic 单例
      expect(provider1.name).toBe('anthropic');
    });

    it('不同 adapter 应该返回不同的 Provider 实例', () => {
      const agentConfig1= {
        id: 'agent1',
        provider: {
          model: '[CC]claude-sonnet-4-5-20250929',
          adapter: 'anthropic',
        },
      };

      const agentConfig2= {
        id: 'agent2',
        provider: {
          model: 'gpt-4',
          adapter: 'openai',
        },
      };

      const provider1 = providerManager.getProvider(
        agentConfig1 as unknown as ConfigurableAgentConfig
      );
      const provider2 = providerManager.getProvider(
        agentConfig2 as unknown as ConfigurableAgentConfig
      );

      expect(provider1).not.toBe(provider2); // 不同 adapter
      expect(provider1.name).toBe('anthropic');
      expect(provider2.name).toBe('openai');
    });
  });

  describe('错误处理', () => {
    it('不支持的 model 应该抛出错误', () => {
      const agentConfig= {
        id: 'invalid',
        provider: {
          model: 'totally-invalid-model-12345',
          adapter: 'invalid-adapter',
        },
      };

      expect(() => {
        providerManager.getProvider(agentConfig as unknown as ConfigurableAgentConfig);
      }).toThrow('Unsupported provider');
    });

    it('不支持的 adapter 应该降级到 model 匹配', () => {
      const agentConfig= {
        id: 'agent1',
        provider: {
          adapter: 'invalid-adapter-xyz',
          model: '[CC]claude-sonnet-4-5-20250929', // 有效 model
        },
      };

      // 应该能创建成功（降级到 model 匹配）
      const provider = providerManager.getProvider(
        agentConfig as unknown as ConfigurableAgentConfig
      );

      expect(provider).toBeDefined();
      expect(provider.name).toBe('anthropic');
    });
  });

  describe('多 Provider 场景', () => {
    it('应该支持同时使用 Anthropic 和 OpenAI', () => {
      const anthropicConfig= {
        id: 'explore',
        provider: {
          model: '[CC]claude-haiku-4-5-20251001',
          adapter: 'anthropic',
          apiKey: 'sk-anthropic-key',
          baseURL: 'https://shibit.net',
        },
      };

      const openaiConfig= {
        id: 'coder',
        provider: {
          model: 'gpt-4',
          adapter: 'openai',
          apiKey: 'sk-openai-key',
          baseURL: 'https://api.openai.com/v1',
        },
      };

      const anthropicProvider = providerManager.getProvider(
        anthropicConfig as unknown as ConfigurableAgentConfig
      );
      const openaiProvider = providerManager.getProvider(
        openaiConfig as unknown as ConfigurableAgentConfig
      );

      expect(anthropicProvider.name).toBe('anthropic');
      expect(openaiProvider.name).toBe('openai');
      expect(anthropicProvider).not.toBe(openaiProvider);
    });
  });
});
