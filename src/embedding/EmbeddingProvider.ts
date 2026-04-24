/**
 * ============================================================
 * EmbeddingProvider — 向量模型统一抽象层
 * ============================================================
 *
 * 职责：
 * 1. 提供统一的 embedding 生成接口
 * 2. 管理 EmbeddingService 生命周期
 * 3. 支持批量处理和缓存
 * 4. 提供向量相似度计算工具
 *
 * 使用场景：
 * - IntentAnalyzer: 场景识别
 * - MatchAgentTool: Agent 推荐
 * - VectorStore: 记忆检索
 * - 其他需要向量化的场景
 */

import { EmbeddingService } from './EmbeddingService';
import type { EmbeddingConfig } from '@/shared/types/config';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'EmbeddingProvider' });

/**
 * 向量相似度计算结果
 */
export interface SimilarityResult {
  similarity: number;
  vector1: number[];
  vector2: number[];
}

/**
 * 批量 embedding 结果
 */
export interface BatchEmbeddingResult {
  vectors: number[][];
  texts: string[];
  model: string;
  dimensions: number;
}

/**
 * EmbeddingProvider — 向量模型统一提供者
 *
 * 单例模式，全局共享一个实例
 */
export class EmbeddingProvider {
  private static instance: EmbeddingProvider | null = null;
  private embeddingService: EmbeddingService;
  private initialized = false;

  private constructor(config?: Partial<EmbeddingConfig>) {
    this.embeddingService = EmbeddingService.getInstance(config);
  }

  /**
   * 获取全局单例
   */
  static getInstance(config?: Partial<EmbeddingConfig>): EmbeddingProvider {
    if (!EmbeddingProvider.instance) {
      EmbeddingProvider.instance = new EmbeddingProvider(config);
    }
    return EmbeddingProvider.instance;
  }

  /**
   * 重置单例（用于测试或配置更新）
   */
  static reset(): void {
    EmbeddingProvider.instance = null;
    EmbeddingService.reset();
  }

  /**
   * 初始化（可选，首次调用 embed 时会自动初始化）
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    await this.embeddingService.init();
    this.initialized = true;
    log.info('EmbeddingProvider initialized');
  }

  /**
   * 生成单个文本的 embedding
   *
   * @param text 输入文本
   * @returns 向量（number[]）
   */
  async embed(text: string): Promise<number[]> {
    try {
      const result = await this.embeddingService.embed(text);
      return Array.from(result);
    } catch (err) {
      log.error('Failed to generate embedding:', err);
      throw err;
    }
  }

  /**
   * 批量生成 embeddings
   *
   * @param texts 输入文本数组
   * @returns 批量结果
   */
  async embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
    try {
      const vectors = await this.embeddingService.embedBatch(texts);
      return {
        vectors,
        texts,
        model: this.embeddingService.getModelId(),
        dimensions: this.embeddingService.getDimensions(),
      };
    } catch (err) {
      log.error('Failed to generate batch embeddings:', err);
      throw err;
    }
  }

  /**
   * 计算两个向量的余弦相似度
   *
   * @param vec1 向量1
   * @param vec2 向量2
   * @returns 相似度 [0, 1]
   */
  cosineSimilarity(vec1: number[] | Float32Array, vec2: number[] | Float32Array): number {
    const a = Array.isArray(vec1) ? vec1 : Array.from(vec1);
    const b = Array.isArray(vec2) ? vec2 : Array.from(vec2);

    if (a.length !== b.length) {
      throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }

  /**
   * 计算文本与向量的相似度
   *
   * @param text 输入文本
   * @param targetVector 目标向量
   * @returns 相似度结果
   */
  async computeSimilarity(
    text: string,
    targetVector: number[] | Float32Array
  ): Promise<SimilarityResult> {
    const vectorArray = await this.embed(text);
    const similarity = this.cosineSimilarity(vectorArray, targetVector);

    return {
      similarity,
      vector1: vectorArray,
      vector2: Array.isArray(targetVector) ? targetVector : Array.from(targetVector),
    };
  }

  /**
   * 在候选项中找到与查询文本最相似的项
   *
   * @param query 查询文本
   * @param candidates 候选项（文本或向量）
   * @param topK 返回前 K 个结果
   * @returns 排序后的相似度结果
   */
  async findMostSimilar(
    query: string,
    candidates: Array<{ text?: string; vector?: number[] | Float32Array; id?: string }>,
    topK = 5
  ): Promise<Array<{ id?: string; similarity: number; index: number }>> {
    const queryVector = await this.embed(query);

    const results = await Promise.all(
      candidates.map(async (candidate, index) => {
        let candidateVector: number[] | Float32Array;

        if (candidate.vector) {
          candidateVector = candidate.vector;
        } else if (candidate.text) {
          candidateVector = await this.embed(candidate.text);
        } else {
          throw new Error(`Candidate at index ${index} has neither text nor vector`);
        }

        const similarity = this.cosineSimilarity(queryVector, candidateVector);

        return {
          id: candidate.id,
          similarity,
          index,
        };
      })
    );

    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  /**
   * 获取当前使用的模型 ID
   */
  getModelId(): string {
    return this.embeddingService.getModelId();
  }

  /**
   * 获取向量维度
   */
  getDimensions(): number {
    return this.embeddingService.getDimensions();
  }

  /**
   * 更新配置（会重置模型）
   */
  updateConfig(config: Partial<EmbeddingConfig>): void {
    this.embeddingService.updateConfig(config);
    this.initialized = false;
    log.info('EmbeddingProvider config updated');
  }

  /**
   * 获取底层 EmbeddingService（用于特殊场景）
   */
  getService(): EmbeddingService {
    return this.embeddingService;
  }
}

/**
 * 便捷函数：获取全局 EmbeddingProvider 实例
 */
export function getEmbeddingProvider(config?: Partial<EmbeddingConfig>): EmbeddingProvider {
  return EmbeddingProvider.getInstance(config);
}

