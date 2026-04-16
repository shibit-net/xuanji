// ============================================================
// ProactiveButler — 智能管家主动推送引擎
// ============================================================

import { homedir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { SimpleStorage } from '@/core/SimpleStorage';
import { logger } from '@/core/logger';
import type { ILLMProvider } from '@/core/types';
import type { IReminderEngine } from '@/reminder/types';
import type { IMemoryStore, MemoryEntry } from '@/memory/types';
import type {
  IProactiveButler,
  ButlerConfig,
  ButlerContext,
  ButlerDecision,
  PushRecord,
} from './types';
import { DEFAULT_BUTLER_CONFIG } from './types';
import type { IPusher, PushNotification } from '@/reminder/daemon/types';

const log = logger.child({ module: 'proactive-butler' });

/**
 * ProactiveButler — LLM 驱动的智能管家服务
 *
 * 核心职责:
 * 1. 收集上下文（提醒、记忆、用户状态、时间）
 * 2. 调用 LLM 决策是否需要推送
 * 3. 执行推送（通过 Pusher 接口）
 * 4. 记录推送历史，防止骚扰
 * 5. 学习用户反馈，优化推送策略
 */
export class ProactiveButler extends EventEmitter implements IProactiveButler {
  private config: ButlerConfig;
  private storage: SimpleStorage;
  private filePath: string;
  private pushHistory: PushRecord[] = [];
  private initialized = false;

  // 外部依赖（需注入）
  private llmProvider: ILLMProvider | null = null;
  private reminderEngine: IReminderEngine | null = null;
  private memoryManager: IMemoryStore | null = null;
  private pushers: Map<string, IPusher> = new Map();

  // 定时器
  private scheduledTimers: NodeJS.Timeout[] = [];
  private fallbackTimer: NodeJS.Timeout | null = null;
  private lastCheckTime: Date | null = null;

  constructor(config?: Partial<ButlerConfig>) {
    super();
    this.config = { ...DEFAULT_BUTLER_CONFIG, ...config };
    this.storage = new SimpleStorage();
    this.filePath = join(homedir(), '.xuanji', this.config.storageFile);
  }

  /**
   * 注入依赖（必须在 init() 之前调用）
   */
  setDependencies(deps: {
    llmProvider: ILLMProvider;
    reminderEngine: IReminderEngine;
    memoryManager?: IMemoryStore;
    pushers?: Map<string, IPusher>;
  }): void {
    this.llmProvider = deps.llmProvider;
    this.reminderEngine = deps.reminderEngine;
    this.memoryManager = deps.memoryManager ?? null;
    this.pushers = deps.pushers ?? new Map();
  }

  /**
   * 初始化（加载推送历史）
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (!this.llmProvider || !this.reminderEngine) {
      throw new Error('ProactiveButler dependencies not set. Call setDependencies() first.');
    }

    try {
      this.pushHistory = await this.storage.readAll<PushRecord>(this.filePath);
      log.info(`ProactiveButler initialized: ${this.pushHistory.length} push records loaded`);
      this.initialized = true;
    } catch (error) {
      log.warn('Failed to load push history, starting fresh:', error);
      this.pushHistory = [];
      this.initialized = true;
    }
  }

  /**
   * 执行一次智能决策检查
   */
  async check(): Promise<ButlerDecision | null> {
    if (!this.initialized) await this.init();

    try {
      log.debug('ProactiveButler: Starting decision check...');
      this.lastCheckTime = new Date();

      // 1. 收集上下文
      const context = await this.collectContext();

      // 2. 判断是否需要决策（快速路径：无任何待处理事项）
      if (this.shouldSkipDecision(context)) {
        log.debug('No actionable items, skipping LLM decision');
        return null;
      }

      // 3. 调用 LLM 决策
      const decision = await this.makeDecision(context);

      // 4. 如果需要推送，执行推送并记录
      if (decision.shouldPush && decision.notification) {
        await this.executePush(decision);
      }

      return decision;
    } catch (error) {
      log.error('ProactiveButler check failed:', error);
      return null;
    }
  }

  /**
   * 启动后台服务
   */
  async startDaemon(): Promise<void> {
    if (!this.initialized) await this.init();

    log.info('ProactiveButler daemon starting...');

    // 清理旧定时器
    this.stopDaemon();

    // 1. 设置定时检查（如每天 09:00 和 20:00）
    for (const time of this.config.checkSchedule) {
      const timer = this.scheduleDaily(time, () => this.check());
      this.scheduledTimers.push(timer);
    }

    // 2. 设置兜底轮询（每小时检查一次）
    if (this.config.fallbackIntervalMinutes > 0) {
      const intervalMs = this.config.fallbackIntervalMinutes * 60 * 1000;
      this.fallbackTimer = setInterval(() => {
        this.check().catch((err) => log.error('Fallback check failed:', err));
      }, intervalMs);
    }

    // 3. 立即执行一次检查
    await this.check();

    log.info(`ProactiveButler daemon started (schedule: ${this.config.checkSchedule.join(', ')})`);
  }

  /**
   * 停止后台服务
   */
  stopDaemon(): void {
    for (const timer of this.scheduledTimers) {
      clearTimeout(timer);
    }
    this.scheduledTimers = [];

    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }

    log.info('ProactiveButler daemon stopped');
  }

  /**
   * 记录用户反馈（用于优化推送策略）
   */
  async recordUserFeedback(
    pushId: string,
    action: 'viewed' | 'dismissed' | 'snoozed' | 'completed',
  ): Promise<void> {
    const record = this.pushHistory.find((r) => r.id === pushId);
    if (!record) {
      log.warn(`Push record not found: ${pushId}`);
      return;
    }

    record.userAction = action;

    // 更新存储
    await this.storage.overwrite(this.filePath, this.pushHistory);

    log.info(`User feedback recorded: ${pushId} -> ${action}`);

    // TODO: 基于反馈调整推送策略（Phase 2）
  }

  // ────────── 私有方法 ──────────

  /**
   * 收集决策所需的上下文
   */
  private async collectContext(): Promise<ButlerContext> {
    const now = new Date();
    const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
      now.getDay()
    ]!;
    const isWorkday = now.getDay() >= 1 && now.getDay() <= 5;

    // 获取提醒上下文
    const reminders = await this.reminderEngine!.checkOnStartup();

    // 获取关系维护建议
    if (this.memoryManager) {
      const relationshipMemories = await this.memoryManager.retrieve('', {
        types: ['relationship'],
        maxResults: 50,
      });
      reminders.neglectedRelationships = await this.reminderEngine!.checkNeglectedRelationships(
        undefined,
        relationshipMemories,
      );
    }

    // 获取最近24小时记忆
    let recentMemories: import('@/memory/types').MemoryEntry[] = [];
    if (this.memoryManager) {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      recentMemories = await this.memoryManager.retrieve('', {
        maxResults: 20,
      });
      recentMemories = recentMemories.filter((m) => m.createdAt > yesterday);
    }

    // 获取最近推送记录（1小时内）
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recentPushes = this.pushHistory.filter((p) => p.timestamp > oneHourAgo);

    return {
      currentTime: {
        iso: now.toISOString(),
        dayOfWeek,
        hour: now.getHours(),
        isWorkday,
      },
      userStatus: this.estimateUserOnlineStatus(),
      reminders,
      recentMemories,
      recentPushes,
    };
  }

  /**
   * 推测用户在线状态
   * 简单策略：如果最近30分钟内有会话活动，认为在线
   */
  private estimateUserOnlineStatus(): { isOnline: boolean; lastActiveAt?: string } {
    // 从 MemoryManager 获取最近的会话记忆
    if (this.memoryManager) {
      // 使用 retrieve 方法而非 getAll（接口中未定义）
      this.memoryManager.retrieve('', { maxResults: 100 }).then((recentMemories) => {
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        
        const recentActivity = recentMemories.find((m: MemoryEntry) => m.lastAccessedAt > thirtyMinutesAgo);
        if (recentActivity) {
          return { isOnline: true, lastActiveAt: recentActivity.lastAccessedAt };
        }
      }).catch(() => {
        // 查询失败忽略
      });
    }
    
    return { isOnline: false, lastActiveAt: undefined };
  }

  /**
   * 快速判断是否可以跳过 LLM 决策
   */
  private shouldSkipDecision(context: ButlerContext): boolean {
    const { reminders, recentMemories } = context;

    // 如果没有任何待处理事项，跳过
    const hasActionableItems =
      reminders.dueReminders.length > 0 ||
      reminders.upcomingReminders.length > 0 ||
      reminders.neglectedRelationships.length > 0 ||
      recentMemories.length > 0;

    if (!hasActionableItems) {
      return true;
    }

    // 检查是否在静默时段（且无紧急事项）
    if (this.isQuietHours(context.currentTime.hour)) {
      const hasUrgent = reminders.dueReminders.some((r) => {
        const today = new Date().toISOString().split('T')[0];
        return r.triggerDate < today!; // OVERDUE
      });
      if (!hasUrgent) {
        log.debug('In quiet hours and no urgent items, skipping');
        return true;
      }
    }

    // 检查推送频率限制
    const recentSameCategoryPush = context.recentPushes.find((p) => {
      const minutesAgo = (Date.now() - new Date(p.timestamp).getTime()) / (1000 * 60);
      return minutesAgo < this.config.antiBother.minIntervalMinutes;
    });

    if (recentSameCategoryPush) {
      log.debug('Recent push within min interval, skipping');
      return true;
    }

    return false;
  }

  /**
   * 调用 LLM 进行决策
   */
  private async makeDecision(context: ButlerContext): Promise<ButlerDecision> {
    const prompt = this.buildDecisionPrompt(context);
    const systemPrompt = this.buildSystemPrompt();

    try {
      log.debug('Calling LLM for decision...');
      
      // 使用 stream 方法，但只收集完整响应
      const messages: import('@/core/types').Message[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ];

      let fullContent = '';
      const stream = this.llmProvider!.stream(
        messages,
        [], // 不使用工具
        {
          model: this.config.decisionModel ?? this.llmProvider!.models[0] ?? 'claude-3-haiku-20240307',
          temperature: this.config.decisionTemperature ?? 0.3,
          maxTokens: 800,
        } as any, // 类型简化
      );

      for await (const event of stream) {
        if (event.type === 'text_delta' && event.text) {
          fullContent += event.text;
        }
      }

      // 解析 JSON 响应
      const decision = this.parseDecisionResponse(fullContent);
      log.info(`Butler decision: shouldPush=${decision.shouldPush}, reason="${decision.reason}"`);

      return decision;
    } catch (error) {
      log.error('LLM decision failed:', error);
      // 降级：如果有 OVERDUE 提醒，强制推送
      return this.fallbackDecision(context);
    }
  }

  /**
   * 构建 System Prompt
   */
  private buildSystemPrompt(): string {
    return `你是用户的私人管家 Xuanji (璇玑)，负责主动关怀和提醒。

你的职责：
1. 分析当前上下文，判断是否需要主动推送通知
2. 如果需要推送，生成友好、简洁、可操作的中文提醒内容
3. 避免骚扰用户，只推送真正重要或紧急的事项

决策原则：
✅ 必须推送：OVERDUE 提醒、今日截止事项、重要关系提醒（生日/纪念日）
✅ 应该推送：即将到来的重要事项（未来1-2天）、超过60天未联系的重要联系人
⚠️ 谨慎推送：一般提醒、非紧急的关系维护建议
❌ 不推送：无重要事项、最近已推送过类似内容、在静默时段且不紧急

推送内容要求：
- 使用友好的中文，带上适当的 emoji
- 明确说明需要做什么
- 如果涉及多个事项，合并为一条摘要
- 提供可执行的建议（如"要不要帮你…"）

输出格式（严格 JSON）：
{
  "shouldPush": true/false,
  "reason": "决策理由（用于调试）",
  "notification": {
    "title": "标题（< 20字）",
    "body": "内容（< 100字，友好、可操作）",
    "priority": "low/normal/high/urgent",
    "channel": "system/all",
    "relatedReminderIds": ["相关提醒ID数组（可选）"]
  }
}

如果 shouldPush=false，则 notification 字段可省略。`;
  }

  /**
   * 构建决策 Prompt
   */
  private buildDecisionPrompt(context: ButlerContext): string {
    const { currentTime, userStatus, reminders, recentMemories, recentPushes } = context;

    let prompt = `当前时间：${currentTime.iso.split('T')[0]} ${String(currentTime.hour).padStart(2, '0')}:00 ${currentTime.dayOfWeek}${currentTime.isWorkday ? ' (工作日)' : ' (周末)'}\n\n`;

    // 提醒
    if (reminders.dueReminders.length > 0) {
      prompt += `⏰ 到期提醒 (${reminders.dueReminders.length} 条):\n`;
      for (const r of reminders.dueReminders.slice(0, 5)) {
        const isOverdue = r.triggerDate < currentTime.iso.split('T')[0]!;
        prompt += `  - ${isOverdue ? '[OVERDUE]' : '[TODAY]'} ${r.content} (${r.triggerDate})\n`;
      }
      prompt += '\n';
    }

    if (reminders.upcomingReminders.length > 0) {
      prompt += `📅 即将到来 (${reminders.upcomingReminders.length} 条):\n`;
      for (const r of reminders.upcomingReminders.slice(0, 3)) {
        prompt += `  - ${r.content} (${r.triggerDate})\n`;
      }
      prompt += '\n';
    }

    // 关系维护
    if (reminders.neglectedRelationships.length > 0) {
      prompt += `👤 关系维护建议 (${reminders.neglectedRelationships.length} 人):\n`;
      for (const rel of reminders.neglectedRelationships.slice(0, 3)) {
        prompt += `  - ${rel.name}: 已 ${rel.daysSinceLastContact} 天未联系\n`;
      }
      prompt += '\n';
    }

    // 最近记忆
    if (recentMemories.length > 0) {
      prompt += `🧠 最近记忆 (24小时内, ${recentMemories.length} 条):\n`;
      for (const mem of recentMemories.slice(0, 5)) {
        prompt += `  - [${mem.type}] ${mem.content.slice(0, 60)}${mem.content.length > 60 ? '...' : ''}\n`;
      }
      prompt += '\n';
    }

    // 最近推送
    if (recentPushes.length > 0) {
      prompt += `📨 最近推送 (1小时内, ${recentPushes.length} 条): 避免重复推送相同内容\n\n`;
    }

    prompt += `请根据以上上下文，决定是否需要推送，并生成推送内容（JSON 格式）：`;

    return prompt;
  }

  /**
   * 解析 LLM 响应
   */
  private parseDecisionResponse(text: string): ButlerDecision {
    try {
      // 尝试提取 JSON（可能被 markdown 代码块包裹）
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const decision = JSON.parse(jsonMatch[0]!) as ButlerDecision;

      // 验证必需字段
      if (typeof decision.shouldPush !== 'boolean' || !decision.reason) {
        throw new Error('Invalid decision format');
      }

      return decision;
    } catch (error) {
      log.error('Failed to parse LLM decision:', error);
      throw error;
    }
  }

  /**
   * 降级决策（LLM 失败时）
   */
  private fallbackDecision(context: ButlerContext): ButlerDecision {
    const { reminders } = context;

    // 如果有 OVERDUE 提醒，强制推送
    const today = new Date().toISOString().split('T')[0]!;
    const overdueReminders = reminders.dueReminders.filter((r) => r.triggerDate < today);

    if (overdueReminders.length > 0) {
      const firstReminder = overdueReminders[0]!;
      return {
        shouldPush: true,
        reason: 'Fallback: OVERDUE reminder detected',
        notification: {
          title: '⚠️ 过期提醒',
          body: `你有 ${overdueReminders.length} 条过期提醒:\n${firstReminder.content}`,
          priority: 'high',
          channel: 'system',
          relatedReminderIds: overdueReminders.map((r) => r.id),
        },
      };
    }

    return {
      shouldPush: false,
      reason: 'Fallback: No urgent items',
    };
  }

  /**
   * 执行推送
   */
  private async executePush(decision: ButlerDecision): Promise<void> {
    if (!decision.notification) return;

    const { title, body, priority, channel, relatedReminderIds } = decision.notification;

    // 创建推送记录
    const pushRecord: PushRecord = {
      id: `push_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
      type: relatedReminderIds && relatedReminderIds.length > 0 ? 'reminder' : 'summary',
      relatedIds: relatedReminderIds ?? [],
      priority,
    };

    // 构建通知
    const notification: PushNotification = {
      title,
      body,
      priority,
      reminderId: relatedReminderIds?.[0],
    };

    // 推送到指定渠道
    const targetChannels =
      channel === 'all' ? Array.from(this.pushers.keys()) : [channel];

    for (const ch of targetChannels) {
      const pusher = this.pushers.get(ch);
      if (pusher && pusher.isAvailable()) {
        try {
          await pusher.push(notification);
          log.info(`Pushed to ${ch}: ${title}`);
        } catch (error) {
          log.error(`Failed to push to ${ch}:`, error);
        }
      }
    }

    // 保存推送记录
    this.pushHistory.push(pushRecord);
    await this.storage.append(this.filePath, pushRecord);

    // 发出事件（供 UI 监听）
    this.emit('push', decision);
  }

  /**
   * 判断是否在静默时段
   */
  private isQuietHours(hour: number): boolean {
    const [startStr, endStr] = this.config.antiBother.quietHours;
    const startHour = Number.parseInt(startStr.split(':')[0]!);
    const endHour = Number.parseInt(endStr.split(':')[0]!);

    if (startHour > endHour) {
      // 跨天（如 22:00 - 08:00）
      return hour >= startHour || hour < endHour;
    } else {
      return hour >= startHour && hour < endHour;
    }
  }

  /**
   * 设置每日定时任务
   */
  private scheduleDaily(timeStr: string, callback: () => void): NodeJS.Timeout {
    const [hourStr, minuteStr] = timeStr.split(':');
    const targetHour = Number.parseInt(hourStr!);
    const targetMinute = Number.parseInt(minuteStr!);

    const now = new Date();
    const target = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      targetHour,
      targetMinute,
      0,
      0,
    );

    // 如果今天的时间点已过，调整到明天
    if (target < now) {
      target.setDate(target.getDate() + 1);
    }

    const delay = target.getTime() - now.getTime();

    const timer = setTimeout(() => {
      callback();
      // 递归设置下一次（24小时后）
      this.scheduleDaily(timeStr, callback);
    }, delay);

    log.debug(`Scheduled daily check at ${timeStr} (in ${Math.round(delay / 1000 / 60)} minutes)`);

    return timer;
  }
}
