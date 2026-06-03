import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_RETRY_CONFIG,
  calculateBackoff,
  shouldRetry,
  withRetry,
} from '@/provider/RetryPolicy';
import type { RetryConfig } from '@/core/types';

describe('RetryPolicy', () => {
  describe('DEFAULT_RETRY_CONFIG', () => {
    it('应有合理的默认值', () => {
      expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
      expect(DEFAULT_RETRY_CONFIG.initialDelay).toBe(1000);
      expect(DEFAULT_RETRY_CONFIG.maxDelay).toBe(30_000);
      expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
      expect(DEFAULT_RETRY_CONFIG.retryableStatusCodes).toEqual([429, 500, 502, 503, 529]);
    });
  });

  describe('calculateBackoff()', () => {
    it('应计算指数退避延迟', () => {
      const config = { ...DEFAULT_RETRY_CONFIG };
      // attempt 0: 1000 * 2^0 = 1000 ± 20% → [800, 1200]
      const delay0 = calculateBackoff(0, config);
      expect(delay0).toBeGreaterThanOrEqual(800);
      expect(delay0).toBeLessThanOrEqual(1200);

      // attempt 1: 1000 * 2^1 = 2000 ± 20% → [1600, 2400]
      const delay1 = calculateBackoff(1, config);
      expect(delay1).toBeGreaterThanOrEqual(1600);
      expect(delay1).toBeLessThanOrEqual(2400);
    });

    it('应不超过 maxDelay', () => {
      const config = { ...DEFAULT_RETRY_CONFIG, maxDelay: 5000 };
      // attempt 10: 1000 * 2^10 = 1024000 → 应被限制到 5000
      const delay = calculateBackoff(10, config);
      expect(delay).toBeLessThanOrEqual(config.maxDelay);
    });

    it('不同调用应有抖动 (jitter)', () => {
      const config = { ...DEFAULT_RETRY_CONFIG };
      const delays = new Set<number>();
      for (let i = 0; i < 20; i++) {
        delays.add(calculateBackoff(0, config));
      }
      // 20 次调用应该有不同的值 (除非极端巧合)
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  describe('shouldRetry()', () => {
    it('达到最大重试次数时应返回 false', () => {
      const result = shouldRetry(new Error('test'), 3, DEFAULT_RETRY_CONFIG);
      expect(result).toBe(false);
    });

    it('ECONNRESET 应可重试', () => {
      const err = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
      const result = shouldRetry(err, 0, DEFAULT_RETRY_CONFIG);
      expect(result).toBe(true);
    });

    it('429 状态码应可重试', () => {
      const err = Object.assign(new Error('rate limited'), { status: 429 });
      const result = shouldRetry(err, 0, DEFAULT_RETRY_CONFIG);
      expect(result).toBe(true);
    });

    it('500 状态码应可重试', () => {
      const err = Object.assign(new Error('server error'), { status: 500 });
      expect(shouldRetry(err, 0, DEFAULT_RETRY_CONFIG)).toBe(true);
    });

    it('400 状态码应不可重试', () => {
      const err = Object.assign(new Error('bad request'), { status: 400 });
      expect(shouldRetry(err, 0, DEFAULT_RETRY_CONFIG)).toBe(false);
    });

    it('普通错误无特殊属性应不可重试', () => {
      expect(shouldRetry(new Error('unknown'), 0, DEFAULT_RETRY_CONFIG)).toBe(false);
    });

    it('非 Error 类型应不可重试', () => {
      expect(shouldRetry('string error', 0, DEFAULT_RETRY_CONFIG)).toBe(false);
    });
  });

  describe('withRetry()', () => {
    it('成功时应直接返回结果', async () => {
      const fn = vi.fn(async () => 'success');
      const result = await withRetry(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('不可重试错误应直接抛出', async () => {
      const fn = vi.fn(async () => { throw new Error('bad request'); });
      await expect(withRetry(fn, { ...DEFAULT_RETRY_CONFIG, maxRetries: 3 })).rejects.toThrow('bad request');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('可重试错误应重试直到成功', async () => {
      let calls = 0;
      const fn = vi.fn(async () => {
        calls++;
        if (calls < 3) {
          throw Object.assign(new Error('server error'), { status: 500 });
        }
        return 'eventually succeeded';
      });

      const config: RetryConfig = {
        ...DEFAULT_RETRY_CONFIG,
        initialDelay: 10, // 使用很短的延迟加速测试
        maxDelay: 50,
      };

      const result = await withRetry(fn, config);
      expect(result).toBe('eventually succeeded');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('超过最大重试次数应抛出最后一个错误', async () => {
      const fn = vi.fn(async () => {
        throw Object.assign(new Error('persistent error'), { status: 500 });
      });

      const config: RetryConfig = {
        ...DEFAULT_RETRY_CONFIG,
        maxRetries: 2,
        initialDelay: 10,
        maxDelay: 50,
      };

      await expect(withRetry(fn, config)).rejects.toThrow('persistent error');
      expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });
  });
});
