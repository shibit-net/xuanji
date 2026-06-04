/**
 * PlatformRouter — 多平台消息路由中枢
 *
 * 职责：
 * - 管理所有 PlatformAdapter 实例
 * - 接收消息 → 解析 sessionKey + userId → 入队 → Worker Pool 异步处理
 * - 统一回复入口（委托给对应 Adapter）
 *
 * 设计文档：docs/platform-integration-design.md §3.4 + §11
 */

import type { Database } from 'better-sqlite3';
import type { PlatformAdapter, PlatformMessage, PlatformsConfig, PlatformHealth } from './types.js';
import type { RemoteSession } from './types.js';
import { PersistentMessageQueue, AgentWorkerPool } from './MessageQueue.js';
import type { WorkerReplyHandler } from './MessageQueue.js';
import type { AgentGateway } from './types.js';
import { SessionRouter, buildSessionKey } from './SessionRouter.js';
import { CredentialManager } from './auth/CredentialManager.js';
import { PlatformCircuitBreaker } from './PlatformCircuitBreaker.js';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'PlatformRouter' });

export class PlatformRouter implements WorkerReplyHandler {
  private adapters = new Map<string, PlatformAdapter>();
  private messageHandler: ((sessionKey: string, msg: PlatformMessage) => void) | null = null;

  public readonly sessionRouter: SessionRouter;
  public readonly credentials: CredentialManager;
  public readonly circuitBreaker: PlatformCircuitBreaker;

  private queue: PersistentMessageQueue | null = null;
  private pool: AgentWorkerPool | null = null;
  private agent: AgentGateway | null = null;

  private channelPrompts = new Map<string, Map<string, string>>();

  constructor(db?: Database, dataDir?: string) {
    this.sessionRouter = new SessionRouter(dataDir);
    this.credentials = new CredentialManager();
    if (dataDir) {
      this.credentials.setPersistPath(`${dataDir}/credentials.json`);
    }
    this.circuitBreaker = new PlatformCircuitBreaker();

    if (db) {
      this.queue = new PersistentMessageQueue(db);
    }
  }

  // ── Adapter 管理 ─────────────────────────────────────────

  registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter);

    adapter.onMessage((msg) => {
      this.onMessage(msg);
    });
  }

  /** 预注册远端会话（扫码连接成功后调用，确保侧边栏立即可见） */
  registerSession(platform: RemoteSession['platform'], chatId: string, chatType: 'private' | 'group' = 'private'): void {
    const sessionKey = buildSessionKey({ platform, chatType, chatId });
    this.sessionRouter.registerSession(sessionKey, chatId);
  }

  getAdapter(platform: string): PlatformAdapter | undefined {
    return this.adapters.get(platform);
  }

  removeAdapter(platform: string): void {
    this.adapters.delete(platform);
  }

  // ── Agent 绑定 ───────────────────────────────────────────

  setAgent(agent: AgentGateway): void {
    this.agent = agent;
    if (this.queue && this.agent) {
      this.pool = new AgentWorkerPool(this.queue, this.agent, this);
    }
  }

  // ── 消息入口 ─────────────────────────────────────────────

  registerMessageHandler(handler: (sessionKey: string, msg: PlatformMessage) => void): void {
    this.messageHandler = handler;
  }

  private onMessage(msg: PlatformMessage): void {
    const sessionKey = buildSessionKey(msg);
    const channelPrompt = this.getChannelPrompt(msg.platform, msg.chatId);
    const userId = this.sessionRouter.resolveUserId(msg.platform, msg.userId);

    const enriched: PlatformMessage = {
      ...msg,
      sessionKey,
      channelPrompt,
      userId,
    };

    // 注册会话（状态事件不重复注册）
    if (!msg.eventType || msg.eventType === 'message') {
      this.sessionRouter.registerSession(sessionKey, msg.chatId);
    }

    // 通知 UI 层
    this.messageHandler?.(sessionKey, enriched);

    // 仅普通消息入队 Agent 处理池，状态事件（已读/撤回/输入）不入队
    if (this.queue && (!msg.eventType || msg.eventType === 'message')) {
      this.queue.enqueue(enriched);
    }

    log.debug(`Message routed: sessionKey=${sessionKey}, platform=${msg.platform}, eventType=${msg.eventType || 'message'}`);
  }

  // ── Worker 回复回调 ──────────────────────────────────────

  async sendReply(msg: PlatformMessage, text: string, imagePaths?: string[], audioPaths?: string[], videoPaths?: string[]): Promise<void> {
    const adapter = this.adapters.get(msg.platform);
    if (!adapter) {
      log.error(`No adapter found for platform: ${msg.platform}`);
      return;
    }

    // 先发图片
    if (imagePaths?.length) {
      for (const imagePath of imagePaths) {
        try {
          await this.circuitBreaker.call(msg.platform, () =>
            adapter.sendImage({ chatId: msg.chatId, imagePath })
          );
        } catch (err) {
          log.error(`Failed to send image to ${msg.platform}: ${(err as Error).message}`);
        }
      }
    }

    // 发送音频（通过 sendVoice 或降级为 sendFile）
    if (audioPaths?.length) {
      for (const audioPath of audioPaths) {
        try {
          await this.circuitBreaker.call(msg.platform, () => {
            if (adapter.sendVoice) {
              return adapter.sendVoice({ chatId: msg.chatId, voicePath: audioPath });
            }
            if (adapter.sendFile) {
              return adapter.sendFile({ chatId: msg.chatId, filePath: audioPath });
            }
            return adapter.sendText({ chatId: msg.chatId, text: `[音频文件: ${audioPath}]` });
          });
        } catch (err) {
          log.error(`Failed to send audio to ${msg.platform}: ${(err as Error).message}`);
        }
      }
    }

    // 发送视频（通过 sendFile 降级）
    if (videoPaths?.length) {
      for (const videoPath of videoPaths) {
        try {
          await this.circuitBreaker.call(msg.platform, () => {
            if (adapter.sendFile) {
              return adapter.sendFile({ chatId: msg.chatId, filePath: videoPath });
            }
            return adapter.sendText({ chatId: msg.chatId, text: `[视频文件: ${videoPath}]` });
          });
        } catch (err) {
          log.error(`Failed to send video to ${msg.platform}: ${(err as Error).message}`);
        }
      }
    }

    await this.circuitBreaker.call(msg.platform, () =>
      adapter.sendText({ chatId: msg.chatId, text, replyTo: msg.replyTo })
    );
  }

  async sendError(msg: PlatformMessage, error: Error): Promise<void> {
    const ERROR_MESSAGES: Record<string, string> = {
      agent_error: '抱歉，我这里出了点问题，请重试。',
      auth_error: '连接已过期，请在 xuanji 桌面端重新授权。',
      rate_limit: '请求太频繁，请稍后再试。',
      timeout: '处理超时，请重试。',
    };

    const errorType = this.classifyError(error);
    const reply = ERROR_MESSAGES[errorType] || '抱歉，出了点问题。';

    const adapter = this.adapters.get(msg.platform);
    if (!adapter) return;

    await this.circuitBreaker.call(msg.platform, () =>
      adapter.sendText({ chatId: msg.chatId, text: reply, replyTo: msg.id })
    ).catch(() => {});

    log.error(`Error for ${msg.sessionKey}: ${error.message}`, { errorType });
  }

  // ── Channel Prompt ───────────────────────────────────────

  setChannelPrompts(platform: string, prompts: Record<string, string>): void {
    const map = new Map(Object.entries(prompts));
    this.channelPrompts.set(platform, map);
  }

  private getChannelPrompt(platform: string, chatId: string): string | undefined {
    const explicit = this.channelPrompts.get(platform)?.get(chatId);
    if (explicit) return explicit;
    return this.getDefaultChannelPrompt(platform);
  }

  private getDefaultChannelPrompt(platform: string): string | undefined {
    // Channel prompts should be configured via configure() → setChannelPrompts()
    // If no prompt is configured for this platform, return undefined (no injection)
    return undefined;
  }

  // ── 用户映射 ─────────────────────────────────────────────

  setUserMapping(mapping: Record<string, string>): void {
    this.sessionRouter.setUserMapping(mapping);
  }

  // ── 生命周期 ─────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.pool) {
      await this.pool.start();
    }

    for (const adapter of this.adapters.values()) {
      try {
        await adapter.start();
        log.info(`Adapter started: ${adapter.platform}`);
      } catch (err) {
        log.error(`Failed to start adapter ${adapter.platform}: ${(err as Error).message}`);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.pool) {
      await this.pool.stop();
    }

    for (const adapter of this.adapters.values()) {
      try {
        await adapter.stop();
        log.info(`Adapter stopped: ${adapter.platform}`);
      } catch (err) {
        log.error(`Failed to stop adapter ${adapter.platform}: ${(err as Error).message}`);
      }
    }
  }

  // ── 配置 ─────────────────────────────────────────────────

  configure(config: PlatformsConfig): void {
    if (config.user_mapping) {
      this.sessionRouter.setUserMapping(config.user_mapping);
    }

    if (config.feishu?.channel_prompts) {
      this.setChannelPrompts('feishu', config.feishu.channel_prompts);
    }
    if (config.dingtalk?.channel_prompts) {
      this.setChannelPrompts('dingtalk', config.dingtalk.channel_prompts);
    }
    if (config.wecom?.channel_prompts) {
      this.setChannelPrompts('wecom', config.wecom.channel_prompts);
    }
    if (config.wechat?.channel_prompts) {
      this.setChannelPrompts('wechat', config.wechat.channel_prompts);
    }
  }

  // ── 错误分类 ─────────────────────────────────────────────

  private classifyError(error: Error): string {
    if (error.message.includes('token') || error.message.includes('auth')) {
      return 'auth_error';
    }
    if (error.message.includes('rate') || error.message.includes('429')) {
      return 'rate_limit';
    }
    if (error.message.includes('timeout')) {
      return 'timeout';
    }
    return 'agent_error';
  }

  // ── 管理接口 ─────────────────────────────────────────────

  async enablePlatform(platform: string): Promise<void> {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new Error(`No adapter for platform: ${platform}`);
    await adapter.start();
  }

  async disablePlatform(platform: string): Promise<void> {
    const adapter = this.adapters.get(platform);
    if (!adapter) return;
    await adapter.stop();
  }

  updateChannelPrompt(platform: string, chatId: string, prompt: string): void {
    let map = this.channelPrompts.get(platform);
    if (!map) {
      map = new Map();
      this.channelPrompts.set(platform, map);
    }
    map.set(chatId, prompt);
  }

  listSessions(): RemoteSession[] {
    const sessions: RemoteSession[] = [];
    for (const { sessionKey, chatId, lastActiveAt } of this.sessionRouter.getActiveSessionEntries()) {
      sessions.push({
        id: sessionKey,
        platform: sessionKey.split(':')[0] as RemoteSession['platform'],
        name: chatId,
        status: this.adapters.has(sessionKey.split(':')[0]) ? 'online' : 'offline',
        unreadCount: 0,
        sessionKey,
        userId: '',
        chatId,
        lastActiveAt,
      });
    }
    return sessions;
  }

  health(): PlatformHealth[] {
    const results: PlatformHealth[] = [];
    for (const adapter of this.adapters.values()) {
      results.push({
        platform: adapter.platform,
        status: 'healthy',
        lastMessageAt: adapter.lastActivity || 0,
        circuitBreakerOpen: this.circuitBreaker.isOpen(adapter.platform),
        tokenExpiresAt: this.credentials.getTokenStatus(adapter.platform).expiresAt,
      });
    }
    return results;
  }
}
