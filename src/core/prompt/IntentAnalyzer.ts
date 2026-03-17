/**
 * ============================================================
 * IntentAnalyzer — 意图分析器
 * ============================================================
 * 零 LLM 调用，纯规则 + Embedding 降级。
 *
 * 职责：
 * 1. 场景匹配：规则匹配（<1ms）→ Embedding 匹配（降级）→ 默认 coding
 * 2. 复杂度判断：消息长度 + 关键词（<1ms）
 * 3. 每轮重评估：支持场景切换（连续 2 轮匹配到新场景才切换）
 */

import type { SceneType, IntentComplexity, IntentAnalysis, SceneMatchConfig } from './types';
import type { EmbeddingService } from '@/embedding/EmbeddingService';
import { cosineSimilarity } from '@/embedding/VectorStore';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'IntentAnalyzer' });

// ─── 复杂度判断规则 ────────────────────────────────────

/** 简单任务关键词（排除） */
const SIMPLE_PATTERNS = /^(你好|谢谢|好的|知道了|明白|ok|thanks|hello|hi|bye)$/i;

/** 复杂任务关键词 */
const COMPLEX_KEYWORDS = /架构|重构|迁移|设计|批量|多文件|多步骤|规划|分解|architecture|refactor|migrate|design|batch|multi/i;

/** 简单任务长度阈值 */
const SIMPLE_LENGTH_THRESHOLD = 30;

/** 复杂任务长度阈值 */
const COMPLEX_LENGTH_THRESHOLD = 200;

// ─── IntentAnalyzer ────────────────────────────────────

export class IntentAnalyzer {
  private embeddingService: EmbeddingService | null = null;
  private sceneConfigs: Map<SceneType, SceneMatchConfig> = new Map();
  private sceneEmbeddings: Map<SceneType, Float32Array> = new Map();
  private initialized = false;
  private lastScene: SceneType | null = null;
  private sceneStableCount = 0; // 连续匹配到同一场景的次数

  constructor(embeddingService?: EmbeddingService) {
    this.embeddingService = embeddingService ?? null;
  }

  /**
   * 注册场景匹配配置（从 L1 组件中提取）
   */
  registerScene(scene: SceneType, config: SceneMatchConfig): void {
    this.sceneConfigs.set(scene, config);
    log.debug(`Scene registered: ${scene}`);
  }

  /**
   * 初始化：预计算所有场景的 embeddings
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (!this.embeddingService) {
      log.debug('IntentAnalyzer: no embedding service, keyword-only mode');
      this.initialized = true;
      return;
    }

    for (const [scene, config] of this.sceneConfigs) {
      try {
        const embedding = await this.embeddingService.embed(config.description);
        this.sceneEmbeddings.set(scene, embedding);
      } catch (err) {
        log.warn(`Failed to embed scene "${scene}":`, err);
      }
    }

    this.initialized = true;
    log.info(`IntentAnalyzer initialized: ${this.sceneEmbeddings.size} scenes embedded`);
  }

  /**
   * 分析用户消息的意图
   *
   * @param userMessage - 用户消息
   * @param isFirstTurn - 是否首轮对话（首轮默认 coding，非首轮沿用上轮场景）
   * @returns 意图分析结果
   */
  async analyze(userMessage: string, isFirstTurn = false): Promise<IntentAnalysis> {
    // 1. 复杂度判断（与场景无关）
    const complexity = this.analyzeComplexity(userMessage);

    // 2. 场景匹配
    const scene = await this.matchScene(userMessage, isFirstTurn);

    // 3. 场景防抖：连续 2 轮匹配到新场景才切换
    let finalScene = scene;
    if (scene !== this.lastScene) {
      this.sceneStableCount = 1;
      this.lastScene = scene;
      // 首次匹配到新场景，暂不切换（沿用上轮场景）
      if (!isFirstTurn && this.lastScene) {
        finalScene = this.lastScene;
        log.debug(`Scene change detected (${this.lastScene} → ${scene}), waiting for confirmation`);
      }
    } else {
      this.sceneStableCount++;
      if (this.sceneStableCount >= 2) {
        finalScene = scene;
      }
    }

    return {
      scene: finalScene,
      complexity,
      matchMethod: 'keyword', // 简化：实际匹配方式在 matchScene 中决定
      confidence: 1.0,
    };
  }

  /**
   * 复杂度判断（<1ms）
   */
  private analyzeComplexity(userMessage: string): IntentComplexity {
    const length = userMessage.length;

    // simple: 短消息 + 无动作词
    if (length < SIMPLE_LENGTH_THRESHOLD && SIMPLE_PATTERNS.test(userMessage.trim())) {
      return 'simple';
    }

    // complex: 含多步骤关键词或长消息
    if (COMPLEX_KEYWORDS.test(userMessage) || length > COMPLEX_LENGTH_THRESHOLD) {
      return 'complex';
    }

    // standard: 其他
    return 'standard';
  }

  /**
   * 场景匹配：规则 → Embedding → 默认
   */
  private async matchScene(userMessage: string, isFirstTurn: boolean): Promise<SceneType | null> {
    // 1. 规则匹配（<1ms）
    for (const [scene, config] of this.sceneConfigs) {
      if (config.keywords.test(userMessage)) {
        log.debug(`Scene matched by keyword: ${scene}`);
        return scene;
      }
    }

    // 2. Embedding 匹配（降级）
    if (this.embeddingService && this.sceneEmbeddings.size > 0) {
      try {
        const queryEmbedding = await this.embeddingService.embed(userMessage);
        let bestMatch: { scene: SceneType; similarity: number } | null = null;

        for (const [scene, sceneEmb] of this.sceneEmbeddings) {
          const similarity = cosineSimilarity(queryEmbedding, sceneEmb);
          if (similarity >= 0.3 && (!bestMatch || similarity > bestMatch.similarity)) {
            bestMatch = { scene, similarity };
          }
        }

        if (bestMatch) {
          log.debug(`Scene matched by embedding: ${bestMatch.scene} (${bestMatch.similarity.toFixed(3)})`);
          return bestMatch.scene;
        }
      } catch (err) {
        log.debug('Embedding match failed:', err);
      }
    }

    // 3. 默认：非首轮沿用上轮场景，首轮默认 coding
    if (!isFirstTurn && this.lastScene) {
      log.debug(`Scene: using last scene (${this.lastScene})`);
      return this.lastScene;
    }

    log.debug('Scene: default to coding');
    return 'coding';
  }

  /** 是否已初始化 */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** 重置状态（新会话时调用） */
  reset(): void {
    this.lastScene = null;
    this.sceneStableCount = 0;
  }
}
