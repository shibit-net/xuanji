/**
 * ProviderPool — LLM Provider 连接池
 *
 * 职责：provider 实例复用（引用计数 + LRU）、故障转移、速率限制、健康检查。
 */

import type { ILLMProvider, ProviderConfig } from '@/core/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ProviderPool' });

interface PooledProvider {
  provider: ILLMProvider;
  configHash: string;
  refCount: number;
  lastUsed: number;
  failures: number;
}

export interface HealthStatus {
  healthy: boolean;
  failures: number;
  lastUsed: number;
  refCount: number;
}

export class ProviderPool {
  private pool = new Map<string, PooledProvider>();
  private maxSize: number;
  private maxIdleMs: number;
  private maxFailures: number;
  private fallbackConfigs: ProviderConfig[] = [];
  private rateLimitSem = 0;
  private maxConcurrent: number;
  private factory: (config: ProviderConfig) => ILLMProvider;

  constructor(
    factory: (config: ProviderConfig) => ILLMProvider,
    options?: { maxSize?: number; maxIdleMs?: number; maxFailures?: number; maxConcurrent?: number },
  ) {
    this.factory = factory;
    this.maxSize = options?.maxSize ?? 20;
    this.maxIdleMs = options?.maxIdleMs ?? 5 * 60 * 1000;
    this.maxFailures = options?.maxFailures ?? 3;
    this.maxConcurrent = options?.maxConcurrent ?? 10;
  }

  private hash(config: ProviderConfig): string {
    return `${config.adapter ?? ''}:${config.model}:${config.apiKey?.slice(-8)}:${config.baseURL}`;
  }

  getProvider(config: ProviderConfig): ILLMProvider {
    const key = this.hash(config);
    const entry = this.pool.get(key);
    if (entry) {
      entry.refCount++;
      entry.lastUsed = Date.now();
      log.debug(`Provider reused: ${key} (refs=${entry.refCount})`);
      return entry.provider;
    }
    if (this.pool.size >= this.maxSize) this.evictOne();
    const provider = this.factory(config);
    this.pool.set(key, { provider, configHash: key, refCount: 1, lastUsed: Date.now(), failures: 0 });
    log.info(`Provider created: ${key}`);
    return provider;
  }

  releaseProvider(provider: ILLMProvider): void {
    for (const [key, entry] of this.pool) {
      if (entry.provider === provider) {
        entry.refCount = Math.max(0, entry.refCount - 1);
        log.debug(`Provider released: ${key} (refs=${entry.refCount})`);
        if (entry.refCount === 0) {
          // 不立即删除，保留复用
        }
        return;
      }
    }
  }

  setFallbackConfigs(configs: ProviderConfig[]): void {
    this.fallbackConfigs = configs;
  }

  getFallbackProvider(failedProvider: ILLMProvider): ILLMProvider | null {
    for (const [key, entry] of this.pool) {
      if (entry.provider === failedProvider) {
        entry.failures++;
        if (entry.failures >= this.maxFailures && this.fallbackConfigs.length > 0) {
          log.warn(`Provider ${key} failed ${entry.failures} times, switching to fallback`);
          return this.getProvider(this.fallbackConfigs[0]);
        }
      }
    }
    return null;
  }

  recordSuccess(provider: ILLMProvider): void {
    for (const [, entry] of this.pool) {
      if (entry.provider === provider) {
        entry.failures = 0;
        return;
      }
    }
  }

  async acquireRateSlot(): Promise<void> {
    while (this.rateLimitSem >= this.maxConcurrent) {
      await new Promise(r => setTimeout(r, 50));
    }
    this.rateLimitSem++;
  }

  releaseRateSlot(): void {
    this.rateLimitSem = Math.max(0, this.rateLimitSem - 1);
  }

  async warmup(configs: ProviderConfig[]): Promise<void> {
    await Promise.all(configs.map(c => { this.getProvider(c); }));
  }

  healthCheck(): Map<string, HealthStatus> {
    const result = new Map<string, HealthStatus>();
    for (const [key, entry] of this.pool) {
      result.set(key, {
        healthy: entry.failures < this.maxFailures,
        failures: entry.failures,
        lastUsed: entry.lastUsed,
        refCount: entry.refCount,
      });
    }
    return result;
  }

  evictIdle(): void {
    const now = Date.now();
    for (const [key, entry] of this.pool) {
      if (entry.refCount === 0 && now - entry.lastUsed > this.maxIdleMs) {
        this.pool.delete(key);
        log.debug(`Evicted idle provider: ${key}`);
      }
    }
  }

  private evictOne(): void {
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [key, entry] of this.pool) {
      if (entry.refCount === 0 && entry.lastUsed < oldestTime) {
        oldestKey = key;
        oldestTime = entry.lastUsed;
      }
    }
    if (oldestKey) {
      this.pool.delete(oldestKey);
      log.debug(`LRU evicted: ${oldestKey}`);
    }
  }

  get size(): number { return this.pool.size; }
}
