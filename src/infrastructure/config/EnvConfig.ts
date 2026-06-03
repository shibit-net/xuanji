// ============================================================
// M9 配置管理 — 环境变量配置
// ============================================================

import type { ProviderConfig } from '@/core/types';

/**
 * 环境变量键名映射
 */
const ENV_KEYS = {
  XUANJI_API_KEY: 'XUANJI_API_KEY',
  XUANJI_BASE_URL: 'XUANJI_BASE_URL',
  XUANJI_MODEL: 'XUANJI_MODEL',
  XUANJI_MAX_TOKENS: 'XUANJI_MAX_TOKENS',
  XUANJI_THEME: 'XUANJI_THEME',
  XUANJI_LANGUAGE: 'XUANJI_LANGUAGE',
  // 日志相关
  XUANJI_LOG_LEVEL: 'XUANJI_LOG_LEVEL',
  XUANJI_LOG_FILE: 'XUANJI_LOG_FILE',
  XUANJI_LOGGER_TYPE: 'XUANJI_LOGGER_TYPE',
} as const;

/**
 * 从环境变量读取 Provider 配置
 */
export function getEnvProviderConfig(): Partial<ProviderConfig> {
  const config: Partial<ProviderConfig> = {};

  const apiKey = process.env[ENV_KEYS.XUANJI_API_KEY];
  if (apiKey) config.apiKey = apiKey;

  const baseURL = process.env[ENV_KEYS.XUANJI_BASE_URL];
  if (baseURL) config.baseURL = baseURL;

  const model = process.env[ENV_KEYS.XUANJI_MODEL];
  if (model) config.model = model;

  const maxTokens = process.env[ENV_KEYS.XUANJI_MAX_TOKENS];
  if (maxTokens) {
    const parsed = parseInt(maxTokens, 10);
    if (!isNaN(parsed) && parsed > 0) config.maxTokens = parsed;
  }

  return config;
}

/**
 * 从环境变量读取 UI 配置覆盖
 */
export function getEnvUIConfig(): { theme?: string; language?: string } {
  const result: { theme?: string; language?: string } = {};

  const theme = process.env[ENV_KEYS.XUANJI_THEME];
  if (theme) result.theme = theme;

  const language = process.env[ENV_KEYS.XUANJI_LANGUAGE];
  if (language) result.language = language;

  return result;
}

/**
 * 获取 API Key
 */
export function getApiKey(): string | undefined {
  return process.env[ENV_KEYS.XUANJI_API_KEY];
}

export { ENV_KEYS };
