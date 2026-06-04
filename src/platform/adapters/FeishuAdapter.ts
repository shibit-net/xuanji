/**
 * 飞书 Adapter
 *
 * 使用 WebSocket 长连接接收事件（飞书官方 SDK WSClient），无需公网 IP。
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

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import type { PlatformAdapter, PlatformMessage, FeishuConfig } from '../types.js';
import type { CredentialManager } from '../auth/CredentialManager.js';
import { buildSessionKey } from '../SessionRouter.js';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'FeishuAdapter' });

export class FeishuAdapter implements PlatformAdapter {
  readonly platform = 'feishu' as const;
  lastActivity = 0;

  private messageHandler: ((msg: PlatformMessage) => void) | null = null;
  private credentials: CredentialManager;

  /** 官方 SDK WSClient 实例 */
  private wsClient: any = null;
  private wsStarted = false;

  /** 用户资料缓存：userId → { name, avatar } */
  private userCache = new Map<string, { name: string; avatar?: string }>();

  /** 群聊名称缓存：chatId → name */
  private groupNameCache = new Map<string, string>();

  constructor(private config: FeishuConfig, credentials: CredentialManager) {
    this.credentials = credentials;
  }

  // ── WebSocket 长连接（使用官方 SDK WSClient）──────────────

  private async startWebSocket(): Promise<void> {
    if (this.wsStarted) return;
    console.log('[FeishuAdapter] Starting WebSocket...');

    try {
      console.log('[FeishuAdapter] Importing @larksuiteoapi/node-sdk...');
      const { WSClient, EventDispatcher, Domain, LoggerLevel } = await import('@larksuiteoapi/node-sdk');
      console.log('[FeishuAdapter] SDK imported successfully');

      // SDK 要求 appId 必须是 cli_ + 16 位 hex（企业自建应用），否则静默失败
      if (!/^cli_[0-9a-fA-F]{16}$/.test(this.config.app_id)) {
        const err = `飞书 WebSocket 需要企业自建应用（app_id 以 cli_ 开头），当前 app_id: ${this.config.app_id?.substring(0, 10)}...`;
        console.error('[FeishuAdapter]', err);
        throw new Error(err);
      }
      console.log('[FeishuAdapter] appId format OK:', this.config.app_id.substring(0, 10) + '...');

      const eventDispatcher = new EventDispatcher({}).register({
        'im.message.receive_v1': (data: any) => {
          this.lastActivity = Date.now();
          console.log('[FeishuAdapter] EVENT: im.message.receive_v1 keys=', Object.keys(data || {}).join(','));
          log.info(`Feishu WS event received: keys=${Object.keys(data || {}).join(',')}, msgType=${data?.message?.message_type}, chatId=${data?.message?.chat_id}`);
          const msg = this.parseMessageFromSDK(data);
          if (msg) {
            this.enrichAndForward(msg).catch(err => {
              console.error('[FeishuAdapter] enrichAndForward error:', (err as Error).message);
              log.error(`Feishu enrichAndForward failed: ${(err as Error).message}`);
            });
          } else {
            console.warn('[FeishuAdapter] parseMessageFromSDK returned null, keys:', Object.keys(data || {}));
            log.warn('Feishu WS parseMessageFromSDK returned null, raw keys:', Object.keys(data || {}));
          }
        },
        'im.message.read_v1': (data: any) => {
          this.lastActivity = Date.now();
          console.log('[FeishuAdapter] EVENT: im.message.read_v1');
          this.handleReadReceipt(data);
        },
        'im.message.recalled_v1': (data: any) => {
          this.lastActivity = Date.now();
          console.log('[FeishuAdapter] EVENT: im.message.recalled_v1');
          this.handleRecall(data);
        },
      });
      console.log('[FeishuAdapter] EventDispatcher registered with 3 events');

      // onReady/onError 必须传给 constructor，传给 start() 会被 SDK 忽略
      this.wsClient = new WSClient({
        appId: this.config.app_id,
        appSecret: this.config.app_secret,
        domain: Domain.Feishu,
        loggerLevel: LoggerLevel.debug,
        autoReconnect: true,
        onReady: () => {
          console.log('[FeishuAdapter] onReady: WebSocket connected!');
          log.info('Feishu WebSocket connected via SDK WSClient (onReady)');
          this.wsStarted = true;
          this.lastActivity = Date.now();
        },
        onError: (err: Error) => {
          console.error('[FeishuAdapter] onError:', err.message);
          log.error(`Feishu WebSocket error: ${err.message}`);
        },
      });

      console.log('[FeishuAdapter] Calling wsClient.start()...');
      this.wsClient.start({ eventDispatcher });

      // start() 内部调用 reConnect() 是异步的，等待 onReady 或超时
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (!this.wsStarted) {
            console.warn('[FeishuAdapter] WebSocket connection timeout (30s)');
            log.warn('Feishu WebSocket connection timeout (30s)');
            resolve();
          }
        }, 30000);

        const check = setInterval(() => {
          if (this.wsStarted) {
            console.log('[FeishuAdapter] WebSocket ready, resolving promise');
            clearTimeout(timeout);
            clearInterval(check);
            resolve();
          }
        }, 200);
      });
    } catch (err) {
      console.error('[FeishuAdapter] startWebSocket failed:', (err as Error).message);
      log.error(`Feishu WebSocket start failed: ${(err as Error).message}`, (err as Error).stack);
      this.wsStarted = false;
      throw err;
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

  async getUserProfile(options: { userId: string; userIdType?: string }): Promise<{ name: string; avatar?: string } | null> {
    const { userId, userIdType } = options;
    // 先查缓存
    const cached = this.userCache.get(userId);
    if (cached) return cached;

    try {
      const token = await this.credentials.getToken('feishu');
      const response = await fetch(
        `https://open.feishu.cn/open-apis/contact/v3/users/${encodeURIComponent(userId)}?user_id_type=${userIdType || 'open_id'}`,
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

  /** 获取群聊名称（GET /chats/:id），结果缓存 */
  private async fetchGroupName(chatId: string): Promise<string | undefined> {
    const cached = this.groupNameCache.get(chatId);
    if (cached) return cached;

    try {
      const token = await this.credentials.getToken('feishu');
      const response = await fetch(
        `https://open.feishu.cn/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`,
        { headers: { 'Authorization': `Bearer ${token}` } },
      );
      const data = await response.json() as any;
      if (data.code === 0 && data.data?.name) {
        this.groupNameCache.set(chatId, data.data.name);
        return data.data.name;
      }
    } catch (err) {
      log.warn(`Feishu fetchGroupName failed: ${(err as Error).message}`);
    }
    return undefined;
  }

  /** 收到消息后自动丰富：用户名 → 群名 → 回复上下文 → 附件下载 → 推送 → 已读 ACK（文档 §3.4 + §9） */
  private async enrichAndForward(msg: PlatformMessage): Promise<void> {
    // 1. 获取用户名称（Contact API），确保 session 注册时已有 displayName
    if (!msg.userName) {
      await this.enrichUserName(msg);
    }
    // 2. 群聊消息：获取群名并注入到 raw.chatName
    if (msg.chatType === 'group' && !msg.raw?.chatName) {
      const groupName = await this.fetchGroupName(msg.chatId);
      if (groupName && msg.raw) {
        msg.raw.chatName = groupName;
      }
    }
    // 3. 获取回复上下文（必须在推送前，让 Agent 理解对话上下文）
    if (msg.replyTo) {
      await this.enrichReplyContent(msg);
    }
    // 4. 下载附件到本地
    if (msg.attachments && msg.attachments.length > 0) {
      try {
        await this.downloadAttachments(msg);
      } catch (err) {
        console.error('[FeishuAdapter] downloadAttachments failed:', (err as Error).message);
        log.error(`Feishu downloadAttachments failed: ${(err as Error).message}`);
      }
    }
    // 5. 清理 @ 标记为实名
    this.cleanMentionMarkers(msg);
    // 6. 推送消息给 Agent
    this.messageHandler?.(msg);

    // 后置异步：已读 ACK（不阻塞消息推送）
    if (msg.id && msg.eventType === 'message') {
      const p = this.ackMessage(msg.id);
      p.catch(() => {});
    }
  }

  /** 获取被回复消息的内容并注入到 msg.text，同时下载附件（文档 §3.4） */
  private async enrichReplyContent(msg: PlatformMessage): Promise<void> {
    if (!msg.replyTo) return;
    try {
      const token = await this.credentials.getToken('feishu');
      const response = await fetch(
        `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(msg.replyTo)}`,
        { headers: { 'Authorization': `Bearer ${token}` } },
      );
      const data = await response.json() as any;
      if (data.code === 0 && data.data?.items?.[0]) {
        const item = data.data.items[0];
        const msgType: string = item.msg_type || 'text';

        // 解析不同消息类型的内容
        let repliedText = '';
        let replyFileKeys: Array<{ key: string; type: 'image' | 'file'; name?: string }> = [];
        try {
          const inner = JSON.parse(item.body?.content || '{}');
          if (msgType === 'text') {
            repliedText = inner.text || '';
          } else if (msgType === 'post') {
            const parts: string[] = [];
            const lines = inner.content || inner.elements || [];
            for (const line of (lines || [])) {
              for (const seg of (line || [])) {
                if (seg.tag === 'text' || seg.tag === 'a') parts.push(seg.text || '');
                else if (seg.tag === 'at') parts.push(`@${seg.user_name || seg.user_id || '未知'}`);
                else if (seg.tag === 'img') {
                  parts.push('[图片]');
                  if (seg.image_key) replyFileKeys.push({ key: seg.image_key, type: 'image' });
                }
                else if (seg.tag === 'media') {
                  parts.push('[视频]');
                  if (seg.file_key) replyFileKeys.push({ key: seg.file_key, type: 'file' });
                }
              }
            }
            repliedText = parts.join('') || '[富文本消息]';
          } else if (msgType === 'interactive') {
            // interactive 卡片：提取 markdown / text 元素中的文本
            const parts: string[] = [];
            const elements = inner.elements || inner.card?.elements || [];
            for (const el of elements) {
              if (el.tag === 'markdown' && el.content) {
                parts.push(el.content);
              } else if (el.tag === 'div' && el.text) {
                parts.push(typeof el.text === 'string' ? el.text : el.text?.content || '');
              } else if (el.tag === 'hr') {
                parts.push('---');
              }
            }
            if (inner.header?.title?.content) {
              parts.unshift(inner.header.title.content);
            }
            repliedText = parts.join('\n') || '[卡片消息]';
          } else if (msgType === 'image') {
            repliedText = '[图片]';
            if (inner.image_key) replyFileKeys.push({ key: inner.image_key, type: 'image' });
          } else if (msgType === 'file') {
            repliedText = `[文件: ${inner.file_name || '未命名'}]`;
            if (inner.file_key) replyFileKeys.push({ key: inner.file_key, type: 'file', name: inner.file_name });
          } else if (msgType === 'audio') {
            repliedText = '[语音]';
            if (inner.file_key) replyFileKeys.push({ key: inner.file_key, type: 'file' });
          } else if (msgType === 'media') {
            repliedText = '[视频]';
            if (inner.file_key) replyFileKeys.push({ key: inner.file_key, type: 'file' });
          } else if (msgType === 'sticker') {
            repliedText = '[表情]';
          } else {
            repliedText = item.body?.content || '[非文本消息]';
          }
        } catch {
          repliedText = item.body?.content || '[非文本消息]';
        }

        // 获取发送者名称：优先缓存 → Contact API（使用正确的 id_type）→ 截取ID
        let senderName = '未知用户';
        const senderId: string | undefined = item.sender?.id;
        const senderIdType: string = item.sender?.id_type || 'open_id';
        if (senderId) {
          // app_id 类型无法通过 Contact API 查询，直接判断
          if (senderIdType === 'app_id') {
            senderName = senderId === this.config.app_id ? '璇玑 (xuanji)' : `应用(${senderId.substring(0, 10)}...)`;
          } else {
            const cached = this.userCache.get(senderId);
            if (cached) {
              senderName = cached.name;
            } else {
              const profile = await this.getUserProfile({ userId: senderId, userIdType: senderIdType });
              if (profile?.name) {
                senderName = profile.name;
              } else {
                senderName = senderId.substring(0, 12) + '...';
              }
            }
          }
        }

        // 下载被回复消息中的附件
        let attachmentPaths: string[] = [];
        if (replyFileKeys.length > 0) {
          attachmentPaths = await this.downloadReplyAttachments(msg.replyTo!, replyFileKeys);
        }

        // 构建回复上下文
        let contextParts: string[] = [];
        contextParts.push(`[回复了 ${senderName} 的消息: "${repliedText}"]`);
        if (attachmentPaths.length > 0) {
          contextParts.push(`[附件: ${attachmentPaths.join(', ')}]`);
        }
        msg.text = `${contextParts.join('\n')}\n${msg.text}`;
      }
    } catch (err) {
      log.warn(`Feishu enrichReplyContent failed: ${(err as Error).message}`);
    }
  }

  /** 下载被回复消息中的附件 */
  private async downloadReplyAttachments(messageId: string, fileKeys: Array<{ key: string; type: 'image' | 'file'; name?: string }>): Promise<string[]> {
    const paths: string[] = [];
    const tempDir = join(this.config.workspacePath || tmpdir(), 'feishu-attachments');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    for (const fk of fileKeys) {
      try {
        const token = await this.credentials.getToken('feishu');
        const response = await fetch(
          `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fk.key)}?type=${fk.type}`,
          { headers: { 'Authorization': `Bearer ${token}` } },
        );
        if (!response.ok) continue;

        const buffer = Buffer.from(await response.arrayBuffer());
        let ext = fk.type === 'image' ? '.jpg' : '.bin';
        if (fk.name?.includes('.')) ext = fk.name.substring(fk.name.lastIndexOf('.'));

        const localName = `${Date.now()}_${fk.key.substring(0, 8)}${ext}`;
        const localPath = join(tempDir, localName);
        writeFileSync(localPath, buffer);
        paths.push(localPath);
      } catch (err) {
        log.warn(`Feishu downloadReplyAttachment ${fk.key}: ${(err as Error).message}`);
      }
    }
    return paths;
  }

  /** 将飞书 SDK 的 @_user_X 标记替换为用户名，让 Agent 理解 @ 对象 */
  private cleanMentionMarkers(msg: PlatformMessage): void {
    if (!msg.raw?.message?.mentions || msg.raw.message.mentions.length === 0) return;
    try {
      for (const m of msg.raw.message.mentions) {
        if (m.key && msg.text.includes(m.key)) {
          const displayName = m.name || m.key;
          msg.text = msg.text.replace(new RegExp(m.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), `@${displayName}`);
        }
      }
    } catch { /* 忽略 */ }
  }

  /** 标记已读 + 表情反应（文档 §9.1-9.3） */
  private async ackMessage(messageId: string): Promise<void> {
    try {
      const token = await this.credentials.getToken('feishu');
      await fetch(
        `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/read`,
        { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` } },
      );
      await fetch(
        `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reactions`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ reaction_type: { emoji_type: 'OK' } }),
        },
      );
    } catch {
      // fire-and-forget，忽略错误
    }
  }

  /** 下载飞书消息中的附件（图片/文件/音频/视频）到本地临时目录，设置 localPath 供 Agent 使用 */
  private async downloadAttachments(msg: PlatformMessage): Promise<void> {
    if (!msg.id || !msg.attachments || msg.attachments.length === 0) return;

    const tempDir = join(this.config.workspacePath || tmpdir(), 'feishu-attachments');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const fileNames: string[] = [];

    for (const att of msg.attachments) {
      const url = att.url || '';
      const match = url.match(/^feishu:\/\/(image|file)\/(.+)$/);
      if (!match) continue;

      const resourceType = match[1] === 'image' ? 'image' : 'file';
      const fileKey = match[2];

      try {
        const token = await this.credentials.getToken('feishu');
        const response = await fetch(
          `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(msg.id)}/resources/${encodeURIComponent(fileKey)}?type=${resourceType}`,
          { headers: { 'Authorization': `Bearer ${token}` } },
        );
        if (!response.ok) {
          log.warn(`Feishu download attachment failed: HTTP ${response.status}`);
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        // 确定文件扩展名
        let ext = '.bin';
        const mime = att.mimeType || '';
        if (att.type === 'image') ext = '.jpg';
        else if (att.type === 'audio') ext = '.ogg';
        else if (att.type === 'voice') ext = '.ogg';
        else if (att.type === 'video') ext = '.mp4';
        else if (mime.includes('pdf')) ext = '.pdf';
        else if (mime.includes('word') || mime.includes('document')) ext = '.docx';
        else if (att.name) ext = att.name.includes('.') ? att.name.substring(att.name.lastIndexOf('.')) : '.bin';

        const localName = `${Date.now()}_${fileKey.substring(0, 8)}${ext}`;
        const localPath = join(tempDir, localName);
        writeFileSync(localPath, buffer);
        att.localPath = localPath;
        fileNames.push(localPath);
      } catch (err) {
        log.warn(`Feishu download attachment ${fileKey}: ${(err as Error).message}`);
      }
    }

    // 在消息文本中注入文件路径信息，让 Agent 知道有可读取的文件
    if (fileNames.length > 0) {
      const fileList = fileNames.map(f => `file:${f}`).join('\n');
      const prefix = msg.text ? `${msg.text}\n\n---\n附件：\n${fileList}` : `附件：\n${fileList}`;
      msg.text = prefix;
    }
  }

  private async enrichUserName(msg: PlatformMessage): Promise<void> {
    if (msg.userName) return;
    const profile = await this.getUserProfile({ userId: msg.userId });
    if (profile?.name) {
      msg.userName = profile.name;
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
    const chatType: 'private' | 'group' = (data.chat_type === 'private' || data.chat_type === 'p2p') ? 'private' : 'group';

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
    const chatType: 'private' | 'group' = (data.chat_type === 'private' || data.chat_type === 'p2p') ? 'private' : 'group';
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

  /** 统一的消息构建逻辑 */
  private buildMessage(raw: any, msg: any, sender: any): PlatformMessage | null {
    if (!msg || !sender) return null;
    const chatType: 'private' | 'group' = (msg.chat_type === 'private' || msg.chat_type === 'p2p') ? 'private' : 'group';

    let text = '';
    const attachments: Array<{ type: 'image' | 'file' | 'voice' | 'audio' | 'video'; url?: string; name?: string; mimeType?: string }> = [];
    try {
      const content = JSON.parse(msg.content);
      text = content.text || '';

      const msgType = msg.message_type;
      if (msgType === 'image') {
        const key = content.image_key;
        if (key) attachments.push({ type: 'image', url: `feishu://image/${key}` });
        if (!text) text = `[收到图片: ${content.image_key || '未知'}]`;
      } else if (msgType === 'file') {
        const key = content.file_key;
        if (key) attachments.push({ type: 'file', url: `feishu://file/${key}`, name: content.file_name, mimeType: 'application/octet-stream' });
        if (!text) text = `[收到文件: ${content.file_name || '未命名文件'}]`;
      } else if (msgType === 'audio') {
        const key = content.file_key;
        if (key) attachments.push({ type: 'audio', url: `feishu://file/${key}`, mimeType: 'audio/ogg' });
        if (!text) text = `[收到语音: ${content.file_key || '未知'}]`;
      } else if (msgType === 'media') {
        const key = content.file_key;
        if (key) attachments.push({ type: 'video', url: `feishu://file/${key}`, mimeType: 'video/mp4' });
        if (!text) text = `[收到视频: ${content.file_key || '未知'}]`;
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
      replyTo: msg.parent_id || msg.upper_message_id || undefined,
      sessionKey: buildSessionKey({ platform: 'feishu', chatType, chatId: msg.chat_id }),
      eventType: 'message',
      raw: { ...raw, chatName: msg.chat_name || raw.chat_name },
    };
  }

  // ── 生命周期 ─────────────────────────────────────────────

  async start(): Promise<void> {
    this.credentials.registerRefresher('feishu', () => this.doRefreshToken());
    await this.startWebSocket();
  }

  async stop(): Promise<void> {
    this.credentials.clearToken('feishu');
    await this.stopWebSocket();
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
      msg_type: 'interactive',
      content: JSON.stringify({
        config: { wide_screen_mode: true },
        elements: [{ tag: 'markdown', content: options.text }],
      }),
    };

    let url: string;
    if (options.replyTo) {
      // Reply API — 继承父消息的会话上下文，无需 receive_id（文档 §7.3）
      url = `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(options.replyTo)}/reply`;
    } else {
      const receiveIdType = options.chatId.startsWith('oc_') ? 'chat_id' : 'open_id';
      body.receive_id = options.chatId;
      url = `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json() as any;
    if (data.code !== 0) {
      throw new Error(`Feishu sendText failed: ${data.msg} (code=${data.code})`);
    }

    return data.data?.message_id || '';
  }

  async sendMarkdown(options: { chatId: string; content: string; replyTo?: string }): Promise<string> {
    const token = await this.credentials.getToken('feishu');
    const body: Record<string, unknown> = {
      msg_type: 'interactive',
      content: JSON.stringify({
        config: { wide_screen_mode: true },
        elements: [{ tag: 'markdown', content: options.content }],
      }),
    };

    let url: string;
    if (options.replyTo) {
      url = `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(options.replyTo)}/reply`;
    } else {
      const receiveIdType = options.chatId.startsWith('oc_') ? 'chat_id' : 'open_id';
      body.receive_id = options.chatId;
      url = `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

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
