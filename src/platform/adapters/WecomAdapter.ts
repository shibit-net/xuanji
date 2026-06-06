/**
 * 企业微信 Adapter
 *
 * Webhook 接收 XML + AES 解密 → PlatformMessage
 * REST API 发送消息
 *
 * 设计文档：docs/platform-integration-design.md §5.1
 */

import { createHash, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { basename } from 'path';
import type { PlatformAdapter, PlatformMessage, WecomConfig } from '../types.js';
import type { WebhookHandler, WebhookRequest, WebhookResponse } from '../http/WebhookServer.js';
import { webhookOk, webhookError } from '../http/WebhookServer.js';
import { buildSessionKey } from '../SessionRouter.js';
import { logger } from '@/infrastructure/logger';
import { CredentialManager } from '../auth/CredentialManager.js';

const log = logger.child({ module: 'WecomAdapter' });

export class WecomAdapter implements PlatformAdapter {
  readonly platform = 'wecom' as const;
  lastActivity = 0;

  private messageHandler: ((msg: PlatformMessage) => void) | null = null;
  private _started = false;

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

    // 提取附件（图片/文件/语音/视频）
    const attachments: Array<{ type: 'image' | 'file' | 'voice' | 'audio' | 'video'; url?: string; name?: string; mimeType?: string }> = [];
    if (msgType === 'image') {
      const picUrl = this.xmlExtract(decrypted, 'PicUrl');
      attachments.push({ type: 'image', url: picUrl || undefined });
    } else if (msgType === 'file') {
      const fileName = this.xmlExtract(decrypted, 'FileName');
      const fileExt = this.xmlExtract(decrypted, 'FileExt');
      attachments.push({ type: 'file', name: fileName || undefined, mimeType: fileExt ? `application/${fileExt}` : undefined });
    } else if (msgType === 'voice') {
      const format = this.xmlExtract(decrypted, 'Format');
      attachments.push({ type: 'voice', mimeType: format ? `audio/${format}` : 'audio/amr' });
    } else if (msgType === 'video') {
      attachments.push({ type: 'video', mimeType: 'video/mp4' });
    }

    const msg: PlatformMessage = {
      id: msgId || `${Date.now()}`,
      platform: 'wecom',
      userId: fromUser,
      chatId,
      chatType: isGroup ? 'group' : 'private',
      text: content || '',
      attachments: attachments.length > 0 ? attachments : undefined,
      mentions: this.parseMentions(content || ''),
      sessionKey: buildSessionKey({ platform: 'wecom', chatType: isGroup ? 'group' : 'private', chatId }),
      raw: { xml: decrypted, msgType, agentId },
    };

    return msg;
  }

  // ── 发送消息 ─────────────────────────────────────────────

  async start(): Promise<void> {
    this._started = true;
    this.credentials.registerRefresher('wecom', () => this.doRefreshToken());
  }

  async stop(): Promise<void> {
    this._started = false;
    this.credentials.clearToken('wecom');
  }

  isConnected(): boolean {
    return this._started;
  }

  async ping(): Promise<void> {
    await this.credentials.getToken('wecom');
  }

  async sendText(options: { chatId: string; text: string; replyTo?: string }): Promise<string> {
    const token = await this.credentials.getToken('wecom');
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
    const token = await this.credentials.getToken('wecom');
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
    const token = await this.credentials.getToken('wecom');

    // 1. 上传图片获取 media_id
    const fileBuffer = readFileSync(options.imagePath);
    const fileName = basename(options.imagePath);
    const boundary = `--WecomUpload${Date.now()}`;

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=image`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      },
    );

    const uploadData = await uploadRes.json() as any;
    if (uploadData.errcode !== 0) {
      throw new Error(`Wecom image upload failed: ${uploadData.errmsg}`);
    }

    // 2. 发送图片消息
    const sendBody = {
      touser: options.chatId,
      msgtype: 'image',
      image: { media_id: uploadData.media_id },
      agentid: this.config.agent_id,
    };

    const sendRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sendBody),
      },
    );

    const sendData = await sendRes.json() as any;
    if (sendData.errcode !== 0) {
      throw new Error(`Wecom sendImage failed: ${sendData.errmsg}`);
    }

    return sendData.msgid || '';
  }

  onMessage(handler: (msg: PlatformMessage) => void): void {
    this.messageHandler = handler;
  }

  async sendFile(options: { chatId: string; filePath: string; fileName?: string; replyTo?: string }): Promise<string> {
    const token = await this.credentials.getToken('wecom');

    // 1. 上传文件获取 media_id
    const fileBuffer = readFileSync(options.filePath);
    const fileName = options.fileName || basename(options.filePath);
    const boundary = `--WecomUpload${Date.now()}`;

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=file`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      },
    );

    const uploadData = await uploadRes.json() as any;
    if (uploadData.errcode !== 0) {
      throw new Error(`Wecom file upload failed: ${uploadData.errmsg}`);
    }

    // 2. 发送文件消息
    const sendBody = {
      touser: options.chatId,
      msgtype: 'file',
      file: { media_id: uploadData.media_id },
      agentid: this.config.agent_id,
    };

    const sendRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sendBody),
      },
    );

    const sendData = await sendRes.json() as any;
    if (sendData.errcode !== 0) {
      throw new Error(`Wecom sendFile failed: ${sendData.errmsg}`);
    }

    return sendData.msgid || '';
  }

  async sendVoice(options: { chatId: string; voicePath: string; replyTo?: string }): Promise<string> {
    const token = await this.credentials.getToken('wecom');

    // 语音使用 type=voice 上传
    const fileBuffer = readFileSync(options.voicePath);
    const fileName = basename(options.voicePath);
    const boundary = `--WecomUpload${Date.now()}`;

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=voice`,
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      },
    );

    const uploadData = await uploadRes.json() as any;
    if (uploadData.errcode !== 0) {
      throw new Error(`Wecom voice upload failed: ${uploadData.errmsg}`);
    }

    const sendBody = {
      touser: options.chatId,
      msgtype: 'voice',
      voice: { media_id: uploadData.media_id },
      agentid: this.config.agent_id,
    };

    const sendRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sendBody),
      },
    );

    const sendData = await sendRes.json() as any;
    if (sendData.errcode !== 0) {
      throw new Error(`Wecom sendVoice failed: ${sendData.errmsg}`);
    }

    return sendData.msgid || '';
  }

  // ── Token 刷新（委托给 CredentialManager）──────────────────

  private async doRefreshToken(): Promise<{ token: string; expiresIn: number }> {
    const { corp_id, secret } = this.config;
    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corp_id}&corpsecret=${secret}`,
    );

    const data = await response.json() as any;
    if (data.errcode !== 0) {
      throw new Error(`Wecom gettoken failed: ${data.errmsg}`);
    }

    log.info('Wecom access token refreshed');
    return { token: data.access_token, expiresIn: data.expires_in };
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
