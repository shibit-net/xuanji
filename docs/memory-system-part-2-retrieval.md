# Xuanji 记忆系统 · 检索、图谱与注入

> 上一篇: [存储架构与数据模型](./memory-system-part-1-storage.md)
> 下一篇: [系统集成与实现](./memory-system-part-3-integration.md)

---

## 目录

1. [检索系统架构](#1-检索系统架构)
2. [三层检索策略](#2-三层检索策略)
3. [记忆拓扑图](#3-记忆拓扑图)
4. [MemoryGraph 查询 API](#4-memorygraph-查询-api)
5. [Prompt 注入机制](#5-prompt-注入机制)
6. [L0-memory 组件设计](#6-l0-memory-组件设计)
7. [检索与注入的完整流程](#7-检索与注入的完整流程)

---

## 1. 检索系统架构

### 1.1 总体流程

```
┌─ 用户输入 ─────────────────────────────────────┐
│ "帮我写一个SpringBoot注册接口，用JWT"             │
└────────────────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────┐
│  IntentAnalyzer                                │
│  scene = 'coding', entities = ['SpringBoot']   │
└────────────────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────┐
│  MemoryManager.buildContext(scene='coding')    │ ← 被动注入
├────────────────────────────────────────────────┤
│  1. 查 entities (type='preference', scene='开发')│
│  2. 查 facts (is_latest=1, scene='开发')       │
│  3. 格式化为 markdown 块                        │
└────────────────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────┐
│  LayeredPromptBuilder.build()                  │
│  L0: base-identity + base-memory-guide + ...   │
│  L1: l1-coding                                 │
│  L3: l3-project                                │
│  + L0-memory 注入块（来自 buildContext）         │
└────────────────────────────────────────────────┘
                        │
                        ▼
┌─ AgentLoop 执行中 ────────────────────────────┐
│  主 Agent 可主动调用 memory_search 工具         │ ← 主动检索
│  → 获取更详细的关系查询结果                      │
└────────────────────────────────────────────────┘
```

### 1.2 两种检索模式

| 模式 | 触发方式 | 数据量 | 延迟要求 | 实现 |
|------|---------|--------|---------|------|
| **被动注入** | build prompt 时自动注入 | ~300-1000 tokens | < 50ms | SQLite 索引查询 |
| **主动检索** | Agent 调用 memory_search | 任意 | 可接受 200ms | FTS5 + 关系查询 + 图查询 |

两种模式共享同一个 `MemoryDB`，无数据冗余。

---

## 2. 三层检索策略

### 2.1 第一层：L0 被动注入

**触发时机**：每次 `ChatSession.run()` 之前，`LayeredPromptBuilder.build()` 调用 `MemoryManager.buildContext()`

**查询逻辑**：

```typescript
async buildContext(options: {
  scene?: string;       // 当前场景（从 IntentAnalyzer 来）
  keyword?: string;     // 用户输入关键词
  maxTokens?: number;   // 限制注入大小，默认 500
}): Promise<string> {
  const parts: string[] = [];

  // 1. 用户核心画像 — 始终注入
  const preferences = this.db.prepare(`
    SELECT summary FROM entities
    WHERE type = 'preference'
    ORDER BY importance DESC, updated_at DESC
    LIMIT 5
  `).all() as { summary: string }[];

  if (preferences.length > 0) {
    parts.push('## 我对你的了解');
    for (const p of preferences) {
      parts.push(`- ${p.summary}`);
    }
  }

  // 2. 当前场景活跃事实
  if (options.scene) {
    const facts = this.db.prepare(`
      SELECT title, content FROM facts
      WHERE is_latest = 1 AND scene_tag LIKE ?
      ORDER BY updated_at DESC LIMIT 8
    `).all(`%,${options.scene},%`) as { title: string; content: string }[];

    if (facts.length > 0) {
      parts.push('## 相关事实');
      for (const f of facts) {
        parts.push(`- ${f.title}: ${f.content}`);
      }
    }
  }

  // 3. 按 token 预算截断
  const result = parts.join('\n');
  return result;
}
```

### 2.2 第二层：FTS5 全文搜索

**触发时机**：Agent 调用 `memory_search` 工具

**查询逻辑**：

```typescript
async search(query: string, options?: {
  scene?: string;
  types?: ('entity' | 'fact' | 'event')[];
  limit?: number;
}): Promise<SearchResult[]> {
  const limit = options?.limit ?? 10;

  // 1. FTS5 全文搜索（跨 entities + facts + events）
  const ftsResults = this.db.prepare(`
    SELECT source_table, source_id, title, content, scene_tag, rank
    FROM memory_fts
    WHERE memory_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(sanitizeFTS5(query), limit * 2) as FTS5Result[];

  // 2. 按类型获取完整记录
  const results: SearchResult[] = [];
  for (const fts of ftsResults) {
    switch (fts.source_table) {
      case 'entities': {
        const entity = this.getEntity(fts.source_id);
        if (entity) results.push({ type: 'entity', ...entity, score: fts.rank });
        break;
      }
      case 'facts': {
        const fact = this.getFact(fts.source_id);
        if (fact) results.push({ type: 'fact', ...fact, score: fts.rank });
        break;
      }
      case 'events': {
        const event = this.getEvent(fts.source_id);
        if (event) results.push({ type: 'event', ...event, score: fts.rank });
        break;
      }
    }
  }

  // 3. 场景过滤（使用 Part-1 约定的 ,scene, 格式精确匹配）
  if (options?.scene) {
    return results.filter(r => r.scene_tag?.includes(`,${options.scene},`));
  }

  return results.slice(0, limit);
}
```

### 2.3 第三层：关系查询 / 图查询

用 SQL 递归 CTE 实现的路径发现 —— 等价于 MemoryGraph.findPaths()：

```sql
WITH RECURSIVE path AS (
  -- 基例：直接关联
  SELECT r.subject_id, r.object_id, r.relation, r.strength,
         1 AS depth,
         r.subject_id || '→' || r.object_id AS path_str
  FROM relations r
  WHERE r.subject_id = 'zhangsan_id'

  UNION ALL

  -- 递归：多跳关联（防止环路）
  SELECT r.subject_id, r.object_id, r.relation, r.strength,
         p.depth + 1,
         p.path_str || '→' || r.object_id
  FROM path p
  JOIN relations r ON r.subject_id = p.object_id
  WHERE p.depth < 4
    AND instr(p.path_str, r.object_id) = 0
)
SELECT * FROM path
WHERE object_id = 'docker_id'
ORDER BY strength DESC, depth;
```

---

## 3. 记忆拓扑图

`MemoryGraph` 是一个可选的内存级缓存，在 SQLite 之上提供图查询能力。

### 3.1 设计定位

```
┌─────────────────────────────────────┐
│            Agent 查询层               │
│  memory_search / memory_graph_query  │
├─────────────────────────────────────┤
│         MemoryGraph（内存）            │
│  启动时从 SQLite 全量加载              │
│  写入时增量同步                        │
├─────────────────────────────────────┤
│         SQLite（持久化）              │
│  entities / relations / events / facts│
└─────────────────────────────────────┘
```

### 3.2 数据量估计

| 指标 | 1 个月 | 6 个月 | 1 年 | 3 年 |
|------|--------|--------|------|------|
| Entity | ~200 | ~800 | ~1500 | ~3000 |
| Relation | ~500 | ~2000 | ~5000 | ~10000 |
| 图内存占用 | ~150KB | ~600KB | ~1.5MB | ~3MB |

MemoryGraph 的内存占用在 3MB 内，完全可以常驻。

### 3.3 增量同步机制

```typescript
class MemoryManager {
  private graph: MemoryGraph;

  async upsertEntity(input: EntityInput): Promise<Entity> {
    const entity = await this.db.run(/* INSERT OR REPLACE */);
    this.graph.addNode(entity);     // ← 同步到内存图
    return entity;
  }

  async relate(input: RelationInput): Promise<Relation> {
    const relation = await this.db.run(/* INSERT */);
    this.graph.addEdge(relation);   // ← 同步到内存图
    return relation;
  }
}
```

---

## 4. MemoryGraph 查询 API

### 4.1 路径发现

```
输入: "张三 和 Docker 是怎么关联的？"
调用: MemoryGraph.findPaths('zhangsan_id', 'docker_id', 4)

结果:
  路径1: 张三 ──负责──→ 项目A ──使用──→ Docker  (2跳, 强度=8)
  路径2: 张三 ──熟练使用──→ Python ──依赖──→ Docker  (2跳, 强度=5)
```

```typescript
findPaths(fromId: string, toId: string, maxHops?: number): PathResult[];
```

### 4.2 子图提取

```
输入: "显示张三相关的整个生态"
调用: MemoryGraph.extractSubgraph('zhangsan_id', 2)

结果:
  节点: [张三(user), 项目A(project), Python(tool), Django(tool)]
  边: [张三→负责→项目A, 张三→熟练使用→Python, 项目A→使用→Django]
```

```typescript
extractSubgraph(centerId: string, maxHops?: number): SubgraphResult;
```

### 4.3 相似节点推理

```
输入: "跟张三技术栈类似的人"
调用: MemoryGraph.findSimilarNodes('zhangsan_id', {
  targetType: 'user',
  sharedNeighborTypes: ['tool'],
  minShared: 1
})

结果:
  [{node: 李四, sharedNeighbors: [Python, Docker], score: 2},
   {node: 王五, sharedNeighbors: [PostgreSQL], score: 1}]
```

```typescript
findSimilarNodes(nodeId: string, options?: {
  targetType?: string;
  sharedNeighborTypes?: string[];
  minShared?: number;
}): SimilarNodeResult[];
```

### 4.4 聚合统计

```
输入: "哪些工具被最多项目使用？"
调用: MemoryGraph.aggregateByRelation({
  subjectType: 'project',
  objectType: 'tool',
  minCount: 1
})

结果:
  [{node: Docker, connectedCount: 4, connectedNodes: [项目A, 项目B, ...]},
   {node: PostgreSQL, connectedCount: 3, ...}]
```

```typescript
aggregateByRelation(options: {
  subjectType?: string;
  objectType: string;
  relation?: string;
  minCount?: number;
}): AggregationResult[];
```

### 4.5 与 SQL 查询的边界

| 查询类型 | 用 MemoryGraph | 直接 SQL |
|----------|---------------|----------|
| 路径发现（A→B 多跳） | ✅ BFS O(E) | ❌ 递归 CTE 慢 |
| 子图提取（中心扩散） | ✅ BFS O(E) | ❌ 复杂 |
| 共享邻居推理 | ✅ 内存集合运算 | ❌ 多表多次 JOIN |
| 精确过滤（type/scene 条件） | ❌ | ✅ 索引直接命中 |
| 全文搜索 | ❌ | ✅ FTS5 |
| 聚合统计 | ✅ 内存计数 | ✅ SQL GROUP BY |

---

## 5. Prompt 注入机制

### 5.1 注入点

`LayeredPromptBuilder.build()` 是单一入口，修改量最小。

```typescript
// LayeredPromptBuilder.ts 中 build() 方法
async build(options: LayeredPromptBuildOptions = {}): Promise<PromptBuildResult> {
  const scene = options.scene;

  // 1. 现有的组件选择逻辑（不变）
  const selectedComponents = this.selectComponents(scene, complexity);

  // 2. 注入记忆块 ← 新增
  const memoryBlock = await this.memoryManager?.buildContext({
    scene: scene ?? undefined,
    keyword: options.userMessage,
  });

  const parts: string[] = [];
  if (memoryBlock) {
    parts.push(memoryBlock);
  }

  // 3. 渲染其余组件（不变）
  for (const component of selectedComponents) {
    const rendered = await component.render(context);
    if (rendered) parts.push(rendered);
  }

  return { prompt: parts.join('\n\n'), ... };
}
```

### 5.2 MemoryManager 注入到 LayeredPromptBuilder

构造函数新增参数：

```typescript
class LayeredPromptBuilder {
  constructor(
    userId?: string,
    projectRoot?: string,
    agentId?: string,
    _options?: unknown,
    private memoryManager?: MemoryManager,  // ← 新增
  ) {}
}
```

`SessionFactory` 创建时传入：

```typescript
const memoryManager = container.resolve<MemoryManager>('memoryManager');
const builder = new LayeredPromptBuilder(
  userId, projectRoot, agentId, undefined, memoryManager
);
```

### 5.3 注入内容格式

```markdown
## 我对你的了解
- 你叫张三，Python/Django 后端开发
- 你偏好 Docker Compose 开发环境
- 你用 JWT 做认证，密码用 bcrypt 加密

## 相关事实
- 项目A 使用 PostgreSQL 数据库，端口 5432
- 所有 SpringBoot 项目使用统一接口返回格式
```

### 5.4 Token 预算控制

| 组件 | 预算 | 占 prompt 比例 |
|------|------|---------------|
| L0 画像 | ~300 tokens | 5% |
| L1 场景记忆 | ~500 tokens | 8% |
| L3 项目上下文 | ~400 tokens | 7% |
| 其他 L0 + L1 + L2 | ~1800 tokens | 80% |

总影响：L0-memory 注入约 800 tokens，在 typical 6000-token prompt 中占 13%。

### 5.5 子 Agent 的记忆注入

```typescript
async buildForSubAgent(options: {
  agentId: string;
  agentConfig: any;
  includeProjectContext?: boolean;
  parentContext?: PromptBuildContext;
}): Promise<PromptBuildResult> {
  // ... 现有逻辑 ...

  // 新增：动态记忆注入
  if (this.memoryManager) {
    const memoryBlock = await this.memoryManager.buildContext({
      scene: options.agentConfig.scene,
      keyword: options.agentConfig.description,
      maxTokens: 300,    // 子 Agent 预算更严格
    });
    if (memoryBlock) {
      renderedParts.push(memoryBlock);
    }
  }

  // ... 合并 prompt ...
}
```

---

## 6. L0-memory 组件设计

### 6.1 已有组件 `l0-base-memory-guide.yaml`

该组件已存在，内容为：

```yaml
id: base-memory-guide
name: Memory Guide
layer: L0
priority: 80
estimatedTokens: 300
requiredTools:
  - memory_search
  - memory_store
content: |
  # Memory System — Quick Reference

  ## When to Search
  - User mentions "always/never/prefer" → search memory first
  - User corrects your choice → search memory, then store the correction
  - Starting a non-trivial task → search for relevant lessons and patterns

  ## When to Store
  - **User Preference**: explicit "always/never/prefer X" → store
  - **Correction**: user corrects you → store immediately
  - **Decision**: a choice was made with clear reasoning → store decision
  - **Pattern discovered**: a working solution for a recurring problem → store

  ## Storage Format (via memory_store tool)

  ```
  memory_store({ type: "entity", data: { name: "张三", entity_type: "user", summary: "Python/Django后端" }, scene: "开发" })
  memory_store({ type: "fact", data: { title: "认证方式", content: "用户使用RSA" }, scene: "开发" })
  memory_store({ type: "event", data: { content: "完成用户注册接口", entities: ["项目A"] } })
  memory_store({ type: "relation", data: { subject: "项目A", relation: "使用", object: "Docker" } })
  ```
```

### 6.2 补充内容建议

在现有组件末尾追加：

```yaml
  ## 主动使用指南

  遇到以下情况，**必须先调 memory_search**：
  - 用户说 "我之前说过"、"上次"、"还记得"
  - 你要做涉及用户偏好的决策（技术选型、工具选择）
  - 用户纠正了你的做法 → 搜索旧记忆 → store 新事实

  遇到以下情况，**用 memory_store 保存**（不要每条对话都存）：
  - 用户明确说出的固定偏好
  - 重要的项目决策及其原因
  - 用户第三次纠正同一种做法时
```

### 6.3 动态注入 vs 静态组件

记忆块不注册为静态 YAML 组件，而是在 `build()` 时由 `MemoryManager.buildContext()` 动态生成。这样保证每次注入的都是最新数据。组件 `l0-base-memory-guide.yaml` 只提供**使用引导**，不包含实际记忆内容。

---

## 7. 检索与注入的完整流程

```
用户输入: "帮我写个SpringBoot注册接口，用JWT"

1. IntentAnalyzer.analyze(userMessage)
   → scene='coding', complexity='standard'

2. LayeredPromptBuilder.build({ scene: 'coding' })

   2a. MemoryManager.buildContext({ scene: 'coding' })
       ┌────────────────────────────────────────┐
       │ SQL: SELECT FROM entities WHERE        │
       │   type='preference' ORDER BY importance │
       │ → [{ name: '密码加密', summary: '...' }] │
       │                                        │
       │ SQL: SELECT FROM facts WHERE           │
       │   is_latest=1 AND scene_tag LIKE '%,开发,%'│
       │ → [{ title: 'JWT认证', content: '...' }]│
       │                                        │
       │ 返回 markdown:                          │
       │ ## 我对你的了解                         │
       │ - 你偏好 JWT 认证方式                    │
       │ - 你的项目用 bcrypt 加密密码             │
       └────────────────────────────────────────┘

   2b. 组装 prompt:
       L0: base-identity
       L0: base-memory-guide
       L0: main-agent
       → 注入: [记忆块]
       L1: l1-coding
       L3: l3-project

3. AgentLoop.run()
   主 Agent 看到记忆块 → 直接按 JWT/bcrypt 偏好工作

   如果需要更详细信息：
   → memory_search({ query: 'JWT 认证 配置' })
     ┌────────────────────────────────────────┐
     │ FTS5: MATCH '"JWT" AND "认证"'          │
     │ → 命中 entities(JWT, type=tool)         │
     │ → 查 relations: JWT 被哪些项目使用      │
     │ → 返回详细结果                           │
     └────────────────────────────────────────┘

4. 用户纠正: "不对，我用的是RSA不是JWT"

   → 主 Agent 检测到纠正，调用 memory_store:
     memory_store({
       type: "fact",
       data: { title: "认证方式", content: "用户确认使用RSA而非JWT" },
       scene: "开发"
     })
   → MemoryManager.updateFact('认证方式', { content: 'RSA' })
   → 旧版本 is_latest=0，新版本 is_latest=1
   → 自动触发 tryTrackPreferenceChange()
     → 查 relations 中项目A→使用→JWT
     → 标记旧记录 is_active=0
     → 写入 relation_changes: JWT → RSA
     → 创建新 relation: 项目A → 使用 → RSA
```

---

**继续阅读 [第三部分：系统集成与实现](./memory-system-part-3-integration.md)**
