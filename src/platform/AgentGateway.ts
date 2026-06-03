/**
 * AgentGatewayImpl — PlatformRouter ↔ AgentLoop 集成桥接
 *
 * 设计文档：docs/platform-integration-design.md §11.2
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import type { AgentLoop, AgentCallbacks } from '@/agent/AgentLoop.js';
import type { AgentGateway, AgentReply, PlatformMessage, Attachment } from './types.js';
import type { SessionRouter } from './SessionRouter.js';
import type { MemoryManager } from '@/memory/MemoryManager.js';
import { eventBus } from '@/infrastructure/events/EventBus';
import { XuanjiEvent } from '@/infrastructure/events/events';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'AgentGateway' });

export class AgentGatewayImpl implements AgentGateway {
  /** 多 Worker 协调：防止多个 worker 同时调用 agentLoop.run() */
  private agentBusy = false;

  constructor(
    private agentLoop: AgentLoop,
    private sessionRouter: SessionRouter,
    private memoryManager?: MemoryManager,
  ) {}

  async process(
    msg: PlatformMessage,
    options?: { sessionKey?: string; channelPrompt?: string },
  ): Promise<AgentReply> {
    // 等待 AgentLoop 空闲（本地 ChatSession 也可能正在使用同一 AgentLoop 实例）
    while (this.agentBusy || this.agentLoop.getState().status !== 'idle') {
      await new Promise(r => setTimeout(r, 200));
    }
    this.agentBusy = true;
    try {
      return await this.doProcess(msg, options);
    } finally {
      this.agentBusy = false;
    }
  }

  private async doProcess(
    msg: PlatformMessage,
    options?: { sessionKey?: string; channelPrompt?: string },
  ): Promise<AgentReply> {
    const sessionKey = options?.sessionKey || msg.sessionKey;
    const channelPrompt = options?.channelPrompt || msg.channelPrompt;

    // 1. 构建增强的 user message
    const enhancedMessage = this.buildUserMessage(msg, channelPrompt);

    // 2. 加载历史消息（用于多轮对话上下文）
    const historyMessages = this.sessionRouter.loadHistory(sessionKey);

    // 3. 设置历史消息到 AgentLoop（如果有 restore 能力）
    const fullMessage = this.buildFullMessage(enhancedMessage, historyMessages);

    // 4. 记忆上下文（按 userId 查询跨平台共享记忆）
    const memoryContext = await this.loadMemoryContext(msg);

    // 5. 注入渠道标识到 system prompt
    // channelPrompt 已通过 buildUserMessage 注入 user message 尾部
    // 这里再在 system prompt 补充简短渠道上下文
    const platformLabels: Record<string, string> = {
      wechat: 'WeChat',
      feishu: 'Feishu',
      dingtalk: 'DingTalk',
      wecom: 'WeCom',
    };
    const label = platformLabels[msg.platform] || msg.platform;
    this.agentLoop.getContextManager().setSystemPromptSuffix(
      `\n[Channel: ${label}] You are responding through ${label}.`,
      'channel-info',
    );

    // 微信额外能力提示
    if (msg.platform === 'wechat') {
      this.agentLoop.getContextManager().setSystemPromptSuffix(
        '\n发送图片/文件必须用 send_file_to_user 工具，不要用 MCP 工具。生成图片后立即调用，调用后简短回复"已发送"即可。',
        'wechat-platform-capability',
      );
    }

    // 6. 标记 AgentLoop 当前会话键，确保事件正确路由
    this.agentLoop.setSessionKey(sessionKey);
    try {
      // 6a. 将平台附件下载并转换为 media ContentBlocks
      const mediaBlocks = await this.convertAttachmentsToMediaBlocks(msg.attachments || []);

      // 7. 调用 AgentLoop（通过回调收集输出）
      const response = await this.runAgentLoop(fullMessage, mediaBlocks.imageBlocks, mediaBlocks.audioBlocks, mediaBlocks.videoBlocks);

      // 7. 保存消息到历史
      this.sessionRouter.saveMessages(sessionKey, [
        { role: 'user', content: msg.text, timestamp: Date.now() },
        { role: 'assistant', content: response.text, timestamp: Date.now() },
      ]);

      return response;
    } finally {
      this.agentLoop.setSessionKey(null);
      this.agentLoop.getContextManager().setSystemPromptSuffix('', 'channel-info');
      this.agentLoop.getContextManager().setSystemPromptSuffix('', 'wechat-platform-capability');
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

      // 通过 EventBus 监听文件变更（比 onFileChanges 回调更可靠）
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

    // Channel prompt（平台能力说明，放在最前面确保 agent 看到）
    if (channelPrompt) {
      parts.push(channelPrompt);
    }

    // 平台上下文
    parts.push(`[${msg.platform} ${msg.chatType === 'group' ? '群聊' : '私聊'}]`);

    if (msg.userName) {
      parts.push(`[发送者: ${msg.userName}]`);
    }

    parts.push(msg.text);

    // 附件
    if (msg.attachments?.length) {
      parts.push(this.buildAttachmentAnnotation(msg.attachments));
    }

    return parts.join('\n');
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

  private buildFullMessage(userMessage: string, history: Array<{ role: string; content: string | any }>): string {
    if (!history.length) return userMessage;

    // 取最近 3 轮作为上下文
    const recentHistory = history.slice(-6);
    const historyText = recentHistory
      .map(m => {
        const role = m.role === 'user' ? '用户' : 'Agent';
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `${role}: ${content}`;
      })
      .join('\n');

    return `## 最近对话历史\n${historyText}\n\n## 当前消息\n${userMessage}`;
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
