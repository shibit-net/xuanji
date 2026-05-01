// ============================================================
// 提醒守护进程 — 主服务
// ============================================================

import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { logger } from '@/core/logger';
import { ReminderEngine } from '../ReminderEngine';
import type { DaemonConfig, DaemonStatus, IPusher, PushNotification } from './types';
import { SystemPusher } from './SystemPusher';
import { IMPusher } from './IMPusher';

const log = logger.child({ module: 'daemon-service' });

/**
 * DaemonService — 提醒守护进程服务
 *
 * 职责:
 * 1. 在后台定期检查提醒
 * 2. 通过多种渠道推送通知
 * 3. 管理守护进程生命周期 (start/stop/status)
 */
export class DaemonService {
  private config: DaemonConfig;
  private reminderEngine: ReminderEngine;
  private pushers: Map<string, IPusher> = new Map();
  private timer: NodeJS.Timeout | null = null;
  private pidFilePath: string;
  private running = false;

  constructor(config: DaemonConfig) {
    this.config = config;
    this.reminderEngine = new ReminderEngine();
    this.pidFilePath = join(process.cwd(), '.xuanji', 'daemon.pid');
  }

  /**
   * 启动守护进程
   */
  async start(): Promise<void> {
    if (this.running) {
      log.warn('Daemon is already running');
      return;
    }

    // 检查是否已有进程在运行
    if (this.isRunning()) {
      log.warn('Daemon PID file exists, another instance may be running');
      throw new Error('Daemon is already running (PID file exists)');
    }

    log.info('Starting reminder daemon...');

    // 初始化 ReminderEngine
    await this.reminderEngine.init();

    // 初始化推送器
    await this.initPushers();

    // 写入 PID 文件
    this.writePidFile();

    // 立即执行一次检查
    await this.checkAndPush();

    // 启动定时器
    const intervalMs = this.config.checkIntervalMinutes * 60 * 1000;
    this.timer = setInterval(() => {
      this.checkAndPush().catch((err) => {
        log.error('Failed to check and push reminders:', err);
      });
    }, intervalMs);

    this.running = true;
    log.info(`Daemon started. Checking every ${this.config.checkIntervalMinutes} minutes`);

    // 保持进程运行
    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());
  }

  /**
   * 停止守护进程
   */
  stop(): void {
    if (!this.running) {
      log.warn('Daemon is not running');
      return;
    }

    log.info('Stopping reminder daemon...');

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // 删除 PID 文件
    this.deletePidFile();

    this.running = false;
    log.info('Daemon stopped');
    process.exit(0);
  }

  /**
   * 获取守护进程状态
   */
  getStatus(): DaemonStatus {
    const running = this.isRunning();
    const pid = running ? this.readPidFile() : undefined;
    const activeChannels = Array.from(this.pushers.keys()).filter((channel) =>
      this.pushers.get(channel)?.isAvailable(),
    ) as DaemonStatus['activeChannels'];

    return {
      running,
      pid,
      activeChannels,
      // TODO: 从持久化存储中读取 lastCheckTime 和 nextCheckTime
    };
  }

  // ────────── 私有方法 ──────────

  /** 初始化所有推送器 */
  private async initPushers(): Promise<void> {
    const pushers: IPusher[] = [];

    for (const channel of this.config.pushChannels) {
      switch (channel) {
        case 'system': {
          const pusher = new SystemPusher();
          await pusher.init();
          if (pusher.isAvailable()) {
            this.pushers.set('system', pusher);
            log.info('System pusher enabled');
          }
          break;
        }
        case 'feishu': {
          const pusher = new IMPusher('feishu');
          await pusher.init();
          if (pusher.isAvailable()) {
            this.pushers.set('feishu', pusher);
            log.info('Feishu pusher enabled');
          }
          break;
        }
        case 'dingtalk': {
          const pusher = new IMPusher('dingtalk');
          await pusher.init();
          if (pusher.isAvailable()) {
            this.pushers.set('dingtalk', pusher);
            log.info('Dingtalk pusher enabled');
          }
          break;
        }
        case 'wecom': {
          const pusher = new IMPusher('wecom');
          await pusher.init();
          if (pusher.isAvailable()) {
            this.pushers.set('wecom', pusher);
            log.info('Wecom pusher enabled');
          }
          break;
        }
        // TODO: 添加 email pusher
      }
    }

    if (this.pushers.size === 0) {
      log.warn('No pushers available');
    }
  }

  /** 检查提醒并推送 */
  private async checkAndPush(): Promise<void> {
    log.debug('Checking reminders...');

    // 检查当前是否在静默时段
    if (this.isQuietHours()) {
      log.debug('In quiet hours, skipping non-urgent reminders');
    }

    // 获取到期的提醒
    const context = await this.reminderEngine.checkOnStartup();
    const dueReminders = context.dueReminders;

    if (dueReminders.length === 0) {
      log.debug('No due reminders');
      return;
    }

    log.info(`Found ${dueReminders.length} due reminders`);

    // 为每个提醒创建通知
    for (const reminder of dueReminders) {
      const notification: PushNotification = {
        title: '📅 Xuanji 提醒',
        body: reminder.content,
        priority: 'normal',
        reminderId: reminder.id,
        actions: [
          { label: '✅ 完成', action: 'mark_done' },
          { label: '🔕 忽略', action: 'dismiss' },
          { label: '⏰ 稍后提醒', action: 'snooze' },
        ],
      };

      // 推送到所有可用渠道
      await this.pushToAllChannels(notification);
    }
  }

  /** 推送通知到所有渠道 */
  private async pushToAllChannels(notification: PushNotification): Promise<void> {
    const promises = Array.from(this.pushers.values()).map((pusher) =>
      pusher.push(notification).catch((err) => {
        log.error('Pusher failed:', err);
      }),
    );
    await Promise.all(promises);
  }

  /** 检查是否在静默时段 */
  private isQuietHours(): boolean {
    if (!this.config.quietHours) return false;

    const [startStr, endStr] = this.config.quietHours;
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // 静默时段可能跨天（如 22:00 - 08:00）
    if (startStr > endStr) {
      return currentTime >= startStr || currentTime < endStr;
    } else {
      return currentTime >= startStr && currentTime < endStr;
    }
  }

  /** 检查守护进程是否在运行 */
  private isRunning(): boolean {
    if (!existsSync(this.pidFilePath)) return false;

    const pid = this.readPidFile();
    if (!pid) return false;

    // 检查进程是否存在
    try {
      process.kill(pid, 0); // 0 信号不杀死进程，只检查是否存在
      return true;
    } catch {
      // 进程不存在，清理陈旧的 PID 文件
      this.deletePidFile();
      return false;
    }
  }

  /** 写入 PID 文件 */
  private writePidFile(): void {
    writeFileSync(this.pidFilePath, String(process.pid), 'utf-8');
    log.debug(`PID file written: ${this.pidFilePath}`);
  }

  /** 读取 PID 文件 */
  private readPidFile(): number | undefined {
    try {
      const content = readFileSync(this.pidFilePath, 'utf-8');
      return Number.parseInt(content.trim(), 10);
    } catch {
      return undefined;
    }
  }

  /** 删除 PID 文件 */
  private deletePidFile(): void {
    if (existsSync(this.pidFilePath)) {
      unlinkSync(this.pidFilePath);
      log.debug(`PID file deleted: ${this.pidFilePath}`);
    }
  }
}
