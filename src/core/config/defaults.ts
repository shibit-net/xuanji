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
    maxTokens: 65536,
    temperature: undefined,
    timeout: 120_000,
    baseURL: 'https://shibit.net',
  },
  ui: {
    theme: 'auto',
    language: 'en',
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
      allowedCommands: [],
      deniedCommands: [],
      allowedPaths: [],
      deniedPaths: [],
    },
  },
  retry: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30_000,
    backoffMultiplier: 2,
    retryableStatusCodes: [429, 500, 502, 503, 529],
  },
  skills: {
    enabled: [
      'xuanji-assistant',
      'tool-guidance',
      'security-rules',
      'agent-rules',
    ],
    disabled: [],
    loadCustom: true,
    customPath: '.xuanji/skills',
    agent: {
      skillId: 'react-loop-default',
    },
  },
};
