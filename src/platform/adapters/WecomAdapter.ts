/**
 * 企业微信 Adapter
 *
 * Webhook 接收 XML + AES 解密 → PlatformMessage
 * REST API 发送消息
 *
 * 设计文档：docs/platform-integration-design.md §5.1
 */

import { createHash, createDecipheriv, randomBytes } from 'crypto';
import type { PlatformAdapter, PlatformMessage, WecomConfig } from '../types.js';
import type { WebhookHandler, WebhookRequest, WebhookResponse } from '../http/WebhookServer.js';
import { webhookOk, webhookError } from '../http/WebhookServer.js';
import { buildSessionKey } from '../SessionRouter.js';
import { logger } from '@/core/logger';
import { CredentialManager } from '../auth/CredentialManager.js';

const log = logger.child({ module: 'WecomAdapter' });

export class WecomAdapter implements PlatformAdapter {
  readonly platform = 'wecom' as const;
  lastActivity = 0;

  private messageHandler: ((msg: PlatformMessage) => void) | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private config: WecomConfig,
    private credentials: CredentialManager,
  ) {}

  // ── Webhook Handler ──────────────────────────────────────

  getWebhookHandler(): { path: string; handler: WebhookHandler } {
    return {
      path: this.config.webhook_path || '/webhook/wecom',
      handler: async (req: WebhookRequest) => this.handleWebhook(req),
    };
  }

  private async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    this.lastActivity = Date.now();

    // URL 验证（首次配置时企微会发 GET 请求验证 URL）
    const url = new URL(req.path, 'http://localhost');
    const echostr = url.searchParams.get('echostr');
    if (echostr) {
      return this.handleUrlVerification(req, echostr);
    }

    try {
      // 解析 XML，解密消息
      const msg = await this.parseMessage(req);
      if (msg) {
        this.messageHandler?.(msg);
      }
    } catch (err) {
      log.error(`Failed to parse wecom message: ${(err as Error).message}`);
    }

    return webhookOk();
  }

  // ── URL 验证 ─────────────────────────────────────────────

  private handleUrlVerification(req: WebhookRequest, echostr: string): WebhookResponse {
    const url = new URL(req.path, 'http://localhost');
    const msgSignature = url.searchParams.get('msg_signature') || '';
    const timestamp = url.searchParams.get('timestamp') || '';
    const nonce = url.searchParams.get('nonce') || '';

    const { token, encoding_aes_key } = this.config;
    const signature = this.generateSignature(token, timestamp, nonce, echostr);

    if (signature !== msgSignature) {
      return webhookError(403, 'Invalid signature');
    }

    const decrypted = this.aesDecrypt(echostr, encoding_aes_key);
    return webhookOk(decrypted);
  }

  // ── 消息解析 ─────────────────────────────────────────────

  private async parseMessage(req: WebhookRequest): Promise<PlatformMessage | null> {
    const url = new URL(req.path, 'http://localhost');
    const msgSignature = url.searchParams.get('msg_signature') || '';
    const timestamp = url.searchParams.get('timestamp') || '';
    const nonce = url.searchParams.get('nonce') || '';

    // 从 XML body 中提取 Encrypt 字段
    const encryptMatch = req.body.match(/<Encrypt><!\[CDATA\[(.*?)\]\]><\/Encrypt>/);
    if (!encryptMatch) {
      log.warn('No Encrypt field in wecom XML body');
      return null;
    }

    const encrypted = encryptMatch[1];
    const { token, encoding_aes_key, corp_id } = this.config;

    // 验证签名
    const signature = this.generateSignature(token, timestamp, nonce, encrypted);
    if (signature !== msgSignature) {
      log.warn('Invalid wecom message signature');
      return null;
    }

    // 解密
    const decrypted = this.aesDecrypt(encrypted, encoding_aes_key);

    // 解析 XML → 提取字段
    const msgType = this.xmlExtract(decrypted, 'MsgType');
    const fromUser = this.xmlExtract(decrypted, 'FromUserName');
    const content = this.xmlExtract(decrypted, 'Content');
    const msgId = this.xmlExtract(decrypted, 'MsgId');
    const chatId = this.xmlExtract(decrypted, 'ChatId') || fromUser;
    const agentId = this.xmlExtract(decrypted, 'AgentID');

    if (!fromUser || !msgType) return null;

    const isGroup = !!chatId && chatId !== fromUser;

    const msg: PlatformMessage = {
      id: msgId || `${Date.now()}`,
      platform: 'wecom',
      userId: fromUser,
      chatId,
      chatType: isGroup ? 'group' : 'private',
      text: content || '',
      mentions: this.parseMentions(content || ''),
      sessionKey: buildSessionKey({ platform: 'wecom', chatType: isGroup ? 'group' : 'private', chatId }),
      raw: { xml: decrypted, msgType, agentId },
    };

    return msg;
  }

  // ── 发送消息 ─────────────────────────────────────────────

  async start(): Promise<void> {
    await this.refreshToken();
  }

  async stop(): Promise<void> {
    this.accessToken = null;
  }

  async ping(): Promise<void> {
    await this.ensureToken();
  }

  async sendText(options: { chatId: string; text: string; replyTo?: string }): Promise<string> {
    const token = await this.ensureToken();
    const body: Record<string, unknown> = {
      touser: options.chatId,
      msgtype: 'text',
      text: { content: options.text },
      agentid: this.config.agent_id,
    };

    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    const data = await response.json() as any;
    if (data.errcode !== 0) {
      throw new Error(`Wecom sendText failed: ${data.errmsg} (errcode=${data.errcode})`);
    }

    return data.msgid || '';
  }

  async sendMarkdown(options: { chatId: string; content: string; replyTo?: string }): Promise<string> {
    const token = await this.ensureToken();
    const body = {
      touser: options.chatId,
      msgtype: 'markdown',
      markdown: { content: options.content },
      agentid: this.config.agent_id,
    };

    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    const data = await response.json() as any;
    if (data.errcode !== 0) {
      throw new Error(`Wecom sendMarkdown failed: ${data.errmsg}`);
    }

    return data.msgid || '';
  }

  async sendImage(options: { chatId: string; imagePath: string; replyTo?: string }): Promise<string> {
    // 图片需要先上传获取 media_id
    throw new Error('Wecom sendImage not implemented yet');
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
      throw new Error('Failed to get wecom access token');
    }
    return this.accessToken;
  }

  private async refreshToken(): Promise<void> {
    const { corp_id, secret } = this.config;
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corp_id}&corpsecret=${secret}`,
    );

    const data = await response.json() as any;
    if (data.errcode !== 0) {
      throw new Error(`Wecom gettoken failed: ${data.errmsg}`);
    }

    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    log.info('Wecom access token refreshed');
  }

  // ── 辅助函数 ─────────────────────────────────────────────

  private generateSignature(token: string, timestamp: string, nonce: string, encrypt: string): string {
    const sorted = [token, timestamp, nonce, encrypt].sort().join('');
    return createHash('sha1').update(sorted).digest('hex');
  }

  private aesDecrypt(encrypted: string, key: string): string {
    const keyBuffer = Buffer.from(key + '=', 'base64');
    const iv = keyBuffer.subarray(0, 16);
    const decipher = createDecipheriv('aes-256-cbc', keyBuffer, iv);
    decipher.setAutoPadding(false);

    let decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ]);

    // 去除 padding（PKCS#7）
    const padLen = decrypted[decrypted.length - 1];
    decrypted = decrypted.subarray(0, decrypted.length - padLen);

    // 格式: random(16) + msgLen(4) + msg + corpid
    const msgLen = decrypted.readUInt32BE(16);
    const msg = decrypted.subarray(20, 20 + msgLen).toString('utf-8');

    return msg;
  }

  private xmlExtract(xml: string, tag: string): string {
    const match = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 's'));
    return match ? match[1] : '';
  }

  private parseMentions(content: string): string[] {
    const mentions: string[] = [];
    const regex = /@([^\s@]+)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      mentions.push(match[1]);
    }
    return mentions;
  }
}
