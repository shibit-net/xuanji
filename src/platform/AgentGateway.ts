/**
 * AgentGatewayImpl — PlatformRouter ↔ AgentLoop 集成桥接
 *
 * 设计文档：docs/platform-integration-design.md §11.2
 *
 * v2 — 群聊上下文增强：注入群成员列表、发送者、@ 信息、回复关系
 *       历史消息带上发送者身份，支持 [回复:msgId] 语法
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import type { AgentLoop, AgentCallbacks } from '@/agent/AgentLoop.js';
import type { AgentGateway, AgentReply, PlatformMessage, Attachment } from './types.js';
import type { GroupMember } from './types.js';
import type { SessionRouter, MessageMeta } from './SessionRouter.js';
import type { MemoryManager } from '@/memory/MemoryManager.js';
import { eventBus } from '@/infrastructure/events/EventBus';
import { XuanjiEvent } from '@/infrastructure/events/events';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'AgentGateway' });

export class AgentGatewayImpl implements AgentGateway {
  /** 群成员配置：chatId → GroupMember[] */
  private groupMembers = new Map<string, GroupMember[]>();

  /** 当前实例的 bot 显示名（群聊中自己叫什么） */
  private botDisplayName = '';

  /** 当前实例的 bot ID */
  private botId = '';

  constructor(
    private agentLoop: AgentLoop,
    private sessionRouter: SessionRouter,
    private memoryManager?: MemoryManager,
  ) {}

  /** 设置群聊成员列表 */
  setGroupMembers(chatId: string, members: GroupMember[]): void {
    this.groupMembers.set(chatId, members);
    // 找到自己的身份
    for (const m of members) {
      if (m.isSelf) {
        this.botDisplayName = m.name;
        this.botId = m.id;
        break;
      }
    }
  }

  /** 根据 userId 查找群成员显示名 */
  getMemberName(chatId: string, userId: string): string | undefined {
    const members = this.groupMembers.get(chatId);
    if (!members) return undefined;
    for (const m of members) {
      if (m.id === userId) return m.name;
    }
    return undefined;
  }

  async process(
    msg: PlatformMessage,
    options?: { sessionKey?: string; channelPrompt?: string },
  ): Promise<AgentReply> {
    // 状态机已通过 SessionStateMachine 管理中断/排队，不再需要 agentBusy 锁
    return await this.doProcess(msg, options);
  }

  private async doProcess(
    msg: PlatformMessage,
    options?: { sessionKey?: string; channelPrompt?: string },
  ): Promise<AgentReply> {
    const sessionKey = options?.sessionKey || msg.sessionKey;
    const channelPrompt = options?.channelPrompt || msg.channelPrompt;

    // 1. 构建带群聊上下文的 user message
    const enhancedMessage = this.buildUserMessage(msg, channelPrompt);

    // 2. 加载带发送者信息的历史消息
    const recentHistory = this.sessionRouter.loadRecentHistory(sessionKey, 10);

    // 3. 组装完整消息（历史 + 当前消息）
    const fullMessage = this.buildFullMessage(enhancedMessage, recentHistory);

    // 4. 记忆上下文（按 userId 查询跨平台共享记忆）
    const memoryContext = await this.loadMemoryContext(msg);

    // 5. 注入渠道标识 + 群聊回复说明到 system prompt
    const platformLabels: Record<string, string> = {
      wechat: 'WeChat',
      feishu: 'Feishu',
      dingtalk: 'DingTalk',
      wecom: 'WeCom',
    };
    const label = platformLabels[msg.platform] || msg.platform;

    let systemPromptAddon = `\n[Channel: ${label}] You are responding through ${label}.`;

    // 群聊场景注入回复语法说明
    if (msg.chatType === 'group') {
      const selfName = this.botDisplayName || msg.userName || '你自己';
      systemPromptAddon += `\n\
群聊回复说明：
- 群聊中每条消息前会标注 [发送者名字]
- 如果消息包含 @某人，会标注 [@了: 名单]
- 如果消息是对另一条消息的回复，会标注 [回复了 X 的消息: "内容"]
- 你回复时如果想引用某条消息，用 [回复:消息ID] 开头
- 例如： [回复:msg_xxx] 我同意你的观点...
- 当前群聊中你的名字是：${selfName}`;
    }

    this.agentLoop.getContextManager().setSystemPromptSuffix(
      systemPromptAddon,
      'channel-info',
    );

    // 远端平台能力提示：所有远端平台都需要用 send_file_to_user 发送文件
    if (msg.platform === 'wechat' || msg.platform === 'feishu') {
      this.agentLoop.getContextManager().setSystemPromptSuffix(
        '\n发送图片/文件必须用 send_file_to_user 工具，不要用 MCP 工具。生成图片后立即调用，调用后简短回复"已发送"即可。',
        'platform-send-file-capability',
      );
    }

    // 6. 标记 AgentLoop 当前会话键，确保事件正确路由
    this.agentLoop.setSessionKey(sessionKey);
    try {
      // 6a. 将平台附件下载并转换为 media ContentBlocks
      const mediaBlocks = await this.convertAttachmentsToMediaBlocks(msg.attachments || []);

      // 7. 调用 AgentLoop（通过回调收集输出）
      const response = await this.runAgentLoop(fullMessage, mediaBlocks.imageBlocks, mediaBlocks.audioBlocks, mediaBlocks.videoBlocks);

      // 8. 解析 Agent 输出中的 [回复:msgId] 语法
      const parsed = this.parseAgentResponse(response.text);

      // 9. 保存消息到历史（带发送者/@/回复元信息）
      this.sessionRouter.saveMessageWithMeta(sessionKey, 'user', msg.text, {
        senderName: msg.userName || msg.userId,
        senderId: msg.userId,
        mentions: msg.mentions,
        replyTo: msg.replyTo,
        replyToMsg: msg.id,
      });
      this.sessionRouter.saveMessageWithMeta(sessionKey, 'assistant', parsed.text);

      return { ...response, text: parsed.text };
    } finally {
      this.agentLoop.setSessionKey(null);
      this.agentLoop.getContextManager().setSystemPromptSuffix('', 'channel-info');
      this.agentLoop.getContextManager().setSystemPromptSuffix('', 'platform-send-file-capability');
    }
  }

  // ── AgentLoop 调用 ────────────────────────────────────────

  private runAgentLoop(
    userMessage: string,
    imageBlocks?: Array<{ data: string; mimeType: string }>,
    audioBlocks?: Array<{ data: string; mimeType: string }>,
    videoBlocks?: Array<{ data: string; mimeType: string }>,
  ): Promise<AgentReply> {
    return new Promise((resolve, reject) => {
      let outputText = '';
      let hasError = false;
      const imagePaths: string[] = [];
      const audioPaths: string[] = [];
      const videoPaths: string[] = [];
      const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
      const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.aac', '.flac', '.wma', '.m4a', '.opus']);
      const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v']);

      // 通过 EventBus 监听文件变更
      const onFileChange = (payload: { changes: Array<{ filePath: string }>; sessionKey?: string }) => {
        if (!payload?.changes?.length) return;
        for (const change of payload.changes) {
          const ext = path.extname(change.filePath).toLowerCase();
          if (IMAGE_EXTS.has(ext)) {
            imagePaths.push(change.filePath);
          } else if (AUDIO_EXTS.has(ext)) {
            audioPaths.push(change.filePath);
          } else if (VIDEO_EXTS.has(ext)) {
            videoPaths.push(change.filePath);
          }
        }
      };
      eventBus.on(XuanjiEvent.AGENT_FILE_CHANGES, onFileChange);

      const callbacks: AgentCallbacks = {
        onText: (text: string) => {
          outputText += text;
        },
        onEnd: () => {
          eventBus.off(XuanjiEvent.AGENT_FILE_CHANGES, onFileChange);
          if (!hasError) {
            resolve({
              text: outputText || '已处理完成。',
              imagePaths: imagePaths.length > 0 ? imagePaths : undefined,
              audioPaths: audioPaths.length > 0 ? audioPaths : undefined,
              videoPaths: videoPaths.length > 0 ? videoPaths : undefined,
            });
          }
        },
        onError: (error: Error) => {
          eventBus.off(XuanjiEvent.AGENT_FILE_CHANGES, onFileChange);
          hasError = true;
          reject(error);
        },
      };

      this.agentLoop.on(callbacks);
      this.agentLoop.run(userMessage, undefined, imageBlocks, audioBlocks, videoBlocks).catch((err) => {
        eventBus.off(XuanjiEvent.AGENT_FILE_CHANGES, onFileChange);
        reject(err);
      });
    });
  }

  // ── 消息构建 ──────────────────────────────────────────────

  private buildUserMessage(msg: PlatformMessage, channelPrompt?: string): string {
    const parts: string[] = [];

    // Channel prompt（平台能力说明）
    if (channelPrompt) {
      parts.push(channelPrompt);
    }

    // === 群聊上下文头部（仅对群聊消息）===
    if (msg.chatType === 'group') {
      parts.push('');
      parts.push('=== 群聊信息 ===');
      const selfName = this.botDisplayName || '未知';
      parts.push(`你的群昵称: ${selfName}`);
      parts.push('');

      const members = this.getGroupMembers(msg.chatId);
      if (members.length > 0) {
        parts.push('群成员:');
        for (const m of members) {
          const selfTag = m.isSelf ? ' ← 这是你自己' : '';
          const botTag = m.isBot ? ' [Bot]' : '';
          parts.push(`  - ${m.name} (${m.id})${botTag}${selfTag}`);
        }
        parts.push('');
      }

      parts.push('=== 当前消息 ===');
    }

    // 发送者信息
    const senderLabel = msg.userName || msg.userId;
    parts.push(`[${senderLabel}]`);

    // @ 提及
    if (msg.mentions?.length) {
      parts.push(`[@了: ${msg.mentions.join(', ')}]`);
    }

    // 回复关系：如果这条消息是对某条消息的回复
    if (msg.replyTo && msg.chatType === 'group') {
      const repliedMsg = this.sessionRouter.getRepliedMessage(msg.sessionKey, msg.replyTo);
      if (repliedMsg) {
        parts.push(`[回复了 ${repliedMsg.senderName} 的消息: "${repliedMsg.content}"]`);
      }
    }

    parts.push(msg.text);

    // 附件
    if (msg.attachments?.length) {
      parts.push(this.buildAttachmentAnnotation(msg.attachments));
    }

    return parts.join('\n');
  }

  /** 从 Agent 输出中解析 [回复:msgId] 语法 */
  private parseAgentResponse(rawText: string): { text: string; replyTo?: string } {
    const replyMatch = rawText.match(/^\[回复:([^\]]+)\]/);
    if (replyMatch) {
      return {
        text: rawText.slice(replyMatch[0].length).trim(),
        replyTo: replyMatch[1],
      };
    }
    return { text: rawText };
  }

  private buildAttachmentAnnotation(attachments: Attachment[]): string {
    const lines = attachments.map(a => {
      switch (a.type) {
        case 'image': return `[系统提示: 用户发了一张图片，URL: ${a.localPath || a.url}]`;
        case 'file': return `[系统提示: 用户发了一个文件${a.name ? `: ${a.name}` : ''}，URL: ${a.localPath || a.url}]`;
        case 'voice': return `[系统提示: 用户发了一条语音消息。]`;
        case 'audio': return `[系统提示: 用户发了一段音频${a.name ? `: ${a.name}` : ''}。]`;
        case 'video': return `[系统提示: 用户发了一段视频${a.name ? `: ${a.name}` : ''}。]`;
      }
    });
    return `\n\n${lines.join('\n')}`;
  }

  /**
   * 构建完整的 Agent 输入消息（历史 + 当前消息）
   * 历史消息携带发送者信息，群聊场景尤为关键
   */
  private buildFullMessage(
    userMessage: string,
    recentHistory: Array<{ role: string; content: string | any; meta?: MessageMeta }>,
  ): string {
    if (!recentHistory.length) return userMessage;

    const historyLines = recentHistory.map(m => {
      const meta = m.meta;
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);

      if (m.role === 'user') {
        const sender = meta?.senderName || '未知用户';
        const atInfo = meta?.mentions?.length ? ` @${meta.mentions.join(',')}` : '';
        const replyInfo = meta?.replyTo ? ` [回复了一条消息]` : '';
        return `[${sender}]${atInfo}${replyInfo}: ${content}`;
      }

      // assistant 消息
      const selfName = this.botDisplayName || '你自己';
      return `[${selfName}]: ${content}`;
    });

    return [
      '=== 最近对话记录 ===',
      ...historyLines.slice(-8), // 最多显示 8 条历史
      '',
      '=== 当前消息 ===',
      userMessage,
    ].join('\n');
  }

  // ── 群成员管理 ────────────────────────────────────────────

  private getGroupMembers(chatId: string): GroupMember[] {
    return this.groupMembers.get(chatId) || [];
  }

  // ── 附件下载 & 多模态转换 ──────────────────────────────────

  private async convertAttachmentsToMediaBlocks(
    attachments: Attachment[],
  ): Promise<{
    imageBlocks?: Array<{ data: string; mimeType: string; name: string }>;
    audioBlocks?: Array<{ data: string; mimeType: string; name: string }>;
    videoBlocks?: Array<{ data: string; mimeType: string; name: string }>;
  }> {
    const imageBlocks: Array<{ data: string; mimeType: string; name: string }> = [];
    const audioBlocks: Array<{ data: string; mimeType: string; name: string }> = [];
    const videoBlocks: Array<{ data: string; mimeType: string; name: string }> = [];

    for (const a of attachments) {
      const localPath = a.localPath || await this.downloadAttachment(a);
      if (!localPath) continue;

      try {
        const data = fs.readFileSync(localPath).toString('base64');
        const mimeType = a.mimeType || this.guessMimeType(a);
        const name = a.name || '';

        if (a.type === 'image' || mimeType.startsWith('image/')) {
          imageBlocks.push({ data, mimeType, name });
        } else if (a.type === 'voice' || a.type === 'audio' || mimeType.startsWith('audio/')) {
          audioBlocks.push({ data, mimeType, name });
        } else if (a.type === 'video' || mimeType.startsWith('video/')) {
          videoBlocks.push({ data, mimeType, name });
        }
      } catch (err) {
        log.warn(`Failed to read attachment ${a.name || a.url}: ${(err as Error).message}`);
      }
    }

    return {
      imageBlocks: imageBlocks.length > 0 ? imageBlocks : undefined,
      audioBlocks: audioBlocks.length > 0 ? audioBlocks : undefined,
      videoBlocks: videoBlocks.length > 0 ? videoBlocks : undefined,
    };
  }

  private async downloadAttachment(a: Attachment): Promise<string | null> {
    if (a.localPath) return a.localPath;
    if (!a.url) return null;
    try {
      const tmpDir = path.join(os.tmpdir(), 'xuanji-platform-attachments');
      fs.mkdirSync(tmpDir, { recursive: true });
      const ext = (a.mimeType || 'application/octet-stream').split('/')[1] || 'bin';
      const dest = path.join(tmpDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
      const res = await fetch(a.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(dest, buffer);
      return dest;
    } catch (err) {
      log.warn(`Failed to download attachment ${a.url}: ${(err as Error).message}`);
      return null;
    }
  }

  private guessMimeType(a: Attachment): string {
    if (a.mimeType) return a.mimeType;
    const urlExt = (a.url || '').split('.').pop()?.toLowerCase();
    const nameExt = (a.name || '').split('.').pop()?.toLowerCase();
    const ext = nameExt || urlExt || '';
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac',
      opus: 'audio/opus', m4a: 'audio/mp4',
      mp4: 'video/mp4', mov: 'video/quicktime', avi: 'video/x-msvideo', mkv: 'video/x-matroska',
      webm: 'video/webm',
    };
    return mimeMap[ext] || 'application/octet-stream';
  }

  // ── 记忆查询 ──────────────────────────────────────────────

  private async loadMemoryContext(msg: PlatformMessage): Promise<string> {
    if (!this.memoryManager) return '';

    try {
      const userId = this.sessionRouter.resolveUserId(msg.platform, msg.userId);
      const results = await this.memoryManager.search({
        query: msg.text,
        limit: 5,
      });

      if (results.length > 0) {
        return results.map(r => `[记忆: ${r.title || r.content}]`).join('\n');
      }
    } catch (err) {
      log.warn(`Memory search failed: ${(err as Error).message}`);
    }

    return '';
  }

}
