/**
 * RateLimitManager — Provider 速率限制
 *
 * 基于令牌桶和并发控制，防止 API 超限。
 */
import { logger } from '@/infrastructure/logger';
import type { RateLimitConfig } from './types';

const log = logger.child({ module: 'RateLimitManager' });

export class RateLimitManager {
  private maxConcurrent: number;
  private maxRequestsPerMinute: number;
  private maxTokensPerMinute: number;
  private activeRequests = 0;
  private requestTimestamps: number[] = [];
  private tokenTimestamps: Array<{ time: number; tokens: number }> = [];

  constructor(config?: RateLimitConfig) {
    this.maxConcurrent = config?.maxConcurrent ?? 10;
    this.maxRequestsPerMinute = config?.maxRequestsPerMinute ?? 50;
    this.maxTokensPerMinute = config?.maxTokensPerMinute ?? 1_000_000;
  }

  async acquireSlot(): Promise<void> {
    while (this.activeRequests >= this.maxConcurrent) {
      await new Promise(r => setTimeout(r, 50));
    }
    this.activeRequests++;
  }

  releaseSlot(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
  }

  async checkRateLimit(estimatedTokens: number): Promise<boolean> {
    const now = Date.now();
    const windowMs = 60_000;

    this.requestTimestamps = this.requestTimestamps.filter(t => now - t < windowMs);
    this.tokenTimestamps = this.tokenTimestamps.filter(t => now - t.time < windowMs);

    if (this.requestTimestamps.length >= this.maxRequestsPerMinute) {
      log.warn('Rate limit reached: requests per minute');
      return false;
    }

    const totalTokens = this.tokenTimestamps.reduce((sum, t) => sum + t.tokens, 0);
    if (totalTokens + estimatedTokens > this.maxTokensPerMinute) {
      log.warn('Rate limit reached: tokens per minute');
      return false;
    }

    this.requestTimestamps.push(now);
    this.tokenTimestamps.push({ time: now, tokens: estimatedTokens });
    return true;
  }

  async waitForSlot(estimatedTokens: number): Promise<void> {
    while (!(await this.checkRateLimit(estimatedTokens))) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  updateConfig(config: Partial<RateLimitConfig>): void {
    if (config.maxConcurrent !== undefined) this.maxConcurrent = config.maxConcurrent;
    if (config.maxRequestsPerMinute !== undefined) this.maxRequestsPerMinute = config.maxRequestsPerMinute;
    if (config.maxTokensPerMinute !== undefined) this.maxTokensPerMinute = config.maxTokensPerMinute;
  }

  get activeCount(): number { return this.activeRequests; }
}
