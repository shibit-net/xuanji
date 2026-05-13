/**
 * IntentRouter — 三级意图路由。
 *
 * L1: LLM 意图分析 (SceneClassifier)
 * L2: keyword + capability 匹配 (EmbeddingMatcher)
 * L3: xuanji 兜底
 */

import { SceneClassifier } from './SceneClassifier';
import { EmbeddingMatcher } from './EmbeddingMatcher';
import type { EmbeddingProviderInterface } from '@/core/embedding/EmbeddingProvider';
import type { AgentRegistry } from '@/core/agent/AgentRegistry';
import type { IntentRoute, RouteProgress } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'IntentRouter' });

export type { IntentRoute } from './types';

export class IntentRouter {
  private sceneClassifier: SceneClassifier;
  private embeddingMatcher: EmbeddingMatcher;
  private agentRegistry: AgentRegistry;
  readonly defaultAgentId = 'xuanji';

  constructor(deps: {
    sceneClassifier: SceneClassifier;
    embeddingMatcher: EmbeddingMatcher;
    agentRegistry: AgentRegistry;
    embedder?: EmbeddingProviderInterface | null;
  }) {
    this.sceneClassifier = deps.sceneClassifier;
    this.embeddingMatcher = deps.embeddingMatcher;
    this.agentRegistry = deps.agentRegistry;
  }

  async route(message: string, onProgress?: (progress: RouteProgress) => void): Promise<IntentRoute> {
    // L1: LLM 意图分析
    const l1Start = Date.now();
    const l1ModelName = this.sceneClassifier.getModelName();
    onProgress?.({ level: 'L1', status: 'start', method: 'llm', durationMs: 0, success: false, modelName: l1ModelName });
    try {
      const result = await this.sceneClassifier.classify(message);
      const l1Duration = Date.now() - l1Start;
      if (result) {
        // 校验 agent 存在
        if (this.agentRegistry.get(result.agent)) {
          onProgress?.({
            level: 'L1', status: 'done', method: 'llm', durationMs: l1Duration, success: true,
            agentId: result.agent, scene: result.scene, complexity: result.complexity, confidence: result.confidence,
            modelName: result.modelName,
          });
          return {
            agentId: result.agent,
            confidence: result.confidence,
            method: 'llm',
            scene: result.scene,
            complexity: result.complexity,
            modelName: result.modelName,
          };
        }

        onProgress?.({
          level: 'L1', status: 'done', method: 'llm', durationMs: l1Duration, success: false,
          agentId: result.agent, scene: result.scene, reason: `Agent "${result.agent}" 不存在`,
          modelName: result.modelName,
        });
        log.debug(`L1 agent "${result.agent}" not found, falling back to L2`);
      } else {
        onProgress?.({
          level: 'L1', status: 'done', method: 'llm', durationMs: l1Duration, success: false,
          reason: 'LLM 未返回有效结果',
          modelName: l1ModelName,
        });
      }
    } catch (err) {
      const l1Duration = Date.now() - l1Start;
      onProgress?.({
        level: 'L1', status: 'done', method: 'llm', durationMs: l1Duration, success: false,
        reason: err instanceof Error ? err.message : 'LLM 调用异常',
        modelName: l1ModelName,
      });
      log.warn('L1 intent classification failed, falling back to L2:', err);
    }

    // L2: 语义向量匹配（无 embedding 模型时直接降级 L3）
    if (!this.embeddingMatcher.hasEmbedder) {
      onProgress?.({
        level: 'L2', status: 'done', method: 'embedding', durationMs: 0, success: false,
        reason: '向量模型未安装，跳过语义匹配',
      });
    } else {
      const l2Start = Date.now();
      onProgress?.({ level: 'L2', status: 'start', method: 'embedding', durationMs: 0, success: false });
      try {
        const matches = await this.embeddingMatcher.match(message);
        const l2Duration = Date.now() - l2Start;
        if (matches.length > 0 && matches[0].score >= 0.35) {
          const topMatch = matches[0];
          if (this.agentRegistry.get(topMatch.agentId)) {
            onProgress?.({
              level: 'L2', status: 'done', method: 'embedding', durationMs: l2Duration, success: true,
              agentId: topMatch.agentId, confidence: topMatch.score, matchCount: matches.length,
              topMatch: topMatch.agentId, reason: topMatch.reason,
              scene: topMatch.scene, complexity: topMatch.complexity,
            });
            return {
              agentId: topMatch.agentId,
              confidence: topMatch.score,
              method: 'embedding',
              scene: topMatch.scene || '',
              complexity: topMatch.complexity || 'simple',
              reason: topMatch.reason,
            };
          }
        }
        onProgress?.({
          level: 'L2', status: 'done', method: 'embedding', durationMs: l2Duration, success: false,
          matchCount: matches.length, reason: matches.length > 0 ? '最高分低于阈值' : '无匹配结果',
        });
      } catch (err) {
        const l2Duration = Date.now() - l2Start;
        onProgress?.({
          level: 'L2', status: 'done', method: 'embedding', durationMs: l2Duration, success: false,
          reason: err instanceof Error ? err.message : '关键词匹配异常',
        });
        log.warn('L2 embedding match failed, falling back to default:', err);
      }
    }

    // L3: xuanji 兜底
    onProgress?.({
      level: 'L3', status: 'start', method: 'default', durationMs: 0, success: false,
    });
    onProgress?.({
      level: 'L3', status: 'done', method: 'default', durationMs: 0, success: true,
      agentId: this.defaultAgentId, confidence: 1.0, reason: '默认路由',
    });
    return {
      agentId: this.defaultAgentId,
      confidence: 1.0,
      method: 'default',
      scene: '',
      complexity: 'complex',
      reason: '默认路由',
    };
  }
}
