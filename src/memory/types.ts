// ============================================================
// M4 记忆系统 — 类型定义
// ============================================================

/** 记忆条目类型 */
export type MemoryEntryType =
  // P0 已有
  | 'session_summary'
  | 'decision'
  | 'tool_pattern'
  | 'error_resolution'
  | 'user_preference'
  | 'project_fact'
  // Phase 2 新增：生活场景记忆类型
  | 'user_fact'        // 用户事实（职业/居住地/家庭）
  | 'relationship'     // 人际关系（联系人/喜好/互动）
  | 'important_date'   // 重要日期（生日/纪念日/截止日）
  // Multi-Agent 新增：Agent 专属知识库
  | 'agent_knowledge'; // Agent 知识库条目

/** 记忆条目元数据（用于结构化信息） */
export interface MemoryMetadata {
  /** 对于 important_date 类型：日期值 (ISO 格式: "2026-03-15") */
  dateValue?: string;
  /** 日期类型 */
  dateType?: 'deadline' | 'birthday' | 'anniversary' | 'reminder';
  /** 是否循环 */
  recurring?: 'yearly' | 'monthly' | 'none';
  /** 关联人物 */
  relatedPerson?: string;
  /** 对于 agent_knowledge 类型：数据源路径 */
  source?: string;
  /** 对于 agent_knowledge 类型：数据源类型 */
  sourceType?: 'csv' | 'json' | 'markdown';
}

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
  /** 结构化元数据（可选，用于时效性记忆等特殊处理） */
  metadata?: MemoryMetadata;
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
  getStats(): Promise<{ total: number; byType: Record<string, number> }>;
  /** 添加单条记忆条目（用于 Agent 知识库等场景） */
  add?(entry: Partial<MemoryEntry>): Promise<void>;
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
  // Phase 2 新增：智能记忆提取器配置
  /** 提取器使用的模型（null 表示使用主模型） */
  extractorModel?: string | null;
  /** 提取器温度（默认 0.3） */
  extractorTemperature?: number;
  /** 提取器超时（默认 60000ms） */
  extractorTimeout?: number;
  /** 最小置信度阈值（默认 0.6） */
  extractorMinConfidence?: number;
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
  // Phase 2 智能提取器默认配置
  extractorModel: null, // null 表示使用主模型
  extractorTemperature: 0.3,
  extractorTimeout: 60_000,
  extractorMinConfidence: 0.6,
};
