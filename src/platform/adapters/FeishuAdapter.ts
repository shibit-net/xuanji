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
import { MessageDeduplicator } from '../MessageDeduplicator.js';
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

  /** 用户资料缓存：userId → { name, avatar, fetchedAt } */
  private userCache = new Map<string, { name: string; avatar?: string; fetchedAt?: number }>();

  /** 群聊名称缓存：chatId → name */
  private groupNameCache = new Map<string, string>();

  /** 群成员缓存：chatId → { members, fetchedAt }（首次消息拉取，后续复用，避免每次消息都查 API） */
  private groupMembersCache = new Map<string, { members: import('../types.js').GroupMember[]; fetchedAt: number }>();
  private groupMembersHandler: ((chatId: string, members: import('../types.js').GroupMember[]) => void) | null = null;

  /** Bot 自身的 open_id（通过 /bot/v3/info 获取，用于 self_echo 防护 + 群成员识别） */
  private _botOpenId = '';
  /** Bot 自身身份获取是否完成（用于等待第一帧消息前身份就绪） */
  private _identityReady = false;
  /** 是否允许接收其他 Bot 的消息（默认 all，多 Agent 协作需要） */
  private _allowBots: 'none' | 'mentions' | 'all' = 'all';

  /** 消息去重器（TTL + 持久化），防止 WebSocket 重连/Webhook 重试导致重复消息 */
  private deduplicator: MessageDeduplicator | null = null;

  /** 基于事件的群成员缓存：chatId → Map<memberId, GroupMember>（消息事件 + 成员变更事件累积） */
  private _memberTrackingCache = new Map<string, Map<string, import('../types.js').GroupMember>>();

  isConnected(): boolean {
    return this.wsStarted;
  }

  onGroupMembersUpdated(handler: (chatId: string, members: import('../types.js').GroupMember[]) => void): void {
    this.groupMembersHandler = handler;
  }

  constructor(private config: FeishuConfig, credentials: CredentialManager) {
    this.credentials = credentials;

    // 初始化消息去重器（如果提供了 dataDir）
    if (this.config.dataDir) {
      const dedupPath = `${this.config.dataDir}/message-dedup-feishu.json`;
      this.deduplicator = new MessageDeduplicator(dedupPath);
      log.info(`FeishuAdapter deduplicator initialized: ${dedupPath}`);
    }
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

          // 跟踪发送者（方案 B：用消息事件累积群成员）
          this._trackSenderFromMessage(data);

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
        // ── 群成员变更事件（方案 B：实时感知加人/退群）──────────
        'im.chat.member.user.added_v1': (data: any) => {
          this.lastActivity = Date.now();
          this._handleMembersAdded(data, false);
        },
        'im.chat.member.user.deleted_v1': (data: any) => {
          this.lastActivity = Date.now();
          this._handleMembersRemoved(data);
        },
        'im.chat.member.user.withdrawn_v1': (data: any) => {
          this.lastActivity = Date.now();
          this._handleMembersRemoved(data);
        },
        'im.chat.member.bot.added_v1': (data: any) => {
          this.lastActivity = Date.now();
          this._handleMembersAdded(data, true);
        },
        'im.chat.member.bot.deleted_v1': (data: any) => {
          this.lastActivity = Date.now();
          this._handleMembersRemoved(data);
        },
      });
      console.log('[FeishuAdapter] EventDispatcher registered with 8 events (3 msg + 5 member)');

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
          // 异步获取 Bot 身份（self_echo 防护 + 群成员识别）
          this.fetchBotIdentity().catch(e => log.warn(`Feishu bot identity init failed: ${e.message}`));
        },
        onError: (err: Error) => {
          console.error('[FeishuAdapter] onError:', err.message);
          log.error(`Feishu WebSocket error: ${err.message}`);
        },
      });

      console.log('[FeishuAdapter] Calling wsClient.start()...');
      this.wsClient.start({ eventDispatcher });

      // start() 内部调用 reConnect() 是异步的，等待 onReady + Bot 身份获取完成（或超时）
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (!this.wsStarted) {
            console.warn('[FeishuAdapter] WebSocket connection timeout (30s)');
            log.warn('Feishu WebSocket connection timeout (30s)');
          }
          resolve();
        }, 30000);

        const check = setInterval(() => {
          if (this.wsStarted && this._identityReady) {
            console.log('[FeishuAdapter] WebSocket ready + identity resolved, resolving promise');
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

  /** 获取 Bot 自身的 open_id（用于 self_echo 防护 + 群成员自己识别） */
  async fetchBotIdentity(): Promise<void> {
    try {
      const token = await this.credentials.getToken('feishu');
      const response = await fetch(
        'https://open.feishu.cn/open-apis/bot/v3/info',
        { headers: { 'Authorization': `Bearer ${token}` } },
      );
      const data = await response.json() as any;
      // 飞书 /bot/v3/info 响应结构：{ code, msg, bot: { open_id, app_name, ... } }
      //   注意：没有 data 包装层，bot 直接在顶层
      const botInfo = data.bot;
      if (data.code === 0 && botInfo?.open_id) {
        this._botOpenId = botInfo.open_id;
        // 优先使用配置的 botName，其次 /bot/v3/info 的 app_name
        let botName = this.config.botName?.trim() || botInfo.app_name || '';
        // 降级：如果 app_name 为空，通过应用信息 API 获取
        if (!botName) {
          botName = await this.fetchAppName(token);
        }
        // 最终兜底
        botName = botName || `Bot(${this._botOpenId.substring(0, 8)}...)`;

        // 将 Bot 自己的信息写入 userCache（后续 _trackSenderFromMessage 会优先用 userCache 的名字）
        this.userCache.set(this._botOpenId, { name: botName });

        log.info(`Feishu bot identity resolved: open_id=${this._botOpenId} name=${botName}`);

        // 将 Bot 自己加入所有已知群的成员追踪缓存（不再依赖被动消息事件）
        this._ensureSelfInAllGroups(botName);
      } else {
        log.warn(`Feishu bot identity fetch failed: code=${data.code} msg=${data.msg} hasBot=${!!data.bot} open_id=${data.bot?.open_id || '(missing)'}`);
      }
    } catch (err) {
      log.warn(`Feishu bot identity fetch error: ${(err as Error).message}`);
    } finally {
      this._identityReady = true;
    }
  }

  /** 通过应用信息 API（v6）获取 app_name，作为 /bot/v3/info 的降级方案。
   *  该端点不返回 open_id，仅用于获取应用名称。 */
  private async fetchAppName(token: string): Promise<string> {
    try {
      const appId = this.config.app_id;
      const response = await fetch(
        `https://open.feishu.cn/open-apis/application/v6/applications/${encodeURIComponent(appId)}`,
        { headers: { 'Authorization': `Bearer ${token}` } },
      );
      const data = await response.json() as any;
      if (data.code === 0 && data.data?.app_name) {
        log.info(`Feishu app name resolved via fallback API: ${data.data.app_name}`);
        return data.data.app_name;
      }
      log.warn(`Feishu fallback app name API returned: code=${data.code}`);
    } catch (err) {
      log.warn(`Feishu fallback app name API error: ${(err as Error).message}`);
    }
    return '';
  }

  /** 将 Bot 自己注册到所有已知群的成员追踪缓存中（解决"不知道哪个是自己"的问题） */
  private _ensureSelfInAllGroups(botName: string): void {
    if (!this._botOpenId || !this.config.app_id) return;
    for (const [chatId, chatMembers] of this._memberTrackingCache) {
      // 用 bot 自己的 open_id 或 app_id 作为 memberId
      const selfMemberId = this._botOpenId || this.config.app_id;
      if (!chatMembers.has(selfMemberId)) {
        chatMembers.set(selfMemberId, {
          id: selfMemberId,
          name: botName,
          isBot: true,
          isSelf: true,
        });
        log.info(`Feishu self registered in group tracking: chatId=${chatId} name=${botName}`);
        this._notifyGroupMembers(chatId);
      }
    }
  }

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
      } else {
        log.warn(`Feishu getUserProfile API error: userId=${userId} type=${userIdType || 'open_id'} code=${data.code} msg=${data.msg}`);
      }
    } catch (err) {
      log.warn(`Feishu getUserProfile failed: ${(err as Error).message}`);
    }
    return null;
  }

  /** 获取群聊信息（GET /chats/:id），含群名和成员总数，结果缓存 */
  private async fetchChatInfo(chatId: string): Promise<{ name?: string; userCount?: number }> {
    const cached = this.groupNameCache.get(chatId);
    if (cached) return { name: cached };

    try {
      const token = await this.credentials.getToken('feishu');
      const response = await fetch(
        `https://open.feishu.cn/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`,
        { headers: { 'Authorization': `Bearer ${token}` } },
      );
      const data = await response.json() as any;
      if (data.code === 0) {
        const name = data.data?.name;
        const userCount = data.data?.user_count;
        if (name) this.groupNameCache.set(chatId, name);
        return { name, userCount };
      }
    } catch (err) {
      log.warn(`Feishu fetchChatInfo failed: ${(err as Error).message}`);
    }
    return {};
  }

  /** @deprecated 使用 fetchChatInfo 替代 */
  private async fetchGroupName(chatId: string): Promise<string | undefined> {
    const { name } = await this.fetchChatInfo(chatId);
    return name;
  }

  /** 获取群聊成员列表（GET /chats/:id/members），含机器人标记和自身识别。
   *  结果会缓存，后续消息直接复用缓存。 */
  async fetchGroupMembers(chatId: string): Promise<import('../types.js').GroupMember[]> {
    // 检查缓存（5 分钟内不重复拉取）
    const cached = this.groupMembersCache.get(chatId);
    if (cached && (Date.now() - cached.fetchedAt) < 30 * 1000) {
      return cached.members;
    }

    try {
      const token = await this.credentials.getToken('feishu');
      let allItems: any[] = [];
      let pageToken: string | undefined;

      // 分页拉取所有群成员
      do {
        const url = new URL(`https://open.feishu.cn/open-apis/im/v1/chats/${encodeURIComponent(chatId)}/members`);
        url.searchParams.set('member_id_type', 'union_id');
        url.searchParams.set('page_size', '100');
        if (pageToken) url.searchParams.set('page_token', pageToken);

        const response = await fetch(url.toString(), {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await response.json() as any;
        // DEBUG: 打印原始返回
        log.info(`Feishu fetchGroupMembers RAW: code=${data.code} hasItems=${!!data.data?.items} itemCount=${data.data?.items?.length || 0} hasMore=${data.data?.has_more} pageToken=${data.data?.page_token} items=${JSON.stringify(data.data?.items?.map((i: any) => ({ member_id: i.member_id, member_type: i.member_type, name: i.name })))}`);

        if (data.code !== 0) {
          log.warn(`Feishu fetchGroupMembers API error: code=${data.code} msg=${data.msg}`);
          break;
        }
        if (data.data?.items) {
          allItems.push(...data.data.items);
        }
        pageToken = data.data?.has_more ? data.data?.page_token : undefined;
      } while (pageToken);

      if (allItems.length > 0) {
        const members: import('../types.js').GroupMember[] = [];
        for (const item of allItems) {
          const isBot = item.member_type === 'bot';
          // 获取成员名称：优先使用 API 返回的 name，否则回退查缓存/Contact API
          let memberName = item.name || '';
          if (!memberName && item.member_id) {
            // 尝试从用户缓存获取
            const userCached = this.userCache.get(item.member_id);
            if (userCached) {
              memberName = userCached.name;
            }
          }
          if (!memberName) {
            memberName = item.member_id?.substring(0, 12) + '...' || '未知成员';
          }

          members.push({
            id: item.member_id,
            name: memberName,
            isBot,
            // 标记自己：member_id 与当前应用的 open_id 或 app_id 相同
            // 注意：API 使用 member_id_type=union_id，但 Bot 的 member_id 可能以多种格式返回
            isSelf: item.member_id === this._botOpenId || item.member_id === this.config.app_id,
          });
        }
        this.groupMembersCache.set(chatId, { members, fetchedAt: Date.now() });
        log.info(`Feishu fetchGroupMembers: chatId=${chatId} count=${members.length} bots=${members.filter(m => m.isBot).length}`);
        return members;
      }
    } catch (err) {
      log.warn(`Feishu fetchGroupMembers failed: ${(err as Error).message}`);
    }
    return [];
  }

  // ── 方案 B：基于事件的群成员追踪 ────────────────────────

  /** 从消息事件中提取发送者信息，加入群成员追踪缓存 */
  private _trackSenderFromMessage(data: any): void {
    try {
      const chatId = data?.message?.chat_id;
      const sender = data?.sender;
      if (!chatId || !sender) return;

      const openId = sender.sender_id?.open_id || '';
      const userId = sender.sender_id?.user_id || '';
      const unionId = sender.sender_id?.union_id || '';
      const appId = sender.sender_id?.app_id || '';
      // Bot 发送者使用 app_id 作为 ID（open_id/user_id 可能为空）
      const memberId = openId || userId || unionId || appId;
      if (!memberId) return;

      let chatMembers = this._memberTrackingCache.get(chatId);
      if (!chatMembers) {
        chatMembers = new Map();
        this._memberTrackingCache.set(chatId, chatMembers);
      }

      if (!chatMembers.has(memberId)) {
        const isBot = sender.sender_type === 'bot';
        const name = this.userCache.get(openId)?.name || this.userCache.get(userId)?.name
          || (isBot ? `Bot(${memberId.substring(0, 8)}...)` : `用户(${memberId.substring(0, 8)}...)`);
        chatMembers.set(memberId, {
          id: memberId,
          name,
          isBot,
          isSelf: (openId && openId === this._botOpenId) || (appId && appId === this.config.app_id),
        });
        log.info(`Feishu member tracked from message: chatId=${chatId} id=${memberId} name=${name} isBot=${isBot}`);
        this._notifyGroupMembers(chatId);
      }
    } catch (err) {
      // 非关键路径，静默忽略
    }
  }

  /** 处理群成员加入事件（user + bot） */
  private _handleMembersAdded(data: any, isBot: boolean): void {
    try {
      const chatId = data?.event?.chat_id || data?.chat_id;
      const users = data?.event?.users || data?.event?.user ? [data?.event?.user] : [];
      if (!chatId || users.length === 0) return;

      let chatMembers = this._memberTrackingCache.get(chatId);
      if (!chatMembers) {
        chatMembers = new Map();
        this._memberTrackingCache.set(chatId, chatMembers);
      }

      for (const user of users) {
        // Bot 成员用 app_id，人类成员用 open_id/user_id
        const memberId = user.app_id || user.open_id || user.user_id || '';
        if (!memberId) continue;
        const name = user.name || user.display_name || '';
        chatMembers.set(memberId, {
          id: memberId,
          name: name || (isBot ? `Bot(${memberId.substring(0, 8)}...)` : `用户(${memberId.substring(0, 8)}...)`),
          isBot,
          isSelf: (user.app_id && user.app_id === this.config.app_id) || (user.open_id && user.open_id === this._botOpenId),
        });
        log.info(`Feishu member added: chatId=${chatId} id=${memberId} name=${name} isBot=${isBot}`);
      }
      this._notifyGroupMembers(chatId);
    } catch (err) {
      log.warn(`Feishu _handleMembersAdded error: ${(err as Error).message}`);
    }
  }

  /** 处理群成员移除事件（user + bot） */
  private _handleMembersRemoved(data: any): void {
    try {
      const chatId = data?.event?.chat_id || data?.chat_id;
      const users = data?.event?.users || data?.event?.user ? [data?.event?.user] : [];
      if (!chatId || users.length === 0) return;

      const chatMembers = this._memberTrackingCache.get(chatId);
      if (!chatMembers) return;

      for (const user of users) {
        const memberId = user.app_id || user.open_id || user.user_id || '';
        if (!memberId) continue;
        chatMembers.delete(memberId);
        log.info(`Feishu member removed: chatId=${chatId} id=${memberId}`);
      }
      this._notifyGroupMembers(chatId);
    } catch (err) {
      log.warn(`Feishu _handleMembersRemoved error: ${(err as Error).message}`);
    }
  }

  /** 判断消息是否 @ 了当前 Bot（从 raw 中取结构化 mentions 做三阶梯匹配） */
  private _isMentioned(msg: PlatformMessage): boolean {
    if (!this._botOpenId && !this.config.app_id) return false;
    const mentions: any[] = msg.raw?.message?.mentions || msg.raw?.mentions || [];
    return mentions.some((m: any) =>
      (this._botOpenId && m.id?.open_id === this._botOpenId) ||
      (this._botOpenId && m.id?.union_id === this._botOpenId) ||
      (m.id?.app_id === this.config.app_id)
    );
  }

  /** 重建群成员数组并通知 AgentGateway。alwaysIncludeSelf=true 时即使缓存为空也确保 Bot 自己出现在列表中 */
  private _notifyGroupMembers(chatId: string, alwaysIncludeSelf = false): void {
    if (!this.groupMembersHandler) return;
    const chatMembers = this._memberTrackingCache.get(chatId);
    if ((!chatMembers || chatMembers.size === 0) && !alwaysIncludeSelf) return;

    const members = Array.from((chatMembers || new Map()).values());

    // 确保 Bot 自己在列表中（解决"不知道哪个是自己"的根本问题）
    if (this._botOpenId) {
      const selfMemberId = this._botOpenId;
      if (!members.some(m => m.isSelf)) {
        const botName = this.userCache.get(this._botOpenId)?.name || `Bot(${this._botOpenId.substring(0, 8)}...)`;
        members.push({
          id: selfMemberId,
          name: botName,
          isBot: true,
          isSelf: true,
        });
        log.info(`Feishu self appended to group members: chatId=${chatId} name=${botName}`);
      }
    }

    log.info(`Feishu group members (event-based): chatId=${chatId} count=${members.length} bots=${members.filter(m => m.isBot).length}`);
    this.groupMembersHandler(chatId, members);
  }

  /** 收到消息后自动丰富：用户名 → 群名 → 回复上下文 → 附件下载 → 推送 → 已读 ACK（文档 §3.4 + §9） */
  private async enrichAndForward(msg: PlatformMessage): Promise<void> {
    // 1. 获取用户名称（Contact API），确保 session 注册时已有 displayName
    if (!msg.userName) {
      await this.enrichUserName(msg);
    }
    // 2. 群聊消息：获取群名并注入到 raw.chatName + raw.chatUserCount
    if (msg.chatType === 'group' && !msg.raw?.chatName) {
      const info = await this.fetchChatInfo(msg.chatId);
      if (msg.raw) {
        if (info.name) msg.raw.chatName = info.name;
        if (info.userCount !== undefined) msg.raw.chatUserCount = info.userCount;
      }
    }
    // 2a. 群聊消息：方案 B 优先用事件累积的成员（已通过 _trackSenderFromMessage 处理）
    //    alwaysIncludeSelf=true 确保 Bot 自己的身份始终在列表中
    if (msg.chatType === 'group' && this.groupMembersHandler) {
      this._notifyGroupMembers(msg.chatId, true);
      // 后台尝试 API 补充（fire-and-forget）
      this.fetchGroupMembers(msg.chatId).then(apiMembers => {
        if (apiMembers.length > 0 && this.groupMembersHandler) {
          this.groupMembersHandler(msg.chatId, apiMembers);
        }
      }).catch(() => {});
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
    // 5a. 群聊消息：只有 @ 了自己才送 Agent 处理，其余仅记录成员图谱
    if (msg.chatType === 'group' && !this._isMentioned(msg)) {
      log.debug(`Feishu group message skipped (not @mentioned, member tracked): chatId=${msg.chatId}`);
      // 仍然发送已读回执，但不送 Agent
      if (msg.id && msg.eventType === 'message') {
        this.ackMessage(msg.id).catch(() => {});
      }
      return;
    }
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
            // interactive 卡片：复用 extractInteractiveText 处理 1D/2D elements + user_dsl
            repliedText = this.extractInteractiveText(inner) || '[卡片消息]';
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

  /**
   * 从 interactive 卡片消息中提取文本内容。
   * 支持 1D 和 2D elements 数组、user_dsl 后备解析、header title。
   */
  private extractInteractiveText(content: any): string {
    const parts: string[] = [];
    const elements: any[] = content.elements || content.card?.elements || [];

    function extractSegment(seg: any): string {
      if (!seg) return '';
      if (seg.tag === 'markdown' && seg.content) return seg.content;
      if (seg.tag === 'text' && seg.text) return seg.text;
      if (seg.tag === 'at') return seg.user_name ? `@${seg.user_name}` : '';
      if (seg.tag === 'a' && seg.text) return seg.text;
      if (seg.tag === 'img') return '[图片]';
      if (seg.tag === 'emotion') return '[表情]';
      if (seg.tag === 'hr') return '\n---\n';
      if (seg.tag === 'div' && seg.text) return typeof seg.text === 'string' ? seg.text : seg.text?.content || '';
      return '';
    }

    const is2D = elements.length > 0 && Array.isArray(elements[0]);
    if (is2D) {
      for (const line of elements) {
        if (Array.isArray(line)) {
          const lineText = line.map(extractSegment).join('');
          if (lineText) parts.push(lineText);
        }
      }
    } else {
      for (const el of elements) {
        const segText = extractSegment(el);
        if (segText) parts.push(segText);
      }
    }

    // user_dsl 后备（部分 bot 在此字段存渲染后的 markdown）
    if (parts.length === 0 && content.user_dsl) {
      try {
        const dsl = typeof content.user_dsl === 'string' ? JSON.parse(content.user_dsl) : content.user_dsl;
        const dslElements = dsl.elements || [];
        for (const el of dslElements) {
          if (el.tag === 'markdown' && el.content) {
            parts.push(el.content);
          } else if (el.tag === 'div' && el.text) {
            parts.push(typeof el.text === 'string' ? el.text : el.text?.content || '');
          }
        }
      } catch { /* user_dsl parse failed, ignore */ }
    }

    if (content.header?.title?.content) {
      parts.unshift(content.header.title.content);
    }

    return parts.join('\n');
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

  /** 将飞书 SDK 的 @_user_X 标记替换为用户名，让 Agent 理解 @ 对象。
   *   同时缓存 mention 的 open_id → name 映射，后续该用户发言时自动匹配名字。 */
  private cleanMentionMarkers(msg: PlatformMessage): void {
    if (!msg.raw?.message?.mentions || msg.raw.message.mentions.length === 0) return;
    try {
      for (const m of msg.raw.message.mentions) {
        // 缓存 open_id → name 映射
        const openId = m.id?.open_id || m.id?.user_id || '';
        if (openId && m.name && !this.userCache.has(openId)) {
          this.userCache.set(openId, { name: m.name, fetchedAt: Date.now() });
        }
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
    } else {
      log.warn(`Feishu enrichUserName failed: userId=${msg.userId} chatType=${msg.chatType} chatId=${msg.chatId}`);
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
    // 消息去重：基于 message_id，防止 WebSocket 重连/重试导致重复处理
    const messageId = data?.message?.message_id || data?.message_id;
    if (messageId && this.deduplicator?.isDuplicate(messageId)) {
      return null;
    }

    const sender = data.sender;
    // Self-echo 防护：跳过自己发出的消息（防止多 Bot 场景无限循环）
    if (sender?.sender_type === 'bot') {
      // open_id 优先（/bot/v3/info），app_id 后备（部分应用 API 不返回 open_id）
      const senderOpenId = sender.sender_id?.open_id || '';
      const senderAppId = sender.sender_id?.app_id || '';
      const isSelf = (this._botOpenId && senderOpenId === this._botOpenId) ||
                     (senderAppId && senderAppId === this.config.app_id);
      if (isSelf) {
        return null; // 自己的消息，跳过
      }
      // 其他 Bot 的消息：根据 _allowBots 策略决定是否处理
      if (this._allowBots === 'none') {
        return null;
      }
      if (this._allowBots === 'mentions') {
        // 只有被 @ 了才处理
        const mentions: any[] = data.message?.mentions || [];
        const isMentioned = mentions.some((m: any) =>
          (this._botOpenId && m.id?.open_id === this._botOpenId) ||
          (m.id?.app_id === this.config.app_id)
        );
        if (!isMentioned) return null;
      }
    }

    return this.buildMessage(data, data.message, data.sender, sender?.sender_type);
  }

  /** 统一的消息构建逻辑 */
  private buildMessage(raw: any, msg: any, sender: any, senderType?: 'user' | 'bot'): PlatformMessage | null {
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
      } else if (msgType === 'sticker') {
        // 飞书自带表情包：标记为 [表情/sticker] 并记录 sticker_key
        const key = content.sticker_key || content.file_key;
        if (key) attachments.push({ type: 'image', url: `feishu://sticker/${key}`, name: '[表情/sticker]' });
        if (!text) text = `[表情/sticker]`;
      } else if (msgType === 'interactive') {
        // 解析 interactive 卡片消息，复用 extractInteractiveText 处理 1D/2D elements + user_dsl
        const elements: any[] = content.elements || content.card?.elements || [];
        const is2D = elements.length > 0 && Array.isArray(elements[0]);
        const _diagExtracted = this.extractInteractiveText(content);
        log.info(`[DIAG-interactive] raw content keys: ${Object.keys(content).join(',')}, elements=${!!content.elements}, card=${!!content.card}, is2D=${is2D}`);
        log.info(`[DIAG-interactive] elements count=${elements.length}, extracted len=${_diagExtracted.length}, user_dsl=${!!content.user_dsl}`);
        text = _diagExtracted || text;
      } else if (msgType === 'post') {
        // 解析 post 富文本消息
        const parts: string[] = [];
        const lines = content.content || [];
        for (const line of (lines || [])) {
          for (const seg of (line || [])) {
            if (seg.tag === 'text' || seg.tag === 'a') parts.push(seg.text || '');
            else if (seg.tag === 'at') parts.push(seg.user_name || seg.user_id || '');
            else if (seg.tag === 'img') parts.push('[图片]');
            else if (seg.tag === 'emotion') parts.push('[表情]');
          }
        }
        text = parts.join('') || text;
      }
    } catch {
      text = msg.content || '';
    }

    // 结构化 @ 提及信息，包含三阶梯 isSelf 匹配（open_id > user_id > app_id）
    const mentionRefs: Array<{
      key: string; name: string; openId?: string; userId?: string; appId?: string; isSelf: boolean;
    }> = [];
    const mentions: string[] = [];
    for (const m of (msg.mentions || [])) {
      const key = m.key || '';
      const name = m.name || '';
      const openId: string = m.id?.open_id || '';
      const userId: string = m.id?.user_id || '';
      const appId: string = m.id?.app_id || '';

      // 三阶梯匹配判断是否 @ 了自己：open_id 优先，其次 user_id，最后 app_id
      let isSelf = false;
      if (this._botOpenId && openId) {
        isSelf = openId === this._botOpenId;
      } else if (this._botOpenId && userId) {
        isSelf = userId === this._botOpenId;
      } else if (appId) {
        isSelf = appId === this.config.app_id;
      }

      mentionRefs.push({
        key, name,
        openId: openId || undefined,
        userId: userId || undefined,
        appId: appId || undefined,
        isSelf,
      });
      mentions.push(key || name);
    }

    // 缓存 @ 提及用户的 open_id → name 映射，后续该用户发消息时能自动匹配名字
    for (const ref of mentionRefs) {
      const resolvedId = ref.openId || ref.userId || '';
      if (resolvedId && ref.name && !this.userCache.has(resolvedId)) {
        this.userCache.set(resolvedId, { name: ref.name, fetchedAt: Date.now() });
      }
    }

    const userId = sender.sender_id?.open_id || sender.sender_id?.user_id || sender.sender_id?.app_id || '';
    const userName = this.userCache.get(userId)?.name;

    return {
      id: msg.message_id,
      platform: 'feishu',
      userId,
      userName,
      senderType,
      chatId: msg.chat_id,
      chatType,
      text,
      attachments: attachments.length > 0 ? attachments : undefined,
      mentions,
      mentionRefs: mentionRefs.length > 0 ? mentionRefs : undefined,
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
    // 持久化去重状态，防止重启后消息重复
    this.deduplicator?.save();
    this.deduplicator = null;
  }

  async ping(): Promise<void> {
    await this.credentials.getToken('feishu');
  }

  onMessage(handler: (msg: PlatformMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * 将文本中的 @name 转换为飞书 <at id=open_id>name</at> 格式，实现真正的 @ 通知。
   * name → open_id 映射来自成员追踪缓存 + userCache（从 @ 提及中积累）。
   */
  private resolveAtMentions(text: string, chatId: string): string {
    // 构建 name → open_id 反向查询表
    const nameToId = new Map<string, string>();

    // 从群成员追踪缓存获取
    const tracked = this._memberTrackingCache.get(chatId);
    if (tracked) {
      for (const [memberId, member] of tracked) {
        if (member.name && !nameToId.has(member.name)) {
          nameToId.set(member.name, memberId);
        }
      }
    }

    // 从 userCache 补充（通过 mention 积累的映射）
    for (const [openId, user] of this.userCache) {
      if (user.name && !nameToId.has(user.name)) {
        nameToId.set(user.name, openId);
      }
    }

    if (nameToId.size === 0) return text;

    // 替换 @name 为 <at id=open_id>name</at>
    // 匹配模式：@后跟汉字/字母/数字/下划线/连字符，非贪婪，到空格/换行/标点/结尾
    return text.replace(/@([一-龥a-zA-Z0-9_\-]+)/g, (match, name) => {
      const openId = nameToId.get(name);
      if (openId) {
        return `<at id=${openId}></at>`;
      }
      return match; // 未找到映射，保留原文
    });
  }

    async sendText(options: { chatId: string; text: string; replyTo?: string }): Promise<string> {
    const token = await this.credentials.getToken('feishu');
    const resolvedText = this.resolveAtMentions(options.text, options.chatId);
    const body: Record<string, unknown> = {
      msg_type: 'interactive',
      content: JSON.stringify({
        config: { wide_screen_mode: true },
        elements: [{ tag: 'markdown', content: resolvedText }],
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
    const resolvedContent = this.resolveAtMentions(options.content, options.chatId);
    const body: Record<string, unknown> = {
      msg_type: 'interactive',
      content: JSON.stringify({
        config: { wide_screen_mode: true },
        elements: [{ tag: 'markdown', content: resolvedContent }],
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
