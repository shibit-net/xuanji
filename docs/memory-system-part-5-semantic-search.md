# Xuanji 记忆系统 · 语义搜索扩展

> 版本: 1.0 | 日期: 2026-05-16
> 前置: [存储架构与数据模型](./memory-system-part-1-storage.md)

---

## 目录

1. [为什么不早加语义搜索](#1-为什么不早加语义搜索)
2. [架构原则](#2-架构原则)
3. [存储设计](#3-存储设计)
4. [索引策略](#4-索引策略)
5. [检索集成](#5-检索集成)
6. [与 MRIB 对比](#6-与-mrib-对比)

---

## 1. 为什么不早加语义搜索

之前的方案选择"先用 FTS5，以后再向量"的理由是：

- 个人关键词通常明确（"JWT 认证"、"张三"、"Docker"）
- 语义搜索只在"用同义词描述不同事物"时有本质优势
- 初期不需要引入 embedding 模型的复杂度

但你的场景下**语义搜索的必要性在三个地方凸显**：

| 场景 | 用户实际会怎么问 | FTS5 能命中吗 |
|------|-----------------|--------------|
| 忘了确切说法的偏好 | "我记得你说过密码加密的问题" | ❌ 没有"密码加密"这个关键词，用户说的是"bcrypt" |
| 模糊回忆 | "上次那个项目用的数据库叫什么来着" | ❌ 用户用了"数据库"而非"PostgreSQL" |
| 跨场景联想 | "那个跟 Docker 配合很好的工具是什么" | ❌ 用户没提"docker-compose"只说"配合很好" |

---

## 2. 架构原则

**1. 语义搜索是 FTS5 的补充，不是替代**

```
memory_search 执行时:
  1. FTS5 全文搜索（关键词精确匹配）     ← 白送的，同时做
  2. 语义搜索（向量相似度）              ← fallback 或交叉排序
  3. 合并去重后返回
```

**2. 零外部依赖**

已有 `@xenova/transformers` + 多语言 local ONNX 模型（384 维），不需要额外 API key 或数据库。

**3. 增量索引**

每条 entity/fact 写入时自动计算 embedding，不依赖批量重建。

**4. 存储策略：SQLite + 文件**

不将 384 维浮点向量存入 SQLite 主表（避免表膨胀），而是写到一个单独的文件中。查询时全量加载到内存做暴力搜索——反正 10000 条 384 维向量只有 ~15MB，全量扫描 < 50ms。

---

## 3. 存储设计

### 3.1 为什么不用 SQLite BLOB 或 sqlite-vec

| 方案 | 问题 |
|------|------|
| **SQLite BLOB 存向量** | 1 万条 × 384 维 × 4 字节 = ~15MB，表膨胀 15MB 且每次 SELECT * 都要读这些 BLOB，拖慢普通查询 |
| **sqlite-vec 扩展** | 需要额外安装 C 扩展，xuanji 的 Electron 打包环境里不可靠 |
| **独立文件 + 内存全量** | 1 万条 384 维 float32 = 15MB，内存加载 < 50ms，暴力搜索 < 50ms，简单可靠 |

### 3.2 存储格式

```
~/.xuanji/users/{userId}/memory/
├── memory.db              ← SQLite（不变，存结构化数据）
├── embeddings.data         ← 二进制：所有向量拼接
└── embeddings.idx          ← JSON：id → 索引位置的映射
```

**embeddings.idx**：

```json
{
  "version": 1,
  "dimensions": 384,
  "entries": [
    {"id": "entity:zhangsan_id", "offset": 0, "length": 384, "text_summary": "张三 Python/Django...", "updated_at": 1747360000000},
    {"id": "fact:fact_id_123", "offset": 384, "length": 384, "text_summary": "项目A使用JWT认证...", "updated_at": 1747360001000},
    {"id": "event:event_id_456", "offset": 768, "length": 384, "text_summary": "完成注册接口...", "updated_at": 1747360002000}
  ]
}
```

**embeddings.data**（二进制，连续存储）：

```
[float32 × 384][float32 × 384][float32 × 384]...
```

### 3.3 初始化

```typescript
class SemanticIndex {
  private vectors: Float32Array | null = null;    // 所有向量拼接
  private entries: EmbeddingEntry[] = [];          // 索引列表
  private provider: EmbeddingProviderInterface;

  private indexDir: string;

  constructor(provider: EmbeddingProviderInterface, memoryDir: string) {
    this.provider = provider;
    this.indexDir = memoryDir;
  }

  async load(): Promise<void> {
    const idxPath = path.join(this.indexDir, 'embeddings.idx');
    const dataPath = path.join(this.indexDir, 'embeddings.data');

    try {
      this.entries = JSON.parse(await fs.readFile(idxPath, 'utf-8'));
      const buf = await fs.readFile(dataPath);
      this.vectors = new Float32Array(buf.buffer);
    } catch {
      this.entries = [];
      this.vectors = null;
    }
  }

  get size(): number { return this.entries.length; }
}
```

---

## 4. 索引策略

### 4.1 写入时索引

```typescript
async indexEntity(entity: { id: string; name: string; summary: string; scene_tag: string; updated_at: number }): Promise<void> {
  const text = `${entity.name} ${entity.summary} ${entity.scene_tag}`.trim();
  if (!text) return;

  const vector = await this.provider.embed(text);

  const entry: EmbeddingEntry = {
    id: `entity:${entity.id}`,
    offset: this.entries.length * this.dimensions * 4,  // float32 = 4 bytes
    length: this.dimensions,
    text_summary: text.slice(0, 100),
    updated_at: entity.updated_at,
  };

  this.appendVector(entry, vector);
  this.entries.push(entry);
}
```

**写入时机**：在 `MemoryManager.upsertEntity()` / `storeFact()` / `recordEvent()` 成功后异步触发。不阻塞主流程。

```typescript
// MemoryManager 中
async upsertEntity(input: EntityInput): Promise<Entity> {
  const entity = await this.db.run(...);
  // 异步索引，不阻塞
  this.semanticIndex?.indexEntity(entity).catch(err =>
    log.error('Failed to index entity:', err)
  );
  this.graph.addNode(entity);
  return entity;
}
```

### 4.2 初次批量重建

当从零开始或索引文件丢失时，全量重建：

```typescript
async rebuild(db: Database): Promise<void> {
  this.reset();

  const entities = db.prepare(`
    SELECT id, name, summary, scene_tag, updated_at FROM entities
  `).all() as any[];

  const facts = db.prepare(`
    SELECT id, title, content, scene_tag, updated_at FROM facts WHERE is_latest = 1
  `).all() as any[];

  // 分批处理，避免内存峰值
  const batchSize = 50;
  for (let i = 0; i < entities.length; i += batchSize) {
    const batch = entities.slice(i, i + batchSize);
    const vectors = await Promise.all(
      batch.map(e => this.provider.embed(`${e.name} ${e.summary} ${e.scene_tag}`))
    );
    for (let j = 0; j < batch.length; j++) {
      this.appendVector(
        { id: `entity:${batch[j].id}`, offset: this.entries.length * this.dimensions * 4,
          length: this.dimensions, text_summary: batch[j].summary.slice(0, 100),
          updated_at: batch[j].updated_at },
        vectors[j]
      );
      this.entries.push({ id: `entity:${batch[j].id}`, ... });
    }
  }

  // 同样处理 facts 和 events
  // ...

  await this.flush();  // 写入磁盘
}

private appendVector(entry: EmbeddingEntry, vector: number[]): void {
  if (!this.vectors) {
    this.vectors = new Float32Array(this.dimensions);
  } else {
    const newVectors = new Float32Array(this.vectors.length + this.dimensions);
    newVectors.set(this.vectors);
    newVectors.set(new Float32Array(vector), this.vectors.length);
    this.vectors = newVectors;
  }
}
```

### 4.3 更新策略

Entity/fact 更新时，**追加新向量 + 标记旧索引失效**。不直接修改原位置（偏移量不变，旧向量留在文件里）。查询时按 `updated_at` 取最新版本。

```typescript
async updateEntity(entity: { id: string; name: string; summary: string; scene_tag: string; updated_at: number }): Promise<void> {
  const key = `entity:${entity.id}`;
  const oldEntry = this.entries.find(e => e.id === key);
  if (oldEntry) {
    oldEntry.updated_at = -1;
  }
  await this.indexEntity(entity);
}
```

### 4.4 Episodes 索引支持

Part-7 的叙事记忆需要通过语义搜索检索。SemanticIndex 增加 episode 相关方法：

```typescript
// 新增：索引一条叙事记忆
async indexEpisode(episode: { id: string; narrative: string }): Promise<void> {
  const text = episode.narrative;
  if (!text || text.length < 50) return;  // 太短的叙事不值得搜索

  const vector = await this.provider.embed(text.slice(0, 2000));  // 取前 2000 字

  const entry: EmbeddingEntry = {
    id: `episode:${episode.id}`,
    offset: this.entries.length * this.dimensions * 4,
    length: this.dimensions,
    text_summary: text.slice(0, 100),
    updated_at: Date.now(),
  };

  this.appendVector(entry, vector);
  this.entries.push(entry);
}

// 新增：按语义搜索叙事记忆
async searchEpisodes(query: string, limit?: number): Promise<Array<{ id: string; text_summary: string; score: number }>> {
  if (!this.vectors || this.entries.length === 0) return [];

  const queryVec = await this.provider.embed(query);
  const maxResults = limit ?? 10;

  const scored: Array<{ entry: EmbeddingEntry; score: number }> = [];

  for (let i = 0; i < this.entries.length; i++) {
    const entry = this.entries[i];
    if (entry.updated_at < 0) continue;
    if (!entry.id.startsWith('episode:')) continue;  // 只搜叙事记忆

    const offset = i * this.dimensions;
    const vec = this.vectors.subarray(offset, offset + this.dimensions);
    const score = this.provider.cosineSimilarity(Array.from(queryVec), Array.from(vec));
    if (score >= 0.5) {
      scored.push({ entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).map(r => ({
    id: r.entry.id.replace('episode:', ''),
    text_summary: r.entry.text_summary,
    score: r.score,
  }));
}

// 通用 embed 方法（供 EpisodicMemory 和 LearnTool 调用）
async embed(text: string): Promise<number[]> {
  if (!text) return new Array(this.dimensions).fill(0);
  return await this.provider.embed(text.slice(0, 2000));
}
```

### 4.5 重建时包含 episodes

```typescript
async rebuild(db: Database): Promise<void> {
  this.reset();

  // 原有的 entities / facts 重建代码...

  // 新增：重建 episodes 索引
  const episodes = db.prepare(`
    SELECT id, narrative FROM episodes
  `).all() as any[];
  for (let i = 0; i < episodes.length; i += batchSize) {
    const batch = episodes.slice(i, i + batchSize);
    for (const ep of batch) {
      await this.indexEpisode(ep);
    }
  }

  await this.flush();
}
```

---

## 5. 检索集成

### 5.1 语义搜索函数

```typescript
async search(query: string, options?: {
  limit?: number;
  scoreThreshold?: number;  // 默认 0.5
}): Promise<SemanticResult[]> {
  if (!this.vectors || this.entries.length === 0) return [];

  const queryVec = await this.provider.embed(query);
  const limit = options?.limit ?? 10;
  const threshold = options?.scoreThreshold ?? 0.5;

  const scored: Array<{ entry: EmbeddingEntry; score: number }> = [];

  for (let i = 0; i < this.entries.length; i++) {
    const entry = this.entries[i];
    // 跳过无效（已更新）的索引
    if (entry.updated_at < 0) continue;

    const offset = i * this.dimensions;
    const vec = this.vectors.subarray(offset, offset + this.dimensions);
    const score = this.provider.cosineSimilarity(
      Array.from(queryVec),
      Array.from(vec)
    );
    if (score >= threshold) {
      scored.push({ entry, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(r => ({
    id: r.entry.id,
    text_summary: r.entry.text_summary,
    score: r.score,
  }));
}
```

性能估算：10000 条 × 384 维 × 余弦相似度 ≈ 30ms（JavaScript 单线程循环）。

### 5.2 集成到 MemoryManager.search()

```typescript
async search(query: string, options?: {
  scene?: string;
  types?: ('entity' | 'fact' | 'event')[];
  limit?: number;
  useSemantic?: boolean;   // 新增：默认 true
}): Promise<SearchResult[]> {
  const limit = options?.limit ?? 10;

  // 1. FTS5 搜索（关键词精确匹配）— 无论是否语义模式都执行
  const ftsResults = this.ftsSearch(query, options);

  // 2. 语义搜索（补充结果）
  if (options?.useSemantic !== false && this.semanticIndex?.size > 0) {
    const semanticResults = await this.semanticIndex.search(query, {
      limit: limit * 2,
    });

    // 3. 合并去重：FTS5 结果优先，语义结果补 FTS5 未命中的
    const seen = new Set(ftsResults.map(r => r.id));
    for (const sr of semanticResults) {
      if (!seen.has(sr.id)) {
        // 从数据库取完整记录
        const full = this.resolveSemanticResult(sr);
        if (full) {
          ftsResults.push({ ...full, score: sr.score, matchType: 'semantic' });
          seen.add(sr.id);
        }
      }
      if (ftsResults.length >= limit) break;
    }
  }

  return ftsResults.slice(0, limit);
}

private resolveSemanticResult(sr: SemanticResult): SearchResult | null {
  const [sourceType, id] = sr.id.split(':', 2);
  switch (sourceType) {
    case 'entity': return this.getEntity(id);
    case 'fact': return this.getFact(id);
    case 'event': return this.getEvent(id);
    default: return null;
  }
}
```

**FTS5 命中 → 语义不重复。FTS5 未命中 → 语义补上。**

### 5.3 性能权衡

| 操作 | 1K 条 | 10K 条 | 50K 条 |
|------|-------|--------|--------|
| 全量加载到内存 | ~1.5MB, <5ms | ~15MB, <20ms | ~75MB, ~100ms |
| 暴力搜索（384 维） | ~3ms | ~30ms | ~150ms |
| 单条写入索引 | ~50ms（embed 计算耗时） | 同左 | 同左 |
| FTS5 搜索 | ~5ms | ~10ms | ~30ms |

瓶颈是 embedding 计算（~50ms/条），搜索本身很快。

### 5.4 可选：应用层 ANN

如果 50K 条以上暴力搜索变慢（> 150ms），可以在应用层做简单聚类分桶：

```typescript
async search(query: string): Promise<SemanticResult[]> {
  const queryVec = await this.provider.embed(query);

  // 先找到质心最近的桶（64 个桶）
  const bucketScores = this.centroids.map((c, i) => ({
    idx: i, score: this.provider.cosineSimilarity(queryVec, c)
  }));
  bucketScores.sort((a, b) => b.score - a.score);

  // 只在 top-3 桶内暴力搜索
  const candidates = bucketScores.slice(0, 3).flatMap(
    b => this.buckets[b.idx]
  );
  // ... 对 candidates 做暴力搜索
}
```

**但这是优化，不是必选项。** 个人管家场景 10K 条以下暴力搜索完全够用。等到了 50K 再考虑加 ANN。

---

## 6. 与 MRIB 对比

（MRIB 是另一种方案：把向量存入 SQLite BLOB，用 sqlite-vec 扩展做索引）

| | 本方案（独立文件 + 暴力搜索） | MRIB（sqlite-vec） |
|---|---|---|
| 额外依赖 | 无 | 需要编译 sqlite-vec C 扩展 |
| Electron 兼容 | ✅ 纯 JS/TS | ❌ C 扩展在 asar 打包环境下不可靠 |
| 写入速度 | 快（追加到文件末尾） | 慢（SQLite BLOB 更新涉及 WAL 同步） |
| 搜索速度 (10K) | ~30ms（全量暴力） | ~5ms（IVF 索引） |
| 搜索速度 (50K) | ~150ms | ~10ms |
| 内存占用 (10K) | ~15MB | 0（SQLite 管理） |
| 实现复杂度 | 200 行代码 | 依赖第三方扩展 |

**结论**：50K 条以内选独立文件。超过后迁移到 sqlite-vec 或分层导航小样本（HNSW）。

---

## 7. 文件清单

```
src/core/memory/
├── MemoryManager.ts        ← 修改：search() 集成语义
├── MemoryGraph.ts          ← 不变
├── SemanticIndex.ts        ← 新增：向量索引 + 搜索
└── types.ts                ← 修改：新增 SemanticResult 类型
```

## 8. 与现有文档的集成点

| 文档 | 修改 |
|------|------|
| Part 1 §6（FTS5 全文索引） | 末尾新增"语义搜索扩展"章节，说明 embedding 策略 |
| Part 2 §2.2（FTS5 搜索） | memory_search 新增 `use_semantic` 参数 |
| Part 2 §7（完整流程） | 搜索步骤新增语义搜索并列分支 |
| Part 3 §4.1（memory_search 工具） | `input_schema` 新增 `use_semantic: boolean` 参数 |
| Part 4 §1.2（性能基准） | 新增语义搜索性能行 |
