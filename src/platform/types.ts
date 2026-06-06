/**
 * 平台消息接入 — 统一类型定义
 *
 * 设计文档：docs/platform-integration-design.md §2
 */

// ─── 统一消息格式 ──────────────────────────────────────────

export type PlatformEventType = 'message' | 'read_receipt' | 'recall' | 'typing';

export interface PlatformMessage {
  id: string;
  platform: 'feishu' | 'dingtalk' | 'wecom' | 'wechat';
  userId: string;
  userName?: string;
  chatId: string;
  chatType: 'private' | 'group';
  text: string;
  mentions?: string[];
  attachments?: Attachment[];
  replyTo?: string;
  sessionKey: string;
  channelPrompt?: string;
  /** 事件类型：message（普通消息）、read_receipt（已读回执）、recall（撤回）、typing（正在输入） */
  eventType?: PlatformEventType;
  /** 已读回执：谁读了哪条消息 */
  readReceipt?: {
    messageId: string;
    userId: string;
    readTime: number;
  };
  /** 撤回：撤回了哪条消息 */
  recallMessageId?: string;
  raw: any;
}

export interface Attachment {
  type: 'image' | 'file' | 'voice' | 'audio' | 'video';
  url?: string;
  localPath?: string;
  name?: string;
  size?: number;
  mimeType?: string;
}

// ─── 回复格式 ──────────────────────────────────────────────

export interface PlatformReply {
  text: string;
  attachments?: Attachment[];
  markdown?: boolean;
}

// ─── 适配器接口 ────────────────────────────────────────────

export interface PlatformAdapter {
  readonly platform: 'feishu' | 'dingtalk' | 'wecom' | 'wechat';
  readonly lastActivity: number;

  start(): Promise<void>;
  stop(): Promise<void>;
  ping(): Promise<void>;

  sendText(options: {
    chatId: string;
    text: string;
    replyTo?: string;
  }): Promise<string>;

  sendMarkdown(options: {
    chatId: string;
    content: string;
    replyTo?: string;
  }): Promise<string>;

  sendImage(options: {
    chatId: string;
    imagePath: string;
    replyTo?: string;
  }): Promise<string>;

  sendFile?(options: {
    chatId: string;
    filePath: string;
    fileName?: string;
    replyTo?: string;
  }): Promise<string>;

  sendVoice?(options: {
    chatId: string;
    voicePath: string;
    replyTo?: string;
  }): Promise<string>;

  /** 发送"正在输入"指示（飞书、企微各自有对应 API） */
  sendTyping?(options: { chatId: string }): Promise<void>;

  /** 获取用户资料（名称+头像），用于丰富 session 显示 */
  getUserProfile?(options: {
    userId: string;
  }): Promise<{ name: string; avatar?: string } | null>;

  onMessage(handler: (msg: PlatformMessage) => void): void;

  /** 群成员动态更新回调（飞书等平台在收到群消息时自动拉取成员列表，通知上层注入 AgentGateway） */
  onGroupMembersUpdated?(handler: (chatId: string, members: GroupMember[]) => void): void;
}

// ─── 配置 ──────────────────────────────────────────────────

export interface GroupMember {
  id: string;
  name: string;
  isBot?: boolean;
  /** 标记哪个成员是自己 */
  isSelf?: boolean;
}

export interface PlatformConfig {
  enabled: boolean;
  webhook_path?: string;
  channel_prompts?: Record<string, string>;
  /** 群聊成员列表（用于多 Agent 群聊场景，让 Agent 知道群里有哪些人） */
  group_members?: Record<string, GroupMember[]>;
}

export interface FeishuConfig extends PlatformConfig {
  app_id: string;
  app_secret: string;
  /** 工作区目录路径，用于下载附件到此目录供 Agent 访问 */
  workspacePath?: string;
}

export interface DingTalkConfig extends PlatformConfig {
  client_id: string;
  client_secret: string;
}

export interface WecomConfig extends PlatformConfig {
  corp_id: string;
  agent_id: number;
  secret: string;
  token: string;
  encoding_aes_key: string;
}

export interface WechatConfig extends PlatformConfig {
  token_path: string;
  base_url: string;
  poll_interval_ms: number;
  /** 工作区目录路径，用于下载附件到此目录供 Agent 访问 */
  workspacePath?: string;
}

export interface PlatformsConfig {
  user_mapping?: Record<string, string>;
  feishu?: FeishuConfig;
  dingtalk?: DingTalkConfig;
  wecom?: WecomConfig;
  wechat?: WechatConfig;
}

// ─── 远端会话 ──────────────────────────────────────────────

export interface RemoteSession {
  id: string;
  platform: 'wechat' | 'wecom' | 'feishu' | 'dingtalk';
  name: string;
  avatar?: string;
  status: 'online' | 'offline' | 'connecting';
  unreadCount: number;
  lastMessage?: string;
  lastTime?: number;
  lastActiveAt?: number;
  sessionKey: string;
  userId: string;
  chatId: string;
  /** 是否为群聊（前端侧边栏区分群图标） */
  isGroup?: boolean;
  /** 群聊时群成员数量 */
  memberCount?: number;
}

// ─── Agent 集成 ────────────────────────────────────────────

export interface AgentReply {
  text: string;
  attachments?: Attachment[];
  contextToken?: string;
  /** agent 执行过程中生成的图片文件路径，用于远端平台图片发送 */
  imagePaths?: string[];
  /** agent 执行过程中生成的音频文件路径，用于远端平台语音发送 */
  audioPaths?: string[];
  /** agent 执行过程中生成的视频文件路径，用于远端平台文件发送 */
  videoPaths?: string[];
}

export interface AgentGateway {
  process(
    msg: PlatformMessage,
    options?: {
      sessionKey?: string;
      channelPrompt?: string;
    }
  ): Promise<AgentReply>;
}

// ─── 健康检查 ──────────────────────────────────────────────

export interface PlatformHealth {
  platform: string;
  status: 'healthy' | 'degraded' | 'down';
  lastMessageAt: number;
  lastError?: string;
  tokenExpiresAt?: number;
  circuitBreakerOpen?: boolean;
}
