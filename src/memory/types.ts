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

/** 记忆分类（OpenClaw 启发） */
export type MemoryCategory = 'timeline' | 'topic' | 'fact';

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
  /** 记忆重要性等级（影响遗忘曲线） */
  importance?: 'high' | 'medium' | 'low';
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

  // ═══ OpenClaw 启发的新字段 ═══

  /** 记忆分类（timeline: 时间线记录, topic: 主题知识, fact: 用户事实） */
  category?: MemoryCategory;

  /** 所属主题 ID（用于主题聚合，如 "user-preferences", "project-xuanji"） */
  topicId?: string;

  /** 日期键（格式: "2026-03-16"，用于按日分组时间线记忆） */
  dayKey?: string;

  /** 所属会话 ID（用于追溯记忆来源） */
  sessionId?: string;

  /** 关联记忆 ID 列表（相关记忆的引用） */
  relatedMemories?: string[];

  /** 提取来源记忆 ID（记录从哪条 timeline 记忆提取而来） */
  extractedFrom?: string;

  /** 被替代记忆 ID（记录被哪条新记忆替代，用于知识更新） */
  supersededBy?: string;
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

  // Phase 4 新增：智能记忆刷新配置（OpenClaw 启发）
  /** 智能刷新配置 */
  intelligentFlush?: {
    /** 是否启用智能刷新（默认 true） */
    enabled?: boolean;
    /** Token 阈值（0-1，默认 0.75） */
    tokenThreshold?: number;
    /** 时间阈值（毫秒，默认 1800000 = 30 分钟） */
    timeThreshold?: number;
    /** 价值评分阈值（0-100，默认 50） */
    valueThreshold?: number;
    /** 保留最近 N 条消息（默认 5） */
    keepRecentMessages?: number;
  };

  // Phase 3 新增：主题提取配置（OpenClaw 启发）
  /** 主题提取配置 */
  topicExtraction?: {
    /** 是否启用主题提取（默认 true） */
    enabled?: boolean;
    /** 自动触发时机（默认 "session-end"） */
    autoTrigger?: 'session-end' | 'daily' | 'manual';
    /** 主题合并相似度阈值（默认 0.85） */
    mergeThreshold?: number;
    /** 最小提取条目数（默认 2） */
    minEntriesForExtraction?: number;
  };

  // Phase 2 新增：记忆格式化配置（OpenClaw 风格）
  /** 记忆格式化配置 */
  formatting?: {
    /** 格式化风格（默认 "openclaw"） */
    style?: 'openclaw' | 'simple';
    /** 是否显示访问次数（默认 true） */
    showAccessCount?: boolean;
    /** 是否显示关联记忆（默认 true） */
    showRelatedMemories?: boolean;
    /** 最多显示最近 N 条时间线（默认 10） */
    maxTimelineItems?: number;
  };

  // Phase 5 新增：Token 估算配置
  /** Token 估算配置 */
  tokenEstimation?: {
    /** 估算方法（默认 "simple"） */
    method?: 'simple' | 'tiktoken';
    /** 字符数/Token 比例（默认 3，用于 simple 方法） */
    charsPerToken?: number;
  };
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
  // Phase 4 智能刷新默认配置（OpenClaw 启发）
  intelligentFlush: {
    enabled: true,
    tokenThreshold: 0.75,
    timeThreshold: 30 * 60 * 1000, // 30 分钟
    valueThreshold: 50,
    keepRecentMessages: 5,
  },
  // Phase 3 主题提取默认配置（OpenClaw 启发）
  topicExtraction: {
    enabled: true,
    autoTrigger: 'session-end',
    mergeThreshold: 0.85,
    minEntriesForExtraction: 2,
  },
  // Phase 2 记忆格式化默认配置（OpenClaw 风格）
  formatting: {
    style: 'openclaw',
    showAccessCount: true,
    showRelatedMemories: true,
    maxTimelineItems: 10,
  },
  // Phase 5 Token 估算默认配置
  tokenEstimation: {
    method: 'simple',
    charsPerToken: 3,
  },
};
