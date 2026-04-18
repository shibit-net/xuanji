// ============================================================
// M7 LLM Provider — 重试策略
// ============================================================

import type { RetryConfig } from '@/core/types';
import { sleep } from '@/shared/utils/sleep';

// 重新导出类型供外部使用
export type { RetryConfig };

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
 *
 * @param attempt 当前重试次数（0-based）
 * @param config 重试配置
 * @param isRateLimit 是否为速率限制错误（使用更长的退避时间）
 */
export function calculateBackoff(
  attempt: number,
  config: RetryConfig,
  isRateLimit: boolean = false,
): number {
  // Rate limit 错误：30s 起步，避免短时间内再次触发限制
  const baseDelay = isRateLimit ? 30_000 : config.initialDelay;
  const delay = baseDelay * Math.pow(config.backoffMultiplier, attempt);
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
      if (status !== undefined) {
        return config.retryableStatusCodes.includes(status);
      }
    }

    // Anthropic/OpenAI SDK 超时错误
    if (error.name === 'APIConnectionTimeoutError' || error.message.includes('timeout')) {
      return true;
    }

    // SDK abort 错误（通常由超时或网络中断触发）
    if (error.name === 'AbortError' || error.message.includes('aborted')) {
      return true;
    }

    // Anthropic SDK 空响应错误（服务端建立了连接但未返回任何数据就断开）
    // 常见于 API 网关超时或服务端临时故障
    if (error.message.includes('ended without sending any chunks') ||
        error.message.includes('stream has ended')) {
      return true;
    }

    // SDK APIConnectionError（SSE error 事件或连接错误）
    // 代理层返回 event: error 时，SDK 将其转为 APIConnectionError
    if (error.name === 'APIConnectionError' || error.message.includes('SSE Error')) {
      return true;
    }

    // httpx RemoteProtocolError：Anthropic 服务端在流式传输中途关闭了 TCP 连接
    // 常见于服务端瞬时故障、网络抖动、或代理层连接超时
    // shibit-llm 将其包装为 SSE error 事件，经 AnthropicProvider 包装后 name 变为 'Error'，
    // 需通过 message 内容匹配
    if (error.message.includes('RemoteProtocolError') ||
        error.message.includes('peer closed connection') ||
        error.message.includes('incomplete chunked read')) {
      return true;
    }

    // 速率限制错误（429 / rate_limit_error）
    // ⚠️ 不重试：重试会加剧速率限制，应让用户手动重试或等待冷却
    // AnthropicProvider 外层 catch 会将 SDK 错误包装为 new Error()，
    // 丢失原始 status 属性，需通过 message 内容匹配
    if (error.message.includes('rate_limit') || error.message.includes('429')) {
      return false;
    }

    // 配额不足错误（quota failed / insufficient_quota）
    // ⚠️ 不重试：余额不足无法通过重试解决，需要用户充值或更换 API Key
    if (error.message.includes('quota') &&
        (error.message.includes('failed') ||
         error.message.includes('insufficient') ||
         error.message.includes('exceeded'))) {
      return false;
    }

    // 权限错误（403 / permission_denied / PermissionDeniedError）
    // ⚠️ 不重试：权限问题无法通过重试解决
    if (error.message.includes('PermissionDeniedError') ||
        error.message.includes('permission_denied') ||
        (error.message.includes('403') && !error.message.includes('overloaded'))) {
      return false;
    }

    // Anthropic SSE 流内错误事件（api_error / overloaded_error）
    // 场景：SSE 连接 HTTP 200 成功，但流内容包含 error 事件。
    // SDK 创建的错误对象 status 为 undefined（非 HTTP 级别错误），
    // 因此 HTTP status 检查无法匹配，需通过 error type 名称匹配。
    // 常见于代理层（shibit-llm）返回的内部服务器错误或过载错误。
    if (error.message.includes('api_error') || error.message.includes('overloaded_error')) {
      return true;
    }
  }

  return false;
}

/**
 * 判断是否为速率限制错误
 *
 * ⚠️ 注意：Bedrock 的 ValidationException（如孤立的 tool_result）有时被代理层
 * 包装为 {"type":"rate_limit_error","message":"...ValidationException..."} 格式，
 * 导致消息体中包含 "rate_limit" 字符串，但实际是参数校验错误，不应触发冷却重试。
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    // ValidationException 是不可恢复的参数校验错误，排除在速率限制之外
    if (error.message.includes('ValidationException')) return false;
    return error.message.includes('rate_limit') || error.message.includes('429');
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
      const isRateLimit = isRateLimitError(error);
      const delay = calculateBackoff(attempt, config, isRateLimit);
      await sleep(delay);
    }
  }
  throw lastError;
}
