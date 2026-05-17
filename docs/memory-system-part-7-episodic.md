# Xuanji 记忆系统 · 叙事记忆（Episodic Memory）

> 版本: 1.0 | 日期: 2026-05-16
> 依赖: 记忆系统 Part 1-6（存储 + 检索 + 归档）

---

## 目录

1. [问题定义](#1-问题定义)
2. [什么是叙事记忆](#2-什么是叙事记忆)
3. [存储设计](#3-存储设计)
4. [写入触发](#4-写入触发)
5. [检索机制](#5-检索机制)
6. [EpisodicMemory 类设计](#6-episodicmemory-类设计)
7. [与现有系统的关系](#7-与现有系统的关系)

---

## 1. 问题定义

用户说的"回忆起某件事的具体内容或操作"，在 xuanji 现有记忆中对应这三种场景：

**场景 A**：用户记得"发生过一件事"，但说不出关键词

> "上次改认证方案的时候，我们试了好几种方式才定下来，具体是怎么搞的？"

现有系统：Entity 表有"认证方案"，Event 表有"认证方案从 JWT 改为 RSA"。
但"试了好几种方式"这个情节——先试了什么、为什么不行、最后怎么定的——不在任何一张表里。

**场景 B**：用户模糊描述一个操作过程

> "我记得你之前帮我配过一个 CI 流程，里面有很多步骤"

现有系统：Event 表有一条"配置 CI 流程"。
但"那些步骤具体是什么"——checkout、test、build、deploy 的顺序和参数不在记忆里。

**场景 C**：用户说不清关键词，但能描述"当时的感觉"

> "就是上次搞到很晚那个项目，数据库一直连不上"

现有系统：FTS5 搜"数据库"+"连不上"可能命中 Event。但"搞到很晚"这个情节信息存不下来。

---

## 2. 什么是叙事记忆

认知科学区分三种记忆：

- **语义记忆**（Semantic）：事实。"JWT 是一种认证方式"。→ 已有的 Entity/Fact
- **程序记忆**（Procedural）：怎么做。"调这个 API 要传三个参数"。→ 已有的 Fact
- **情景记忆**（Episodic）：经历了什么。"上周三我们试了 JWT→OAuth→RSA 三次才定下来"。→ **缺的**

情景记忆的特点：

| | 语义记忆 | 情景记忆 |
|---|---|---|
| 粒度 | 单条事实 | 一串事件 + 上下文 |
| 时序 | 版本号 | 完整时间线 + 因果 |
| 上下文 | scene_tag | 参与的人、工具、决策链、情绪 |
| 查询方式 | 关键词/实体 | 模糊描述/感觉/情节 |

---

## 3. 存储设计

### 3.1 存储格式

每条叙事记忆是一段自然语言文本 + 关联标签。不拆成结构化字段——因为叙事的价值在于连贯性，拆碎了就丢了情节。

```typescript
interface Episode {
  id: string;                    // uuid
  timestamp: number;             // 事件结束时间
  title: string;                 // 一句话标题（用于 prompt 注入）
  narrative: string;             // 完整叙事文本（300-2000 字）
  participants: string[];        // 涉及的实体 ID
  related_events: string[];      // 关联的 Event ID
  scene_tag: string;             // 场景
  importance: number;            // 1-5
  embedding: number[];           // 384 维向量（用于语义检索）
  created_at: number;
  updated_at: number;
}
```

### 3.2 存储位置

新增两张 SQLite 表：

```sql
-- 叙事记忆主表
CREATE TABLE episodes (
  id           TEXT PRIMARY KEY,
  timestamp    INTEGER NOT NULL,
  title        TEXT NOT NULL,
  narrative    TEXT NOT NULL,             -- 全文
  scene_tag    TEXT NOT NULL DEFAULT '',
  importance   INTEGER NOT NULL DEFAULT 3,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- 叙事记忆 ↔ 实体的关联表（多对多）
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

**叙事本身的语义搜索**：复用 Part 5 的 `SemanticIndex`，episodes.narrative 也生成 embedding 加入索引。

**为什么不把 narrative 放进 events 表**：

| | events 表 | episodes 表 |
|---|---|---|
| 内容 | "认证方案从 JWT 改为 RSA"，单句 | "上周先试了JWT发现密钥轮换太麻烦，然后试了OAuth但客户端不支持，最后改用RSA。中间讨论了一个小时…" |
| 粒度 | 单条原子事件 | 一串事件的完整情节 |
| 检索方式 | FTS5 关键词 | 语义向量 + 实体关联 |
| 大小 | 短文本 | 300-2000 字 |

### 3.3 存储示例

一条典型的叙事记忆：

```json
{
  "id": "episode_a1b2c3",
  "timestamp": 1747450000000,
  "title": "项目A认证方案选型讨论",
  "narrative": "2026-05-15 下午，和用户讨论项目A的认证方案选型。\n\n先试了 JWT：实现快但密钥轮换太麻烦，用户觉得每次部署都要同步密钥不够安全。\n\n然后考虑 OAuth2：完整方案但客户端是老系统不支持 OAuth，要改太多依赖。\n\n最后定 RSA 非对称加密：私钥签名、公钥验证，不需要轮换密钥。用户说'这个好，以后加新服务也不用改认证'。\n\n整个过程讨论了大约一个小时，最后决定用户文档里加 RSA 密钥生成步骤。",
  "participants": ["zhangsan_id", "projectA_id", "jwt_id", "oauth_id", "rsa_id"],
  "related_events": ["event_jwt_tried", "event_oauth_discussed", "event_rsa_finalized"],
  "scene_tag": "开发",
  "importance": 4,
  "embedding": [0.123, -0.456, ...]
}
```

---

## 4. 写入触发

叙事记忆不靠 LLM 主动存——LLM 不会天然知道"刚才那段讨论值得写一篇几百字的小说"。三条触发路径：

### 4.1 主路径：用户明确要求"记住这段"

```yaml
# l0-base-memory-guide.yaml 中新增
  ## 记住完整对话

  当用户说以下的话时，用 memory_store 记录完整叙事：
  - "记住这段"、"记住刚才说的"、"把这个记下来"
  - "刚才那个过程记一下"
  - 系统检测到一次重要的决策讨论（多次 tool call 来回，最终定了方案）
```

```typescript
// ChatSession.onText 中
if (userMessage.includes('记住刚才') || userMessage.includes('记下来') || userMessage.includes('记住这段')) {
  // 从上下文中提取最近几轮对话，生成叙事
  const recentMessages = contextManager.getRecentMessages(10);
  const episode = await this.episodicMemory.createFromMessages(recentMessages);
}
```

### 4.2 路径 2：子 Agent 完成时自动触发（重要决策）

`SubAgentResultStore` 存储了子 Agent 的完整输出，但如果一次任务涉及多次 task 调用（比如先调研、再执行、再审查），这些分散的输出可以组合成一条叙事。

```typescript
// AgentLoop 中检测"重要事件序列"
private trackedTasks: Array<{ taskId: string; result: ToolResult; timestamp: number }> = [];

onToolEnd: (id, name, result, isError) => {
  if ((name === 'task' || name === 'agent_team') && !isError) {
    this.trackedTasks.push({ taskId: id, result, timestamp: Date.now() });

    // 如果短时间内连续完成多个重要任务，自动生成叙事
    if (this.shouldCreateEpisode()) {
      this.episodicMemory?.createFromTaskSequence(this.trackedTasks);
      this.trackedTasks = [];
    }
  }
}

private shouldCreateEpisode(): boolean {
  // 3 个以上连续任务，且涉及决策/方案变更
  if (this.trackedTasks.length < 3) return false;

  const allContent = this.trackedTasks.map(t => t.result.content).join('');
  const decisionKeywords = ['决定', '选择', '改用', '方案', '架构', '设计'];
  return decisionKeywords.some(kw => allContent.includes(kw));
}
```

### 4.3 路径 3：上下文压缩触发

复用 Part 6 的 `archiveMessages`——当大量消息被压缩丢弃时，如果其中包含连贯的决策过程，生成一条叙事记忆。

```typescript
async archiveMessages(messages: Message[]): Promise<void> {
  // ... 提取 tool_result、存 fact ...

  // 额外：检测是否有连贯的叙事
  if (this.episodicMemory && messages.length > 15) {
    const hasNarrative = this.detectNarrativeStructure(messages);
    if (hasNarrative) {
      await this.episodicMemory.createFromMessages(messages);
    }
  }
}

/**
 * 检测消息中是否有叙事结构：
 * - 包含多次 tool call（讨论过程）
 * - 有决策信号（"就定这个"、"决定了"）
 * - 有因果链（"因为A所以B，最后选了C"）
 */
private detectNarrativeStructure(messages: Message[]): boolean {
  let toolCallCount = 0;
  let userMessageCount = 0;
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      toolCallCount += msg.content.filter(b => b.type === 'tool_use').length;
    }
    if (msg.role === 'user') userMessageCount++;
  }
  return toolCallCount >= 3 && userMessageCount >= 3;
}
```

---

## 5. 检索机制

### 5.1 语义匹配

用户描述是模糊的，关键词可能完全对不上。

```
用户: "就是上次搞到很晚那个项目，数据库一直连不上"

→ 语义搜索（Part 5 SemanticIndex）：
  query = "搞到很晚 数据库 连不上"
  → 匹配 episode.narrative 中包含"凌晨"、"数据库连接超时"、"排查到凌晨三点"的叙事

→ 实体关联匹配（episode_entities）：
  query 中 entity = "项目A"
  → 匹配所有关联项目A的叙事
  → 按时间排序，最近的优先

→ 交叉排序：
  语义得分 × 0.6 + 实体关联 × 0.3 + 时间衰减 × 0.1 = 最终得分
```

### 5.2 memory_search 扩展

`memory_search` 新增 `source=episode` 参数：

```typescript
input_schema: {
  properties: {
    query: { type: 'string' },
    source: {
      type: 'string',
      enum: ['auto', 'memory', 'subagent', 'archived', 'episode'],
      default: 'auto',
    },
    // ...
  },
}
```

`source=episode` 时，按上述语义 + 实体交叉检索，返回叙事。

### 5.3 Prompt 注入

当用户的问题中包含"记得"、"上次"、"之前"、"那次"等关键词时，LayeredPromptBuilder 在构建 prompt 时自动搜索叙事记忆：

```typescript
async buildContext(options: {
  scene?: string;
  keyword?: string;
  // ...
  autoEpisodic?: boolean;  // 默认 true
}): Promise<string> {
  // ... 现有逻辑（画像 + 场景 + 关键词搜索）...

  // 新增：如果用户输入包含回忆信号，检索叙事记忆
  if (options.autoEpisodic !== false && options.keyword) {
    const recallSignals = /记得|上次|之前|那次|那个|还记得|当时/;
    if (recallSignals.test(options.keyword)) {
      const episodes = await this.episodicMemory.search(options.keyword, 2);
      if (episodes.length > 0) {
        parts.push('## 相关回忆');
        for (const ep of episodes) {
          parts.push(`### ${ep.title}（${formatDate(ep.timestamp)}）`);
          parts.push(ep.narrative.slice(0, 300) + '...');
        }
        // 同时把完整叙事注入到 context 末尾作为参考
        // 通过 system prompt suffix 机制（已有的 setSystemPromptSuffix）
        parts.push('\n[完整叙事参考]');
        for (const ep of episodes) {
          parts.push(ep.narrative);
        }
      }
    }
  }
}
```

### 5.4 检索优先级

```
buildContext 阶段（被动注入，不额外调 LLM）:
  1. 用户输入含"记得/上次/之前" → 自动搜 episodes 表
  2. 语义搜索 query → 匹配 top-2 叙事
  3. 注入摘要 + 完整叙事作为参考

Agent 主动检索（memory_search source=episode）:
  1. 语义搜索（Part 5 SemanticIndex 中的 episode embedding）
  2. 实体关联匹配（episode_entities JOIN entities）
  3. 交叉排序
  4. 返回完整叙事
```

---

## 6. EpisodicMemory 类设计

```typescript
class EpisodicMemory {
  /**
   * 从最近的对话消息生成一条叙事记忆
   *
   * 用便宜 LLM 把分散的消息压缩成连贯的叙事文本。
   * 只在"有叙事价值"时调用（多次 tool call + 决策信号）。
   */
  async createFromMessages(messages: Message[]): Promise<Episode | null>;

  /**
   * 从连续的子任务序列生成叙事记忆
   *
   * 先调研、再执行、再审查——这种多步协作的结果很适合存成叙事。
   */
  async createFromTaskSequence(tasks: TaskRecord[]): Promise<Episode | null>;

  /**
   * 语义搜索叙事记忆
   *
   * 同时使用:
   * 1. SemanticIndex 的 embedding 相似度
   * 2. episode_entities 的实体关联
   * 3. FTS5 关键词（fallback）
   */
  async search(query: string, limit?: number): Promise<Episode[]>;

  /**
   * 按实体查找相关叙事
   */
  async findByEntity(entityId: string, limit?: number): Promise<Episode[]>;

  /**
   * 按事件 ID 查找相关叙事（Part-9 CareManager 用）
   * 通过 episode_entities 表关联：查该事件的实体 → 再查这些实体关联的叙事
   */
  async findByEvent(eventId: string, limit?: number): Promise<Episode[]>;

  /**
   * 从学习结果生成叙事记忆（Part-8 LearnTool 调用）
   *
   * learn 工具学完一个主题后，把"这次学了什么"的完整过程记录为叙事。
   */
  async createFromLearning(input: {
    title: string;
    narrative: string;
    participants: string[];
    scene_tag: string;
    importance: number;
  }): Promise<Episode | null>;

  /**
   * 删除过时或低价值的叙事
   * importance<=2 且超过 90 天的可以删除
   */
  async cleanup(): Promise<number>;
}
```

### 6.1 createFromMessages 实现

```typescript
async createFromMessages(messages: Message[]): Promise<Episode | null> {
  if (messages.length < 6) return null;

  // 用便宜 LLM 生成叙事
  const response = await this.cheapLLM.stream([{
    role: 'system',
    content: `分析以下对话，如果其中包含值得回忆的重要过程/决策/操作，生成一段叙事记忆。

输出 JSON（如果内容不值得记，返回 null）：
{
  "title": "一句话标题（10字内）",
  "narrative": "完整叙事（300-800字），包含时间、参与者、过程、决策原因、结果",
  "importance": 1-5,
  "scene": "开发|生活|工作",
  "entity_names": ["张三", "项目A", "JWT"]
}

判断标准：
- 有明确的决策过程（试了A不行→试了B→最后定了C）→ 值得记
- 有复杂的操作步骤（配CI、搭环境、调试bug）→ 值得记
- 只是普通的一问一答（"今天天气怎么样"）→ null
- 用中文输出`,
  }, {
    role: 'user',
    content: formatMessages(messages),
  }]);

  const data = JSON.parse(response);
  if (!data || !data.narrative) return null;
  if (data.importance < 2) return null;

  // 解析实体名称 → ID
  const entityIds = await this.resolveEntityNames(data.entity_names || []);

  // 生成 embedding
  const embedding = await this.semanticIndex?.embed(data.narrative) || [];

  // 写入 SQLite
  const id = generateId();
  this.db.prepare(`
    INSERT INTO episodes (id, timestamp, title, narrative, scene_tag, importance, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, Date.now(), data.title, data.narrative, data.scene || '', data.importance, Date.now(), Date.now());

  // 写入关联
  for (const entityId of entityIds) {
    this.db.prepare('INSERT OR IGNORE INTO episode_entities (episode_id, entity_id) VALUES (?, ?)').run(id, entityId);
  }

  // 加入语义索引
  await this.semanticIndex?.indexEpisode({ id, narrative: data.narrative });

  return { id, title: data.title, narrative: data.narrative, ... };
}
```

### 6.2 search 实现——语义+实体交叉检索

```typescript
async search(query: string, limit: number = 3): Promise<Episode[]> {
  const queryVec = await this.semanticIndex?.embed(query);
  if (!queryVec) return this.searchByFTS(query, limit);

  // 1. 从 SemanticIndex 取 top-20 语义候选
  const semanticCandidates = await this.semanticIndex.searchEpisodes(query, 20);
  
  // 2. 实体关联提升
  const scored = semanticCandidates.map(candidate => {
    let score = candidate.score * 0.6;  // 语义权重

    // 实物提升
    const entities = this.db.prepare(`
      SELECT e.id, e.name FROM episode_entities ee
      JOIN entities e ON e.id = ee.entity_id
      WHERE ee.episode_id = ?
    `).all(candidate.id);

    // 如果 query 中包含实体名称，加分
    for (const entity of entities) {
      if (query.includes(entity.name)) {
        score += 0.3;
      }
    }

    // 时间衰减（3 个月减 0.1）
    const episode = this.db.prepare('SELECT timestamp FROM episodes WHERE id = ?').get(candidate.id) as any;
    const daysAgo = (Date.now() - episode.timestamp) / 86400000;
    score -= Math.min(0.2, daysAgo / 300);  // 60 天减 0.2

    return { ...candidate, score };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
```

### 6.3 辅助方法

```typescript
/**
 * FTS5 兜底搜索：当 semanticIndex 不可用时使用
 * 通过 Part-1 定义的 memory_fts 虚拟表搜索 episodes
 */
private searchByFTS(query: string, limit: number): Episode[] {
  const results = this.db.prepare(`
    SELECT e.id, e.title, e.narrative, e.timestamp
    FROM episodes e
    JOIN memory_fts fts ON fts.source_id = e.id
    WHERE fts.source_table = 'episodes' AND memory_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(sanitizeFTS5(query), limit) as any[];
  return results.map(r => ({ id: r.id, title: r.title, narrative: r.narrative, timestamp: r.timestamp }));
}

/**
 * 按事件 ID 查找相关叙事（Part-9 CareManager 用）
 * 通过 events.entity_ids 字段（逗号分隔的实体 ID 列表）查关联的实体
 * → 再查这些实体关联的 episode
 */
async findByEvent(eventId: string, limit: number = 1): Promise<Episode[]> {
  // 先查该事件的 entity_ids
  const event = this.db.prepare(`
    SELECT entity_ids FROM events WHERE id = ?
  `).get(eventId) as { entity_ids: string } | undefined;

  if (!event || !event.entity_ids) return [];

  // entity_ids 格式: ',id1,id2,' — 拆分为数组
  const entityIds = event.entity_ids
    .split(',')
    .filter(id => id.length > 0);

  if (entityIds.length === 0) return [];

  const placeholders = entityIds.map(() => '?').join(',');

  // 再查这些实体关联的 episode（按时间倒序）
  const episodes = this.db.prepare(`
    SELECT DISTINCT e.id, e.title, e.narrative, e.timestamp
    FROM episodes e
    JOIN episode_entities ee ON ee.episode_id = e.id
    WHERE ee.entity_id IN (${placeholders})
    ORDER BY e.timestamp DESC
    LIMIT ?
  `).all(...entityIds, limit) as any[];

  return episodes.map(r => ({ id: r.id, title: r.title, narrative: r.narrative, timestamp: r.timestamp }));
}
```

---

## 7. 与现有系统的关系

### 7.1 数据流

```
用户对话 / 子Agent执行
  │
  ▼
ContextManager 压缩 → archiveDelegate.archiveMessages()
  │               ↘ 提取叙事 → EpisodicMemory.createFromMessages()
  ▼
SubAgentResultStore.store()
  │
  ▼
EpisodicMemory.createFromTaskSequence()  ← 连续 3 个以上重要子任务
  │
  ▼
Episodes 表 + episode_entities + SemanticIndex
  │
  ▼
user: "记得上次那个认证方案的事..."
  → buildContext 自动检索 → 注入叙事摘要
  → 或 memory_search source=episode → 返回完整叙事
```

### 7.2 与现有表的职责分离

| 表 | 存什么 | 不存什么 |
|---|---|---|
| entities | 人、项目、工具 | 情节 |
| relations | 实体之间的关系 | 为什么建立这个关系 |
| events | 发生了什么（单条原子事件） | 为什么会发生、前后因果 |
| facts | 确定的事实（版本管理） | 探索过程、放弃的方案 |
| **episodes** | 完整情节 + 决策链 + 因果 | 没有叙事价值的一问一答 |
| subagent_results | 子 Agent 完整输出 | 叙事结构 |

---

## 8. 文件清单

```
src/core/memory/
├── MemoryManager.ts          ← 修改：archiveMessages 中触发叙事生成
├── EpisodicMemory.ts         ← 新增
└── types.ts                  ← 修改：新增 Episode, EpisodeInput 类型

docs/
└── memory-system-part-7-episodic.md (本文)
```
