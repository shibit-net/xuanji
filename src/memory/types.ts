// ============================================================
// M4 记忆系统 — 类型定义
// ============================================================

/** 记忆条目类型 */
export type MemoryEntryType =
  | 'session_summary'
  | 'decision'
  | 'tool_pattern'
  | 'error_resolution'
  | 'user_preference'
  | 'project_fact';

/** 单条记忆条目 */
export interface MemoryEntry {
  id: string;
  type: MemoryEntryType;
  content: string;
  keywords: string[];
  source: string;
  confidence: number;
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
  projectPath?: string;
}

/** 工具调用记录 */
export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  isError: boolean;
  resultSummary: string;
}

/** 会话记忆 */
export interface SessionMemory {
  sessionId: string;
  startTime: string;
  endTime?: string;
  userMessages: string[];
  assistantHighlights: string[];
  toolCalls: ToolCallRecord[];
  durationMs?: number;
  model: string;
}

/** 检索选项 */
export interface RetrieveOptions {
  maxResults?: number;
  minConfidence?: number;
  types?: MemoryEntryType[];
  scope?: 'global' | 'project' | 'all';
}

/** 记忆存储接口 */
export interface IMemoryStore {
  init(): Promise<void>;
  save(session: SessionMemory): Promise<void>;
  retrieve(query: string, options?: RetrieveOptions): Promise<MemoryEntry[]>;
  compact(): Promise<void>;
}

/** 记忆配置 */
export interface MemoryConfig {
  enabled: boolean;
  shortTermMaxEntries: number;
  longTermMaxEntries: number;
  retrieveMaxResults: number;
  maxEntryLength: number;
  maxPromptLength: number;
  compactionThreshold: number;
  decayHalfLifeDays: number;
}

/** 默认记忆配置 */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true,
  shortTermMaxEntries: 100,
  longTermMaxEntries: 1000,
  retrieveMaxResults: 10,
  maxEntryLength: 500,
  maxPromptLength: 5000,
  compactionThreshold: 500,
  decayHalfLifeDays: 30,
};
