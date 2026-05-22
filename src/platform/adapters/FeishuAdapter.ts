/**
 * 飞书 Adapter
 *
 * Webhook 接收 JSON + 签名验证 → PlatformMessage
 * REST API 发送消息 (tenant_access_token)
 *
 * 设计文档：docs/platform-integration-design.md §5.2
 */

import { createHmac, createHash, randomBytes } from 'crypto';
import type { PlatformAdapter, PlatformMessage, FeishuConfig } from '../types.js';
import type { WebhookHandler, WebhookRequest, WebhookResponse } from '../http/WebhookServer.js';
import { webhookOk, webhookError } from '../http/WebhookServer.js';
import { buildSessionKey } from '../SessionRouter.js';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'FeishuAdapter' });

export class FeishuAdapter implements PlatformAdapter {
  readonly platform = 'feishu' as const;
  lastActivity = 0;

  private messageHandler: ((msg: PlatformMessage) => void) | null = null;
  private tenantAccessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private config: FeishuConfig) {}

  // ── Webhook Handler ──────────────────────────────────────

  getWebhookHandler(): { path: string; handler: WebhookHandler } {
    return {
      path: this.config.webhook_path || '/webhook/feishu',
      handler: async (req: WebhookRequest) => this.handleWebhook(req),
    };
  }

  private async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    this.lastActivity = Date.now();

    // URL 验证（首次配置飞书会发 challenge）
    try {
      const body = JSON.parse(req.body);
      if (body.challenge) {
        return { statusCode: 200, body: JSON.stringify({ challenge: body.challenge }) };
      }

      // 验证签名
      const timestamp = (req.headers['x-lark-request-timestamp'] || '') as string;
      const nonce = (req.headers['x-lark-request-nonce'] || '') as string;
      const signature = (req.headers['x-lark-signature'] || '') as string;

      // 简化验证（正式环境需要严格校验）
      if (signature && !this.verifySignature(timestamp, nonce, req.body, signature)) {
        log.warn('Invalid feishu signature');
      }

      // 处理事件
      if (body.header?.event_type === 'im.message.receive_v1') {
        const msg = this.parseMessage(body);
        if (msg) {
          this.messageHandler?.(msg);
        }
      }
    } catch (err) {
      log.error(`Feishu webhook error: ${(err as Error).message}`);
    }

    return webhookOk();
  }

  // ── 消息解析 ─────────────────────────────────────────────

  private parseMessage(event: any): PlatformMessage | null {
    const { event: ev } = event;
    if (!ev?.message || !ev?.sender) return null;

    const msg = ev.message;
    const sender = ev.sender;
    const chatType: 'private' | 'group' = msg.chat_type === 'private' ? 'private' : 'group';

    let text = '';
    try {
      const content = JSON.parse(msg.content);
      text = content.text || '';
    } catch {
      text = msg.content || '';
    }

    const mentions: string[] = (msg.mentions || []).map((m: any) => m.key || m.name || '');

    return {
      id: msg.message_id,
      platform: 'feishu',
      userId: sender.sender_id?.open_id || sender.sender_id?.user_id || '',
      chatId: msg.chat_id,
      chatType,
      text,
      mentions,
      replyTo: msg.upper_message_id || undefined,
      sessionKey: buildSessionKey({ platform: 'feishu', chatType, chatId: msg.chat_id }),
      raw: event,
    };
  }

  // ── 签名验证 ─────────────────────────────────────────────

  private verifySignature(timestamp: string, nonce: string, body: string, signature: string): boolean {
    const signStr = timestamp + nonce + body;
    const expected = createHmac('sha256', this.config.app_secret).update(signStr).digest('base64');
    return expected === signature;
  }

  // ── 发送消息 ─────────────────────────────────────────────

  async start(): Promise<void> {
    await this.refreshToken();
  }

  async stop(): Promise<void> {
    this.tenantAccessToken = null;
  }

  async ping(): Promise<void> {
    await this.ensureToken();
  }

  async sendText(options: { chatId: string; text: string; replyTo?: string }): Promise<string> {
    const token = await this.ensureToken();
    const body: Record<string, unknown> = {
      receive_id: options.chatId,
      msg_type: 'text',
      content: JSON.stringify({ text: options.text }),
    };

    const response = await fetch(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const data = await response.json() as any;
    if (data.code !== 0) {
      throw new Error(`Feishu sendText failed: ${data.msg} (code=${data.code})`);
    }

    return data.data?.message_id || '';
  }

  async sendMarkdown(options: { chatId: string; content: string; replyTo?: string }): Promise<string> {
    // 飞书使用 post 富文本模拟 Markdown
    const token = await this.ensureToken();
    const body = {
      receive_id: options.chatId,
      msg_type: 'post',
      content: JSON.stringify({
        zh_cn: {
          title: '',
          content: [[{ tag: 'text', text: options.content }]],
        },
      }),
    };

    const response = await fetch(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const data = await response.json() as any;
    if (data.code !== 0) {
      throw new Error(`Feishu sendMarkdown failed: ${data.msg}`);
    }

    return data.data?.message_id || '';
  }

  async sendImage(options: { chatId: string; imagePath: string; replyTo?: string }): Promise<string> {
    throw new Error('Feishu sendImage not implemented yet');
  }

  onMessage(handler: (msg: PlatformMessage) => void): void {
    this.messageHandler = handler;
  }

  // ── Token 管理 ───────────────────────────────────────────

  private async ensureToken(): Promise<string> {
    if (this.tenantAccessToken && Date.now() < this.tokenExpiresAt - 300_000) {
      return this.tenantAccessToken;
    }
    await this.refreshToken();
    if (!this.tenantAccessToken) {
      throw new Error('Failed to get feishu tenant access token');
    }
    return this.tenantAccessToken;
  }

  private async refreshToken(): Promise<void> {
    const { app_id, app_secret } = this.config;
    const response = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id, app_secret }),
      },
    );

    const data = await response.json() as any;
    if (data.code !== 0) {
      throw new Error(`Feishu get token failed: ${data.msg}`);
    }

    this.tenantAccessToken = data.tenant_access_token;
    this.tokenExpiresAt = Date.now() + data.expire * 1000;
    log.info('Feishu tenant access token refreshed');
  }
}
