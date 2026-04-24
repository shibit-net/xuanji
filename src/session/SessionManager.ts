/**
 * 会话生命周期管理
 *
 * 职责:
 * - 保存当前会话（消息历史 + 元数据）
 * - 恢复已保存的会话
 * - 列出 / 删除已保存会话
 */

import { randomUUID } from 'crypto';
import { execSync } from 'child_process';
import { basename } from 'path';
import { SessionStorage } from './SessionStorage.js';
import { SessionSummarizer } from './SessionSummarizer.js';
import type {
  Message,
  SessionMetadata,
  SessionSnapshot,
  SessionListItem,
  SessionStorageOptions,
  ResumeOptions,
  SessionUsage,
  HistoryMessage,
  ResumedSessionContext,
} from './types.js';
import type { ILLMProvider, ProviderConfig, SessionConfig } from '@/core/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'session-manager' });

/**
 * 记忆驱动会话配置（已废弃，保留接口兼容性）
 */
export interface MemoryDrivenConfig {
  /** 是否启用记忆驱动模式（默认 false，已废弃） */
  enabled: boolean;
  /** 保留最近 N 条消息（默认 10） */
  keepRecentMessages: number;
  /** 是否在 save() 时生成摘要（默认 true） */
  generateSummaryOnSave: boolean;
}

export interface SessionManagerOptions extends Partial<SessionStorageOptions> {
  /** 会话配置 */
  sessionConfig?: SessionConfig;
  /** 记忆驱动配置（已废弃） */
  memoryDriven?: Partial<MemoryDrivenConfig>;
  /** LLM Provider（用于生成摘要） */
  provider?: ILLMProvider;
  /** Provider 配置 */
  providerConfig?: ProviderConfig;
}

const DEFAULT_MEMORY_DRIVEN_CONFIG: MemoryDrivenConfig = {
  enabled: false,
  keepRecentMessages: 10,
  generateSummaryOnSave: true,
};

export class SessionManager {
  private storage: SessionStorage;
  /** 当前活跃会话 ID（save 后设置） */
  private activeSessionId: string | null = null;
  /** 会话配置 */
  private sessionConfig: SessionConfig | null = null;
  /** 记忆驱动配置（已废弃） */
  private memoryDrivenConfig: MemoryDrivenConfig;
  /** 会话摘要生成器 */
  private summarizer: SessionSummarizer | null = null;
  /** 上次归档后的消息起始索引 */
  private lastArchiveMessageIndex: number = 0;
  /** 上次归档时间 */
  private lastArchiveTime: number = Date.now();

  constructor(options?: SessionManagerOptions) {
    this.storage = new SessionStorage(options);
    this.sessionConfig = options?.sessionConfig || null;
    this.memoryDrivenConfig = {
      ...DEFAULT_MEMORY_DRIVEN_CONFIG,
      ...options?.memoryDriven,
    };

    // 初始化摘要生成器（如果提供了 provider）
    if (options?.provider && options?.providerConfig) {
      this.summarizer = new SessionSummarizer({
        provider: options.provider,
        config: options.providerConfig,
      });
    }
  }

  /**
   * 保存当前会话
   *
   * @param messages - 当前完整消息历史（来自 MessageManager.getHistory()）
   * @param name - 可选会话名称（默认自动生成）
   * @param options - 额外保存选项（usage、historyMessages）
   * @returns 会话 ID
   */
  async save(
    messages: Message[],
    name?: string,
    options?: {
      usage?: SessionUsage;
      historyMessages?: HistoryMessage[];
    },
  ): Promise<string> {
    const sessionId = this.activeSessionId ?? randomUUID();
    const now = Date.now();

    const metadata: SessionMetadata = {
      id: sessionId,
      name: name || this.generateDefaultName(messages),
      createdAt: this.activeSessionId ? (await this.getExistingCreatedAt(sessionId)) ?? now : now,
      updatedAt: now,
      messageCount: messages.length,
      workingDirectory: process.cwd(),
      preview: this.generatePreview(messages),
      gitInfo: this.getGitInfo(),
    };

    const snapshot: SessionSnapshot = {
      metadata,
      messages,
      checkpoints: [],
      usage: options?.usage,
      historyMessages: options?.historyMessages,
    };

    await this.storage.saveSnapshot(snapshot);
    this.activeSessionId = sessionId;

    return sessionId;
  }

  /**
   * 恢复已保存的会话
   *
   * @returns 恢复的会话上下文
   */
  async resume(sessionId: string, _options?: ResumeOptions): Promise<ResumedSessionContext> {
    const exists = await this.storage.exists(sessionId);
    if (!exists) {
      throw new Error(`会话 ${sessionId} 不存在`);
    }

    const snapshot = await this.storage.loadSnapshot(sessionId);

    // 设置为当前活跃会话
    this.activeSessionId = sessionId;

    // 更新最后访问时间
    await this.storage.updateMetadata(sessionId, (meta) => ({
      ...meta,
      updatedAt: Date.now(),
    }));

    const messages = snapshot.messages;

    return {
      sessionId,
      messages,
      usage: snapshot.usage ?? { input: 0, output: 0, cost: 0 },
      historyMessages: snapshot.historyMessages ?? [],
    };
  }

  /**
   * 列出所有已保存会话
   */
  async list(): Promise<SessionListItem[]> {
    return this.storage.listSessions();
  }

  /**
   * 删除会话
   */
  async delete(sessionId: string): Promise<void> {
    await this.storage.deleteSession(sessionId);
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null;
    }
  }


  /**
   * 🆕 获取记忆驱动配置
   */
  getMemoryDrivenConfig(): MemoryDrivenConfig {
    return { ...this.memoryDrivenConfig };
  }

  /**
   * 🆕 更新记忆驱动配置
   */
  updateMemoryDrivenConfig(config: Partial<MemoryDrivenConfig>): void {
    this.memoryDrivenConfig = {
      ...this.memoryDrivenConfig,
      ...config,
    };
    log.info('Memory-driven config updated:', this.memoryDrivenConfig);
  }

  /**
   * 获取会话元数据
   */
  async getMetadata(sessionId: string): Promise<SessionMetadata | null> {
    try {
      const snapshot = await this.storage.loadSnapshot(sessionId);
      return snapshot.metadata;
    } catch {
      return null;
    }
  }

  /**
   * 获取当前活跃会话 ID
   */
  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  /**
   * 设置活跃会话 ID（用于恢复后关联）
   */
  setActiveSessionId(id: string | null): void {
    this.activeSessionId = id;
  }

  /**
   * 获取底层存储（供 CheckpointManager 使用）
   */
  getStorage(): SessionStorage {
    return this.storage;
  }

  /**
   * 修复损坏的会话
   */
  async repair(sessionId: string): Promise<{ fixed: number; removed: number }> {
    return this.storage.repairSession(sessionId);
  }

  // ─── 私有方法 ─────────────────────────────────────────

  /**
   * 自动生成会话名称（取首条用户消息的前 30 个字符）
   */
  private generateDefaultName(messages: Message[]): string {
    const firstUserMsg = messages.find((m) => m.role === 'user');
    if (!firstUserMsg) {
      return `Session ${new Date().toLocaleString('zh-CN')}`;
    }

    const content = typeof firstUserMsg.content === 'string'
      ? firstUserMsg.content
      : '[对话]';

    return content.slice(0, 30) + (content.length > 30 ? '...' : '');
  }

  /**
   * 生成会话缩略内容（最后一条用户消息 + 最后一条助手回复的摘要）
   */
  private generatePreview(messages: Message[]): string {
    const parts: string[] = [];

    // 从后往前找最后一条用户消息和助手回复
    let lastUser = '';
    let lastAssistant = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!lastAssistant && msg.role === 'assistant') {
        lastAssistant = this.extractTextContent(msg);
      }
      if (!lastUser && msg.role === 'user') {
        lastUser = this.extractTextContent(msg);
      }
      if (lastUser && lastAssistant) break;
    }

    if (lastUser) {
      parts.push(`Q: ${lastUser.slice(0, 60)}${lastUser.length > 60 ? '...' : ''}`);
    }
    if (lastAssistant) {
      parts.push(`A: ${lastAssistant.slice(0, 80)}${lastAssistant.length > 80 ? '...' : ''}`);
    }

    return parts.join(' | ') || '';
  }

  /**
   * 从消息中提取纯文本内容
   */
  private extractTextContent(msg: Message): string {
    if (typeof msg.content === 'string') {
      return msg.content.replace(/\n+/g, ' ').trim();
    }
    // ContentBlock 数组：提取 text 类型的内容
    const texts = msg.content
      .filter(b => b.type === 'text' && b.text)
      .map(b => b.text!);
    return texts.join(' ').replace(/\n+/g, ' ').trim();
  }

  /**
   * 获取 Git 仓库信息（静默失败）
   */
  private getGitInfo(): { branch: string; commit: string } | undefined {
    try {
      const opts = { encoding: 'utf-8' as const, timeout: 5000 };
      const branch = execSync('git rev-parse --abbrev-ref HEAD', opts).trim();
      const commit = execSync('git rev-parse --short HEAD', opts).trim();
      return { branch, commit };
    } catch {
      return undefined;
    }
  }

  /**
   * 获取已存在会话的创建时间
   */
  private async getExistingCreatedAt(sessionId: string): Promise<number | null> {
    try {
      const metadata = await this.getMetadata(sessionId);
      return metadata?.createdAt ?? null;
    } catch {
      return null;
    }
  }

  // ─── 连续会话模式方法 ─────────────────────────────────────────

  /**
   * 初始化：恢复上一次对话（如果启用）
   *
   * @returns 恢复结果（resumed=true 表示成功恢复）
   */
  async initialize(): Promise<{
    resumed: boolean;
    sessionId?: string;
    messages?: Message[];
    historyMessages?: HistoryMessage[];
  }> {
    log.debug(`SessionManager.initialize() called, autoResumeLastSession: ${this.sessionConfig?.autoResumeLastSession}`);

    if (!this.sessionConfig?.autoResumeLastSession) {
      log.debug('Auto-resume is disabled');
      return { resumed: false };
    }

    try {
      const sessions = await this.list();
      log.debug(`Found ${sessions.length} sessions`);

      const lastSession = sessions
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];

      if (!lastSession) {
        log.debug('No previous session found for auto-resume');
        return { resumed: false };
      }

      log.debug(`Last session: ${lastSession.id}, name: ${lastSession.name}`);

      const context = await this.resume(lastSession.id);

      log.info(`Auto-resumed session ${context.sessionId}`);

      return {
        resumed: true,
        sessionId: context.sessionId,
        messages: context.messages,
        historyMessages: context.historyMessages,
      };
    } catch (error) {
      log.warn('Failed to auto-resume previous session:', error);
      return { resumed: false };
    }
  }

  /**
   * 检查是否需要归档
   *
   * @param messageCount - 当前消息总数
   * @param tokenCount - 当前 token 总数
   * @param currentTime - 当前时间（可选，默认 Date.now()）
   * @returns true 表示需要归档
   */
  shouldArchive(
    messageCount: number,
    tokenCount: number,
    currentTime: number = Date.now()
  ): boolean {
    if (!this.sessionConfig) {
      return false;
    }

    const { archiveThresholds } = this.sessionConfig;

    // 消息数超过阈值
    const messagesSinceArchive = messageCount - this.lastArchiveMessageIndex;
    if (messagesSinceArchive >= archiveThresholds.messageCount) {
      log.debug(`Archive triggered: ${messagesSinceArchive} messages since last archive`);
      return true;
    }

    // Token 数超过阈值
    if (tokenCount >= archiveThresholds.tokenCount) {
      log.debug(`Archive triggered: ${tokenCount} tokens exceeded threshold`);
      return true;
    }

    // 时间超过阈值
    const timeSinceArchive = currentTime - this.lastArchiveTime;
    const thresholdMs = archiveThresholds.timeMinutes * 60 * 1000;
    if (timeSinceArchive >= thresholdMs) {
      log.debug(`Archive triggered: ${Math.floor(timeSinceArchive / 60000)} minutes since last archive`);
      return true;
    }

    return false;
  }

  /**
   * 执行归档
   *
   * 流程:
   * 1. 生成会话摘要和关键点
   * 2. 保留最近 N 条消息
   * 5. 更新归档状态
   *
   * @param messages - 当前完整消息历史
   * @param currentMessageIndex - 当前消息索引
   * @returns 归档结果
   */

  /**
   * 检索相关记忆（用于注入 system prompt）
   *
   * @param query - 查询内容（用户消息或会话摘要）
   * @returns 相关记忆条目
   */
}
