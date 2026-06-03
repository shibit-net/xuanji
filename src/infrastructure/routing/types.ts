/**
 * 路由相关类型定义
 */

export interface ClassifyResult {
  scene: string;
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

/** 意图分析结果：只包含 scene + complexity，不含 agent 路由 */
export interface SceneAnalysis {
  /** L1: 逗号分隔多 scene，经 SceneClassifier.validateScene() 校验均真实存在；L2/L3: '' 表示无场景信息 */
  scene: string;
  /** 'simple' | 'complex' */
  complexity: 'simple' | 'complex';
  confidence: number;
  method: 'llm' | 'embedding' | 'default';
  /** L1 使用的模型名称 */
  modelName?: string;
  reason?: string;
}

/** 路由进度回调参数 */
export interface RouteProgress {
  level: 'L1' | 'L2' | 'L3';
  status: 'start' | 'done';
  method: 'llm' | 'embedding' | 'default';
  durationMs: number;
  success: boolean;
  scene?: string;
  complexity?: 'simple' | 'complex';
  confidence?: number;
  matchCount?: number;
  reason?: string;
  modelName?: string;
}
