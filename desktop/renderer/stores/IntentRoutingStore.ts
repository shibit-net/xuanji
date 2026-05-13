/**
 * IntentRoutingStore — 意图路由生命周期管理。
 *
 * 遵循 transition(event) 模式，追踪三级路由的完整过程：
 *   L1: LLM 意图分析 (SceneClassifier)
 *   L2: keyword + capability 匹配 (EmbeddingMatcher)
 *   L3: xuanji 兜底
 *
 * IPC 事件驱动：
 *   agent:intent-route:start    → ROUTE_START（同时清除上一轮结果）
 *   agent:intent-route:progress → ROUTE_STAGE
 *   agent:intent-route          → ROUTE_COMPLETE
 * 结果持续展示直到下一轮 ROUTE_START 自动清除。
 */

import { create } from 'zustand';

export type RouteStatus = 'idle' | 'analyzing' | 'done';

export interface StageResult {
  level: 'L1' | 'L2' | 'L3';
  method: 'llm' | 'embedding' | 'default';
  status: 'running' | 'success' | 'skipped';
  durationMs: number;
  summary: string;
  scene?: string;
  agentId?: string;
  complexity?: 'simple' | 'complex';
  confidence?: number;
  modelName?: string;
}

export interface RouteResult {
  agentId: string;
  confidence: number;
  method: 'llm' | 'embedding' | 'default';
  scene?: string;
  complexity?: string;
  reason?: string;
  modelName?: string;
}

export interface ScenePromptInfo {
  scene: string;
  description: string;
  keywords: string;
}

export type RouteEvent =
  | { type: 'ROUTE_START' }
  | { type: 'ROUTE_STAGE'; stage: StageResult }
  | { type: 'ROUTE_COMPLETE'; result: RouteResult }
  | { type: 'ROUTE_RESET' }
  | { type: 'SET_SCENE_PROMPTS'; scenes: ScenePromptInfo[] };

interface IntentRoutingState {
  status: RouteStatus;
  stages: StageResult[];
  result: RouteResult | null;
  scenePrompts: ScenePromptInfo[];

  transition: (event: RouteEvent) => void;
}

const METHOD_LABELS: Record<string, string> = {
  llm: 'LLM 意图分析',
  embedding: '向量匹配',
  default: '默认路由',
};

function buildSummary(
  level: 'L1' | 'L2' | 'L3',
  method: 'llm' | 'embedding' | 'default',
  scene?: string,
  agentId?: string,
  matchCount?: number,
): string {
  const label = METHOD_LABELS[method] || method;
  if (level === 'L1' && scene && agentId) {
    return `${label} → scene=${scene}, agent=${agentId}`;
  }
  if (level === 'L2' && agentId) {
    const extra = matchCount && matchCount > 1 ? ` (共 ${matchCount} 个匹配)` : '';
    return `${label} → ${agentId}${extra}`;
  }
  return label;
}

export const useIntentRoutingStore = create<IntentRoutingState>((set, get) => ({
  status: 'idle',
  stages: [],
  result: null,
  scenePrompts: [],

  transition: (event) => {
    switch (event.type) {
      case 'ROUTE_START':
        set({ status: 'analyzing', stages: [], result: null });
        break;

      case 'ROUTE_STAGE':
        set((s) => ({ stages: [...s.stages, event.stage] }));
        break;

      case 'ROUTE_COMPLETE':
        set({ status: 'done', result: event.result });
        break;

      case 'ROUTE_RESET':
        set({ status: 'idle', stages: [], result: null });
        break;

      case 'SET_SCENE_PROMPTS':
        set({ scenePrompts: event.scenes });
        break;
    }
  },
}));

/** 构建 StageResult 的工厂函数 */
export function makeStage(params: {
  level: 'L1' | 'L2' | 'L3';
  method: 'llm' | 'embedding' | 'default';
  status: 'running' | 'success' | 'skipped';
  durationMs: number;
  scene?: string;
  agentId?: string;
  complexity?: 'simple' | 'complex';
  confidence?: number;
  matchCount?: number;
  modelName?: string;
}): StageResult {
  return {
    level: params.level,
    method: params.method,
    status: params.status,
    durationMs: params.durationMs,
    summary: buildSummary(params.level, params.method, params.scene, params.agentId, params.matchCount),
    scene: params.scene,
    agentId: params.agentId,
    complexity: params.complexity,
    confidence: params.confidence,
    modelName: params.modelName,
  };
}
