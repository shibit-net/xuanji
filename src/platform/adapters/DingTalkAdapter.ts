/**
 * 钉钉 Adapter
 *
 * Webhook 接收 JSON + HMAC-SHA256 签名验证 → PlatformMessage
 * REST API 发送消息（优先使用 sessionWebhook）
 *
 * 设计文档：docs/platform-integration-design.md §5.3
 */

import { createHmac } from 'crypto';
import type { PlatformAdapter, PlatformMessage, DingTalkConfig } from '../types.js';
import type { WebhookHandler, WebhookRequest, WebhookResponse } from '../http/WebhookServer.js';
import { webhookOk, webhookError } from '../http/WebhookServer.js';
import { buildSessionKey } from '../SessionRouter.js';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'DingTalkAdapter' });

export class DingTalkAdapter implements PlatformAdapter {
  readonly platform = 'dingtalk' as const;
  lastActivity = 0;

  private messageHandler: ((msg: PlatformMessage) => void) | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private sessionWebhooks = new Map<string, string>();

  constructor(private config: DingTalkConfig) {}

  // ── Webhook Handler ──────────────────────────────────────

  getWebhookHandler(): { path: string; handler: WebhookHandler } {
    return {
      path: this.config.webhook_path || '/webhook/dingtalk',
      handler: async (req: WebhookRequest) => this.handleWebhook(req),
    };
  }

  private async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    this.lastActivity = Date.now();

    try {
      const body = JSON.parse(req.body);

      // 验证签名
      const timestamp = (req.headers['timestamp'] || '') as string;
      const sign = (req.headers['sign'] || '') as string;
      if (!this.verifySignature(timestamp, sign)) {
        log.warn('Invalid dingtalk signature');
      }

      // 保存 sessionWebhook 用于回复
      if (body.sessionWebhook) {
        this.sessionWebhooks.set(body.conversationId, body.sessionWebhook);
      }

      const msg = this.parseMessage(body);
      if (msg) {
        this.messageHandler?.(msg);
      }
    } catch (err) {
      log.error(`DingTalk webhook error: ${(err as Error).message}`);
    }

    return webhookOk();
  }

  // ── 消息解析 ─────────────────────────────────────────────

  private parseMessage(body: any): PlatformMessage | null {
    if (!body.msgId || !body.senderId) return null;

    const chatType: 'private' | 'group' = body.conversationType === '1' ? 'private' : 'group';
    const text = body.text?.content || '';

    return {
      id: body.msgId,
      platform: 'dingtalk',
      userId: body.senderId,
      userName: body.senderNick,
      chatId: body.conversationId,
      chatType,
      text,
      mentions: body.isInAtList ? [body.chatbotUserId] : [],
      sessionKey: buildSessionKey({ platform: 'dingtalk', chatType, chatId: body.conversationId }),
      raw: { ...body, sessionWebhook: body.sessionWebhook },
    };
  }

  // ── 签名验证 ─────────────────────────────────────────────

  private verifySignature(timestamp: string, sign: string): boolean {
    if (!timestamp || !sign) return true; // 测试模式跳过验证

    const { client_secret } = this.config;
    const stringToSign = `${timestamp}\n${client_secret}`;
    const expected = createHmac('sha256', client_secret).update(stringToSign).digest('base64');
    const encodedExpected = encodeURIComponent(expected);

    return sign === encodedExpected;
  }

  // ── 发送消息 ─────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.config.client_id && this.config.client_secret) {
      await this.refreshToken();
    }
  }

  async stop(): Promise<void> {
    this.accessToken = null;
    this.sessionWebhooks.clear();
  }

  async ping(): Promise<void> {
    // 钉钉没有专门的 ping 接口
  }

  async sendText(options: { chatId: string; text: string; replyTo?: string }): Promise<string> {
    // 优先使用 sessionWebhook（方式一：简易回复）
    const sessionWebhook = this.sessionWebhooks.get(options.chatId);
    if (sessionWebhook) {
      const response = await fetch(sessionWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'text',
          text: { content: options.text },
        }),
      });

      const data = await response.json() as any;
      if (data.errcode) {
        throw new Error(`DingTalk sendText via webhook failed: ${data.errmsg}`);
      }
      return data.msgid || '';
    }

    // 方式二：使用 token 主动推送
    const token = await this.ensureToken();
    const body = {
      robotCode: `ding_${this.config.client_id}`,
      userId: options.chatId,
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content: options.text }),
    };

    const response = await fetch('https://oapi.dingtalk.com/v1.0/robot/botSend', {
      method: 'POST',
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as any;
    if (!response.ok) {
      throw new Error(`DingTalk sendText failed: ${JSON.stringify(data)}`);
    }
    return data.processQueryKey || '';
  }

  async sendMarkdown(options: { chatId: string; content: string; replyTo?: string }): Promise<string> {
    const token = await this.ensureToken();
    const body = {
      robotCode: `ding_${this.config.client_id}`,
      userId: options.chatId,
      msgKey: 'sampleMarkdown',
      msgParam: JSON.stringify({ title: 'xuanji', text: options.content }),
    };

    const response = await fetch('https://oapi.dingtalk.com/v1.0/robot/botSend', {
      method: 'POST',
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as any;
    if (!response.ok) {
      throw new Error(`DingTalk sendMarkdown failed: ${JSON.stringify(data)}`);
    }
    return data.processQueryKey || '';
  }

  async sendImage(options: { chatId: string; imagePath: string; replyTo?: string }): Promise<string> {
    throw new Error('DingTalk sendImage not implemented yet');
  }

  onMessage(handler: (msg: PlatformMessage) => void): void {
    this.messageHandler = handler;
  }

  // ── Token 管理 ───────────────────────────────────────────

  private async ensureToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 300_000) {
      return this.accessToken;
    }
    await this.refreshToken();
    if (!this.accessToken) {
      throw new Error('Failed to get dingtalk access token');
    }
    return this.accessToken;
  }

  private async refreshToken(): Promise<void> {
    // 钉钉 access_token 获取方式因版本而异
    // 旧版: https://oapi.dingtalk.com/gettoken
    const { client_id, client_secret } = this.config;
    const response = await fetch(
      `https://oapi.dingtalk.com/gettoken?appkey=${client_id}&appsecret=${client_secret}`,
    );

    const data = await response.json() as any;
    if (data.errcode !== 0) {
      throw new Error(`DingTalk gettoken failed: ${data.errmsg}`);
    }

    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    log.info('DingTalk access token refreshed');
  }
}
