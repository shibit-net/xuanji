/**
 * 路由相关类型定义
 */

export interface ClassifyResult {
  scene: string;
  agent: string;
  complexity: 'simple' | 'complex';
  confidence: number;
  modelName?: string;
}

export interface MatchResult {
  agentId: string;
  score: number;
  reason: string;
  scene?: string;
  complexity?: 'simple' | 'complex';
}

export interface IntentRoute {
  agentId: string;
  confidence: number;
  method: 'llm' | 'embedding' | 'default';
  /** L1: 逗号分隔多 scene（如 'coding,debugging'），经 SceneClassifier.validateScene() 校验均真实存在；L2/L3: '' 表示无场景信息 */
  scene?: string;
  /** 'simple' | 'complex'。L2/L3 统一为 'simple' */
  complexity?: 'simple' | 'complex';
  reason?: string;
  /** L1 使用的模型名称 */
  modelName?: string;
}

/** 路由进度回调参数 */
export interface RouteProgress {
  level: 'L1' | 'L2' | 'L3';
  status: 'start' | 'done';
  method: 'llm' | 'embedding' | 'default';
  durationMs: number;
  success: boolean;
  agentId?: string;
  scene?: string;
  complexity?: 'simple' | 'complex';
  confidence?: number;
  matchCount?: number;
  topMatch?: string;
  reason?: string;
  modelName?: string;
}
