// ============================================================
// IM 适配器 — 飞书机器人 (官方 SDK 长连接模式)
// ============================================================
//
// 飞书长连接文档:
// https://open.feishu.cn/document/server-docs/event-subscription-guide/long-connection-mode
//
// 使用官方 @larksuiteoapi/node-sdk 的 WSClient 建立长连接:
// - 无需公网 IP / 域名
// - 无需处理加解密和签名验证
// - 只需 App ID + App Secret，SDK 自动维护连接
//
// 飞书后台配置步骤:
// 1. 创建自建应用 → 添加「机器人」能力
// 2. 权限管理 → 开通 im:message 等权限
// 3. 事件与回调 → 订阅 im.message.receive_v1 事件
// 4. 事件与回调 → 订阅方式 → 选择「使用长连接接收事件」
// 5. 创建版本并发布应用（必须发布后长连接才能生效！）
//

import type { IMAdapter } from './IMAdapter';
import type { ChatSession } from '@/core/chat/ChatSession';
import { MessageFormatter } from './MessageFormatter';
import * as Lark from '@larksuiteoapi/node-sdk';

/**
 * 飞书配置
 */
interface FeishuConfig {
  appId: string;
  appSecret: string;
}

/**
 * FeishuBot — 飞书官方 SDK 长连接机器人
 *
 * 使用 @larksuiteoapi/node-sdk 的 WSClient 建立 WebSocket 长连接，
 * 接收 im.message.receive_v1 事件，通过 ChatSession 处理后回复。
 */
export class FeishuBot implements IMAdapter {
  readonly name = 'feishu';
  private session: ChatSession | null = null;
  private config: FeishuConfig;
  private client: Lark.Client | null = null;
  private wsClient: Lark.WSClient | null = null;
  private running = false;
  /** 日志回调 */
  private logCallback?: (message: string) => void;
  /** 正在处理消息的用户集合（防止重复处理） */
  private processingUsers: Set<string> = new Set();
  /** 已处理的事件 ID 集合（防止飞书重传导致重复） */
  private processedEvents: Set<string> = new Set();
  private static readonly MAX_EVENT_CACHE = 200;

  constructor(config?: Partial<FeishuConfig>) {
    this.config = {
      appId: config?.appId ?? process.env.FEISHU_APP_ID ?? '',
      appSecret: config?.appSecret ?? process.env.FEISHU_APP_SECRET ?? '',
    };
  }

  setLogger(callback: (message: string) => void): void {
    this.logCallback = callback;
  }

  private log(message: string): void {
    console.log(`[飞书] ${message}`);
    this.logCallback?.(`${message}`);
  }

  private logError(message: string, err?: unknown): void {
    const detail = err instanceof Error ? err.message : err ? String(err) : '';
    const full = detail ? `${message}: ${detail}` : message;
    console.error(`[飞书] ${full}`);
    this.logCallback?.(`❌ ${full}`);
  }

  async start(session: ChatSession): Promise<void> {
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error('飞书机器人配置缺失，请设置 App ID 和 App Secret');
    }

    this.session = session;
    this.running = true;

    const baseConfig = {
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    };

    // 创建 API 客户端（用于发送消息）
    this.client = new Lark.Client(baseConfig);

    // 创建事件分发器
    const self = this;
    const eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: any) => {
        try {
          self.log(`[EventDispatcher] 收到 im.message.receive_v1 事件`);
          await self.handleMessageEvent(data);
        } catch (err) {
          self.logError('[EventDispatcher] 事件处理异常', err);
        }
      },
    });

    // 创建 WebSocket 长连接客户端
    this.wsClient = new Lark.WSClient({
      ...baseConfig,
      loggerLevel: Lark.LoggerLevel.info,
    });

    this.log('正在建立长连接...');

    // 启动长连接
    await this.wsClient.start({
      eventDispatcher,
    });

    this.log('✓ 飞书长连接已建立');
    this.log('');
    this.log('📋 飞书后台配置检查清单:');
    this.log('  1. 应用已添加「机器人」能力');
    this.log('  2. 权限管理 → 已开通 im:message 等权限');
    this.log('  3. 事件与回调 → 已订阅 im.message.receive_v1');
    this.log('  4. 事件与回调 → 订阅方式 → 已选择「使用长连接接收事件」');
    this.log('  5. 应用已创建版本并发布（⚠ 必须发布！）');
  }

  async stop(): Promise<void> {
    this.running = false;
    // SDK 没有提供显式的 stop 方法，设置 running=false 防止后续处理即可
    this.wsClient = null;
    this.client = null;
    this.log('飞书机器人已停止');
  }

  /**
   * 处理消息事件
   */
  private async handleMessageEvent(data: any): Promise<void> {
    // 事件去重（飞书会在超时未确认时重传）
    const eventId = data?.event_id;
    if (eventId) {
      if (this.processedEvents.has(eventId)) {
        this.log(`跳过重复事件: ${eventId}`);
        return;
      }
      this.processedEvents.add(eventId);
      // 限制缓存大小
      if (this.processedEvents.size > FeishuBot.MAX_EVENT_CACHE) {
        const first = this.processedEvents.values().next().value;
        if (first) this.processedEvents.delete(first);
      }
    }

    this.log(`收到事件回调: ${JSON.stringify(data).slice(0, 200)}`);

    if (!this.session || !this.client || !this.running) {
      this.log('跳过处理: session/client 未就绪或已停止');
      return;
    }

    try {
      const message = data?.message;
      if (!message) return;

      const { message_type, content, chat_id, message_id } = message;

      // 只处理文本消息
      if (message_type !== 'text') {
        this.log(`忽略非文本消息 (type=${message_type})`);
        return;
      }

      // 解析文本内容
      let text: string;
      try {
        const parsed = JSON.parse(content) as { text: string };
        text = parsed.text?.trim() ?? '';
      } catch {
        text = content?.trim() ?? '';
      }

      // 去除 @机器人 的 mention 标记
      text = text.replace(/@_user_\d+/g, '').trim();
      if (!text) return;

      // 获取发送者信息
      const senderId = data?.sender?.sender_id?.open_id ?? 'unknown';
      this.log(`收到消息 (${senderId}): ${text.slice(0, 80)}`);

      // 防止同一用户重复处理
      if (this.processingUsers.has(senderId)) {
        this.log(`用户 ${senderId} 的消息正在处理中，跳过`);
        return;
      }

      // 处理并回复
      this.processingUsers.add(senderId);

      try {
        await this.processAndReply(chat_id, message_id, text);
      } finally {
        this.processingUsers.delete(senderId);
      }
    } catch (err) {
      this.logError('处理消息事件失败', err);
    }
  }

  /**
   * 处理用户消息并回复
   */
  private async processAndReply(chatId: string, messageId: string, text: string): Promise<void> {
    if (!this.session || !this.client) return;

    const formatter = new MessageFormatter();

    this.session.on({
      onText: (t) => formatter.appendText(t),
      onToolStart: (id, name, input) => formatter.toolStart(name, input),
      onToolEnd: (id, name, result, isError) => formatter.toolEnd(name, result, isError),
      onError: (err) => formatter.appendText(`\n❌ 错误: ${err.message}`),
    });

    try {
      await this.session.run(text);
      this.log('ChatSession 处理完成');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      formatter.appendText(`\n❌ 执行失败: ${msg}`);
    }

    const reply = formatter.format();
    await this.sendReply(chatId, reply, messageId);
  }

  /**
   * 发送回复消息
   *
   * 飞书消息限制:
   * - text 类型无明确长度限制，但建议控制在合理范围内
   * - 超长内容截断后发送
   */
  private async sendReply(chatId: string, content: string, replyMsgId?: string): Promise<void> {
    if (!this.client) return;

    try {
      // 截断过长内容
      const MAX_LEN = 10000;
      const truncated = content.length > MAX_LEN
        ? content.slice(0, MAX_LEN) + '\n\n...(内容过长已截断)'
        : content;

      if (replyMsgId) {
        // 回复消息
        await this.client.im.v1.message.reply({
          path: { message_id: replyMsgId },
          data: {
            msg_type: 'text',
            content: JSON.stringify({ text: truncated }),
          },
        });
      } else {
        // 直接发送
        await this.client.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            msg_type: 'text',
            content: JSON.stringify({ text: truncated }),
          },
        });
      }

      this.log(`回复发送成功 → ${chatId}`);
    } catch (err: any) {
      // 打印完整错误响应体（飞书 API 会在 response.data 中返回错误详情）
      const respData = err?.response?.data ?? err?.data ?? '';
      const detail = respData ? JSON.stringify(respData) : (err instanceof Error ? err.message : String(err));
      this.logError(`回复发送失败 (${replyMsgId ? 'reply' : 'create'})`, detail);
    }
  }
}
