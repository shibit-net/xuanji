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
import { logger } from '@/core/logger';

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
  private coreLog = logger.child({ module: 'DingtalkBot' });
  private ws: WebSocket | null = null;
  private session: ChatSession | null = null;
  private config: DingtalkConfig;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private logCallback: ((message: string) => void) | null = null;
  /** 全局消息处理锁 — AgentLoop 不支持并发，必须串行处理 */
  private processingLock: Promise<void> = Promise.resolve();
  private _callbacksRegistered = false;
  private _currentFormatter: { ref: MessageFormatter } | null = null;

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
    this.coreLog.info(message);
    this.logCallback?.(message);
  }

  private logError(message: string): void {
    this.coreLog.error(message);
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
    this._callbacksRegistered = false;
    this._currentFormatter = null;
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
      // 清理旧连接，防止 WebSocket 泄漏
      if (this.ws) {
        try { this.ws.close(); } catch { /* ignore */ }
        this.ws = null;
      }

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
        // 串行化处理：AgentLoop 不支持并发 run
        const task = () => this.processUserMessage(data).catch((err) => {
          this.logError(`处理消息失败: ${err}`);
        });
        this.processingLock = this.processingLock.then(task, task);
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
    // 每条消息使用独立 formatter，通过闭包引用避免回调累积
    const formatter = new MessageFormatter();
    const currentFormatter = { ref: formatter };

    // 只注册一次回调（首次调用时），通过引用间接调用当前 formatter
    if (!this._callbacksRegistered) {
      this._callbacksRegistered = true;
      this._currentFormatter = currentFormatter;
      const agentLoop = this.session.getAgentLoop();
      agentLoop.on({
        onText: (text: string) => this._currentFormatter?.ref?.appendText(text),
        onToolStart: (id: string, name: string, input: Record<string, unknown>) => this._currentFormatter?.ref?.toolStart(name, input),
        onToolEnd: (id: string, name: string, result: string, isError: boolean) => this._currentFormatter?.ref?.toolEnd(name, result, isError),
        onError: (err: Error) => this._currentFormatter?.ref?.appendText(`\n❌ 错误: ${err.message}`),
      });
    } else {
      this._currentFormatter = currentFormatter;
    }

    try {
      await this.session.run(userText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      formatter.appendText(`\n❌ 执行失败: ${msg}`);
    }

    // 通过 sessionWebhook 回复
    const reply = formatter.format();
    if (data.sessionWebhook) {
      // 检查 webhook 是否已过期
      if (data.sessionWebhookExpiredTime && Date.now() > data.sessionWebhookExpiredTime) {
        this.log(`sessionWebhook 已过期 (expired: ${new Date(data.sessionWebhookExpiredTime).toISOString()})，跳过回复`);
      } else {
        await this.sendReply(data.sessionWebhook, reply);
      }
    }
  }

  /**
   * 通过 sessionWebhook 发送回复
   */
  private async sendReply(webhook: string, content: string): Promise<void> {
    try {
      // SSRF 防护：验证 webhook URL 域名必须是钉钉官方域名
      const url = new URL(webhook);
      if (!url.hostname.endsWith('.dingtalk.com')) {
        this.coreLog.warn(`拒绝非钉钉域名的 webhook: ${url.hostname}`);
        return;
      }

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

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.log('5 秒后重连...');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        this.logError(`重连失败: ${err}`);
      });
    }, 5000);
  }
}
