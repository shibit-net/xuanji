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
import type { IMemoryStore, MemoryEntry, SessionMemory } from '@/memory/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'session-manager' });

/**
 * 记忆驱动会话配置
 */
export interface MemoryDrivenConfig {
  /** 是否启用记忆驱动模式（默认 true） */
  enabled: boolean;
  /** 保留最近 N 条消息（默认 10） */
  keepRecentMessages: number;
  /** 是否在 save() 时生成摘要（默认 true） */
  generateSummaryOnSave: boolean;
}

export interface SessionManagerOptions extends Partial<SessionStorageOptions> {
  /** 会话配置 */
  sessionConfig?: SessionConfig;
  /** 记忆驱动配置（向后兼容，逐步废弃） */
  memoryDriven?: Partial<MemoryDrivenConfig>;
  /** LLM Provider（用于生成摘要） */
  provider?: ILLMProvider;
  /** Provider 配置 */
  providerConfig?: ProviderConfig;
  /** 记忆管理器（用于检索记忆） */
  memoryManager?: IMemoryStore;
}

const DEFAULT_MEMORY_DRIVEN_CONFIG: MemoryDrivenConfig = {
  enabled: true,
  keepRecentMessages: 10,
  generateSummaryOnSave: true,
};

export class SessionManager {
  private storage: SessionStorage;
  /** 当前活跃会话 ID（save 后设置） */
  private activeSessionId: string | null = null;
  /** 会话配置 */
  private sessionConfig: SessionConfig | null = null;
  /** 记忆驱动配置（向后兼容） */
  private memoryDrivenConfig: MemoryDrivenConfig;
  /** 会话摘要生成器 */
  private summarizer: SessionSummarizer | null = null;
  /** 记忆管理器 */
  private memoryManager: IMemoryStore | null = null;
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
    this.memoryManager = options?.memoryManager || null;

    // 初始化摘要生成器（如果提供了 provider）
    if (options?.provider && options?.providerConfig) {
      this.summarizer = new SessionSummarizer({
        provider: options.provider,
        config: options.providerConfig,
        memoryManager: this.memoryManager,
      });
    }
  }

  /**
   * 保存当前会话
   *
   * 🆕 记忆驱动模式：
   * 1. 生成会话摘要和关键点（如果启用）
   * 2. 只保留最近 N 条消息
   * 3. 记录相关记忆引用
   *
   * @param messages - 当前完整消息历史（来自 MessageManager.getHistory()）
   * @param name - 可选会话名称（默认自动生成）
   * @param options - 额外保存选项（usage、historyMessages、memoryRefs）
   * @returns 会话 ID
   */
  async save(
    messages: Message[],
    name?: string,
    options?: {
      usage?: SessionUsage;
      historyMessages?: HistoryMessage[];
      memoryRefs?: string[];
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

    // 🆕 记忆驱动模式处理
    let summary: string | undefined;
    let keyPoints: string[] | undefined;
    let memoryRefs: string[] | undefined = options?.memoryRefs;
    let recentMessages: Message[] | undefined;

    if (this.memoryDrivenConfig.enabled) {
      // 1. 生成摘要（如果启用且有摘要生成器）
      if (this.memoryDrivenConfig.generateSummaryOnSave && this.summarizer && messages.length > 0) {
        try {
          const summaryResult = await this.summarizer.summarize(messages);
          summary = summaryResult.summary;
          keyPoints = summaryResult.keyPoints;
          memoryRefs = summaryResult.memoryRefs || memoryRefs;
          log.info(`Session summary generated: ${keyPoints?.length || 0} key points`);
        } catch (err) {
          log.warn('Failed to generate session summary:', err);
        }
      }

      // 2. 只保留最近 N 条消息
      const keepCount = this.memoryDrivenConfig.keepRecentMessages;
      if (keepCount > 0 && messages.length > keepCount) {
        recentMessages = messages.slice(-keepCount);
        log.info(`Keeping recent ${keepCount} messages (total: ${messages.length})`);
      } else {
        recentMessages = messages;
      }
    }

    const snapshot: SessionSnapshot = {
      metadata,
      // 记忆驱动字段
      summary,
      keyPoints,
      memoryRefs,
      recentMessages,
      // 传统字段（向后兼容）
      messages: this.memoryDrivenConfig.enabled ? [] : messages, // 🔑 新模式不保存完整历史
      checkpoints: [], // Checkpoint 由 CheckpointManager 独立管理
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
   * 🆕 记忆驱动模式：
   * 1. 加载会话摘要和关键点
   * 2. 检索相关记忆条目
   * 3. 返回最近 N 条消息（而非完整历史）
   *
   * @returns 恢复的会话上下文（含摘要、记忆、最近消息）
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

    // 🆕 记忆驱动模式处理
    let memories: Array<{ id: string; content: string; tags?: string[]; timestamp: number }> = [];

    if (this.memoryDrivenConfig.enabled && snapshot.memoryRefs && this.memoryManager) {
      // 检索相关记忆
      try {
        const retrieved = await this.memoryManager.retrieve(
          snapshot.summary || '',
          { maxResults: 20 }
        );

        memories = retrieved.map((entry) => ({
          id: entry.id,
          content: entry.content,
          tags: entry.keywords,
          timestamp: new Date(entry.createdAt).getTime(),
        }));

        log.info(`Retrieved ${memories.length} memories for session ${sessionId}`);
      } catch (err) {
        log.warn('Failed to retrieve memories:', err);
      }
    }

    // 向后兼容：如果是旧会话（没有 recentMessages），使用完整 messages
    const messages = snapshot.recentMessages && snapshot.recentMessages.length > 0
      ? snapshot.recentMessages
      : snapshot.messages;

    return {
      sessionId,
      summary: snapshot.summary,
      keyPoints: snapshot.keyPoints,
      memories,
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
    summary?: string;
    memories?: MemoryEntry[];
  }> {
    console.log('[SessionManager] initialize() called');
    console.log('[SessionManager] autoResumeLastSession:', this.sessionConfig?.autoResumeLastSession);
    log.debug(`SessionManager.initialize() called, autoResumeLastSession: ${this.sessionConfig?.autoResumeLastSession}`);

    if (!this.sessionConfig?.autoResumeLastSession) {
      console.log('[SessionManager] Auto-resume is disabled');
      log.debug('Auto-resume is disabled');
      return { resumed: false };
    }

    try {
      // 1. 查找最后一个会话
      console.log('[SessionManager] Calling list()...');
      const sessions = await this.list();
      console.log(`[SessionManager] Found ${sessions.length} sessions`);
      log.debug(`Found ${sessions.length} sessions`);

      const lastSession = sessions
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];

      if (!lastSession) {
        console.log('[SessionManager] No previous session found');
        log.debug('No previous session found for auto-resume');
        return { resumed: false };
      }

      console.log(`[SessionManager] Last session: ${lastSession.id}, name: ${lastSession.name}`);
      log.debug(`Last session: ${lastSession.id}, name: ${lastSession.name}`);

      // 2. 恢复会话上下文
      console.log('[SessionManager] Calling resume()...');
      const context = await this.resume(lastSession.id);

      // 3. 检索相关记忆
      let memories: MemoryEntry[] = [];
      if (this.memoryManager) {
        try {
          memories = await this.memoryManager.retrieve(
            context.summary || '',
            { maxResults: this.sessionConfig.memoryRetrievalCount }
          );
        } catch (err) {
          log.warn('Failed to retrieve memories during auto-resume:', err);
        }
      }

      log.info(`Auto-resumed session ${context.sessionId}, retrieved ${memories.length} memories`);

      return {
        resumed: true,
        sessionId: context.sessionId,
        summary: context.summary,
        memories,
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
   * 2. 提取记忆（调用 MemoryManager.save）
   * 3. 保存到长期记忆
   * 4. 保留最近 N 条消息
   * 5. 更新归档状态
   *
   * @param messages - 当前完整消息历史
   * @param currentMessageIndex - 当前消息索引
   * @returns 归档结果
   */
  async archive(
    messages: Message[],
    currentMessageIndex: number
  ): Promise<{
    archivedCount: number;
    memoriesExtracted: number;
    summary?: string;
    keyPoints?: string[];
  }> {
    if (!this.sessionConfig) {
      throw new Error('Session config not initialized');
    }

    const { archiveStrategy } = this.sessionConfig;
    const now = Date.now();

    // 1. 确定归档范围（从上次归档到当前，保留最近的）
    const archiveEndIndex = currentMessageIndex - archiveStrategy.keepRecentMessages;
    const archiveMessages = messages.slice(
      this.lastArchiveMessageIndex,
      archiveEndIndex
    );

    if (archiveMessages.length === 0) {
      log.debug('No messages to archive (archive range is empty)');
      return { archivedCount: 0, memoriesExtracted: 0 };
    }

    // 2. 生成会话摘要
    let summary: string | undefined;
    let keyPoints: string[] | undefined;

    if (archiveStrategy.generateSummary && this.summarizer) {
      try {
        const summaryResult = await this.summarizer.summarize(archiveMessages);
        summary = summaryResult.summary;
        keyPoints = summaryResult.keyPoints;
        log.debug(`Generated summary for ${archiveMessages.length} messages`);
      } catch (err) {
        log.warn('Failed to generate summary during archive:', err);
      }
    }

    // 3. 提取记忆（调用 MemoryManager）
    let memoriesExtracted = 0;
    if (this.memoryManager) {
      try {
        const sessionMemory: SessionMemory = {
          sessionId: this.activeSessionId ?? 'continuous',
          startTime: new Date(this.lastArchiveTime).toISOString(),
          endTime: new Date(now).toISOString(),
          userMessages: archiveMessages
            .filter(m => m.role === 'user')
            .map(m => typeof m.content === 'string' ? m.content : this.extractTextContent(m)),
          assistantHighlights: keyPoints || archiveMessages
            .filter(m => m.role === 'assistant')
            .slice(-5)
            .map(m => typeof m.content === 'string' ? m.content : this.extractTextContent(m))
            .map(text => text.slice(0, 200)), // 取前 200 字符作为亮点
          toolCalls: [],
          model: 'continuous',
        };

        // 保存到记忆系统（自动提取 + 持久化）
        await this.memoryManager.save(sessionMemory);

        // 查询提取的记忆数量（粗略估算）
        const recentMemories = await this.memoryManager.retrieve(
          summary || '',
          { maxResults: 5 }
        );
        memoriesExtracted = recentMemories.length;

        log.debug(`Extracted ${memoriesExtracted} memories from archived messages`);
      } catch (err) {
        log.warn('Failed to extract memories during archive:', err);
      }
    }

    // 4. 更新归档状态
    this.lastArchiveMessageIndex = archiveEndIndex;
    this.lastArchiveTime = now;

    log.info(
      `Archived ${archiveMessages.length} messages, ` +
      `extracted ${memoriesExtracted} memories, ` +
      `kept recent ${archiveStrategy.keepRecentMessages} messages`
    );

    return {
      archivedCount: archiveMessages.length,
      memoriesExtracted,
      summary,
      keyPoints,
    };
  }

  /**
   * 检索相关记忆（用于注入 system prompt）
   *
   * @param query - 查询内容（用户消息或会话摘要）
   * @returns 相关记忆条目
   */
  async retrieveMemories(query: string): Promise<MemoryEntry[]> {
    if (!this.sessionConfig || !this.memoryManager) {
      return [];
    }

    try {
      return await this.memoryManager.retrieve(query, {
        maxResults: this.sessionConfig.memoryRetrievalCount,
      });
    } catch (err) {
      log.warn('Failed to retrieve memories:', err);
      return [];
    }
  }
}
