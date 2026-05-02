/**
 * Provider 模块类型定义
 */

export interface ProviderPoolConfig {
  maxSize?: number;
  maxIdleMs?: number;
  maxFailures?: number;
  maxConcurrent?: number;
}

export interface RateLimitConfig {
  maxRequestsPerMinute?: number;
  maxTokensPerMinute?: number;
  maxConcurrent?: number;
}

export interface FallbackConfig {
  providers: Array<{
    adapter: string;
    model: string;
    apiKey?: string;
    baseURL?: string;
  }>;
  strategy: 'sequential' | 'round_robin' | 'failover';
  maxRetries: number;
}

export interface ProviderMetrics {
  adapter: string;
  model: string;
  requestCount: number;
  errorCount: number;
  avgLatencyMs: number;
  tokenUsage: { input: number; output: number };
  lastUsed: number;
}
