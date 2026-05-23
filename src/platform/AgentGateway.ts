/**
 * AgentGatewayImpl — PlatformRouter ↔ AgentLoop 集成桥接
 *
 * 设计文档：docs/platform-integration-design.md §11.2
 */

import path from 'path';
import type { AgentLoop, AgentCallbacks } from '@/core/agent/AgentLoop.js';
import type { AgentGateway, AgentReply, PlatformMessage, Attachment } from './types.js';
import type { SessionRouter } from './SessionRouter.js';
import type { MemoryManager } from '@/core/memory/MemoryManager.js';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import { logger } from '@/core/logger';

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
    const channelLabels: Record<string, string> = {
      wechat: '微信',
      feishu: '飞书',
      dingtalk: '钉钉',
      wecom: '企业微信',
    };
    const channelLabel = channelLabels[msg.platform] || msg.platform;
    this.agentLoop.getContextManager().setSystemPromptSuffix(
      `\n[当前渠道: ${channelLabel}] 你正在通过${channelLabel}与用户对话。`,
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
      // 7. 调用 AgentLoop（通过回调收集输出）
      const response = await this.runAgentLoop(fullMessage);

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

  private runAgentLoop(userMessage: string): Promise<AgentReply> {
    return new Promise((resolve, reject) => {
      let outputText = '';
      let hasError = false;
      const imagePaths: string[] = [];
      const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

      // 通过 EventBus 监听文件变更（比 onFileChanges 回调更可靠）
      const onFileChange = (payload: { changes: Array<{ filePath: string }>; sessionKey?: string }) => {
        if (!payload?.changes?.length) return;
        for (const change of payload.changes) {
          if (change.filePath && IMAGE_EXTS.has(path.extname(change.filePath).toLowerCase())) {
            imagePaths.push(change.filePath);
            log.info(`[DIAG] AgentGateway captured image: ${change.filePath}`);
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
      this.agentLoop.run(userMessage).catch((err) => {
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
        case 'image': return `[系统提示: 用户发了一张图片，但我无法查看图片内容。URL: ${a.localPath || a.url}]`;
        case 'file': return `[系统提示: 用户发了一个文件${a.name ? `: ${a.name}` : ''}，但我无法查看文件内容。URL: ${a.localPath || a.url}]`;
        case 'voice': return `[系统提示: 用户发了一条语音消息，但我无法播放。]`;
      }
    });
    return `\n\n${lines.join('\n')}`;
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
