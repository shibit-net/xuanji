// ============================================================
// Skill 语义匹配器 — 基于 Embedding 的意图路由
// ============================================================

import type { EmbeddingService } from '@/embedding/EmbeddingService';
import type { VectorStore } from '@/embedding/VectorStore';
import { cosineSimilarity } from '@/embedding/VectorStore';
import type { SkillRegistry } from './registry';
import { CORE_SKILL_IDS } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'vector-skill-matcher' });

/** 默认相似度阈值 */
const DEFAULT_THRESHOLD = 0.3;

/**
 * VectorSkillMatcher — 使用 Embedding 进行 Skill 意图路由
 *
 * 预计算所有 Skill 的 embeddings（基于 description），
 * 用户消息与 Skill 的余弦相似度超过阈值时匹配成功。
 * 核心 Skill 始终保留，不参与过滤。
 */
export class VectorSkillMatcher {
  private embeddingService: EmbeddingService;
  private vectorStore: VectorStore;
  private skillEmbeddings: Map<string, Float32Array> = new Map();
  private initialized = false;

  constructor(embeddingService: EmbeddingService, vectorStore: VectorStore) {
    this.embeddingService = embeddingService;
    this.vectorStore = vectorStore;
  }

  /**
   * 初始化：预计算所有 Skill 的 embeddings
   */
  async init(skillRegistry: SkillRegistry): Promise<void> {
    if (this.initialized) return;

    const skills = skillRegistry.list({ category: 'prompt', enabled: true });

    for (const skill of skills) {
      if (CORE_SKILL_IDS.has(skill.id)) continue; // 核心 Skill 不需要 embedding

      try {
        const embedding = await this.embeddingService.embed(skill.description);
        this.skillEmbeddings.set(skill.id, embedding);

        // 持久化到 VectorStore
        this.vectorStore.upsertSkillEmbedding(
          skill.id,
          skill.name,
          embedding,
          skill.description,
        );
      } catch (err) {
        log.warn(`Failed to embed skill "${skill.id}":`, err);
      }
    }

    this.initialized = true;
    log.info(`VectorSkillMatcher initialized: ${this.skillEmbeddings.size} skills embedded`);
  }

  /**
   * 基于用户消息匹配 Skill
   *
   * @returns 匹配的 Skill ID 列表（包含核心 Skill + 相似度 > threshold 的场景 Skill）
   */
  async matchSkills(
    enabledIds: string[],
    userMessage: string,
    threshold = DEFAULT_THRESHOLD,
  ): Promise<string[]> {
    if (!userMessage || userMessage.length < 3) return enabledIds;

    const coreIds: string[] = [];
    const sceneIds: string[] = [];

    for (const id of enabledIds) {
      if (CORE_SKILL_IDS.has(id)) {
        coreIds.push(id);
      } else {
        sceneIds.push(id);
      }
    }

    if (sceneIds.length === 0) return enabledIds;

    try {
      const queryEmbedding = await this.embeddingService.embed(userMessage);

      const matchedSceneIds: string[] = [];

      for (const id of sceneIds) {
        const skillEmb = this.skillEmbeddings.get(id);
        if (!skillEmb) {
          // 没有 embedding 的 Skill 始终保留
          matchedSceneIds.push(id);
          continue;
        }

        const similarity = cosineSimilarity(queryEmbedding, skillEmb);
        if (similarity >= threshold) {
          matchedSceneIds.push(id);
          log.debug(`Skill "${id}" matched with similarity ${similarity.toFixed(3)}`);
        }
      }

      // 安全降级：如果没有匹配到任何场景 Skill，保留全部
      if (matchedSceneIds.length === 0) {
        log.debug('No scene skills matched, keeping all');
        return enabledIds;
      }

      log.debug(`Vector skill filter: ${enabledIds.length} → ${coreIds.length + matchedSceneIds.length} skills`);
      return [...coreIds, ...matchedSceneIds];
    } catch (err) {
      log.warn('VectorSkillMatcher.matchSkills failed, returning all skills:', err);
      return enabledIds;
    }
  }

  /** 是否已初始化 */
  isInitialized(): boolean {
    return this.initialized;
  }
}
