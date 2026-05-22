/**
 * AgentGatewayImpl — PlatformRouter ↔ AgentLoop 集成桥接
 *
 * 设计文档：docs/platform-integration-design.md §11.2
 */

import type { AgentLoop, AgentCallbacks } from '@/core/agent/AgentLoop.js';
import type { AgentGateway, AgentReply, PlatformMessage, Attachment } from './types.js';
import type { SessionRouter } from './SessionRouter.js';
import type { MemoryManager } from '@/core/memory/MemoryManager.js';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'AgentGateway' });

export class AgentGatewayImpl implements AgentGateway {
  /** 保护 agentLoop.run() 的互斥锁（AgentLoop 不可重入） */
  private processing = false;
  private pendingResolvers: Array<() => void> = [];

  constructor(
    private agentLoop: AgentLoop,
    private sessionRouter: SessionRouter,
    private memoryManager?: MemoryManager,
  ) {}

  async process(
    msg: PlatformMessage,
    options?: { sessionKey?: string; channelPrompt?: string },
  ): Promise<AgentReply> {
    // 等待前一个任务完成
    await this.waitForTurn();

    this.processing = true;
    try {
      return await this.doProcess(msg, options);
    } finally {
      this.processing = false;
      this.notifyNext();
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

    // 5. 标记 AgentLoop 当前会话键，确保事件正确路由
    this.agentLoop.setSessionKey(sessionKey);
    try {
      // 6. 调用 AgentLoop（通过回调收集输出）
      const response = await this.runAgentLoop(fullMessage);

      // 7. 保存消息到历史
      this.sessionRouter.saveMessages(sessionKey, [
        { role: 'user', content: msg.text, timestamp: Date.now() },
        { role: 'assistant', content: response.text, timestamp: Date.now() },
      ]);

      return response;
    } finally {
      this.agentLoop.setSessionKey(null);
    }
  }

  // ── AgentLoop 调用 ────────────────────────────────────────

  private runAgentLoop(userMessage: string): Promise<AgentReply> {
    return new Promise((resolve, reject) => {
      let outputText = '';
      let hasError = false;

      const callbacks: AgentCallbacks = {
        onText: (text: string) => {
          outputText += text;
        },
        onEnd: () => {
          if (!hasError) {
            resolve({ text: outputText || '已处理完成。' });
          }
        },
        onError: (error: Error) => {
          hasError = true;
          reject(error);
        },
      };

      // 临时注册回调，不覆盖已有的
      this.agentLoop.on(callbacks);

      this.agentLoop.run(userMessage).catch((err) => {
        reject(err);
      });
    });
  }

  // ── 消息构建 ──────────────────────────────────────────────

  private buildUserMessage(msg: PlatformMessage, channelPrompt?: string): string {
    const parts: string[] = [];

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
        case 'image': return `[图片: ${a.localPath || a.url}]`;
        case 'file': return `[文件: ${a.name || a.localPath}]`;
        case 'voice': return `[语音消息]`;
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

  // ── 互斥 ──────────────────────────────────────────────────

  private waitForTurn(): Promise<void> {
    if (!this.processing) return Promise.resolve();
    return new Promise(resolve => {
      this.pendingResolvers.push(resolve);
    });
  }

  private notifyNext(): void {
    const next = this.pendingResolvers.shift();
    if (next) next();
  }
}
