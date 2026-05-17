# 记忆系统改造实施计划

> **目标**：在 xuanji 中实现完整的记忆系统（SQLite 存储 + 语义搜索 + 叙事记忆 + 自主学习 + 定时任务 + 日常关怀）
>
> **前提**：设计阶段已完成（`docs/` 目录中 11 篇设计文档 + `src/core/memory/MemoryGraph.ts` 已实现）
>
> **分支**：`feature/memory-system`

---

## 总览：依赖关系图

```
Phase 1: 基础设施层（无外部依赖）
  types.ts ← 所有后续模块依赖
  MemoryManager (CRUD + DDL) ← 基础读写

Phase 2: 工具层（依赖 Phase 1）
  MemorySearchTool —— 依赖 MemoryManager.search()
  MemoryStoreTool  —— 依赖 MemoryManager.handleEventFromAgent()
  SkillLoader 更新  —— 加载 learned/installed 目录

Phase 3: 语义层（依赖 Phase 1）
  SemanticIndex —— 独立 ONNX 封装
  EpisodicMemory —— 依赖 SemanticIndex + MemoryManager.db

Phase 4: Agent 集成（依赖 Phase 1 + Phase 2 + Phase 3）
  LayeredPromptBuilder 集成 —— buildContext()
  ChatSession Hook —— finally 提取 + PostToolUse
  AgentLoop —— SubAgentResultStore
  l0-base-memory-guide.yaml —— 工具说明
  xuanji.yaml —— tools 白名单
  ContextManager —— setArchiveDelegate()

Phase 5: 高级功能（依赖 Phase 1 + Phase 3 + Phase 4）
  CareManager —— 时间感知 + 纪念日
  Scheduler —— 定时任务 + 空闲检测
  SubAgentResultStore —— ACP 结果归档

Phase 6: 自学与安装（依赖 Phase 1–5 全部）
  LearnEngine —— 搜索 + 提取 + MCP 生成
  LearnTool —— Agent 接口
  InstallTool —— 搜索 + 安装
```

---

## Phase 0：现有文件检查（~10 分钟）

**无需编码，确认基础设施就绪即可。**

| 检查项 | 文件 | 预期状态 |
|--------|------|---------|
| MemoryGraph.ts 已实现 | `src/core/memory/MemoryGraph.ts` | ✅ 已完成（508 行） |
| PathManager 有 memory 路径 | `src/core/config/PathManager.ts` | ✅ `getUserMemoryDir()` / `getUserMemoryPath()` 已实现 |
| EventBus 单例 | `src/core/events/EventBus.ts` | ✅ 全局 `eventBus` 单例 |
| XuanjiEvent 枚举 | `src/core/events/events.ts` | 需要新增 memory 相关事件 |
| Embedding 模型 | `@xenova/transformers` | ✅ 已在依赖中 |
| SQLite 依赖 | `better-sqlite3` | ✅ 已在依赖中 |
| DependencyContainer | `src/core/di/...` | ✅ 已有 DI 容器 |
| ContextManager.ArchiveDelegate | `src/core/context/ContextManager.ts` | ✅ 接口已定义 |
| PromptComponentRegistry | `src/core/prompt/PromptComponentRegistry.ts` | ✅ 已有 |
| SkillRegistry | `src/core/skills/registry.ts` | ✅ 已有 |

**验证命令**：
```bash
cd /Users/kevinshi/Documents/workspace/codebase/shibit/xuanji
npm ls better-sqlite3 2>/dev/null | head -3
grep -c "xenova\|transformers" package.json
grep "memory" src/core/config/PathManager.ts
```

---

## Phase 1：类型定义 + 数据库 CRUD（依赖：Phase 0）

### 1.1 定义记忆系统类型

**文件**：
- 创建 `src/core/memory/types.ts`（~100 行）

**设计文档**：`docs/memory-system-part-1-storage.md` §4（数据模型详解）、§5（CRUD 接口设计）

**核心类型清单**：

| 类型 | 说明 |
|------|------|
| `Entity` / `EntityInput` | 实体（人、项目、工具等） |
| `Fact` / `FactInput` | 事实陈述（可版本化） |
| `Event` / `EventInput` | 事件（含 entity_names 字段） |
| `Relation` / `RelationInput` | 实体间关系（is_active 支持软删） |
| `RelationChange` | 关系变更追溯 |
| `ProjectSnapshot` | 项目状态快照 |
| `Episode` | 叙事记忆 |
| `CronJob` | 定时任务定义（定义在 `src/core/scheduler/types.ts`，见 §1.3） |
| `MemorySearchOptions` / `MemorySearchResult` | 搜索接口 |
| `MemoryStats` | 统计信息 |

**注意事项**：
- `EventInput.entityNames` 是名称数组，`MemoryManager.recordEvent()` 内部解析为 `entity_ids` 逗号格式
- `Fact` 支持版本管理：`storeFact()` 写入时对比 `superseded_at` 旧版本
- `Relation` 用 `is_active` 支持软删除，`relation_changes` 记录变更历史
- Scene tag 格式：`,开发,`（首尾逗号填充），查询用 `LIKE '%,开发,%'`

---

### 1.2 实现 MemoryManager 核心类

**文件**：
- 创建 `src/core/memory/MemoryManager.ts`（~800 行）

**设计文档**：
- `docs/memory-system-part-1-storage.md` §4（数据模型详解：8 表 DDL）、§5（CRUD 接口）、§6（FTS5）
- `docs/memory-system-part-3-integration.md` §1（类结构 + 构造函数）
- `docs/memory-system-part-3-integration.md` §2（派生推演）

**方法实现顺序**（每个方法 10-30 行 SQL，TDD）：

#### Step 1: initDB() — DDL 建表

实现 Part-1 §1 的全部 8 张表：
- `entities`, `facts`, `events`, `relations`, `relation_changes`, `project_snapshots`, `episodes`, `episode_entities`
- `memory_fts` 虚拟表（FTS5）
- `scheduler_log` 表
- 所有索引 + 迁移逻辑（v1–v6）

```sql
-- 关键：FTS5 覆盖 events.content + entities.name/summary + facts.value，带 scene_tag 按场景过滤
-- 设计文档 Part-1 §6.1：5 列 (source_table, source_id, title, content, scene_tag)
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  source_table, source_id, title, content, scene_tag,
  tokenize='unicode61'
);
```

#### Step 2: Entity CRUD

- `upsertEntity(input: EntityInput): Promise<Entity>`
- `getEntity(id: string): Promise<Entity | null>`
- `searchEntities(query: string, type?: string): Promise<Entity[]>`

#### Step 3: Fact CRUD

对齐设计文档 Part-1 §5.2：
- `storeFact(input: FactInput): Promise<Fact>`
- `updateFact(title: string, input: Partial<FactInput>): Promise<Fact>`
- `rollbackFact(title: string, version: number): Promise<Fact>`
- `searchFacts(filter?: { name?: string; type?: string; tags?: string[]; limit?: number }): Promise<Fact[]>`

#### Step 4: Event CRUD

- `recordEvent(input: EventInput): Promise<Event>`
- `getTimeline(options): Promise<Event[]>`

#### Step 5: Relation CRUD

对齐设计文档 Part-1 §5.2（Relation CRUD：relate / deactivateRelation / getRelations）：
- `relate(input: RelationInput): Promise<Relation>`
- `deactivateRelation(subjectId: string, objectId: string, relation: string, reason?: string): Promise<void>`
- `getRelations(entityId: string, options?: { activeOnly?: boolean; type?: string }): Promise<Relation[]>`

#### Step 6: 派生状态推演

设计文档 Part-3 §2.4–§2.5：
- `tryUpdateProjectStatus(event) `— 从事件内容检测进度变化
- `tryTrackPreferenceChange(event)` — 从用户纠正中检测偏好变更

方法放在 MemoryManager.ts 内，通过规则引擎（正则 + 关键词）而非 LLM。

#### Step 7: FTS5 search 方法

设计文档 Part-2 §1：
```typescript
async search(options: MemorySearchOptions): Promise<MemorySearchResult[]>
```

支持按 `source` 类型搜索 entities/facts/events/episodes。

#### Step 8: ArchiveDelegate 接口实现

设计文档 Part-6 §1：
```typescript
async archiveMessages(messages: Message[]): Promise<void>
```

**测试策略**：
- 每个 CRUD 方法一个测试（`test/unit/memory/MemoryManager.test.ts`）
- `beforeEach`：创建一个内存 SQLite 数据库（`new Database(':memory:')`）
- `afterEach`：关闭数据库

---

### 1.3 定义 CronJob 类型（归入 scheduler/types.ts，与 Phase 5.2 共用）

**文件**：
- 创建 `src/core/scheduler/types.ts`（~30 行），作为 CronJob 的唯一权威定义

Phase 5.2 的 Scheduler 类引用 `src/core/scheduler/types.ts`，不再在 memory/types.ts 中定义 CronJob。

```typescript
// src/core/scheduler/types.ts — 定时任务类型定义，唯一的权威位置
export interface CronJob {
  id: string;
  userId: string;
  type: 'daily' | 'weekly' | 'once';
  hour?: number;
  minute?: number;
  dayOfWeek?: number;
  scheduledAt?: number;
  action: 'learn' | 'custom';
  params?: Record<string, any>;
  prompt?: string;
  enabled?: boolean;
  executed?: boolean;
}
```

---

## Phase 2：Agent 工具（依赖：Phase 1）

### 2.1 MemorySearchTool

**文件**：
- 创建 `src/core/tools/MemorySearchTool.ts`（~100 行）

**设计文档**：`docs/memory-system-part-3-integration.md` §4.2

实现一个 BaseTool 子类，包装 `MemoryManager.search()`：
- 参数：`query`、`type`（entity/fact/event/episode）、`scene_tag`、`limit`
- 返回：格式化的记忆段落数组
- 注入 `memoryManager` 依赖

### 2.2 MemoryStoreTool

**文件**：
- 创建 `src/core/tools/MemoryStoreTool.ts`（~150 行）

**设计文档**：`docs/memory-system-part-3-integration.md` §4.1，§5.3

实现一个 BaseTool 子类：
- 参数：`type`（entity/fact/event/relation）、`content`、`importance`、`scene_tag` 等
- 内部调用 `MemoryManager` 的对应方法
- **双重去重检测**：工具内部 `checkDuplicate()` + `wasMemoryStoredRecently()`

### 2.3 ToolRegistry 注册

**修改**：`src/core/tools/ToolRegistry.ts` 的 `createDefaultRegistry()` 函数

在已有工具列表末尾新增：
```typescript
import { MemorySearchTool } from './MemorySearchTool';
import { MemoryStoreTool } from './MemoryStoreTool';
// 在 createDefaultRegistry 函数内
registry.register(new MemorySearchTool());
registry.register(new MemoryStoreTool());
```

### 2.4 SkillLoader 扩展

**修改**：`src/core/skills/loader.ts`

新增两个目录扫描：
```typescript
const learnedDir = join(getUserRoot(userId), 'skills', 'learned');
const installedDir = join(getUserRoot(userId), 'skills', 'installed');
```

---

## Phase 3：语义搜索 + 叙事记忆（依赖：Phase 1）

### 3.1 SemanticIndex

**文件**：
- 创建 `src/core/memory/SemanticIndex.ts`（~200 行）

**设计文档**：`docs/memory-system-part-5-semantic-search.md` §1–§4

核心接口：
```typescript
class SemanticIndex {
  async embed(text: string): Promise<number[]>;
  async search(query: string, limit: number): Promise<SearchResult[]>;
  async index(sourceId: string, sourceTable: string, text: string): Promise<void>;
  async remove(sourceId: string): Promise<void>;

  // 用于 EpisodicMemory
  async searchEpisodes(query: string, limit: number): Promise<SearchResult[]>;
  async indexEpisode(episodeId: string, narrative: string): Promise<void>;
}
```

使用 `@xenova/transformers` 加载 `paraphrase-multilingual-MiniLM-L12-v2`：
```typescript
import { pipeline } from '@xenova/transformers';
const extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
```

持久化策略：
- `embeddings.data`：扁平 float32 数组
- `embeddings.idx`：JSON 索引 `{sourceId, sourceTable, offset, length}`
- 写时持久化：`index()` 后追加到磁盘
- 重启时加载：`init()` 从磁盘完全加载到内存

**注意事项**：
- `pipeline()` 首次调用会下载模型（~90MB），缓存到 HuggingFace 缓存目录
- `embed()` 返回 384 维向量
- 后续搜索用余弦相似度 `cosineSimilarity(vec1, vec2)`

### 3.2 EpisodicMemory

**文件**：
- 创建 `src/core/memory/EpisodicMemory.ts`（~200 行）

**设计文档**：`docs/memory-system-part-7-episodic.md` §1–§6

核心方法：
```typescript
class EpisodicMemory {
  async search(query: string, limit?: number): Promise<Episode[]>;
  async findByEntity(entityId: string, limit?: number): Promise<Episode[]>;
  async findByEvent(eventId: string, limit?: number): Promise<Episode[]>;
  async createFromMessages(messages: Message[]): Promise<Episode>;
  async createFromTaskSequence(tasks: TaskResult[]): Promise<Episode>;
  async createFromLearning(input: LearnInput): Promise<Episode>;
  private searchByFTS(query: string, limit: number): Episode[];
}
```

**设计要点**：
- `search()` 先尝试 `SemanticIndex.searchEpisodes()`，fallback 到 `searchByFTS()`
- `findByEvent()` 通过 `events.entity_ids` 字段解析实体 → 再通过 `episode_entities` 查 episode
- `createFromMessages()` 在 ContextManager 压缩时调用，记录关键对话为叙事
- 叙事存储在 `episodes` + `episode_entities` 表中

---

## Phase 4：Agent 集成（依赖：Phase 1 + Phase 2 + Phase 3）

### 4.1 ContextManager 集成 ArchiveDelegate

**修改**：`src/core/context/ContextManager.ts`

设计文档：Part-3 §2.6（会话结束提取）、Part-6 §1（归档）

在 `ChatSession.run()` 的 `finally` 块中调用：
```typescript
// ChatSession.ts finally 块
if (this.memoryManager) {
  // 异步提取，不阻塞主流程
  this.memoryManager.extractFromSession(this.messages).catch(err =>
    log.error('Session memory extraction failed:', err)
  );
}
```

ContextManager 压缩时：
```typescript
// ContextManager.compress() 中
if (this.archiveDelegate) {
  const oldMessages = this.messages.slice(0, keepCount);
  await this.archiveDelegate.archiveMessages(oldMessages);
}
```

### 4.2 LayeredPromptBuilder 集成 buildContext()

**修改**：`src/core/prompt/LayeredPromptBuilder.ts`

设计文档：Part-2 §3（prompt 注入）

构造函数新增 `memoryManager` 参数（可选）：
```typescript
constructor(
  userId?: string,
  projectRoot?: string,
  agentId?: string,
  _options?: unknown,
  private memoryManager?: MemoryManager,  // 新增
)
```

`build()` 方法末尾注入 L0 记忆块：
```typescript
if (this.memoryManager) {
  const context = await this.memoryManager.buildContext({ scene });
  if (context) {
    parts.push(context);  // 追加到 prompt 末尾
  }
}
```

### 4.3 SessionFactory 注入依赖

**修改**：`src/core/chat/SessionFactory.ts`

在 `create()` 方法中初始化 MemoryManager 并注入到各模块：
```typescript
// 初始化 MemoryManager
const memoryManager = new MemoryManager(
  getUserMemoryPath(userId),
  cheapLLM,
  hookRegistry,
  // subAgentStore,
  // episodicMemory,
  // semanticIndex,
  // ...
);
await memoryManager.init();

// 注入到 ContextManager
contextManager.setArchiveDelegate(memoryManager);

// 注入到 LayeredPromptBuilder
// 通过 DI 容器或直接参数
```

### 4.4 Prompt 模板更新

**修改**：
- `src/core/templates/prompts/l0-base-memory-guide.yaml`

将原有的 `<memory:event>` 等文本标记说明替换为 `memory_store` + `memory_search` 工具调用说明。

**修改**：
- `src/core/templates/agents/xuanji.yaml`

在 tools 白名单中新增：
```yaml
tools:
  - name: memory_search
  - name: memory_store
```

### 4.5 新增 XuanjiEvent 事件

**修改**：`src/core/events/events.ts`

设计文档：Part-3 §5（事件定义）
```typescript
export enum XuanjiEvent {
  // ... 已有事件

  // === Memory System ===
  MEMORY_STORED = 'memory:stored',
  MEMORY_SEARCHED = 'memory:searched',
  MEMORY_EXTRACTED = 'memory:extracted',
  MEMORY_MAINTENANCE = 'memory:maintenance',
  MEMORY_LEARNING_PROGRESS = 'memory:learning:progress',
  MEMORY_DELIVER_MESSAGE = 'deliver:message',
}
```

---

## Phase 5：高级功能（依赖：Phase 1 + Phase 3 + Phase 4）

### 5.1 CareManager（时间感知 + 纪念日）

**文件**：
- 创建 `src/core/memory/CareManager.ts`（~100 行）

**设计文档**：`docs/memory-system-part-9-daily-care.md` §3

```typescript
class CareManager {
  constructor(
    private db: Database,
    private episodicMemory?: EpisodicMemory,
  ) {}

  async buildDailyCare(): Promise<string | null> {
    // 查询今天的纪念日（events 表 month-day 匹配）
    // 标记 reminded_at 防重复
    // 如有叙事 → formatDailyCare()
  }

  buildTimeAwareness(lastActiveAt: number): string | null {
    // 30min 内 → null
    // 区间 → [时间感知：...]
  }
}
```

### 5.2 Scheduler（定时任务 + 空闲检测）

**文件**：
- 创建 `src/core/scheduler/types.ts`（~30 行）
- 创建 `src/core/scheduler/Scheduler.ts`（~200 行）

**设计文档**：`docs/memory-system-part-9-daily-care.md` §6

```typescript
class Scheduler {
  constructor(
    private db: Database,
    private sessionManager: SessionManager,
    private cheapLLM: ILLMProvider,
    private learnTool: LearnTool,
    private eventBus: EventBus,
    private activeUsers: Set<string> = new Set(),
    baseDir?: string,
  ) {}

  async start(): Promise<void> {
    this.jobs = this.loadJobs();
    await this.catchUpMissedJobs();  // 补执行
    // 调度未来的任务
    // 启动空闲检测（30min 间隔）
  }

  async addCron(job: CronJob): Promise<void>;
  stop(): void;

  private catchUpMissedJobs(): Promise<void>;
  private scheduleJob(job: CronJob): void;
  private async executeJob(job: CronJob, runTime: number): Promise<void>;
  private async checkIdle(): Promise<void>;
}
```

### 5.3 SubAgentResultStore

**文件**：
- 创建 `src/core/memory/SubAgentResultStore.ts`（~150 行）

**设计文档**：`docs/memory-system-part-6-archiving.md` §2–§3

将子 Agent 执行结果（`onToolEnd` 回调）持久化到 JSONL：
```
~/.xuanji/users/{userId}/memory/subagent_results/
├── {sessionId}_001.jsonl
├── {sessionId}_002.jsonl
└── ...
```

实现 `SubAgentResultStore` 接口：
```typescript
interface SubAgentResultStore {
  store(result: SubAgentResult): Promise<void>;
  search(query: string, limit?: number): Promise<SubAgentResult[]>;
}
```

---

## Phase 6：自学与安装（依赖：Phase 1–5 全部）

### 6.1 LearnEngine（搜索 + 提取 + MCP 生成）

**文件**：
- 创建 `src/core/learn/LearnEngine.ts`（~500 行）

**设计文档**：`docs/memory-system-part-8-self-learning.md` §1–§5

```typescript
class LearnEngine {
  async execute(goal: string, depth: 'shallow' | 'moderate' | 'deep'):
    Promise<LearningResult>;

  private async searchWeb(goal: string): Promise<SearchResult[]>;
  private async extractApiSpec(goal: string): Promise<ApiSpec | null>;
  private async generateMCP(spec: ApiSpec): Promise<void>;
  private async generateSkill(...): Promise<void>;
  private async checkMissingTools(required: string[]): Promise<void>;
}
```

### 6.2 LearnTool（Agent 接口）

**文件**：
- 创建 `src/core/tools/LearnTool.ts`（~400 行）

**设计文档**：`docs/memory-system-part-8-self-learning.md` §6

BaseTool 子类：
- 包装 LearnEngine
- 参数：`goal`、`depth`、`scene_tag`
- 流程：learn → checkMissingTools → auto-install MCP → 生成 Skill → 注册 + 持久化
- 发送 `learning:progress` 事件到 EventBus

### 6.3 InstallTool（外部插件安装）

**文件**：
- 创建 `src/core/tools/InstallTool.ts`（~200 行）

**设计文档**：`docs/plugin-system.md`

BaseTool 子类：
- 搜索外部 MCP 服务器 / Skill（通过 PluginSearchService 接口）
- 安装 MCP：写入 `mcp.json` + 下载 server.js → MCPManager.reload()
- 安装 Skill：下载 YAML → 写入 `skills/installed/` → SkillRegistry.register()

---

## 文件改动完整清单

### 新建文件（13 个）

| 文件 | 阶段 | 预估行数 |
|------|------|---------|
| `src/core/memory/types.ts` | Phase 1 | 100 |
| `src/core/memory/MemoryManager.ts` | Phase 1 | 800 |
| `src/core/tools/MemorySearchTool.ts` | Phase 2 | 100 |
| `src/core/tools/MemoryStoreTool.ts` | Phase 2 | 150 |
| `src/core/memory/SemanticIndex.ts` | Phase 3 | 200 |
| `src/core/memory/EpisodicMemory.ts` | Phase 3 | 200 |
| `src/core/memory/CareManager.ts` | Phase 5 | 100 |
| `src/core/memory/SubAgentResultStore.ts` | Phase 5 | 150 |
| `src/core/scheduler/types.ts` | Phase 5 | 30 |
| `src/core/scheduler/Scheduler.ts` | Phase 5 | 200 |
| `src/core/learn/LearnEngine.ts` | Phase 6 | 500 |
| `src/core/tools/LearnTool.ts` | Phase 6 | 400 |
| `src/core/tools/InstallTool.ts` | Phase 6 | 200 |

**总计：约 3,130 行新代码**

### 修改文件（10 个）

| 文件 | 改动 | 阶段 |
|------|------|------|
| `src/core/tools/ToolRegistry.ts` | 注册 MemorySearchTool、MemoryStoreTool、LearnTool、InstallTool | Phase 2 |
| `src/core/skills/loader.ts` | 加载 learned/installed 目录 | Phase 2 |
| `src/core/events/events.ts` | 新增 memory 事件枚举 | Phase 4 |
| `src/core/context/ContextManager.ts` | 集成 ArchiveDelegate（已有接口，需确认调用） | Phase 4 |
| `src/core/prompt/LayeredPromptBuilder.ts` | 构造函数新增 memoryManager 参数，build() 调 buildContext() | Phase 4 |
| `src/core/chat/ChatSession.ts` | finally 块调 extractFromSession + recordToolCall | Phase 4 |
| `src/core/chat/SessionFactory.ts` | DI 注入 MemoryManager、Scheduler 等 | Phase 4 |
| `src/core/agent/AgentLoop.ts` | onToolEnd 触发 SubAgentResultStore | Phase 4 |
| `src/core/templates/prompts/l0-base-memory-guide.yaml` | 改为 tool call 说明 | Phase 4 |
| `src/core/templates/agents/xuanji.yaml` | tools 白名单新增 memory_search/memory_store | Phase 4 |

---

## 设计文档依赖索引

每个实现阶段需要参考的设计文档：

| 阶段 | 依赖设计文档 |
|------|-------------|
| Phase 1 | Part-1 §4（数据模型详解：entities/facts/events/relations 表）、§5（CRUD 接口）、§6（FTS5）；Part-3 §1（类结构）、§2（推演引擎） |
| Phase 2 | Part-3 §4（工具定义）、§5.3（MemoryStoreTool 去重） |
| Phase 3 | Part-5 §1–§4（SemanticIndex）；Part-7 §1–§6（EpisodicMemory） |
| Phase 4 | Part-2 §3（prompt 注入）；Part-3 §2.6（会话结束提取）、§5（事件）；Part-6 §1（归档） |
| Phase 5 | Part-9 §3（CareManager）、§6（Scheduler）；Part-6 §2–§3（SubAgentResultStore） |
| Phase 6 | Part-8 §1–§6（LearnTool + LearnEngine）；`docs/plugin-system.md` |

---

## 风险与注意事项

1. **SemanticIndex 模型下载**：首次加载 `pipeline()` 会下载 paraphrase-multilingual-MiniLM-L12-v2（~90MB）。确保 CI 和部署环境有网络。可用 `xenova/transformers` 的 cache 机制。

2. **MemoryManager 构造函数依赖多**：10 个参数全是 optional。SSessionFactory 中分步注入，先用 `new MemoryManager(dbPath)` 创建，再 `setSemanticIndex()` 等方式设值。

3. **SQLite 并发**：MemoryManager 使用 `better-sqlite3` 同步 API，单连接。因 Node.js 单线程，同一进程内多个 Agent 串行访问没问题。多进程场景（ACP 子进程）需各自连接。

4. **Scheduler 持久化路径**：`~/.xuanji/scheduler/jobs.json` 是全局路径，不是用户维度。设计文档用了 `path.join(homedir(), '.xuanji', 'scheduler')`，如果需要用户隔离需改为 `getUserRoot(userId)` 下。

5. **现有 XuanjiEvent 枚举**：`src/core/events/events.ts` 当前没有 memory 相关事件，Phase 4.5 需要新增。注意 `EventMap.ts` 也需要更新类型映射。

6. **工具白名单**：xuanji 通过 agent YAML 配置的 `tools` 字段做白名单过滤。Phase 2 创建新工具后，必须同步更新 `xuanji.yaml` 的 tools 列表，否则主 agent 无法调用。

7. **TDD 策略**：每个 CRUD 方法用 `:memory:` SQLite 数据库测试，不依赖文件系统。SemanticIndex 测试用 mock 数据替代真实 ONNX 模型。
