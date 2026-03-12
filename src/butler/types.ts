// ============================================================
// ProactiveButler — 类型定义
// ============================================================

import type { Reminder, ReminderContext } from '@/reminder/types';
import type { MemoryEntry } from '@/memory/types';
import type { PushChannel } from '@/reminder/daemon/types';

/**
 * 管家决策上下文（喂给 LLM 的输入）
 */
export interface ButlerContext {
  /** 当前时间 */
  currentTime: {
    iso: string;
    dayOfWeek: string;
    hour: number;
    isWorkday: boolean;
  };
  /** 用户状态 */
  userStatus: {
    lastActiveAt?: string;
    isOnline: boolean;
    idleMinutes?: number;
  };
  /** 提醒上下文 */
  reminders: ReminderContext;
  /** 最近记忆（24小时内） */
  recentMemories: MemoryEntry[];
  /** 历史推送记录（避免重复） */
  recentPushes: PushRecord[];
}

/**
 * LLM 决策结果
 */
export interface ButlerDecision {
  /** 是否需要推送 */
  shouldPush: boolean;
  /** 决策理由（供调试和日志） */
  reason: string;
  /** 推送通知内容（如果 shouldPush=true） */
  notification?: {
    title: string;
    body: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    channel: PushChannel | 'all';
    /** 关联的提醒 ID（用于用户操作反馈） */
    relatedReminderIds?: string[];
  };
}

/**
 * 推送记录（防止短时间内重复推送）
 */
export interface PushRecord {
  id: string;
  timestamp: string;
  type: 'reminder' | 'relationship' | 'memory' | 'summary';
  relatedIds: string[]; // 关联的提醒/记忆 ID
  priority: 'low' | 'normal' | 'high' | 'urgent';
  userAction?: 'viewed' | 'dismissed' | 'snoozed' | 'completed';
}

/**
 * 管家配置
 */
export interface ButlerConfig {
  /** 是否启用智能管家 */
  enabled: boolean;
  /** LLM 决策使用的模型（null 使用默认轻量模型） */
  decisionModel?: string | null;
  /** LLM 决策温度（默认 0.3，偏保守） */
  decisionTemperature?: number;
  /** 防骚扰配置 */
  antiBother: {
    /** 同类型推送最小间隔（分钟） */
    minIntervalMinutes: number;
    /** 静默时段（24小时制） */
    quietHours: [string, string]; // ["22:00", "08:00"]
    /** 每日摘要时间（如 "09:00"） */
    dailySummaryTime?: string;
  };
  /** 触发检查的时间点（24小时制，如 ["09:00", "20:00"]） */
  checkSchedule: string[];
  /** 兜底轮询间隔（分钟，0 表示禁用） */
  fallbackIntervalMinutes: number;
  /** 推送渠道优先级 */
  defaultChannels: PushChannel[];
  /** 存储文件路径 */
  storageFile: string;
}

/**
 * 默认管家配置
 */
export const DEFAULT_BUTLER_CONFIG: ButlerConfig = {
  enabled: true,
  decisionModel: null, // 使用默认轻量模型
  decisionTemperature: 0.3,
  antiBother: {
    minIntervalMinutes: 60,
    quietHours: ['22:00', '08:00'],
    dailySummaryTime: '09:00',
  },
  checkSchedule: ['09:00', '20:00'], // 每天早晚各一次主动检查
  fallbackIntervalMinutes: 60, // 每小时兜底检查
  defaultChannels: ['system'],
  storageFile: 'butler_pushes.jsonl',
};

/**
 * 智能管家引擎接口
 */
export interface IProactiveButler {
  /** 初始化 */
  init(): Promise<void>;

  /** 执行一次智能决策检查 */
  check(): Promise<ButlerDecision | null>;

  /** 启动后台服务（定时触发 + 事件触发） */
  startDaemon(): Promise<void>;

  /** 停止后台服务 */
  stopDaemon(): void;

  /** 记录用户对推送的反馈（用于学习） */
  recordUserFeedback(pushId: string, action: 'viewed' | 'dismissed' | 'snoozed' | 'completed'): Promise<void>;
}
