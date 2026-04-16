// ============================================================
// M5 记忆系统 — 模块导出
// ============================================================

// 类型
export type {
  MemoryEntry,
  MemoryEntryType,
  MemoryScope,
  MemoryVolatility,
  SessionMemory,
  ToolCallRecord,
  RetrieveOptions,
  IMemoryStore,
  IMemoryDirectStore,
  MemoryConfig,
  DecisionContext,
  CoreRule,
} from './types';
export { DEFAULT_MEMORY_CONFIG } from './types';

// 核心模块
export { MemoryStore } from './MemoryStore';
export { MemoryManager } from './MemoryManager';
export { MemoryExtractor } from './MemoryExtractor';
export { MemoryRetriever } from './MemoryRetriever';
export { ShortTermMemory } from './ShortTermMemory';
export { MemoryFormatter } from './MemoryFormatter';
export { MemoryWeightEngine } from './MemoryWeightEngine';
export { CoreRuleStore } from './CoreRuleStore';
export type { ExtractionResult } from './MemoryExtractor';
