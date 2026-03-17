/**
 * ============================================================
 * System Prompt 模块 — 导出
 * ============================================================
 */

// 新架构
export { LayeredPromptBuilder } from './LayeredPromptBuilder';
export { IntentAnalyzer } from './IntentAnalyzer';

// 类型
export type {
  PromptComponent,
  PromptLayer,
  IntentComplexity,
  IntentAnalysis,
  PromptBuildResult,
  LayeredPromptBuildOptions,
  SceneType,
  PromptBuildContext,
  SceneMatchConfig,
} from './types';

// 旧架构（过渡期保留，供未迁移的代码使用）
export { SystemPromptBuilder } from './SystemPromptBuilder';
export { SceneMatcher } from './SceneMatcher';
export type { SceneMatchResult } from './SceneMatcher';
export type {
  PromptBlock,
  SceneTemplate,
  PromptBuildOptions,
} from './types';
