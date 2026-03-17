# JSONL 存储 + OpenClaw 优秀特性融合方案

## 设计日期
2026-03-16

## 核心理念

> **保持 JSONL 的性能，借鉴 OpenClaw 的组织和展示方式**

- **存储层**：JSONL（性能优先）
- **组织层**：时间线 + 主题（OpenClaw 风格）
- **展示层**：Markdown 格式（OpenClaw 风格）
- **刷新机制**：智能价值评估（增强版）
- **引用系统**：记忆链接和关联（OpenClaw 风格）

---

## 借鉴的 OpenClaw 优秀特性

### ✅ 特性 1: 70/30 混合搜索（已实现）

**OpenClaw 原理**：
```
score = 0.7 × vectorScore + 0.3 × bm25Score
```

**xuanji 增强版**（已实现）：
```typescript
// 基础权重自适应调整
const HYBRID_WEIGHTS = {
  vectorSimilarity: 0.5,
  keywordMatch: 0.15,
  timeDecay: 0.3,        // xuanji 独有：遗忘曲线
  accessFrequency: 0.05, // xuanji 独有：访问频次
};

// 最终得分 = 基础分 × 时间衰减 × 访问频次 × 重要性
```

**状态**：✅ 已超越 OpenClaw（增加了遗忘曲线和访问频次）

---

### 🎯 特性 2: 记忆逻辑分层（新增）

**OpenClaw 组织**：
```
memory/
├── daily/2026-03-16.md    # 时间线
├── daily/2026-03-15.md
└── topics/                # 主题聚合（手动维护）
```

**xuanji 改进方案**（JSONL 存储 + 虚拟分层）：

#### 物理存储（不变）
```
~/.xuanji/
└── memory.jsonl    # 单一文件，性能优秀
```

#### 逻辑组织（新增字段）
```typescript
interface MemoryEntry {
  id: string;
  type: MemoryEntryType;
  content: string;
  keywords: string[];

  // === OpenClaw 启发的新字段 ===
  category: 'timeline' | 'topic' | 'fact';  // 记忆分类
  topicId?: string;                          // 所属主题 ID
  relatedMemories?: string[];                // 关联记忆 ID
  extractedFrom?: string;                    // 提取来源（timeline → topic）

  // === 时间线字段 ===
  dayKey: string;                            // "2026-03-16"（按日分组）
  sessionId?: string;                        // 所属会话 ID

  // 已有字段
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
  confidence: number;
  metadata?: MemoryMetadata;
}
```

**示例**：

```json
// Timeline 类型（日常对话）
{
  "id": "mem-timeline-20260316-001",
  "category": "timeline",
  "dayKey": "2026-03-16",
  "sessionId": "sess-abc123",
  "type": "conversation",
  "content": "User asked about package managers, recommended Bun",
  "keywords": ["package-manager", "bun", "npm"],
  "createdAt": "2026-03-16T09:30:00Z",
  "lastAccessedAt": "2026-03-16T09:30:00Z",
  "accessCount": 1,
  "confidence": 0.8
}

// Topic 类型（提炼的知识）
{
  "id": "mem-topic-user-pref-001",
  "category": "topic",
  "topicId": "user-preferences",
  "type": "user_preference",
  "content": "User prefers Bun over npm for package management",
  "keywords": ["preference", "bun", "npm"],
  "relatedMemories": ["mem-timeline-20260316-001", "mem-timeline-20260115-042"],
  "extractedFrom": "mem-timeline-20260316-001",
  "createdAt": "2026-03-16T09:35:00Z",
  "lastAccessedAt": "2026-03-16T14:20:00Z",
  "accessCount": 15,
  "confidence": 0.95,
  "metadata": { "importance": "high" }
}

// Fact 类型（用户事实）
{
  "id": "mem-fact-user-001",
  "category": "fact",
  "topicId": "user-facts",
  "type": "user_fact",
  "content": "User is a software engineer working on AI projects",
  "keywords": ["user", "profession", "ai"],
  "createdAt": "2026-02-15T10:00:00Z",
  "lastAccessedAt": "2026-03-16T09:30:00Z",
  "accessCount": 50,
  "confidence": 1.0,
  "metadata": { "importance": "high" }
}
```

**优势**：
- ✅ 保持 JSONL 单文件性能
- ✅ 逻辑上分为时间线、主题、事实
- ✅ 通过字段查询实现虚拟分层
- ✅ 支持记忆关联和追溯

---

### 🎯 特性 3: 自动主题提取（新增）

**OpenClaw 方式**：手动维护主题文件

**xuanji 改进**：自动从 timeline 提取 topic

```typescript
export class TopicExtractor {
  /**
   * 每天自动提取主题记忆
   *
   * 触发时机：
   * 1. 每晚 23:00 自动执行
   * 2. 新会话结束时执行
   * 3. 手动调用 /memory extract
   */
  async extractTopicsFromTimeline(): Promise<void> {
    // 1. 获取今天的 timeline 记忆
    const today = new Date().toISOString().split('T')[0];
    const timelineMemories = await this.memoryManager.retrieve('', {
      filters: { category: 'timeline', dayKey: today },
    });

    // 2. 分组：按主题分类
    const grouped = this.groupByTopic(timelineMemories);

    // 3. 每个主题提取关键知识
    for (const [topicId, memories] of grouped) {
      // 使用 LLM 提取核心知识点
      const extracted = await this.extractCoreKnowledge(memories, topicId);

      // 4. 检查是否已存在类似 topic
      const existing = await this.findSimilarTopic(extracted);

      if (existing) {
        // 合并到已有 topic
        await this.mergeTopic(existing, extracted, memories);
      } else {
        // 创建新 topic
        await this.createTopic(extracted, memories);
      }
    }
  }

  /**
   * 按主题分组（基于关键词聚类）
   */
  private groupByTopic(memories: MemoryEntry[]): Map<string, MemoryEntry[]> {
    const groups = new Map<string, MemoryEntry[]>();

    for (const memory of memories) {
      // 基于关键词相似度聚类
      const topicId = this.inferTopicId(memory);

      if (!groups.has(topicId)) {
        groups.set(topicId, []);
      }
      groups.get(topicId)!.push(memory);
    }

    return groups;
  }

  /**
   * 使用 LLM 提取核心知识
   */
  private async extractCoreKnowledge(
    memories: MemoryEntry[],
    topicId: string
  ): Promise<string> {
    const prompt = `
请从以下对话片段中提取核心知识点（1-2 句话）。

## 对话内容
${memories.map(m => `- ${m.content}`).join('\n')}

## 输出要求
- 简洁：1-2 句话
- 准确：反映核心事实或决策
- 可复用：未来遇到相同主题时有参考价值

直接输出提取的知识点，不要其他解释。
    `.trim();

    const response = await this.llmProvider.chat({
      messages: [{ role: 'user', content: prompt }],
      model: 'claude-haiku-4-5',
      temperature: 0.2,
    });

    return response.content.trim();
  }

  /**
   * 创建 topic 记忆
   */
  private async createTopic(
    content: string,
    sourceMemories: MemoryEntry[]
  ): Promise<void> {
    await this.memoryManager.store({
      category: 'topic',
      topicId: this.inferTopicId(sourceMemories[0]),
      content,
      keywords: this.extractKeywords(content),
      relatedMemories: sourceMemories.map(m => m.id),
      extractedFrom: sourceMemories[0].id,
      metadata: {
        importance: this.inferImportance(sourceMemories),
      },
    });
  }
}
```

**效果**：
- 每天自动将 timeline 记忆提炼为 topic
- topic 记忆更简洁、更可复用
- 保留 timeline → topic 的追溯链路

---

### 🎯 特性 4: Markdown 格式化展示（新增）

**OpenClaw 方式**：记忆本身就是 Markdown

**xuanji 改进**：JSONL 存储，传给 LLM 时格式化为 Markdown

```typescript
export class MemoryFormatter {
  /**
   * 将记忆格式化为 Markdown（传给 LLM）
   *
   * 借鉴 OpenClaw 的展示风格
   */
  formatForPrompt(memories: MemoryEntry[]): string {
    // 1. 按分类分组
    const byCategory = this.groupByCategory(memories);

    const sections: string[] = [];

    // 2. 用户偏好和事实（最重要）
    if (byCategory.fact?.length > 0) {
      sections.push(this.formatFacts(byCategory.fact));
    }

    // 3. 主题知识
    if (byCategory.topic?.length > 0) {
      sections.push(this.formatTopics(byCategory.topic));
    }

    // 4. 最近对话（如果需要上下文）
    if (byCategory.timeline?.length > 0) {
      sections.push(this.formatTimeline(byCategory.timeline));
    }

    return `
## 📝 Relevant Past Context

${sections.join('\n\n---\n\n')}

**Note**: This context is retrieved from your long-term memory based on relevance to the current query.
    `.trim();
  }

  /**
   * 格式化用户事实（OpenClaw 风格）
   */
  private formatFacts(facts: MemoryEntry[]): string {
    const items = facts.map(fact => {
      const importance = fact.metadata?.importance === 'high' ? '⭐' : '';
      return `- ${importance} **${fact.content}**`;
    });

    return `
### 👤 User Facts

${items.join('\n')}
    `.trim();
  }

  /**
   * 格式化主题知识（OpenClaw 风格）
   */
  private formatTopics(topics: MemoryEntry[]): string {
    const byTopic = this.groupByTopicId(topics);

    const sections = Array.from(byTopic.entries()).map(([topicId, memories]) => {
      const topicName = this.getTopicName(topicId);
      const items = memories.map(m => {
        const accessCount = m.accessCount > 10 ? ` (used ${m.accessCount} times)` : '';
        return `  - ${m.content}${accessCount}`;
      });

      return `**${topicName}**:\n${items.join('\n')}`;
    });

    return `
### 📚 Knowledge & Preferences

${sections.join('\n\n')}
    `.trim();
  }

  /**
   * 格式化时间线（OpenClaw 风格，简化版）
   */
  private formatTimeline(timeline: MemoryEntry[]): string {
    // 按日期分组
    const byDay = this.groupByDay(timeline);

    const items = Array.from(byDay.entries())
      .slice(-3) // 最近 3 天
      .map(([day, memories]) => {
        const date = this.formatDate(day);
        const content = memories.map(m => `  - ${m.content}`).join('\n');
        return `**${date}**:\n${content}`;
      });

    return `
### 📅 Recent Context

${items.join('\n\n')}
    `.trim();
  }
}
```

**效果示例**：

```markdown
## 📝 Relevant Past Context

### 👤 User Facts

- ⭐ **User is a software engineer working on AI projects**
- ⭐ **User prefers Bun over npm for package management**
- **User's timezone is Asia/Shanghai**

---

### 📚 Knowledge & Preferences

**User Preferences**:
  - Uses Bun for package management (used 15 times)
  - Prefers TypeScript over JavaScript
  - Likes functional programming style

**Project Knowledge**:
  - Project xuanji uses Ink 5 for terminal UI
  - Memory system uses JSONL for storage
  - Embedding model is all-MiniLM-L6-v2

---

### 📅 Recent Context

**Today (2026-03-16)**:
  - Discussed memory system architecture
  - Decided to keep JSONL storage
  - Implemented human-like memory weights

**Yesterday (2026-03-15)**:
  - Fixed GUI layout issues
  - Added resizable panels

**Note**: This context is retrieved from your long-term memory based on relevance to the current query.
```

**优势**：
- ✅ 清晰的层级结构（像 OpenClaw）
- ✅ 重要性标记（⭐）
- ✅ 访问频次展示（透明化）
- ✅ JSONL 存储，性能不受影响

---

### 🎯 特性 5: 智能记忆刷新（借鉴 + 增强）

**OpenClaw 方式**：
```typescript
// 简单触发
if (currentTokens > maxTokens * 0.75) {
  await archiveAllMessages();
}
```

**xuanji 增强版**（已在人类化记忆设计中规划）：

```typescript
export class IntelligentMemoryFlush {
  /**
   * 智能记忆刷新（OpenClaw 启发 + LLM 价值评估）
   */
  async checkAndFlush(context: {
    messages: Message[];
    currentTokens: number;
    maxTokens: number;
    timeSinceLastFlush: number;
  }): Promise<void> {
    // 触发条件（借鉴 OpenClaw）
    const shouldFlush =
      context.currentTokens > context.maxTokens * 0.75 ||
      context.timeSinceLastFlush > 30 * 60 * 1000; // 30 分钟

    if (!shouldFlush) return;

    // 1. LLM 评估价值（xuanji 增强）
    const evaluation = await this.evaluateMemoryValue(context.messages);

    // 2. 分类归档
    for (const segment of evaluation.segments) {
      if (segment.category === 'topic') {
        // 提取为主题记忆（可复用）
        await this.memoryManager.store({
          category: 'topic',
          topicId: segment.topicId,
          content: segment.extracted,
          type: segment.memoryType,
          metadata: { importance: segment.importance },
        });
      } else if (segment.category === 'timeline') {
        // 归档为时间线（上下文完整性）
        await this.memoryManager.store({
          category: 'timeline',
          dayKey: this.getToday(),
          content: segment.content,
          type: 'conversation',
        });
      }
      // category === 'discard' 的内容不保存
    }

    // 3. 清理消息历史（保留最近 5 条）
    await this.pruneMessages(context.messages, 5);

    log.info('Memory flushed:', {
      total: evaluation.segments.length,
      topics: evaluation.segments.filter(s => s.category === 'topic').length,
      timeline: evaluation.segments.filter(s => s.category === 'timeline').length,
      discarded: evaluation.segments.filter(s => s.category === 'discard').length,
    });
  }
}
```

**对比**：

| 特性 | OpenClaw | xuanji 增强版 |
|------|----------|--------------|
| 触发条件 | 上下文 > 75% | ✓ 上下文 > 75%<br>✓ 距上次 > 30 分钟 |
| 价值评估 | 无（全部归档） | ✓ LLM 评估<br>✓ 分类：topic/timeline/discard |
| 归档策略 | 追加到日志 | ✓ topic 提取<br>✓ timeline 归档<br>✓ 低价值丢弃 |

---

### 🎯 特性 6: 记忆引用和链接（新增）

**OpenClaw 方式**：Markdown 链接
```markdown
**相关记忆**:
- [2026-02-20: React 性能优化](../timeline/2026-02/20.md#0915)
- [2026-03-05: useMemo vs useState](../timeline/2026-03/05.md#1620)
```

**xuanji 改进**（JSONL + 关联字段）：

```typescript
interface MemoryEntry {
  // ... 其他字段 ...

  // 记忆关联（OpenClaw 启发）
  relatedMemories?: string[];       // 相关记忆 ID
  extractedFrom?: string;           // 提取来源（timeline → topic）
  supersededBy?: string;            // 被替代（旧记忆 → 新记忆）
  references?: string[];            // 引用的记忆 ID
}
```

**查询时自动展开关联**：

```typescript
export class MemoryRetriever {
  /**
   * 检索记忆时自动加载关联记忆
   */
  async retrieveWithRelated(
    query: string,
    options?: { maxRelated?: number }
  ): Promise<MemoryEntry[]> {
    // 1. 检索主记忆
    const primary = await this.retrieve(query, options);

    // 2. 加载关联记忆（1 层深度）
    const relatedIds = new Set<string>();
    for (const memory of primary) {
      if (memory.relatedMemories) {
        memory.relatedMemories.forEach(id => relatedIds.add(id));
      }
      if (memory.extractedFrom) {
        relatedIds.add(memory.extractedFrom);
      }
    }

    // 3. 批量加载关联记忆
    const related = await this.loadByIds(Array.from(relatedIds));

    // 4. 合并并去重
    return this.deduplicateAndRank([...primary, ...related]);
  }
}
```

**格式化展示**：

```markdown
### 📚 Knowledge & Preferences

**User Preferences**:
  - Uses Bun for package management (used 15 times)
    → Extracted from: [2026-03-16: Package manager discussion](#mem-timeline-20260316-001)
    → Related: [2026-01-15: npm vs yarn comparison](#mem-timeline-20260115-042)
```

---

## 实施计划

### Phase 1: 扩展 MemoryEntry 类型（1 天）

```typescript
// src/memory/types.ts

export interface MemoryEntry {
  // === 现有字段 ===
  id: string;
  type: MemoryEntryType;
  content: string;
  keywords: string[];
  source: string;
  confidence: number;
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
  projectPath?: string;
  metadata?: MemoryMetadata;

  // === OpenClaw 启发的新字段 ===
  category?: 'timeline' | 'topic' | 'fact';  // 记忆分类
  topicId?: string;                           // 所属主题 ID
  dayKey?: string;                            // "2026-03-16"（时间线分组）
  sessionId?: string;                         // 所属会话 ID
  relatedMemories?: string[];                 // 关联记忆 ID
  extractedFrom?: string;                     // 提取来源
  supersededBy?: string;                      // 被替代
}
```

### Phase 2: 实现 MemoryFormatter（2 天）

```typescript
// src/memory/MemoryFormatter.ts

export class MemoryFormatter {
  formatForPrompt(memories: MemoryEntry[]): string;
  formatFacts(facts: MemoryEntry[]): string;
  formatTopics(topics: MemoryEntry[]): string;
  formatTimeline(timeline: MemoryEntry[]): string;
}
```

### Phase 3: 实现 TopicExtractor（3 天）

```typescript
// src/memory/TopicExtractor.ts

export class TopicExtractor {
  extractTopicsFromTimeline(): Promise<void>;
  groupByTopic(memories: MemoryEntry[]): Map<string, MemoryEntry[]>;
  extractCoreKnowledge(memories: MemoryEntry[], topicId: string): Promise<string>;
  createTopic(content: string, sourceMemories: MemoryEntry[]): Promise<void>;
  mergeTopic(existing: MemoryEntry, extracted: string, sources: MemoryEntry[]): Promise<void>;
}
```

### Phase 4: 实现 IntelligentMemoryFlush（2 天）

```typescript
// src/memory/IntelligentMemoryFlush.ts

export class IntelligentMemoryFlush {
  checkAndFlush(context: FlushContext): Promise<void>;
  evaluateMemoryValue(messages: Message[]): Promise<Evaluation>;
  pruneMessages(messages: Message[], keepCount: number): Promise<void>;
}
```

### Phase 5: 集成到 ChatSession（1 天）

```typescript
// src/core/chat/ChatSession.ts

// 每轮对话后检查是否需要刷新
await this.intelligentFlush.checkAndFlush({
  messages: this.getMessages(),
  currentTokens: this.getCurrentTokens(),
  maxTokens: this.config.maxTokens,
  timeSinceLastFlush: Date.now() - this.lastFlushTime,
});

// 每天自动提取主题
await this.topicExtractor.extractTopicsFromTimeline();

// 检索时使用 Markdown 格式化
const memories = await this.memoryManager.retrieve(userMessage);
const formatted = this.memoryFormatter.formatForPrompt(memories);
this.messageManager.setSystemPromptSuffix(formatted, 'memory');
```

### Phase 6: 测试和优化（2 天）

**总工作量**：11 天

---

## 配置选项

```typescript
// ~/.xuanji/config.json

{
  "memory": {
    "backend": "jsonl",  // 保持不变

    // OpenClaw 启发的新配置
    "organization": {
      "autoExtractTopics": true,         // 自动提取主题
      "extractInterval": "daily",         // daily | weekly
      "topicMergeThreshold": 0.85,       // 主题合并相似度阈值
    },

    "formatting": {
      "style": "openclaw",               // openclaw | simple
      "showAccessCount": true,           // 显示访问次数
      "showRelatedMemories": true,       // 显示关联记忆
      "maxTimelineItems": 10,            // 最多显示最近 N 条时间线
    },

    "flush": {
      "mode": "intelligent",             // intelligent | simple
      "tokenThreshold": 0.75,            // 上下文阈值
      "timeThreshold": 1800,             // 时间阈值（秒）
      "valueThreshold": 50,              // 最低价值评分
      "autoDiscard": true,               // 自动丢弃低价值内容
    },

    // 已有配置
    "decayHalfLifeDays": 30,
    "minRetrieveWeight": 0.25,
  }
}
```

---

## 优势总结

### 相比纯 JSONL

| 改进 | 效果 |
|------|------|
| ✅ 逻辑分层 | timeline/topic/fact 清晰分类 |
| ✅ Markdown 展示 | LLM 看到的是清晰格式化内容 |
| ✅ 自动提取 | timeline 自动提炼为 topic |
| ✅ 记忆关联 | 支持追溯和关联查询 |
| ✅ 智能刷新 | 价值评估，避免噪音 |

### 相比纯 Markdown（OpenClaw）

| 优势 | 说明 |
|------|------|
| ✅ 性能 5× | 单文件 JSONL，加载快 |
| ✅ 实施成本低 | 增量改进，非重写 |
| ✅ 自动化 | 主题提取全自动，无需手动维护 |
| ✅ 关联查询 | 通过 ID 链接，比文件链接更可靠 |

### 借鉴的 OpenClaw 优点

| 特性 | 借鉴方式 |
|------|---------|
| ✅ 70/30 混合搜索 | 已实现（增强版） |
| ✅ 时间线组织 | dayKey 字段分组 |
| ✅ 主题聚合 | category + topicId |
| ✅ Markdown 展示 | MemoryFormatter |
| ✅ 智能刷新 | IntelligentMemoryFlush |
| ✅ 记忆链接 | relatedMemories 字段 |

---

## 示例效果

### 存储（JSONL，性能优秀）

```json
{"id":"mem-topic-001","category":"topic","topicId":"user-preferences","content":"User prefers Bun over npm","relatedMemories":["mem-timeline-001","mem-timeline-042"],"accessCount":15}
{"id":"mem-timeline-001","category":"timeline","dayKey":"2026-03-16","content":"Discussed package managers","sessionId":"sess-123"}
{"id":"mem-fact-001","category":"fact","topicId":"user-facts","content":"User is a software engineer","accessCount":50}
```

### 展示（Markdown，OpenClaw 风格）

```markdown
## 📝 Relevant Past Context

### 👤 User Facts

- ⭐ **User is a software engineer working on AI projects**
- ⭐ **User prefers Bun over npm for package management**

### 📚 Knowledge & Preferences

**User Preferences**:
  - Uses Bun for package management (used 15 times)
    → Related: [2026-03-16: Package manager discussion](#mem-timeline-001)

### 📅 Recent Context

**Today (2026-03-16)**:
  - Discussed package managers
  - Decided to keep JSONL storage
```

---

## 总结

**核心思路**：
- **存储**：JSONL（性能）
- **组织**：虚拟分层（OpenClaw 风格）
- **展示**：Markdown 格式（OpenClaw 风格）
- **刷新**：智能价值评估（增强版）
- **关联**：ID 链接（更可靠）

**优势**：
- ✅ 保持 JSONL 的性能（5× 速度）
- ✅ 借鉴 OpenClaw 的清晰展示
- ✅ 自动化（无需手动维护主题文件）
- ✅ 增量实施（11 天完成）

**下一步**：
1. 扩展 MemoryEntry 类型（1 天）
2. 实现 MemoryFormatter（2 天）
3. 实现 TopicExtractor（3 天）
4. 实现 IntelligentMemoryFlush（2 天）
5. 集成到 ChatSession（1 天）
6. 测试和优化（2 天）
