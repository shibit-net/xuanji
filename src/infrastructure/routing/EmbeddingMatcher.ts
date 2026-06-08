/**
 * EmbeddingMatcher — 纯语义向量 Agent + Scene 匹配。
 *
 * - Agent: 用能力 + 名字做向量匹配
 * - Scene: 用关键词 + 描述做向量匹配
 * - 无向量时返回 score=0，由 IntentRouter 在 L2 入口跳过直接降级 L3
 * - 内建 embedding 缓存（按 agent ID / scene name），setSceneList / invalidateCache 时清空
 * - 内建并发限制（MAX_CONCURRENT_EMBED），防止 embedding worker 过载
 */

import type { AgentRegistry } from '@/agent/AgentRegistry';
import type { ConfigurableAgentConfig } from '@/agent/types';
import type { EmbeddingProviderInterface } from '@/infrastructure/embedding/EmbeddingProvider';
import type { MatchResult } from './types';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'EmbeddingMatcher' });

/** embedding worker 最大并发数 */
const MAX_CONCURRENT_EMBED = 4;

/** 延迟初始化 embedder（首次 embed() 会自动触发模型下载） */
async function tryCreateEmbedder(): Promise<EmbeddingProviderInterface | null> {
  try {
    const { EmbeddingProvider } = await import('@/infrastructure/embedding/EmbeddingProvider');
    const candidate = new EmbeddingProvider();
    log.info('EmbeddingMatcher: lazy-init embedder created');
    return candidate;
  } catch (err) {
    log.warn('EmbeddingMatcher: lazy-init embedder failed:', err);
  }
  return null;
}

export interface SceneInfo {
  scene: string;
  description?: string;
  keywords?: string;
}

export class EmbeddingMatcher {
  private agentRegistry: AgentRegistry;
  private embedder: EmbeddingProviderInterface | null;
  private sceneList: SceneInfo[] = [];

  // ── Embedding 缓存 ──
  private agentEmbeddingCache = new Map<string, number[]>();
  private sceneEmbeddingCache = new Map<string, number[]>();
  private embedderModelName: string | null = null;

  // ── 并发控制 ──
  private activeEmbeds = 0;
  private embedWaiters: Array<() => void> = [];

  constructor(agentRegistry: AgentRegistry, embedder?: EmbeddingProviderInterface | null) {
    this.agentRegistry = agentRegistry;
    this.embedder = embedder ?? null;
  }

  get hasEmbedder(): boolean {
    return this.embedder !== null;
  }

  getEmbedderModelName(): string | null {
    return this.embedder?.getModelName() ?? null;
  }

  setSceneList(scenes: SceneInfo[]): void {
    this.sceneList = scenes;
    this.sceneEmbeddingCache.clear();
  }

  /** 清除所有 embedding 缓存（agent 配置变更时调用） */
  invalidateCache(): void {
    this.agentEmbeddingCache.clear();
    this.sceneEmbeddingCache.clear();
    this.embedderModelName = null;
    log.debug('Embedding cache invalidated');
  }

  /** 清除单个 agent 的 embedding 缓存 */
  invalidateAgent(agentId: string): void {
    this.agentEmbeddingCache.delete(agentId);
  }

  // ── 并发控制：信号量 ──

  /** 获取 embed 槽位，无可用槽位时排队等待 */
  private async acquireEmbedSlot(): Promise<void> {
    if (this.activeEmbeds < MAX_CONCURRENT_EMBED) {
      this.activeEmbeds++;
      return;
    }
    await new Promise<void>((resolve) => {
      this.embedWaiters.push(resolve);
    });
    this.activeEmbeds++;
  }

  /** 释放 embed 槽位，唤醒下一个等待者 */
  private releaseEmbedSlot(): void {
    this.activeEmbeds--;
    const next = this.embedWaiters.shift();
    if (next) next();
  }

  // ── 带缓存 + 并发控制的 embed ──

  private async safeEmbed(text: string): Promise<number[] | null> {
    if (!this.embedder) return null;
    try {
      return await this.embedder.embed(text);
    } catch (err) {
      log.warn(`Embedding failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** 带并发控制的 embed（用于用户消息等不可缓存的文本） */
  private async safeEmbedLimited(text: string): Promise<number[] | null> {
    await this.acquireEmbedSlot();
    try {
      return await this.safeEmbed(text);
    } finally {
      this.releaseEmbedSlot();
    }
  }

  /**
   * 获取 agent 的 embedding：缓存命中直接返回，否则 embed 后缓存
   * cache key = agent.id（agent 的能力描述是静态的）
   */
  private async getAgentEmbedding(agent: ConfigurableAgentConfig): Promise<number[] | null> {
    const cached = this.agentEmbeddingCache.get(agent.id);
    if (cached) return cached;

    await this.acquireEmbedSlot();
    try {
      // double-check：等待槽位期间可能已被其他调用者缓存
      const cached2 = this.agentEmbeddingCache.get(agent.id);
      if (cached2) return cached2;

      const text = this.buildAgentMatchText(agent);
      const vec = await this.safeEmbed(text);
      if (vec) this.agentEmbeddingCache.set(agent.id, vec);
      return vec;
    } finally {
      this.releaseEmbedSlot();
    }
  }

  /**
   * 获取 scene 的 embedding：缓存命中直接返回，否则 embed 后缓存
   * cache key = scene.scene
   */
  private async getSceneEmbedding(scene: SceneInfo): Promise<number[] | null> {
    const cached = this.sceneEmbeddingCache.get(scene.scene);
    if (cached) return cached;

    await this.acquireEmbedSlot();
    try {
      const cached2 = this.sceneEmbeddingCache.get(scene.scene);
      if (cached2) return cached2;

      const text = [scene.keywords || '', scene.description || ''].join(' ');
      const vec = await this.safeEmbed(text);
      if (vec) this.sceneEmbeddingCache.set(scene.scene, vec);
      return vec;
    } finally {
      this.releaseEmbedSlot();
    }
  }

  /** 检测 embedder 模型是否变更，变更则清空全部缓存 */
  private checkModelChange(): void {
    const currentModel = this.embedder?.getModelName() ?? null;
    if (this.embedderModelName !== null && currentModel !== this.embedderModelName) {
      log.debug(`Embedder model changed: ${this.embedderModelName} → ${currentModel}, invalidating cache`);
      this.invalidateCache();
    }
    if (currentModel) {
      this.embedderModelName = currentModel;
    }
  }

  // ── 匹配逻辑 ──

  async match(message: string, topK: number = 3): Promise<MatchResult[]> {
    // 延迟初始化：模型可能在构造之后才下载完成
    if (!this.embedder) {
      this.embedder = await tryCreateEmbedder();
    }

    const agents = this.getTargetAgents();

    if (!this.embedder) return [];

    this.checkModelChange();

    // 用户消息每次不同，不可缓存，但仍需并发限制
    const messageVec = await this.safeEmbedLimited(message);
    if (!messageVec) return [];

    // Scene embeddings：缓存命中零开销，miss 时并发限制自动排队
    let sceneVecs: Map<string, number[] | null> | null = null;
    if (this.sceneList.length > 0) {
      sceneVecs = new Map();
      const results = await Promise.all(
        this.sceneList.map((s) => this.getSceneEmbedding(s)),
      );
      this.sceneList.forEach((s, i) => sceneVecs!.set(s.scene, results[i]));
    }

    // 无 agent → 仅做场景匹配
    if (agents.length === 0) {
      const { scene, complexity } = this.matchBestScene(messageVec, sceneVecs);
      if (!scene) return [];
      return [{
        agentId: '',
        score: 0.5,
        reason: 'Scene-only semantic match (no agents available)',
        scene,
        complexity,
      }];
    }

    // Agent embeddings：缓存命中零开销
    const agentVecs = new Map<string, number[] | null>();
    if (this.embedder) {
      const results = await Promise.all(
        agents.map((a) => this.getAgentEmbedding(a)),
      );
      agents.forEach((a, i) => agentVecs.set(a.id, results[i]));
    }

    const matches = agents.map((agent) =>
      this.scoreAgent(agent, messageVec, agentVecs.get(agent.id) ?? null, sceneVecs),
    );
    matches.sort((a, b) => b.score - a.score);

    return matches
      .filter((m) => m.score >= 0.3)
      .slice(0, topK);
  }

  /** 语义匹配场景，返回按相似度排序的结果 */
  async matchScenes(message: string, topK: number = 5): Promise<Array<{ scene: string; score: number; description?: string }>> {
    if (!this.embedder) {
      this.embedder = await tryCreateEmbedder();
    }
    if (!this.embedder || this.sceneList.length === 0) return [];

    this.checkModelChange();

    const messageVec = await this.safeEmbedLimited(message);
    if (!messageVec) return [];

    const results: Array<{ scene: string; score: number; description?: string }> = [];
    // 使用缓存的 scene embedding
    const sceneVecs = await Promise.all(
      this.sceneList.map((s) => this.getSceneEmbedding(s)),
    );

    for (let i = 0; i < this.sceneList.length; i++) {
      const vec = sceneVecs[i];
      if (!vec) continue;
      const sim = this.embedder.cosineSimilarity(messageVec, vec);
      if (sim > 0.2) {
        results.push({ scene: this.sceneList[i].scene, score: sim, description: this.sceneList[i].description });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  getSceneList(): SceneInfo[] {
    return this.sceneList;
  }

  /** 匹配最佳 scene，返回 top 3 相似度 > 0.3 的场景 */
  private matchBestScene(
    messageVec: number[] | null,
    sceneVecs: Map<string, number[] | null> | null,
  ): { scene: string; complexity: 'complex' } {
    if (!this.embedder || !messageVec || !sceneVecs || sceneVecs.size === 0) {
      return { scene: '', complexity: 'complex' };
    }

    const scored: Array<{ scene: string; score: number }> = [];
    for (const [scene, vec] of sceneVecs) {
      if (!vec) continue;
      const sim = this.embedder.cosineSimilarity(messageVec, vec);
      if (sim > 0.3) {
        scored.push({ scene, score: sim });
      }
    }

    if (scored.length === 0) return { scene: '', complexity: 'complex' };
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3).map((s) => s.scene);
    return { scene: top.join(','), complexity: 'complex' };
  }

  private getTargetAgents(): ConfigurableAgentConfig[] {
    return this.agentRegistry.getEnabled()
      .filter((a) => a.metadata?.category !== 'system')
      .filter((a) => !a.metadata?.isMainAgent)
      .filter((a) => a.metadata?.internal !== true);
  }

  private buildAgentMatchText(agent: ConfigurableAgentConfig): string {
    const examples = Array.isArray(agent.examples)
      ? agent.examples.map((e) => [e.input, e.output].filter(Boolean).join(' '))
      : [];
    return [
      agent.id,
      agent.name,
      agent.description,
      ...(agent.tags || []),
      ...(agent.triggers || []),
      ...(agent.capabilities || []),
      ...examples,
    ].filter(Boolean).join(' ');
  }

  private scoreAgent(
    agent: ConfigurableAgentConfig,
    messageVec: number[] | null,
    agentVec: number[] | null,
    sceneVecs?: Map<string, number[] | null> | null,
  ): MatchResult {
    if (this.embedder && messageVec && agentVec) {
      const vectorScore = this.embedder.cosineSimilarity(messageVec, agentVec);
      const { scene, complexity } = this.matchBestScene(messageVec, sceneVecs ?? null);
      return {
        agentId: agent.id,
        score: vectorScore,
        reason: vectorScore > 0.7 ? 'High semantic similarity' : 'Semantic match',
        scene,
        complexity,
      };
    }

    return { agentId: agent.id, score: 0, reason: '' };
  }
}
