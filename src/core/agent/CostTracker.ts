// ============================================================
// M2 Agent — 费用追踪器
// ============================================================

import type { TokenUsage } from '@/core/types';
import type { ResolvedPricing } from '@/core/types/pricing';
import type { PricingResolver } from './PricingResolver';

/**
 * 费用追踪器
 *
 * 使用 PricingResolver 的三级降级策略获取模型定价，
 * 支持 shibit.net 远程定价和自定义模型配置。
 */
export class CostTracker {
  private model: string;
  private totalCost = 0;
  private sessionUsage: TokenUsage = { input: 0, output: 0 };
  private pricingResolver: PricingResolver | null = null;
  private cachedPricing: ResolvedPricing | null = null;

  constructor(model: string, pricingResolver?: PricingResolver) {
    this.model = model;
    this.pricingResolver = pricingResolver ?? null;
    this.cachedPricing = this.pricingResolver?.resolve(model) ?? null;
  }

  /**
   * 注入 PricingResolver（延迟初始化场景）
   */
  setPricingResolver(resolver: PricingResolver): void {
    this.pricingResolver = resolver;
    this.cachedPricing = resolver.resolve(this.model);
  }

  /**
   * 计算本次调用费用
   */
  calculateCost(usage: TokenUsage): number {
    // 延迟解析：如果 cachedPricing 为 null 且有 resolver，尝试重新解析
    if (!this.cachedPricing && this.pricingResolver) {
      this.cachedPricing = this.pricingResolver.resolve(this.model);
    }
    const pricing = this.cachedPricing;
    if (!pricing) return 0;

    let cost = 0;
    // input tokens 直接计费（Anthropic 的 input_tokens 不含 cache tokens）
    cost += (usage.input / 1_000_000) * pricing.inputPerMillion;
    cost += (usage.output / 1_000_000) * pricing.outputPerMillion;
    // cache read/write 独立计费
    if (usage.cacheRead && pricing.cacheReadPerMillion) {
      cost += (usage.cacheRead / 1_000_000) * pricing.cacheReadPerMillion;
    }
    if (usage.cacheWrite && pricing.cacheWritePerMillion) {
      cost += (usage.cacheWrite / 1_000_000) * pricing.cacheWritePerMillion;
    }
    return cost;
  }

  /**
   * 记录一次调用
   */
  record(usage: TokenUsage): number {
    const cost = this.calculateCost(usage);
    this.totalCost += cost;
    this.sessionUsage.input += usage.input;
    this.sessionUsage.output += usage.output;
    this.sessionUsage.cacheRead = (this.sessionUsage.cacheRead ?? 0) + (usage.cacheRead ?? 0);
    this.sessionUsage.cacheWrite = (this.sessionUsage.cacheWrite ?? 0) + (usage.cacheWrite ?? 0);
    return cost;
  }

  /**
   * 获取会话总费用
   */
  getTotalCost(): number {
    return this.totalCost;
  }

  /**
   * 获取会话累计 token 用量
   */
  getSessionUsage(): TokenUsage {
    return { ...this.sessionUsage };
  }

  /**
   * 格式化费用显示
   */
  formatCost(cost?: number): string {
    const value = cost ?? this.totalCost;
    if (value < 0.01) {
      return `$${value.toFixed(4)}`;
    }
    return `$${value.toFixed(2)}`;
  }

  /**
   * 更新模型
   */
  setModel(model: string): void {
    this.model = model;
    this.cachedPricing = this.pricingResolver?.resolve(model) ?? null;
  }

  /**
   * 获取当前定价来源
   */
  getPricingSource(): string {
    return this.pricingResolver?.getSourceLabel(this.model) ?? 'unknown';
  }
}
