// ============================================================
// 提醒守护进程 — 类型定义
// ============================================================

/**
 * 推送渠道类型
 */
export type PushChannel = 'system' | 'feishu' | 'dingtalk' | 'wecom' | 'email';

/**
 * 守护进程配置
 */
export interface DaemonConfig {
  /** 是否启用守护进程 */
  enabled: boolean;
  /** 检查间隔 (分钟) */
  checkIntervalMinutes: number;
  /** 推送渠道 */
  pushChannels: PushChannel[];
  /** 静默时段 (24小时制，如 ["22:00", "08:00"] 表示晚10点到早8点不推送) */
  quietHours?: [string, string];
  /** 提醒推送时间 (每天的固定时间点，如 "09:00") */
  dailyReminderTime?: string;
}

/**
 * 推送通知内容
 */
export interface PushNotification {
  /** 标题 */
  title: string;
  /** 内容 */
  body: string;
  /** 优先级 (urgent 会忽略 quietHours) */
  priority: 'low' | 'normal' | 'high' | 'urgent';
  /** 相关提醒 ID */
  reminderId?: string;
  /** 操作按钮 */
  actions?: Array<{
    label: string;
    action: 'mark_done' | 'dismiss' | 'snooze' | 'open';
  }>;
}

/**
 * 推送器接口
 */
export interface IPusher {
  /** 初始化 */
  init(): Promise<void>;
  /** 发送通知 */
  push(notification: PushNotification): Promise<void>;
  /** 检查是否可用 */
  isAvailable(): boolean;
}

/**
 * 守护进程状态
 */
export interface DaemonStatus {
  /** 是否正在运行 */
  running: boolean;
  /** 进程 PID */
  pid?: number;
  /** 最后检查时间 */
  lastCheckTime?: string;
  /** 下次检查时间 */
  nextCheckTime?: string;
  /** 启用的推送渠道 */
  activeChannels: PushChannel[];
}
