/**
 * 通用异步重试工具
 *
 * 支持指数退避、最大延迟上限、自定义重试条件。
 * 适用于网络请求、API 调用、文件操作等可能因瞬时故障失败的场景。
 */

/** 重试配置选项 */
export interface RetryOptions {
  /** 最大重试次数（不含首次执行），默认 3 */
  maxRetries?: number;
  /** 初始延迟（毫秒），默认 1000 */
  initialDelay?: number;
  /** 最大延迟上限（毫秒），默认 30000 */
  maxDelay?: number;
  /** 指数退避因子，默认 2 */
  backoffFactor?: number;
  /**
   * 判断错误是否应触发重试
   * 返回 true 表示重试，false 表示立即抛出
   * 默认所有错误都重试
   */
  retryIf?: (error: Error) => boolean;
  /**
   * 每次重试前的回调，用于日志记录或通知
   * @param error 上次执行的错误
   * @param attempt 当前重试次数（从 1 开始）
   * @param delay 本次重试前的等待时间（毫秒）
   */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/** 默认重试配置 */
const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'retryIf' | 'onRetry'>> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30_000,
  backoffFactor: 2,
};

/**
 * 计算第 n 次重试的延迟时间（指数退避 + 上限）
 */
function calcDelay(attempt: number, options: Required<RetryOptions>): number {
  const delay = options.initialDelay * Math.pow(options.backoffFactor, attempt - 1);
  return Math.min(delay, options.maxDelay);
}

/**
 * 异步重试执行函数，支持指数退避
 *
 * @param fn 需要重试的异步函数
 * @param options 重试配置选项
 * @returns fn 的成功返回值
 * @throws 如果所有重试均失败，抛出最后一次的错误
 *
 * @example
 * ```ts
 * // 基本用法
 * const data = await retry(() => fetch('https://api.example.com/data').then(r => r.json()));
 *
 * // 自定义配置
 * const data = await retry(
 *   () => fetchData(),
 *   { maxRetries: 5, initialDelay: 500, retryIf: (e) => e.message.includes('ECONNRESET') }
 * );
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const config: Required<RetryOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
    retryIf: options.retryIf ?? (() => true),
    onRetry: options.onRetry ?? (() => {}),
  };

  let lastError: Error;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 如果不满足重试条件 或 已达最大次数，直接抛出
      if (!config.retryIf(lastError) || attempt >= config.maxRetries) {
        throw lastError;
      }

      const delay = calcDelay(attempt + 1, config);
      config.onRetry(lastError, attempt + 1, delay);
      await sleep(delay);
    }
  }

  // 理论上不会走到这里（循环中已抛出），但 TypeScript 需要
  throw lastError!;
}

/** 内部 sleep 实现（与 sleep.ts 一致，避免循环依赖） */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
