// ============================================================
// M4 记忆系统 — 混合检索器（向量 + 关键词 + 时效 + 频次）
// ============================================================

import type { MemoryEntry, RetrieveOptions } from './types';
import type { VectorSearchResult } from '@/embedding/VectorStore';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'hybrid-retriever' });

/** 混合评分权重 */
const HYBRID_WEIGHTS = {
  vectorSimilarity: 0.5,
  keywordMatch: 0.2,
  timeDecay: 0.2,
  accessFrequency: 0.1,
};

/** 停用词（复用 MemoryRetriever 的停用词表） */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has',
  'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
  'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'and', 'or', 'but',
  'if', 'not', 'no', 'so', 'than', 'too', 'very', 'just', 'this', 'that',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us',
  'my', 'your', 'his', 'its', 'our', 'their', 'what', 'which', 'who', 'how',
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '上', '也', '到', '说', '要', '你', '会', '没有', '这', '那', '什么',
]);

/**
 * 混合检索器
 *
 * 对 VectorStore 返回的候选集进行四维度重新评分：
 * - 向量相似度 (50%): 来自 VectorStore 的 cosine similarity
 * - 关键词匹配 (20%): 查询关键词与记忆关键词的匹配度
 * - 时效性衰减 (20%): 基于创建时间的指数衰减
 * - 访问频次 (10%): 基于历史访问次数的对数增长
 */
export class HybridRetriever {
  private decayHalfLifeDays: number;

  constructor(decayHalfLifeDays = 30) {
    this.decayHalfLifeDays = decayHalfLifeDays;
  }

  /**
   * 对向量检索候选集进行混合重评分
   */
  rerank(
    candidates: VectorSearchResult[],
    query: string,
    options?: RetrieveOptions,
  ): MemoryEntry[] {
    const maxResults = options?.maxResults ?? 10;
    const minConfidence = options?.minConfidence ?? 0;
    const types = options?.types;

    const queryKeywords = this.extractKeywords(query);

    const scored: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const candidate of candidates) {
      const { memory, similarity } = candidate;

      // 类型过滤
      if (types && !types.includes(memory.type)) continue;
      // 置信度过滤
      if (memory.confidence < minConfidence) continue;

      const vectorScore = Math.max(0, similarity);
      const keywordScore = this.calcKeywordScore(memory, queryKeywords, query);
      const timeScore = this.calcTimeDecayScore(memory.createdAt);
      const accessScore = this.calcAccessFrequencyScore(memory.accessCount);

      const finalScore =
        HYBRID_WEIGHTS.vectorSimilarity * vectorScore +
        HYBRID_WEIGHTS.keywordMatch * keywordScore +
        HYBRID_WEIGHTS.timeDecay * timeScore +
        HYBRID_WEIGHTS.accessFrequency * accessScore;

      // 乘以置信度
      const adjustedScore = finalScore * memory.confidence;

      if (adjustedScore > 0.01) {
        scored.push({ entry: memory, score: adjustedScore });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    const results = scored.slice(0, maxResults).map((s) => s.entry);
    log.debug(`HybridRetriever: ${candidates.length} candidates → ${results.length} results`);
    return results;
  }

  // ────────── 评分函数 ──────────

  /** 关键词匹配得分 */
  private calcKeywordScore(memory: MemoryEntry, queryKeywords: string[], rawQuery: string): number {
    if (queryKeywords.length === 0) return 0;

    const lowerContent = memory.content.toLowerCase();
    const lowerKeywords = memory.keywords.map((k) => k.toLowerCase());

    let score = 0;

    for (const qk of queryKeywords) {
      // 关键词精确匹配
      if (lowerKeywords.includes(qk)) {
        score += 1.0;
      }
      // 前缀匹配
      else if (lowerKeywords.some((ek) => ek.startsWith(qk) || qk.startsWith(ek))) {
        score += 0.5;
      }
      // 内容子串匹配
      else if (lowerContent.includes(qk)) {
        score += 0.3;
      }
    }

    // 完整查询子串匹配（加分）
    if (rawQuery.length > 5 && lowerContent.includes(rawQuery.toLowerCase())) {
      score += queryKeywords.length * 0.5;
    }

    return Math.min(score / queryKeywords.length, 1.0);
  }

  /** 时间衰减得分（指数衰减，半衰期可配置） */
  private calcTimeDecayScore(createdAt: string): number {
    const ageMs = Date.now() - new Date(createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return Math.pow(0.5, ageDays / this.decayHalfLifeDays);
  }

  /** 访问频次得分（对数增长，防止过度提权） */
  private calcAccessFrequencyScore(accessCount: number): number {
    return Math.min(Math.log2(accessCount + 1) / 10, 1.0);
  }

  /** 从查询中提取关键词 */
  private extractKeywords(query: string): string[] {
    const keywords = new Set<string>();

    const words = query
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\-./]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

    for (const word of words) {
      keywords.add(word);
    }

    return Array.from(keywords);
  }
}
