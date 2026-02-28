// ============================================================
// 动态定价类型定义
// ============================================================

/**
 * 模型定价 (每百万 token，美元)
 */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
}

/**
 * 已解析的定价（含来源标记）
 */
export interface ResolvedPricing extends ModelPricing {
  /** 定价来源 */
  source: 'config' | 'remote' | 'builtin';
  /** 原始币种 (远程 API 可能返回 CNY) */
  currency?: string;
}

/**
 * 远程 API 返回的模型定价数据
 * (shibit.net /api/llm/model-price/all)
 */
export interface RemoteModelPrice {
  modelKey: string;
  vendor: string;
  inputPrice: number;
  outputPrice: number;
  cacheReadPrice?: number;
  cacheWritePrice?: number;
  currency: string;
  billingMethod: number;
}

/**
 * 定价配置节
 */
export interface PricingConfig {
  /** 远程定价 API 端点 */
  remoteEndpoint?: string;
  /** 是否启用远程定价 (默认 true) */
  remoteEnabled?: boolean;
  /** 远程定价缓存 TTL (毫秒, 默认 3600000 = 1 小时) */
  cacheTTL?: number;
  /** 自定义模型定价覆盖 */
  models?: Record<string, ModelPricing>;
  /** 汇率 (用于将远程 API 的 CNY 转换为 USD) */
  exchangeRates?: Record<string, number>;
}
