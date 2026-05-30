/**
 * 定时任务类型定义
 *
 * Scheduler、MemoryManager、LearnTool 共享此类型。
 */

export interface CronJob {
  id: string;
  userId: string;
  type: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'once';
  hour?: number;
  minute?: number;
  dayOfWeek?: number;
  /** 每月几号 (1-31)，仅 monthly/yearly 类型 */
  dayOfMonth?: number;
  /** 月份 (1-12)，仅 yearly 类型 */
  month?: number;
  /** 精确执行时间戳（仅 once 类型，或作为首次执行时间） */
  scheduledAt?: number;
  action: 'learn' | 'custom';
  params?: Record<string, any>;
  prompt?: string;
  /** 触发 agent 时注入的用户消息（填入则触发完整 agent 对话循环） */
  message?: string;
  enabled?: boolean;
  executed?: boolean;
  /** 任务描述 */
  description?: string;
  /** 创建时间 */
  createdAt?: number;
  /** 是否为系统级任务（由代码注册，非用户创建） */
  system?: boolean;
  /** 发起任务的平台（如 wechat、dingtalk），存在时定时触发将推回该平台 */
  platform?: string;
  /** 发起任务的会话 ID，与 platform 配合使用 */
  chatId?: string;
}

export interface SchedulerLog {
  id: number;
  job_id: string;
  scheduled_at: number;
  executed_at: number;
  status: string;
}
