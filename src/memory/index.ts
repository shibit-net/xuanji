// ============================================================
// M4 记忆系统 — 模块导出
// ============================================================

// 类型
export type {
  MemoryEntry,
  MemoryEntryType,
  SessionMemory,
  ToolCallRecord,
  RetrieveOptions,
  IMemoryStore,
  MemoryConfig,
} from './types';
export { DEFAULT_MEMORY_CONFIG } from './types';

// 核心模块
export { StorageBackend } from './StorageBackend';
export { ShortTermMemory } from './ShortTermMemory';
export { LongTermMemory } from './LongTermMemory';
export { ProjectKnowledge } from './ProjectKnowledge';
export { MemoryRetriever } from './MemoryRetriever';
export { MemoryCompactor } from './MemoryCompactor';
export { MemoryManager } from './MemoryManager';
