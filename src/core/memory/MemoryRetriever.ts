/**
 * MemoryRetriever — 记忆检索器
 *
 * 基于关键词和（未来）向量相似度的记忆检索。
 */
import { logger } from '@/core/logger';
import type { Memory, MemoryQuery, MemorySearchResult } from './types';
import type { MemoryStore } from './MemoryStore';

const log = logger.child({ module: 'MemoryRetriever' });

export class MemoryRetriever {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  async retrieve(query: MemoryQuery): Promise<MemorySearchResult[]> {
    const all = this.store.loadAll();

    let filtered = all;

    if (query.types && query.types.length > 0) {
      filtered = filtered.filter(m => query.types!.includes(m.type));
    }
    if (query.tags && query.tags.length > 0) {
      filtered = filtered.filter(m => m.tags?.some(t => query.tags!.includes(t)));
    }
    if (query.since) {
      filtered = filtered.filter(m => m.createdAt >= query.since!);
    }

    const results: MemorySearchResult[] = [];

    if (query.text) {
      const queryLower = query.text.toLowerCase();
      for (const memory of filtered) {
        const contentLower = memory.content.toLowerCase();
        let score = 0;

        // 精确匹配加分
        if (contentLower.includes(queryLower)) {
          score = 0.7;
          // 更长的重叠加分
          score += Math.min(0.3, queryLower.length / contentLower.length * 0.3);
        } else {
          // 简单的 Jaccard 词级别相似度
          const queryWords = new Set(queryLower.split(/\s+/));
          const contentWords = new Set(contentLower.split(/\s+/));
          const intersection = new Set([...queryWords].filter(w => contentWords.has(w)));
          const union = new Set([...queryWords, ...contentWords]);
          score = intersection.size / (union.size || 1) * 0.5;
        }

        if (query.threshold === undefined || score >= query.threshold) {
          results.push({ memory, score });
        }
      }
    } else {
      for (const memory of filtered) {
        results.push({ memory, score: 1.0 });
      }
    }

    results.sort((a, b) => b.score - a.score);
    const limit = query.limit ?? 10;
    return results.slice(0, limit);
  }

  async retrieveRelevant(query: string, limit = 5): Promise<Memory[]> {
    const results = await this.retrieve({ text: query, limit, threshold: 0.3 });
    return results.map(r => r.memory);
  }
}
