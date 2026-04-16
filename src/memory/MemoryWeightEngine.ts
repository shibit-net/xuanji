// ============================================================
// MemoryWeightEngine — 记忆动态权重计算
// ============================================================
// 权重公式：significance × 时间衰减因子 + 访问加成
// 时间衰减基于 volatility 决定的半衰期
// ============================================================

import type { MemoryEntry, MemoryVolatility } from './types';
import { VOLATILITY_HALF_LIFE, TYPE_DEFAULT_VOLATILITY } from './types';

/** 访问加成系数（每次被检索后权重增量） */
const ACCESS_BONUS_PER_HIT = 0.03;
/** 访问加成上限（防止高频访问记忆永远不衰减） */
const ACCESS_BONUS_CAP = 0.4;

export class MemoryWeightEngine {
  /**
   * 计算记忆的当前动态权重
   *
   * weight = significance × decay(age, halfLife) + accessBonus
   *
   * @param entry 记忆条目
   * @param nowMs 当前时间戳（ms），默认 Date.now()
   */
  static calcWeight(entry: MemoryEntry, nowMs = Date.now()): number {
    const significance = entry.significance ?? entry.confidence ?? 0.5;
    const halfLife = this.getHalfLifeDays(entry);

    // 永不衰减
    if (halfLife === Infinity) return Math.min(significance + this.accessBonus(entry), 1.0);

    const ageDays = (nowMs - new Date(entry.lastAccessedAt || entry.createdAt).getTime()) / 86_400_000;
    const decay = Math.pow(0.5, ageDays / halfLife);
    const bonus = this.accessBonus(entry);

    return Math.min(significance * decay + bonus, 1.0);
  }

  /**
   * 批量更新权重（写回 entry.weight 字段）
   * 在 compact() 前调用，确保权重是最新的
   */
  static updateWeights(entries: MemoryEntry[], nowMs = Date.now()): void {
    for (const entry of entries) {
      entry.weight = this.calcWeight(entry, nowMs);
    }
  }

  /**
   * 判断记忆是否应该被压缩（权重过低）
   * scope=profile 和 permanent 的记忆不参与压缩
   */
  static shouldCompact(entry: MemoryEntry, threshold = 0.05): boolean {
    if (entry.scope === 'profile') return false;
    if (entry.type === 'important_date') return false;
    if (entry.type === 'unfinished_task' && !entry.dismissed) return false;
    const volatility = this.getVolatility(entry);
    if (volatility === 'permanent') return false;
    return this.calcWeight(entry) < threshold;
  }

  /** 获取记忆的半衰期（天） */
  static getHalfLifeDays(entry: MemoryEntry): number {
    const volatility = this.getVolatility(entry);
    return VOLATILITY_HALF_LIFE[volatility];
  }

  /** 获取记忆的 volatility（优先用 entry 自身的，否则按 type 推断） */
  static getVolatility(entry: MemoryEntry): MemoryVolatility {
    if (entry.volatility) return entry.volatility;
    return TYPE_DEFAULT_VOLATILITY[entry.type] ?? 'normal';
  }

  private static accessBonus(entry: MemoryEntry): number {
    return Math.min(entry.accessCount * ACCESS_BONUS_PER_HIT, ACCESS_BONUS_CAP);
  }
}
