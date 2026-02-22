// ============================================================
// M2 Agent — 费用追踪器
// ============================================================

import type { TokenUsage } from '@/types';

/**
 * 模型定价 (每百万 token，美元)
 */
interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
}

/**
 * 已知模型定价表
 */
const MODEL_PRICING: Record<string, ModelPricing> = {
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
  'claude-opus-4': {
    inputPerMillion: 15,
    outputPerMillion: 75,
    cacheReadPerMillion: 1.5,
    cacheWritePerMillion: 18.75,
  },
};

/**
 * 费用追踪器
 */
export class CostTracker {
  private model: string;
  private totalCost = 0;
  private sessionUsage: TokenUsage = { input: 0, output: 0 };

  constructor(model: string) {
    this.model = model;
  }

  /**
   * 计算本次调用费用
   */
  calculateCost(usage: TokenUsage): number {
    const pricing = this.findPricing(this.model);
    if (!pricing) return 0;

    let cost = 0;
    cost += (usage.input / 1_000_000) * pricing.inputPerMillion;
    cost += (usage.output / 1_000_000) * pricing.outputPerMillion;

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
  }

  /**
   * 查找模型定价
   */
  private findPricing(model: string): ModelPricing | undefined {
    // 精确匹配
    if (MODEL_PRICING[model]) return MODEL_PRICING[model];

    // 前缀匹配
    for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
      if (model.startsWith(key)) return pricing;
    }

    return undefined;
  }
}
