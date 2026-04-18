// ============================================================
// MemoryRetriever — M5 分层混合检索器
// ============================================================
// 分层检索：profile 层优先 + knowledge 层相关 + episode 层近期
// 混合评分：vectorScore × 0.5 + keywordScore × 0.3 + weight × 0.2
// 构建 DecisionContext 供 LLM 辅助判断
// ============================================================

import type { MemoryEntry, RetrieveOptions, DecisionContext, MemoryScope, MemoryEntryType } from './types';
import type { CoreRule } from './types';
import type { MemoryStore } from './MemoryStore.js';
import type { EmbeddingService } from '@/embedding/EmbeddingService';
import { logger } from '@/core/logger';
import { STOP_WORDS } from '@/shared/utils/stopwords';
import { MemoryWeightEngine } from './MemoryWeightEngine.js';

const log = logger.child({ module: 'MemoryRetriever' });

const FILE_PATH_RE = /(?:\/|\.\/|\.\.\/)?[\w\-./]+\.\w{1,10}/g;

/** 混合评分权重 */
const HYBRID_WEIGHTS = {
  vectorSimilarity: 0.5,
  keywordMatch:     0.3,
  memoryWeight:     0.2,   // 替换原来的 timeDecay，使用 MemoryWeightEngine 计算的综合权重
};

/**
 * MemoryRetriever — 分层混合检索器
 */
export class MemoryRetriever {
  private store: MemoryStore;
  private embedding: EmbeddingService | null = null;
  private decayHalfLifeDays: number;

  constructor(store: MemoryStore, decayHalfLifeDays = 30) {
    this.store = store;
    this.decayHalfLifeDays = decayHalfLifeDays;
  }

  setEmbeddingService(embedding: EmbeddingService): void {
    this.embedding = embedding;
  }

  /**
   * 检索相关记忆
   * scope 过滤：memoryScope 选项可按层级筛选
   * 兼容性：如果记忆没有 scope 字段，根据 type 自动推断
   */
  async retrieve(query: string, options?: RetrieveOptions): Promise<MemoryEntry[]> {
    const maxResults = options?.maxResults ?? 10;
    const minConfidence = options?.minConfidence ?? 0;
    const types = options?.types;
    const projectPath = options?.projectPath;
    const scopeFilter = options?.memoryScope
      ? (Array.isArray(options.memoryScope) ? options.memoryScope : [options.memoryScope])
      : undefined;

    if (this.embedding) {
      try {
        const queryEmbedding = await this.embedding.embed(query);
        const vectorResults = this.store.searchVector(queryEmbedding, 50);

        if (vectorResults.length > 0) {
          const candidates: Array<{ entry: MemoryEntry; vectorSimilarity: number }> = [];
          for (const vr of vectorResults) {
            const entry = this.store.getEntry(vr.id);
            if (!entry || entry.obsolete) continue;
            if (types && !types.includes(entry.type)) continue;
            // scope 过滤：如果记忆没有 scope，根据 type 推断
            if (scopeFilter) {
              const entryScope = entry.scope ?? this.inferScopeFromType(entry.type);
              if (!scopeFilter.includes(entryScope)) continue;
            }
            if (entry.confidence < minConfidence) continue;
            if (projectPath !== undefined && entry.projectPath !== projectPath && entry.projectPath !== undefined) continue;
            if (!this.isMemoryValid(entry)) continue;
            candidates.push({ entry, vectorSimilarity: vr.similarity });
          }

          const results = this.hybridRerank(candidates, query, maxResults);
          log.debug(`Vector retrieval: ${vectorResults.length} candidates → ${results.length} results`);
          if (results.length > 0) return results;
        }
      } catch (err) {
        log.debug('Vector retrieval failed, falling back to FTS:', err);
      }
    }

    return this.retrieveWithFTS(query, options);
  }

  /**
   * 构建决策上下文（每次对话前调用，辅助 LLM 判断）
   *
   * 组装逻辑：
   * - activeRules:      由调用方传入（CoreRuleStore.getActiveRules()）
   * - profile 层:       检索与 query 相关的用户画像记忆，格式化为摘要
   * - knowledge 层:     检索相关经验教训和历史决策
   * - pendingTasks:     全量读取未完成任务
   */
  async buildDecisionContext(
    query: string,
    activeRules: CoreRule[],
  ): Promise<DecisionContext> {
    // profile 层：用户事实/偏好
    const profileEntries = await this.retrieve(query, {
      maxResults: 5,
      memoryScope: 'profile',
      minConfidence: 0.3,
    });

    // knowledge 层：经验教训 + 历史决策
    const knowledgeEntries = await this.retrieve(query, {
      maxResults: 8,
      memoryScope: 'knowledge',
      minConfidence: 0.3,
    });

    const lessons = knowledgeEntries.filter(
      (e) => e.type === 'lesson_learned' || e.type === 'reusable_pattern' || e.type === 'error_resolution',
    );
    const decisions = knowledgeEntries.filter(
      (e) => e.type === 'decision' || e.type === 'domain_knowledge',
    );

    // 未完成任务（全量读取，不做相关性过滤）
    const allPending = this.store.readAll({ limit: 100 })
      .filter((e) => e.type === 'unfinished_task' && !e.dismissed && !e.obsolete)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 5);

    // profile 摘要
    const profileSummary = profileEntries.length > 0
      ? profileEntries.map((e) => `- ${e.categoryLabel ?? e.type}: ${e.content}`).join('\n')
      : undefined;

    return {
      activeRules,
      profileSummary,
      relevantLessons: lessons,
      relevantDecisions: decisions,
      pendingTasks: allPending,
    };
  }

  retrieveWithFTS(query: string, options?: RetrieveOptions): MemoryEntry[] {
    if (!query || !query.trim()) return [];

    const maxResults = options?.maxResults ?? 10;
    const minConfidence = options?.minConfidence ?? 0;
    const types = options?.types;
    const projectPath = options?.projectPath;
    const scopeFilter = options?.memoryScope
      ? (Array.isArray(options.memoryScope) ? options.memoryScope : [options.memoryScope])
      : undefined;

    const ftsResults = this.store.searchFTS(query, 50);
    const queryKeywords = this.extractQueryKeywords(query);
    const scored: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const entry of ftsResults) {
      if (entry.obsolete) continue;
      if (types && !types.includes(entry.type)) continue;
      // scope 过滤：如果记忆没有 scope，根据 type 推断
      if (scopeFilter) {
        const entryScope = entry.scope ?? this.inferScopeFromType(entry.type);
        if (!scopeFilter.includes(entryScope)) continue;
      }
      if (entry.confidence < minConfidence) continue;
      if (projectPath !== undefined && entry.projectPath !== projectPath && entry.projectPath !== undefined) continue;
      if (!this.isMemoryValid(entry)) continue;

      const keywordScore = this.calcKeywordScore(entry, queryKeywords, query);
      const weight = MemoryWeightEngine.calcWeight(entry);
      const score = (keywordScore * 0.7 + weight * 0.3) * entry.confidence;

      if (score > 0.01) scored.push({ entry, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults).map((s) => s.entry);
  }

  getAll(projectPath?: string): MemoryEntry[] {
    return this.store.readAll({ projectPath });
  }

  // ────────── 混合重排序 ──────────

  private hybridRerank(
    candidates: Array<{ entry: MemoryEntry; vectorSimilarity: number }>,
    query: string,
    maxResults: number,
  ): MemoryEntry[] {
    const queryKeywords = this.extractQueryKeywords(query);
    const scored: Array<{ entry: MemoryEntry; score: number }> = [];

    for (const { entry, vectorSimilarity } of candidates) {
      const keywordScore = this.calcKeywordScore(entry, queryKeywords, query);
      const memWeight = MemoryWeightEngine.calcWeight(entry);

      const finalScore =
        HYBRID_WEIGHTS.vectorSimilarity * Math.max(0, vectorSimilarity) +
        HYBRID_WEIGHTS.keywordMatch * keywordScore +
        HYBRID_WEIGHTS.memoryWeight * memWeight;

      const adjustedScore = finalScore * entry.confidence;

      // profile 层记忆降低过滤门槛（即使权重低也应该召回）
      const minWeight = entry.scope === 'profile' ? 0.1 : 0.25;
      if (memWeight >= minWeight && adjustedScore > 0.01) {
        scored.push({ entry, score: adjustedScore });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults).map((s) => s.entry);
  }

  // ────────── 评分函数 ──────────

  private calcKeywordScore(entry: MemoryEntry, queryKeywords: string[], rawQuery: string): number {
    if (queryKeywords.length === 0) return 0;

    const lowerContent = entry.content.toLowerCase();
    const lowerKeywords = entry.keywords.map((k) => k.toLowerCase());
    // categoryLabel 也参与关键词匹配
    const lowerCategory = (entry.categoryLabel ?? '').toLowerCase();
    let score = 0;

    for (const qk of queryKeywords) {
      if (lowerKeywords.includes(qk)) {
        score += 1.0;
      } else if (lowerKeywords.some((ek) => ek.startsWith(qk) || qk.startsWith(ek))) {
        score += 0.5;
      } else if (lowerContent.includes(qk) || lowerCategory.includes(qk)) {
        score += 0.3;
      }
    }

    if (rawQuery.length > 5 && lowerContent.includes(rawQuery.toLowerCase())) {
      score += queryKeywords.length * 0.5;
    }

    return Math.min(score / queryKeywords.length, 1.0);
  }

  private extractQueryKeywords(query: string): string[] {
    const keywords = new Set<string>();

    const filePaths = query.match(FILE_PATH_RE);
    if (filePaths) {
      for (const fp of filePaths) keywords.add(fp.toLowerCase());
    }

    const words = query
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\-./]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

    for (const word of words) keywords.add(word);
    return Array.from(keywords);
  }

  private isMemoryValid(entry: MemoryEntry): boolean {
    if (entry.type !== 'important_date') return true;
    if (!entry.metadata?.dateValue) return true;
    if (entry.metadata.recurring && entry.metadata.recurring !== 'none') return true;

    if (entry.metadata.dateType === 'deadline') {
      try {
        const overdueMs = Date.now() - new Date(entry.metadata.dateValue).getTime();
        return overdueMs < 7 * 24 * 60 * 60 * 1000;
      } catch {
        return true;
      }
    }
    return true;
  }

  /**
   * 根据记忆类型推断 scope（兼容旧数据）
   */
  private inferScopeFromType(type: MemoryEntryType): MemoryScope {
    // profile 层：用户画像相关
    if (['user_fact', 'user_preference', 'relationship', 'important_date'].includes(type)) {
      return 'profile';
    }
    // knowledge 层：经验教训、决策、领域知识
    if (['lesson_learned', 'reusable_pattern', 'domain_knowledge', 'agent_knowledge', 'decision', 'error_resolution'].includes(type)) {
      return 'knowledge';
    }
    // episode 层：会话摘要、工具模式、项目事实
    return 'episode';
  }
}
