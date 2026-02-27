// ============================================================
// M7 LLM Provider — 重试策略
// ============================================================

import type { RetryConfig } from '@/core/types';

/** 默认重试配置 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30_000,
  backoffMultiplier: 2,
  retryableStatusCodes: [429, 500, 502, 503, 529],
};

/**
 * 计算退避延迟时间
 */
export function calculateBackoff(attempt: number, config: RetryConfig): number {
  const delay = config.initialDelay * Math.pow(config.backoffMultiplier, attempt);
  // 添加 ±20% 抖动
  const jitter = delay * 0.2 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, config.maxDelay);
}

/**
 * 判断是否应该重试
 */
export function shouldRetry(error: unknown, attempt: number, config: RetryConfig): boolean {
  if (attempt >= config.maxRetries) return false;

  if (error instanceof Error) {
    // 网络错误（连接重置、拒绝、超时、DNS 失败）
    if ('code' in error) {
      const code = (error as { code: string }).code;
      const retryableCodes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EPIPE', 'EAI_AGAIN'];
      if (retryableCodes.includes(code)) return true;
    }

    // HTTP 状态码错误
    if ('status' in error) {
      const status = (error as { status: number }).status;
      return config.retryableStatusCodes.includes(status);
    }

    // Anthropic/OpenAI SDK 超时错误
    if (error.name === 'APIConnectionTimeoutError' || error.message.includes('timeout')) {
      return true;
    }
  }

  return false;
}

/**
 * 带重试的异步执行
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error, attempt, config)) {
        throw error;
      }
      const delay = calculateBackoff(attempt, config);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
