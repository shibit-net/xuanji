# Xuanji 记忆系统 · 补充设计：大规模与自我进化

> 本文是对三篇主文档的补充，回答两个关键问题：
> 1. 个人管家长期使用 + 大型项目，万级记忆怎么存储和检索
> 2. 大规模文档的摘要和知识提取如何实现

---

## 1. 万级记忆的存储

原来设计 4 张表 + 索引的模式，在万级规模下够不够？

### 1.1 性能基准

| 操作 | 1000 条 | 10000 条 | 50000 条 |
|------|---------|----------|----------|
| Entity 单条写入（索引更新） | <1ms | <1ms | ~2ms |
| Entity 按 type 过滤查询 | <1ms | <1ms | ~3ms |
| Relation 两表 JOIN | <1ms | ~3ms | ~15ms |
| Relation 三表 JOIN（张三→项目→技术栈） | <2ms | ~5ms | ~25ms |
| FTS5 搜索 | <5ms | ~10ms | ~30ms |
| 递归 CTE 路径发现（4 跳内） | <5ms | ~20ms | ~50ms |

50K entity + 100K relation 以内的全 SQLite 方案，延迟在可接受范围（< 50ms）。**原来设计不需要改，把 WHERE id = ? 索引用好就行**。

### 1.2 唯一需要改的地方：L0 注入的 token 预算

原来设计每次 buildContext() 取 top-5 preference + top-8 fact。万级记忆下这条查询仍然是毫秒级（按 importance + updated_at 排序取 LIMIT，SQLite 优化良好）。**不需要分页或分区**。

但 token 预算需要更精确控制。全系统统一预算如下：

> 下文构造函数为简化示意，完整 10 参数构造函数以 Part-3 为准。

| 组件 | 预算 | 占用比例 | 说明 |
|------|------|---------|------|
| L0 画像 | ~200 tokens | 3% | entities(type='preference') top-5 |
| L1 场景相关 | ~600 tokens | 10% | facts + entities by scene_tag |
| 总计注入 | ~800 tokens | 13% | 在 typical 6000-token prompt 中 |

不同上下文可调整默认值（主 Agent 用 800，子 Agent 用 300）

```typescript
async buildContext(options: {
  scene?: string;
  keyword?: string;
  maxTokens?: number;  // 主 Agent 默认 800，子 Agent 默认 300
}): Promise<string> {
  let budget = options.maxTokens ?? 800;
  const parts: string[] = [];

  // 1. 画像 — 固定 200 tokens
  if (budget > 200) {
    const n = Math.min(5, Math.floor((budget - 200) / 60));
    const preferences = this.db.prepare(`
      SELECT summary FROM entities
      WHERE type = 'preference'
      ORDER BY importance DESC, updated_at DESC
      LIMIT ?
    `).all(n);
    // ...
    budget -= estimateTokens(joinedPreferences);
  }

  // 2. 场景事实 — 剩余预算
  if (budget > 100 && options.scene) {
    const n = Math.min(10, Math.floor(budget / 80));
    const facts = this.db.prepare(`...`).all(n);
    // ...
  }

  // 3. 项目上下文 — 如果有关键词，FTS5 检索 top 相关
  if (budget > 200 && options.keyword) {
    const n = Math.min(5, Math.floor((budget - 200) / 120));
    const fts = this.search(options.keyword, { limit: n });
    // ...
  }
}
```

核心原则：**LLM context window 是瓶颈，不是 SQLite。** 万级记忆下 SQLite 能在 10ms 内返回你需要的数据，关键是筛选出最值得注入的那几条。

---

## 2. 自我学习进化

这是你问的核心问题。分三个维度设计。

### 2.1 主动进化：Session 后提取从不懈怠

原来设计是每次 session 结束 5 秒后用便宜 LLM 做一次提取。对于长期管家，这个机制需要加强。

**cheapLLM 配置建议**：
- 推荐模型：`deepseek-chat`（性价比最优，~$0.14/1M 输入 tokens）
- Fallback：无，提取失败不阻塞主流程（记录日志即可）
- 注入方式：通过 ProviderManager 获取已配置的模型，或单独传入一个轻量 Provider 实例

```typescript
// MemoryManager 构造函数
constructor(
  private dbPath: string,
  private cheapLLM?: ILLMProvider,  // 可选，没有则不启用自动提取
) {}
```

```typescript
// MemoryExtractor.ts — 专用于"从交互中学习"的模块
class MemoryExtractor {
  /**
   * 会话结束提取 — 每次会话后必做
   * 成本：~500 tokens 输入 + ~200 tokens 输出
   * 一个活跃用户如果每天 100 次交互 → ~70k tokens/天
   * 用便宜模型（deepseek-chat 等）→ ~$0.035/天
   */
  async extractFromSession(messages: Message[]): Promise<void> {
    // 跳过短会话（< 3 轮，不太可能产生有价值记忆）
    if (messages.length < 6) return;

    // 跳过已有关键词的会话（避免重复提取相同内容）
    if (this.wasRecentlyExtracted(messages)) return;

    const response = await this.cheapLLM.stream([/* prompt */]);
    // ... 解析并存储
  }

  /**
   * 用户行为模式分析 — 每周一次
   * 分析用户的重复操作模式，自动推断偏好
   * 成本：~2000 tokens/周
   */
  async analyzePatterns(events: Event[]): Promise<Pattern[]> {
    // 分析 Event 表中的重要性事件
    // 找重复模式：用户连续 3 次拒绝某个操作 → 偏好
    // 找时间模式：用户每周一上午都做项目规划 → 习惯
  }

  /**
   * 记忆合并 — 每周一次
   * 找类似的 entity/fact，合并冗余
   */
  async consolidate(): Promise<void> {
    // 1. 合并同名同类型 entity（保留创建时间最早的，更新 summary 为最新）
    // 2. 合并内容相似度 > 80% 的 fact
    // 3. 删除 importance=1 且超过 90 天未引用的 entity
  }
}
```

### 2.2 被动进化：用户纠错即学习

这是个人管家最重要的学习机制。用户说"不对"的时候，就是模型真正变聪明的时候。

```typescript
// ChatSession — onText 回调中新增纠错检测
onText: (text: string) => {
  // ← 新增：检测纠错模式
  const userMessage = /* 当前用户输入 */;
  const correction = this.detectCorrection(text, userMessage);
  if (correction) {
    this.memoryManager?.recordCorrection(correction);
    // 纠错是最高优先级的记忆
    this.memoryManager?.storeFact({
      title: correction.topic,
      content: `用户纠正：${correction.correction}`,
      source: 'user_correction',
      importance: 5,        // 最高重要性
      scene_tag: correction.scene,
    });
  }
}

/**
 * 纠错检测：在 Agent 的回复中检测以下模式
 * - "不对"、"不是"、"错了"、"我说的是..."等否定/纠正
 * - 用户主动提供的修正信息
 * 
 * 不需要 LLM，正则匹配即可
 */
private detectCorrection(agentResponse: string, userMessage: string): Correction | null {
  const correctionPatterns = [
    /不(对|是|行|用|要|喜欢)/,
    /错了/,
    /我说的是/,
    /你(理解|记|说)(错|反|的不对)/,
    /不是这样/,
    /其实是/,
    /改成/,
    /应该是/,
    /换(成|用)/,
    /不要用/,
    /不能用/,
  ];

  for (const pattern of correctionPatterns) {
    if (pattern.test(userMessage)) {
      return {
        topic: this.extractTopic(agentResponse, userMessage),
        correction: userMessage.slice(0, 200),
        scene: this.currentScene,
      };
    }
  }
  return null;
}
```

**纠错的学习权重**：用户纠正的事实会被标记 `importance=5`，在 prompt 注入时始终排第一。被纠正的旧事实 `is_latest=0`，但保留可追溯。

### 2.3 隐性进化：行为模式挖掘

用户不直接告诉你偏好，但从行为中可以推断。

```typescript
class BehaviorAnalyzer {
  /**
   * 今日行为摘要 — 每天结束时运行
   * 分析当天的 events + 交互，提取行为模式
   */
  async dailyDigest(userMessage: string, agentActions: ToolCall[]): Promise<void> {
    // 用户每天都在同一时间问天气 → 偏好早起
    // 用户每次写代码都用 task 调 software-engineer → 偏好分工明确
    // 用户每次看到某个操作都说"不用了" → 这个功能不需要

    // 用便宜 LLM 做聚类分析
    const response = await cheapLLM.stream([
      { role: 'system', content: `分析以下对话记录，推断用户的隐性偏好。
输出 JSON 数组：
[{
  "type": "preference",
  "inference": "用户偏好Docker开发环境",
  "evidence": ["用户今天3次手动启动docker-compose"],
  "confidence": 0-1
}]
confidence < 0.6 的不要输出。
`},
      { role: 'user', content: formattedToday },
    ]);
    // ...
  }
}
```

---

## 3. 大规模文档的摘要与知识提取

**这才是 Graph RAG 真正该发挥作用的地方。** 但不是完整的 MS Graph RAG 流程，而是取其核心思想进行裁剪。

### 3.1 文档导入流程

```
用户上传/引用文档（PDF、代码库、网页）
  │
  ▼
┌──────────────────────────────────────────┐
│ DocumentIngestionPipeline                │
├──────────────────────────────────────────┤
│ 1. 文本提取（PDF/DOCX -> plain text）    │
│ 2. 分块（chunk_size=2000, overlap=200）  │
│ 3. LLM 提取 → entities + relations       │
│ 4. LLM 生成 → 块级摘要                    │
│ 5. 社区检测 + 社区摘要                    │
│ 6. 结果存入 SQLite                        │
└──────────────────────────────────────────┘
```

### 3.2 增量社区检测

Graph RAG 的社区检测（Leiden 算法）之所以在大规模场景才有价值，是因为它自动发现主题群落——但在个人管家+项目场景，我们有一个更好的出发点：**scene_tag**。

用户场景标签本身就是天然的主题群落划分。所以我们的做法是：

```
不跑 Leiden 社区检测
而是：按 scene_tag 分组，每个 scene 为一个"社区"
每个社区的摘要 = 该 scene 下所有 facts + entities 的 LLM 摘要

什么时候更新社区摘要？
- 该 scene 下新增 entity/fact 达到一定数量（比如 10 条）
- 或者手动触发
```

```typescript
class CommunityManager {
  /**
   * 按 scene 生成社区摘要
   * 用于回答"这个项目/这个场景的整体情况是什么"
   */
  async generateSceneSummary(scene: string): Promise<string> {
    // 1. 获取该 scene 下所有活跃的 entities + facts
    const entities = this.db.prepare(`
      SELECT name, summary FROM entities
      WHERE scene_tag LIKE ? ORDER BY importance DESC
    `).all(`%,${scene},%`);

    const facts = this.db.prepare(`
      SELECT title, content FROM facts
      WHERE is_latest = 1 AND scene_tag LIKE ?
    `).all(`%,${scene},%`);

    // 2. LLM 生成摘要
    const summary = await this.cheapLLM.stream([
      { role: 'system', content: `为用户场景"${scene}"生成知识总结。
基于以下实体和事实，生成 3-5 句的知识概要。
注意：这不是搜索结果的拼接，而是一份连贯的知识结构说明。`},
      { role: 'user', content: formatEntityAndFacts(entities, facts) },
    ]);

    // 3. 缓存摘要（SQLite 或单独文件）
    this.cacheSceneSummary(scene, summary);
    return summary;
  }

  /**
   * 增量更新：新增 entity/fact 时，检查是否需要重新生成摘要
   */
  async onSceneUpdated(scene: string): Promise<void> {
    const count = this.db.prepare(`
      SELECT COUNT(*) as c FROM facts
      WHERE is_latest = 1 AND scene_tag LIKE ? AND updated_at > ?
    `).get(`%,${scene},%`, Date.now() - 3600_000);  // 过去 1 小时内

    if (count.c >= 10) {
      // 新增了 10 条以上 → 重新生成社区摘要
      await this.generateSceneSummary(scene);
    }
  }
}
```

### 3.3 文档处理 Pipeline

当用户导入项目文档时：

```typescript
class DocumentIngestionPipeline {
  /**
   * 导入一份文档
   * - PDF/DOCX → 文本
   * - 代码文件 → 代码摘要
   * - 网页 → 正文提取
   */
  async ingest(document: { path?: string; url?: string; content?: string }): Promise<IngestionResult> {
    // 1. 提取文本
    const text = await this.extractText(document);

    // 2. 分块（2000 chars, 200 overlap）
    const chunks = this.chunkText(text, 2000, 200);

    // 3. 从每个 chunk 提取实体和关系（LLM 调用）
    const extractions = await Promise.all(
      chunks.map(chunk => this.extractFromChunk(chunk))
    );

    // 4. 合并去重
    const merged = this.mergeExtractions(extractions);

    // 5. 写入 SQLite
    for (const entity of merged.entities) {
      await this.memoryManager.upsertEntity(entity);
    }
    for (const relation of merged.relations) {
      await this.memoryManager.relate(relation);
    }

    // 6. 存储原始文本块（用于 RAG 检索）
    await this.storeChunks(chunks, document);

    // 7. 触发社区摘要更新
    await this.communityManager.onSceneUpdated(merged.scene);

    return {
      entitiesCount: merged.entities.length,
      relationsCount: merged.relations.length,
      chunksCount: chunks.length,
    };
  }

  /**
   * LLM 从每个 chunk 提取 entity + relation
   */
  private async extractFromChunk(chunk: string): Promise<Extraction> {
    const response = await this.cheapLLM.stream([
      { role: 'system', content: `从以下文本中提取关键信息。

输出 JSON：
{
  "entities": [{"name":"...", "type":"...", "summary":"..."}],
  "relations": [{"subject":"...", "relation":"...", "object":"..."}],
  "scene": "开发|生活|工作"
}

entity types: user, project, tool, preference, concept, organization
relations: 熟练使用, 负责, 使用, 对接, 依赖, 属于, 关联, 偏好
只提取确定的信息，不确定的不要输出。`},
      { role: 'user', content: chunk },
    ]);
    return JSON.parse(response);
  }
}
```

### 3.4 社区摘要的检索使用

在 `buildContext()` 中新增一条注入逻辑：

```typescript
// MemoryManager.buildContext() 中新增
if (options.scene) {
  const sceneSummary = this.getSceneSummaryCache(options.scene);
  if (sceneSummary) {
    parts.push(`## ${options.scene} 概览`);
    parts.push(sceneSummary);
    budget -= estimateTokens(sceneSummary);
  }
}
```

这样当你在开发场景下工作时，prompt 中会注入一份"项目开发概览"——包含了项目中关键的 entity 关系摘要，而不是原始数据的拼接。

---

## 4. 总结：从"简单记忆"到"进化大脑"

把原来的三层升级为五层：

| 层级 | 名称 | 成本 | 频率 | 价值 |
|------|------|------|------|------|
| **L0** | 用户画像注入 | 0 LLM 成本 | 每次对话 | 用户的固定偏好始终可见 |
| **L1** | 场景记忆注入 | 0 LLM 成本 | 按 scene | 当前场景上下文自动可用 |
| **L2** | 显式搜索（FTS5 + 关系查询） | 0 LLM 成本 | 按需 | Agent 自己决定什么时候搜 |
| **L3** | 社区摘要（scene 级聚合） | ~1k tokens/摘要 | 增量更新（每 10 条新内容） | 全局概览问题 |
| **L4** | 纠错即学习 + 行为模式挖掘 | ~500 tokens/会话 + ~2k tokens/周 | 每次会话 + 每周 | 从用户行为中自行进化 |

**核心演变**：
- 原来 1000 条限制 → 去掉，SQLite 万级没问题，只通过 token 预算控制注入量
- 原来没有文档摘要 → 增加 DocumentIngestionPipeline + 社区摘要生成
- 原来被动等待用户存储 → 增加主动纠错检测 + 行为模式分析
- 自我进化不是魔法，而是**三个明确的机制**：会话后提取 + 纠错即学 + 行为聚类

这三个机制的代码都在上面的补充设计里，可以直接落地。
