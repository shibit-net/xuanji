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
    lightModel: '[CC]claude-haiku-4-5-20251001',
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
      warnLevel: 'auto-allow', // 默认自动放行 warn 级别操作（向后兼容）
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
      'memory-context',
      'code-assistant',
      'life-secretary',
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
  memory: {
    enabled: true,
    shortTermMaxEntries: 100,
    longTermMaxEntries: 1000,
    retrieveMaxResults: 10,
    maxEntryLength: 500,
    maxPromptLength: 5000,
    compactionThreshold: 500,
    decayHalfLifeDays: 30,
  },
};
