// ============================================================
// MemoryRetrieval - 检索层实现
// ============================================================
// 负责记忆检索和决策上下文构建
//
// 职责:
// - 混合检索（关键词 + 向量 + 时间衰减）
// - 决策上下文构建
// - 相关性排序
// ============================================================

import type { MemoryEntry } from '@/memory/types';
import type { IMemoryStorage, IMemoryRetrieval, RetrievalContext, DecisionContext } from '../interfaces';
import { VectorManager } from '../VectorManager';
import { MemoryFormatter } from '../MemoryFormatter';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MemoryRetrieval' });

/**
 * MemoryRetrieval - 检索层实现
 */
export class MemoryRetrieval implements IMemoryRetrieval {
  private formatter = new MemoryFormatter();

  constructor(
    private storage: IMemoryStorage,
    private vectorManager: VectorManager,
    private decayHalfLifeDays: number = 30
  ) {}

  /**
   * 检索记忆
   */
  async retrieve(context: RetrievalContext): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];

    // 1. 关键词检索
    if (context.keywords && context.keywords.length > 0) {
      const keywordResults = await this.storage.query({
        keywords: context.keywords,
        limit: context.limit || 20
      });
      results.push(...keywordResults);
    }

    // 2. 向量检索
    if (context.embedding) {
      const vectorResults = await this.vectorManager.search(
        context.embedding,
        context.limit || 20
      );
      results.push(...vectorResults);
    }

    // 3. 时间范围过滤
    let filtered = results;
    if (context.timeRange) {
      filtered = results.filter(entry => {
        const timestamp = entry.createdAt || 0;
        return timestamp >= context.timeRange!.start.getTime() &&
               timestamp <= context.timeRange!.end.getTime();
      });
    }

    // 4. 类型过滤
    if (context.types && context.types.length > 0) {
      filtered = filtered.filter(entry => context.types!.includes(entry.type));
    }

    // 5. 去重和排序
    const unique = this.deduplicateAndRank(filtered);

    // 6. 限制数量
    return unique.slice(0, context.limit || 20);
  }

  /**
   * 构建决策上下文
   */
  async buildDecisionContext(context: DecisionContext): Promise<string> {
    // 检索相关记忆
    const memories = await this.retrieve({
      keywords: [context.operation],
      limit: 10
    });

    // 格式化为文本
    return this.formatter.formatForDecision(memories, context);
  }

  /**
   * 关键词搜索
   */
  async searchByKeywords(keywords: string[], limit: number): Promise<MemoryEntry[]> {
    return await this.storage.query({
      keywords,
      limit
    });
  }

  /**
   * 向量搜索
   */
  async searchByVector(embedding: number[], topK: number): Promise<MemoryEntry[]> {
    return await this.vectorManager.search(embedding, topK);
  }

  /**
   * 去重和排序
   */
  private deduplicateAndRank(entries: MemoryEntry[]): MemoryEntry[] {
    // 按 ID 去重
    const map = new Map<string, MemoryEntry>();
    for (const entry of entries) {
      if (!map.has(entry.id)) {
        map.set(entry.id, entry);
      }
    }

    // 按时间衰减排序
    const unique = Array.from(map.values());
    return unique.sort((a, b) => {
      const scoreA = this.calculateScore(a);
      const scoreB = this.calculateScore(b);
      return scoreB - scoreA;
    });
  }

  /**
   * 计算记忆分数（时间衰减）
   */
  private calculateScore(entry: MemoryEntry): number {
    const now = Date.now();
    const age = now - (entry.createdAt || now);
    const daysPassed = age / (1000 * 60 * 60 * 24);
    const decay = Math.pow(0.5, daysPassed / this.decayHalfLifeDays);
    return decay;
  }
}
