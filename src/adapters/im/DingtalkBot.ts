// ============================================================
// IM 适配器 — 钉钉机器人 (WebSocket Stream 模式)
// ============================================================
//
// 钉钉 Stream 模式文档:
// https://open.dingtalk.com/document/direction/stream-mode-connection-protocol
//
// 流程:
// 1. POST /v1.0/gateway/connections/open → 获取 WebSocket endpoint
// 2. 建立 WebSocket 连接
// 3. 接收消息推送 → ChatSession.run() → 调用回复 API
//

import type { IMAdapter } from './IMAdapter';
import type { ChatSession } from '@/core/chat/ChatSession';
import { MessageFormatter } from './MessageFormatter';
import WebSocket from 'ws';

/**
 * 钉钉 Stream 配置
 */
interface DingtalkConfig {
  appKey: string;
  appSecret: string;
}

/**
 * 钉钉 Stream 连接响应
 */
interface StreamEndpoint {
  endpoint: string;
  ticket: string;
}

/**
 * 钉钉消息推送 (简化)
 */
interface DingtalkMessage {
  specVersion: string;
  type: string;
  headers: Record<string, string>;
  data: string;
}

/**
 * 钉钉消息数据
 */
interface DingtalkMessageData {
  msgtype: string;
  text?: { content: string };
  senderNick?: string;
  senderId?: string;
  conversationType?: string;
  conversationId?: string;
  sessionWebhook?: string;
  sessionWebhookExpiredTime?: number;
  msgId?: string;
}

/**
 * DingtalkBot — 钉钉 Stream WebSocket 长连接机器人
 */
export class DingtalkBot implements IMAdapter {
  readonly name = 'dingtalk';
  private ws: WebSocket | null = null;
  private session: ChatSession | null = null;
  private config: DingtalkConfig;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private logCallback: ((message: string) => void) | null = null;

  constructor(config?: Partial<DingtalkConfig>) {
    this.config = {
      appKey: config?.appKey ?? process.env.DINGTALK_APP_KEY ?? '',
      appSecret: config?.appSecret ?? process.env.DINGTALK_APP_SECRET ?? '',
    };
  }

  /**
   * 设置日志回调
   */
  setLogger(callback: (message: string) => void): void {
    this.logCallback = callback;
  }

  private log(message: string): void {
    console.log(`[钉钉] ${message}`);
    this.logCallback?.(message);
  }

  private logError(message: string): void {
    console.error(`[钉钉] ${message}`);
    this.logCallback?.(`❌ ${message}`);
  }

  async start(session: ChatSession): Promise<void> {
    if (!this.config.appKey || !this.config.appSecret) {
      throw new Error('钉钉机器人配置缺失，请设置 DINGTALK_APP_KEY 和 DINGTALK_APP_SECRET');
    }

    this.session = session;
    this.running = true;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * 获取 Stream 连接端点
   */
  private async getEndpoint(): Promise<StreamEndpoint> {
    const resp = await fetch('https://api.dingtalk.com/v1.0/gateway/connections/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: this.config.appKey,
        clientSecret: this.config.appSecret,
        subscriptions: [
          { type: 'EVENT', topic: '*' },
          { type: 'CALLBACK', topic: '/v1.0/im/bot/messages/get' },
        ],
        ua: 'xuanji/0.0.1',
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`钉钉 Stream 注册失败: ${resp.status} ${text}`);
    }

    return await resp.json() as StreamEndpoint;
  }

  /**
   * 建立 WebSocket 连接
   */
  private async connect(): Promise<void> {
    try {
      const { endpoint, ticket } = await this.getEndpoint();
      const url = `${endpoint}?ticket=${encodeURIComponent(ticket)}`;

      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        this.log('WebSocket 已连接');
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', (code: number) => {
        this.log(`WebSocket 已断开 (code: ${code})`);
        this.scheduleReconnect();
      });

      this.ws.on('error', (err: Error) => {
        this.logError(`WebSocket 错误: ${err.message}`);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logError(`连接失败: ${msg}`);
      this.scheduleReconnect();
    }
  }

  /**
   * 处理收到的 WebSocket 消息
   */
  private handleMessage(raw: string): void {
    try {
      const msg: DingtalkMessage = JSON.parse(raw);

      // 系统消息: ping
      if (msg.type === 'SYSTEM') {
        this.sendPong(msg.headers?.messageId);
        return;
      }

      // 业务消息: 机器人收到用户消息
      if (msg.type === 'CALLBACK') {
        // 回复 ACK
        this.sendAck(msg.headers?.messageId);

        const data: DingtalkMessageData = JSON.parse(msg.data);
        this.processUserMessage(data).catch((err) => {
          this.logError(`处理消息失败: ${err}`);
        });
      }
    } catch (err) {
      this.logError(`解析消息失败: ${err}`);
    }
  }

  /**
   * 处理用户消息
   */
  private async processUserMessage(data: DingtalkMessageData): Promise<void> {
    if (!this.session || !data.text?.content) return;

    const userText = data.text.content.trim();
    if (!userText) return;

    const senderName = data.senderNick ?? '用户';
    this.log(`收到消息 (${senderName}): ${userText.slice(0, 50)}...`);

    // 使用 MessageFormatter 收集输出
    const formatter = new MessageFormatter();

    this.session.on({
      onText: (text) => formatter.appendText(text),
      onToolStart: (name, input) => formatter.toolStart(name, input),
      onToolEnd: (name, result, isError) => formatter.toolEnd(name, result, isError),
      onError: (err) => formatter.appendText(`\n❌ 错误: ${err.message}`),
    });

    try {
      await this.session.run(userText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      formatter.appendText(`\n❌ 执行失败: ${msg}`);
    }

    // 通过 sessionWebhook 回复
    const reply = formatter.format();
    if (data.sessionWebhook) {
      await this.sendReply(data.sessionWebhook, reply);
    }
  }

  /**
   * 通过 sessionWebhook 发送回复
   */
  private async sendReply(webhook: string, content: string): Promise<void> {
    try {
      // 钉钉 Markdown 消息有 5000 字符限制
      const truncated = content.length > 4800
        ? content.slice(0, 4800) + '\n\n...(内容过长已截断)'
        : content;

      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: 'markdown',
          markdown: {
            title: '璇玑',
            text: truncated,
          },
        }),
      });
    } catch (err) {
      this.logError(`回复失败: ${err}`);
    }
  }

  /**
   * 发送 pong
   */
  private sendPong(messageId?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        code: 200,
        headers: { messageId },
        message: 'OK',
        data: '',
      }));
    }
  }

  /**
   * 发送 ACK
   */
  private sendAck(messageId?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        code: 200,
        headers: { 'content-type': 'application/json', messageId },
        message: 'OK',
        data: JSON.stringify({ response: 'received' }),
      }));
    }
  }

  /**
   * 自动重连
   */
  private scheduleReconnect(): void {
    if (!this.running) return;

    this.log('5 秒后重连...');
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((err) => {
        this.logError(`重连失败: ${err}`);
      });
    }, 5000);
  }
}
