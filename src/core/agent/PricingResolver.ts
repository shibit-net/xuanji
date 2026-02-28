// ============================================================
// M2 Agent — 动态定价解析器（三级降级）
// ============================================================
//
// 优先级: 本地配置 → 远程 API (shibit.net) → 硬编码默认值
//

import type { ModelPricing, ResolvedPricing, PricingConfig, RemoteModelPrice } from '@/core/types/pricing';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'PricingResolver' });

/**
 * 内置模型定价表（最终兜底）
 */
const BUILTIN_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4': {
    inputPerMillion: 3,
    outputPerMillion: 15,
    cacheReadPerMillion: 0.3,
    cacheWritePerMillion: 3.75,
  },
  'claude-haiku-3.5': {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheReadPerMillion: 0.08,
    cacheWritePerMillion: 1,
  },
  'claude-haiku-4.5': {
    inputPerMillion: 0.8,
    outputPerMillion: 4,
    cacheReadPerMillion: 0.08,
    cacheWritePerMillion: 1,
  },
  'claude-opus-4': {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheReadPerMillion: 1.5,
    cacheWritePerMillion: 18.75,
  },
  'gpt-4o': {
    inputPerMillion: 2.5,
    outputPerMillion: 10,
  },
  'gpt-4o-mini': {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
  },
  'o1': {
    inputPerMillion: 15,
    outputPerMillion: 60,
  },
  'o3-mini': {
    inputPerMillion: 1.1,
    outputPerMillion: 4.4,
  },
  'deepseek-chat': {
    inputPerMillion: 0.27,
    outputPerMillion: 1.1,
    cacheReadPerMillion: 0.07,
  },
  'deepseek-reasoner': {
    inputPerMillion: 0.55,
    outputPerMillion: 2.19,
    cacheReadPerMillion: 0.14,
  },
};

/** 默认缓存 TTL: 1 小时 */
const DEFAULT_CACHE_TTL = 3_600_000;

/** 默认 CNY → USD 汇率 */
const DEFAULT_CNY_TO_USD = 0.14;

/**
 * PricingResolver — 三级降级定价解析器
 *
 * Level 1: 本地配置 (config.pricing.models)
 * Level 2: 远程 API (shibit.net /api/llm/model-price/all)
 * Level 3: 硬编码默认值 (BUILTIN_PRICING)
 */
export class PricingResolver {
  private config: PricingConfig;
  private baseURL: string;
  private remoteCache: Map<string, ResolvedPricing> = new Map();
  private remoteCacheExpiry = 0;
  private fetchPromise: Promise<void> | null = null;

  constructor(config?: PricingConfig, baseURL?: string) {
    this.config = config ?? {};
    this.baseURL = baseURL ?? '';
  }

  /**
   * 异步初始化：预拉取远程定价（不阻塞）
   */
  async init(): Promise<void> {
    if (this.isRemoteEnabled()) {
      this.fetchRemotePricing().catch((err) => {
        log.debug('Remote pricing fetch failed (will use builtin):', err instanceof Error ? err.message : String(err));
      });
    }
  }

  /**
   * 解析模型定价
   */
  resolve(model: string): ResolvedPricing | null {
    const normalizedModel = this.normalizeModelName(model);

    // Level 1: 本地配置覆盖
    const configPricing = this.resolveFromConfig(normalizedModel);
    if (configPricing) return configPricing;

    // Level 2: 远程缓存
    const remotePricing = this.resolveFromRemoteCache(normalizedModel);
    if (remotePricing) return remotePricing;

    // Level 3: 硬编码默认值
    return this.resolveFromBuiltin(normalizedModel);
  }

  /**
   * 获取定价来源描述（用于 UI 展示）
   */
  getSourceLabel(model: string): string {
    const pricing = this.resolve(model);
    if (!pricing) return 'unknown';
    switch (pricing.source) {
      case 'config': return '本地配置';
      case 'remote': return 'shibit.net';
      case 'builtin': return '内置默认';
      default: return 'unknown';
    }
  }

  // ─── 私有方法 ──────────────────────────────────

  /**
   * 标准化模型名：去除前缀标记和日期版本后缀
   * "[CC]claude-sonnet-4-5-20250929" → "claude-sonnet-4-5"
   */
  private normalizeModelName(model: string): string {
    // 去除 [CC] 等前缀标记
    let normalized = model.replace(/^\[.*?\]/, '');
    // 去除日期版本后缀 (如 -20250929, -20251001)
    normalized = normalized.replace(/-\d{8}$/, '');
    return normalized;
  }

  /**
   * Level 1: 从本地配置解析
   */
  private resolveFromConfig(model: string): ResolvedPricing | null {
    const models = this.config.models;
    if (!models) return null;

    // 精确匹配
    if (models[model]) {
      return { ...models[model], source: 'config' };
    }

    // 模糊匹配
    for (const [key, pricing] of Object.entries(models)) {
      if (model.includes(key) || key.includes(model)) {
        return { ...pricing, source: 'config' };
      }
    }

    return null;
  }

  /**
   * Level 2: 从远程缓存解析
   */
  private resolveFromRemoteCache(model: string): ResolvedPricing | null {
    if (this.remoteCache.size === 0) return null;
    if (Date.now() > this.remoteCacheExpiry) {
      // 缓存过期，异步刷新（不阻塞当前调用）
      if (this.isRemoteEnabled()) {
        this.fetchRemotePricing().catch(() => {});
      }
    }

    // 精确匹配
    const exact = this.remoteCache.get(model);
    if (exact) return exact;

    // 模糊匹配
    for (const [key, pricing] of this.remoteCache) {
      if (model.includes(key) || key.includes(model)) {
        return pricing;
      }
    }

    return null;
  }

  /**
   * Level 3: 从硬编码默认值解析
   */
  private resolveFromBuiltin(model: string): ResolvedPricing | null {
    // 精确匹配
    if (BUILTIN_PRICING[model]) {
      return { ...BUILTIN_PRICING[model], source: 'builtin' };
    }

    // 双向模糊匹配
    for (const [key, pricing] of Object.entries(BUILTIN_PRICING)) {
      if (model.startsWith(key) || model.includes(key)) {
        return { ...pricing, source: 'builtin' };
      }
    }

    return null;
  }

  /**
   * 是否启用远程定价
   */
  private isRemoteEnabled(): boolean {
    if (this.config.remoteEnabled === false) return false;
    // 仅对 shibit.net 拉取
    return this.baseURL.includes('shibit.net');
  }

  /**
   * 拉取远程定价（去重：同时只有一个请求）
   */
  private async fetchRemotePricing(): Promise<void> {
    if (this.fetchPromise) return this.fetchPromise;

    this.fetchPromise = this._fetchRemotePricingInternal();
    try {
      await this.fetchPromise;
    } finally {
      this.fetchPromise = null;
    }
  }

  private async _fetchRemotePricingInternal(): Promise<void> {
    const endpoint = this.config.remoteEndpoint
      ?? `${this.baseURL}/api/llm/model-price/all`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);

    try {
      const resp = await fetch(endpoint, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
      clearTimeout(timer);

      if (!resp.ok) {
        log.debug(`Remote pricing API returned ${resp.status}`);
        return;
      }

      const data = await resp.json() as { success?: boolean; data?: RemoteModelPrice[] } | RemoteModelPrice[];
      const prices: RemoteModelPrice[] = Array.isArray(data)
        ? data
        : (data as any)?.data ?? [];

      if (prices.length === 0) {
        log.debug('Remote pricing API returned empty list');
        return;
      }

      // 解析并缓存
      const cnyToUsd = this.config.exchangeRates?.['CNY'] ?? DEFAULT_CNY_TO_USD;
      const cacheTTL = this.config.cacheTTL ?? DEFAULT_CACHE_TTL;

      this.remoteCache.clear();
      for (const price of prices) {
        const rate = price.currency === 'CNY' ? cnyToUsd : 1;
        const resolved: ResolvedPricing = {
          inputPerMillion: price.inputPrice * rate,
          outputPerMillion: price.outputPrice * rate,
          cacheReadPerMillion: price.cacheReadPrice ? price.cacheReadPrice * rate : undefined,
          cacheWritePerMillion: price.cacheWritePrice ? price.cacheWritePrice * rate : undefined,
          source: 'remote',
          currency: price.currency,
        };
        this.remoteCache.set(this.normalizeModelName(price.modelKey), resolved);
      }

      this.remoteCacheExpiry = Date.now() + cacheTTL;
      log.info(`Remote pricing loaded: ${prices.length} models from ${endpoint}`);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        log.debug('Remote pricing request timeout');
      } else {
        log.debug('Remote pricing fetch error:', err instanceof Error ? err.message : String(err));
      }
    }
  }
}
