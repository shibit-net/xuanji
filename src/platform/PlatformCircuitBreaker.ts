/**
 * PlatformCircuitBreaker — 平台级熔断器
 *
 * 单平台崩溃不影响其他平台。
 * 设计文档：docs/platform-integration-design.md §12.3
 */

import { logger } from '@/core/logger';

const log = logger.child({ module: 'CircuitBreaker' });

export class PlatformCircuitBreaker {
  private failures = new Map<string, number>();
  private openUntil = new Map<string, number>();
  private readonly threshold: number;
  private readonly cooldownMs: number;

  constructor(threshold = 5, cooldownMs = 60_000) {
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
  }

  /** 检查是否熔断中 */
  isOpen(platform: string): boolean {
    const until = this.openUntil.get(platform);
    return !!until && Date.now() < until;
  }

  /** 受保护地执行平台操作 */
  async call<T>(platform: string, fn: () => Promise<T>): Promise<T> {
    if (this.isOpen(platform)) {
      throw new Error(`Circuit breaker open for ${platform}`);
    }

    try {
      const result = await fn();
      this.failures.set(platform, 0);
      if (this.openUntil.has(platform)) {
        this.openUntil.delete(platform);
        log.info(`Circuit breaker closed for ${platform}`);
      }
      return result;
    } catch (err) {
      const count = (this.failures.get(platform) || 0) + 1;
      this.failures.set(platform, count);

      if (count >= this.threshold) {
        this.openUntil.set(platform, Date.now() + this.cooldownMs);
        this.failures.set(platform, 0);
        log.warn(`Circuit breaker opened for ${platform} (${this.cooldownMs}ms cooldown)`);
      }

      throw err;
    }
  }

  /** 手动关闭熔断 */
  reset(platform: string): void {
    this.failures.set(platform, 0);
    this.openUntil.delete(platform);
  }
}
