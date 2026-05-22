/**
 * 微信 ClawBot Adapter
 *
 * 扫码认证 + 长轮询 + iLink 私有协议
 * 设计文档：docs/platform-integration-design.md §5.4
 */

import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import type { PlatformAdapter, PlatformMessage, WechatConfig } from '../types.js';
import { buildSessionKey } from '../SessionRouter.js';
import { sleep } from '@/shared/utils/sleep.js';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'WechatAdapter' });

const VERSION = 0x00020404; // 2.4.4

interface WechatToken {
  token: string;
  baseUrl: string;
  uin: string;
  expiresAt?: number;
}

export class WechatAdapter implements PlatformAdapter {
  readonly platform = 'wechat' as const;
  lastActivity = 0;

  private messageHandler: ((msg: PlatformMessage) => void) | null = null;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private getUpdatesBuf = '';
  private contextTokens = new Map<string, string>();

  private tokenInfo: WechatToken | null = null;

  constructor(private config: WechatConfig) {}

  // ── 认证 ─────────────────────────────────────────────────

  private loadSavedToken(): WechatToken | null {
    try {
      const tokenPath = this.resolveTokenPath();
      if (existsSync(tokenPath)) {
        const data = JSON.parse(readFileSync(tokenPath, 'utf-8'));
        if (data.token && data.baseUrl) {
          log.info('Loaded saved wechat token');
          return data;
        }
      }
    } catch (err) {
      log.warn(`Failed to load wechat token: ${(err as Error).message}`);
    }
    return null;
  }

  private saveToken(): void {
    if (!this.tokenInfo) return;
    try {
      const tokenPath = this.resolveTokenPath();
      const dir = path.dirname(tokenPath);
      if (!existsSync(dir)) {
        const fs = require('fs');
        fs.mkdirSync(dir, { recursive: true });
      }
      writeFileSync(tokenPath, JSON.stringify(this.tokenInfo, null, 2));
      log.info('Wechat token saved');
    } catch (err) {
      log.error(`Failed to save wechat token: ${(err as Error).message}`);
    }
  }

  private resolveTokenPath(): string {
    if (this.config.token_path.startsWith('~')) {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      return path.join(home, this.config.token_path.slice(1));
    }
    return this.config.token_path;
  }

  /**
   * 获取二维码用于扫码登录。
   * 需要从 login-qr.js 中提取具体的 API endpoint。
   *
   * 返回: { qrcodeUrl: string, pollToken: string }
   */
  async getLoginQR(): Promise<{ qrcodeUrl?: string; pollToken?: string }> {
    // TODO: 从 login-qr.js 中提取 iLink 身份认证 API
    log.warn('getLoginQR: iLink auth API endpoint not implemented yet');
    return {};
  }

  /**
   * 轮询扫码结果。
   * 用户扫码确认后，获取 Bearer token + baseUrl。
   */
  async waitForScan(pollToken: string): Promise<WechatToken> {
    // TODO: 从 login-qr.js 中提取轮询 API
    log.warn('waitForScan: iLink auth polling not implemented yet');
    throw new Error('Wechat QR scan not implemented yet');
  }

  /** 手动设置 token（跳过扫码流程） */
  setToken(token: WechatToken): void {
    this.tokenInfo = token;
    this.saveToken();
  }

  // ── 生命周期 ─────────────────────────────────────────────

  async start(): Promise<void> {
    // 尝试加载已保存的 token
    if (!this.tokenInfo) {
      this.tokenInfo = this.loadSavedToken();
    }

    if (!this.tokenInfo) {
      log.info('No wechat token found, waiting for QR code login');
      return;
    }

    this.running = true;
    this.startPolling();
    log.info('Wechat adapter started, polling...');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    log.info('Wechat adapter stopped');
  }

  async ping(): Promise<void> {
    // 微信没有 ping，getupdates 能正常返回就是健康
    await this.pollOnce();
  }

  // ── 长轮询 ───────────────────────────────────────────────

  private startPolling(): void {
    const interval = this.config.poll_interval_ms || 35000;
    this.pollTimer = setInterval(() => {
      this.pollOnce().catch((err) => {
        log.error(`Wechat poll error: ${err.message}`);
        this.handlePollError(err);
      });
    }, interval);

    // 立即执行第一次轮询
    this.pollOnce().catch(() => {});
  }

  private async pollOnce(): Promise<void> {
    if (!this.tokenInfo) return;

    const { token, baseUrl } = this.tokenInfo;

    const response = await fetch(`${baseUrl}/ilink/bot/getupdates`, {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify({
        get_updates_buf: this.getUpdatesBuf,
        base_info: {
          channel_version: '2.4.4',
          bot_agent: 'xuanji/1.0',
        },
      }),
    });

    const data = await response.json() as any;
    if (data.ret !== 0) {
      if (data.errcode === 'SESSION_EXPIRED') {
        log.warn('Wechat token expired, requiring re-auth');
        this.tokenInfo = null;
        this.stop();
      }
      throw new Error(`getupdates failed: ret=${data.ret} errcode=${data.errcode}`);
    }

    this.lastActivity = Date.now();
    this.getUpdatesBuf = data.get_updates_buf || '';

    // 处理消息
    for (const raw of data.msgs || []) {
      const msg = this.parseMessage(raw);
      if (msg) {
        this.messageHandler?.(msg);
      }
    }
  }

  // ── 消息解析 ─────────────────────────────────────────────

  private parseMessage(raw: any): PlatformMessage | null {
    if (!raw.from_user_id || !raw.item_list?.length) return null;

    // 提取文本
    let text = '';
    const attachments: any[] = [];

    for (const item of raw.item_list) {
      switch (item.type) {
        case 1: // TEXT
          text += item.text_item?.text || '';
          break;
        case 2: // IMAGE
          attachments.push({
            type: 'image' as const,
            url: item.image_item?.media?.full_url,
          });
          break;
        case 4: // FILE
          attachments.push({
            type: 'file' as const,
            name: item.file_item?.media?.name,
            url: item.file_item?.media?.full_url,
          });
          break;
        case 5: // VOICE
          attachments.push({ type: 'voice' as const });
          break;
      }
    }

    // 保存 context_token
    if (raw.context_token) {
      this.contextTokens.set(raw.from_user_id, raw.context_token);
    }

    return {
      id: raw.message_id,
      platform: 'wechat',
      userId: raw.from_user_id,
      chatId: raw.from_user_id,
      chatType: 'private',
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
      sessionKey: buildSessionKey({ platform: 'wechat', chatType: 'private', chatId: raw.from_user_id }),
      raw: { ...raw, context_token: raw.context_token },
    };
  }

  // ── 发送消息 ─────────────────────────────────────────────

  async sendText(options: { chatId: string; text: string; replyTo?: string }): Promise<string> {
    if (!this.tokenInfo) throw new Error('Wechat not authenticated');

    const { token, baseUrl } = this.tokenInfo;
    const contextToken = this.contextTokens.get(options.chatId) || '';
    const clientId = `xuanji-wechat-${randomUUID()}`;

    const body: any = {
      msg: {
        from_user_id: '',
        to_user_id: options.chatId,
        client_id: clientId,
        message_type: 0,
        message_state: 2, // FINISH
        item_list: [{ type: 1, text_item: { text: options.text } }],
      },
      base_info: { channel_version: '2.4.4', bot_agent: 'xuanji/1.0' },
    };

    if (contextToken) {
      body.msg.context_token = contextToken;
    }

    const response = await fetch(`${baseUrl}/ilink/bot/sendmessage`, {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify(body),
    });

    const data = await response.json() as any;
    if (data.ret !== 0) {
      throw new Error(`Wechat sendText failed: ret=${data.ret}`);
    }

    return data.msg_id || clientId;
  }

  async sendMarkdown(options: { chatId: string; content: string; replyTo?: string }): Promise<string> {
    // 微信不支持 Markdown，降级为纯文本
    const plainText = this.stripMarkdown(options.content);
    return this.sendText({ chatId: options.chatId, text: plainText, replyTo: options.replyTo });
  }

  async sendImage(options: { chatId: string; imagePath: string; replyTo?: string }): Promise<string> {
    throw new Error('Wechat sendImage not implemented yet');
  }

  onMessage(handler: (msg: PlatformMessage) => void): void {
    this.messageHandler = handler;
  }

  // ── 辅助 ─────────────────────────────────────────────────

  private buildHeaders(token: string): Record<string, string> {
    const uin = this.tokenInfo?.uin || this.randomUin();
    return {
      'iLink-App-Id': 'bot',
      'iLink-App-ClientVersion': String(VERSION),
      'AuthorizationType': 'ilink_bot_token',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-WECHAT-UIN': Buffer.from(uin).toString('base64'),
    };
  }

  private randomUin(): string {
    return String(Math.floor(Math.random() * 4294967295));
  }

  private stripMarkdown(text: string): string {
    return text
      .replace(/###?\s+/g, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .trim();
  }

  private handlePollError(err: Error): void {
    if (err.message.includes('SESSION_EXPIRED')) {
      log.warn('Wechat session expired, stopping poll');
      this.stop();
    }
    // 其他错误继续轮询
  }
}
