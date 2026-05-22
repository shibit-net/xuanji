/**
 * 平台消息接入 — 统一类型定义
 *
 * 设计文档：docs/platform-integration-design.md §2
 */

// ─── 统一消息格式 ──────────────────────────────────────────

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
  raw: any;
}

export interface Attachment {
  type: 'image' | 'file' | 'voice';
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

  onMessage(handler: (msg: PlatformMessage) => void): void;
}

// ─── 配置 ──────────────────────────────────────────────────

export interface PlatformConfig {
  enabled: boolean;
  webhook_path?: string;
  channel_prompts?: Record<string, string>;
}

export interface FeishuConfig extends PlatformConfig {
  app_id: string;
  app_secret: string;
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
  sessionKey: string;
  userId: string;
  chatId: string;
}

// ─── Agent 集成 ────────────────────────────────────────────

export interface AgentReply {
  text: string;
  attachments?: Attachment[];
  contextToken?: string;
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
