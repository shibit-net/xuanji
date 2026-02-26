// ============================================================
// M4 记忆系统 — 关键词匹配检索引擎
// ============================================================

import type { MemoryEntry, RetrieveOptions } from './types';

/** 文件路径正则 */
const FILE_PATH_RE = /(?:\/|\.\/|\.\.\/)?[\w\-./]+\.\w{1,10}/g;

/** 英文停用词 */
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

/** 评分权重 */
const WEIGHTS = {
  keywordMatch: 0.5,
  contentMatch: 0.3,
  timeDecay: 0.1,
  accessFrequency: 0.1,
};

/**
 * 记忆检索引擎
 *
 * P2 阶段使用关键词匹配 + 加权得分 + 时间衰减。
 * P3 阶段可扩展为语义向量检索。
 */
export class MemoryRetriever {
  private decayHalfLifeDays: number;

  constructor(decayHalfLifeDays = 30) {
    this.decayHalfLifeDays = decayHalfLifeDays;
  }

  /** 检索相关记忆 */
  retrieve(query: string, memories: MemoryEntry[], options?: RetrieveOptions): MemoryEntry[] {
    const maxResults = options?.maxResults ?? 10;
    const minConfidence = options?.minConfidence ?? 0;
    const types = options?.types;

    const queryKeywords = this.extractQueryKeywords(query);
    if (queryKeywords.length === 0) return [];

    const scored: { entry: MemoryEntry; score: number }[] = [];

    for (const entry of memories) {
      // 类型过滤
      if (types && !types.includes(entry.type)) continue;

      // 置信度过滤
      if (entry.confidence < minConfidence) continue;

      const score = this.calculateScore(entry, queryKeywords, query);
      if (score > 0.01) {
        scored.push({ entry, score });
      }
    }

    // 按得分降序排列
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, maxResults).map((s) => s.entry);
  }

  /** 从查询中提取关键词 */
  extractQueryKeywords(query: string): string[] {
    const keywords = new Set<string>();

    // 提取文件路径
    const filePaths = query.match(FILE_PATH_RE);
    if (filePaths) {
      for (const fp of filePaths) {
        keywords.add(fp.toLowerCase());
      }
    }

    // 分词并过滤停用词
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

  /** 计算相关性得分 */
  private calculateScore(entry: MemoryEntry, queryKeywords: string[], rawQuery: string): number {
    const keywordScore = this.calcKeywordMatchScore(entry.keywords, queryKeywords);
    const contentScore = this.calcContentMatchScore(entry.content, queryKeywords, rawQuery);
    const timeScore = this.calcTimeDecayScore(entry.createdAt);
    const accessScore = this.calcAccessFrequencyScore(entry.accessCount);

    const rawScore =
      WEIGHTS.keywordMatch * keywordScore +
      WEIGHTS.contentMatch * contentScore +
      WEIGHTS.timeDecay * timeScore +
      WEIGHTS.accessFrequency * accessScore;

    return rawScore * entry.confidence;
  }

  /** 关键词匹配得分 */
  private calcKeywordMatchScore(entryKeywords: string[], queryKeywords: string[]): number {
    if (entryKeywords.length === 0 || queryKeywords.length === 0) return 0;

    let totalScore = 0;
    const lowerEntryKeywords = entryKeywords.map((k) => k.toLowerCase());

    for (const qk of queryKeywords) {
      const lqk = qk.toLowerCase();
      // 精确匹配
      if (lowerEntryKeywords.includes(lqk)) {
        totalScore += 1.0;
        continue;
      }
      // 前缀匹配
      if (lowerEntryKeywords.some((ek) => ek.startsWith(lqk) || lqk.startsWith(ek))) {
        totalScore += 0.5;
      }
    }

    // 归一化
    return Math.min(totalScore / queryKeywords.length, 1.0);
  }

  /** 内容文本匹配得分 */
  private calcContentMatchScore(content: string, queryKeywords: string[], rawQuery: string): number {
    const lowerContent = content.toLowerCase();

    // 完整查询子串匹配（给高分）
    if (rawQuery.length > 5 && lowerContent.includes(rawQuery.toLowerCase())) {
      return 1.0;
    }

    // 关键词在内容中出现的比例
    let matchCount = 0;
    for (const kw of queryKeywords) {
      if (lowerContent.includes(kw.toLowerCase())) {
        matchCount++;
      }
    }

    return queryKeywords.length > 0 ? matchCount / queryKeywords.length : 0;
  }

  /** 时间衰减得分（指数衰减，半衰期 30 天） */
  private calcTimeDecayScore(createdAt: string): number {
    const ageMs = Date.now() - new Date(createdAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return Math.pow(0.5, ageDays / this.decayHalfLifeDays);
  }

  /** 访问频次得分（对数增长，防止过度提权） */
  private calcAccessFrequencyScore(accessCount: number): number {
    return Math.min(Math.log2(accessCount + 1) / 10, 1.0);
  }
}
