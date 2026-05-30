/**
 * MemoryManager — 记忆系统核心类
 *
 * 职责：SQLite CRUD + FTS5 全文搜索 + 派生状态推演 + ArchiveDelegate
 * 设计文档：docs/memory-system-part-1-storage.md + docs/memory-system-part-3-integration.md
 */

import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import Database from 'better-sqlite3';
import type { ILLMProvider, AgentConfig } from '@/shared/types';
import { logger } from '@/core/logger';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';
import { MemoryGraph, type GraphNode, type SubgraphResult } from '@/core/memory/MemoryGraph';
import { EpisodicMemory } from '@/core/memory/EpisodicMemory';
import { TimelineInference } from '@/core/memory/TimelineInference';
import { TopicContinuity } from '@/core/memory/TopicContinuity';
import { PatternRecognizer } from '@/core/memory/PatternRecognizer';
import { ContextSignalCollector } from '@/core/memory/ContextSignalCollector';
import type {
  Entity, EntityInput, EntityFilter,
  Relation, RelationInput, RelationInputById, RelationQuery,
  RelationChange,
  Event, EventInput, TimelineFilter,
  Fact, FactInput, FactFilter,
  ProjectSnapshot,
  MemorySearchOptions, MemorySearchResult, MemorySearchResultWithGraph,
  GraphNeighbor, GraphPath,
  MemoryStats, MemorySnapshot, BuildContextOptions,
  UserProfile, UserProfileInput,
  TimeAnchor, TimeAnchorInput,
  TopicTracker, TopicTrackerInput,
  BehaviorPattern, BehaviorPatternInput,
} from '@/core/memory/types';

const log = logger.child({ module: 'MemoryManager' });

// ─── FTS5 安全转义 ─────────────────────────────────────────

/** CJK 字符之间插入空格，使 FTS5 unicode61 能将每个字作为独立 token */
function cjkSplit(text: string): string {
  return text.replace(/([\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff])/g, ' $1 ').replace(/\s+/g, ' ').trim();
}

/** 构建 FTS5 查询字符串：CJK 逐字分词后用 OR 连接，BM25 自动按匹配数排序 */
function buildFts5Query(input: string): string {
  const processed = cjkSplit(input);
  return processed
    .replace(/['"]/g, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => `${w}*`)
    .join(' OR ');
}

function formatSceneTag(tag?: string): string {
  if (!tag) return '';
  const trimmed = tag.replace(/^,|,$/g, '');
  return `,${trimmed},`;
}

function formatEntityIds(ids: string[]): string {
  return `,${ids.join(',')},`;
}

// ─── Ebbinghaus λ 推导（§3.3 四档衰减率）───────────────────

/** Ebbinghaus 遗忘衰减 λ 值 */
const EBBINGHAUS_LAMBDA = {
  LOCKED: 0.01,       // evidence >= 5 AND confidence > 0.8
  CORRECTION: 0.02,   // source = 'user_correction'
  DEFAULT: 0.05,      // 默认衰减率
  TEMPORARY: 0.1,     // confidence < 0.45 或首次 user_said
} as const;

/** Ebbinghaus 衰减阈值 */
const EBBINGHAUS_THRESHOLD = {
  HIGH_CONFIDENCE: 0.8,
  LOW_CONFIDENCE: 0.45,
  HIGH_EVIDENCE: 5,
  MIN_CONFIDENCE: 0.1,       // 低于此值不再衰减
  MIN_DAYS_FOR_DECAY: 1,     // 当日更新不衰减
  MIN_CHANGE: 0.01,          // 衰减幅度小于此值不更新 DB
} as const;

/** 计算日差 ms */
const DAY_MS = 86400000;

/** facts 专用：根据 source + evidence_count + confidence 推导 λ */
function deriveLambdaForFact(source: string, evidenceCount: number, confidence: number): number {
  if (source === 'user_correction') return EBBINGHAUS_LAMBDA.CORRECTION;
  if (evidenceCount >= EBBINGHAUS_THRESHOLD.HIGH_EVIDENCE && confidence > EBBINGHAUS_THRESHOLD.HIGH_CONFIDENCE) return EBBINGHAUS_LAMBDA.LOCKED;
  if (confidence < EBBINGHAUS_THRESHOLD.LOW_CONFIDENCE) return EBBINGHAUS_LAMBDA.TEMPORARY;
  return EBBINGHAUS_LAMBDA.DEFAULT;
}

/** entities/relations 专用：根据 evidence_count + confidence 推导 λ */
function deriveLambdaForEntity(evidenceCount: number, confidence: number): number {
  if (evidenceCount >= EBBINGHAUS_THRESHOLD.HIGH_EVIDENCE && confidence > EBBINGHAUS_THRESHOLD.HIGH_CONFIDENCE) return EBBINGHAUS_LAMBDA.LOCKED;
  if (confidence < EBBINGHAUS_THRESHOLD.LOW_CONFIDENCE) return EBBINGHAUS_LAMBDA.TEMPORARY;
  return EBBINGHAUS_LAMBDA.DEFAULT;
}

/** 从事件内容推断项目阶段（纯关键词，无 LLM） */
function detectProjectPhase(content: string): string | null {
  const patterns: Array<{ regex: RegExp; phase: string }> = [
    // 复合模式优先：需求分析完成 → 设计阶段
    { regex: /需求分析.*完成|确认了.*需求|需求.*确认|需求评审.*通过/, phase: '设计' },
    // 设计完成 → 开发阶段
    { regex: /设计.*完成|设计稿.*确认|方案.*通过/, phase: '开发' },
    // 开发完成 → 测试阶段
    { regex: /开发.*完成|编码.*完成|功能.*实现/, phase: '测试' },
    // 测试完成 → 部署阶段
    { regex: /测试.*通过|bug.*清零|联调.*完成/, phase: '部署' },
    // 简单模式
    { regex: /需求分析|需求评审/, phase: '需求' },
    { regex: /架构设计|UI设计|详细设计|设计稿/, phase: '设计' },
    { regex: /编码|功能开发|重构|实现/, phase: '开发' },
    { regex: /单元测试|集成测试|联调|修.*bug/, phase: '测试' },
    { regex: /部署|上线|发布|灰度/, phase: '部署' },
    { regex: /交付|验收|结项/, phase: '完成' },
  ];
  for (const { regex, phase } of patterns) {
    if (regex.test(content)) return phase;
  }
  return null;
}

// ─── MemoryManager ─────────────────────────────────────────

export class MemoryManager {
  private db!: Database.Database;
  private graph = new MemoryGraph();
  private initialized = false;
  private recentToolCalls: Array<{ toolName: string; sessionId?: string; time: number; dedupKey?: string }> = [];
  private userId: string = '';
  private userName: string = '';
  private userEntityId: string | null = null;
  private _creatingUserEntity = false;
  private lastActiveAt: number = 0;
  private _skipPassiveInjection = false;
  private recentMessages: any[] = [];

  // 可选依赖（通过 setter 注入或构造函数传入）
  public episodicMemory?: any;
  public semanticIndex?: any;
  public timelineInference!: TimelineInference;
  public topicContinuity!: TopicContinuity;
  public patternRecognizer!: PatternRecognizer;
  public signalCollector!: ContextSignalCollector;
  public subAgentStore?: any;
  public skillRegistry?: any;
  public toolRegistry?: any;
  public mcpManager?: any;
  public skillInstaller?: any;
  public mcpInstaller?: any;
  public tiangongMarket?: any;
  public searchService?: any;

  /** 记忆提取用的 system prompt（来自 memory-manager.yaml） */
  public memoryExtractionPrompt?: string;

  /** AgentFactory 引用 — 用于创建 memory-manager AgentLoop */
  public agentFactory?: import('@/core/agent/factory/AgentFactory').AgentFactory;

  /** 父 agent 的 ILLMProvider（供 memory-manager/compressor 共享 API 凭证） */
  public parentProvider?: ILLMProvider;

  /** 父 agent 的 runtime config（供 memory-manager/compressor 继承 apiKey/baseURL） */
  public parentConfig?: AgentConfig;

  /** 分层 Prompt 构建器引用，用于为 memory-manager 注入 L0 基础组件 + 加载 scene prompt */
  public layeredPromptBuilder?: any;

  /** 是否正在执行记忆提取（竞态标记，供前端按钮感知自动执行） */
  public isExtracting = false;

  /** 是否正在执行上下文压缩（竞态标记，与 isExtracting 独立） */
  public isCompressing = false;

  /** 上一次压缩产生的摘要（滚动压缩用） */
  public lastCompressionSummary = '';

  /** 当前活跃会话 ID（由 SessionManager.save() 设置，用于 EpisodicMemory 关联） */
  public currentSessionId: string | null = null;

  constructor(
    private dbPath: string,
    private cheapLLM?: any,
    private hookRegistry?: any,
  ) {}

  /** 设置当前用户 ID，用于知识图谱的"我"锚定 */
  setUserId(userId: string): void {
    this.userId = userId;
  }

  /** 设置用户的人类可读名称（如 "Kevin"），将用户实体从数字 ID 重命名为可读名称 */
  async setUserName(name: string): Promise<void> {
    if (!name || name === this.userName) return;
    this.userName = name;

    // 找到旧的数字 ID 用户实体，重命名为人类可读名称
    const oldEntity = this.db.prepare(
      "SELECT id FROM entities WHERE name = ? AND type = 'user'"
    ).get(this.userId) as { id: string } | undefined;

    if (oldEntity) {
      // 如果已存在同名的其他 user 实体，合并关系后删除
      const duplicate = this.db.prepare(
        "SELECT id FROM entities WHERE name = ? AND type = 'user' AND id != ?"
      ).get(name, oldEntity.id) as { id: string } | undefined;

      if (duplicate) {
        // 转移 duplicate 的所有关系（subject 和 object）
        this.db.prepare('UPDATE relations SET subject_id = ? WHERE subject_id = ?').run(oldEntity.id, duplicate.id);
        this.db.prepare('UPDATE relations SET object_id = ? WHERE object_id = ?').run(oldEntity.id, duplicate.id);
        this.db.prepare('DELETE FROM entities WHERE id = ?').run(duplicate.id);
        this.graph.removeNode(duplicate.id);
      }

      // 更新名称为人类可读名称
      this.db.prepare("UPDATE entities SET name = ?, summary = ? WHERE id = ?")
        .run(name, `用户 ${name}`, oldEntity.id);
      this.graphUpdateNode({ id: oldEntity.id, name, type: 'user', scene_tag: '', category: null, metadata: null });
      this.userEntityId = oldEntity.id;
      log.info(`User entity renamed: ${this.userId} → ${name}`);
    }
  }

  async init(): Promise<void> {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initDB();
    this.graph.loadFromDB(this.db);

    this.episodicMemory = new EpisodicMemory(this.db, this.semanticIndex, this.cheapLLM);
    this.episodicMemory.sessionIdProvider = () => this.currentSessionId;
    this.timelineInference = new TimelineInference(this.db);
    this.topicContinuity = new TopicContinuity(this.db, this.cheapLLM, this.semanticIndex);
    this.patternRecognizer = new PatternRecognizer(this.db);
    this.signalCollector = new ContextSignalCollector();

    // 生成默认会话 ID（后续由 SessionManager.save/resume 覆写）
    if (!this.currentSessionId) {
      this.currentSessionId = randomUUID();
    }

    // 加载 memory-manager 的 systemPrompt
    try {
      const { getConfigManager } = await import('@/core/config/ConfigManager');
      const cfgMgr = getConfigManager();
      const memCfg = cfgMgr.getAgentConfig('memory-manager');
      if (memCfg?.systemPrompt) {
        this.memoryExtractionPrompt = memCfg.systemPrompt as string;
      }
    } catch (err) {
      log.warn('加载 memory-manager 配置失败:', err);
    }

    this.initialized = true;
    log.info(`MemoryManager initialized: ${this.dbPath}`);
  }

  /** 每日维护任务（由 cron/scheduler 调用） */
  runDailyMaintenance(): void {
    if (!this.initialized) return;
    // 模式提取（纯算法）
    const patterns = this.patternRecognizer.extractPatterns();
    log.info(`Daily maintenance: extracted ${patterns.length} patterns`);

    // 话题自动清理
    this.topicContinuity.autoAbandonStaleTopics(0);

    // Ebbinghaus 遗忘衰减（每日执行，λ 分档控制在 >=24h 才生效）
    this.applyEbbinghausDecay();
  }

  /**
   * Ebbinghaus 遗忘衰减：对超过 24h 未更新的记录应用指数衰减
   *
   * λ 分档（§3.3）：
   *   临时(0.1) — confidence < 0.45 或 source='user_said' 且 evidence_count=1
   *   正常(0.05) — 默认
   *   锁定(0.01) — evidence_count >= 5 且 confidence > 0.8
   *   纠正(0.02) — source='user_correction'
   */
  private applyEbbinghausDecay(): void {
    const now = Date.now();

    const decayTable = (table: string, hasSource: boolean) => {
      const cols = hasSource
        ? 'id, confidence, evidence_count, source, updated_at'
        : 'id, confidence, evidence_count, updated_at';
      const rows = this.db.prepare(
        `SELECT ${cols} FROM ${table} WHERE confidence > ?`
      ).all(EBBINGHAUS_THRESHOLD.MIN_CONFIDENCE) as any[];

      const update = this.db.prepare(`UPDATE ${table} SET confidence = ? WHERE id = ?`);
      let decayedCount = 0;
      for (const row of rows) {
        const daysSinceUpdate = (now - row.updated_at) / DAY_MS;
        if (daysSinceUpdate < EBBINGHAUS_THRESHOLD.MIN_DAYS_FOR_DECAY) continue;

        const lambda = hasSource
          ? deriveLambdaForFact(row.source, row.evidence_count, row.confidence)
          : deriveLambdaForEntity(row.evidence_count, row.confidence);

        const newConfidence = row.confidence * Math.exp(-lambda * daysSinceUpdate);
        if (newConfidence < row.confidence - EBBINGHAUS_THRESHOLD.MIN_CHANGE) {
          update.run(Math.max(EBBINGHAUS_THRESHOLD.MIN_CONFIDENCE, newConfidence), row.id);
          decayedCount++;
        }
      }
      if (decayedCount > 0) {
        log.info(`Ebbinghaus decay: ${decayedCount} ${table} records decayed`);
      }
    };

    decayTable('entities', false);
    decayTable('facts', true);
    decayTable('relations', false);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.initialized = false;
    }
  }

  reset(): void {
    this.graph.clear();
    this.recentToolCalls = [];
  }

  // ─── DDL ─────────────────────────────────────────────────

  private initDB(): void {
    // 注册 CJK 分词 SQLite 函数（FTS5 触发器中使用）
    this.db.function('xuanji_fts_text', (text: string | null) => {
      if (!text) return '';
      return cjkSplit(text);
    });

    // schema_version 表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version     INTEGER PRIMARY KEY,
        applied_at  INTEGER NOT NULL
      );
    `);

    const currentVersion = (this.db.prepare(
      'SELECT COALESCE(MAX(version), 0) as v FROM schema_version'
    ).get() as { v: number }).v;

    if (currentVersion < 1) this.migrateV1();
    if (currentVersion < 2) this.migrateV2();
    if (currentVersion < 4) this.migrateV4();
    if (currentVersion < 5) this.migrateV5();
    if (currentVersion < 6) this.migrateV6();
    if (currentVersion < 7) this.migrateV7();
    if (currentVersion < 8) this.migrateV8();
    if (currentVersion < 9) this.migrateV9();
    if (currentVersion < 10) this.migrateV10();
    if (currentVersion < 11) this.migrateV11();
    if (currentVersion < 12) this.migrateV12();
    if (currentVersion < 13) this.migrateV13();

    this.ensureFtsTriggers();

    // 新表（V11）首次启动时 FTS5 触发器刚创建，将已有数据补入索引
    this.indexNewTablesIfNeeded();
  }

  private migrateV1(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        type        TEXT NOT NULL,
        summary     TEXT NOT NULL,
        belief      TEXT,
        scene_tag   TEXT NOT NULL DEFAULT '',
        owner       TEXT NOT NULL DEFAULT 'user',
        importance  INTEGER NOT NULL DEFAULT 3,
        ref_count   INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        UNIQUE(name, type)
      );

      CREATE TABLE IF NOT EXISTS relations (
        id          TEXT PRIMARY KEY,
        subject_id  TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        object_id   TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        relation    TEXT NOT NULL,
        desc        TEXT,
        strength    INTEGER NOT NULL DEFAULT 3,
        is_active   INTEGER NOT NULL DEFAULT 1,
        scene_tag   TEXT NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id          TEXT PRIMARY KEY,
        time        INTEGER NOT NULL,
        entity_ids  TEXT NOT NULL,
        content     TEXT NOT NULL,
        result      TEXT,
        importance  INTEGER NOT NULL DEFAULT 3,
        scene_tag   TEXT NOT NULL DEFAULT '',
        operator    TEXT,
        created_at  INTEGER NOT NULL,
        version     INTEGER NOT NULL DEFAULT 1,
        is_latest   INTEGER NOT NULL DEFAULT 1,
        previous_id TEXT
      );

      CREATE TABLE IF NOT EXISTS facts (
        id                  TEXT PRIMARY KEY,
        title               TEXT NOT NULL,
        content             TEXT NOT NULL,
        source              TEXT NOT NULL DEFAULT 'user_said',
        source_detail       TEXT,
        conflict_tag        INTEGER DEFAULT 0,
        version             INTEGER DEFAULT 1,
        is_latest           INTEGER DEFAULT 1,
        scene_tag           TEXT NOT NULL DEFAULT '',
        related_entity_ids  TEXT,
        creator             TEXT,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS relation_changes (
        id          TEXT PRIMARY KEY,
        subject_id  TEXT NOT NULL,
        relation    TEXT NOT NULL,
        old_value   TEXT,
        new_value   TEXT NOT NULL,
        reason      TEXT,
        scene_tag   TEXT NOT NULL DEFAULT '',
        changed_at  INTEGER NOT NULL,
        operator    TEXT
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        source_table, source_id, title, content, scene_tag,
        tokenize='unicode61'
      );

      -- 索引
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entities_scene ON entities(scene_tag);
      CREATE INDEX IF NOT EXISTS idx_entities_updated ON entities(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_entities_importance ON entities(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_relations_subject ON relations(subject_id);
      CREATE INDEX IF NOT EXISTS idx_relations_object ON relations(object_id);
      CREATE INDEX IF NOT EXISTS idx_relations_scene ON relations(scene_tag);
      CREATE INDEX IF NOT EXISTS idx_relations_relation ON relations(relation);
      CREATE INDEX IF NOT EXISTS idx_relations_active ON relations(subject_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_events_time ON events(time DESC);
      CREATE INDEX IF NOT EXISTS idx_events_scene ON events(scene_tag);
      CREATE INDEX IF NOT EXISTS idx_events_importance ON events(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_facts_latest ON facts(is_latest);
      CREATE INDEX IF NOT EXISTS idx_facts_scene ON facts(scene_tag);
      CREATE INDEX IF NOT EXISTS idx_facts_updated ON facts(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_facts_version ON facts(title, version);
      CREATE INDEX IF NOT EXISTS idx_relchanges_subject ON relation_changes(subject_id, relation, changed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_relchanges_time ON relation_changes(changed_at DESC);

    `);
    this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (1, ?)').run(Date.now());
  }

  private migrateV2(): void {
    // v2: 确保 relations.is_active 列存在（从旧版本升级时）
    const cols = this.db.prepare("PRAGMA table_info('relations')").all() as any[];
    if (!cols.find((c: any) => c.name === 'is_active')) {
      this.db.exec(`ALTER TABLE relations ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
    }
    this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (2, ?)').run(Date.now());
  }

  private migrateV4(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id           TEXT PRIMARY KEY,
        timestamp    INTEGER NOT NULL,
        title        TEXT NOT NULL,
        narrative    TEXT NOT NULL,
        scene_tag    TEXT NOT NULL DEFAULT '',
        importance   INTEGER NOT NULL DEFAULT 3,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS episode_entities (
        episode_id  TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        entity_id   TEXT NOT NULL REFERENCES entities(id),
        PRIMARY KEY (episode_id, entity_id)
      );

      CREATE INDEX IF NOT EXISTS idx_episodes_time ON episodes(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_episodes_scene ON episodes(scene_tag);
      CREATE INDEX IF NOT EXISTS idx_episodes_importance ON episodes(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_episode_entities_entity ON episode_entities(entity_id);
    `);
    this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (4, ?)').run(Date.now());
  }

  private migrateV5(): void {
    // v5: events 表新增 reminded_at 列 + 周年索引
    const cols = this.db.prepare("PRAGMA table_info('events')").all() as any[];
    if (!cols.find((c: any) => c.name === 'reminded_at')) {
      this.db.exec(`ALTER TABLE events ADD COLUMN reminded_at INTEGER`);
    }
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_md ON events(strftime('%m-%d', time / 1000, 'unixepoch'));
    `);
    this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (5, ?)').run(Date.now());
  }

  private migrateV6(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduler_log (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id        TEXT NOT NULL,
        scheduled_at  INTEGER NOT NULL,
        executed_at   INTEGER NOT NULL,
        status        TEXT DEFAULT 'ok'
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduler_log_dedup ON scheduler_log(job_id, scheduled_at);
    `);
    this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (6, ?)').run(Date.now());
  }

  private migrateV7(): void {
    // 清空 FTS5 索引并从源表重建（应用 CJK 分词）
    this.db.exec('DELETE FROM memory_fts');
    this.rebuildFtsIndex();
    this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (7, ?)').run(Date.now());
  }

  private migrateV8(): void {
    // 添加 category（层级分类）和 metadata（JSON 结构化属性）列
    const cols = (this.db.prepare("PRAGMA table_info('entities')").all() as any[]).map((c: any) => c.name);
    if (!cols.includes('category')) {
      this.db.exec('ALTER TABLE entities ADD COLUMN category TEXT');
    }
    if (!cols.includes('metadata')) {
      this.db.exec('ALTER TABLE entities ADD COLUMN metadata TEXT');
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_entities_category ON entities(category)');
    this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (8, ?)').run(Date.now());
    log.info('migrateV8: added category + metadata columns to entities');
  }

  private migrateV9(): void {
    const cols = (this.db.prepare("PRAGMA table_info('events')").all() as any[]).map((c: any) => c.name);
    if (!cols.includes('version')) {
      this.db.exec('ALTER TABLE events ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
    }
    if (!cols.includes('is_latest')) {
      this.db.exec('ALTER TABLE events ADD COLUMN is_latest INTEGER NOT NULL DEFAULT 1');
    }
    if (!cols.includes('previous_id')) {
      this.db.exec('ALTER TABLE events ADD COLUMN previous_id TEXT');
    }
    this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (9, ?)').run(Date.now());
    log.info('migrateV9: added version + is_latest + previous_id columns to events');
  }

  private migrateV10(): void {
    const cols = (this.db.prepare("PRAGMA table_info('facts')").all() as any[]).map((c: any) => c.name);
    if (!cols.includes('importance')) {
      this.db.exec('ALTER TABLE facts ADD COLUMN importance INTEGER NOT NULL DEFAULT 3');
    }
    if (!cols.includes('access_count')) {
      this.db.exec('ALTER TABLE facts ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0');
    }
    if (!cols.includes('last_accessed_at')) {
      this.db.exec('ALTER TABLE facts ADD COLUMN last_accessed_at INTEGER');
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_facts_access ON facts(last_accessed_at)');
    this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (10, ?)').run(Date.now());
    log.info('migrateV10: added importance + access_count + last_accessed_at to facts');
  }

  private migrateV11(): void {
    const runInTx = this.db.transaction(() => {
    // ─── 3.1 现有表扩展：置信度列 ──────────────────────────────
    const entityCols = (this.db.prepare("PRAGMA table_info('entities')").all() as any[]).map((c: any) => c.name);
    if (!entityCols.includes('confidence')) {
      this.db.exec('ALTER TABLE entities ADD COLUMN confidence REAL NOT NULL DEFAULT 0.6');
    }
    if (!entityCols.includes('evidence_count')) {
      this.db.exec('ALTER TABLE entities ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 1');
    }

    const factCols = (this.db.prepare("PRAGMA table_info('facts')").all() as any[]).map((c: any) => c.name);
    if (!factCols.includes('confidence')) {
      this.db.exec('ALTER TABLE facts ADD COLUMN confidence REAL NOT NULL DEFAULT 0.6');
    }
    if (!factCols.includes('evidence_count')) {
      this.db.exec('ALTER TABLE facts ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 1');
    }

    const relCols = (this.db.prepare("PRAGMA table_info('relations')").all() as any[]).map((c: any) => c.name);
    if (!relCols.includes('confidence')) {
      this.db.exec('ALTER TABLE relations ADD COLUMN confidence REAL NOT NULL DEFAULT 0.6');
    }
    if (!relCols.includes('evidence_count')) {
      this.db.exec('ALTER TABLE relations ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 1');
    }
    if (!relCols.includes('interaction_count')) {
      this.db.exec('ALTER TABLE relations ADD COLUMN interaction_count INTEGER NOT NULL DEFAULT 1');
    }
    if (!relCols.includes('last_interaction_at')) {
      this.db.exec('ALTER TABLE relations ADD COLUMN last_interaction_at INTEGER');
    }
    if (!relCols.includes('role_context')) {
      this.db.exec('ALTER TABLE relations ADD COLUMN role_context TEXT');
    }

    // 置信度索引
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_facts_confidence ON facts(confidence DESC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_relations_confidence ON relations(confidence DESC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_entities_confidence ON entities(confidence DESC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_relations_interaction ON relations(interaction_count DESC)');

    // ─── 3.2 新增表 ────────────────────────────────────────────

    // time_anchors
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS time_anchors (
        id              TEXT PRIMARY KEY,
        anchor_type     TEXT NOT NULL,
        target_type     TEXT NOT NULL,
        target_id       TEXT NOT NULL,
        trigger_time    INTEGER,
        cron_expr       TEXT,
        grace_minutes   INTEGER DEFAULT 0,
        last_triggered  INTEGER,
        is_active       INTEGER DEFAULT 1,
        reason          TEXT,
        conflict_group  TEXT,
        priority        INTEGER DEFAULT 3,
        metadata        TEXT,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      );
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_ta_trigger ON time_anchors(trigger_time, is_active)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_ta_target ON time_anchors(target_type, target_id)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_ta_group ON time_anchors(conflict_group)');

    // topic_tracker
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS topic_tracker (
        id                TEXT PRIMARY KEY,
        topic             TEXT NOT NULL,
        topic_type        TEXT NOT NULL DEFAULT 'goal',
        source_event_id   TEXT,
        status            TEXT NOT NULL DEFAULT 'open',
        priority          INTEGER DEFAULT 3,
        context_summary   TEXT,
        mention_count     INTEGER DEFAULT 1,
        last_mentioned_at INTEGER NOT NULL,
        last_followup_at  INTEGER,
        created_at        INTEGER NOT NULL
      );
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_tt_status ON topic_tracker(status, priority DESC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_tt_mentioned ON topic_tracker(last_mentioned_at DESC)');

    // user_profile
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_profile (
        id              TEXT PRIMARY KEY,
        dimension       TEXT NOT NULL,
        summary         TEXT NOT NULL,
        confidence      REAL NOT NULL DEFAULT 0.6,
        evidence_ids    TEXT,
        pending_count   INTEGER DEFAULT 0,
        last_updated_at INTEGER NOT NULL,
        created_at      INTEGER NOT NULL
      );
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_up_confidence ON user_profile(confidence DESC)');

    // behavior_patterns
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS behavior_patterns (
        id                  TEXT PRIMARY KEY,
        pattern_type        TEXT NOT NULL,
        description         TEXT NOT NULL,
        related_entity_ids  TEXT,
        confidence          REAL DEFAULT 0.5,
        sample_count        INTEGER DEFAULT 2,
        interval_hours      INTEGER,
        last_observed       INTEGER,
        next_expected       INTEGER,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL
      );
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_bp_expected ON behavior_patterns(next_expected)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_bp_type ON behavior_patterns(pattern_type)');

    // groups + group_members
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        type        TEXT NOT NULL DEFAULT 'social',
        summary     TEXT,
        scene_tag   TEXT NOT NULL DEFAULT '',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id    TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        entity_id   TEXT NOT NULL REFERENCES entities(id),
        role        TEXT,
        joined_at   INTEGER NOT NULL,
        PRIMARY KEY (group_id, entity_id)
      );
    `);
    // SQLite 不强制 FK，需 PRAGMA foreign_keys = ON（已在构造函数中设置）

    this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (11, ?)').run(Date.now());
    log.info('migrateV11: added confidence/evidence_count to entities/facts/relations + 5 new tables + indexes');
    });
    runInTx();
  }

  private migrateV12(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_snapshots (
        id            TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL,
        phase         TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT '进行中',
        progress_pct  INTEGER DEFAULT 0,
        current_focus TEXT,
        blockers      TEXT,
        next_milestone TEXT,
        tech_stack    TEXT,
        snapshot_at   INTEGER NOT NULL
      );
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_ps_project ON project_snapshots(project_id, snapshot_at DESC)');
    this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (12, ?)').run(Date.now());
    log.info('migrateV12: added project_snapshots table');
  }

  private migrateV13(): void {
    // Layer 0: session_events — 结构化工具调用/文件变更/错误日志
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_events (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL,
        timestamp     INTEGER NOT NULL,
        event_type    TEXT NOT NULL,
        tool_name     TEXT,
        tool_input    TEXT,
        tool_output   TEXT,
        file_path     TEXT,
        exit_code     INTEGER,
        error_msg     TEXT,
        duration_ms   INTEGER,
        agent_id      TEXT
      );
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_se_session ON session_events(session_id, timestamp)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_se_type ON session_events(event_type)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_se_tool ON session_events(tool_name)');

    // Layer 1: session_index — 会话元数据索引（摘要 + 关键点 + 统计）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_index (
        session_id    TEXT PRIMARY KEY,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        summary       TEXT,
        key_points    TEXT,
        token_usage   TEXT,
        tool_count    INTEGER DEFAULT 0,
        file_count    INTEGER DEFAULT 0,
        message_count INTEGER DEFAULT 0,
        project_dir   TEXT,
        tags          TEXT
      );
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_si_updated ON session_index(updated_at DESC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_si_project ON session_index(project_dir)');

    // Layer 2: episodes 新增 session_id 外键
    const episodeCols = this.db.prepare("PRAGMA table_info('episodes')").all() as any[];
    if (!episodeCols.find((c: any) => c.name === 'session_id')) {
      this.db.exec(`ALTER TABLE episodes ADD COLUMN session_id TEXT`);
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_ep_session ON episodes(session_id)');
    }

    this.db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (13, ?)').run(Date.now());
    log.info('migrateV13: added session_events, session_index tables + episodes.session_id');
  }

  // FTS5 表元数据：驱动触发器生成 + 索引重建
  private static readonly FTS_TABLES: Array<{
    table: string;
    titleExpr: string;   // SQL 表达式，如 "new.name" 或 "COALESCE(new.reason,'')"
    contentExpr: string;
    sceneExpr: string;   // SQL 表达式，如 "new.scene_tag" 或 "''"
  }> = [
    { table: 'entities',          titleExpr: 'new.name',              contentExpr: 'new.summary',                  sceneExpr: 'new.scene_tag' },
    { table: 'events',            titleExpr: 'new.content',           contentExpr: 'new.content',                  sceneExpr: 'new.scene_tag' },
    { table: 'facts',             titleExpr: 'new.title',             contentExpr: 'new.content',                  sceneExpr: 'new.scene_tag' },
    { table: 'episodes',          titleExpr: 'new.title',             contentExpr: 'new.narrative',                sceneExpr: 'new.scene_tag' },
    { table: 'time_anchors',      titleExpr: "COALESCE(new.reason,'')",     contentExpr: "COALESCE(new.reason,'')",      sceneExpr: "''" },
    { table: 'topic_tracker',     titleExpr: 'new.topic',             contentExpr: "COALESCE(new.context_summary,'')", sceneExpr: "''" },
    { table: 'user_profile',      titleExpr: 'new.dimension',         contentExpr: 'new.summary',                  sceneExpr: "''" },
    { table: 'behavior_patterns', titleExpr: 'new.description',       contentExpr: 'new.description',              sceneExpr: "''" },
    { table: 'groups',            titleExpr: 'new.name',              contentExpr: "COALESCE(new.summary,'')",     sceneExpr: "COALESCE(new.scene_tag,'')" },
  ];

  private ensureFtsTriggers(): void {
    for (const { table, titleExpr, contentExpr, sceneExpr } of MemoryManager.FTS_TABLES) {
      this.db.exec(`
        DROP TRIGGER IF EXISTS ${table}_fts_insert;
        DROP TRIGGER IF EXISTS ${table}_fts_delete;
        DROP TRIGGER IF EXISTS ${table}_fts_update;
      `);
      this.db.exec(`
        CREATE TRIGGER ${table}_fts_insert AFTER INSERT ON ${table} BEGIN
          INSERT INTO memory_fts(source_table, source_id, title, content, scene_tag)
          VALUES ('${table}', new.id, xuanji_fts_text(${titleExpr}), xuanji_fts_text(${contentExpr}), ${sceneExpr});
        END;
        CREATE TRIGGER ${table}_fts_delete AFTER DELETE ON ${table} BEGIN
          DELETE FROM memory_fts WHERE source_id = old.id AND source_table = '${table}';
        END;
        CREATE TRIGGER ${table}_fts_update AFTER UPDATE ON ${table} BEGIN
          DELETE FROM memory_fts WHERE source_id = old.id AND source_table = '${table}';
          INSERT INTO memory_fts(source_table, source_id, title, content, scene_tag)
          VALUES ('${table}', new.id, xuanji_fts_text(${titleExpr}), xuanji_fts_text(${contentExpr}), ${sceneExpr});
        END;
      `);
    }
  }

  /** 重建 FTS5 索引：从源表重新插入，应用 CJK 分词 */
  private rebuildFtsIndex(): void {
    log.info('Rebuilding FTS5 index with CJK tokenization...');
    const start = Date.now();

    // entities
    const entities = this.db.prepare('SELECT id, name, summary, scene_tag FROM entities').all() as any[];
    const insertFts = this.db.prepare(
      'INSERT INTO memory_fts(source_table, source_id, title, content, scene_tag) VALUES (?, ?, ?, ?, ?)'
    );
    for (const e of entities) {
      insertFts.run('entities', e.id, cjkSplit(e.name), cjkSplit(e.summary), e.scene_tag || '');
    }

    // events (only latest version)
    const events = this.db.prepare('SELECT id, content, scene_tag FROM events WHERE is_latest = 1').all() as any[];
    for (const ev of events) {
      insertFts.run('events', ev.id, cjkSplit(ev.content), cjkSplit(ev.content), ev.scene_tag || '');
    }

    // facts (only latest version, skip soft-deleted)
    const facts = this.db.prepare('SELECT id, title, content, scene_tag FROM facts WHERE is_latest = 1').all() as any[];
    for (const f of facts) {
      insertFts.run('facts', f.id, cjkSplit(f.title), cjkSplit(f.content), f.scene_tag || '');
    }

    // episodes
    const episodes = this.db.prepare('SELECT id, title, narrative, scene_tag FROM episodes').all() as any[];
    for (const ep of episodes) {
      insertFts.run('episodes', ep.id, cjkSplit(ep.title), cjkSplit(ep.narrative), ep.scene_tag || '');
    }

    // 新表（V11）尚不存在时跳过，使用 sqlite_master 检测
    const tableExists = (name: string) =>
      this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

    let anchorCount = 0, topicCount = 0, profileCount = 0, patternCount = 0, groupCount = 0;

    if (tableExists('time_anchors')) {
      const anchors = this.db.prepare('SELECT id, reason FROM time_anchors').all() as any[];
      for (const a of anchors) {
        insertFts.run('time_anchors', a.id, cjkSplit(a.reason || ''), cjkSplit(a.reason || ''), '');
      }
      anchorCount = anchors.length;
    }

    if (tableExists('topic_tracker')) {
      const topics = this.db.prepare('SELECT id, topic, context_summary FROM topic_tracker').all() as any[];
      for (const t of topics) {
        insertFts.run('topic_tracker', t.id, cjkSplit(t.topic), cjkSplit(t.context_summary || ''), '');
      }
      topicCount = topics.length;
    }

    if (tableExists('user_profile')) {
      const profiles = this.db.prepare('SELECT id, dimension, summary FROM user_profile').all() as any[];
      for (const p of profiles) {
        insertFts.run('user_profile', p.id, cjkSplit(p.dimension), cjkSplit(p.summary), '');
      }
      profileCount = profiles.length;
    }

    if (tableExists('behavior_patterns')) {
      const patterns = this.db.prepare('SELECT id, description FROM behavior_patterns').all() as any[];
      for (const bp of patterns) {
        insertFts.run('behavior_patterns', bp.id, cjkSplit(bp.description), cjkSplit(bp.description), '');
      }
      patternCount = patterns.length;
    }

    if (tableExists('groups')) {
      const groups = this.db.prepare('SELECT id, name, summary, scene_tag FROM groups').all() as any[];
      for (const g of groups) {
        insertFts.run('groups', g.id, cjkSplit(g.name), cjkSplit(g.summary || ''), g.scene_tag || '');
      }
      groupCount = groups.length;
    }

    log.info(`FTS5 index rebuilt: ${entities.length}E + ${events.length}Ev + ${facts.length}F + ${episodes.length}Ep + ${anchorCount}A + ${topicCount}T + ${profileCount}P + ${patternCount}B + ${groupCount}G (${Date.now() - start}ms)`);
  }

  /** 将新表（V11）现有数据补入 FTS5 索引（仅在触发器创建后首次调用） */
  private indexNewTablesIfNeeded(): void {
    const insertFts = this.db.prepare(
      'INSERT INTO memory_fts(source_table, source_id, title, content, scene_tag) VALUES (?, ?, ?, ?, ?)'
    );
    const tableExists = (name: string) =>
      this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

    // 仅处理 FTS5 中尚未出现的新表数据
    const needsIndex = (table: string) =>
      this.db.prepare('SELECT 1 FROM memory_fts WHERE source_table = ? LIMIT 1').get(table) === undefined;

    if (tableExists('time_anchors') && needsIndex('time_anchors')) {
      const rows = this.db.prepare('SELECT id, reason FROM time_anchors').all() as any[];
      for (const r of rows) insertFts.run('time_anchors', r.id, cjkSplit(r.reason || ''), cjkSplit(r.reason || ''), '');
      if (rows.length > 0) log.info(`Indexed ${rows.length} time_anchors into FTS5`);
    }
    if (tableExists('topic_tracker') && needsIndex('topic_tracker')) {
      const rows = this.db.prepare('SELECT id, topic, context_summary FROM topic_tracker').all() as any[];
      for (const r of rows) insertFts.run('topic_tracker', r.id, cjkSplit(r.topic), cjkSplit(r.context_summary || ''), '');
      if (rows.length > 0) log.info(`Indexed ${rows.length} topic_tracker rows into FTS5`);
    }
    if (tableExists('user_profile') && needsIndex('user_profile')) {
      const rows = this.db.prepare('SELECT id, dimension, summary FROM user_profile').all() as any[];
      for (const r of rows) insertFts.run('user_profile', r.id, cjkSplit(r.dimension), cjkSplit(r.summary), '');
      if (rows.length > 0) log.info(`Indexed ${rows.length} user_profile rows into FTS5`);
    }
    if (tableExists('behavior_patterns') && needsIndex('behavior_patterns')) {
      const rows = this.db.prepare('SELECT id, description FROM behavior_patterns').all() as any[];
      for (const r of rows) insertFts.run('behavior_patterns', r.id, cjkSplit(r.description), cjkSplit(r.description), '');
      if (rows.length > 0) log.info(`Indexed ${rows.length} behavior_patterns into FTS5`);
    }
    if (tableExists('groups') && needsIndex('groups')) {
      const rows = this.db.prepare('SELECT id, name, summary, scene_tag FROM groups').all() as any[];
      for (const r of rows) insertFts.run('groups', r.id, cjkSplit(r.name), cjkSplit(r.summary || ''), r.scene_tag || '');
      if (rows.length > 0) log.info(`Indexed ${rows.length} groups into FTS5`);
    }
  }

  // ─── Entity CRUD ─────────────────────────────────────────

  async upsertEntity(input: EntityInput): Promise<Entity> {
    const now = Date.now();
    const id = randomUUID();
    const sceneTag = formatSceneTag(input.scene_tag);
    const metadataStr = input.metadata
      ? (typeof input.metadata === 'string' ? input.metadata : JSON.stringify(input.metadata))
      : null;

    // 用户实体统一：所有 type='user' 映射到唯一用户实体，而非按 name 创建多个
    if (input.type === 'user') {
      const canonicalId = await this.ensureUserEntity();
      if (canonicalId) {
        const canonical = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(canonicalId) as any;
        if (canonical && canonical.name !== input.name) {
          // 记录别名到 metadata
          let aliases: string[] = [];
          if (canonical.metadata) {
            try { const m = JSON.parse(canonical.metadata); aliases = m.aliases || []; } catch {}
          }
          if (!aliases.includes(input.name)) {
            aliases.push(input.name);
            const newMeta = JSON.stringify({ ...(canonical.metadata ? JSON.parse(canonical.metadata) : {}), aliases });
            this.db.prepare('UPDATE entities SET metadata = ? WHERE id = ?').run(newMeta, canonicalId);
          }
          // 合并 summary：新名字的描述追加到已有 summary
          const mergedSummary = canonical.summary
            ? `${canonical.summary}；别名 ${input.name}：${input.summary || ''}`
            : input.summary;
          this.db.prepare(`
            UPDATE entities SET summary = ?, belief = COALESCE(?, belief),
              importance = MAX(importance, ?), evidence_count = evidence_count + 1,
              confidence = MIN(1.0, confidence + ?), updated_at = ?
            WHERE id = ?
          `).run(
            mergedSummary, input.belief ?? null,
            input.importance ?? 3, MemoryManager.CONFIDENCE_INCREMENT_CHANGED,
            now, canonicalId
          );
        } else if (canonical) {
          // 同名 → 正常更新 summary 等字段
          const prev = canonical;
          const contentChanged = prev.summary !== input.summary || prev.belief !== (input.belief ?? null);
          const confIncr = contentChanged ? MemoryManager.CONFIDENCE_INCREMENT_CHANGED : MemoryManager.CONFIDENCE_INCREMENT_UNCHANGED;
          this.db.prepare(`
            UPDATE entities SET summary = ?, belief = ?, scene_tag = ?, importance = ?,
              category = ?, metadata = ?,
              evidence_count = evidence_count + ${contentChanged ? 1 : 0},
              confidence = MIN(1.0, confidence + ${confIncr}), updated_at = ?
            WHERE id = ?
          `).run(
            input.summary, input.belief ?? null, sceneTag,
            input.importance ?? 3, input.category ?? null, metadataStr, now, canonicalId
          );
        }
        const entity = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(canonicalId) as any;
        this.graphUpdateNode(entity);
        this.semanticIndex?.index(entity.id, 'entities', `${entity.name} ${entity.summary}`).catch((err: any) => log.warn('Semantic index failed:', err));
        return this.rowToEntity(entity);
      }
    }

    const existing = this.db.prepare(
      'SELECT id FROM entities WHERE name = ? AND type = ?'
    ).get(input.name, input.type) as { id: string } | undefined;

    if (existing) {
      // 仅当 summary/content 实际变化时才增加 evidence（防止相同内容重复 upsert 导致证据膨胀）
      const prev = this.db.prepare('SELECT summary, belief FROM entities WHERE id = ?').get(existing.id) as any;
      const contentChanged = !prev || prev.summary !== input.summary || prev.belief !== (input.belief ?? null);
      const confIncr = contentChanged ? MemoryManager.CONFIDENCE_INCREMENT_CHANGED : MemoryManager.CONFIDENCE_INCREMENT_UNCHANGED;
      this.db.prepare(`
        UPDATE entities SET summary = ?, belief = ?, scene_tag = ?, importance = ?,
          category = ?, metadata = ?,
          evidence_count = evidence_count + ${contentChanged ? 1 : 0},
          confidence = MIN(1.0, confidence + ${confIncr}), updated_at = ?
        WHERE id = ?
      `).run(
        input.summary, input.belief ?? null, sceneTag,
        input.importance ?? 3, input.category ?? null, metadataStr, now, existing.id
      );
      const entity = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(existing.id) as any;
      this.graphUpdateNode(entity);
      this.semanticIndex?.index(entity.id, 'entities', `${entity.name} ${entity.summary}`).catch((err: any) => log.warn('Semantic index failed:', err));
      return this.rowToEntity(entity);
    }

    this.db.prepare(`
      INSERT INTO entities (id, name, type, summary, belief, scene_tag, owner, importance,
        category, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.name, input.type, input.summary, input.belief ?? null,
      sceneTag, input.owner ?? 'user', input.importance ?? 3,
      input.category ?? null, metadataStr, now, now
    );

    const entity = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as any;
    this.graph.addNode({
      id: entity.id, name: entity.name, type: entity.type, scene_tag: entity.scene_tag,
      category: entity.category ?? null, metadata: entity.metadata ?? null,
    });

    // 自愈：如果创建了 human-readable 名称的 user 实体，而根用户实体还是数字 ID，自动合并
    const isHumanUserEntity = input.type === 'user' && this.userId && !this.userName
      && entity.name !== this.userId && /[^\d]/.test(entity.name);
    if (isHumanUserEntity) {
      await this.setUserName(entity.name);
      // setUserName 已删除此重复实体并重命名根实体，跳过后续锚定
    }

    // 语义索引
    this.semanticIndex?.index(entity.id, 'entities', `${entity.name} ${entity.summary}`).catch((err: any) => log.warn('Semantic index failed:', err));

    return this.rowToEntity(entity);
  }

  getEntity(id: string): Entity | null {
    const row = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as any;
    return row ? this.rowToEntity(row) : null;
  }

  searchEntities(filter: EntityFilter = {}): Entity[] {
    let sql = 'SELECT * FROM entities WHERE 1=1';
    const params: any[] = [];

    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      sql += ` AND type IN (${types.map(() => '?').join(',')})`;
      params.push(...types);
    }
    if (filter.scene) {
      sql += ` AND scene_tag LIKE ?`;
      params.push(`%,${filter.scene},%`);
    }
    if (filter.keyword) {
      sql += ` AND (name LIKE ? OR summary LIKE ?)`;
      params.push(`%${filter.keyword}%`, `%${filter.keyword}%`);
    }
    sql += ' ORDER BY importance DESC, updated_at DESC';
    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r: any) => this.rowToEntity(r));
  }

  async deleteEntity(id: string): Promise<void> {
    this.db.prepare('DELETE FROM entities WHERE id = ?').run(id);
    this.graph.removeNode(id);
    // 从 FTS5 索引中移除
    try { this.db.prepare('DELETE FROM memory_fts WHERE source_table = ? AND source_id = ?').run('entities', id); } catch {}
  }

  /** 软删除 fact（标记 is_latest=0 并从 FTS5 索引中移除） */
  async deleteFact(id: string): Promise<void> {
    const now = Date.now();
    this.db.prepare('UPDATE facts SET is_latest = 0, updated_at = ? WHERE id = ?').run(now, id);
    // 从 FTS5 索引中移除，防止搜索仍返回已删除记录
    try { this.db.prepare('DELETE FROM memory_fts WHERE source_table = ? AND source_id = ?').run('facts', id); } catch {}
  }

  /** 按 ID 更新实体字段（供 memory_store 维护操作使用） */
  async updateEntityById(id: string, updates: { name?: string; summary?: string; importance?: number; metadata?: string }): Promise<void> {
    const sets: string[] = [];
    const params: any[] = [];
    if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
    if (updates.summary !== undefined) { sets.push('summary = ?'); params.push(updates.summary); }
    if (updates.importance !== undefined) { sets.push('importance = ?'); params.push(updates.importance); }
    if (updates.metadata !== undefined) { sets.push('metadata = ?'); params.push(updates.metadata); }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);
    this.db.prepare(`UPDATE entities SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    // 同步内存图
    const row = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as any;
    if (row) this.graphUpdateNode(row);
  }

  /**
   * 批量列举记录（供 memory_search scope=list_all 使用）。
   * 不走 FTS5/语义搜索，直接查询原始表，排除已删除/旧版本。
   */
  async listAll(sourceTable: string, options: { limit?: number; scene_tag?: string; minImportance?: number } = {}): Promise<any[]> {
    const { limit = 100, scene_tag, minImportance } = options;
    let sql = '';
    const params: any[] = [];

    switch (sourceTable) {
      case 'entities':
        sql = 'SELECT id, name, type, summary, importance, scene_tag FROM entities WHERE 1=1';
        if (minImportance) { sql += ' AND importance >= ?'; params.push(minImportance); }
        sql += ' ORDER BY importance DESC, updated_at DESC LIMIT ?';
        break;
      case 'facts':
        sql = 'SELECT id, title, content, importance, scene_tag, updated_at FROM facts WHERE is_latest = 1';
        if (minImportance) { sql += ' AND importance >= ?'; params.push(minImportance); }
        sql += ' ORDER BY importance DESC, updated_at DESC LIMIT ?';
        break;
      case 'events':
        sql = 'SELECT id, content, importance, scene_tag, time FROM events WHERE is_latest = 1';
        if (minImportance) { sql += ' AND importance >= ?'; params.push(minImportance); }
        sql += ' ORDER BY time DESC LIMIT ?';
        break;
      case 'episodes':
        sql = 'SELECT id, title, narrative, scene_tag, created_at FROM episodes WHERE 1=1';
        sql += ' ORDER BY created_at DESC LIMIT ?';
        break;
      default:
        return [];
    }
    params.push(limit);
    return this.db.prepare(sql).all(...params);
  }

  // ─── Relation CRUD ───────────────────────────────────────

  async relate(input: RelationInput): Promise<Relation> {
    const inputById = input as RelationInputById;
    let subjectId = inputById.subject_id;
    let objectId = inputById.object_id;

    if (!subjectId) {
      const s = await this.resolveEntity(input.subject_name);
      subjectId = s ? s.id : (await this.upsertEntity({
        name: input.subject_name, type: 'concept', summary: input.subject_name, scene_tag: input.scene_tag
      })).id;
    }
    if (!objectId) {
      const o = await this.resolveEntity(input.object_name);
      objectId = o ? o.id : (await this.upsertEntity({
        name: input.object_name, type: 'concept', summary: input.object_name, scene_tag: input.scene_tag
      })).id;
    }

    const now = Date.now();
    const id = randomUUID();
    const sceneTag = formatSceneTag(input.scene_tag);

    // 去重
    const dup = this.db.prepare(
      'SELECT id FROM relations WHERE subject_id = ? AND object_id = ? AND relation = ? AND is_active = 1'
    ).get(subjectId, objectId, input.relation) as { id: string } | undefined;

    if (dup) {
      // interaction_count 始终 +1（追踪引用频率），confidence 仅在 desc/strength 变化时显著增加
      const prevRel = this.db.prepare('SELECT desc, strength FROM relations WHERE id = ?').get(dup.id) as any;
      const relChanged = !prevRel || prevRel.desc !== (input.desc ?? null) || prevRel.strength !== (input.strength ?? 3);
      const relConfIncr = relChanged ? MemoryManager.CONFIDENCE_INCREMENT_CHANGED : MemoryManager.CONFIDENCE_INCREMENT_UNCHANGED;
      this.db.prepare(`
        UPDATE relations SET strength = ?, desc = ?, interaction_count = interaction_count + 1,
          last_interaction_at = ?,
          confidence = MIN(1.0, confidence + ${relConfIncr}), updated_at = ? WHERE id = ?
      `).run(input.strength ?? 3, input.desc ?? null, now, now, dup.id);
      return this.db.prepare('SELECT * FROM relations WHERE id = ?').get(dup.id) as any as Relation;
    }

    this.db.prepare(`
      INSERT INTO relations (id, subject_id, object_id, relation, desc, strength, scene_tag,
        confidence, evidence_count, interaction_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
    `).run(id, subjectId, objectId, input.relation, input.desc ?? null, input.strength ?? 3, sceneTag, MemoryManager.DEFAULT_CONFIDENCE, now, now);

    const rel = this.db.prepare('SELECT * FROM relations WHERE id = ?').get(id) as any;
    this.graph.addEdge({
      subjectId: rel.subject_id, relation: rel.relation,
      objectId: rel.object_id, strength: rel.strength,
    });
    return this.rowToRelation(rel);
  }

  /**
   * 转移关系：将 fromEntityId 所有关联的边（出/入）迁移到 toEntityId。
   * 用于实体合并时保留关系拓扑。
   */
  async transferRelations(fromEntityId: string, toEntityId: string): Promise<number> {
    let count = 0;
    const now = Date.now();

    // 去重检测：toEntity 是否已存在相同的 subject+relation+object
    const outEdges = this.db.prepare(
      'SELECT * FROM relations WHERE subject_id = ? AND is_active = 1'
    ).all(fromEntityId) as any[];
    for (const edge of outEdges) {
      const dup = this.db.prepare(
        'SELECT id FROM relations WHERE subject_id = ? AND object_id = ? AND relation = ? AND is_active = 1'
      ).get(toEntityId, edge.object_id, edge.relation);
      if (dup) {
        // toEntity 已有相同关系 → 删除旧边，避免重复
        this.db.prepare('UPDATE relations SET is_active = 0, updated_at = ? WHERE id = ?').run(now, edge.id);
      } else {
        this.db.prepare('UPDATE relations SET subject_id = ?, updated_at = ? WHERE id = ?').run(toEntityId, now, edge.id);
        this.graph.removeEdge(fromEntityId, edge.object_id, edge.relation);
        this.graph.addEdge({ subjectId: toEntityId, relation: edge.relation, objectId: edge.object_id, strength: edge.strength ?? 3 });
      }
      count++;
    }

    const inEdges = this.db.prepare(
      'SELECT * FROM relations WHERE object_id = ? AND is_active = 1'
    ).all(fromEntityId) as any[];
    for (const edge of inEdges) {
      const dup = this.db.prepare(
        'SELECT id FROM relations WHERE subject_id = ? AND object_id = ? AND relation = ? AND is_active = 1'
      ).get(edge.subject_id, toEntityId, edge.relation);
      if (dup) {
        this.db.prepare('UPDATE relations SET is_active = 0, updated_at = ? WHERE id = ?').run(now, edge.id);
      } else {
        this.db.prepare('UPDATE relations SET object_id = ?, updated_at = ? WHERE id = ?').run(toEntityId, now, edge.id);
        this.graph.removeEdge(edge.subject_id, fromEntityId, edge.relation);
        this.graph.addEdge({ subjectId: edge.subject_id, relation: edge.relation, objectId: toEntityId, strength: edge.strength ?? 3 });
      }
      count++;
    }

    return count;
  }

  async deactivateRelation(subjectId: string, objectId: string, relation: string, reason?: string): Promise<void> {
    const now = Date.now();
    const old = this.db.prepare(
      'SELECT * FROM relations WHERE subject_id = ? AND object_id = ? AND relation = ? AND is_active = 1'
    ).get(subjectId, objectId, relation) as any;

    if (!old) return;

    this.db.prepare('UPDATE relations SET is_active = 0, confidence = confidence * ?, updated_at = ? WHERE id = ?').run(MemoryManager.DEACTIVATE_CONFIDENCE_MULTIPLIER, now, old.id);

    // 记录变更（subject_id 存实体 ID，old_value 存对象名称方便可读）
    const objName = (this.db.prepare('SELECT name FROM entities WHERE id = ?').get(objectId) as any)?.name ?? objectId;
    const changeId = randomUUID();
    this.db.prepare(`
      INSERT INTO relation_changes (id, subject_id, relation, old_value, new_value, reason, changed_at, operator)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(changeId, subjectId, relation, objName, '', reason ?? null, now, 'agent');

    this.graph.removeEdge(subjectId, objectId, relation);
  }

  async getRelations(entityId: string, options: RelationQuery = {}): Promise<Relation[]> {
    const { direction = 'both', relation, activeOnly = true } = options;

    const conditions: string[] = [];
    const params: any[] = [];

    if (direction === 'outgoing') {
      conditions.push('r.subject_id = ?');
      params.push(entityId);
    } else if (direction === 'incoming') {
      conditions.push('r.object_id = ?');
      params.push(entityId);
    } else {
      conditions.push('(r.subject_id = ? OR r.object_id = ?)');
      params.push(entityId, entityId);
    }
    if (relation) {
      conditions.push('r.relation = ?');
      params.push(relation);
    }
    if (activeOnly) {
      conditions.push('r.is_active = 1');
    }

    const rows = this.db.prepare(
      `SELECT r.* FROM relations r WHERE ${conditions.join(' AND ')} ORDER BY r.strength DESC`
    ).all(...params) as any[];
    return rows.map((r: any) => this.rowToRelation(r));
  }

  async deleteRelation(id: string): Promise<void> {
    const rel = this.db.prepare('SELECT * FROM relations WHERE id = ?').get(id) as any;
    if (rel) {
      this.db.prepare('DELETE FROM relations WHERE id = ?').run(id);
      this.graph.removeEdge(rel.subject_id, rel.object_id, rel.relation);
    }
  }

  // ─── Event CRUD ──────────────────────────────────────────

  /** 语义去重阈值：新事件内容与旧事件的余弦相似度超过此值视为同一事件的修改 */
  private static readonly EVENT_DEDUP_THRESHOLD = 0.85;

  async recordEvent(input: EventInput): Promise<Event> {
    const now = Date.now();
    const sceneTag = formatSceneTag(input.scene_tag);

    // 按 entityNames 解析 entity_ids
    const entityIds: string[] = [];
    for (const ename of input.entityNames) {
      const e = await this.resolveEntity(ename);
      if (e) entityIds.push(e.id);
      else {
        const created = await this.upsertEntity({
          name: ename, type: 'concept', summary: ename, scene_tag: input.scene_tag
        });
        entityIds.push(created.id);
      }
    }
    const entityIdsStr = formatEntityIds(entityIds);

    // 语义去重：搜索与新事件内容最相似的已有事件，命中则直接返回已有事件（SSOT）
    if (this.semanticIndex) {
      try {
        const similar = await this.semanticIndex.search(input.content, 1, MemoryManager.EVENT_DEDUP_THRESHOLD);
        const matchedEvent = similar.find((r: { source_table: string }) => r.source_table === 'events');
        if (matchedEvent) {
          const existing = this.db.prepare(
            'SELECT * FROM events WHERE id = ? AND is_latest = 1'
          ).get(matchedEvent.id) as any as Event | undefined;
          if (existing) {
            log.debug('Event dedup: skipped duplicate, returned existing', { id: existing.id });
            return existing;
          }
        }
      } catch (err) {
        // 语义搜索失败不影响写入，跳过去重
      }
    }

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO events (id, time, entity_ids, content, result, importance, scene_tag, operator, version, is_latest, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
    `).run(
      id, input.time ?? now, entityIdsStr, input.content, input.result ?? null,
      input.importance ?? 3, sceneTag, input.operator ?? null, now
    );

    const fullEvent = this.db.prepare('SELECT * FROM events WHERE id = ?').get(id) as any as Event;

    this.semanticIndex?.index(fullEvent.id, 'events', fullEvent.content).catch((err: any) => log.warn('Semantic index failed:', err));

    return fullEvent;
  }

  async getTimeline(filter: TimelineFilter = {}): Promise<Event[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter.entityNames && filter.entityNames.length > 0) {
      const likeParts = filter.entityNames.map(() => {
        return `',' || entity_ids || ',' LIKE ?`;
      });
      conditions.push(`(${likeParts.join(' OR ')})`);
      for (const name of filter.entityNames) {
        // 先按名称找 entity id
        const e = this.db.prepare('SELECT id FROM entities WHERE name = ?').get(name) as any;
        params.push(`%,${e?.id ?? name},%`);
      }
    }
    if (filter.scene) {
      conditions.push('scene_tag LIKE ?');
      params.push(`%,${filter.scene},%`);
    }
    if (filter.from) {
      conditions.push('time >= ?');
      params.push(filter.from);
    }
    if (filter.to) {
      conditions.push('time <= ?');
      params.push(filter.to);
    }

    let sql = 'SELECT * FROM events';
    // 默认只返回最新版本
    conditions.push('is_latest = 1');
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY time DESC';
    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    return this.db.prepare(sql).all(...params) as any as Event[];
  }

  // ─── Fact CRUD ───────────────────────────────────────────

  async storeFact(input: FactInput): Promise<Fact> {
    const existing = this.db.prepare(
      'SELECT id, version FROM facts WHERE title = ? AND is_latest = 1'
    ).get(input.title) as { id: string; version: number } | undefined;

    const now = Date.now();
    const id = randomUUID();
    const sceneTag = formatSceneTag(input.scene_tag);

    // 解析 related entity IDs
    let relatedEntityIds: string | null = null;
    if (input.relatedEntityNames && input.relatedEntityNames.length > 0) {
      const ids: string[] = [];
      for (const name of input.relatedEntityNames) {
        const e = await this.resolveEntity(name);
        if (e) ids.push(e.id);
      }
      if (ids.length > 0) relatedEntityIds = formatEntityIds(ids);
    }

    if (existing) {
      const newVersion = existing.version + 1;
      this.db.prepare('UPDATE facts SET is_latest = 0, updated_at = ? WHERE title = ? AND is_latest = 1').run(now, input.title);

      this.db.prepare(`
        INSERT INTO facts (id, title, content, source, source_detail, version, is_latest, scene_tag,
          related_entity_ids, creator, importance, confidence, evidence_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(id, input.title, input.content, input.source ?? 'user_said', input.source_detail ?? null,
        newVersion, sceneTag, relatedEntityIds, input.creator ?? null, 3, MemoryManager.DEFAULT_CONFIDENCE, now, now);

      const fact = this.db.prepare('SELECT * FROM facts WHERE id = ?').get(id) as any as Fact;
      this.semanticIndex?.index(fact.id, 'facts', `${fact.title} ${fact.content}`).catch((err: any) => log.warn('Semantic index failed:', err));
      return fact;
    }

    this.db.prepare(`
      INSERT INTO facts (id, title, content, source, source_detail, version, is_latest, scene_tag,
        related_entity_ids, creator, importance, confidence, evidence_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, input.title, input.content, input.source ?? 'user_said', input.source_detail ?? null,
      sceneTag, relatedEntityIds, input.creator ?? null, 3, MemoryManager.DEFAULT_CONFIDENCE, now, now);

    const fact = this.db.prepare('SELECT * FROM facts WHERE id = ?').get(id) as any as Fact;
    this.semanticIndex?.index(fact.id, 'facts', `${fact.title} ${fact.content}`).catch((err: any) => log.warn('Semantic index failed:', err));
    return fact;
  }

  async updateFact(title: string, input: Partial<FactInput>): Promise<Fact> {
    return this.storeFact({
      title,
      content: input.content ?? '',
      source: input.source,
      scene_tag: input.scene_tag,
      relatedEntityNames: input.relatedEntityNames,
      source_detail: input.source_detail,
      creator: input.creator,
    });
  }

  async rollbackFact(title: string, version: number): Promise<Fact> {
    const now = Date.now();
    this.db.prepare('UPDATE facts SET is_latest = 0, confidence = confidence * ? WHERE title = ? AND is_latest = 1').run(MemoryManager.ROLLBACK_CONFIDENCE_MULTIPLIER, title);
    this.db.prepare('UPDATE facts SET is_latest = 1, updated_at = ? WHERE title = ? AND version = ?').run(now, title, version);
    return this.db.prepare('SELECT * FROM facts WHERE title = ? AND is_latest = 1').get(title) as any as Fact;
  }

  searchFacts(filter: FactFilter = {}): Fact[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter.keyword) {
      conditions.push('(title LIKE ? OR content LIKE ?)');
      params.push(`%${filter.keyword}%`, `%${filter.keyword}%`);
    }
    if (filter.scene) {
      conditions.push('scene_tag LIKE ?');
      params.push(`%,${filter.scene},%`);
    }
    if (filter.isLatest !== undefined) {
      conditions.push('is_latest = ?');
      params.push(filter.isLatest ? 1 : 0);
    }
    if (filter.name) {
      conditions.push('title = ?');
      params.push(filter.name);
    }
    if (filter.type) {
      conditions.push('source = ?');
      params.push(filter.type);
    }
    if (filter.tags && filter.tags.length > 0) {
      for (const tag of filter.tags) {
        conditions.push('scene_tag LIKE ?');
        params.push(`%,${tag},%`);
      }
    }

    let sql = 'SELECT * FROM facts';
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    return this.db.prepare(sql).all(...params) as any as Fact[];
  }

  // ─── UserProfile ────────────────────────────────────────────

  /** 自上次画像更新以来累积新证据计数器 +1 */
  bumpProfilePending(dimension: string): void {
    this.db.prepare(
      'UPDATE user_profile SET pending_count = pending_count + 1 WHERE dimension = ?'
    ).run(dimension);
  }

  /** 创建或刷新用户画像条目（LLM 生成摘要后调用，清零 pending_count） */
  upsertUserProfile(input: UserProfileInput): UserProfile {
    const now = Date.now();
    const existing = this.db.prepare(
      'SELECT id FROM user_profile WHERE dimension = ?'
    ).get(input.dimension) as { id: string } | undefined;

    if (existing) {
      this.db.prepare(`
        UPDATE user_profile SET summary = ?, evidence_ids = ?, pending_count = 0,
          confidence = ?, last_updated_at = ?
        WHERE id = ?
      `).run(input.summary, input.evidence_ids ?? null, input.confidence ?? MemoryManager.DEFAULT_CONFIDENCE, now, existing.id);
      return this.db.prepare('SELECT * FROM user_profile WHERE id = ?').get(existing.id) as any as UserProfile;
    }

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO user_profile (id, dimension, summary, evidence_ids, confidence, last_updated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.dimension, input.summary, input.evidence_ids ?? null, input.confidence ?? MemoryManager.DEFAULT_CONFIDENCE, now, now);
    return this.db.prepare('SELECT * FROM user_profile WHERE id = ?').get(id) as any as UserProfile;
  }

  // ─── TimeAnchor ──────────────────────────────────────────────

  addTimeAnchor(input: TimeAnchorInput): TimeAnchor {
    return this.timelineInference!.addAnchor(input);
  }

  // ─── TopicTracker ────────────────────────────────────────────

  upsertTopic(input: TopicTrackerInput): TopicTracker {
    return this.topicContinuity!.upsertTopic({
      topic: input.topic,
      topicType: input.topic_type ?? 'interest',
      priority: input.priority ?? 3,
      contextSummary: input.context_summary,
    });
  }

  // ─── ProjectSnapshot ──────────────────────────────────────────

  /** 手动存储项目进度快照（供 MemoryStoreTool 调用） */
  async saveProjectSnapshot(input: {
    project_id: string;
    phase: string;
    status?: string;
    progress_pct?: number;
    current_focus?: string | null;
    blockers?: string | null;
    next_milestone?: string | null;
    tech_stack?: string | null;
  }): Promise<ProjectSnapshot> {
    const { randomUUID } = await import('node:crypto');
    const now = Date.now();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO project_snapshots (id, project_id, phase, status, progress_pct, current_focus, blockers, next_milestone, tech_stack, snapshot_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.project_id,
      input.phase,
      input.status || '进行中',
      input.progress_pct ?? 0,
      input.current_focus || null,
      input.blockers || null,
      input.next_milestone || null,
      input.tech_stack || null,
      now,
    );
    log.info(`Project snapshot saved: ${input.project_id} → ${input.phase} (${input.progress_pct}%)`);
    return {
      id,
      project_id: input.project_id,
      phase: input.phase,
      status: input.status || '进行中',
      progress_pct: input.progress_pct ?? 0,
      current_focus: input.current_focus || null,
      blockers: input.blockers || null,
      next_milestone: input.next_milestone || null,
      tech_stack: input.tech_stack || null,
      snapshot_at: now,
    };
  }

  async findEntityByName(name: string): Promise<Entity | null> {
    return this.resolveEntity(name);
  }

  // ─── BehaviorPattern ─────────────────────────────────────────

  upsertBehaviorPattern(input: BehaviorPatternInput): BehaviorPattern {
    const now = Date.now();
    const existing = this.db.prepare(
      'SELECT id FROM behavior_patterns WHERE description = ?'
    ).get(input.description) as { id: string } | undefined;

    if (existing) {
      this.db.prepare(`
        UPDATE behavior_patterns SET sample_count = sample_count + 1, confidence = ?,
          interval_hours = ?, last_observed = ?, next_expected = ?, updated_at = ?
        WHERE id = ?
      `).run(input.confidence ?? MemoryManager.DEFAULT_CONFIDENCE, input.interval_hours ?? null, now, input.interval_hours ? now + input.interval_hours * 3600000 : null, now, existing.id);
      return this.db.prepare('SELECT * FROM behavior_patterns WHERE id = ?').get(existing.id) as any as BehaviorPattern;
    }

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO behavior_patterns (id, pattern_type, description, related_entity_ids,
        confidence, sample_count, interval_hours, last_observed, next_expected, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `).run(id, input.pattern_type, input.description, input.related_entity_ids ?? null,
      input.confidence ?? MemoryManager.DEFAULT_CONFIDENCE, input.interval_hours ?? null, now,
      input.interval_hours ? now + input.interval_hours * 3600000 : null, now, now);
    return this.db.prepare('SELECT * FROM behavior_patterns WHERE id = ?').get(id) as any as BehaviorPattern;
  }

  // ─── 置信度 & 证据常量 ───────────────────────────────────

  /** 新实体/事实/关系的默认置信度 */
  private static readonly DEFAULT_CONFIDENCE = 0.6;
  /** 内容变化时置信度增量 */
  private static readonly CONFIDENCE_INCREMENT_CHANGED = 0.05;
  /** 内容未变时置信度增量（仅更新引用计数） */
  private static readonly CONFIDENCE_INCREMENT_UNCHANGED = 0.01;
  /** 关系失效时置信度乘数 */
  private static readonly DEACTIVATE_CONFIDENCE_MULTIPLIER = 0.3;
  /** 事实回滚时置信度乘数 */
  private static readonly ROLLBACK_CONFIDENCE_MULTIPLIER = 0.5;

  // ─── 融合搜索（语义向量 + FTS5 加权） ──────────────────

  /** 语义/FTS5 融合权重，参照 OpenClaw 默认 7:3 */
  private static readonly VECTOR_WEIGHT = 0.7;
  private static readonly FTS5_WEIGHT = 0.3;
  /** FTS5 融合时保留 FTS5 内容的长度阈值（语义内容 < FTS5 * 阈值时替换） */
  private static readonly FTS5_CONTENT_LENGTH_THRESHOLD = 0.7;

  async search(options: MemorySearchOptions): Promise<MemorySearchResult[]> {
    const { query, source, scene_tag, scope, limit = 10, minImportance } = options;

    // 活跃上下文模式：不搜 query，而是搜用户的活跃计划/目标/约束
    if (scope === 'active_context') {
      return this.searchActiveContext({ source, scene_tag, limit, minImportance });
    }

    // 并行执行语义搜索 + FTS5
    const [semanticResults, ftsResults] = await Promise.all([
      this.runSemanticSearch(query, source, limit),
      this.runFts5Search(query, source, scene_tag, limit, minImportance),
    ]);

    // 合并 & 加权融合
    const fused = new Map<string, { r: MemorySearchResult; semanticScore: number; ftsScore: number }>();

    const normSemantic = this.normalizeScores(semanticResults.map(r => r.score ?? 0));
    for (let i = 0; i < semanticResults.length; i++) {
      const r = semanticResults[i];
      const key = `${r.source_table}:${r.source_id}`;
      fused.set(key, { r, semanticScore: normSemantic[i], ftsScore: 0 });
    }

    const normFts = this.normalizeScores(ftsResults.map(r => r.score ?? 0));
    for (let i = 0; i < ftsResults.length; i++) {
      const r = ftsResults[i];
      const key = `${r.source_table}:${r.source_id}`;
      const existing = fused.get(key);
      if (existing) {
        existing.ftsScore = normFts[i];
        // 仅当语义搜索内容明显被截断时才用 FTS5 补充（FTS5 content 含 CJK 分词空格，语义 lookback 已获取清洁内容）
        if (existing.r.content.length < r.content.length * MemoryManager.FTS5_CONTENT_LENGTH_THRESHOLD) {
          existing.r.content = r.content;
        }
        // 语义搜索新表 lookback 返回空 scene_tag，FTS5 可能有实际值
        if (!existing.r.scene_tag && r.scene_tag) {
          existing.r.scene_tag = r.scene_tag;
        }
      } else {
        fused.set(key, { r, semanticScore: 0, ftsScore: normFts[i] });
      }
    }

    // 计算最终得分
    const results: MemorySearchResult[] = [];
    for (const { r, semanticScore, ftsScore } of fused.values()) {
      const finalScore = semanticScore > 0 && ftsScore > 0
        ? MemoryManager.VECTOR_WEIGHT * semanticScore + MemoryManager.FTS5_WEIGHT * ftsScore  // 双命中：加权融合
        : semanticScore > 0
          ? MemoryManager.VECTOR_WEIGHT * semanticScore   // 仅语义命中
          : MemoryManager.FTS5_WEIGHT * ftsScore;         // 仅 FTS5 命中
      r.score = finalScore;
      results.push(r);
    }

    results.sort((a, b) => (b.score || 0) - (a.score || 0));

    // bump access count：被检索到的记忆强化"记忆痕迹"
    const returnedFactIds = results.filter(r => r.source_table === 'facts').map(r => r.source_id);
    this.bumpFactAccess(returnedFactIds);

    return results.slice(0, limit);
  }

  /**
   * Bump access count for retrieved facts — "用进废退" 的记忆强化机制。
   * 每次 fact 被检索并返回给 LLM 时，access_count +1，last_accessed_at 更新。
   */
  private bumpFactAccess(factIds: string[]): void {
    if (factIds.length === 0) return;
    const now = Date.now();
    const placeholders = factIds.map(() => '?').join(',');
    this.db.prepare(`
      UPDATE facts SET access_count = CASE WHEN access_count < 100 THEN access_count + 1 ELSE access_count END,
      last_accessed_at = ?
      WHERE id IN (${placeholders})
    `).run(now, ...factIds);
  }

  /** 衰减所有 fact 的 access_count，避免高频记忆永久垄断。每周维护任务调用。 */
  decayFactAccess(): void {
    this.db.prepare('UPDATE facts SET access_count = CAST(access_count * 0.5 AS INTEGER) WHERE access_count > 10').run();
  }

  /**
   * 活跃上下文搜索：用访问频率衰减评分替代硬时间窗口。
   * 公式: importance × (1+ln(1+access_count)) / (1+days_since_access/30)
   * 被检索到的记忆会自动 bump access_count。
   */
  private async searchActiveContext(options: {
    source?: string;
    scene_tag?: string;
    limit?: number;
    minImportance?: number;
  }): Promise<MemorySearchResult[]> {
    const { limit = 10 } = options;
    const now = Date.now();

    // 统一评分: importance × (1+ln(1+access_count)) / (1+days_since_access/30)
    // days_since_access: 从 last_accessed_at 计算（从未被访问则用 updated_at）
    const rows = this.db.prepare(`
      SELECT id, title, content, scene_tag, source_detail, importance, access_count,
             CASE WHEN last_accessed_at IS NOT NULL
               THEN (? - last_accessed_at) / 86400000.0
               ELSE (? - COALESCE(updated_at, created_at)) / 86400000.0
             END AS days_since_access
      FROM facts WHERE is_latest = 1
      ORDER BY importance * (1.0 + LN(1.0 + access_count)) / (1.0 + days_since_access / 30.0) DESC
      LIMIT ?
    `).all(now, now, limit) as any[];

    const results: MemorySearchResult[] = [];
    const factIds: string[] = [];
    for (const f of rows) {
      factIds.push(f.id);
      const daysSince = Math.max(0, f.days_since_access ?? 30);
      const score = (f.importance || 3) * (1 + Math.log(1 + (f.access_count || 0))) / (1 + daysSince / 30);
      results.push({
        source_table: 'facts',
        source_id: f.id,
        title: f.title,
        content: f.content,
        scene_tag: f.scene_tag || '',
        score,
      });
    }

    // 访问计数 +1：被检索到的记忆强化"记忆痕迹"（用进废退）
    this.bumpFactAccess(factIds);

    // 补充最近 48 小时事件（事件表不受访问频率衰减影响）
    const recentEvents = this.db.prepare(`
      SELECT id, content, scene_tag, importance, time
      FROM events WHERE time >= ? ORDER BY time DESC LIMIT 5
    `).all(now - 2 * 24 * 60 * 60 * 1000) as any[];
    for (const e of recentEvents) {
      results.push({
        source_table: 'events',
        source_id: e.id,
        title: e.content.slice(0, 80),
        content: e.content,
        scene_tag: e.scene_tag || '',
        score: 0.7,
      });
    }

    results.sort((a, b) => (b.score || 0) - (a.score || 0));
    return results.slice(0, limit);
  }

  /** 归一化分数到 [0, 1]，如果所有分数相同则返回全 1 */
  private normalizeScores(scores: number[]): number[] {
    if (scores.length === 0) return [];
    const max = Math.max(...scores);
    const min = Math.min(...scores);
    if (max === min) return scores.map(() => 1.0);
    return scores.map(s => (s - min) / (max - min));
  }

  private async runSemanticSearch(query: string, source: string | undefined, limit: number): Promise<MemorySearchResult[]> {
    if (!this.semanticIndex) return [];

    try {
      const raw = await this.semanticIndex.search(query, limit * 2);
      const filtered = raw.filter((sr: { sourceTable: string; sourceId: string; textSummary: string; score: number }) =>
        !source || source === 'all' || sr.sourceTable === source
      );

      // 回查源表获取完整内容（语义索引 textSummary 被截断到 200 字符）
      const tableMap: Record<string, { ids: string[]; titleField: string; contentField: string }> = {
        entities: { ids: [], titleField: 'name', contentField: 'summary' },
        facts: { ids: [], titleField: 'title', contentField: 'content' },
        events: { ids: [], titleField: 'content', contentField: 'content' },
        episodes: { ids: [], titleField: 'title', contentField: 'narrative' },
        time_anchors: { ids: [], titleField: 'reason', contentField: 'reason' },
        topic_tracker: { ids: [], titleField: 'topic', contentField: 'context_summary' },
        user_profile: { ids: [], titleField: 'dimension', contentField: 'summary' },
        behavior_patterns: { ids: [], titleField: 'description', contentField: 'description' },
        groups: { ids: [], titleField: 'name', contentField: 'summary' },
      };

      for (const sr of filtered) {
        if (tableMap[sr.sourceTable]) {
          tableMap[sr.sourceTable].ids.push(sr.sourceId);
        }
      }

      // 批量查询完整内容
      const contentMap = new Map<string, { title: string; content: string; scene_tag: string }>();
      // 新表（V11）没有 scene_tag 列，分开处理避免 SQL 错误
      const tablesWithoutSceneTag = new Set(['time_anchors', 'topic_tracker', 'user_profile', 'behavior_patterns']);
      for (const [table, { ids, titleField, contentField }] of Object.entries(tableMap)) {
        if (ids.length === 0) continue;
        const placeholders = ids.map(() => '?').join(',');
        const sceneCol = tablesWithoutSceneTag.has(table) ? `'' as scene_tag` : 'scene_tag';
        const rows = this.db.prepare(
          `SELECT id, ${titleField} as title, ${contentField} as content, ${sceneCol} FROM '${table}' WHERE id IN (${placeholders})`
        ).all(...ids) as any[];
        for (const row of rows) {
          contentMap.set(row.id, {
            title: (row.title || '').slice(0, 100),
            content: row.content || '',
            scene_tag: row.scene_tag || '',
          });
        }
      }

      return filtered.map((sr: { sourceTable: string; sourceId: string; textSummary: string; score: number }) => {
        const full = contentMap.get(sr.sourceId);
        return {
          source_table: sr.sourceTable,
          source_id: sr.sourceId,
          title: full?.title || sr.textSummary.slice(0, 100),
          content: full?.content || sr.textSummary,
          scene_tag: full?.scene_tag || '',
          score: sr.score,
        };
      });
    } catch (err) {
      log.warn('Semantic search failed:', err);
      return [];
    }
  }

  private runFts5Search(
    query: string,
    source: string | undefined,
    scene_tag: string | undefined,
    limit: number,
    minImportance: number | undefined,
  ): MemorySearchResult[] {
    const sanitized = buildFts5Query(query);
    if (!sanitized) return [];

    try {
      let sql = `SELECT source_table, source_id, title, content, scene_tag, rank FROM memory_fts WHERE memory_fts MATCH ?`;
      const params: any[] = [sanitized];

      if (source && source !== 'all') {
        sql += ' AND source_table = ?';
        params.push(source);
      }
      if (scene_tag) {
        sql += ' AND scene_tag LIKE ?';
        params.push(`%,${scene_tag},%`);
      }
      sql += ' ORDER BY rank LIMIT ?';
      params.push(limit * 2);

      let rows = this.db.prepare(sql).all(...params) as any[];

      if (minImportance && rows.length > 0) {
        rows = rows.filter((r: any) => {
          if (r.source_table === 'entities') {
            const e = this.db.prepare('SELECT importance FROM entities WHERE id = ?').get(r.source_id) as any;
            return e && e.importance >= minImportance;
          }
          if (r.source_table === 'events') {
            const e = this.db.prepare('SELECT importance FROM events WHERE id = ?').get(r.source_id) as any;
            return e && e.importance >= minImportance;
          }
          return true;
        });
      }

      return rows.map((r: any) => ({
        source_table: r.source_table,
        source_id: r.source_id,
        title: r.title,
        content: r.content,
        scene_tag: r.scene_tag || '',
        score: r.rank ? 1.0 / (1.0 + r.rank) : 0.5, // BM25 rank → 伪分数，后续归一化
      }));
    } catch (err) {
      log.warn('FTS5 search failed:', err);
      return [];
    }
  }

  // ─── 图感知搜索 ──────────────────────────────────────────

  /**
   * 搜索实体并附带图上下文（1-hop 邻居 + 关系方向）
   * 用于实现双向查询：搜"车"→ 返回所有车的 entity + 每辆车的拥有者
   */
  async searchEntitiesWithGraph(
    query: string,
    options: { limit?: number; scene_tag?: string; minImportance?: number } = {}
  ): Promise<MemorySearchResultWithGraph[]> {
    const results = await this.search({
      query,
      source: 'entity',
      scene_tag: options.scene_tag,
      limit: options.limit ?? 10,
      minImportance: options.minImportance,
    });

    const enriched: MemorySearchResultWithGraph[] = [];
    for (const r of results) {
      const entity = this.getEntity(r.source_id);
      if (!entity) {
        enriched.push(r);
        continue;
      }

      const neighbors = this.graph.getNeighbors(r.source_id);
      const graphNeighbors: GraphNeighbor[] = neighbors.map(n => ({
        entity: this.getEntity(n.node.id)!,
        relation: n.edge.relation,
        direction: n.edge.direction,
        strength: n.edge.strength,
      })).filter(n => n.entity !== null);

      let parsedMetadata: Record<string, unknown> | null = null;
      if (entity.metadata) {
        try { parsedMetadata = JSON.parse(entity.metadata); } catch { /* metadata 非有效 JSON，降级为 null */ }
      }

      enriched.push({
        ...r,
        neighbors: graphNeighbors.length > 0 ? graphNeighbors : undefined,
        parsedMetadata,
        category: entity.category || null,
      });
    }

    return enriched;
  }

  /** 按名称获取实体的直接邻居（出向 + 入向） */
  async getEntityNeighbors(name: string): Promise<GraphNeighbor[]> {
    const entity = await this.resolveEntity(name);
    if (!entity) return [];
    const neighbors = this.graph.getNeighbors(entity.id);
    return neighbors.map(n => ({
      entity: this.getEntity(n.node.id)!,
      relation: n.edge.relation,
      direction: n.edge.direction,
      strength: n.edge.strength,
    })).filter(n => n.entity !== null);
  }

  /** 按名称查找两实体间的路径 */
  async getEntityPaths(fromName: string, toName: string, maxHops: number = 4): Promise<GraphPath[]> {
    return this.findPaths(fromName, toName, maxHops);
  }

  /** 按名称获取子图 */
  getEntitySubgraph(centerName: string, maxHops: number = 2): SubgraphResult {
    return this.getSubgraph(centerName, maxHops);
  }

  /** 按名称模糊搜索图节点 */
  searchGraphNodes(query: string): GraphNode[] {
    return this.graph.searchNodes(query);
  }

  // ─── Prompt 注入 ──────────────────────────────────────────

  async buildContext(options: BuildContextOptions = {}): Promise<string | null> {
    if (!this.initialized) return null;
    const { scene, maxTokens = 800, recentHours = 24, messages: optMessages } = options;
    const parts: string[] = [];
    const now = Date.now();
    const messages = optMessages ?? this.recentMessages;

    // 每次调用重置剪枝标志，防止上次高 toolDensity 泄漏（Stage A 会重新设置）
    this._skipPassiveInjection = false;

    // Stage A: 上下文信号采集（纯统计，<1ms）
    if (messages && messages.length > 0) {
      const signals = this.signalCollector.collect(messages, this.lastActiveAt, scene ?? '');
      const signalLines: string[] = [];
      if (signals.idleHours > 24) {
        signalLines.push(`用户已离线 ${signals.idleHours.toFixed(1)} 小时`);
      }
      if (signals.toolDensity === 'high') {
        signalLines.push('当前工具调用密度高，减少主动行为');
      }
      if (signalLines.length > 0) {
        parts.push('## 上下文信号\n');
        for (const line of signalLines) {
          parts.push(`- ${line}`);
        }
        parts.push('');
      }
      // 高工具密度时跳过 Stage E/F（剪枝）
      this._skipPassiveInjection = signals.toolDensity === 'high';
    }

    // Stage D: 用户画像摘要（entities preference + user_profile 维度）
    const prefs = this.db.prepare(
      `SELECT name, summary, belief FROM entities WHERE type = 'preference' ORDER BY importance DESC LIMIT 5`
    ).all() as any[];
    const profiles = this.db.prepare(
      `SELECT dimension, summary FROM user_profile WHERE confidence >= 0.5 ORDER BY last_updated_at DESC LIMIT 8`
    ).all() as any[];
    if (prefs.length > 0 || profiles.length > 0) {
      parts.push('## 用户画像\n');
      for (const p of prefs) {
        parts.push(`- **${p.name}**: ${p.summary}${p.belief ? ` (核心信念: ${p.belief})` : ''}`);
      }
      for (const p of profiles) {
        // 避免与 entities preference 冗余
        const dup = prefs.some((ep: any) => ep.name === p.dimension || (ep.summary && ep.summary.includes(p.dimension)));
        if (!dup) {
          parts.push(`- [${p.dimension}] ${p.summary}`);
        }
      }
      parts.push('');
    }

    // Stage C: 时间锚点检查（不可跳过）
    const upcoming = this.timelineInference.checkUpcoming(24);
    if (upcoming.length > 0) {
      parts.push('## 即将到期的提醒\n');
      for (const r of upcoming) {
        const hoursLeft = Math.round(r.triggerIn / 3600000 * 10) / 10;
        parts.push(`- [${r.priority >= 4 ? '高优先' : '提醒'}] ${r.description} (${hoursLeft}小时后)`);
      }
      parts.push('');
    }

    // Stage E: 待跟进话题（高工具密度时跳过）
    if (!this._skipPassiveInjection) {
      const pendingTopics = this.topicContinuity.getPendingTopics(5);
      if (pendingTopics.length > 0) {
        parts.push('## 待跟进话题\n');
        for (const t of pendingTopics) {
          const statusLabel = t.status === 'followed_up' ? '已跟进' : '待跟进';
          const typeLabel = { goal: '目标', plan: '计划', interest: '兴趣', decision_pending: '待决策' }[t.topicType] || '话题';
          parts.push(`- [${statusLabel}][${typeLabel}] ${t.topic}${t.contextSummary ? ` — ${t.contextSummary.slice(0, 100)}` : ''}`);
        }
        parts.push('');
      }
    }

    // Stage F: 行为偏差检测（高工具密度时跳过）
    if (!this._skipPassiveInjection) {
      const missed = this.patternRecognizer.detectMissedBehaviors();
      if (missed.length > 0) {
        parts.push('## 行为偏差\n');
        for (const m of missed.slice(0, 3)) {
          parts.push(`- ${m.suggestion}`);
        }
        parts.push('');
      }
    }

    // Stage B: 场景相关记忆（语义搜索 + FTS5 RRF 融合）
    let sceneCondition = '';
    const sceneParams: any[] = [];
    if (scene) {
      sceneCondition = ' AND scene_tag LIKE ?';
      sceneParams.push(`%,${scene},%`);
    }

    const recentEntities = this.db.prepare(
      `SELECT name, type, summary FROM entities WHERE importance >= 3 ${sceneCondition} ORDER BY updated_at DESC LIMIT 10`
    ).all(...sceneParams) as any[];
    if (recentEntities.length > 0) {
      parts.push('## 相关实体\n');
      for (const e of recentEntities) {
        parts.push(`- [${e.type}] **${e.name}**: ${e.summary}`);
      }
      parts.push('');
    }

    const recentFacts = this.db.prepare(
      `SELECT id, title, content, source FROM facts WHERE is_latest = 1 ${sceneCondition} ORDER BY updated_at DESC LIMIT 5`
    ).all(...sceneParams) as any[];
    if (recentFacts.length > 0) {
      parts.push('## 已知事实\n');
      for (const f of recentFacts) {
        parts.push(`- **${f.title}**: ${f.content} (来源: ${f.source})`);
      }
      parts.push('');
      this.bumpFactAccess(recentFacts.map((f: any) => f.id));
    }

    const recentEvents = this.db.prepare(
      `SELECT content, result, time FROM events WHERE time > ? ${sceneCondition} ORDER BY time DESC LIMIT 5`
    ).all(now - recentHours * 3600000, ...sceneParams) as any[];
    if (recentEvents.length > 0) {
      parts.push('## 近期事件\n');
      for (const ev of recentEvents) {
        const timeStr = new Date(ev.time).toLocaleString('zh-CN');
        parts.push(`- [${timeStr}] ${ev.content}${ev.result ? ` → ${ev.result}` : ''}`);
      }
      parts.push('');
    }

    // 已知关系（top-10 活跃关系）
    const sceneRelCondition = scene ? ' AND r.scene_tag LIKE ?' : '';
    const sceneRelParams = scene ? [`%,${scene},%`] : [];
    const recentRelations = this.db.prepare(`
      SELECT r.subject_id, r.relation, r.object_id, r.strength,
             s.name AS subject_name, o.name AS object_name
      FROM relations r
      JOIN entities s ON s.id = r.subject_id
      JOIN entities o ON o.id = r.object_id
      WHERE r.is_active = 1 ${sceneRelCondition}
      ORDER BY r.strength DESC, r.updated_at DESC
      LIMIT 10
    `).all(...sceneRelParams) as any[];
    if (recentRelations.length > 0) {
      parts.push('## 已知关系\n');
      for (const rel of recentRelations) {
        parts.push(`- **${rel.subject_name}** → ${rel.relation} → **${rel.object_name}** (强度: ${rel.strength})`);
      }
      parts.push('');
    }

    // 活跃上下文：用户的最近计划/目标/约束/偏好（不依赖 scene_tag）
    const activeContext = await this.searchActiveContext({ limit: 5 });
    if (activeContext.length > 0) {
      parts.push('## 活跃上下文（用户的近期计划/目标/约束）\n');
      for (const r of activeContext) {
        const tag = r.source_table === 'facts' ? '目标/偏好' : r.source_table === 'events' ? '事件' : '其他';
        parts.push(`- [${tag}] **${r.title}**: ${r.content}`);
      }
      // 关联引导：提示 LLM 将活跃上下文与当前话题关联
      parts.push('');
      parts.push('> 注意：以上活跃上下文可能与当前话题存在隐性关联。如果用户当前讨论的内容与这些计划/目标/约束有关，请在回答中主动提及。');
      parts.push('');
    }

    if (parts.length === 0) return null;

    // 粗略 token 估计：中英文混合按字符数 / 1.5
    const text = parts.join('\n');
    if (text.length > maxTokens * 3) {
      return text.slice(0, maxTokens * 3) + '\n...';
    }
    return text;
  }

  // ─── Agent 事件处理 ──────────────────────────────────────

  async handleEventFromAgent(input: EventInput): Promise<Event> {
    const event = await this.recordEvent(input);
    const now = Date.now();

    // ── 项目状态推演：检测 project 类型实体的事件，创建快照 ──
    if (input.entityNames && input.entityNames.length > 0) {
      for (const ename of input.entityNames) {
        const entity = await this.resolveEntity(ename);
        if (!entity || entity.type !== 'project') continue;

        const phase = detectProjectPhase(input.content);
        if (phase) {
          const snapId = randomUUID();
          this.db.prepare(`
            INSERT INTO project_snapshots (id, project_id, phase, status, current_focus, snapshot_at)
            VALUES (?, ?, ?, '进行中', ?, ?)
          `).run(snapId, entity.id, phase, input.content.slice(0, 200), now);
        }
      }
    }

    // ── 偏好变更推演：检测 "改用/换成/切换" 模式 ──
    if (input.operator) {
      const changeMatch = input.content.match(/(?:改用|换成|切换到)\s*(.+)/);
      if (changeMatch) {
        const newValue = changeMatch[1].trim();
        const changeId = randomUUID();
        this.db.prepare(`
          INSERT INTO relation_changes (id, subject_id, relation, old_value, new_value, reason, changed_at, operator)
          VALUES (?, ?, 'preference', '', ?, ?, ?, ?)
        `).run(changeId, input.operator, newValue, '事件推演：偏好变更', now, input.operator);
      }
    }

    return event;
  }

  /**
   * 直接存储叙事记忆（供 memory_store({type:"episode"}) 调用）。
   * LLM 已生成 title + narrative，直接写入 episodes 表。
   */
  async storeEpisode(data: { title: string; narrative: string }): Promise<{ id: string }> {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO episodes (id, timestamp, title, narrative, scene_tag, importance, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', 3, ?, ?, ?)
    `).run(id, now, data.title, data.narrative, this.currentSessionId, now, now);

    // 索引到语义搜索
    if (this.semanticIndex) {
      try {
        await this.semanticIndex.indexEpisode(id, data.narrative);
      } catch (err: any) {
        log.warn('Failed to index episode:', err);
      }
    }

    return { id };
  }

  recordToolCall(toolName: string, sessionId?: string, dedupKey?: string): void {
    this.recentToolCalls.push({ toolName, sessionId, time: Date.now(), dedupKey });
    // 只保留最近 50 条
    if (this.recentToolCalls.length > 50) {
      this.recentToolCalls = this.recentToolCalls.slice(-50);
    }
  }

  /** 记录用户活跃时间（每次用户消息时调用） */
  recordActivity(): void {
    this.lastActiveAt = Date.now();
  }

  /** 缓存最近消息供 ContextSignalCollector 使用（每次对话轮次前由 ChatSession 调用） */
  setRecentMessages(messages: any[]): void {
    this.recentMessages = messages.slice(-20);
  }

  wasMemoryStoredRecently(dedupKey: string, windowMs: number = 300000): boolean {
    const cutoff = Date.now() - windowMs;
    return this.recentToolCalls.some(
      tc => tc.toolName === 'memory_store' && tc.dedupKey === dedupKey && tc.time > cutoff
    );
  }

  /** 检查指定时间窗口内是否有过任何 memory_store 调用（用于 PostToolUse 兜底检测） */
  wasAnyMemoryStoredRecently(windowMs: number = 60000): boolean {
    const cutoff = Date.now() - windowMs;
    return this.recentToolCalls.some(
      tc => tc.toolName === 'memory_store' && tc.time > cutoff
    );
  }

  // ─── 待处理提取持久化（进程退出保护）─────────────────────

  private get pendingExtractionPath(): string {
    const lastSep = Math.max(this.dbPath.lastIndexOf('/'), this.dbPath.lastIndexOf('\\'));
    const dir = lastSep >= 0 ? this.dbPath.slice(0, lastSep) : '.';
    return `${dir}/extraction_pending.json`;
  }

  /** 将待提取消息持久化到文件，防止进程退出丢失 */
  async savePendingExtraction(messages: any[]): Promise<void> {
    try {
      const { writeFile } = await import('node:fs/promises');
      // 保存更多消息便于崩溃恢复，内容截断放宽
      const compact = messages.slice(-50).map((m: any) => ({
        role: m.role || m.type || 'unknown',
        content: typeof m.content === 'string' ? m.content.slice(0, 2000) : JSON.stringify(m.content).slice(0, 2000),
      }));
      await writeFile(this.pendingExtractionPath, JSON.stringify(compact), 'utf-8');
    } catch {
      log.warn('savePendingExtraction: file write failed, memory extraction may be lost');
      // 写入失败不阻塞
    }
  }

  /** 清除待处理提取文件（提取成功后调用） */
  async clearPendingExtraction(): Promise<void> {
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(this.pendingExtractionPath);
    } catch {
      // 文件不存在或已清理 — 预期行为，无需告警
    }
  }

  /** 启动时处理遗留的待处理提取任务 */
  async processPendingExtractions(): Promise<void> {
    try {
      const { readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      if (!existsSync(this.pendingExtractionPath)) return;

      const content = await readFile(this.pendingExtractionPath, 'utf-8');
      const messages = JSON.parse(content);
      if (!Array.isArray(messages) || messages.length === 0) {
        await this.clearPendingExtraction();
        return;
      }

      log.info(`Processing pending extraction: ${messages.length} messages`);
      await this.extractFromSession(messages);
      await this.clearPendingExtraction();
    } catch {
      log.warn('processPendingExtractions: recovery failed, clearing stale file');
      // 文件损坏或处理失败，清理
      await this.clearPendingExtraction();
    }
  }

  // ─── ArchiveDelegate (上下文压缩回调) ─────────────────────

  async archiveMessages(messages: any[]): Promise<string> {
    if (messages.length === 0) return '';
    if (this.isCompressing) return ''; // 竞态：已有压缩在进行中

    const importantMessages = messages.filter((m: any) => {
      const role = m.role || m.type;
      return role === 'assistant' || role === 'user';
    });

    if (importantMessages.length === 0) return '';

    // 格式化消息文本
    const text = importantMessages
      .map((m: any) => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        const trimmed = (content || '').trim();
        if (!trimmed) return null;
        return `[${m.role || m.type}]: ${content}`;
      })
      .filter(Boolean)
      .join('\n')
      .slice(0, 6000);

    // 使用 memory-manager agent 的 memory-compression 场景
    if (this.agentFactory && this.parentProvider) {
      this.isCompressing = true;
      try {
        // 加载压缩场景 prompt
        const sceneContent = await this.loadSceneContent('memory-compression');
        const identity = this.memoryExtractionPrompt || '你是记忆管理专家。';
        const scenePrompt = sceneContent || '';

        const systemPrompt = [identity, scenePrompt].filter(Boolean).join('\n\n')
          .replace('{{EXISTING_MEMORIES}}', this.buildExistingMemoryContext() || '暂无已有记忆');

        // 滚动压缩：已有摘要拼在新消息前面
        const previousSummary = this.lastCompressionSummary
          ? `## 已有压缩摘要\n${this.lastCompressionSummary}\n\n---\n\n`
          : '';
        const userMessage = `${previousSummary}待压缩消息：\n\n${text}`;

        const response = await this.runMemoryAgent({
          systemPrompt,
          userMessage,
          taskType: 'memory-compression',
          taskName: '上下文压缩',
          timeout: 120000,
          returnResponse: true,
        });

        // 从响应中提取 ## 压缩摘要 部分
        if (response) {
          const summaryMatch = response.match(/##\s*压缩摘要\s*\n([\s\S]*?)(?=\n##\s|\n---\s|$)/);
          const summary = summaryMatch ? summaryMatch[1].trim() : response.slice(0, 500);
          if (summary) {
            this.lastCompressionSummary = summary;
          }
          return summary || '';
        }
      } catch (err) {
        log.warn('archiveMessages compression failed:', err);
      } finally {
        this.isCompressing = false;
      }
    }

    // 无 LLM 时直接记录为事件
    const summary = importantMessages.slice(0, 10).map((m: any) => {
      const content = typeof m.content === 'string' ? m.content.slice(0, 100) : '';
      return `[${m.role || m.type}]: ${content}`;
    }).join('; ');

    await this.recordEvent({
      entityNames: [],
      content: `会话压缩摘要: ${summary.slice(0, 500)}`,
      importance: 1,
      scene_tag: '',
      operator: 'archive',
    });

    await this.episodicMemory?.createFromMessages(importantMessages).catch((err: any) => {
      log.warn('archiveMessages episodic creation failed:', err);
    });

    return `之前对话摘要: ${summary.slice(0, 300)}`;
  }

  // ─── 图查询（委托给 MemoryGraph）──────────────────────────

  async findPaths(fromName: string, toName: string, maxHops: number = 4): Promise<any[]> {
    const fromEntities = this.db.prepare(
      'SELECT id FROM entities WHERE name = ?'
    ).all(fromName) as any[];
    const toEntities = this.db.prepare(
      'SELECT id FROM entities WHERE name = ?'
    ).all(toName) as any[];

    const results: any[] = [];
    for (const from of fromEntities) {
      for (const to of toEntities) {
        const paths = this.graph.findPaths(from.id, to.id, maxHops);
        results.push(...paths);
      }
    }
    return results;
  }

  getSubgraph(centerName: string, maxHops: number = 2): any {
    const center = this.db.prepare('SELECT id FROM entities WHERE name = ?').get(centerName) as any;
    if (!center) return { nodes: [], edges: [] };
    return this.graph.extractSubgraph(center.id, maxHops);
  }

  // ─── 对话结束提取 ────────────────────────────────────────

  /**
   * 从对话中提取记忆 — 委托 memory-manager agent 执行 React 循环。
   *
   * 与旧版 cheapLLM.complete() 的区别：
   * - 使用真正的 AgentLoop React 循环
   * - LLM 可以真实调用 memory_search / memory_store / memory_stats 工具
   * - memory_manager 工具直接操作全局 MemoryManager（即当前实例）
   * - LLM 可实时搜索已有记忆做去重，而非仅依赖 prompt 中注入的摘要
   */
  async extractFromSession(messages: any[]): Promise<{ entityCount: number; relationCount: number; factCount: number; eventCount: number } | null> {
    if (!this.agentFactory || !this.parentProvider || messages.length === 0) return null;
    if (this.isExtracting) return null; // 竞态：已有提取在进行中

    this.isExtracting = true;
    try {
      // 结构化序列化对话消息，区分不同消息类型
      const maxInputChars = 32000;
      let conversationText = messages.map((m: any) => {
        const role = m.role || m.type || 'unknown';
        const content = m.content;
        // 工具调用：提取关键信息
        if (role === 'tool_use' || role === 'assistant' && Array.isArray(content)) {
          const toolBlocks = (Array.isArray(content) ? content : [content])
            .filter((b: any) => b?.type === 'tool_use')
            .map((b: any) => `[工具调用: ${b.name}] ${JSON.stringify(b.input).slice(0, 500)}`);
          const textBlocks = (Array.isArray(content) ? content : [content])
            .filter((b: any) => b?.type === 'text')
            .map((b: any) => `[助手]: ${b.text}`);
          const thinkingBlocks = (Array.isArray(content) ? content : [content])
            .filter((b: any) => b?.type === 'thinking')
            .map((b: any) => `[思考]: ${typeof b.thinking === 'string' ? b.thinking.slice(0, 300) : ''}`);
          return [...textBlocks, ...thinkingBlocks, ...toolBlocks].join('\n') || `[${role}]: (empty)`;
        }
        // 工具结果：截断长输出
        if (role === 'tool_result') {
          const text = typeof content === 'string' ? content : JSON.stringify(content);
          const truncated = text.length > 1000 ? text.slice(0, 1000) + '...(截断)' : text;
          const toolId = m.tool_use_id ? ` (${m.tool_use_id.slice(0, 8)})` : '';
          return `[工具结果${toolId}]: ${truncated}`;
        }
        // 用户/助手文本消息
        if (typeof content === 'string') {
          return `[${role}]: ${content}`;
        }
        return `[${role}]: ${JSON.stringify(content).slice(0, 1000)}`;
      }).join('\n');
      if (conversationText.length > maxInputChars) {
        // 从头部截断，保留最近的对话（尾部通常更重要）
        conversationText = '...(早期对话已截断)\n' + conversationText.slice(-maxInputChars);
      }

      // 构建系统 prompt：identity + 记忆提取场景 + 已有记忆
      const sceneContent = await this.loadSceneContent('memory-extraction');
      const identity = this.memoryExtractionPrompt || '你是记忆管理专家。';
      const scenePrompt = sceneContent || '';
      const existingSummary = this.buildExistingMemoryContext();
      const systemPrompt = [identity, scenePrompt].filter(Boolean).join('\n\n')
        .replace('{{EXISTING_MEMORIES}}', existingSummary || '暂无已有记忆');

      // 用户消息：触发提取
      const userMessage = `请从以下对话中提取关键信息，先搜索已有记忆进行去重，再存储新记忆。\n\n对话：\n${conversationText}`;

      // 获取统计快照（提取前）
      const beforeCounts = this.getExtractionCounts();

      // 创建 AgentLoop 并执行
      await this.runMemoryAgent({
        systemPrompt,
        userMessage,
        taskType: 'memory-extraction',
        taskName: '记忆提取',
      });

      // 获取统计快照（提取后），计算增量
      const afterCounts = this.getExtractionCounts();
      const entityCount = afterCounts.entities - beforeCounts.entities;
      const relationCount = afterCounts.relations - beforeCounts.relations;
      const factCount = afterCounts.facts - beforeCounts.facts;
      const eventCount = afterCounts.events - beforeCounts.events;
      const snapshotCount = afterCounts.snapshots - beforeCounts.snapshots;

      log.info(`Session extraction complete: ${entityCount} entities, ${relationCount} relations, ${factCount} facts, ${eventCount} events, ${snapshotCount} snapshots`);

      // 发射 MEMORY_EXTRACTED 事件
      if (entityCount + relationCount + factCount + eventCount + snapshotCount > 0) {
        eventBus.emitSync(XuanjiEvent.MEMORY_EXTRACTED, {
          sessionId: '',
          entityCount,
          factCount,
          eventCount,
        } as any);
      }
      return { entityCount, relationCount, factCount, eventCount };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('extractFromSession failed: %s', msg);
      return null;
    } finally {
      this.isExtracting = false;
      // 提取完成后（无论成功失败）清理 pending 文件
      this.clearPendingExtraction().catch(() => {});
    }
  }

  /** 加载场景 prompt 内容（委托给 LayeredPromptBuilder.loadSceneContent） */
  private async loadSceneContent(scene: string): Promise<string | null> {
    if (!this.layeredPromptBuilder) return null;
    try {
      return await this.layeredPromptBuilder.loadSceneContent(scene);
    } catch {
      log.warn(`loadSceneContent failed for scene: ${scene}`);
      return null;
    }
  }

  /** 获取 L0 基础 prompt 组件内容（用于注入到 memory-manager agent） */
  private async getL0PromptContent(): Promise<string> {
    if (!this.layeredPromptBuilder) return '';
    try {
      const components = this.layeredPromptBuilder.getAllComponents?.() || [];
      const l0Components = components.filter((c: any) => c.layer === 'L0' && c.id !== 'main-agent');
      if (l0Components.length === 0) return '';
      const parts: string[] = [];
      for (const c of l0Components) {
        try {
          const rendered = await c.render({});
          if (rendered?.trim()) parts.push(rendered.trim());
        } catch { /* skip failed render */ }
      }
      return parts.join('\n\n');
    } catch {
      return '';
    }
  }

  /**
   * 统一 memory-manager agent 执行入口（三模式：提取 / 整理 / 压缩）。
   *
   * @param opts.taskType - 任务类型标识（memory-extraction / memory-maintenance / memory-compression）
   * @param opts.taskName - 任务展示名称
   * @param opts.returnResponse - 是否返回 agent 文本响应（压缩模式需要）
   */
  private async runMemoryAgent(opts: {
    systemPrompt: string;
    userMessage: string;
    taskType: string;
    taskName: string;
    timeout?: number;
    returnResponse?: boolean;
  }): Promise<string | null> {
    // 注入 L0 基础 prompt 组件
    const l0Content = await this.getL0PromptContent();
    const fullSystemPrompt = l0Content ? `${l0Content}\n\n${opts.systemPrompt}` : opts.systemPrompt;

    if (!this.agentFactory || !this.parentProvider) {
      log.error(`[memory-manager] agentFactory 或 parentProvider 未注入，无法创建 AgentLoop`);
      return null;
    }

    const { agentLoop, subAgentId } = await this.agentFactory.createMemoryAgent('memory-manager', {
      parentConfig: this.parentConfig,
      systemPrompt: fullSystemPrompt,
      maxTokens: this.parentConfig?.maxTokens,
      maxIterations: this.parentConfig?.maxIterations ?? 200,
    });

    const startedAt = Date.now();
    eventBus.emitSync(XuanjiEvent.HOOK_BACKGROUND_TASK_START, {
      taskId: subAgentId, taskType: opts.taskType, name: opts.taskName,
      model: this.parentConfig?.model || 'unknown',
    });

    const timeoutMs = opts.timeout ?? 360000;

    let timedOut = false;
    let errorOccurred = false;
    await new Promise<void>((resolve) => {
      const timeoutId = setTimeout(() => {
        timedOut = true;
        agentLoop.requestAbort();
        log.warn(`[memory-manager] ${opts.taskName} timed out after ${timeoutMs}ms`);
        resolve();
      }, timeoutMs);

      agentLoop.on({
        onEnd: () => {
          clearTimeout(timeoutId);
          resolve();
        },
        onError: (error: Error) => {
          clearTimeout(timeoutId);
          errorOccurred = true;
          log.warn('Memory agent loop error:', error.message);
          resolve();
        },
      });

      agentLoop.run(opts.userMessage).catch((err: Error) => {
        clearTimeout(timeoutId);
        errorOccurred = true;
        log.warn('Memory agent run failed: %s', err.message);
        resolve();
      });
    });

    eventBus.emitSync(XuanjiEvent.HOOK_BACKGROUND_TASK_END, {
      taskId: subAgentId, taskType: opts.taskType, name: opts.taskName,
      durationMs: Date.now() - startedAt, success: !timedOut && !errorOccurred, timedOut,
      errorMessage: errorOccurred ? 'Agent execution failed' : undefined,
    });

    // returnResponse 模式下提取 agent 文本响应
    if (opts.returnResponse && !errorOccurred && !timedOut) {
      try {
        const agentMessages = agentLoop.getContextManager().getMessages();
        for (let i = agentMessages.length - 1; i >= 0; i--) {
          const msg = agentMessages[i];
          if (msg.role === 'assistant') {
            if (typeof msg.content === 'string') return msg.content;
            if (Array.isArray(msg.content)) {
              const textBlocks = msg.content.filter((b: any) => b.type === 'text' && b.text);
              if (textBlocks.length > 0) return textBlocks.map((b: any) => b.text).join('\n');
            }
          }
        }
      } catch {
        log.warn('[memory-manager] Failed to extract response text');
      }
    }

    return null;
  }

  /**
   * 手动触发 LLM 记忆整理（去重/合并/关联/清理/画像更新）。
   * 绕过意图路由，直接创建 SilentAgentLoop 执行 memory-manager 的维护规则。
   */
  async runMaintenanceAgent(): Promise<void> {
    const stats = this.getStats();

    // 构建 system prompt：identity + 记忆整理场景 + 已有记忆
    const sceneContent = await this.loadSceneContent('memory-maintenance');
    const identity = this.memoryExtractionPrompt || '你是记忆管理专家。';
    const scenePrompt = sceneContent || '';
    const existingContext = this.buildExistingMemoryContext();
    const systemPrompt = [identity, scenePrompt].filter(Boolean).join('\n\n')
      .replace('{{EXISTING_MEMORIES}}', existingContext || '暂无已有记忆');

    const userMessage = `请执行记忆整理任务。

## 当前记忆统计
- 实体数: ${stats.entityCount}
- 事实数: ${stats.factCount}
- 事件数: ${stats.eventCount}
- 关系数: ${stats.relationCount}
- 叙事数: ${stats.episodeCount}

请对记忆库进行全面维护：去重、合并、关联、清理、画像刷新。`;

    await this.runMemoryAgent({
      systemPrompt,
      userMessage,
      taskType: 'memory-maintenance',
      taskName: '记忆整理',
      timeout: 600000,
    });
    log.info('Maintenance agent completed');
  }

  /** 获取当前记忆统计快照（用于计算增量） */
  private getExtractionCounts(): { entities: number; relations: number; facts: number; events: number; snapshots: number } {
    const entities = (this.db.prepare('SELECT COUNT(*) as n FROM entities').get() as any).n;
    const relations = (this.db.prepare('SELECT COUNT(*) as n FROM relations WHERE is_active = 1').get() as any).n;
    const facts = (this.db.prepare('SELECT COUNT(*) as n FROM facts WHERE is_latest = 1').get() as any).n;
    const events = (this.db.prepare('SELECT COUNT(*) as n FROM events').get() as any).n;
    const snapshots = (this.db.prepare('SELECT COUNT(*) as n FROM project_snapshots').get() as any).n;
    return { entities, relations, facts, events, snapshots };
  }

  /** 查询已有记忆摘要，填充 prompt 中的 {{EXISTING_MEMORIES}} 占位符 */
  private buildExistingMemoryContext(): string {
    try {
      const entities = this.db.prepare(
        'SELECT name, type, summary FROM entities ORDER BY updated_at DESC LIMIT 30'
      ).all() as Array<{ name: string; type: string; summary: string }>;

      const facts = this.db.prepare(
        'SELECT title, content FROM facts WHERE is_latest = 1 ORDER BY updated_at DESC LIMIT 10'
      ).all() as Array<{ title: string; content: string }>;

      // V11 新表查询：表可能不存在于旧数据库，需要 tableExists 保护
      const te = (name: string) => this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

      const topics = te('topic_tracker') ? this.db.prepare(
        `SELECT topic, topic_type, context_summary FROM topic_tracker
         WHERE status IN ('open', 'followed_up') ORDER BY last_mentioned_at DESC LIMIT 10`
      ).all() as Array<{ topic: string; topic_type: string; context_summary: string | null }> : [];

      const anchors = te('time_anchors') ? this.db.prepare(
        `SELECT anchor_type, reason, trigger_time FROM time_anchors
         WHERE is_active = 1 ORDER BY created_at DESC LIMIT 10`
      ).all() as Array<{ anchor_type: string; reason: string | null; trigger_time: number | null }> : [];

      const profiles = te('user_profile') ? this.db.prepare(
        'SELECT dimension, summary FROM user_profile ORDER BY last_updated_at DESC LIMIT 10'
      ).all() as Array<{ dimension: string; summary: string }> : [];

      const parts: string[] = [];
      if (entities.length > 0) {
        parts.push('## 已知实体');
        for (const e of entities) {
          parts.push(`- ${e.name} (${e.type}): ${e.summary}`);
        }
      }
      if (facts.length > 0) {
        parts.push('## 已知事实');
        for (const f of facts) {
          parts.push(`- ${f.title}: ${f.content}`);
        }
      }
      if (topics.length > 0) {
        parts.push('## 已知话题');
        for (const t of topics) {
          parts.push(`- [${t.topic_type}] ${t.topic}${t.context_summary ? ` — ${t.context_summary.slice(0, 120)}` : ''}`);
        }
      }
      if (anchors.length > 0) {
        parts.push('## 已知时间锚点');
        for (const a of anchors) {
          const timeStr = a.trigger_time ? new Date(a.trigger_time).toISOString().slice(0, 10) : '无具体时间';
          parts.push(`- [${a.anchor_type}] ${a.reason || '(无描述)'} (${timeStr})`);
        }
      }
      if (profiles.length > 0) {
        parts.push('## 已知用户画像');
        for (const p of profiles) {
          parts.push(`- [${p.dimension}] ${p.summary}`);
        }
      }
      // 行为模式（去重用）
      const behaviorPatterns = te('behavior_patterns') ? this.db.prepare(
        'SELECT pattern_type, description FROM behavior_patterns ORDER BY updated_at DESC LIMIT 5'
      ).all() as Array<{ pattern_type: string; description: string }> : [];
      if (behaviorPatterns.length > 0) {
        parts.push('## 已知行为模式');
        for (const bp of behaviorPatterns) {
          parts.push(`- [${bp.pattern_type}] ${bp.description}`);
        }
      }
      // 群组（去重用）
      const groupRows = te('groups') ? this.db.prepare(
        'SELECT name, type, summary FROM groups ORDER BY updated_at DESC LIMIT 5'
      ).all() as Array<{ name: string; type: string; summary: string | null }> : [];
      if (groupRows.length > 0) {
        parts.push('## 已知群组');
        for (const g of groupRows) {
          parts.push(`- ${g.name} (${g.type})${g.summary ? `: ${g.summary}` : ''}`);
        }
      }
      // 项目快照（用于追踪开发进度）
      const snapshots = te('project_snapshots') ? this.db.prepare(
        `SELECT ps.phase, ps.status, ps.progress_pct, ps.current_focus, ps.blockers, ps.next_milestone, ps.snapshot_at,
                e.name as project_name
         FROM project_snapshots ps
         LEFT JOIN entities e ON e.id = ps.project_id
         ORDER BY ps.snapshot_at DESC LIMIT 5`
      ).all() as Array<{ phase: string; status: string; progress_pct: number; current_focus: string | null; blockers: string | null; next_milestone: string | null; snapshot_at: number; project_name: string | null }> : [];
      if (snapshots.length > 0) {
        parts.push('## 项目进度快照');
        for (const s of snapshots) {
          const proj = s.project_name || '未知项目';
          const time = new Date(s.snapshot_at).toISOString().slice(0, 10);
          parts.push(`- [${proj}] ${s.phase}阶段 | ${s.status} | 进度${s.progress_pct}% | ${s.current_focus || ''}${s.blockers ? ` | 阻塞: ${s.blockers}` : ''}${s.next_milestone ? ` | 下一步: ${s.next_milestone}` : ''} (${time})`);
        }
      }
      return parts.join('\n');
    } catch {
      log.warn('buildExistingMemoryContext failed, extraction will lack dedup context');
      return '';
    }
  }

  // ─── 统计 ────────────────────────────────────────────────

  getStats(): MemoryStats {
    const entityCount = (this.db.prepare('SELECT COUNT(*) as n FROM entities').get() as any).n;
    const factCount = (this.db.prepare('SELECT COUNT(*) as n FROM facts WHERE is_latest = 1').get() as any).n;
    const eventCount = (this.db.prepare('SELECT COUNT(*) as n FROM events').get() as any).n;
    const relationCount = (this.db.prepare('SELECT COUNT(*) as n FROM relations WHERE is_active = 1').get() as any).n;
    let episodeCount = 0;
    try {
      episodeCount = (this.db.prepare('SELECT COUNT(*) as n FROM episodes').get() as any).n;
    } catch { log.debug('getStats: episodes table not found'); }
    let ftsEntryCount = 0;
    try {
      ftsEntryCount = (this.db.prepare('SELECT COUNT(*) as n FROM memory_fts').get() as any).n;
    } catch { log.debug('getStats: memory_fts table not found'); }

    let dbSizeBytes = 0;
    try {
      dbSizeBytes = statSync(this.dbPath).size;
    } catch { /* 文件可能不存在 */ }

    return { entityCount, factCount, eventCount, relationCount, episodeCount, ftsEntryCount, dbSizeBytes };
  }

  /**
   * 获取记忆全量快照，包含统计数据、样本数据和潜在问题（孤立实体、共现对等）。
   * 供 memory_stats 工具和记忆维护任务使用。
   */
  getMemorySnapshot(): MemorySnapshot {
    const stats = this.getStats();

    // 最近实体样本
    const recentEntities = this.db.prepare(`
      SELECT id, name, type, category, summary, importance, updated_at AS updatedAt
      FROM entities ORDER BY updated_at DESC LIMIT 20
    `).all() as any[];

    // 最近事实样本
    const recentFacts = this.db.prepare(`
      SELECT id, title, content, source, importance, updated_at AS updatedAt
      FROM facts WHERE is_latest = 1 ORDER BY updated_at DESC LIMIT 20
    `).all() as any[];

    // 活跃关系样本
    const activeRelations = this.db.prepare(`
      SELECT s.name AS subjectName, r.relation, o.name AS objectName, r.strength
      FROM relations r
      JOIN entities s ON s.id = r.subject_id
      JOIN entities o ON o.id = r.object_id
      WHERE r.is_active = 1
      ORDER BY r.strength DESC, r.updated_at DESC
      LIMIT 30
    `).all() as any[];

    // 最近事件样本
    const recentEvents = this.db.prepare(`
      SELECT id, content, time, entity_ids AS entityIds
      FROM events ORDER BY time DESC LIMIT 15
    `).all() as any[];

    // 孤立实体：无活跃关系且无事件引用
    const orphanEntities = this.db.prepare(`
      SELECT e.id, e.name, e.type, e.summary
      FROM entities e
      WHERE e.id NOT IN (
        SELECT r.subject_id FROM relations r WHERE r.is_active = 1
        UNION
        SELECT r.object_id FROM relations r WHERE r.is_active = 1
      )
      AND e.id NOT IN (
        SELECT DISTINCT trim(value) FROM events, json_each('["' || replace(entity_ids, ',', '","') || '"]')
        WHERE value != ''
      )
      ORDER BY e.updated_at DESC
      LIMIT 15
    `).all() as any[];

    // 高频共现实体对：同一事件中出现 2 次以上的实体组合
    // （用 SQL 不太好做，用 JS 简化：从 events 中提取至少包含 2 个 entity 的事件，组合计数）
    const cooccurrenceMap = new Map<string, number>();
    const rawEvents = this.db.prepare(
      "SELECT entity_ids FROM events WHERE entity_ids != '' AND entity_ids != ','"
    ).all() as any[];
    for (const ev of rawEvents) {
      const ids: string[] = ev.entity_ids.split(',').filter((s: string) => s.length > 0);
      if (ids.length < 2) continue;
      // 生成所有无序对组合
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const pair = ids[i] < ids[j] ? `${ids[i]}:${ids[j]}` : `${ids[j]}:${ids[i]}`;
          cooccurrenceMap.set(pair, (cooccurrenceMap.get(pair) || 0) + 1);
        }
      }
    }
    // 取计数 >= 2 的对，反查实体名
    const cooccurrencePairs: Array<{ entityA: string; entityB: string; count: number }> = [];
    for (const [pair, count] of cooccurrenceMap) {
      if (count < 2) continue;
      const [idA, idB] = pair.split(':');
      const nameA = (this.db.prepare('SELECT name FROM entities WHERE id = ?').get(idA) as any)?.name || idA;
      const nameB = (this.db.prepare('SELECT name FROM entities WHERE id = ?').get(idB) as any)?.name || idB;
      cooccurrencePairs.push({ entityA: nameA, entityB: nameB, count });
    }
    cooccurrencePairs.sort((a, b) => b.count - a.count);

    return { stats, recentEntities, recentFacts, activeRelations, recentEvents, orphanEntities, cooccurrencePairs };
  }

  // ─── 辅助方法 ────────────────────────────────────────────

  get dbInstance(): Database.Database { return this.db; }
  get memoryGraph(): MemoryGraph { return this.graph; }

  get isInitialized(): boolean { return this.initialized; }

  /** 解析实体名称，将"我"映射到当前用户 */
  private async resolveEntity(name: string): Promise<Entity | null> {
    // "我" → 优先用 userName，其次 userId
    if (name === '我') {
      const searchName = this.userName || this.userId;
      if (searchName) {
        const row = this.db.prepare('SELECT * FROM entities WHERE name = ? AND type = ? LIMIT 1')
          .get(searchName, 'user') as any;
        if (row) return this.rowToEntity(row);
      }
    }
    // 按名称查找（精确匹配）。userName 也匹配到 user 实体
    let row = this.db.prepare('SELECT * FROM entities WHERE name = ? LIMIT 1').get(name) as any;
    if (!row && this.userName && name === this.userId) {
      // 向后兼容：如果还在用旧的数字 ID 查询，映射到 userName
      row = this.db.prepare('SELECT * FROM entities WHERE name = ? AND type = ? LIMIT 1')
        .get(this.userName, 'user') as any;
    }
    return row ? this.rowToEntity(row) : null;
  }

  /** 确保用户实体存在，作为知识图谱的根节点 */
  async ensureUserEntity(): Promise<string | null> {
    if (this.userEntityId) return this.userEntityId;
    if (this._creatingUserEntity) return null; // 防止 upsertEntity 回调造成无限递归
    if (!this.userId) return null;

    // 1. 优先按 human-readable name 查找
    if (this.userName) {
      const existing = this.db.prepare(
        "SELECT id FROM entities WHERE name = ? AND type = 'user' LIMIT 1"
      ).get(this.userName) as { id: string } | undefined;
      if (existing) {
        this.userEntityId = existing.id;
        return existing.id;
      }
      // userName 已设置但未找到 → 检查旧数字ID实体并重命名
      const oldEntity = this.db.prepare(
        "SELECT id FROM entities WHERE name = ? AND type = 'user'"
      ).get(this.userId) as { id: string } | undefined;
      if (oldEntity) {
        this.db.prepare("UPDATE entities SET name = ?, summary = ? WHERE id = ?")
          .run(this.userName, `用户 ${this.userName}`, oldEntity.id);
        this.graphUpdateNode({ id: oldEntity.id, name: this.userName, type: 'user', scene_tag: '', category: null, metadata: null });
        this.userEntityId = oldEntity.id;
        return oldEntity.id;
      }
    }

    // 2. 按数字 userId 查找
    const byUserId = this.db.prepare(
      "SELECT id FROM entities WHERE name = ? AND type = 'user' LIMIT 1"
    ).get(this.userId) as { id: string } | undefined;
    if (byUserId) {
      this.userEntityId = byUserId.id;
      return byUserId.id;
    }

    // 3. 兜底：查找任意 type='user' 实体（可能已被 self-healing 重命名）
    const anyUser = this.db.prepare(
      "SELECT id, name FROM entities WHERE type = 'user' LIMIT 1"
    ).get() as { id: string; name: string } | undefined;
    if (anyUser) {
      // 如果实体名是人类可读名，回填 userName
      if (anyUser.name !== this.userId && /[^\d]/.test(anyUser.name)) {
        this.userName = anyUser.name;
      }
      this.userEntityId = anyUser.id;
      return anyUser.id;
    }

    // 4. 完全不存在 → 创建
    // 设置 _creatingUserEntity 防止 upsertEntity 回调 ensureUserEntity 导致无限递归
    this._creatingUserEntity = true;
    try {
      const entity = await this.upsertEntity({
        name: this.userName || this.userId,
        type: 'user',
        summary: this.userName ? `用户 ${this.userName}` : '系统用户',
        importance: 5,
      });
      this.userEntityId = entity.id;
      return entity.id;
    } finally {
      this._creatingUserEntity = false;
    }
  }

  /** 确保新实体锚定到用户（用户 → 实体，默认关系 "knows"） */
  private async ensureUserAnchor(entityId: string): Promise<void> {
    const userId = await this.ensureUserEntity();
    if (!userId || userId === entityId) return;

    // 检查是否已存在用户→实体的关系
    const existing = this.db.prepare(
      'SELECT id FROM relations WHERE subject_id = ? AND object_id = ? AND is_active = 1'
    ).get(userId, entityId) as { id: string } | undefined;

    if (!existing) {
      // 弱锚定关系，明确的用户关系会覆盖
      await this.relate({
        subject_id: userId,
        object_id: entityId,
        relation: 'knows',
        strength: 1,
      } as RelationInputById).catch(err => log.warn('ensureUserAnchor relate failed:', err));
    }
  }

  private graphUpdateNode(row: any): void {
    this.graph.addNode({
      id: row.id, name: row.name, type: row.type, scene_tag: row.scene_tag || '',
      category: row.category ?? null, summary: row.summary ?? null, importance: row.importance ?? null, metadata: row.metadata ?? null,
    });
  }

  private rowToEntity(row: any): Entity {
    return {
      id: row.id, name: row.name, type: row.type,
      summary: row.summary, belief: row.belief,
      scene_tag: row.scene_tag ?? '', owner: row.owner ?? 'user',
      importance: row.importance ?? 3, ref_count: row.ref_count ?? 0,
      confidence: row.confidence ?? MemoryManager.DEFAULT_CONFIDENCE, evidence_count: row.evidence_count ?? 1,
      created_at: row.created_at, updated_at: row.updated_at,
      category: row.category ?? null, metadata: row.metadata ?? null,
    };
  }

  private rowToRelation(row: any): Relation {
    return {
      id: row.id, subject_id: row.subject_id, object_id: row.object_id,
      relation: row.relation, desc: row.desc,
      strength: row.strength ?? 3, is_active: row.is_active ?? 1,
      scene_tag: row.scene_tag ?? '',
      confidence: row.confidence ?? MemoryManager.DEFAULT_CONFIDENCE, evidence_count: row.evidence_count ?? 1,
      interaction_count: row.interaction_count ?? 1,
      last_interaction_at: row.last_interaction_at ?? null,
      role_context: row.role_context ?? null,
      created_at: row.created_at, updated_at: row.updated_at,
    };
  }

  // ─── 会话留存架构（Layer 0 + Layer 1）───────────────────────

  /**
   * Layer 0: 写入结构化工具调用事件
   * 由 agent-bridge 在 AGENT_TOOL_END 时调用
   */
  writeSessionEvent(event: {
    sessionId: string;
    timestamp: number;
    eventType: string;
    toolName?: string;
    toolInput?: string;
    toolOutput?: string;
    filePath?: string;
    exitCode?: number;
    errorMsg?: string;
    durationMs?: number;
    agentId?: string;
  }): void {
    if (!this.initialized) return;
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO session_events (id, session_id, timestamp, event_type, tool_name, tool_input, tool_output, file_path, exit_code, error_msg, duration_ms, agent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, event.sessionId, event.timestamp, event.eventType,
      event.toolName || null, event.toolInput || null, event.toolOutput || null,
      event.filePath || null, event.exitCode ?? null, event.errorMsg || null,
      event.durationMs ?? null, event.agentId || null,
    );
  }

  /**
   * Layer 1: 写入/更新会话索引
   * 由 SessionManager.save() 调用
   */
  upsertSessionIndex(entry: {
    sessionId: string;
    createdAt: number;
    updatedAt: number;
    summary?: string;
    keyPoints?: string[];
    tokenUsage?: string;
    toolCount?: number;
    fileCount?: number;
    messageCount?: number;
    projectDir?: string;
    tags?: string[];
  }): void {
    if (!this.initialized) return;
    const keyPointsStr = entry.keyPoints?.length ? JSON.stringify(entry.keyPoints) : null;
    const tagsStr = entry.tags?.length ? JSON.stringify(entry.tags) : null;
    this.db.prepare(`
      INSERT INTO session_index (session_id, created_at, updated_at, summary, key_points, token_usage, tool_count, file_count, message_count, project_dir, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        updated_at = excluded.updated_at,
        summary = COALESCE(excluded.summary, session_index.summary),
        key_points = COALESCE(excluded.key_points, session_index.key_points),
        token_usage = COALESCE(excluded.token_usage, session_index.token_usage),
        tool_count = COALESCE(excluded.tool_count, session_index.tool_count),
        file_count = COALESCE(excluded.file_count, session_index.file_count),
        message_count = COALESCE(excluded.message_count, session_index.message_count),
        project_dir = COALESCE(excluded.project_dir, session_index.project_dir),
        tags = COALESCE(excluded.tags, session_index.tags)
    `).run(
      entry.sessionId, entry.createdAt, entry.updatedAt,
      entry.summary || null, keyPointsStr, entry.tokenUsage || null,
      entry.toolCount ?? null, entry.fileCount ?? null,
      entry.messageCount ?? null, entry.projectDir || null, tagsStr,
    );
  }

  /**
   * Layer 0: 批量查询会话事件（供分析工具使用）
   */
  getSessionEvents(sessionId: string, options?: { limit?: number; eventType?: string }): any[] {
    if (!this.initialized) return [];
    const limit = options?.limit ?? 100;
    if (options?.eventType) {
      return this.db.prepare(
        'SELECT * FROM session_events WHERE session_id = ? AND event_type = ? ORDER BY timestamp DESC LIMIT ?'
      ).all(sessionId, options.eventType, limit);
    }
    return this.db.prepare(
      'SELECT * FROM session_events WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(sessionId, limit);
  }

  /**
   * Layer 1: 查询会话索引列表（供前端历史面板使用）
   */
  listSessionIndex(options?: { limit?: number; projectDir?: string }): any[] {
    if (!this.initialized) return [];
    const limit = options?.limit ?? 50;
    if (options?.projectDir) {
      return this.db.prepare(
        'SELECT * FROM session_index WHERE project_dir = ? ORDER BY updated_at DESC LIMIT ?'
      ).all(options.projectDir, limit);
    }
    return this.db.prepare(
      'SELECT * FROM session_index ORDER BY updated_at DESC LIMIT ?'
    ).all(limit);
  }
}
