// ============================================================
// M4 记忆系统 — 统一管理器
// ============================================================

import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import type {
  IMemoryStore,
  MemoryEntry,
  SessionMemory,
  RetrieveOptions,
  MemoryConfig,
} from './types';
import { DEFAULT_MEMORY_CONFIG } from './types';
import type { ILLMProvider, ProviderConfig } from '@/core/types';
import { StorageBackend } from './StorageBackend';
import { LongTermMemory } from './LongTermMemory';
import { ShortTermMemory } from './ShortTermMemory';
import { MemoryRetriever } from './MemoryRetriever';
import { MemoryCompactor } from './MemoryCompactor';
import { ProjectKnowledge } from './ProjectKnowledge';
import { HybridRetriever } from './HybridRetriever';
import type { SmartMemoryExtractor } from './SmartMemoryExtractor';
import type { EmbeddingService } from '@/embedding/EmbeddingService';
import type { VectorStore } from '@/embedding/VectorStore';
import type { EmbeddingMigrator } from './migration/EmbeddingMigrator';
import { logger } from '@/core/logger';
import type { HookRegistry } from '@/hooks/HookRegistry';

const log = logger.child({ module: 'memory-manager' });

/**
 * 记忆统一管理器
 *
 * 实现 IMemoryStore 接口，协调所有子模块：
 * - StorageBackend：JSONL 文件读写
 * - LongTermMemory：持久化管理
 * - ShortTermMemory：会话内缓存
 * - HybridRetriever：向量 + 关键词混合检索（向量可用时）
 * - MemoryRetriever：纯关键词检索（降级方案）
 * - MemoryCompactor：会话摘要/长期压缩
 * - ProjectKnowledge：项目知识库
 * - SmartMemoryExtractor：LLM 驱动的智能记忆提取（Phase 2）
 */
export class MemoryManager implements IMemoryStore {
  private config: MemoryConfig;
  private storage: StorageBackend;
  private longTerm: LongTermMemory;
  private shortTerm: ShortTermMemory | null = null;
  private retriever: MemoryRetriever;
  private hybridRetriever: HybridRetriever;
  private compactor: MemoryCompactor;
  private projectKnowledge: ProjectKnowledge | null = null;
  private smartExtractor: SmartMemoryExtractor | null = null;
  private embeddingService: EmbeddingService | null = null;
  private vectorStore: VectorStore | null = null;
  private migrator: EmbeddingMigrator | null = null;
  private vectorReady = false;
  private vectorReadyPromise: Promise<boolean> | null = null;
  private cachedEntries: MemoryEntry[] = [];
  private initialized = false;
  private saveCount = 0;
  private hookRegistry: HookRegistry | null = null;
  private _compacting = false;

  constructor(config?: Partial<MemoryConfig>, projectRoot?: string) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
    this.storage = new StorageBackend();
    const resolvedRoot = projectRoot ? resolve(projectRoot) : undefined;
    this.longTerm = new LongTermMemory(resolvedRoot, this.config, this.storage);
    this.retriever = new MemoryRetriever(this.config.decayHalfLifeDays);
    this.hybridRetriever = new HybridRetriever(this.config.decayHalfLifeDays);
    this.compactor = new MemoryCompactor(this.config);

    if (resolvedRoot) {
      this.projectKnowledge = new ProjectKnowledge(resolvedRoot, this.longTerm);
    }
  }

  /** 异步初始化（加载已有记忆到内存缓存） */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      this.cachedEntries = await this.longTerm.readAll(this.config.longTermMaxEntries);
      log.info(`Memory system initialized: ${this.cachedEntries.length} entries loaded`);
      this.initialized = true;

      // 异步初始化向量系统（不阻塞启动）
      this.vectorReadyPromise = this.initVectorSystem()
        .then(() => this.vectorReady)
        .catch((err) => {
          log.warn('Vector system initialization failed, using keyword fallback:', err);
          return false;
        });
    } catch (error) {
      log.warn('Failed to initialize memory system:', error);
      this.cachedEntries = [];
      this.initialized = true; // 即使失败也标记为已初始化，避免阻塞
    }
  }

  /** 保存会话记忆 */
  async save(session: SessionMemory): Promise<void> {
    if (!this.config.enabled) return;

    // 触发 PreMemorySave Hook
    if (this.hookRegistry) {
      const hookResult = await this.hookRegistry.emitSync('PreMemorySave', {
        memoryContent: session.userMessages?.join('\n').slice(0, 2000),
        sessionId: session.sessionId,
      }).catch(() => ({ blocked: false, results: [] }));
      if (hookResult.blocked) {
        log.info('Memory save blocked by PreMemorySave hook');
        return;
      }
    }

    try {
      let entries: MemoryEntry[] = [];

      // 优先使用 SmartMemoryExtractor (LLM 驱动的智能提取)
      if (this.smartExtractor) {
        try {
          entries = await this.smartExtractor.extractFromSession(session);
          log.debug(`SmartExtractor extracted ${entries.length} memories`);
        } catch (extractErr) {
          log.warn('SmartExtractor failed, falling back to compactor:', extractErr);
          entries = await this.compactor.compactSessionAsync(session);
        }
      } else {
        // 没有配置 SmartExtractor，使用 compactor（支持 LLM 增强）
        entries = await this.compactor.compactSessionAsync(session);
      }

      if (entries.length === 0) return;

      // 持久化
      await this.longTerm.saveBatch(entries);

      // 更新内存缓存
      this.cachedEntries.push(...entries);
      this.saveCount++;

      // 实时更新向量存储（不阻塞）
      if (this.migrator && this.vectorReady) {
        for (const entry of entries) {
          this.migrator.migrateOne(entry).catch((err) => {
            log.debug(`Failed to embed new memory ${entry.id}:`, err);
          });
        }
      }

      log.debug(`Saved ${entries.length} memory entries from session ${session.sessionId}`);

      // 触发 PostMemorySave Hook
      if (this.hookRegistry) {
        this.hookRegistry.emit('PostMemorySave', {
          sessionId: session.sessionId,
          data: { entriesCount: entries.length },
        }).catch(() => {});
      }

      // 检查是否需要触发压缩
      if (this.cachedEntries.length > this.config.compactionThreshold) {
        await this.compact();
      }
    } catch (error) {
      log.warn('Failed to save session memory:', error);
    }
  }

  /** 检索相关记忆 */
  async retrieve(query: string, options?: RetrieveOptions): Promise<MemoryEntry[]> {
    if (!this.config.enabled) return [];

    try {
      const maxResults = options?.maxResults ?? this.config.retrieveMaxResults;

      // 优先使用向量检索
      if (this.vectorReady && this.embeddingService && this.vectorStore) {
        try {
          const queryEmbedding = await this.embeddingService.embed(query);
          const candidates = this.vectorStore.searchSimilar(queryEmbedding, 50);
          const results = this.hybridRetriever.rerank(candidates, query, {
            ...options,
            maxResults,
          });

          // 异步更新访问计数
          this.updateAccessCountAsync(results);
          return results;
        } catch (err) {
          log.debug('Vector retrieval failed, falling back to keyword:', err);
        }
      }

      // 降级到关键词检索
      const scope = options?.scope ?? 'all';
      let memories: MemoryEntry[];
      if (scope === 'global') {
        memories = await this.longTerm.readGlobal();
      } else if (scope === 'project') {
        memories = await this.longTerm.readProject();
      } else {
        memories = this.cachedEntries.length > 0
          ? this.cachedEntries
          : await this.longTerm.readAll();
      }

      const results = await this.retriever.retrieveAsync(query, memories, {
        ...options,
        maxResults,
      });

      this.updateAccessCountAsync(results);
      return results;
    } catch (error) {
      log.warn('Failed to retrieve memories:', error);
      return [];
    }
  }

  /** 执行长期压缩（带互斥保护，防止并发丢数据） */
  async compact(): Promise<void> {
    if (this._compacting) {
      log.debug('compact() skipped: already in progress');
      return;
    }
    this._compacting = true;
    try {
      // 快照当前缓存（compact 期间新增的条目不会丢失）
      const snapshot = [...this.cachedEntries];
      const compacted = this.compactor.compactLongTerm(snapshot);

      // 分离全局和项目条目
      const globalEntries = compacted.filter((e) => !e.projectPath);
      const projectEntries = compacted.filter((e) => e.projectPath);

      // 覆盖写入
      await this.longTerm.replaceAll('global', globalEntries);
      if (projectEntries.length > 0) {
        await this.longTerm.replaceAll('project', projectEntries);
      }

      // 更新缓存：合并 compact 期间新增的条目
      const newEntries = this.cachedEntries.slice(snapshot.length);
      this.cachedEntries = [...compacted, ...newEntries];

      log.info(`Memory compacted: ${compacted.length} entries remaining (${newEntries.length} new during compact)`);
    } catch (error) {
      log.warn('Failed to compact memories:', error);
    } finally {
      this._compacting = false;
    }
  }

  /** 格式化记忆为 Markdown 片段（用于注入 system prompt） */
  formatForPrompt(entries: MemoryEntry[]): string {
    if (entries.length === 0) return '';

    const lines: string[] = ['### Relevant Past Context'];

    for (const entry of entries) {
      const typeLabel = this.getTypeLabel(entry.type);
      lines.push(`- **[${typeLabel}]** ${entry.content}`);
    }

    const result = lines.join('\n');

    // 截断到最大 prompt 长度
    if (result.length > this.config.maxPromptLength) {
      return result.slice(0, this.config.maxPromptLength) + '\n...(truncated)';
    }

    return result;
  }

  /** 重置短期记忆（新会话开始时） */
  resetShortTerm(sessionId: string, model: string): ShortTermMemory {
    this.shortTerm = new ShortTermMemory(sessionId, model, this.config);
    return this.shortTerm;
  }

  /** 获取短期记忆 */
  getShortTerm(): ShortTermMemory | null {
    return this.shortTerm;
  }

  /** 获取项目知识库 */
  getProjectKnowledge(): ProjectKnowledge | null {
    return this.projectKnowledge;
  }

  /** 获取缓存条目数量 */
  getCachedEntryCount(): number {
    return this.cachedEntries.length;
  }

  /** 检查是否已初始化 */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 设置智能记忆提取器 (Phase 2)
   * 由 ChatSession 在初始化时注入
   */
  setSmartExtractor(extractor: SmartMemoryExtractor): void {
    this.smartExtractor = extractor;
    log.info('SmartMemoryExtractor injected');
  }

  /** 注入 HookRegistry */
  setHookRegistry(hookRegistry: HookRegistry): void {
    this.hookRegistry = hookRegistry;
  }

  /**
   * 注入 LLM Provider（启用智能压缩）
   */
  setProvider(provider: ILLMProvider, config: ProviderConfig): void {
    this.compactor.setProvider(provider, config);
    log.info('LLM Provider injected into MemoryCompactor');
  }

  /**
   * 获取长期记忆存储（供 MemoryStoreTool 直接写入）
   */
  getLongTermMemory(): LongTermMemory {
    return this.longTerm;
  }

  /**
   * 获取记忆配置
   */
  getConfig(): MemoryConfig {
    return this.config;
  }

  // ────────── 私有方法 ──────────

  /** 初始化向量系统（异步，不阻塞主流程） */
  private async initVectorSystem(): Promise<void> {
    try {
      const { EmbeddingService } = await import('@/embedding/EmbeddingService');
      const { VectorStore } = await import('@/embedding/VectorStore');
      const { EmbeddingMigrator } = await import('./migration/EmbeddingMigrator');

      // 初始化 EmbeddingService
      this.embeddingService = EmbeddingService.getInstance();
      await this.embeddingService.init();

      // 初始化 VectorStore
      const dbPath = join(homedir(), '.xuanji', 'vector.db');
      this.vectorStore = new VectorStore(dbPath);
      await this.vectorStore.init();

      // 初始化 Migrator 并执行增量迁移
      this.migrator = new EmbeddingMigrator(
        this.embeddingService,
        this.vectorStore,
        this.longTerm,
      );

      const needsMigration = await this.migrator.needsMigration();
      if (needsMigration) {
        const result = await this.migrator.migrate();
        log.info(`Vector migration: ${result.migrated} migrated, ${result.skipped} skipped`);
      }

      this.vectorReady = true;
      log.info('Vector system ready');
    } catch (err) {
      log.warn('Embedding service unavailable, using keyword fallback:', err);
      this.vectorReady = false;
    }
  }

  /** 获取 EmbeddingService（供外部模块使用） */
  getEmbeddingService(): EmbeddingService | null {
    return this.embeddingService;
  }

  /** 获取 VectorStore（供外部模块使用） */
  getVectorStore(): VectorStore | null {
    return this.vectorStore;
  }

  /** 向量系统是否就绪 */
  isVectorReady(): boolean {
    return this.vectorReady;
  }

  /**
   * 等待向量系统就绪
   * 返回 true 表示就绪，false 表示初始化失败或未启动
   */
  async waitForVectorReady(): Promise<boolean> {
    if (this.vectorReady) return true;
    if (!this.vectorReadyPromise) return false;
    return this.vectorReadyPromise;
  }

  /** 手动触发向量迁移 */
  async migrateToVector(): Promise<{ migrated: number; total: number; skipped: number }> {
    if (!this.migrator) {
      throw new Error('Vector system not initialized');
    }
    return this.migrator.migrate();
  }

  /** 异步更新访问计数 */
  private updateAccessCountAsync(entries: MemoryEntry[]): void {
    const now = new Date().toISOString();
    for (const entry of entries) {
      entry.accessCount++;
      entry.lastAccessedAt = now;
    }
    // 注意：这里只更新了内存缓存中的计数
    // 持久化的更新会在下次 compact() 时一并写入
  }

  /** 获取类型标签 */
  private getTypeLabel(type: MemoryEntry['type']): string {
    const labels: Record<MemoryEntry['type'], string> = {
      session_summary: '会话',
      decision: '决策',
      tool_pattern: '工具模式',
      error_resolution: '错误解决',
      user_preference: '偏好',
      project_fact: '项目事实',
      // Phase 2 新增标签
      user_fact: '用户事实',
      relationship: '人际关系',
      important_date: '重要日期',
    };
    return labels[type] ?? type;
  }
}
