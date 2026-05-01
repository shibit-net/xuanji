// ============================================================
// 提醒系统 — 类型定义
// ============================================================

/**
 * 简化的 MemoryEntry 接口（用于关系提醒功能）
 */
export interface MemoryEntry {
  id: string;
  content: string;
  keywords: string[];
  updatedAt: string;
}

/**
 * 提醒循环类型
 */
export type ReminderRecurring = 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * 提醒状态
 */
export type ReminderStatus = 'active' | 'done' | 'dismissed';

/**
 * 提醒来源
 */
export type ReminderSource = 'user_explicit' | 'auto_extracted';

/**
 * 提醒条目
 */
export interface Reminder {
  /** UUID */
  id: string;
  /** 提醒内容 */
  content: string;
  /** 触发日期 (ISO date, 如 "2026-03-08") */
  triggerDate: string;
  /** 循环类型 */
  recurring: ReminderRecurring;
  /** 状态 */
  status: ReminderStatus;
  /** 来源：用户设置 vs LLM 自动提取 */
  source: ReminderSource;
  /** 关联的记忆条目 ID */
  relatedMemoryId?: string;
  /** 创建时间 */
  createdAt: string;
}

/**
 * 设置提醒的输入（不含自动生成字段）
 */
export type ReminderInput = Omit<Reminder, 'id' | 'createdAt' | 'status'>;

/**
 * 关系维护提醒（由 checkNeglectedRelationships 生成）
 */
export interface RelationshipReminder {
  /** 联系人名称 */
  name: string;
  /** 距离上次互动的天数 */
  daysSinceLastContact: number;
  /** 关联的记忆内容 */
  memoryContent: string;
  /** 关联的记忆 ID */
  memoryId: string;
}

/**
 * 启动时的提醒上下文
 */
export interface ReminderContext {
  /** 过期/今日提醒 */
  dueReminders: Reminder[];
  /** 即将到来的提醒 (未来 N 天) */
  upcomingReminders: Reminder[];
  /** 关系维护建议 */
  neglectedRelationships: RelationshipReminder[];
}

/**
 * 提醒系统配置
 */
export interface ReminderConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 关系维护阈值 (天) */
  neglectThresholdDays: number;
  /** 启动时预览未来 N 天的提醒 */
  upcomingDays: number;
  /** 存储文件路径 (相对于 .xuanji/) */
  storageFile: string;
}

/**
 * 默认提醒配置
 */
export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  enabled: true,
  neglectThresholdDays: 60,
  upcomingDays: 3,
  storageFile: 'reminders.jsonl',
};

/**
 * listReminders 查询过滤条件
 * 所有字段均为可选，未指定时不应用该过滤维度
 */
export interface ListRemindersFilter {
  /** 状态过滤：'active' | 'done' | 'dismissed'。未指定返回所有状态 */
  status?: ReminderStatus;
  /** 日期下界（含），格式 YYYY-MM-DD。未指定无下界 */
  dateFrom?: string;
  /** 日期上界（含），格式 YYYY-MM-DD。未指定无上界 */
  dateTo?: string;
}

// ============================================================
// 提醒统计 — 类型定义
// ============================================================

/**
 * 按提醒状态分布
 */
export interface ReminderStatusDistribution {
  active: number;
  done: number;
  dismissed: number;
}

/**
 * 按循环类型分布
 */
export interface ReminderRecurringDistribution {
  once: number;
  daily: number;
  weekly: number;
  monthly: number;
  yearly: number;
}

/**
 * 按来源分布
 */
export interface ReminderSourceDistribution {
  user_explicit: number;
  auto_extracted: number;
}

/**
 * 按日期分布的单个条目
 */
export interface ReminderDateBucket {
  /** 日期，格式 YYYY-MM-DD */
  date: string;
  /** 该日期的提醒数量 */
  count: number;
}

/**
 * 聚合后的提醒统计
 */
export interface ReminderStats {
  /** 提醒总数（受过滤条件影响） */
  total: number;
  /** 按状态分布 */
  byStatus: ReminderStatusDistribution;
  /** 按循环类型分布 */
  byRecurring: ReminderRecurringDistribution;
  /** 按来源分布 */
  bySource: ReminderSourceDistribution;
  /** 按日期分布（按 triggerDate 聚合，升序排列） */
  byDate: ReminderDateBucket[];
  /** 统计覆盖的时间范围（null 表示无数据） */
  dateRange: { from: string; to: string } | null;
  /** 统计数据生成时间（ISO 8601） */
  generatedAt: string;
}

/**
 * 统计查询参数（所有字段可选，复用 ListRemindersFilter）
 */
export type StatsQueryOptions = ListRemindersFilter;

/**
 * 提醒统计服务接口
 */
export interface IReminderStatsService {
  /**
   * 获取聚合统计数据
   * @param options 可选的过滤条件
   * @returns 聚合统计结果
   */
  getStats(options?: StatsQueryOptions): Promise<ReminderStats>;
}

/**
 * 提醒引擎接口
 */
export interface IReminderEngine {
  /** 初始化 */
  init(): Promise<void>;

  /** 启动时检查: 返回今日及过期的活跃提醒 + 即将到来的提醒 */
  checkOnStartup(): Promise<ReminderContext>;

  /** 设置新提醒 */
  setReminder(input: ReminderInput): Promise<Reminder>;

  /** 标记提醒为已完成 */
  markDone(id: string): Promise<void>;

  /** 忽略提醒 */
  dismiss(id: string): Promise<void>;

  /** 检查关系维护提醒 (距上次互动超过阈值) */
  checkNeglectedRelationships(thresholdDays?: number, relationshipMemories?: MemoryEntry[]): Promise<RelationshipReminder[]>;

  /** 格式化提醒上下文为 Markdown (注入 System Prompt) */
  formatForPrompt(context: ReminderContext): string;

  /**
   * 查询提醒列表，支持按状态和日期范围过滤
   * @param filter 过滤条件（所有字段可选）
   * @returns 匹配的提醒列表，按 triggerDate 降序排列
   */
  listReminders(filter?: ListRemindersFilter): Promise<Reminder[]>;
}
