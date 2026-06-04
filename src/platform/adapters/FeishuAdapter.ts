/**
 * 飞书 Adapter
 *
 * 支持两种事件接收模式：
 *   webhook   — HTTP 回调（需要公网 IP），签名验证
 *   websocket — 长连接（无需公网 IP），使用飞书官方 SDK 的 WSClient
 *
 * 飞书独有功能：
 *   - 已读回执 (im.message.read_v1)
 *   - 消息撤回 (im.message.recalled_v1)
 *   - 用户资料自动丰富 (GET /contact/v3/users)
 *   - 正在输入 (sendTyping)
 *
 * REST API 发送消息 (tenant_access_token)
 *
 * 设计文档：docs/platform-integration-design.md §5.2
 */

import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { basename } from 'path';
import type { PlatformAdapter, PlatformMessage, FeishuConfig } from '../types.js';
import type { CredentialManager } from '../auth/CredentialManager.js';
import type { WebhookHandler, WebhookRequest, WebhookResponse } from '../http/WebhookServer.js';
import { webhookOk } from '../http/WebhookServer.js';
import { buildSessionKey } from '../SessionRouter.js';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'FeishuAdapter' });

export class FeishuAdapter implements PlatformAdapter {
  readonly platform = 'feishu' as const;
  lastActivity = 0;

  private messageHandler: ((msg: PlatformMessage) => void) | null = null;
  private credentials: CredentialManager;
  private receiveMode: 'webhook' | 'websocket';

  /** 官方 SDK WSClient 实例（WebSocket 模式） */
  private wsClient: any = null;
  private wsStarted = false;

  /** 用户资料缓存：userId → { name, avatar } */
  private userCache = new Map<string, { name: string; avatar?: string }>();

  constructor(private config: FeishuConfig, credentials: CredentialManager) {
    this.credentials = credentials;
    this.receiveMode = config.receive_mode || 'webhook';
  }

  // ── Webhook Handler ──────────────────────────────────────

  getWebhookHandler(): { path: string; handler: WebhookHandler } | null {
    if (this.receiveMode === 'websocket') return null;
    return {
      path: this.config.webhook_path || '/webhook/feishu',
      handler: async (req: WebhookRequest) => this.handleWebhook(req),
    };
  }

  private async handleWebhook(req: WebhookRequest): Promise<WebhookResponse> {
    this.lastActivity = Date.now();

    try {
      const body = JSON.parse(req.body);
      if (body.challenge) {
        return { statusCode: 200, body: JSON.stringify({ challenge: body.challenge }) };
      }

      const timestamp = (req.headers['x-lark-request-timestamp'] || '') as string;
      const nonce = (req.headers['x-lark-request-nonce'] || '') as string;
      const signature = (req.headers['x-lark-signature'] || '') as string;

      if (signature && !this.verifySignature(timestamp, nonce, req.body, signature)) {
        log.warn('Invalid feishu signature');
      }

      if (body.header?.event_type === 'im.message.receive_v1') {
        const msg = this.parseMessage(body);
        if (msg) {
          this.enrichAndForward(msg);
        }
      } else if (body.header?.event_type === 'im.message.read_v1') {
        this.handleReadReceipt(body.event || body);
      } else if (body.header?.event_type === 'im.message.recalled_v1') {
        this.handleRecall(body.event || body);
      }
    } catch (err) {
      log.error(`Feishu webhook error: ${(err as Error).message}`);
    }

    return webhookOk();
  }

  // ── WebSocket 长连接（使用官方 SDK WSClient）──────────────

  private async startWebSocket(): Promise<void> {
    if (this.wsStarted) return;

    try {
      const { WSClient, EventDispatcher, Domain, LoggerLevel } = await import('@larksuiteoapi/node-sdk');

      const eventDispatcher = new EventDispatcher({}).register({
        'im.message.receive_v1': (data: any) => {
          this.lastActivity = Date.now();
          log.debug(`Feishu WS message received: type=${data?.message?.message_type}, chatId=${data?.message?.chat_id}`);
          const msg = this.parseMessageFromSDK(data);
          if (msg) {
            this.enrichAndForward(msg);
          } else {
            log.warn('Feishu WS parseMessageFromSDK returned null, raw keys:', Object.keys(data || {}));
          }
        },
        'im.message.read_v1': (data: any) => {
          this.lastActivity = Date.now();
          this.handleReadReceipt(data);
        },
        'im.message.recalled_v1': (data: any) => {
          this.lastActivity = Date.now();
          this.handleRecall(data);
        },
      });

      this.wsClient = new WSClient({
        appId: this.config.app_id,
        appSecret: this.config.app_secret,
        domain: Domain.Feishu,
        loggerLevel: LoggerLevel.debug,
        autoReconnect: true,
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!this.wsStarted) {
            log.warn('Feishu WebSocket connection timeout (30s)');
            resolve();
          }
        }, 30000);

        this.wsClient.start({
          eventDispatcher,
          onReady: () => {
            clearTimeout(timeout);
            log.info('Feishu WebSocket connected via SDK WSClient (onReady)');
            this.wsStarted = true;
            this.lastActivity = Date.now();
            resolve();
          },
          onError: (err: Error) => {
            log.error(`Feishu WebSocket error: ${err.message}`);
          },
        });
      });
    } catch (err) {
      log.error(`Feishu WebSocket start failed: ${(err as Error).message}`, (err as Error).stack);
    }
  }

  private async stopWebSocket(): Promise<void> {
    this.wsStarted = false;
    try {
      const ws = this.wsClient?.wsConfig?.getWSInstance?.();
      if (ws) {
        ws.close();
      }
    } catch { /* ignore */ }
    this.wsClient = null;
  }

  // ── 用户资料 ─────────────────────────────────────────────

  async getUserProfile(options: { userId: string }): Promise<{ name: string; avatar?: string } | null> {
    const { userId } = options;
    // 先查缓存
    const cached = this.userCache.get(userId);
    if (cached) return cached;

    try {
      const token = await this.credentials.getToken('feishu');
      const response = await fetch(
        `https://open.feishu.cn/open-apis/contact/v3/users/${encodeURIComponent(userId)}?user_id_type=open_id`,
        {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
        },
      );
      const data = await response.json() as any;
      if (data.code === 0 && data.data?.user) {
        const user = data.data.user;
        const profile = {
          name: user.name || user.en_name || userId,
          avatar: user.avatar?.avatar_240 || user.avatar?.avatar_origin || user.avatar?.avatar_72,
        };
        this.userCache.set(userId, profile);
        return profile;
      }
    } catch (err) {
      log.warn(`Feishu getUserProfile failed: ${(err as Error).message}`);
    }
    return null;
  }

  /** 收到消息后自动丰富 userName，异步获取用户资料 */
  private enrichAndForward(msg: PlatformMessage): void {
    this.messageHandler?.(msg);
    // 异步补全用户名称
    this.enrichUserName(msg);
  }

  private async enrichUserName(msg: PlatformMessage): Promise<void> {
    if (msg.userName) return;
    const profile = await this.getUserProfile({ userId: msg.userId });
    if (profile?.name) {
      msg.userName = profile.name;
      // 再次推送，让 UI 层拿到带 userName 的消息
      this.messageHandler?.(msg);
    }
  }

  // ── 已读回执 ─────────────────────────────────────────────

  private handleReadReceipt(data: any): void {
    // SDK 展开后：data 的顶层可能包含 event 数据
    // im.message.read_v1 事件体：{ reader: { open_id, ... }, message_id_list: [...] }
    const readerId = data.reader?.open_id || data.reader?.user_id || data.user_id;
    const messageIds: string[] = data.message_id_list || [];
    if (!readerId || messageIds.length === 0) return;

    // 取第一个已读消息的 chatId 推导 sessionKey
    const chatId = data.chat_id || '';
    const chatType: 'private' | 'group' = data.chat_type === 'private' ? 'private' : 'group';

    if (messageIds[0]) {
      const sessionKey = buildSessionKey({ platform: 'feishu', chatType, chatId });
      this.messageHandler?.({
        id: `read_${messageIds[0]}_${readerId}`,
        platform: 'feishu',
        userId: readerId,
        chatId,
        chatType,
        text: '',
        sessionKey,
        eventType: 'read_receipt',
        readReceipt: {
          messageId: messageIds[0],
          userId: readerId,
          readTime: Date.now(),
        },
        raw: data,
      });
    }
  }

  // ── 消息撤回 ─────────────────────────────────────────────

  private handleRecall(data: any): void {
    // im.message.recalled_v1 事件体包含 recalled_message_id
    const recalledMessageId = data.recalled_message_id || data.message_id;
    const chatId = data.chat_id || '';
    const chatType: 'private' | 'group' = data.chat_type === 'private' ? 'private' : 'group';
    const recallInitiator = data.recall_initiator?.open_id || data.recall_initiator?.user_id || '';

    if (recalledMessageId) {
      const sessionKey = buildSessionKey({ platform: 'feishu', chatType, chatId });
      this.messageHandler?.({
        id: `recall_${recalledMessageId}`,
        platform: 'feishu',
        userId: recallInitiator,
        chatId,
        chatType,
        text: '',
        sessionKey,
        eventType: 'recall',
        recallMessageId: recalledMessageId,
        raw: data,
      });
    }
  }

  // ── 正在输入 ─────────────────────────────────────────────

  async sendTyping(options: { chatId: string }): Promise<void> {
    // 飞书没有专门的 typing API，这里用不到则跳过
    // 企微/微信支持 typing，飞书在此预留接口
  }

  // ── 消息解析 ─────────────────────────────────────────────

  /**
   * 解析 SDK WSClient 传入的事件（已由 RequestHandle.parse() 展开）
   * header/event 被展开到顶层，message/sender 不再嵌套在 event 下
   */
  private parseMessageFromSDK(data: any): PlatformMessage | null {
    return this.buildMessage(data, data.message, data.sender);
  }

  private parseMessage(event: any): PlatformMessage | null {
    const { event: ev } = event;
    if (!ev?.message || !ev?.sender) return null;
    return this.buildMessage(event, ev.message, ev.sender);
  }

  /** 统一的消息构建逻辑 */
  private buildMessage(raw: any, msg: any, sender: any): PlatformMessage | null {
    if (!msg || !sender) return null;
    const chatType: 'private' | 'group' = msg.chat_type === 'private' ? 'private' : 'group';

    let text = '';
    const attachments: Array<{ type: 'image' | 'file' | 'voice' | 'audio' | 'video'; url?: string; name?: string; mimeType?: string }> = [];
    try {
      const content = JSON.parse(msg.content);
      text = content.text || '';

      const msgType = msg.message_type;
      if (msgType === 'image') {
        attachments.push({ type: 'image', url: content.image_key ? `feishu://image/${content.image_key}` : undefined });
      } else if (msgType === 'file') {
        attachments.push({ type: 'file', url: content.file_key ? `feishu://file/${content.file_key}` : undefined, name: content.file_name, mimeType: 'application/octet-stream' });
      } else if (msgType === 'audio') {
        attachments.push({ type: 'audio', url: content.file_key ? `feishu://file/${content.file_key}` : undefined, mimeType: 'audio/ogg' });
      } else if (msgType === 'media') {
        attachments.push({ type: 'video', url: content.file_key ? `feishu://file/${content.file_key}` : undefined, mimeType: 'video/mp4' });
      }
    } catch {
      text = msg.content || '';
    }

    const mentions: string[] = (msg.mentions || []).map((m: any) => m.key || m.name || '');

    const userId = sender.sender_id?.open_id || sender.sender_id?.user_id || '';
    const userName = this.userCache.get(userId)?.name;

    return {
      id: msg.message_id,
      platform: 'feishu',
      userId,
      userName,
      chatId: msg.chat_id,
      chatType,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
      mentions,
      replyTo: msg.upper_message_id || undefined,
      sessionKey: buildSessionKey({ platform: 'feishu', chatType, chatId: msg.chat_id }),
      eventType: 'message',
      raw,
    };
  }

  // ── 签名验证 ─────────────────────────────────────────────

  private verifySignature(timestamp: string, nonce: string, body: string, signature: string): boolean {
    const signStr = timestamp + nonce + body;
    const expected = createHmac('sha256', this.config.app_secret).update(signStr).digest('base64');
    return expected === signature;
  }

  // ── 生命周期 ─────────────────────────────────────────────

  async start(): Promise<void> {
    this.credentials.registerRefresher('feishu', () => this.doRefreshToken());
    if (this.receiveMode === 'websocket') {
      await this.startWebSocket();
    }
  }

  async stop(): Promise<void> {
    this.credentials.clearToken('feishu');
    if (this.receiveMode === 'websocket') {
      await this.stopWebSocket();
    }
  }

  async ping(): Promise<void> {
    await this.credentials.getToken('feishu');
  }

  onMessage(handler: (msg: PlatformMessage) => void): void {
    this.messageHandler = handler;
  }

  async sendText(options: { chatId: string; text: string; replyTo?: string }): Promise<string> {
    const token = await this.credentials.getToken('feishu');
    const receiveIdType = options.chatId.startsWith('oc_') ? 'chat_id' : 'open_id';
    const body: Record<string, unknown> = {
      receive_id: options.chatId,
      msg_type: 'text',
      content: JSON.stringify({ text: options.text }),
    };

    const response = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
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
    const token = await this.credentials.getToken('feishu');
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

    const receiveIdType = options.chatId.startsWith('oc_') ? 'chat_id' : 'open_id';
    const response = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
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
    const token = await this.credentials.getToken('feishu');

    const fileBuffer = readFileSync(options.imagePath);
    const fileName = basename(options.imagePath);
    const boundary = `--FeishuUpload${Date.now()}`;

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image_type"\r\n\r\nmessage\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await fetch(
      'https://open.feishu.cn/open-apis/im/v1/images',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      },
    );

    const uploadData = await uploadRes.json() as any;
    if (uploadData.code !== 0) {
      throw new Error(`Feishu image upload failed: ${uploadData.msg}`);
    }

    const receiveIdType = options.chatId.startsWith('oc_') ? 'chat_id' : 'open_id';
    const sendBody = {
      receive_id: options.chatId,
      msg_type: 'image',
      content: JSON.stringify({ image_key: uploadData.data.image_key }),
    };

    const sendRes = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sendBody),
      },
    );

    const sendData = await sendRes.json() as any;
    if (sendData.code !== 0) {
      throw new Error(`Feishu sendImage failed: ${sendData.msg}`);
    }

    return sendData.data?.message_id || '';
  }

  async sendFile(options: { chatId: string; filePath: string; fileName?: string; replyTo?: string }): Promise<string> {
    const token = await this.credentials.getToken('feishu');

    const fileBuffer = readFileSync(options.filePath);
    const fileName = options.fileName || basename(options.filePath);
    const boundary = `--FeishuUpload${Date.now()}`;

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file_type"\r\n\r\nstream\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file_name"\r\n\r\n${fileName}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await fetch(
      'https://open.feishu.cn/open-apis/im/v1/files',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      },
    );

    const uploadData = await uploadRes.json() as any;
    if (uploadData.code !== 0) {
      throw new Error(`Feishu file upload failed: ${uploadData.msg}`);
    }

    const receiveIdType = options.chatId.startsWith('oc_') ? 'chat_id' : 'open_id';
    const sendBody = {
      receive_id: options.chatId,
      msg_type: 'file',
      content: JSON.stringify({ file_key: uploadData.data.file_key }),
    };

    const sendRes = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sendBody),
      },
    );

    const sendData = await sendRes.json() as any;
    if (sendData.code !== 0) {
      throw new Error(`Feishu sendFile failed: ${sendData.msg}`);
    }

    return sendData.data?.message_id || '';
  }

  async sendVoice(options: { chatId: string; voicePath: string; replyTo?: string }): Promise<string> {
    const token = await this.credentials.getToken('feishu');

    const fileBuffer = readFileSync(options.voicePath);
    const fileName = basename(options.voicePath);
    const boundary = `--FeishuUpload${Date.now()}`;

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file_type"\r\n\r\nstream\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file_name"\r\n\r\n${fileName}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadRes = await fetch(
      'https://open.feishu.cn/open-apis/im/v1/files',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      },
    );

    const uploadData = await uploadRes.json() as any;
    if (uploadData.code !== 0) {
      throw new Error(`Feishu voice upload failed: ${uploadData.msg}`);
    }

    const receiveIdType = options.chatId.startsWith('oc_') ? 'chat_id' : 'open_id';
    const sendBody = {
      receive_id: options.chatId,
      msg_type: 'audio',
      content: JSON.stringify({ file_key: uploadData.data.file_key }),
    };

    const sendRes = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sendBody),
      },
    );

    const sendData = await sendRes.json() as any;
    if (sendData.code !== 0) {
      throw new Error(`Feishu sendVoice failed: ${sendData.msg}`);
    }

    return sendData.data?.message_id || '';
  }

  // ── Token 刷新（委托给 CredentialManager）──────────────────

  private async doRefreshToken(): Promise<{ token: string; expiresIn: number }> {
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

    log.info('Feishu tenant access token refreshed');
    return { token: data.tenant_access_token, expiresIn: data.expire };
  }
}
