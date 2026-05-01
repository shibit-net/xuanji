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

/** Agent 委派模式 — 涉及 agent 调度的短消息也判定为 complex（降级路径兜底） */
const AGENT_DELEGATION_PATTERN = /(使用|用|调用|创建|启动|委托|委派|分配|安排).{0,6}(agent|子代理|团队|team)/i;

/** 简单任务长度阈值 */
const SIMPLE_LENGTH_THRESHOLD = 30;

/** 复杂任务长度阈值 */
const COMPLEX_LENGTH_THRESHOLD = 200;

// ─── IntentAnalyzer ────────────────────────────────────

export class IntentAnalyzer {
  private embeddingProvider: EmbeddingProvider | null = null;
  private sceneConfigs: Map<SceneType, SceneMatchConfig> = new Map();
  private sceneEmbeddings: Map<SceneType, Float32Array> = new Map();
  // 🔧 新增：agent 能力和 system prompt 的 embeddings
  private agentEmbeddings: Map<string, { capabilities: Float32Array; systemPrompt: Float32Array }> = new Map();
  private initialized = false;
  private lastScene: SceneType | null = null;
  private sceneStableCount = 0; // 连续匹配到同一场景的次数
  private eventCallback?: (event: any) => void;
  // 🔧 新增：AgentRegistry 引用
  private agentRegistry: import('@/core/agent/AgentRegistry').AgentRegistry | null = null;

  constructor(embeddingProvider?: EmbeddingProvider, agentRegistry?: import('@/core/agent/AgentRegistry').AgentRegistry) {
    this.embeddingProvider = embeddingProvider ?? null;
    this.agentRegistry = agentRegistry ?? null;
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
   * 初始化：预计算所有场景和 agent 的 embeddings
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (!this.embeddingProvider) {
      log.debug('IntentAnalyzer: no embedding provider, keyword-only mode');
      this.initialized = true;
      return;
    }

    // 🔧 不再在 init 时计算 embeddings，而是延迟到第一次使用时
    // 这样可以避免启动时的长时间等待
    log.info('IntentAnalyzer: embedding provider available, will compute embeddings on first use');

    this.initialized = true;
    log.info(`IntentAnalyzer initialized: ${this.sceneConfigs.size} scenes, ${this.agentRegistry?.getAll().length || 0} agents registered`);
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

    // 2. 场景和 Agent 匹配（三级降级）
    const matchResult = await this.matchSceneAndAgent(userMessage, isFirstTurn);

    // 3. 场景防抖：连续 2 轮匹配到新场景才切换
    let finalScene = matchResult.scene;
    if (matchResult.scene !== this.lastScene) {
      this.sceneStableCount = 1;
      this.lastScene = matchResult.scene;
      // 首次匹配到新场景，暂不切换（沿用上轮场景）
      if (!isFirstTurn && this.lastScene) {
        finalScene = this.lastScene;
        log.debug(`Scene change detected (${this.lastScene} → ${matchResult.scene}), waiting for confirmation`);
      }
    } else {
      this.sceneStableCount++;
      if (this.sceneStableCount >= 2) {
        finalScene = matchResult.scene;
      }
    }

    return {
      scene: finalScene,
      agent: matchResult.agent,
      complexity,
      matchMethod: matchResult.matchMethod,
      confidence: matchResult.confidence,
    };
  }

  /**
   * 复杂度判断（<1ms）
   */
  private analyzeComplexity(userMessage: string): IntentComplexity {
    const length = userMessage.length;
    const trimmed = userMessage.trim();

    // simple: 短消息 + 无动作词
    if (length < SIMPLE_LENGTH_THRESHOLD && SIMPLE_PATTERNS.test(trimmed)) {
      return 'simple';
    }

    // complex: agent 委派（即使消息很短也是复杂操作）
    if (AGENT_DELEGATION_PATTERN.test(trimmed)) {
      return 'complex';
    }

    // complex: 含多步骤关键词或长消息
    if (COMPLEX_KEYWORDS.test(userMessage) || length > COMPLEX_LENGTH_THRESHOLD) {
      return 'complex';
    }

    // standard: 其他
    return 'standard';
  }

  /**
   * 🔧 匹配最佳 agent（基于 agent description）
   */
  async matchAgent(userMessage: string): Promise<{ agentId: string | null; similarity: number } | null> {
    if (!this.embeddingProvider || this.agentEmbeddings.size === 0) {
      return null;
    }

    try {
      const queryEmbedding = await this.embeddingProvider.embed(userMessage);
      const queryVec = new Float32Array(queryEmbedding);

      let bestMatch: { agentId: string; similarity: number } | null = null;

      for (const [agentId, embeddings] of this.agentEmbeddings) {
        // 只对比 agent 的 description
        if (embeddings.capabilities.length > 0) {
          const similarity = cosineSimilarity(queryVec, embeddings.capabilities);
          if (similarity >= 0.3 && (!bestMatch || similarity > bestMatch.similarity)) {
            bestMatch = { agentId, similarity };
          }
        }
      }

      if (bestMatch) {
        log.debug(`Agent matched by embedding: ${bestMatch.agentId} (${bestMatch.similarity.toFixed(3)})`);
      }

      return bestMatch;
    } catch (err) {
      log.warn('Agent embedding match failed:', err);
      return null;
    }
  }

  /**
   * 从 agent ID 推断 scene（优先从 agent tags 动态推导，回退到能力推断）
   */
  private inferSceneFromAgent(agentId: string): SceneType | null {
    if (this.agentRegistry) {
      const agent = this.agentRegistry.get(agentId);
      if (agent) {
        // 优先：从 agent tags 中找 scene 名
        if (agent.tags && Array.isArray(agent.tags)) {
          for (const tag of agent.tags) {
            // 过滤系统标签
            if (!['system', 'classifier', 'local-model', 'internal'].includes(tag)) {
              return tag;
            }
          }
        }
        // 其次：从 agent capabilities 关键词推断
        if (agent.capabilities && Array.isArray(agent.capabilities)) {
          const keywordMap: [string, SceneType][] = [
            ['代码', 'write_code'], ['编程', 'write_code'], ['开发', 'write_code'],
            ['调试', 'debug'], ['修复', 'debug'],
            ['测试', 'test'],
            ['探索', 'explore'], ['分析', 'explore'],
            ['规划', 'plan'], ['架构', 'plan'], ['设计', 'plan'],
            ['审查', 'review'], ['重构', 'refactor'],
            ['UI', 'ui_design'], ['界面', 'ui_design'], ['视觉', 'ui_design'],
            ['产品', 'product_plan'], ['需求', 'requirement'],
          ];
          for (const [keyword, scene] of keywordMap) {
            if (agent.capabilities.some((c: string) => c.includes(keyword))) {
              return scene;
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * 场景和 Agent 匹配（三级降级）
   * 1. Embedding 匹配（优先）
   * 2. Keyword 匹配（降级）
   * 3. 默认兜底
   */
  private async matchSceneAndAgent(
    userMessage: string,
    isFirstTurn: boolean,
  ): Promise<{ scene: SceneType | null; agent: string | null; matchMethod: 'keyword' | 'embedding' | 'default'; confidence: number }> {
    // 1. Embedding 匹配（优先）
    log.info(`[IntentAnalyzer] 检查 embedding 条件: embeddingProvider=${!!this.embeddingProvider}, sceneEmbeddings.size=${this.sceneEmbeddings.size}, agentEmbeddings.size=${this.agentEmbeddings.size}`);

    // 如果有 embeddingProvider 但是 embeddings 为空，尝试计算
    if (this.embeddingProvider) {
      // 计算 scene embeddings
      if (this.sceneEmbeddings.size === 0) {
        log.info('[IntentAnalyzer] sceneEmbeddings 为空，尝试计算...');
        try {
          for (const [scene, config] of this.sceneConfigs) {
            try {
              const embedding = await this.embeddingProvider.embed(config.description);
              this.sceneEmbeddings.set(scene, new Float32Array(embedding));
              log.debug(`[IntentAnalyzer] 成功计算 scene embedding: ${scene}`);
            } catch (err) {
              log.warn(`Failed to embed scene "${scene}":`, err);
            }
          }
          log.info(`[IntentAnalyzer] 完成 scene embeddings 计算: ${this.sceneEmbeddings.size}/${this.sceneConfigs.size}`);
        } catch (err) {
          log.warn('[IntentAnalyzer] 计算 scene embeddings 失败:', err);
        }
      }

      // 计算 agent embeddings
      if (this.agentEmbeddings.size === 0 && this.agentRegistry) {
        log.info('[IntentAnalyzer] agentEmbeddings 为空，尝试计算...');
        try {
          const agents = this.agentRegistry.getAll();
          for (const agent of agents) {
            // 跳过 system 级别的 agent（不应该被推荐）
            if (agent.category === 'system') {
              log.debug(`Skipping system agent: ${agent.id}`);
              continue;
            }

            try {
              let capabilitiesText = '';
              if (agent.capabilities && Array.isArray(agent.capabilities)) {
                capabilitiesText = agent.capabilities.join('、');
              } else if (agent.description) {
                capabilitiesText = agent.description;
              }

              if (capabilitiesText) {
                const embedding = await this.embeddingProvider.embed(capabilitiesText);
                this.agentEmbeddings.set(agent.id, {
                  capabilities: new Float32Array(embedding),
                  systemPrompt: new Float32Array([]),
                });
                log.debug(`[IntentAnalyzer] 成功计算 agent embedding: ${agent.id}`);
              }
            } catch (err) {
              log.warn(`Failed to embed agent "${agent.id}":`, err);
            }
          }
          log.info(`[IntentAnalyzer] 完成 agent embeddings 计算: ${this.agentEmbeddings.size}/${agents.length}`);
        } catch (err) {
          log.warn('[IntentAnalyzer] 计算 agent embeddings 失败:', err);
        }
      }
    }

    if (this.embeddingProvider && this.sceneEmbeddings.size > 0 && this.agentEmbeddings.size > 0) {
      log.debug('[IntentAnalyzer] 发出 match:trying (embedding)');
      this.emitEvent({ type: 'match:trying', method: 'embedding', timestamp: Date.now() });
      try {
        const queryEmbedding = await this.embeddingProvider.embed(userMessage);
        const queryVec = new Float32Array(queryEmbedding);

        // 匹配 scene
        let bestSceneMatch: { scene: SceneType; similarity: number } | null = null;
        for (const [scene, sceneEmb] of this.sceneEmbeddings) {
          const similarity = cosineSimilarity(queryVec, sceneEmb);
          if (similarity >= 0.3 && (!bestSceneMatch || similarity > bestSceneMatch.similarity)) {
            bestSceneMatch = { scene, similarity };
          }
        }

        // 匹配 agent
        let bestAgentMatch: { agentId: string; similarity: number } | null = null;
        for (const [agentId, embeddings] of this.agentEmbeddings) {
          if (embeddings.capabilities.length > 0) {
            const similarity = cosineSimilarity(queryVec, embeddings.capabilities);
            if (similarity >= 0.3 && (!bestAgentMatch || similarity > bestAgentMatch.similarity)) {
              bestAgentMatch = { agentId, similarity };
            }
          }
        }

        if (bestSceneMatch || bestAgentMatch) {
          const scene = bestSceneMatch?.scene || null;
          const agent = bestAgentMatch?.agentId || null;
          const confidence = Math.max(bestSceneMatch?.similarity || 0, bestAgentMatch?.similarity || 0);

          log.debug(`Embedding matched: scene=${scene} (${bestSceneMatch?.similarity.toFixed(3)}), agent=${agent} (${bestAgentMatch?.similarity.toFixed(3)})`);
          log.debug('[IntentAnalyzer] 发出 match:success (embedding)');
          this.emitEvent({ type: 'match:success', method: 'embedding', scene, timestamp: Date.now() });

          return { scene, agent, matchMethod: 'embedding', confidence };
        }
      } catch (err) {
        log.warn('Embedding match failed:', err);
      }
      log.debug('[IntentAnalyzer] 发出 match:failed (embedding)');
      this.emitEvent({ type: 'match:failed', method: 'embedding', timestamp: Date.now() });
    }

    // 2. Keyword 匹配（降级）
    log.debug('[IntentAnalyzer] 发出 match:trying (keyword)');
    this.emitEvent({ type: 'match:trying', method: 'keyword', timestamp: Date.now() });

    for (const [scene, config] of this.sceneConfigs) {
      if (config.keywords.test(userMessage)) {
        log.debug(`Scene matched by keyword: ${scene}`);

        // 根据 scene 的 requiredCapabilities 找到最匹配的 agent
        let matchedAgent: string | null = null;
        if (config.requiredCapabilities && config.requiredCapabilities.length > 0 && this.agentRegistry) {
          matchedAgent = this.findBestAgentForCapabilities(config.requiredCapabilities);
        }

        log.debug('[IntentAnalyzer] 发出 match:success (keyword)');
        this.emitEvent({ type: 'match:success', method: 'keyword', scene, timestamp: Date.now() });

        return { scene, agent: matchedAgent || 'general', matchMethod: 'keyword', confidence: 1.0 };
      }
    }

    log.debug('[IntentAnalyzer] 发出 match:failed (keyword)');
    this.emitEvent({ type: 'match:failed', method: 'keyword', timestamp: Date.now() });

    // 3. 默认兜底
    if (!isFirstTurn && this.lastScene) {
      log.debug(`Using last scene (${this.lastScene})`);
      return { scene: this.lastScene, agent: 'general', matchMethod: 'default', confidence: 0 };
    }

    log.debug('Default to general');
    return { scene: null, agent: 'general', matchMethod: 'default', confidence: 0 };
  }

  /**
   * 根据所需能力找到最匹配的 agent
   */
  private findBestAgentForCapabilities(requiredCapabilities: string[]): string | null {
    if (!this.agentRegistry) {
      return null;
    }

    const agents = this.agentRegistry.getAll();
    let bestAgent: { id: string; matchCount: number } | null = null;

    for (const agent of agents) {
      // 跳过 system 级别的 agent（不应该被推荐）
      if (agent.category === 'system') {
        continue;
      }

      if (agent.capabilities && Array.isArray(agent.capabilities)) {
        // 计算交集数量
        const matchCount = requiredCapabilities.filter(required =>
          agent.capabilities.some(cap => cap.includes(required) || required.includes(cap))
        ).length;

        if (matchCount > 0 && (!bestAgent || matchCount > bestAgent.matchCount)) {
          bestAgent = { id: agent.id, matchCount };
        }
      }
    }

    if (bestAgent) {
      log.debug(`Best agent for capabilities: ${bestAgent.id} (matched ${bestAgent.matchCount}/${requiredCapabilities.length})`);
    }

    return bestAgent?.id || null;
  }

  /**
   * 场景匹配：Embedding → 规则 → 默认
   * @deprecated 使用 matchSceneAndAgent 替代
   */
  private async matchScene(
    userMessage: string,
    isFirstTurn: boolean,
  ): Promise<{ scene: SceneType | null; matchMethod: 'keyword' | 'embedding' | 'default' }> {
    // 1. Embedding 匹配（优先）
    log.info(`[IntentAnalyzer] 检查 embedding 条件: embeddingProvider=${!!this.embeddingProvider}, sceneEmbeddings.size=${this.sceneEmbeddings.size}`);

    // 如果有 embeddingProvider 但是 sceneEmbeddings 为空，尝试重新初始化
    if (this.embeddingProvider && this.sceneEmbeddings.size === 0) {
      log.info('[IntentAnalyzer] sceneEmbeddings 为空，尝试重新计算...');
      try {
        for (const [scene, config] of this.sceneConfigs) {
          try {
            const embedding = await this.embeddingProvider.embed(config.description);
            this.sceneEmbeddings.set(scene, new Float32Array(embedding));
            log.info(`[IntentAnalyzer] 成功计算 scene embedding: ${scene}`);
          } catch (err) {
            log.warn(`Failed to embed scene "${scene}":`, err);
          }
        }
      } catch (err) {
        log.warn('[IntentAnalyzer] 重新计算 embeddings 失败:', err);
      }
    }

    if (this.embeddingProvider && this.sceneEmbeddings.size > 0) {
      log.debug('[IntentAnalyzer] 发出 match:trying (embedding)');
      this.emitEvent({ type: 'match:trying', method: 'embedding', timestamp: Date.now() });
      try {
        const queryEmbedding = await this.embeddingProvider.embed(userMessage);
        const queryVec = new Float32Array(queryEmbedding);
        let bestMatch: { scene: SceneType; similarity: number } | null = null;

        // 匹配 scene descriptions
        for (const [scene, sceneEmb] of this.sceneEmbeddings) {
          const similarity = cosineSimilarity(queryVec, sceneEmb);
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
      } catch (err) {
        log.warn('Scene embedding match failed:', err);
      }
      log.debug('[IntentAnalyzer] 发出 match:failed (embedding)');
      this.emitEvent({ type: 'match:failed', method: 'embedding', timestamp: Date.now() });
    }

    // 2. 规则匹配（降级，<1ms）
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

  /** 获取已注册的 scene 配置（供 ModelClassifier 动态构建 scene 列表） */
  getSceneConfigs(): Map<SceneType, SceneMatchConfig> {
    return new Map(this.sceneConfigs);
  }

  /** 重置状态（新会话时调用） */
  reset(): void {
    this.lastScene = null;
    this.sceneStableCount = 0;
  }
}
