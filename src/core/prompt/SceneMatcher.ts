/**
 * ============================================================
 * SceneMatcher — 基于 Embedding 的场景匹配器
 * ============================================================
 * 迁移自 VectorSkillMatcher，但匹配目标从 Skill 变为 Scene。
 *
 * 根据用户首条消息的语义，选择最匹配的场景模板（coding / life）。
 */

import type { EmbeddingService } from '@/embedding/EmbeddingService';
import { cosineSimilarity } from '@/embedding/VectorStore';
import type { SceneType } from './types';
import type { SystemPromptBuilder } from './SystemPromptBuilder';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'SceneMatcher' });

/** 默认相似度阈值 */
const DEFAULT_THRESHOLD = 0.3;

/**
 * 场景匹配结果
 */
export interface SceneMatchResult {
  scene: SceneType;
  similarity: number;
}

/**
 * SceneMatcher — 基于 Embedding 的场景匹配器
 */
export class SceneMatcher {
  private embeddingService: EmbeddingService;
  private sceneEmbeddings: Map<SceneType, Float32Array> = new Map();
  private initialized = false;

  constructor(embeddingService: EmbeddingService) {
    this.embeddingService = embeddingService;
  }

  /**
   * 初始化：预计算所有场景的 embeddings
   */
  async init(promptBuilder: SystemPromptBuilder): Promise<void> {
    if (this.initialized) return;

    const scenes = promptBuilder.getAvailableScenes();

    for (const scene of scenes) {
      try {
        const description = promptBuilder.getSceneDescription(scene);
        if (description) {
          const embedding = await this.embeddingService.embed(description);
          this.sceneEmbeddings.set(scene, embedding);
        }
      } catch (err) {
        log.warn(`Failed to embed scene "${scene}":`, err);
      }
    }

    this.initialized = true;
    log.info(`SceneMatcher initialized: ${this.sceneEmbeddings.size} scenes embedded`);
  }

  /**
   * 根据用户消息匹配最佳场景
   *
   * @returns 匹配的场景，或 null（无匹配时使用默认场景）
   */
  async match(
    userMessage: string,
    threshold = DEFAULT_THRESHOLD,
  ): Promise<SceneMatchResult | null> {
    if (!this.initialized || !userMessage || userMessage.length < 3) {
      return null;
    }

    try {
      const queryEmbedding = await this.embeddingService.embed(userMessage);

      let bestMatch: SceneMatchResult | null = null;

      for (const [scene, sceneEmb] of this.sceneEmbeddings) {
        const similarity = cosineSimilarity(queryEmbedding, sceneEmb);
        log.debug(`Scene "${scene}" similarity: ${similarity.toFixed(3)}`);

        if (similarity >= threshold && (!bestMatch || similarity > bestMatch.similarity)) {
          bestMatch = { scene, similarity };
        }
      }

      if (bestMatch) {
        log.info(`Scene matched: ${bestMatch.scene} (similarity: ${bestMatch.similarity.toFixed(3)})`);
      } else {
        log.debug('No scene matched above threshold');
      }

      return bestMatch;
    } catch (err) {
      log.warn('SceneMatcher.match failed:', err);
      return null;
    }
  }

  /** 是否已初始化 */
  isInitialized(): boolean {
    return this.initialized;
  }
}
