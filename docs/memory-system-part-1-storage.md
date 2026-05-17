# Xuanji 记忆系统 · 存储架构与数据模型

> 版本: 1.1 | 日期: 2026-05-16
> 下一篇: [检索、图谱与注入](./memory-system-part-2-retrieval.md)

---

## 目录

1. [设计原则](#1-设计原则)
2. [概念模型](#2-概念模型)
3. [存储选型](#3-存储选型)
4. [数据模型详解](#4-数据模型详解)
5. [CRUD 操作定义](#5-crud-操作定义)
6. [FTS5 全文索引](#6-fts5-全文索引)
7. [版本管理与回滚](#7-版本管理与回滚)
8. [Schema 迁移策略](#8-schema-迁移策略)

---

## 1. 设计原则

| 原则 | 说明 |
|------|------|
| **精准无幻觉** | 记忆以结构化事实为主，不作语义猜测。冲突时以 Wiki 记忆为准 |
| **增量进化** | 每条记忆独立写入，不依赖批量处理。写入即检索可见 |
| **零运维** | SQLite 单文件，无守护进程，无外部依赖 |
| **可追溯** | Fact 表版本管理，支持回滚。每条记录有创建时间、来源 |
| **场景隔离** | 通过 scene_tag 区分开发/生活/工作，检索时自动过滤 |
| **Agent 认知统一** | 主 Agent、子 Agent、团队 Agent 共享同一记忆库 |

---

## 2. 概念模型

记忆系统由八张表构成——4 张基础表 + 2 张派生表 + 2 张叙事表：

```
┌───────────────────────────────────────────────────────────┐
│                    记忆系统概念模型                         │
│                                                             │
│    Entity ←────── Relation ──────→ Entity   (4 张基础表)   │
│     (节点)          (边)           (节点)                    │
│       │                                                     │
│       │ 关联                                                 │
│       ↓                                                     │
│    Event         Fact (版本管理)                             │
│    (时序)         (事实)                                    │
│                                                             │
│    ──── 自动推演的派生状态 ────                              │
│                                                             │
│    RelationChanges           ProjectSnapshots               │
│    (偏好变更追踪)              (项目进度快照)                │
│                                                             │
│    MemoryGraph (内存中的有向图)                               │
│    ├─ BFS 路径发现                                           │
│    ├─ K 跳子图提取                                           │
│    ├─ 共享邻居推理                                           │
│    └─ 聚合统计                                               │
└───────────────────────────────────────────────────────────┘
```

### 2.1 核心设计原则

| 原则 | 说明 |
|------|------|
| **LLM 存原子，代码推派生** | LLM 只通过 memory_store 工具存储原子事件/实体/事实。项目进度、偏好变更由 MemoryManager 规则引擎自动推演 |
| **追加不覆盖** | project_snapshots 是追加模式，每次事件产生一条新快照。偏差可以存在，由后续事件不断修正 |
| **失败不阻塞** | 派生推演异常不影响主流程。事件已入库，下次触发时重试 |
| **场景隔离** | 通过 scene_tag 区分开发/生活/工作，检索时自动过滤 |

### 2.2 三层记忆架构

与 LayeredPromptBuilder 的 L0/L1/L2/L3 对齐：

| 层级 | 名称 | 大小 | 注入时机 | 来源 |
|------|------|------|----------|------|
| **L0 画像** | 用户核心画像 | ~200 tokens | 每次 build prompt | entities(type='preference') top-5 |
| **L1 场景** | 当前场景相关记忆 | ~600 tokens | build prompt + scene 过滤 | entities + facts by scene_tag |
| **L2 检索** | Agent 主动查询 | 按需 | memory_search 工具调用 | FTS5 + 关系查询 + 图查询 |
| **L3 归档** | 历史事件/旧版本 | 大 | 仅显式搜索 | events + facts(is_latest=0) |

Token 预算说明：
- L0 画像固定 ~200 tokens，L1 场景动态分配剩余预算（默认总计 800 tokens）
- 不同调用上下文（主 Agent vs 子 Agent、简单 vs 复杂）预算可调整
- 具体动态分配逻辑见 Part-3 的 buildContext() 实现

---

## 3. 存储选型

### 3.1 为什么选择 SQLite

xuanji 已存在 `better-sqlite3` 依赖和 `~/.xuanji/users/{userId}/memory/memory.db` 路径预留。

| 需求 | 方案 |
|------|------|
| 关系存储 | SQL 表（entities / relations / events / facts） |
| 全文搜索 | FTS5 虚拟表（`unicode61` tokenizer） |
| 关联查询 | JOIN + 递归 CTE |
| 事务 | SQLite 事务，写入原子性 |
| 并发 | WAL 模式（已在 DecisionStore 中使用） |
| 部署 | 零部署，一个 .db 文件 |

### 3.2 为什么不上向量库 / Graph RAG

| 方案 | 为什么不用 |
|------|-----------|
| **向量库（Chroma/PGVector）** | 个人记忆 1000 条级别，FTS5 覆盖 90% 检索需求。语义搜索只在"用同义词描述不同事物"时有优势，个人记忆关键词通常明确。后续需要时可加 sqlite-vec 扩展 |
| **Graph RAG（MS 方案）** | 社区检测和摘要生成为大规模文档库设计（几万份文档），个人场景几百个节点用 SQL JOIN 就够了。每次写入都触发 LLM 提取+社区检测成本太高 |

### 3.3 文件路径

已有路径预留，无需新增：

```
~/.xuanji/users/{userId}/
├── memory/
│   ├── memory.db          ← SQLite 数据库（已预留）
│   └── knowledge.jsonl    ← 长文本知识归档（已预留）
└── ...
```

---

## 4. 数据模型详解

### 4.1 数据模型总览

```
基础 4 表:
  entities     → 节点（人/项目/工具/偏好/概念）
  relations    → 有向边（熟练使用/负责/偏好/依赖）
  events       → 时序事件（完成了什么、发生了什么事）
  facts        → 事实条目（带版本管理）

派生 2 表:
  relation_changes  → 关系变更历史（JWT→RSA 等偏好切换）
  project_snapshots → 项目状态快照（进度、阶段、阻塞项）

全文索引:
  memory_fts   → FTS5 全文索引
```

### 4.2 Entity 表（实体/节点）

```sql
CREATE TABLE entities (
  id          TEXT PRIMARY KEY,              -- uuid v4
  name        TEXT NOT NULL,                 -- '张三' | 'Docker' | '项目A'
  type        TEXT NOT NULL,                 -- user | project | tool | preference | concept
  summary     TEXT NOT NULL,                 -- 一句话描述，用于 prompt 注入
  belief      TEXT,                          -- 不可修改的核心设定
  scene_tag   TEXT NOT NULL DEFAULT '',      -- 逗号前后加空格: ',开发,工作,' | ',生活,'
  owner       TEXT NOT NULL DEFAULT 'user',  -- user | agent | agent_team
  importance  INTEGER NOT NULL DEFAULT 3,    -- 1-5
  ref_count   INTEGER NOT NULL DEFAULT 0,    -- 被引用次数（自动维护）
  created_at  INTEGER NOT NULL,              -- unix timestamp ms
  updated_at  INTEGER NOT NULL,              -- unix timestamp ms
  UNIQUE(name, type)                         -- 防止并发写入重复
);

CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_scene ON entities(scene_tag);
CREATE INDEX idx_entities_updated ON entities(updated_at DESC);
CREATE INDEX idx_entities_importance ON entities(importance DESC);
```

**scene_tag 存储约定**：逗号前后加逗号，如 `,开发,工作,`。查询时用 `LIKE '%,开发,%'` 精确匹配，避免 `开发` 误匹配 `AI开发`。

**type 枚举**（开放扩展，建议常用值）：

| type | 含义 | 示例 |
|------|------|------|
| `user` | 人 | 张三、李四 |
| `project` | 项目 | 项目A、xuanji |
| `tool` | 工具/技术 | Docker、PostgreSQL、Python |
| `preference` | 偏好/习惯 | 喜欢 Docker Compose、不接受996 |
| `concept` | 抽象概念 | 架构风格、设计原则 |
| `organization` | 组织/团队 | xx公司、xx开源社区 |

### 4.3 Relation 表（关系/边）

```sql
CREATE TABLE relations (
  id          TEXT PRIMARY KEY,
  subject_id  TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  object_id   TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation    TEXT NOT NULL,                 -- '熟练使用' | '负责' | '偏好' | '依赖'
  desc        TEXT,                          -- 关系说明（可选）
  strength    INTEGER NOT NULL DEFAULT 3,    -- 1-5
  is_active   INTEGER NOT NULL DEFAULT 1,    -- 1=当前有效, 0=已废弃（软删除）
  scene_tag   TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_relations_subject ON relations(subject_id);
CREATE INDEX idx_relations_object ON relations(object_id);
CREATE INDEX idx_relations_scene ON relations(scene_tag);
CREATE INDEX idx_relations_relation ON relations(relation);
CREATE INDEX idx_relations_active ON relations(subject_id, is_active);
```

**is_active 字段说明**：
- `is_active=1`：当前有效关系。所有图查询和 prompt 注入只加载活跃关系
- `is_active=0`：已废弃关系。用户偏好从 JWT 改为 RSA 后，旧关系设为 0
- 变更历史通过 `relation_changes` 表独立追踪，不依赖 is_active 回滚

**relation 常用值**：

| 场景 | 常用 relation |
|------|-------------|
| 通用 | `属于`、`关联`、`偏好`、`反对` |
| 开发 | `熟练使用`、`负责`、`使用`、`对接`、`依赖`、`推荐` |
| 工作 | `管理`、`协作`、`汇报`、`负责` |
| 生活 | `喜欢`、`常去`、`拥有`、`订阅` |

### 4.4 Event 表（时序事件）

```sql
CREATE TABLE events (
  id          TEXT PRIMARY KEY,
  time        INTEGER NOT NULL,              -- 事件发生时间
  entity_ids  TEXT NOT NULL,                 -- 逗号前后加逗号: ',zhangsan_id,projectA_id,'
  content     TEXT NOT NULL,                 -- 事件描述
  result      TEXT,                          -- 事件结果
  importance  INTEGER NOT NULL DEFAULT 3,    -- 1-5
  scene_tag   TEXT NOT NULL DEFAULT '',
  operator    TEXT,                          -- 谁执行的（agent id or 'user'）
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_events_time ON events(time DESC);
CREATE INDEX idx_events_scene ON events(scene_tag);
CREATE INDEX idx_events_importance ON events(importance DESC);
```

**entity_ids 查询约定**：存储格式为 `,zhangsan_id,projectA_id,`（首尾加逗号），查询时用：

```sql
WHERE ',' || entity_ids || ',' LIKE '%,' || ? || ',%'
```

避免 ID 子串匹配风险。例如 `,abc-zhangsan_id-xyz,` 不会误匹配 `zhangsan_id` 的查询。

### 4.5 Fact 表（事实条目）

```sql
CREATE TABLE facts (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  content             TEXT NOT NULL,
  source              TEXT NOT NULL DEFAULT 'user_said',
  source_detail       TEXT,                  -- 来源详情（如 session id / tool call id）
  conflict_tag        INTEGER DEFAULT 0,
  version             INTEGER DEFAULT 1,
  is_latest           INTEGER DEFAULT 1,
  scene_tag           TEXT NOT NULL DEFAULT '',
  related_entity_ids  TEXT,                  -- 逗号前后加逗号
  creator             TEXT,                  -- agent id
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX idx_facts_latest ON facts(is_latest);
CREATE INDEX idx_facts_scene ON facts(scene_tag);
CREATE INDEX idx_facts_updated ON facts(updated_at DESC);
CREATE INDEX idx_facts_version ON facts(title, version);
```

**source 枚举**：

| source | 含义 |
|--------|------|
| `user_said` | 用户直接说出 |
| `agent_discovered` | Agent 自己推断 |
| `rag_import` | 从外部文档提取 |
| `sub_agent` | 子 Agent 执行产出 |
| `agent_team` | 团队协作产出 |
| `manual` | 手动输入 |
| `user_correction` | 用户纠错（最高优先级） |

### 4.6 RelationChanges 表（关系变更追踪）

```sql
CREATE TABLE relation_changes (
  id          TEXT PRIMARY KEY,
  subject_id  TEXT NOT NULL,
  relation    TEXT NOT NULL,
  old_value   TEXT,                        -- 变更前的**实体ID**（不是名称）
  new_value   TEXT NOT NULL,               -- 变更后的实体ID
  reason      TEXT,                        -- 变更原因（用户说的原文摘要）
  scene_tag   TEXT NOT NULL DEFAULT '',
  changed_at  INTEGER NOT NULL,
  operator    TEXT                         -- user | agent | agent_team
);

CREATE INDEX idx_relchanges_subject ON relation_changes(subject_id, relation, changed_at DESC);
CREATE INDEX idx_relchanges_time ON relation_changes(changed_at DESC);
```

**设计说明**：
- `old_value` / `new_value` 存储的是**实体 ID**（UUID），不是实体名称
- 通过 JOIN entities 表获取名称：`SELECT e1.name AS old_name, e2.name AS new_name FROM relation_changes rc JOIN entities e1 ON e1.id = rc.old_value JOIN entities e2 ON e2.id = rc.new_value`
- 使用 ID 而不是名称，避免了实体重命名后变更历史指向不存在的名称的问题
- 代价是每次查询需要多一次 JOIN。变更历史查询频率低，可接受

**查询示例**："项目A的技术栈变更历史"

```sql
SELECT e1.name AS old_value, e2.name AS new_value, rc.reason, rc.changed_at
FROM relation_changes rc
LEFT JOIN entities e1 ON e1.id = rc.old_value
JOIN entities e2 ON e2.id = rc.new_value
WHERE rc.subject_id = 'projectA_id' AND rc.relation = '使用'
ORDER BY rc.changed_at DESC;
```

### 4.7 ProjectSnapshots 表（项目状态快照）

```sql
CREATE TABLE project_snapshots (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES entities(id),
  phase           TEXT NOT NULL DEFAULT '开发',
  status          TEXT NOT NULL DEFAULT '进行中',
  progress_pct    INTEGER NOT NULL DEFAULT 0,
  current_focus   TEXT,                    -- 当前工作重点
  blockers        TEXT,                    -- 阻塞项
  next_milestone  TEXT,                    -- 下个里程碑
  tech_stack      TEXT,                    -- 当前技术栈摘要（自动更新）
  snapshot_at     INTEGER NOT NULL
);

CREATE INDEX idx_snapshots_project ON project_snapshots(project_id, snapshot_at DESC);
```

**phase 枚举**：`需求分析`、`设计`、`开发`、`测试`、`部署`、`维护`

**status 枚举**：`进行中`、`暂停`、`已完成`、`已取消`

### 4.8 Episodes 表（叙事记忆）

存储完整情节叙事，用于用户回忆"记得上次那件事"的场景。

```sql
CREATE TABLE episodes (
  id           TEXT PRIMARY KEY,
  timestamp    INTEGER NOT NULL,             -- 事件结束时间
  title        TEXT NOT NULL,                -- 一句话标题（用于 prompt 注入）
  narrative    TEXT NOT NULL,                -- 完整叙事文本（300-2000 字）
  scene_tag    TEXT NOT NULL DEFAULT '',
  importance   INTEGER NOT NULL DEFAULT 3,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE episode_entities (
  episode_id  TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  entity_id   TEXT NOT NULL REFERENCES entities(id),
  PRIMARY KEY (episode_id, entity_id)
);

CREATE INDEX idx_episodes_time ON episodes(timestamp DESC);
CREATE INDEX idx_episodes_scene ON episodes(scene_tag);
CREATE INDEX idx_episodes_importance ON episodes(importance DESC);
CREATE INDEX idx_episode_entities_entity ON episode_entities(entity_id);
```

**设计说明**：
- `episodes.narrative` 存 300-2000 字的连贯情节文本，不拆成结构化字段
- `episode_entities` 多对多关联到 entities 表，支持"按实体找相关叙事"
- 叙事文本的语义搜索复用 Part-5 的 SemanticIndex（narrative 也生成 embedding 加入索引）

### 4.9 数据模型总览（8 表）

```
基础 4 表:
  entities           → 节点（人/项目/工具/偏好/概念）
  relations          → 有向边（熟练使用/负责/偏好），带 is_active 软删除
  events             → 时序事件（完成了什么）
  facts              → 事实条目（带版本管理）

派生 2 表:
  relation_changes   → 关系变更历史（JWT→RSA 等偏好切换）
  project_snapshots  → 项目状态快照（进度、阶段、阻塞项）

叙事 2 表:
  episodes           → 情节叙事
  episode_entities   → 叙事↔实体多对多关联

全文索引:
  memory_fts         → FTS5 全文索引
```

### 5.1 Entity 操作

```typescript
interface EntityInput {
  name: string;
  type: 'user' | 'project' | 'tool' | 'preference' | 'concept' | 'organization';
  summary: string;
  belief?: string;
  scene_tag?: string;
  importance?: number;
}

class MemoryManager {
  /** 创建或更新实体（按 name + type 去重，受 UNIQUE 约束保护） */
  async upsertEntity(input: EntityInput): Promise<Entity>;

  /** 批量查询 */
  async searchEntities(options: {
    type?: string | string[];
    scene?: string;
    keyword?: string;
    limit?: number;
  }): Promise<Entity[]>;

  /** 删除实体（级联删除关联的 relations/events/facts 引用） */
  async deleteEntity(id: string): Promise<void>;
}
```

### 5.2 Relation 操作

```typescript
interface RelationInput {
  /** 主体实体名称（按 name+type 自动查找） */
  subject_name: string;
  /** 客体实体名称（按 name+type 自动查找） */
  object_name: string;
  /** 关系类型 */
  relation: string;
  /** 关联强度 1-5 */
  strength?: number;
  scene_tag?: string;
}

/**
 * 当调用方已有实体 ID 时，直接传 ID 避免二次查询。
 * subjectId / objectId 的优先级高于 subject_name / object_name。
 */
interface RelationInputById extends RelationInput {
  /** 主体实体 ID（可选，有则跳过按名称查找） */
  subject_id?: string;
  /** 客体实体 ID（可选，有则跳过按名称查找） */
  object_id?: string;
}

class MemoryManager {
  /** 创建关系（自动查找/创建 subject/object 实体）。新创建的关系默认 is_active=1 */
  async relate(input: RelationInput): Promise<Relation>;

  /** 将旧关系标记为 is_active=0（软删除），同时写入 relation_changes */
  async deactivateRelation(subjectId: string, objectId: string, relation: string, reason?: string): Promise<void>;

  /** 获取某个实体的所有活跃关系 */
  async getRelations(entityId: string, options?: {
    direction?: 'outgoing' | 'incoming' | 'both';
    relation?: string;
    activeOnly?: boolean;  // 默认 true
  }): Promise<Relation[]>;

  /** 物理删除关系（不推荐，优先用 deactivateRelation） */
  async deleteRelation(id: string): Promise<void>;
}
```

### 5.3 Event 操作

```typescript
interface EventInput {
  entityNames: string[];
  content: string;
  result?: string;
  importance?: number;
  scene_tag?: string;
  operator?: string;
}

class MemoryManager {
  /** 记录事件。事件入库后自动触发派生状态推演（tryUpdateProjectStatus / tryTrackPreferenceChange） */
  async recordEvent(input: EventInput): Promise<Event>;

  /** 查询时间线 */
  async getTimeline(options: {
    entityNames?: string[];
    scene?: string;
    from?: number;
    to?: number;
    limit?: number;
  }): Promise<Event[]>;
}
```

### 5.4 Fact 操作

```typescript
interface FactInput {
  title: string;
  content: string;
  source?: string;
  scene_tag?: string;
  relatedEntityNames?: string[];
}

class MemoryManager {
  /** 创建事实（自动版本管理，同名 title 自动 version+1） */
  async storeFact(input: FactInput): Promise<Fact>;

  /** 更新事实（创建新版本，旧版 is_latest=0） */
  async updateFact(title: string, input: Partial<FactInput>): Promise<Fact>;

  /** 回滚到指定版本 */
  async rollbackFact(title: string, version: number): Promise<Fact>;

  /** 搜索事实 */
  async searchFacts(options: {
    keyword?: string;
    scene?: string;
    isLatest?: boolean;
    limit?: number;
  }): Promise<Fact[]>;
}
```

---

## 6. FTS5 全文索引

### 6.1 虚拟表定义

```sql
CREATE VIRTUAL TABLE memory_fts USING fts5(
  source_table,    -- 'entities' | 'facts' | 'events'
  source_id,
  title,
  content,
  scene_tag,
  tokenize='unicode61'
);
```

### 6.2 同步触发器

以 entities 为例。facts 和 events 建立相似触发器。

```sql
CREATE TRIGGER entities_fts_insert AFTER INSERT ON entities BEGIN
  INSERT INTO memory_fts(source_table, source_id, title, content, scene_tag)
  VALUES ('entities', new.id, new.name, new.summary, new.scene_tag);
END;

CREATE TRIGGER entities_fts_delete AFTER DELETE ON entities BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, source_table, source_id, title, content, scene_tag)
  VALUES ('delete', old.rowid, 'entities', old.id, old.name, old.summary, old.scene_tag);
END;

CREATE TRIGGER entities_fts_update AFTER UPDATE ON entities BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, source_table, source_id, title, content, scene_tag)
  VALUES ('delete', old.rowid, 'entities', old.id, old.name, old.summary, old.scene_tag);
  INSERT INTO memory_fts(source_table, source_id, title, content, scene_tag)
  VALUES ('entities', new.id, new.name, new.summary, new.scene_tag);
END;
```

### 6.3 搜索安全

FTS5 的查询语法含特殊字符（AND, OR, NOT, ""），需要对用户输入做转义：

```typescript
function sanitizeFTS5(input: string): string {
  return input
    .replace(/['"]/g, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => `"${w}"`)
    .join(' AND ');
}
```

FTS5 的结果也可以用于查重。Part-3 的 `checkDuplicate` 可以用 FTS5 `snippet()` 替代粗糙的 Jaccard 相似度：

```sql
-- FTS5 近似匹配查重（示例）
SELECT source_id, content, rank
FROM memory_fts
WHERE content MATCH '"Docker Compose" AND "喜欢"'
ORDER BY rank LIMIT 1;
```

---

## 7. 版本管理与回滚

### 7.1 更新事实（创建新版本）

```sql
BEGIN TRANSACTION;
  UPDATE facts SET is_latest = 0, updated_at = ? WHERE title = ? AND is_latest = 1;
  INSERT INTO facts (id, title, content, source, version, is_latest, scene_tag, created_at, updated_at)
  VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(version), 0) + 1 FROM facts WHERE title = ?), 1, ?, ?, ?);
COMMIT;
```

### 7.2 回滚到指定版本

```sql
BEGIN TRANSACTION;
  UPDATE facts SET is_latest = 0 WHERE title = ? AND is_latest = 1;
  UPDATE facts SET is_latest = 1 WHERE title = ? AND version = ?;
COMMIT;
```

### 7.3 级联删除

Relation 表通过 `ON DELETE CASCADE` 确保删除 Entity 时自动删除关联的 Relation。

Event 和 Fact 不会自动级联——这是有意为之：事件和事实包含历史信息，即使关联的实体被删除，事件本身仍有参考价值。清理通过定时维护任务完成。

---

## 8. Schema 迁移策略

`MemoryManager.initDB()` 在启动时创建 `schema_version` 表，检查并执行迁移。

```sql
-- schema 版本管理表
CREATE TABLE IF NOT EXISTS schema_version (
  version   INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

迁移函数示例：

```typescript
async function migrate(db: Database): Promise<void> {
  const currentVersion = db.prepare(
    'SELECT COALESCE(MAX(version), 0) as v FROM schema_version'
  ).get() as { v: number };

  if (currentVersion.v < 1) {
    // v1: 初始建表（6 张表 + FTS5 + 索引）
    db.exec(`CREATE TABLE IF NOT EXISTS entities (...) ...`);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (1, ?)').run(Date.now());
  }

  if (currentVersion.v < 2) {
    // v2: 新增 is_active 列（如果从旧版本升级）
    db.exec(`ALTER TABLE relations ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (2, ?)').run(Date.now());
  }

  if (currentVersion.v < 3) {
    // v3: 新增 project_snapshots 表
    db.exec(`CREATE TABLE IF NOT EXISTS project_snapshots (...) ...`);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (3, ?)').run(Date.now());
  }

  if (currentVersion.v < 4) {
    // v4: 新增 episodes / episode_entities 表
    db.exec(`
      CREATE TABLE IF NOT EXISTS episodes ( ... );
      CREATE TABLE IF NOT EXISTS episode_entities ( ... );
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (4, ?)').run(Date.now());
  }

  if (currentVersion.v < 5) {
    // v5: events 表新增 reminded_at 列 + 周年索引
    db.exec(`
      ALTER TABLE events ADD COLUMN reminded_at INTEGER;
      CREATE INDEX IF NOT EXISTS idx_events_md ON events(strftime('%m-%d', time / 1000, 'unixepoch'));
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (5, ?)').run(Date.now());
  }

  if (currentVersion.v < 6) {
    // v6: 新增 scheduler_log 表
    db.exec(`
      CREATE TABLE IF NOT EXISTS scheduler_log (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id        TEXT NOT NULL,
        scheduled_at  INTEGER NOT NULL,
        executed_at   INTEGER NOT NULL,
        status        TEXT DEFAULT 'ok'
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduler_log_dedup ON scheduler_log(job_id, scheduled_at);
    `);
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (6, ?)').run(Date.now());
  }
}
```

每次升级增加一个 `schema_version` 记录。通过检查当前版本号决定是否执行迁移。迁移失败在日志中记录，不阻止应用启动（旧版本 schema 仍可读写）。
