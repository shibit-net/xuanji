// ============================================================
// M4 记忆系统 — 统一管理器
// ============================================================

import { resolve } from 'node:path';
import type {
  IMemoryStore,
  MemoryEntry,
  SessionMemory,
  RetrieveOptions,
  MemoryConfig,
} from './types';
import { DEFAULT_MEMORY_CONFIG } from './types';
import { StorageBackend } from './StorageBackend';
import { LongTermMemory } from './LongTermMemory';
import { ShortTermMemory } from './ShortTermMemory';
import { MemoryRetriever } from './MemoryRetriever';
import { MemoryCompactor } from './MemoryCompactor';
import { ProjectKnowledge } from './ProjectKnowledge';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'memory-manager' });

/**
 * 记忆统一管理器
 *
 * 实现 IMemoryStore 接口，协调所有子模块：
 * - StorageBackend：JSONL 文件读写
 * - LongTermMemory：持久化管理
 * - ShortTermMemory：会话内缓存
 * - MemoryRetriever：关键词检索
 * - MemoryCompactor：会话摘要/长期压缩
 * - ProjectKnowledge：项目知识库
 */
export class MemoryManager implements IMemoryStore {
  private config: MemoryConfig;
  private storage: StorageBackend;
  private longTerm: LongTermMemory;
  private shortTerm: ShortTermMemory | null = null;
  private retriever: MemoryRetriever;
  private compactor: MemoryCompactor;
  private projectKnowledge: ProjectKnowledge | null = null;
  private cachedEntries: MemoryEntry[] = [];
  private initialized = false;
  private saveCount = 0;

  constructor(config?: Partial<MemoryConfig>, projectRoot?: string) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
    this.storage = new StorageBackend();
    const resolvedRoot = projectRoot ? resolve(projectRoot) : undefined;
    this.longTerm = new LongTermMemory(resolvedRoot, this.config, this.storage);
    this.retriever = new MemoryRetriever(this.config.decayHalfLifeDays);
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
    } catch (error) {
      log.warn('Failed to initialize memory system:', error);
      this.cachedEntries = [];
      this.initialized = true; // 即使失败也标记为已初始化，避免阻塞
    }
  }

  /** 保存会话记忆 */
  async save(session: SessionMemory): Promise<void> {
    if (!this.config.enabled) return;

    try {
      // 压缩会话为记忆条目
      const entries = this.compactor.compactSession(session);
      if (entries.length === 0) return;

      // 持久化
      await this.longTerm.saveBatch(entries);

      // 更新内存缓存
      this.cachedEntries.push(...entries);
      this.saveCount++;

      log.debug(`Saved ${entries.length} memory entries from session ${session.sessionId}`);

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
      const scope = options?.scope ?? 'all';

      let memories: MemoryEntry[];
      if (scope === 'global') {
        memories = await this.longTerm.readGlobal();
      } else if (scope === 'project') {
        memories = await this.longTerm.readProject();
      } else {
        // 优先使用缓存
        memories = this.cachedEntries.length > 0
          ? this.cachedEntries
          : await this.longTerm.readAll();
      }

      const results = this.retriever.retrieve(query, memories, {
        ...options,
        maxResults,
      });

      // 异步更新访问计数（不阻塞）
      this.updateAccessCountAsync(results);

      return results;
    } catch (error) {
      log.warn('Failed to retrieve memories:', error);
      return [];
    }
  }

  /** 执行长期压缩 */
  async compact(): Promise<void> {
    try {
      const compacted = this.compactor.compactLongTerm(this.cachedEntries);

      // 分离全局和项目条目
      const globalEntries = compacted.filter((e) => !e.projectPath);
      const projectEntries = compacted.filter((e) => e.projectPath);

      // 覆盖写入
      await this.longTerm.replaceAll('global', globalEntries);
      if (projectEntries.length > 0) {
        await this.longTerm.replaceAll('project', projectEntries);
      }

      // 更新缓存
      this.cachedEntries = compacted;

      log.info(`Memory compacted: ${compacted.length} entries remaining`);
    } catch (error) {
      log.warn('Failed to compact memories:', error);
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

  // ────────── 私有方法 ──────────

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
    };
    return labels[type] ?? type;
  }
}
