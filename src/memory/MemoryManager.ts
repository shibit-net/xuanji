// ============================================================
// MemoryManager — M5 分层记忆协调器
// ============================================================
// 实现 IMemoryStore 接口，协调：
//   MemoryStore (SQLite)
//   MemoryExtractor (规则降级提取，LLM 提取由 MemoryFlushAgent → SubAgent 负责)
//   MemoryRetriever (分层混合检索 + DecisionContext 构建)
//   MemoryWeightEngine (动态权重计算)
//   CoreRuleStore (核心规则独立存储)
//   MemoryFormatter (格式化注入文本)
// ============================================================

import { resolve } from 'node:path';
import type {
  IMemoryStore,
  MemoryEntry,
  SessionMemory,
  RetrieveOptions,
  MemoryConfig,
  DecisionContext,
} from './types';
import { DEFAULT_MEMORY_CONFIG } from './types';
import { MemoryStore } from './MemoryStore.js';
import { MemoryExtractor } from './MemoryExtractor.js';
import { MemoryRetriever } from './MemoryRetriever.js';
import { MemoryWeightEngine } from './MemoryWeightEngine.js';
import { CoreRuleStore } from './CoreRuleStore.js';
import { ShortTermMemory } from './ShortTermMemory.js';
import { MemoryFormatter } from './MemoryFormatter.js';
import { VectorManager } from './VectorManager.js';
import { logger } from '@/core/logger';
import type { HookRegistry } from '@/hooks/HookRegistry';

const log = logger.child({ module: 'MemoryManager' });

/**
 * MemoryManager — M5 分层记忆协调器
 *
 * 五层架构：
 *   CoreRuleStore   — 核心规则（永久，独立存储，始终注入）
 *   profile 层      — 用户画像（stable volatility）
 *   knowledge 层    — 经验教训 / 历史决策（normal volatility）
 *   episode 层      — 近期上下文（transient volatility）
 *   DecisionContext — 动态组装，辅助 LLM 判断
 */
export class MemoryManager implements IMemoryStore {
  private config: MemoryConfig;
  private _store: MemoryStore;
  private extractor: MemoryExtractor;
  private retriever: MemoryRetriever;
  private formatter: MemoryFormatter = new MemoryFormatter();
  private coreRuleStore: CoreRuleStore;
  private vectorManager: VectorManager;
  private shortTerm: ShortTermMemory | null = null;
  private hookRegistry: HookRegistry | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private _compacting = false;
  /** Promise 队列：确保并发 save() 不丢数据 */
  private _saveQueue: Promise<void> = Promise.resolve();

  /** 使 store 替换同时更新 retriever 引用（测试隔离用） */
  private get store(): MemoryStore { return this._store; }
  private set store(s: MemoryStore) {
    this._store = s;
    this.retriever = new MemoryRetriever(s, this.config.decayHalfLifeDays);
  }

  constructor(config?: Partial<MemoryConfig>, projectRoot?: string) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
    const resolvedRoot = projectRoot ? resolve(projectRoot) : undefined;

    this._store = new MemoryStore();
    this.extractor = new MemoryExtractor(this.config, resolvedRoot);
    this.retriever = new MemoryRetriever(this._store, this.config.decayHalfLifeDays);
    this.coreRuleStore = new CoreRuleStore();
    this.vectorManager = new VectorManager(this._store);
  }

  /** 初始化（建表、自动迁移、异步初始化向量系统） */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = this._doInit();
    }
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    try {
      await this.store.init();
      log.info(`MemoryManager initialized: ${this.store.getStats().total} entries`);
      this.initialized = true;

      // 异步初始化向量系统（不阻塞启动）
      this.vectorManager.init().catch((err) => {
        log.debug('VectorManager init failed:', err);
      });
    } catch (err) {
      log.warn('MemoryManager init failed:', err);
      this.initialized = true; // 避免阻塞
    }
  }

  /** 保存会话记忆（Promise 队列，并发调用自动排队） */
  async save(session: SessionMemory): Promise<void> {
    if (!this.config.enabled) return;

    this._saveQueue = this._saveQueue.then(
      () => this._saveInternal(session),
      () => this._saveInternal(session),
    );
    return this._saveQueue;
  }

  private async _saveInternal(session: SessionMemory): Promise<void> {
    // PreMemorySave Hook
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
      const result = await this.extractor.extractFromSession(session);

      // 路由核心规则到 CoreRuleStore（不进入 memory.db）
      if (result.coreRules && result.coreRules.length > 0) {
        for (const rule of result.coreRules) {
          this.coreRuleStore.add({
            rule: rule.rule,
            category: rule.category,
            description: rule.description,
            source: 'llm_extracted',
          });
        }
        log.info(`Extracted ${result.coreRules.length} core rules from session`);
      }

      const entries = result.entries ?? [];
      if (entries.length === 0) return;

      // 批量写入 SQLite（单一事务）
      this.store.saveBatch(entries);

      // 异步更新向量（不阻塞）
      this.vectorManager.embedEntries(entries).catch((err) => {
        log.debug('Failed to embed entries:', err);
      });

      log.debug(`Saved ${entries.length} entries from session ${session.sessionId}`);

      // PostMemorySave Hook
      if (this.hookRegistry) {
        this.hookRegistry.emit('PostMemorySave', {
          sessionId: session.sessionId,
          data: { entriesCount: entries.length },
        }).catch(() => {});
      }

      // 检查是否需要压缩
      const stats = this.store.getStats();
      if (stats.total > this.config.compactionThreshold) {
        this.compact().catch((err) => log.debug('Compact failed:', err));
      }
    } catch (err) {
      log.warn('Failed to save session memory:', err);
    }
  }

  /** 检索相关记忆 */
  async retrieve(query: string, options?: RetrieveOptions): Promise<MemoryEntry[]> {
    if (!this.config.enabled) return [];

    try {
      const results = await this.retriever.retrieve(query, {
        ...options,
        maxResults: options?.maxResults ?? this.config.retrieveMaxResults,
      });

      // 异步更新访问计数
      this.updateAccessCountAsync(results);
      return results;
    } catch (err) {
      log.warn('Failed to retrieve memories:', err);
      return [];
    }
  }

  /** 长期压缩（带互斥保护，使用 MemoryWeightEngine） */
  async compact(): Promise<void> {
    if (this._compacting) return;
    this._compacting = true;

    try {
      const all = this.store.readAll();

      // 批量更新权重字段（写回 entry.weight）
      MemoryWeightEngine.updateWeights(all);

      // 过滤低权重条目（profile / permanent / unfinished_task 不参与压缩）
      const kept = all.filter((entry) => !MemoryWeightEngine.shouldCompact(entry));

      // 截断到上限，按权重降序
      const sorted = kept
        .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
        .slice(0, this.config.longTermMaxEntries);

      this.store.replaceAll(sorted);
      log.info(`Memory compacted: ${all.length} → ${sorted.length} entries`);
    } catch (err) {
      log.warn('Compact failed:', err);
    } finally {
      this._compacting = false;
    }
  }

  /** 格式化记忆为 Markdown（注入 system prompt） */
  formatForPrompt(entries: MemoryEntry[]): string {
    if (entries.length === 0) return '';

    let result: string;
    try {
      result = this.formatter.formatForPrompt(entries) || this.fallbackFormat(entries);
    } catch (err) {
      log.debug('MemoryFormatter failed, using fallback:', err);
      result = this.fallbackFormat(entries);
    }

    return result.length > this.config.maxPromptLength
      ? result.slice(0, this.config.maxPromptLength) + '\n...(truncated)'
      : result;
  }

  /**
   * 构建决策上下文（每次对话前调用，辅助 LLM 判断）
   * 组装：activeRules + profileSummary + relevantLessons + relevantDecisions + pendingTasks
   */
  async buildDecisionContext(query: string): Promise<DecisionContext> {
    try {
      const activeRules = this.coreRuleStore.getActiveRules();
      return await this.retriever.buildDecisionContext(query, activeRules);
    } catch (err) {
      log.warn('Failed to build decision context:', err);
      return {
        activeRules: this.coreRuleStore.getActiveRules(),
        profileSummary: undefined,
        relevantLessons: [],
        relevantDecisions: [],
        pendingTasks: [],
      };
    }
  }

  /**
   * 格式化决策上下文为注入文本
   * 供 PromptOrchestrator 调用
   */
  async formatDecisionContext(query: string): Promise<string> {
    const ctx = await this.buildDecisionContext(query);
    const text = this.formatter.formatDecisionContext(ctx);
    if (!text) return '';
    return text.length > this.config.maxPromptLength
      ? text.slice(0, this.config.maxPromptLength) + '\n...(truncated)'
      : text;
  }

  private fallbackFormat(entries: MemoryEntry[]): string {
    const lines = ['### Relevant Past Context'];
    for (const entry of entries) {
      lines.push(`- **[${entry.type}]** ${entry.content}`);
    }
    return lines.join('\n');
  }

  /** 获取统计信息 */
  async getStats(): Promise<{ total: number; byType: Record<string, number> }> {
    return this.store.getStats();
  }

  /** 添加单条记忆条目（供 MemoryStoreTool 使用） */
  async add(entry: Partial<MemoryEntry>): Promise<void> {
    const now = new Date().toISOString();
    const complete: MemoryEntry = {
      id: entry.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type: entry.type || 'agent_knowledge',
      content: entry.content || '',
      keywords: entry.keywords || [],
      source: entry.source || 'manual',
      confidence: entry.confidence ?? 1.0,
      createdAt: entry.createdAt || now,
      lastAccessedAt: entry.lastAccessedAt || now,
      accessCount: entry.accessCount ?? 0,
      projectPath: entry.projectPath,
      metadata: entry.metadata,
      category: entry.category,
      topicId: entry.topicId,
      dayKey: entry.dayKey,
      sessionId: entry.sessionId,
      relatedMemories: entry.relatedMemories,
      extractedFrom: entry.extractedFrom,
      supersededBy: entry.supersededBy,
      lessonType: entry.lessonType,
      problemDescription: entry.problemDescription,
      solution: entry.solution,
      applicableScenarios: entry.applicableScenarios,
      // M5 新增字段
      scope: entry.scope,
      volatility: entry.volatility,
      categoryLabel: entry.categoryLabel,
      significance: entry.significance,
      weight: entry.weight,
      dismissed: entry.dismissed,
    };

    this.store.saveEntry(complete);
    this.vectorManager.embedEntries([complete]).catch((err) => {
      log.debug('Failed to embed entry:', err);
    });
  }

  // ────────── 配置注入 ──────────

  /** 注入 HookRegistry */
  setHookRegistry(hookRegistry: HookRegistry): void {
    this.hookRegistry = hookRegistry;
  }

  // ────────── 会话管理 ──────────

  /** 重置短期记忆（新会话开始时） */
  resetShortTerm(sessionId: string, model: string): ShortTermMemory {
    this.shortTerm = new ShortTermMemory(sessionId, model, this.config);
    return this.shortTerm;
  }

  /** 获取短期记忆 */
  getShortTerm(): ShortTermMemory | null {
    return this.shortTerm;
  }

  // ────────── 直接存储访问 ──────────

  /** 获取底层 MemoryStore（供 MemoryStoreTool 直接访问） */
  getStore(): MemoryStore {
    return this.store;
  }

  /** 获取 CoreRuleStore（供 SkillRouter 添加/管理核心规则） */
  getCoreRuleStore(): CoreRuleStore {
    return this.coreRuleStore;
  }

  /** 获取所有记忆条目（供 BootGuide 等场景使用） */
  getAllEntries(limit = 2000): MemoryEntry[] {
    return this.store.readAll({ limit });
  }

  /** 获取记忆配置 */
  getConfig(): MemoryConfig {
    return this.config;
  }

  /** 是否已初始化 */
  isInitialized(): boolean {
    return this.initialized;
  }

  /** 关闭资源 */
  async shutdown(): Promise<void> {
    await this._saveQueue;
    await this.vectorManager.shutdown();
    this.store.close();
    this.initialized = false;
    this.initPromise = null;
    log.debug('MemoryManager shutdown complete');
  }

  // ────────── 私有方法 ──────────

  /** 更新访问计数（同步写 DB，同时原地更新对象） */
  private updateAccessCountAsync(entries: MemoryEntry[]): void {
    const now = new Date().toISOString();
    for (const entry of entries) {
      entry.accessCount += 1;
      entry.lastAccessedAt = now;
      this.store.updateEntry(entry.id, {
        accessCount: entry.accessCount,
        lastAccessedAt: now,
      });
    }
  }
}
