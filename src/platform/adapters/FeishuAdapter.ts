/**
 * 飞书 Adapter
 *
 * 支持两种事件接收模式：
 *   webhook   — HTTP 回调（需要公网 IP），签名验证
 *   websocket — 长连接（无需公网 IP），建连时鉴权
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

/** WebSocket 长连接端点 */
const WS_ENDPOINT = 'wss://open.feishu.cn/ws/v2';

/** 重连间隔（毫秒），指数退避上限 */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60_000;

export class FeishuAdapter implements PlatformAdapter {
  readonly platform = 'feishu' as const;
  lastActivity = 0;

  private messageHandler: ((msg: PlatformMessage) => void) | null = null;
  private credentials: CredentialManager;
  private receiveMode: 'webhook' | 'websocket';

  /** WebSocket 连接相关 */
  private ws: import('ws').WebSocket | null = null;
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsReconnectDelay = RECONNECT_BASE_MS;
  private wsStopped = false;

  constructor(private config: FeishuConfig, credentials: CredentialManager) {
    this.credentials = credentials;
    this.receiveMode = config.receive_mode || 'webhook';
  }

  // ── Webhook Handler ──────────────────────────────────────

  getWebhookHandler(): { path: string; handler: WebhookHandler } | null {
    // WebSocket 模式下不注册 Webhook handler
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
          this.messageHandler?.(msg);
        }
      }
    } catch (err) {
      log.error(`Feishu webhook error: ${(err as Error).message}`);
    }

    return webhookOk();
  }

  // ── WebSocket 长连接 ─────────────────────────────────────

  /** 获取 app_access_token（WebSocket 建连鉴权用，非 tenant_access_token） */
  private async getAppAccessToken(): Promise<string> {
    const { app_id, app_secret } = this.config;
    const response = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id, app_secret }),
      },
    );
    const data = await response.json() as any;
    if (data.code !== 0) {
      throw new Error(`Feishu app_access_token failed: ${data.msg} (code=${data.code})`);
    }
    return data.app_access_token;
  }

  /** 建立 WebSocket 连接并接收事件 */
  private async connectWebSocket(): Promise<void> {
    if (this.wsStopped) return;

    try {
      const token = await this.getAppAccessToken();
      const url = `${WS_ENDPOINT}?app_id=${this.config.app_id}&access_token=${token}`;
      log.info(`Feishu WebSocket connecting...`);

      // 动态导入 ws 包（桌面端已安装，避免服务端依赖）
      let WS: typeof import('ws').default;
      try {
        WS = (await import('ws')).default;
      } catch {
        WS = (await import('ws')).WebSocket as any;
      }

      const ws = new WS(url) as import('ws').WebSocket;
      this.ws = ws;

      ws.on('open', () => {
        log.info('Feishu WebSocket connected');
        this.lastActivity = Date.now();
        this.wsReconnectDelay = RECONNECT_BASE_MS;
      });

      ws.on('message', (raw: Buffer) => {
        this.lastActivity = Date.now();
        try {
          const event = JSON.parse(raw.toString());
          this.handleWSEvent(event);
        } catch (err) {
          log.error(`Feishu WS message parse error: ${(err as Error).message}`);
        }
      });

      ws.on('close', (code: number) => {
        log.warn(`Feishu WebSocket closed (code=${code})`);
        this.ws = null;
        this.scheduleReconnect();
      });

      ws.on('error', (err: Error) => {
        log.error(`Feishu WebSocket error: ${err.message}`);
        this.ws?.close();
        this.ws = null;
        this.scheduleReconnect();
      });

      // 心跳保活：每 30 秒发送 ping（飞书服务端要求）
      const pingInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          ws.ping();
        }
      }, 30_000);

      ws.on('close', () => clearInterval(pingInterval));
      ws.on('error', () => clearInterval(pingInterval));
    } catch (err) {
      log.error(`Feishu WebSocket connect failed: ${(err as Error).message}`);
      this.scheduleReconnect();
    }
  }

  /** 处理 WebSocket 事件消息 */
  private handleWSEvent(event: any): void {
    // WebSocket 长连接推送的事件格式与 Webhook 一致
    if (event.header?.event_type === 'im.message.receive_v1') {
      const msg = this.parseMessage(event);
      if (msg) {
        this.messageHandler?.(msg);
      }
    }
  }

  /** 指数退避重连 */
  private scheduleReconnect(): void {
    if (this.wsStopped) return;
    if (this.wsReconnectTimer) clearTimeout(this.wsReconnectTimer);

    const delay = this.wsReconnectDelay;
    log.info(`Feishu WebSocket reconnecting in ${delay}ms...`);
    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      this.wsReconnectDelay = Math.min(this.wsReconnectDelay * 2, RECONNECT_MAX_MS);
      this.connectWebSocket();
    }, delay);
  }

  /** 断开 WebSocket 连接 */
  private disconnectWebSocket(): void {
    this.wsStopped = true;
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ── 消息解析 ─────────────────────────────────────────────

  private parseMessage(event: any): PlatformMessage | null {
    const { event: ev } = event;
    if (!ev?.message || !ev?.sender) return null;

    const msg = ev.message;
    const sender = ev.sender;
    const chatType: 'private' | 'group' = msg.chat_type === 'private' ? 'private' : 'group';

    let text = '';
    const attachments: Array<{ type: 'image' | 'file' | 'voice' | 'audio' | 'video'; url?: string; name?: string; mimeType?: string }> = [];
    try {
      const content = JSON.parse(msg.content);
      text = content.text || '';

      // 根据消息类型提取附件
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

    return {
      id: msg.message_id,
      platform: 'feishu',
      userId: sender.sender_id?.open_id || sender.sender_id?.user_id || '',
      chatId: msg.chat_id,
      chatType,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
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

  // ── 生命周期 ─────────────────────────────────────────────

  async start(): Promise<void> {
    this.credentials.registerRefresher('feishu', () => this.doRefreshToken());
    if (this.receiveMode === 'websocket') {
      this.wsStopped = false;
      this.connectWebSocket();
    }
  }

  async stop(): Promise<void> {
    this.credentials.clearToken('feishu');
    if (this.receiveMode === 'websocket') {
      this.disconnectWebSocket();
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
    const token = await this.credentials.getToken('feishu');

    // 1. 上传图片获取 image_key
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

    // 2. 发送图片消息
    const sendBody = {
      receive_id: options.chatId,
      msg_type: 'image',
      content: JSON.stringify({ image_key: uploadData.data.image_key }),
    };

    const sendRes = await fetch(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
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

    // 1. 上传文件获取 file_key
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

    // 2. 发送文件消息
    const sendBody = {
      receive_id: options.chatId,
      msg_type: 'file',
      content: JSON.stringify({ file_key: uploadData.data.file_key }),
    };

    const sendRes = await fetch(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
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
    // 飞书音频使用 file 上传接口，发送时 msg_type='audio'
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

    const sendBody = {
      receive_id: options.chatId,
      msg_type: 'audio',
      content: JSON.stringify({ file_key: uploadData.data.file_key }),
    };

    const sendRes = await fetch(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
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
