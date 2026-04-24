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
import type { EmbeddingProvider } from '@/embedding/EmbeddingProvider';
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
  private embeddingProvider: EmbeddingProvider | null = null;
  private sceneConfigs: Map<SceneType, SceneMatchConfig> = new Map();
  private sceneEmbeddings: Map<SceneType, Float32Array> = new Map();
  private initialized = false;
  private lastScene: SceneType | null = null;
  private sceneStableCount = 0; // 连续匹配到同一场景的次数
  private eventCallback?: (event: any) => void;

  constructor(embeddingProvider?: EmbeddingProvider) {
    this.embeddingProvider = embeddingProvider ?? null;
  }

  /**
   * 设置事件回调
   */
  setEventCallback(callback: (event: any) => void): void {
    this.eventCallback = callback;
  }

  /**
   * 发射事件
   */
  private emitEvent(event: any): void {
    if (this.eventCallback) {
      this.eventCallback(event);
    }
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

    if (!this.embeddingProvider) {
      log.debug('IntentAnalyzer: no embedding provider, keyword-only mode');
      this.initialized = true;
      return;
    }

    for (const [scene, config] of this.sceneConfigs) {
      try {
        const embedding = await this.embeddingProvider.embed(config.description);
        this.sceneEmbeddings.set(scene, new Float32Array(embedding));
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
    const { scene, matchMethod } = await this.matchScene(userMessage, isFirstTurn);

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
      matchMethod,
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
  private async matchScene(
    userMessage: string,
    isFirstTurn: boolean,
  ): Promise<{ scene: SceneType | null; matchMethod: 'keyword' | 'embedding' | 'default' }> {
    // 1. 规则匹配（<1ms）
    log.debug('[IntentAnalyzer] 发出 match:trying (keyword)');
    this.emitEvent({ type: 'match:trying', method: 'keyword', timestamp: Date.now() });
    for (const [scene, config] of this.sceneConfigs) {
      if (config.keywords.test(userMessage)) {
        log.debug(`Scene matched by keyword: ${scene}`);
        log.debug('[IntentAnalyzer] 发出 match:success (keyword)');
        this.emitEvent({ type: 'match:success', method: 'keyword', scene, timestamp: Date.now() });
        return { scene, matchMethod: 'keyword' };
      }
    }
    log.debug('[IntentAnalyzer] 发出 match:failed (keyword)');
    this.emitEvent({ type: 'match:failed', method: 'keyword', timestamp: Date.now() });

    // 2. Embedding 匹配（降级）
    if (this.embeddingProvider && this.sceneEmbeddings.size > 0) {
      log.debug('[IntentAnalyzer] 发出 match:trying (embedding)');
      this.emitEvent({ type: 'match:trying', method: 'embedding', timestamp: Date.now() });
      try {
        const queryEmbedding = await this.embeddingProvider.embed(userMessage);
        let bestMatch: { scene: SceneType; similarity: number } | null = null;

        for (const [scene, sceneEmb] of this.sceneEmbeddings) {
          const similarity = cosineSimilarity(new Float32Array(queryEmbedding), sceneEmb);
          if (similarity >= 0.3 && (!bestMatch || similarity > bestMatch.similarity)) {
            bestMatch = { scene, similarity };
          }
        }

        if (bestMatch) {
          log.debug(`Scene matched by embedding: ${bestMatch.scene} (${bestMatch.similarity.toFixed(3)})`);
          log.debug('[IntentAnalyzer] 发出 match:success (embedding)');
          this.emitEvent({ type: 'match:success', method: 'embedding', scene: bestMatch.scene, timestamp: Date.now() });
          return { scene: bestMatch.scene, matchMethod: 'embedding' };
        }
        log.debug('[IntentAnalyzer] 发出 match:failed (embedding)');
        this.emitEvent({ type: 'match:failed', method: 'embedding', timestamp: Date.now() });
      } catch (err) {
        log.debug('Embedding match failed:', err);
        log.debug('[IntentAnalyzer] 发出 match:failed (embedding)');
        this.emitEvent({ type: 'match:failed', method: 'embedding', timestamp: Date.now() });
      }
    }

    // 3. 默认：非首轮沿用上轮场景，首轮返回 null（让主 Agent 自己决策）
    if (!isFirstTurn && this.lastScene) {
      log.debug(`Scene: using last scene (${this.lastScene})`);
      return { scene: this.lastScene, matchMethod: 'default' };
    }

    log.debug('Scene: default to null (let main agent decide)');
    return { scene: null, matchMethod: 'default' };
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
