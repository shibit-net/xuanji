/**
 * IntentRouter — 意图分析（scene + complexity）。
 *
 * L1: LLM 意图分析 (SceneClassifier)
 * L2: 语义向量匹配 (EmbeddingMatcher)
 * L3: 默认兜底
 *
 * 注意：IntentRouter 不再负责 agent 路由，agent 由用户通过输入框 @ 选择器指定。
 */

import { SceneClassifier } from './SceneClassifier';
import { EmbeddingMatcher } from './EmbeddingMatcher';
import type { EmbeddingProviderInterface } from '@/core/embedding/EmbeddingProvider';
import type { AgentRegistry } from '@/agent/AgentRegistry';
import type { SceneAnalysis, RouteProgress } from './types';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'IntentRouter' });

export type { SceneAnalysis } from './types';

export class IntentRouter {
  private sceneClassifier: SceneClassifier;
  private embeddingMatcher: EmbeddingMatcher;
  private agentRegistry: AgentRegistry;

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

  /** 分析用户消息，返回 scene + complexity（不再返回 agent） */
  async analyze(message: string, onProgress?: (progress: RouteProgress) => void): Promise<SceneAnalysis> {
    // L1: LLM 意图分析
    const l1Start = Date.now();
    const l1ModelName = this.sceneClassifier.getModelName();
    onProgress?.({ level: 'L1', status: 'start', method: 'llm', durationMs: 0, success: false, modelName: l1ModelName });
    try {
      const result = await this.sceneClassifier.classify(message);
      const l1Duration = Date.now() - l1Start;
      if (result) {
        onProgress?.({
          level: 'L1', status: 'done', method: 'llm', durationMs: l1Duration, success: true,
          scene: result.scene, complexity: result.complexity, confidence: result.confidence,
          modelName: result.modelName,
        });
        return {
          scene: result.scene,
          complexity: result.complexity,
          confidence: result.confidence,
          method: 'llm',
          modelName: result.modelName,
        };
      }

      onProgress?.({
        level: 'L1', status: 'done', method: 'llm', durationMs: l1Duration, success: false,
        reason: 'LLM 未返回有效结果',
        modelName: l1ModelName,
      });
    } catch (err) {
      const l1Duration = Date.now() - l1Start;
      onProgress?.({
        level: 'L1', status: 'done', method: 'llm', durationMs: l1Duration, success: false,
        reason: err instanceof Error ? err.message : 'LLM 调用异常',
        modelName: l1ModelName,
      });
      log.warn('L1 intent analysis failed, falling back to L2:', err);
    }

    // L2: 语义向量匹配 scene（EmbeddingMatcher 内部会延迟初始化 embedder）
    const l2Start = Date.now();
    const l2ModelName = this.embeddingMatcher.getEmbedderModelName();
    onProgress?.({ level: 'L2', status: 'start', method: 'embedding', durationMs: 0, success: false, modelName: l2ModelName ?? undefined });
    try {
      const matches = await this.embeddingMatcher.match(message);
      const l2Duration = Date.now() - l2Start;
      if (matches.length > 0 && matches[0].score >= 0.35) {
        const topMatch = matches[0];
        onProgress?.({
          level: 'L2', status: 'done', method: 'embedding', durationMs: l2Duration, success: true,
          scene: topMatch.scene, complexity: topMatch.complexity, confidence: topMatch.score,
          matchCount: matches.length, reason: topMatch.reason,
          modelName: l2ModelName ?? undefined,
        });
        return {
          scene: topMatch.scene || '',
          complexity: topMatch.complexity || 'complex',
          confidence: topMatch.score,
          method: 'embedding',
          reason: topMatch.reason,
          modelName: l2ModelName ?? undefined,
        };
      }
      onProgress?.({
        level: 'L2', status: 'done', method: 'embedding', durationMs: l2Duration, success: false,
        matchCount: matches.length, reason: matches.length > 0 ? '最高分低于阈值' : '无匹配结果',
        modelName: l2ModelName ?? undefined,
      });
    } catch (err) {
      const l2Duration = Date.now() - l2Start;
      onProgress?.({
        level: 'L2', status: 'done', method: 'embedding', durationMs: l2Duration, success: false,
        reason: err instanceof Error ? err.message : '语义匹配异常',
        modelName: l2ModelName ?? undefined,
      });
      log.warn('L2 embedding match failed, falling back to default:', err);
    }

    // L3: 默认兜底
    onProgress?.({
      level: 'L3', status: 'start', method: 'default', durationMs: 0, success: false,
    });
    onProgress?.({
      level: 'L3', status: 'done', method: 'default', durationMs: 0, success: true,
      complexity: 'complex', reason: '默认分析',
    });
    return {
      scene: '',
      complexity: 'complex',
      confidence: 1.0,
      method: 'default',
      reason: '默认分析',
    };
  }
}
