// ============================================================
// M1 终端 UI — 机器人管理工具
// ============================================================

import { t } from '@/core/i18n';
import type { IMAdapter } from '@/adapters/im/IMAdapter';
import type { ChatSession } from '@/core/chat/ChatSession';
import type { BotType, BotStatus } from '../types';
import { LogSystem } from './LogSystem';

/**
 * CLI 机器人管理器
 * 统一管理钉钉、飞书、企业微信机器人的启停
 */
export class BotManager {
  private bots: Map<BotType, IMAdapter> = new Map();
  private statuses: Map<BotType, BotStatus> = new Map();
  private logSystem: LogSystem;

  constructor(logSystem: LogSystem) {
    this.logSystem = logSystem;

    // 初始化默认状态
    const defaultTypes: BotType[] = ['dingtalk', 'feishu', 'wecom'];
    for (const type of defaultTypes) {
      this.statuses.set(type, {
        type,
        enabled: false,
        running: false,
      });
    }
  }

  /**
   * 注册机器人适配器
   */
  registerBot(type: BotType, adapter: IMAdapter): void {
    this.bots.set(type, adapter);

    // 设置日志回调
    if (adapter.setLogger) {
      adapter.setLogger((message: string) => {
        this.logSystem.info('Bot', `[${type}] ${message}`);
      });
    }
  }

  /**
   * 启动机器人
   */
  async startBot(type: BotType, session: ChatSession): Promise<void> {
    const bot = this.bots.get(type);
    if (!bot) {
      throw new Error(t('bots.unregistered', { type }));
    }

    const status = this.statuses.get(type)!;
    if (status.running) {
      throw new Error(t('bots.already_running', { type }));
    }

    try {
      await this.logSystem.info('Bot', t('bots.starting', { type }));
      await bot.start(session);
      this.statuses.set(type, {
        ...status,
        running: true,
        enabled: true,
        lastStartTime: Date.now(),
        lastError: undefined,
      });
      await this.logSystem.info('Bot', t('bots.started_ok', { type }));
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : t('bots.start_failed');
      this.statuses.set(type, {
        ...status,
        running: false,
        lastError: errMsg,
      });
      await this.logSystem.error('Bot', t('bots.start_failed_detail', { type, error: errMsg }));
      throw error;
    }
  }

  /**
   * 停止机器人
   */
  async stopBot(type: BotType): Promise<void> {
    const bot = this.bots.get(type);
    if (!bot) {
      throw new Error(t('bots.unregistered', { type }));
    }

    const status = this.statuses.get(type)!;
    if (!status.running) {
      return;
    }

    try {
      await this.logSystem.info('Bot', t('bots.stopping', { type }));
      await bot.stop();
      this.statuses.set(type, {
        ...status,
        running: false,
      });
      await this.logSystem.info('Bot', t('bots.stopped_ok', { type }));
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : t('bots.stop_failed');
      await this.logSystem.error('Bot', t('bots.stop_failed_detail', { type, error: errMsg }));
      throw error;
    }
  }

  /**
   * 获取所有机器人状态
   */
  getStatuses(): BotStatus[] {
    return Array.from(this.statuses.values());
  }

  /**
   * 获取指定机器人状态
   */
  getStatus(type: BotType): BotStatus {
    return this.statuses.get(type) ?? {
      type,
      enabled: false,
      running: false,
    };
  }

  /**
   * 停止所有运行中的机器人
   */
  async stopAll(): Promise<void> {
    const runningBots = Array.from(this.statuses.entries())
      .filter(([_, status]) => status.running)
      .map(([type]) => type);

    for (const type of runningBots) {
      try {
        await this.stopBot(type);
      } catch (error) {
        this.logSystem.error('Bot', `Failed to stop bot ${type}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
