/**
 * EmbeddingMatcher — 纯语义向量 Agent + Scene 匹配。
 *
 * - Agent: 用能力 + 名字做向量匹配
 * - Scene: 用关键词 + 描述做向量匹配
 * - 无向量时返回 score=0，由 IntentRouter 在 L2 入口跳过直接降级 L3
 */

import type { AgentRegistry } from '@/core/agent/AgentRegistry';
import type { ConfigurableAgentConfig } from '@/core/agent/types';
import type { EmbeddingProviderInterface } from '@/core/embedding/EmbeddingProvider';
import type { MatchResult } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'EmbeddingMatcher' });

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

  setSceneList(scenes: SceneInfo[]): void {
    this.sceneList = scenes;
  }

  async match(message: string, topK: number = 3): Promise<MatchResult[]> {
    const agents = this.getTargetAgents();
    if (agents.length === 0) {
      log.debug('No target agents available for matching');
      return [];
    }

    const messageVec = this.embedder ? await this.safeEmbed(message) : null;

    // Agent 向量：能力 + 名字
    const agentVecs = new Map<string, number[] | null>();
    if (messageVec && this.embedder) {
      const agentTexts = agents.map((a) =>
        [a.name, ...(a.capabilities || [])].join(' '),
      );
      const results = await Promise.all(agentTexts.map((t) => this.safeEmbed(t)));
      agents.forEach((a, i) => agentVecs.set(a.id, results[i]));
    }

    // Scene 向量：关键词 + 描述
    let sceneVecs: Map<string, number[] | null> | null = null;
    if (messageVec && this.embedder && this.sceneList.length > 0) {
      sceneVecs = new Map();
      const sceneTexts = this.sceneList.map((s) =>
        [s.keywords || '', s.description || ''].join(' '),
      );
      const results = await Promise.all(sceneTexts.map((t) => this.safeEmbed(t)));
      this.sceneList.forEach((s, i) => sceneVecs!.set(s.scene, results[i]));
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
