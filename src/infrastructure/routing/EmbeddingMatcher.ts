/**
 * EmbeddingMatcher — 纯语义向量 Agent + Scene 匹配。
 *
 * - Agent: 用能力 + 名字做向量匹配
 * - Scene: 用关键词 + 描述做向量匹配
 * - 无向量时返回 score=0，由 IntentRouter 在 L2 入口跳过直接降级 L3
 */

import type { AgentRegistry } from '@/agent/AgentRegistry';
import type { ConfigurableAgentConfig } from '@/agent/types';
import type { EmbeddingProviderInterface } from '@/infrastructure/embedding/EmbeddingProvider';
import type { MatchResult } from './types';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'EmbeddingMatcher' });

/** 延迟初始化 embedder（首次 embed() 会自动触发模型下载） */
async function tryCreateEmbedder(): Promise<EmbeddingProviderInterface | null> {
  try {
    const { EmbeddingProvider } = await import('@/core/embedding/EmbeddingProvider');
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
  }

  async match(message: string, topK: number = 3): Promise<MatchResult[]> {
    // 延迟初始化：模型可能在构造之后才下载完成
    if (!this.embedder) {
      this.embedder = await tryCreateEmbedder();
    }

    const agents = this.getTargetAgents();

    if (!this.embedder) return [];

    const messageVec = await this.safeEmbed(message);
    if (!messageVec) return [];

    // Scene 向量：关键词 + 描述
    let sceneVecs: Map<string, number[] | null> | null = null;
    if (this.sceneList.length > 0) {
      sceneVecs = new Map();
      const sceneTexts = this.sceneList.map((s) =>
        [s.keywords || '', s.description || ''].join(' '),
      );
      const results = await Promise.all(sceneTexts.map((t) => this.safeEmbed(t)));
      this.sceneList.forEach((s, i) => sceneVecs!.set(s.scene, results[i]));
    }

    // 无 agent → 仅做场景匹配，返回 scene + complexity（不含 agentId）
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

    // Agent 向量：能力 + 名字
    const agentVecs = new Map<string, number[] | null>();
    if (this.embedder) {
      const agentTexts = agents.map((a) => this.buildAgentMatchText(a));
      const results = await Promise.all(agentTexts.map((t) => this.safeEmbed(t)));
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

  private async safeEmbed(text: string): Promise<number[] | null> {
    if (!this.embedder) return null;
    try {
      return await this.embedder.embed(text);
    } catch (err) {
      log.warn(`Embedding failed: ${(err as Error).message}`);
      return null;
    }
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

  /** 语义匹配场景，返回按相似度排序的结果 */
  async matchScenes(message: string, topK: number = 5): Promise<Array<{ scene: string; score: number; description?: string }>> {
    if (!this.embedder) {
      this.embedder = await tryCreateEmbedder();
    }
    if (!this.embedder || this.sceneList.length === 0) return [];

    const messageVec = await this.safeEmbed(message);
    if (!messageVec) return [];

    const results: Array<{ scene: string; score: number; description?: string }> = [];
    for (const s of this.sceneList) {
      const sceneText = [s.keywords || '', s.description || ''].join(' ');
      const vec = await this.safeEmbed(sceneText);
      if (!vec) continue;
      const sim = this.embedder.cosineSimilarity(messageVec, vec);
      if (sim > 0.2) {
        results.push({ scene: s.scene, score: sim, description: s.description });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  getSceneList(): SceneInfo[] {
    return this.sceneList;
  }

  /** 匹配最佳 scene，返回 top 3 相似度 > 0.3 的场景，逗号分隔 */
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

  private scoreAgent(
    agent: ConfigurableAgentConfig,
    messageVec: number[] | null,
    agentVec: number[] | null,
    sceneVecs?: Map<string, number[] | null> | null,
  ): MatchResult {
    // 有向量模型：纯语义向量匹配，不用 bigram keyword/capability
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

    // 无向量模型：不会走到这里（IntentRouter 在 L2 入口已跳过），保留仅作防御
    return { agentId: agent.id, score: 0, reason: '' };
  }

}
