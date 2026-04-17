// ============================================================
// M5 人类记忆系统 — 类型定义
// ============================================================
// 架构：核心规则层 / 情节记忆层 / 语义记忆层 / 决策辅助层
// LLM 自主决策分类、权重、时效性；系统负责存储、衰减、检索
// ============================================================

// ═══════════════════════════════════════════════════════════
// 核心规则层（不可违反，永久存储，始终注入 Prompt）
// ═══════════════════════════════════════════════════════════

/** 核心规则条目 — 用户定义的底线，不参与衰减，不被 LLM 自动修改 */
export interface CoreRule {
  id: string;
  rule: string;
  description?: string;
  category: 'behavior' | 'privacy' | 'communication' | 'ethics' | 'task' | 'custom';
  createdAt: string;
  updatedAt: string;
  active: boolean;
  source: 'user_explicit' | 'inferred' | 'llm_extracted';
}

// ═══════════════════════════════════════════════════════════
// 记忆层级（LLM 自主决定每条记忆属于哪层）
// ═══════════════════════════════════════════════════════════

/**
 * 记忆层级
 * - core_rule: 用户底线，永不衰减（由 CoreRuleStore 单独管理）
 * - profile:   关于用户本身的事实，极慢衰减（半衰期 180-365 天）
 * - knowledge: 经验教训、领域知识，慢衰减（半衰期 90-180 天）
 * - episode:   具体事件、会话摘要，正常衰减（半衰期 14-60 天）
 */
export type MemoryScope = 'core_rule' | 'profile' | 'knowledge' | 'episode';

/**
 * 记忆时效性（LLM 评估，影响半衰期）
 * - permanent:  永不衰减（重要日期、核心规则）
 * - stable:     极慢衰减（用户基本信息、长期偏好）
 * - normal:     正常衰减（技术决策、经验教训）
 * - transient:  快速衰减（会话摘要、临时任务）
 */
export type MemoryVolatility = 'permanent' | 'stable' | 'normal' | 'transient';

/**
 * 约束强度（3.0 新增）
 */
export type MemoryConstraint = 'must' | 'should' | 'may';

/**
 * 记忆来源（3.0 新增）
 */
export type MemoryOrigin = 'user_explicit' | 'auto_extracted' | 'dream_generated';

/**
 * 记忆主体（3.0 新增）
 */
export type MemorySubject = 'user' | 'project' | 'task' | 'system';

/**
 * 记忆性质（3.0 新增）
 */
export type MemoryNature = 'fact' | 'preference' | 'pattern' | 'lesson' | 'rule';

// ═══════════════════════════════════════════════════════════
// 记忆条目（半结构化，category 为 LLM 自由文本）
// ═══════════════════════════════════════════════════════════

/** 记忆条目类型（保留用于向后兼容和规则降级） */
export type MemoryEntryType =
  | 'session_summary'
  | 'decision'
  | 'tool_pattern'
  | 'error_resolution'
  | 'user_preference'
  | 'project_fact'
  | 'user_fact'
  | 'relationship'
  | 'important_date'
  | 'agent_knowledge'
  | 'lesson_learned'
  | 'reusable_pattern'
  | 'domain_knowledge'   // 新增：从多次情节提炼的领域知识
  | 'unfinished_task';

/** 记忆分类（OpenClaw 启发，用于格式化分组） */
export type MemoryCategory = 'timeline' | 'topic' | 'fact' | 'lesson';

// ═══════════════════════════════════════════════════════════
// 决策辅助层（每次对话前动态组装，辅助 LLM 判断）
// ═══════════════════════════════════════════════════════════

/** 决策上下文 — 检索后动态组装，注入 Prompt 辅助 LLM 判断 */
export interface DecisionContext {
  /** 当前激活的核心规则（始终注入，优先级最高） */
  activeRules: CoreRule[];
  /** 相关用户画像摘要（profile 层检索结果） */
  profileSummary?: string;
  /** 相关经验教训（knowledge 层，与当前任务相关） */
  relevantLessons: MemoryEntry[];
  /** 相关历史决策（knowledge/episode 层） */
  relevantDecisions: MemoryEntry[];
  /** 未完成任务提醒 */
  pendingTasks: MemoryEntry[];
}

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
/** 单条记忆条目（半结构化：category 为 LLM 自由文本，不枚举） */
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

  // ═══ M5 新增：LLM 自主决策字段 ═══

  /**
   * 记忆层级（LLM 决定）
   * profile > knowledge > episode，影响衰减速度和检索优先级
   */
  scope?: MemoryScope;

  /**
   * 记忆时效性（LLM 评估）
   * 决定半衰期：permanent=∞, stable=365d, normal=60d, transient=14d
   */
  volatility?: MemoryVolatility;

  /**
   * LLM 自定义分类标签（自由文本，不枚举）
   * 例如："用户/家庭关系"、"项目偏好/代码风格"、"经验教训/错误模式"
   */
  categoryLabel?: string;

  /**
   * 重要性评分（LLM 评估，[0-1]）
   * 影响权重计算和压缩时的保留优先级
   */
  significance?: number;

  /**
   * 动态权重（系统计算：significance × 时间衰减 + 访问加成）
   * 由 MemoryWeightEngine 维护，不由 LLM 直接设置
   */
  weight?: number;

  // ═══ 增强分类字段 ═══

  /**
   * 约束强度（must=必须遵守, should=强烈建议, may=可参考）
   */
  constraint?: MemoryConstraint;

  /**
   * 记忆来源（user_explicit=用户明确要求, auto_extracted=自动提取）
   */
  memoryOrigin?: MemoryOrigin;

  /**
   * 记忆主体（user=用户相关, project=项目相关, task=任务相关）
   */
  memorySubject?: MemorySubject;

  /**
   * 记忆性质（fact=事实, preference=偏好, rule=规则, suggestion=建议）
   */
  memoryNature?: MemoryNature;

  /**
   * 是否用户明确要求记住
   */
  isUserExplicit?: boolean;

  /**
   * 是否核心规则（必须严格遵守）
   */
  isCoreRule?: boolean;

  // ═══ OpenClaw 兼容字段（保留用于格式化分组） ═══

  /** 记忆分类（timeline/topic/fact/lesson，用于格式化输出分组） */
  category?: MemoryCategory;

  /** 所属主题 ID */
  topicId?: string;

  /** 日期键（格式: "2026-03-16"） */
  dayKey?: string;

  /** 所属会话 ID */
  sessionId?: string;

  /** 关联记忆 ID 列表 */
  relatedMemories?: string[];

  /** 提取来源记忆 ID */
  extractedFrom?: string;

  /** 被替代记忆 ID */
  supersededBy?: string;

  /** 是否已废弃 */
  obsolete?: boolean;

  // ═══ 任务字段 ═══

  dismissed?: boolean;

  taskContext?: {
    userInput?: string;
    completedSteps?: string[];
    remainingSteps?: string[];
  };

  // ═══ 经验教训字段 ═══

  lessonType?: 'mistake' | 'improvement' | 'best_practice';
  problemDescription?: string;
  solution?: string;
  applicableScenarios?: string[];

  // ═══ 决策点记忆系统字段（3.0 新增） ═══

  /** 使用场景标签（LLM动态发现，例如 "package-management", "code-style"） */
  usageScenarios?: string[];

  /** 使用次数（被检索并注入决策上下文的次数） */
  usageCount?: number;

  /** 最后使用时间戳 */
  lastUsed?: number;

  /** 有效次数（被采纳的次数，用于计算有效率） */
  effectiveCount?: number;

  /** 记忆来源（user=用户明确, agent=自动提取, dream=做梦生成） */
  memoryOriginV2?: 'user' | 'agent' | 'dream';

  // ═══ 做梦机制字段（3.0 新增） ═══

  /** 做梦代数（0=原始记忆，1+=做梦提炼的衍生记忆） */
  dreamGeneration?: number;

  /** 支持证据数量（多条原始记忆合并时的来源数量） */
  evidenceCount?: number;

  /** 最后复审时间戳 */
  lastReviewed?: number;

  /** 最后做梦处理时间（用于增量处理，避免重复处理） */
  lastDreamed?: number;

  /** 被做梦处理次数 */
  dreamCount?: number;

  // ═══ 软删除字段（3.0 新增） ═══

  /** 删除时间戳（软删除，保留记录） */
  deletedAt?: number;

  /** 删除原因（duplicate/prune/obsolete/merged） */
  deleteReason?: string;
}

/** 工具调用记录 */
export interface ToolCallRecord {
  name: string;
  input?: Record<string, unknown>;
  output?: string;
  resultSummary: string;
  isError: boolean;
  durationMs?: number;
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
  /** 显著性事件标记（由 ShortTermMemory 打标，提取时权重自动提升） */
  significantEvents?: SignificantEvent[];
}

/** 显著性事件（高权重记忆的来源） */
export interface SignificantEvent {
  type: 'user_correction'    // 用户明确纠正了 AI
    | 'repeated_rejection'   // 用户多次拒绝某方案
    | 'explicit_memory'      // 用户显式要求记住
    | 'error_resolved'       // 错误成功解决
    | 'strong_preference';   // 强烈的正/负向反馈
  description: string;
  turnIndex: number;         // 发生在第几轮
}

/** 检索选项 */
export interface RetrieveOptions {
  maxResults?: number;
  minConfidence?: number;
  types?: MemoryEntryType[];
  scope?: 'global' | 'project' | 'all';
  /** 按记忆层级过滤 */
  memoryScope?: MemoryScope | MemoryScope[];
  projectPath?: string;
}

/** 记忆存储接口 */
export interface IMemoryStore {
  init(): Promise<void>;
  save(session: SessionMemory): Promise<void>;
  retrieve(query: string, options?: RetrieveOptions): Promise<MemoryEntry[]>;
  compact(): Promise<void>;
  getStats(): Promise<{ total: number; byType: Record<string, number> }>;
  /** 添加单条记忆条目（用于 Agent 知识库等场景） */
  add(entry: Partial<MemoryEntry>): Promise<void>;
  /** 获取所有记忆条目（供 BootGuide / GUI 等场景使用） */
  getAllEntries?(limit?: number): MemoryEntry[];
}

/** 直接存储访问接口（供 MemoryStoreTool 使用） */
export interface IMemoryDirectStore {
  saveEntry(entry: MemoryEntry): void;
  updateEntry(id: string, updates: Partial<MemoryEntry>): void;
  deleteEntry(id: string): void;
  getEntry(id: string): MemoryEntry | null;
  searchFTS(query: string, limit?: number): MemoryEntry[];
  readAll(options?: { projectPath?: string; limit?: number }): MemoryEntry[];
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
  /** 提取器使用的模型（null 表示使用主模型） */
  extractorModel?: string | null;
  /** 提取器温度（默认 0.3） */
  extractorTemperature?: number;
  /** 提取器超时（默认 60000ms） */
  extractorTimeout?: number;
  /** 最小置信度阈值（默认 0.6） */
  extractorMinConfidence?: number;
  /** 轮次显著性评估阈值（默认 0.5，低于此值跳过提取） */
  significanceThreshold?: number;
  /** 触发巩固的同类情节数量（默认 5） */
  consolidationTriggerCount?: number;
  /** 记忆维护配置 */
  maintenance?: {
    enabled?: boolean;
    compactionInterval?: number;
    refinementInterval?: number;
    compactionAggressiveness?: number;
    maxUpgradesPerRun?: number;
    useLLM?: boolean;
  };
  /** 记忆格式化配置 */
  formatting?: {
    style?: 'openclaw' | 'simple';
    showAccessCount?: boolean;
    showRelatedMemories?: boolean;
    maxTimelineItems?: number;
  };
}

/** 默认记忆配置 */
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true,
  shortTermMaxEntries: 100,
  longTermMaxEntries: 100000, // 移除硬限制，依赖智能压缩维护
  retrieveMaxResults: 10,
  maxEntryLength: 500,
  maxPromptLength: 5000,
  compactionThreshold: 10000, // 提高阈值，减少频繁触发
  decayHalfLifeDays: 30,
  extractorModel: null,
  extractorTemperature: 0.3,
  extractorTimeout: 60_000,
  extractorMinConfidence: 0.6,
  significanceThreshold: 0.4,
  consolidationTriggerCount: 5,
  formatting: {
    style: 'openclaw',
    showAccessCount: true,
    showRelatedMemories: true,
    maxTimelineItems: 10,
  },
};

// ═══════════════════════════════════════════════════════════
// 各记忆层的半衰期配置（系统使用，不由 LLM 设置）
// ═══════════════════════════════════════════════════════════

/** volatility → 半衰期天数（Infinity 表示永不衰减） */
export const VOLATILITY_HALF_LIFE: Record<MemoryVolatility, number> = {
  permanent: Infinity,
  stable:    365,
  normal:    60,
  transient: 14,
};

/** type → 默认 volatility（用于规则降级路径） */
export const TYPE_DEFAULT_VOLATILITY: Partial<Record<MemoryEntryType, MemoryVolatility>> = {
  important_date:   'permanent',
  user_fact:        'stable',
  relationship:     'stable',
  user_preference:  'stable',
  lesson_learned:   'normal',
  reusable_pattern: 'normal',
  domain_knowledge: 'normal',
  agent_knowledge:  'normal',
  decision:         'normal',
  error_resolution: 'normal',
  project_fact:     'normal',
  tool_pattern:     'normal',
  session_summary:  'transient',
  unfinished_task:  'transient',
};

// ═══════════════════════════════════════════════════════════
// Database Row Interfaces (for better-sqlite3 type safety)
// ═══════════════════════════════════════════════════════════

/**
 * SQLite row structure for memories table
 * Maps directly to database schema, all fields are nullable except id
 */
export interface MemoryRow {
  id: string;
  type: string;
  content: string;
  keywords: string; // JSON array
  source: string;
  confidence: number;
  accuracy: number;
  project_path: string | null;
  created_at: string;
  updated_at: string;
  last_accessed_at: string;
  access_count: number;
  category: string | null;
  session_id: string | null;
  day_key: string | null;
  superseded_by: string | null;
  dismissed: number; // SQLite boolean (0/1)
  obsolete: number; // SQLite boolean (0/1)
  metadata: string; // JSON object
  // M5 分层记忆字段
  scope: string | null;
  volatility: string | null;
  significance: number | null;
  category_label: string | null;
}

/**
 * SQLite row structure for memory_vectors table
 */
export interface VectorRow {
  memory_id: string;
  embedding: Buffer;
}

/**
 * SQLite row structure for FTS5 search results
 */
export interface FTSRow {
  id: string;
  rank: number;
}

/**
 * SQLite row structure for statistics queries
 */
export interface StatsRow {
  type: string;
  count: number;
}

/**
 * SQLite row structure for COUNT(*) queries
 */
export interface CountRow {
  count: number;
}

// ═══════════════════════════════════════════════════════════
// 决策点记忆系统（3.0 新增）
// ═══════════════════════════════════════════════════════════

/** 决策点定义 */
export interface DecisionPoint {
  /** 决策类型（tool-choice/option-choice/consideration/decision等） */
  type: string;
  /** 相关工具名（如果是工具调用决策点） */
  tool?: string;
  /** 工具输入（如果是工具调用决策点） */
  input?: any;
  /** 思考内容（如果从thinking检测到） */
  thinking?: string;
  /** 关键词列表 */
  keywords: string[];
  /** 时间戳 */
  timestamp: number;
}

/** 检索到的记忆（带评分） */
export interface RetrievedMemory extends MemoryEntry {
  /** 适用性评分（0-1） */
  applicability: number;
  /** 检索原因 */
  reason: string;
}

/** 身份记忆 */
export interface IdentityMemory {
  /** 用户称呼（"先生"、"女士"等） */
  userTitle?: string;
  /** 助手名字（"贾维斯"等） */
  assistantName?: string;
  /** 人格设定 */
  persona?: string;
  /** 语气风格 */
  tone?: string;
}

/** 做梦进度 */
export interface DreamProgress {
  /** 当前批次 */
  currentBatch: number;
  /** 总批次数 */
  totalBatches: number;
  /** 已处理数量 */
  processedCount: number;
  /** 总数量 */
  totalCount: number;
  /** 当前结果 */
  result: DreamResult;
}

/** 做梦结果 */
export interface DreamResult {
  /** 提炼数量 */
  distilled: number;
  /** 压缩数量 */
  compressed: number;
  /** 去重数量 */
  deduplicated: number;
  /** 淘汰数量 */
  pruned: number;
  /** 评分更新数量 */
  scored: number;
  /** 耗时（ms） */
  duration: number;
}
