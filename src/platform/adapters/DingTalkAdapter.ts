/**
 * 钉钉 Adapter
 *
 * Webhook 接收 JSON + HMAC-SHA256 签名验证 → PlatformMessage
 * REST API 发送消息（优先使用 sessionWebhook）
 *
 * 设计文档：docs/platform-integration-design.md §5.3
 */

import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { basename } from 'path';
import type { PlatformAdapter, PlatformMessage, DingTalkConfig } from '../types.js';
import type { CredentialManager } from '../auth/CredentialManager.js';
import type { WebhookHandler, WebhookRequest, WebhookResponse } from '../http/WebhookServer.js';
import { webhookOk } from '../http/WebhookServer.js';
import { buildSessionKey } from '../SessionRouter.js';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'DingTalkAdapter' });

export class DingTalkAdapter implements PlatformAdapter {
  readonly platform = 'dingtalk' as const;
  lastActivity = 0;

  private messageHandler: ((msg: PlatformMessage) => void) | null = null;
  private credentials: CredentialManager;
  private sessionWebhooks = new Map<string, string>();

  constructor(private config: DingTalkConfig, credentials: CredentialManager) {
    this.credentials = credentials;
  }

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

      const timestamp = (req.headers['timestamp'] || '') as string;
      const sign = (req.headers['sign'] || '') as string;
      if (!this.verifySignature(timestamp, sign)) {
        log.warn('Invalid dingtalk signature');
      }

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
    const attachments: Array<{ type: 'image' | 'file' | 'voice' | 'audio' | 'video'; url?: string; name?: string; mimeType?: string }> = [];

    const msgType = body.msgtype || body.msgKey;
    if (msgType === 'picture' || body.pictureUrl) {
      attachments.push({ type: 'image', url: body.pictureUrl });
    } else if (msgType === 'file') {
      attachments.push({ type: 'file', url: body.file?.downloadCode ? `dingtalk://file/${body.file.downloadCode}` : undefined, name: body.file?.fileName, mimeType: body.file?.fileType });
    } else if (msgType === 'voice') {
      attachments.push({ type: 'voice', url: body.recognition ? `dingtalk://voice/${body.recognition}` : undefined, mimeType: 'audio/amr' });
    } else if (msgType === 'video' || msgType === 'shortVideo') {
      attachments.push({ type: 'video', url: body.video?.downloadCode ? `dingtalk://video/${body.video.downloadCode}` : undefined, name: `video.${body.video?.fileType || 'mp4'}`, mimeType: `video/${body.video?.fileType || 'mp4'}` });
    }

    return {
      id: body.msgId,
      platform: 'dingtalk',
      userId: body.senderId,
      userName: body.senderNick,
      chatId: body.conversationId,
      chatType,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
      mentions: body.isInAtList ? [body.chatbotUserId] : [],
      sessionKey: buildSessionKey({ platform: 'dingtalk', chatType, chatId: body.conversationId }),
      raw: { ...body, sessionWebhook: body.sessionWebhook },
    };
  }

  // ── 签名验证 ─────────────────────────────────────────────

  private verifySignature(timestamp: string, sign: string): boolean {
    if (!timestamp || !sign) return true;

    const { client_secret } = this.config;
    const stringToSign = `${timestamp}\n${client_secret}`;
    const expected = createHmac('sha256', client_secret).update(stringToSign).digest('base64');
    const encodedExpected = encodeURIComponent(expected);

    return sign === encodedExpected;
  }

  // ── 发送消息 ─────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.config.client_id && this.config.client_secret) {
      this.credentials.registerRefresher('dingtalk', () => this.doRefreshToken());
    }
  }

  async stop(): Promise<void> {
    this.credentials.clearToken('dingtalk');
    this.sessionWebhooks.clear();
  }

  async ping(): Promise<void> {
    // nop — token 懒加载
  }

  async sendText(options: { chatId: string; text: string; replyTo?: string }): Promise<string> {
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

    const token = await this.credentials.getToken('dingtalk');
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
    const token = await this.credentials.getToken('dingtalk');
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
    const token = await this.credentials.getToken('dingtalk');

    // 1. 上传图片获取 media_id
    const fileBuffer = readFileSync(options.imagePath);
    const fileName = basename(options.imagePath);
    const boundary = `--DingTalkUpload${Date.now()}`;

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await fetch(
      `https://oapi.dingtalk.com/media/upload?access_token=${token}&type=image`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      },
    );

    const uploadData = await uploadRes.json() as any;
    if (uploadData.errcode !== 0) {
      throw new Error(`DingTalk image upload failed: ${uploadData.errmsg}`);
    }

    // 2. 发送图片消息
    const sendBody = {
      robotCode: `ding_${this.config.client_id}`,
      userId: options.chatId,
      msgKey: 'sampleImageMsg',
      msgParam: JSON.stringify({ media_id: uploadData.media_id }),
    };

    const sendRes = await fetch('https://oapi.dingtalk.com/v1.0/robot/botSend', {
      method: 'POST',
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sendBody),
    });

    const sendData = await sendRes.json() as any;
    if (!sendRes.ok) {
      throw new Error(`DingTalk sendImage failed: ${JSON.stringify(sendData)}`);
    }
    return sendData.processQueryKey || '';
  }

  onMessage(handler: (msg: PlatformMessage) => void): void {
    this.messageHandler = handler;
  }

  async sendFile(options: { chatId: string; filePath: string; fileName?: string; replyTo?: string }): Promise<string> {
    const token = await this.credentials.getToken('dingtalk');

    // 1. 上传文件获取 media_id
    const fileBuffer = readFileSync(options.filePath);
    const fileName = options.fileName || basename(options.filePath);
    const boundary = `--DingTalkUpload${Date.now()}`;

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await fetch(
      `https://oapi.dingtalk.com/media/upload?access_token=${token}&type=file`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      },
    );

    const uploadData = await uploadRes.json() as any;
    if (uploadData.errcode !== 0) {
      throw new Error(`DingTalk file upload failed: ${uploadData.errmsg}`);
    }

    // 2. 发送文件消息（使用 sessionWebhook 优先）
    const sessionWebhook = this.sessionWebhooks.get(options.chatId);
    if (sessionWebhook) {
      const response = await fetch(sessionWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'file',
          file: { media_id: uploadData.media_id },
        }),
      });
      const data = await response.json() as any;
      if (data.errcode) throw new Error(`DingTalk sendFile via webhook failed: ${data.errmsg}`);
      return data.msgid || '';
    }

    const sendBody = {
      robotCode: `ding_${this.config.client_id}`,
      userId: options.chatId,
      msgKey: 'sampleFile',
      msgParam: JSON.stringify({ media_id: uploadData.media_id, fileName }),
    };

    const sendRes = await fetch('https://oapi.dingtalk.com/v1.0/robot/botSend', {
      method: 'POST',
      headers: {
        'x-acs-dingtalk-access-token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(sendBody),
    });

    const sendData = await sendRes.json() as any;
    if (!sendRes.ok) throw new Error(`DingTalk sendFile failed: ${JSON.stringify(sendData)}`);
    return sendData.processQueryKey || '';
  }

  async sendVoice(options: { chatId: string; voicePath: string; replyTo?: string }): Promise<string> {
    return this.sendFile({ chatId: options.chatId, filePath: options.voicePath, replyTo: options.replyTo });
  }

  // ── Token 刷新（委托给 CredentialManager）──────────────────

  private async doRefreshToken(): Promise<{ token: string; expiresIn: number }> {
    const { client_id, client_secret } = this.config;
    const response = await fetch(
      `https://oapi.dingtalk.com/gettoken?appkey=${client_id}&appsecret=${client_secret}`,
    );

    const data = await response.json() as any;
    if (data.errcode !== 0) {
      throw new Error(`DingTalk gettoken failed: ${data.errmsg}`);
    }

    log.info('DingTalk access token refreshed');
    return { token: data.access_token, expiresIn: data.expires_in };
  }
}
