/**
 * Intent System - 意图识别类型
 *
 * 注意：意图分类器已移除（IntentClassifier / ModelClassifier / VectorMatcher / LLMIntentClassifier）。
 * 保留 types.ts 因 skills/types.ts 等模块引用其中的类型定义。
 */

export type { IntentDomain, IntentMetadata, IntentResult as OldIntentResult } from './types';
