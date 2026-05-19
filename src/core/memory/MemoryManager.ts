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
import type {
  Entity, EntityInput, EntityFilter,
  Relation, RelationInput, RelationInputById, RelationQuery,
  RelationChange,
  Event, EventInput, TimelineFilter,
  Fact, FactInput, FactFilter,
  ProjectSnapshot,
  Episode, EpisodeEntity,
  MemorySearchOptions, MemorySearchResult, MemorySearchResultWithGraph,
  GraphNeighbor, GraphPath,
  MemoryStats, MemorySnapshot, BuildContextOptions,
  SubAgentResult,
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

// ─── MemoryManager ─────────────────────────────────────────

export class MemoryManager {
  private db!: Database.Database;
  private graph = new MemoryGraph();
  private initialized = false;
  private recentToolCalls: Array<{ toolName: string; sessionId?: string; time: number; dedupKey?: string }> = [];
  private userId: string = '';
  private userName: string = '';
  private userEntityId: string | null = null;

  // 可选依赖（通过 setter 注入或构造函数传入）
  public episodicMemory?: any;
  public semanticIndex?: any;
  public subAgentStore?: any;
  public skillRegistry?: any;
  public toolRegistry?: any;
  public mcpManager?: any;
  public searchService?: any;

  /** 上下文压缩用的独立 LLM（context-compressor agent） */
  public compressionLLM?: any;

  /** 记忆提取用的 system prompt（来自 memory-manager.yaml） */
  public memoryExtractionPrompt?: string;

  /** LLM Provider（用于创建 AgentLoop），与 cheapLLM 共享同一 provider */
  public provider?: ILLMProvider;

  /** 上下文压缩用的 system prompt（来自 context-compressor.yaml） */
  public compressionPrompt?: string;

  /** 分层 Prompt 构建器引用，用于为 memory-manager/compressor 注入 L0 基础组件 */
  public layeredPromptBuilder?: any;

  /** 是否正在执行记忆提取（竞态标记，供前端按钮感知自动执行） */
  public isExtracting = false;

  /** 是否正在执行上下文压缩（竞态标记，供前端按钮感知自动执行） */
  public isCompressing = false;

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

    this.initialized = true;
    log.info(`MemoryManager initialized: ${this.dbPath}`);
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

    this.ensureFtsTriggers();
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

  private ensureFtsTriggers(): void {
    // 确保 FTS5 同步触发器存在（幂等：先删除再创建）
    const dropAndCreate = (table: string, titleCol: string, contentCol: string) => {
      // SQLite triggers are idempotent via CREATE TRIGGER IF NOT EXISTS, but for correctness
      // with schema changes, drop first
      this.db.exec(`
        DROP TRIGGER IF EXISTS ${table}_fts_insert;
        DROP TRIGGER IF EXISTS ${table}_fts_delete;
        DROP TRIGGER IF EXISTS ${table}_fts_update;
      `);

      const sceneCol = table === 'facts' ? 'scene_tag' : 'scene_tag';

      this.db.exec(`
        CREATE TRIGGER ${table}_fts_insert AFTER INSERT ON ${table} BEGIN
          INSERT INTO memory_fts(source_table, source_id, title, content, scene_tag)
          VALUES ('${table}', new.id, xuanji_fts_text(new.${titleCol}), xuanji_fts_text(new.${contentCol}), new.${sceneCol});
        END;

        CREATE TRIGGER ${table}_fts_delete AFTER DELETE ON ${table} BEGIN
          DELETE FROM memory_fts WHERE source_id = old.id AND source_table = '${table}';
        END;

        CREATE TRIGGER ${table}_fts_update AFTER UPDATE ON ${table} BEGIN
          DELETE FROM memory_fts WHERE source_id = old.id AND source_table = '${table}';
          INSERT INTO memory_fts(source_table, source_id, title, content, scene_tag)
          VALUES ('${table}', new.id, xuanji_fts_text(new.${titleCol}), xuanji_fts_text(new.${contentCol}), new.${sceneCol});
        END;
      `);
    };

    dropAndCreate('entities', 'name', 'summary');
    dropAndCreate('events', 'content', 'content');
    dropAndCreate('facts', 'title', 'content');
    dropAndCreate('episodes', 'title', 'narrative');
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

    // events
    const events = this.db.prepare('SELECT id, content, scene_tag FROM events').all() as any[];
    for (const ev of events) {
      insertFts.run('events', ev.id, cjkSplit(ev.content), cjkSplit(ev.content), ev.scene_tag || '');
    }

    // facts
    const facts = this.db.prepare('SELECT id, title, content, scene_tag FROM facts').all() as any[];
    for (const f of facts) {
      insertFts.run('facts', f.id, cjkSplit(f.title), cjkSplit(f.content), f.scene_tag || '');
    }

    // episodes
    const episodes = this.db.prepare('SELECT id, title, narrative, scene_tag FROM episodes').all() as any[];
    for (const ep of episodes) {
      insertFts.run('episodes', ep.id, cjkSplit(ep.title), cjkSplit(ep.narrative), ep.scene_tag || '');
    }

    log.info(`FTS5 index rebuilt: ${entities.length}E + ${events.length}Ev + ${facts.length}F + ${episodes.length}Ep (${Date.now() - start}ms)`);
  }

  // ─── Entity CRUD ─────────────────────────────────────────

  async upsertEntity(input: EntityInput): Promise<Entity> {
    const now = Date.now();
    const id = randomUUID();
    const sceneTag = formatSceneTag(input.scene_tag);
    const metadataStr = input.metadata
      ? (typeof input.metadata === 'string' ? input.metadata : JSON.stringify(input.metadata))
      : null;

    const existing = this.db.prepare(
      'SELECT id FROM entities WHERE name = ? AND type = ?'
    ).get(input.name, input.type) as { id: string } | undefined;

    if (existing) {
      this.db.prepare(`
        UPDATE entities SET summary = ?, belief = ?, scene_tag = ?, importance = ?,
          category = ?, metadata = ?, updated_at = ?
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

    // 自锚定：新实体若非用户本人，自动关联到"我"
    if (!isHumanUserEntity && this.userId && entity.name !== this.userId && entity.type !== 'user') {
      await this.ensureUserAnchor(entity.id).catch(err => log.warn('Auto-anchor failed:', err));
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
      this.db.prepare(`
        UPDATE relations SET strength = ?, desc = ?, updated_at = ? WHERE id = ?
      `).run(input.strength ?? 3, input.desc ?? null, now, dup.id);
      return this.db.prepare('SELECT * FROM relations WHERE id = ?').get(dup.id) as any as Relation;
    }

    this.db.prepare(`
      INSERT INTO relations (id, subject_id, object_id, relation, desc, strength, scene_tag, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, subjectId, objectId, input.relation, input.desc ?? null, input.strength ?? 3, sceneTag, now, now);

    const rel = this.db.prepare('SELECT * FROM relations WHERE id = ?').get(id) as any;
    this.graph.addEdge({
      subjectId: rel.subject_id, relation: rel.relation,
      objectId: rel.object_id, strength: rel.strength,
    });
    return this.rowToRelation(rel);
  }

  async deactivateRelation(subjectId: string, objectId: string, relation: string, reason?: string): Promise<void> {
    const now = Date.now();
    const old = this.db.prepare(
      'SELECT * FROM relations WHERE subject_id = ? AND object_id = ? AND relation = ? AND is_active = 1'
    ).get(subjectId, objectId, relation) as any;

    if (!old) return;

    this.db.prepare('UPDATE relations SET is_active = 0, updated_at = ? WHERE id = ?').run(now, old.id);

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
        INSERT INTO facts (id, title, content, source, source_detail, version, is_latest, scene_tag, related_entity_ids, creator, importance, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
      `).run(id, input.title, input.content, input.source ?? 'user_said', input.source_detail ?? null,
        newVersion, sceneTag, relatedEntityIds, input.creator ?? null, 3, now, now);

      const fact = this.db.prepare('SELECT * FROM facts WHERE id = ?').get(id) as any as Fact;
      this.semanticIndex?.index(fact.id, 'facts', `${fact.title} ${fact.content}`).catch((err: any) => log.warn('Semantic index failed:', err));
      return fact;
    }

    this.db.prepare(`
      INSERT INTO facts (id, title, content, source, source_detail, version, is_latest, scene_tag, related_entity_ids, creator, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)
    `).run(id, input.title, input.content, input.source ?? 'user_said', input.source_detail ?? null,
      sceneTag, relatedEntityIds, input.creator ?? null, 3, now, now);

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
    this.db.prepare('UPDATE facts SET is_latest = 0 WHERE title = ? AND is_latest = 1').run(title);
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

  // ─── 融合搜索（语义向量 + FTS5 加权） ──────────────────

  /** 语义/FTS5 融合权重，参照 OpenClaw 默认 7:3 */
  private static readonly VECTOR_WEIGHT = 0.7;
  private static readonly FTS5_WEIGHT = 0.3;

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
        // 更新 content 为 FTS5 的完整内容（语义索引 textSummary 被截断到 200 字符）
        existing.r.content = r.content;
        existing.r.scene_tag = r.scene_tag;
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
      };

      for (const sr of filtered) {
        if (tableMap[sr.sourceTable]) {
          tableMap[sr.sourceTable].ids.push(sr.sourceId);
        }
      }

      // 批量查询完整内容
      const contentMap = new Map<string, { title: string; content: string; scene_tag: string }>();
      for (const [table, { ids, titleField, contentField }] of Object.entries(tableMap)) {
        if (ids.length === 0) continue;
        const placeholders = ids.map(() => '?').join(',');
        const rows = this.db.prepare(
          `SELECT id, ${titleField} as title, ${contentField} as content, scene_tag FROM '${table}' WHERE id IN (${placeholders})`
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
      source: 'entities',
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
        try { parsedMetadata = JSON.parse(entity.metadata); } catch { /* ignore */ }
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
    const { scene, maxTokens = 800, recentHours = 24 } = options;
    const parts: string[] = [];
    const now = Date.now();

    // L0: 用户核心画像（top-5 preference entities）
    const prefs = this.db.prepare(
      `SELECT name, summary, belief FROM entities WHERE type = 'preference' ORDER BY importance DESC LIMIT 5`
    ).all() as any[];
    if (prefs.length > 0) {
      parts.push('## 用户画像\n');
      for (const p of prefs) {
        parts.push(`- **${p.name}**: ${p.summary}${p.belief ? ` (核心信念: ${p.belief})` : ''}`);
      }
      parts.push('');
    }

    // L1: 场景相关记忆
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
    return this.recordEvent(input);
  }

  recordToolCall(toolName: string, sessionId?: string, dedupKey?: string): void {
    this.recentToolCalls.push({ toolName, sessionId, time: Date.now(), dedupKey });
    // 只保留最近 50 条
    if (this.recentToolCalls.length > 50) {
      this.recentToolCalls = this.recentToolCalls.slice(-50);
    }
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
      // 仅保存必要的文本字段
      const compact = messages.slice(-20).map((m: any) => ({
        role: m.role || m.type || 'unknown',
        content: typeof m.content === 'string' ? m.content.slice(0, 500) : '',
      }));
      await writeFile(this.pendingExtractionPath, JSON.stringify(compact), 'utf-8');
    } catch {
      // 写入失败不阻塞
    }
  }

  /** 清除待处理提取文件（提取成功后调用） */
  async clearPendingExtraction(): Promise<void> {
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(this.pendingExtractionPath);
    } catch {
      // 文件不存在或已清理，忽略
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
      // 文件损坏或处理失败，清理
      await this.clearPendingExtraction();
    }
  }

  // ─── ArchiveDelegate (上下文压缩回调) ─────────────────────

  async archiveMessages(messages: any[]): Promise<string> {
    if (messages.length === 0) return '';
    if (this.isCompressing) return ''; // 竞态：已有压缩在进行中

    // 提取关键消息为事件
    const importantMessages = messages.filter((m: any) => {
      const role = m.role || m.type;
      return role === 'assistant' || role === 'user';
    });

    if (importantMessages.length === 0) return '';

    // 格式化消息文本
    const text = importantMessages.map((m: any) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `[${m.role || m.type}]: ${content}`;
    }).join('\n').slice(0, 6000);

    // 尝试使用 context-compressor agent（需要 provider）
    if (this.provider) {
      this.isCompressing = true;
      try {
        const response = await this.runCompressionAgent('', text);
        if (response) {
          const parsed = this.parseCompressionJson(response);
          if (parsed) {
            for (const ev of parsed.events || []) {
              await this.recordEvent({
                entityNames: ev.entities || [],
                content: ev.content,
                importance: 2,
                scene_tag: '',
                operator: 'archive',
              });
            }
            for (const fact of parsed.facts || []) {
              await this.storeFact({
                title: fact.title,
                content: fact.content,
                source: 'agent_discovered',
              });
            }

            await this.episodicMemory?.createFromMessages(importantMessages).catch((err: any) => {
              log.warn('archiveMessages episodic creation failed:', err);
            });

            return parsed.summary || '';
          }
        }
      } catch (err) {
        log.warn('archiveMessages compression agent failed:', err);
      } finally {
        this.isCompressing = false;
      }
    }

    // Fallback: 使用 compressionLLM / cheapLLM 单次调用
    const llm = this.compressionLLM || this.cheapLLM;
    if (llm) {
      try {
        const prompt = `你是一个对话压缩器。从以下对话中提取关键信息，返回 JSON：

{
  "events": [{ "content": "事件描述", "entities": ["相关实体名"] }],
  "facts": [{ "title": "事实标题", "content": "事实内容" }],
  "summary": "一段中文叙事摘要，概括对话的主要内容、关键决策、当前进度和待办事项。200 字以内。"
}

对话：
${text}`;

        const response = await llm.complete(prompt);
        const parsed = JSON.parse(response);
        for (const ev of parsed.events || []) {
          await this.recordEvent({
            entityNames: ev.entities || [],
            content: ev.content,
            importance: 2,
            scene_tag: '',
            operator: 'archive',
          });
        }
        for (const fact of parsed.facts || []) {
          await this.storeFact({
            title: fact.title,
            content: fact.content,
            source: 'agent_discovered',
          });
        }

        await this.episodicMemory?.createFromMessages(importantMessages).catch((err: any) => {
          log.warn('archiveMessages episodic creation failed:', err);
        });

        return parsed.summary || '';
      } catch (err) {
        log.warn('archiveMessages LLM extraction failed:', err);
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
    if (!this.provider || messages.length === 0) return null;
    if (this.isExtracting) return null; // 竞态：已有提取在进行中

    this.isExtracting = true;
    try {
      // 拼接对话文本
      const maxInputChars = 8000;
      let conversationText = messages.map((m: any) => {
        const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        return `[${m.role || m.type}]: ${content}`;
      }).join('\n');
      if (conversationText.length > maxInputChars) {
        conversationText = conversationText.slice(0, maxInputChars) + '\n...（因长度截断）';
      }

      // 构建系统 prompt：memory-manager 规则 + 已有记忆（用于去重上下文）
      const existingSummary = this.buildExistingMemoryContext();
      const systemPrompt = this.memoryExtractionPrompt
        ? this.memoryExtractionPrompt
            .replace('{{EXISTING_MEMORIES}}', existingSummary || '暂无已有记忆')
            .replace('{{CONVERSATION_CONTENT}}', conversationText)
        : `你是记忆管理专家。从对话中提取值得长期记忆的信息，使用 memory_search 查重，memory_store 存储。\n\n## 已有记忆\n${existingSummary || '暂无'}`;

      // 用户消息：触发提取
      const userMessage = `请从以下对话中提取关键信息，先搜索已有记忆进行去重，再存储新记忆。\n\n对话：\n${conversationText}`;

      // 获取统计快照（提取前）
      const beforeCounts = this.getExtractionCounts();

      // 创建 AgentLoop 并执行
      await this.runMemoryAgent(systemPrompt, userMessage);

      // 获取统计快照（提取后），计算增量
      const afterCounts = this.getExtractionCounts();
      const entityCount = afterCounts.entities - beforeCounts.entities;
      const relationCount = afterCounts.relations - beforeCounts.relations;
      const factCount = afterCounts.facts - beforeCounts.facts;
      const eventCount = afterCounts.events - beforeCounts.events;

      log.info(`Session extraction complete: ${entityCount} entities, ${relationCount} relations, ${factCount} facts, ${eventCount} events`);

      // 发射 MEMORY_EXTRACTED 事件
      if (entityCount + relationCount + factCount + eventCount > 0) {
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

  /** 获取 L0 基础 prompt 组件内容（用于注入到 memory-manager / compressor agent） */
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
   * 运行 memory-manager agent 的 React 循环。
   *
   * 创建独立的 AgentLoop，仅注册 memory_search / memory_store / memory_stats 三个工具。
   * agent 在自己的 React 循环中调用这些工具，直接操作全局 MemoryManager（本实例）。
   */
  private async runMemoryAgent(systemPrompt: string, userMessage: string): Promise<void> {
    // 延迟导入避免循环依赖
    const { AgentLoop } = await import('@/core/agent/AgentLoop');
    const { ToolRegistry } = await import('@/core/tools/ToolRegistry');
    const { FilteredToolRegistry } = await import('@/core/tools/FilteredToolRegistry');
    const { MemorySearchTool } = await import('@/core/tools/MemorySearchTool');
    const { MemoryStoreTool } = await import('@/core/tools/MemoryStoreTool');
    const { MemoryStatsTool } = await import('@/core/tools/MemoryStatsTool');

    // 构建仅含 memory 工具的注册表
    const registry = new ToolRegistry();
    registry.register(new MemorySearchTool());
    registry.register(new MemoryStoreTool());
    registry.register(new MemoryStatsTool());

    const filteredRegistry = new FilteredToolRegistry(
      registry,
      ['memory_search', 'memory_store', 'memory_stats'],
      { agentId: 'memory-manager', agentName: 'memory-manager' },
      process.cwd(),
    );

    // 从 cheapLLM 提取 model 配置
    const cheapConfig = (this.cheapLLM as any)?.config ?? {};
    // 注入 L0 基础 prompt 组件（记忆指导、格式标准化等）
    const l0Content = await this.getL0PromptContent();
    const fullSystemPrompt = l0Content ? `${l0Content}\n\n${systemPrompt}` : systemPrompt;
    const agentConfig: AgentConfig = {
      model: cheapConfig.model || 'deepseek-v4-pro',
      apiKey: cheapConfig.apiKey,
      baseURL: cheapConfig.baseURL,
      temperature: cheapConfig.temperature ?? 0.3,
      maxTokens: cheapConfig.maxTokens ?? 2048,
      maxIterations: 5,
      systemPrompt: fullSystemPrompt,
    };

    const agentLoop = new AgentLoop(this.provider!, filteredRegistry, agentConfig);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        agentLoop.requestAbort();
        resolve(); // 超时不报错，静默结束
      }, 60000);

      agentLoop.on({
        onEnd: () => {
          clearTimeout(timeout);
          resolve();
        },
        onError: (error: string) => {
          clearTimeout(timeout);
          log.warn('Memory agent loop error: %s', error);
          resolve(); // 即使出错也不阻塞调用方
        },
      });

      agentLoop.run(userMessage).catch((err: Error) => {
        clearTimeout(timeout);
        log.warn('Memory agent run failed: %s', err.message);
        resolve();
      });
    });
  }

  /** 获取当前记忆统计快照（用于计算增量） */
  private getExtractionCounts(): { entities: number; relations: number; facts: number; events: number } {
    const entities = (this.db.prepare('SELECT COUNT(*) as n FROM entities').get() as any).n;
    const relations = (this.db.prepare('SELECT COUNT(*) as n FROM relations WHERE is_active = 1').get() as any).n;
    const facts = (this.db.prepare('SELECT COUNT(*) as n FROM facts WHERE is_latest = 1').get() as any).n;
    const events = (this.db.prepare('SELECT COUNT(*) as n FROM events').get() as any).n;
    return { entities, relations, facts, events };
  }

  /**
   * 运行 context-compressor agent 的 React 循环。
   *
   * 创建独立的 AgentLoop，无工具（tools: []），仅一个 LLM 回合。
   * 使用 context-compressor.yaml 的 systemPrompt 生成结构化摘要。
   */
  private async runCompressionAgent(existingSummary: string, messagesText: string): Promise<string | null> {
    const { AgentLoop } = await import('@/core/agent/AgentLoop');
    const { ToolRegistry } = await import('@/core/tools/ToolRegistry');
    const { FilteredToolRegistry } = await import('@/core/tools/FilteredToolRegistry');

    const registry = new ToolRegistry();
    const filteredRegistry = new FilteredToolRegistry(
      registry, [],
      { agentId: 'context-compressor', agentName: 'context-compressor' },
      process.cwd(),
    );

    const baseSystemPrompt = (this.compressionPrompt || '你是上下文压缩专家。将对话压缩为 JSON 摘要。')
      .replace('{{EXISTING_SUMMARY}}', existingSummary || '（无已有摘要）')
      .replace('{{NEW_MESSAGES}}', messagesText);
    // 注入 L0 基础 prompt 组件
    const l0Content = await this.getL0PromptContent();
    const systemPrompt = l0Content ? `${l0Content}\n\n${baseSystemPrompt}` : baseSystemPrompt;

    const compConfig = (this.compressionLLM as any)?.config ?? {};
    const agentConfig: import('@/core/types').AgentConfig = {
      model: compConfig.model || 'deepseek-v4-pro',
      apiKey: compConfig.apiKey,
      baseURL: compConfig.baseURL,
      temperature: compConfig.temperature ?? 0.2,
      maxTokens: compConfig.maxTokens ?? 1024,
      maxIterations: 1,
      systemPrompt,
    };

    const agentLoop = new AgentLoop(this.provider!, filteredRegistry, agentConfig);

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        agentLoop.requestAbort();
        resolve();
      }, 60000);

      agentLoop.on({
        onEnd: () => {
          clearTimeout(timeout);
          resolve();
        },
        onError: (error: string) => {
          clearTimeout(timeout);
          log.warn('Compression agent error: %s', error);
          resolve();
        },
      });

      agentLoop.run(messagesText).catch((err: Error) => {
        clearTimeout(timeout);
        log.warn('Compression agent run failed: %s', err.message);
        resolve();
      });
    });

    // 提取最后一个 assistant 消息作为 JSON 输出
    const agentMessages = agentLoop.getContextManager().getMessages();
    for (let i = agentMessages.length - 1; i >= 0; i--) {
      const msg = agentMessages[i];
      if (msg.role === 'assistant') {
        if (typeof msg.content === 'string') return msg.content;
        if (Array.isArray(msg.content)) {
          for (const b of msg.content) {
            if (b.type === 'text' && b.text) return b.text;
          }
        }
      }
    }
    return null;
  }

  /** 从 context-compressor agent 的响应中解析 JSON。三级降级策略，每级独立 try/catch。 */
  private parseCompressionJson(response: string): { summary?: string; events?: any[]; facts?: any[] } | null {
    // 优先级 1：遍历所有 markdown 代码块，尝试 JSON.parse
    const codeBlockRe = /```(?:\w+)?\s*([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockRe.exec(response)) !== null) {
      try {
        const inner = match[1].trim();
        if (inner.startsWith('{') || inner.startsWith('[')) {
          return JSON.parse(inner);
        }
      } catch { /* 当前代码块非有效 JSON，继续下一个 */ }
    }

    // 优先级 2：花括号配对扫描，从文本中提取首个完整 JSON 对象
    try {
      const firstBrace = response.indexOf('{');
      if (firstBrace >= 0) {
        let depth = 0, inString = false, escaped = false;
        for (let i = firstBrace; i < response.length; i++) {
          const ch = response[i];
          if (escaped) { escaped = false; continue; }
          if (ch === '\\') { escaped = true; continue; }
          if (ch === '"') { inString = !inString; continue; }
          if (inString) continue;
          if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (depth === 0) { return JSON.parse(response.slice(firstBrace, i + 1)); } }
        }
      }
    } catch { /* 提取出的片段非有效 JSON，降级到优先级 3 */ }

    // 优先级 3：直接解析整个响应
    try {
      const trimmed = response.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) return JSON.parse(trimmed);
    } catch { /* 整个响应非纯 JSON */ }

    log.warn('Failed to parse compression agent JSON response');
    return null;
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
      return parts.join('\n');
    } catch {
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
    } catch { /* episodes 表可能不存在 */ }
    let ftsEntryCount = 0;
    try {
      ftsEntryCount = (this.db.prepare('SELECT COUNT(*) as n FROM memory_fts').get() as any).n;
    } catch { /* FTS5 表可能为空 */ }

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
  private async ensureUserEntity(): Promise<string | null> {
    if (this.userEntityId) return this.userEntityId;
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
    const entity = await this.upsertEntity({
      name: this.userName || this.userId,
      type: 'user',
      summary: this.userName ? `用户 ${this.userName}` : '系统用户',
      importance: 5,
    });
    this.userEntityId = entity.id;
    return entity.id;
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
      category: row.category ?? null, metadata: row.metadata ?? null,
    });
  }

  private rowToEntity(row: any): Entity {
    return {
      id: row.id, name: row.name, type: row.type,
      summary: row.summary, belief: row.belief,
      scene_tag: row.scene_tag ?? '', owner: row.owner ?? 'user',
      importance: row.importance ?? 3, ref_count: row.ref_count ?? 0,
      created_at: row.created_at, updated_at: row.updated_at,
      category: row.category ?? null, metadata: row.metadata ?? null,
    };
  }

  private rowToRelation(row: any): Relation {
    return {
      id: row.id, subject_id: row.subject_id, object_id: row.object_id,
      relation: row.relation, desc: row.desc,
      strength: row.strength ?? 3, is_active: row.is_active ?? 1,
      scene_tag: row.scene_tag ?? '', created_at: row.created_at, updated_at: row.updated_at,
    };
  }
}
