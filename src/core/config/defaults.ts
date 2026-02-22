// ============================================================
// M9 配置管理 — 默认配置
// ============================================================

import type { AppConfig } from '@/core/types';

/**
 * 默认应用配置
 */
export const DEFAULT_CONFIG: AppConfig = {
  provider: {
    model: '[CC]claude-sonnet-4-5-20250929',
    adapter: 'anthropic',
    temperature: undefined,
    timeout: 120_000,
    baseURL: 'https://shibit.net',
  },
  ui: {
    theme: 'auto',
    showTokenUsage: true,
    showCost: true,
    showThinking: false,
  },
  tools: {
    enabled: [],
    permissions: {
      fileWrite: 'ask',
      fileRead: 'always',
      bashExec: 'ask',
    },
  },
  retry: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30_000,
    backoffMultiplier: 2,
    retryableStatusCodes: [429, 500, 502, 503, 529],
  },
};
