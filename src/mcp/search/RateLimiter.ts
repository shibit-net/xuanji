/**
 * ============================================================
 * Rate Limiter - 速率限制器
 * ============================================================
 * 提供基于滑动窗口的速率限制功能
 */

/**
 * 速率限制器配置
 */
export interface RateLimiterOptions {
  /** 时间窗口内最大请求数 */
  limit: number;
  /** 时间窗口（毫秒） */
  window: number;
}

/**
 * 速率限制器
 */
export class RateLimiter {
  private requests: number[] = []; // 时间戳数组
  private limit: number;
  private window: number;

  constructor(options: RateLimiterOptions) {
    this.limit = options.limit;
    this.window = options.window;
  }

  /**
   * 检查是否超出速率限制
   * @returns 如果允许请求返回 true，否则抛出错误
   * @throws 超出速率限制时抛出错误
   */
  async checkLimit(): Promise<void> {
    const now = Date.now();
    // 清理过期请求
    this.requests = this.requests.filter((t) => now - t < this.window);

    if (this.requests.length >= this.limit) {
      const oldestRequest = this.requests[0]!;
      const waitTime = this.window - (now - oldestRequest);
      throw new Error(`Rate limit exceeded. Please wait ${Math.ceil(waitTime / 1000)}s`);
    }

    this.requests.push(now);
  }

  /**
   * 获取剩余配额
   */
  getRemainingQuota(): number {
    const now = Date.now();
    this.requests = this.requests.filter((t) => now - t < this.window);
    return Math.max(0, this.limit - this.requests.length);
  }

  /**
   * 重置限制器
   */
  reset(): void {
    this.requests = [];
  }

  /**
   * 获取统计信息
   */
  stats(): {
    limit: number;
    window: number;
    used: number;
    remaining: number;
  } {
    const now = Date.now();
    this.requests = this.requests.filter((t) => now - t < this.window);
    return {
      limit: this.limit,
      window: this.window,
      used: this.requests.length,
      remaining: Math.max(0, this.limit - this.requests.length),
    };
  }
}
