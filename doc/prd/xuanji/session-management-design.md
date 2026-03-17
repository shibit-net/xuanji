# 会话管理系统设计（记忆深度集成）

## 设计日期
2026-03-16

## 概述

设计一个与记忆系统深度集成的会话管理系统，实现：
- **智能会话保存**：自动提取会话摘要、关键点，转化为记忆条目
- **会话-记忆双向关联**：会话引用记忆，记忆追溯会话
- **语义搜索**：基于向量检索的会话搜索
- **智能恢复**：恢复会话时自动加载相关记忆上下文
- **会话分类与标签**：自动分类 + 用户自定义标签

---

## 一、核心设计理念

### 1.1 会话即记忆源

**传统方式**：
```
会话 = 消息历史（独立存储）
记忆 = 人工提取的知识（独立存储）
```

**新设计**：
```
会话 → 自动提取摘要/关键点 → 生成 Timeline 记忆条目
       ↓
    记忆条目.sessionId → 反向引用会话
       ↓
    相关 Topic/Fact 记忆 → 双向关联
```

### 1.2 记忆驱动恢复

**传统方式**：
```
恢复会话 → 加载完整消息历史（50+ 条消息，10K+ tokens）
```

**新设计**：
```
恢复会话 → 加载摘要 + 关键点（500 tokens）
         → 检索相关记忆（5-10 条，1K tokens）
         → 仅加载最近 10 条消息（2K tokens）
总计: ~3.5K tokens (节省 65%)
```

### 1.3 语义组织

**传统方式**：
```
会话列表 → 按时间倒序 → 人工查找
```

**新设计**：
```
会话列表 → 语义搜索（向量检索）
         → 自动分类（编程/生活/学习/...）
         → 智能推荐（"相关会话"）
```

---

## 二、数据模型设计

### 2.1 会话元数据扩展

```typescript
export interface SessionMetadata {
  // ══ 现有字段 ══
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  workingDirectory: string;
  preview?: string;
  gitInfo?: { branch: string; commit: string };
  hookConfigHash?: string;

  // ══ 🆕 会话分类 ══
  /** 会话类型（自动分类） */
  category: SessionCategory;
  /** 用户自定义标签 */
  tags: string[];
  /** 会话主题（AI 提取） */
  topics: string[];

  // ══ 🆕 记忆关联 ══
  /** 该会话产生的记忆 ID 列表（自动生成） */
  memoryRefs: string[];
  /** 该会话引用的记忆 ID 列表（从 retrieve_memory 调用） */
  referencedMemories: string[];

  // ══ 🆕 统计与质量 ══
  /** 会话完成度（0-1，基于任务完成情况） */
  completeness: number;
  /** 会话价值评分（0-1，基于记忆提取质量） */
  valueScore: number;
  /** 总 token 消耗 */
  totalTokens: number;
  /** 总成本 */
  totalCost: number;
}

/** 会话类型 */
export type SessionCategory =
  | 'coding'        // 编程开发
  | 'debugging'     // 问题调试
  | 'learning'      // 学习/研究
  | 'life'          // 生活助理
  | 'planning'      // 规划设计
  | 'chat'          // 闲聊
  | 'other';        // 其他

/** 会话快照扩展 */
export interface SessionSnapshot {
  metadata: SessionMetadata;

  // ══ 记忆驱动字段（增强） ══
  /** AI 生成的会话摘要（结构化） */
  summary: SessionSummary;
  /** 关键点列表（分类） */
  keyPoints: KeyPoint[];
  /** 相关记忆 ID 引用 */
  memoryRefs: string[];
  /** 最近 N 条消息（默认 10） */
  recentMessages: Message[];

  // ══ 传统字段（兼容） ══
  messages: Message[];  // 旧会话保留，新会话为空
  checkpoints: Checkpoint[];
  usage?: SessionUsage;
  historyMessages?: HistoryMessage[];
}

/** 会话摘要（结构化） */
export interface SessionSummary {
  /** 会话主题（一句话） */
  title: string;
  /** 会话目标（用户想做什么） */
  goal: string;
  /** 执行过程（简要描述） */
  process: string;
  /** 最终结果（达成/未达成/部分达成） */
  outcome: 'completed' | 'partial' | 'abandoned';
  /** 生成时间 */
  generatedAt: number;
}

/** 关键点（分类） */
export interface KeyPoint {
  /** 类型 */
  type: 'decision' | 'finding' | 'todo' | 'error' | 'insight';
  /** 内容 */
  content: string;
  /** 重要性（影响是否转为记忆） */
  importance: 'high' | 'medium' | 'low';
  /** 相关消息索引 */
  messageIndex?: number;
}
```

### 2.2 记忆条目扩展

```typescript
export interface MemoryEntry {
  // ══ 现有字段 ══
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
  category?: MemoryCategory;
  topicId?: string;
  dayKey?: string;
  sessionId?: string;  // 已有
  relatedMemories?: string[];
  extractedFrom?: string;
  supersededBy?: string;

  // ══ 🆕 会话关联增强 ══
  /** 来源会话元数据（快照） */
  sessionMeta?: {
    sessionId: string;
    sessionName: string;
    sessionCategory: SessionCategory;
    createdAt: number;
  };

  /** 该记忆被哪些会话引用过（双向关联） */
  referencedBy?: string[];  // sessionId 列表
}
```

---

## 三、核心功能设计

### 3.1 智能会话保存

#### 流程

```
用户发起保存 (/save)
  ↓
1. 调用 SessionSummarizer（AI）
   - 生成结构化摘要（title/goal/process/outcome）
   - 提取关键点（decision/finding/todo/error/insight）
   - 分类会话类型（coding/debugging/learning/...）
   - 提取主题标签（topics）
   ↓
2. 调用 SessionMemoryExtractor（AI）
   - 将高价值关键点转为记忆条目
   - decision → MemoryEntry(type: decision, category: fact)
   - finding → MemoryEntry(type: project_fact, category: topic)
   - error + resolution → MemoryEntry(type: error_resolution, category: fact)
   ↓
3. 保存到 MemoryStore
   - 设置 sessionId 反向引用
   - 设置 category 和 topicId
   - 创建 Timeline 记忆（会话摘要）
   ↓
4. 保存会话快照
   - metadata.memoryRefs = 生成的记忆 ID 列表
   - summary = 结构化摘要
   - keyPoints = 关键点列表
   - recentMessages = 最近 10 条消息
   - messages = []（新模式不保存完整历史）
```

#### 实现

```typescript
// src/session/SessionMemoryExtractor.ts
export class SessionMemoryExtractor {
  private provider: ILLMProvider;
  private memoryStore: IMemoryStore;

  /**
   * 从会话中提取高价值记忆
   */
  async extract(
    messages: Message[],
    summary: SessionSummary,
    keyPoints: KeyPoint[]
  ): Promise<string[]> {
    const memoryIds: string[] = [];

    // 1. 创建 Timeline 记忆（会话摘要）
    const timelineMemory = await this.createTimelineMemory(summary);
    memoryIds.push(timelineMemory.id);

    // 2. 提取高价值关键点为独立记忆
    for (const point of keyPoints) {
      if (point.importance === 'high') {
        const memory = await this.createMemoryFromKeyPoint(point, timelineMemory.id);
        if (memory) {
          memoryIds.push(memory.id);
        }
      }
    }

    // 3. 提取用户偏好（如果首次出现）
    const preferences = await this.extractUserPreferences(messages);
    for (const pref of preferences) {
      memoryIds.push(pref.id);
    }

    return memoryIds;
  }

  private async createTimelineMemory(summary: SessionSummary): Promise<MemoryEntry> {
    return this.memoryStore.store({
      type: 'session_summary',
      category: 'timeline',
      content: `${summary.title}\n\n${summary.goal}\n\n${summary.process}`,
      keywords: [], // 自动提取
      source: 'session',
    });
  }

  private async createMemoryFromKeyPoint(
    point: KeyPoint,
    sourceMemoryId: string
  ): Promise<MemoryEntry | null> {
    const typeMap: Record<KeyPoint['type'], MemoryEntryType> = {
      'decision': 'decision',
      'finding': 'project_fact',
      'error': 'error_resolution',
      'insight': 'project_fact',
      'todo': 'project_fact',  // TODO 不单独存储
    };

    const type = typeMap[point.type];
    if (!type || point.type === 'todo') return null;

    return this.memoryStore.store({
      type,
      category: point.type === 'decision' ? 'fact' : 'topic',
      content: point.content,
      keywords: [],
      source: 'session',
      extractedFrom: sourceMemoryId,
    });
  }
}
```

### 3.2 智能会话恢复

#### 流程

```
用户恢复会话 (/resume <session-id>)
  ↓
1. 加载会话快照
   - 读取 summary, keyPoints, memoryRefs
   - 读取 recentMessages（最近 10 条）
   ↓
2. 检索相关记忆（HybridRetriever）
   - query = summary.title + summary.goal
   - 检索 Timeline 记忆（同主题的历史会话）
   - 检索 Topic 记忆（相关知识）
   - 检索 Fact 记忆（用户偏好）
   ↓
3. 构建上下文注入
   - System Prompt 注入记忆（formatMemoryContext）
   - 恢复最近 10 条消息到 MessageManager
   - 恢复 usage、historyMessages 到 UI
   ↓
4. 返回 ResumedSessionContext
   - summary, keyPoints, memories
   - messages（最近 10 条）
   - usage, historyMessages
```

#### Token 节省对比

| 场景 | 传统方式 | 新方式 | 节省 |
|------|---------|-------|------|
| 短会话（20 条消息） | 4K tokens | 2K tokens | 50% |
| 中等会话（50 条消息） | 10K tokens | 3.5K tokens | 65% |
| 长会话（100 条消息） | 20K tokens | 4K tokens | 80% |

### 3.3 会话语义搜索

#### 实现

```typescript
// src/session/SessionSearchEngine.ts
export class SessionSearchEngine {
  private vectorStore: VectorStore;
  private storage: SessionStorage;

  /**
   * 初始化：为所有会话建立向量索引
   */
  async initialize(): Promise<void> {
    const sessions = await this.storage.listSessions();

    for (const session of sessions) {
      const snapshot = await this.storage.loadSnapshot(session.id);
      if (snapshot.summary) {
        // 为会话摘要建立向量索引
        await this.vectorStore.add({
          id: session.id,
          text: `${snapshot.summary.title}\n${snapshot.summary.goal}`,
          metadata: {
            category: snapshot.metadata.category,
            tags: snapshot.metadata.tags,
            createdAt: snapshot.metadata.createdAt,
          },
        });
      }
    }
  }

  /**
   * 语义搜索会话
   */
  async search(query: string, options?: {
    category?: SessionCategory;
    tags?: string[];
    limit?: number;
  }): Promise<SessionListItem[]> {
    // 1. 向量检索
    const results = await this.vectorStore.search(query, {
      limit: options?.limit ?? 10,
    });

    // 2. 过滤
    let filtered = results;
    if (options?.category) {
      filtered = filtered.filter(r => r.metadata.category === options.category);
    }
    if (options?.tags && options.tags.length > 0) {
      filtered = filtered.filter(r =>
        options.tags!.some(tag => r.metadata.tags?.includes(tag))
      );
    }

    // 3. 加载完整元数据
    const sessions: SessionListItem[] = [];
    for (const result of filtered) {
      const meta = await this.storage.getMetadata(result.id);
      if (meta) {
        sessions.push({
          id: meta.id,
          name: meta.name,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          messageCount: meta.messageCount,
          workingDirectory: meta.workingDirectory,
          preview: meta.preview,
          category: meta.category,
          tags: meta.tags,
          similarity: result.similarity,  // 🆕 相似度
        });
      }
    }

    return sessions;
  }
}
```

### 3.4 会话自动分类

#### 实现

```typescript
// src/session/SessionClassifier.ts
export class SessionClassifier {
  private provider: ILLMProvider;

  /**
   * 根据会话内容自动分类
   */
  async classify(messages: Message[]): Promise<{
    category: SessionCategory;
    topics: string[];
    tags: string[];
  }> {
    const userMessages = messages
      .filter(m => m.role === 'user')
      .map(m => this.extractTextContent(m));

    const prompt = `根据以下对话内容，判断会话类型和主题：

对话内容：
${userMessages.slice(0, 5).join('\n---\n')}

请输出 JSON：
{
  "category": "coding|debugging|learning|life|planning|chat|other",
  "topics": ["主题1", "主题2"],  // 最多 3 个主题
  "tags": ["标签1", "标签2"]    // 最多 5 个标签
}`;

    const response = await this.provider.chat([
      { role: 'user', content: prompt }
    ]);

    const result = JSON.parse(response);
    return result;
  }
}
```

### 3.5 会话关联推荐

#### 实现

```typescript
// src/session/SessionRecommender.ts
export class SessionRecommender {
  private searchEngine: SessionSearchEngine;
  private memoryStore: IMemoryStore;

  /**
   * 推荐相关会话
   */
  async recommend(sessionId: string, limit: number = 5): Promise<{
    relatedSessions: SessionListItem[];
    reason: string;
  }[]> {
    const snapshot = await this.storage.loadSnapshot(sessionId);
    const recommendations: Array<{ relatedSessions: SessionListItem[]; reason: string }> = [];

    // 1. 基于主题推荐
    if (snapshot.metadata.topics.length > 0) {
      const topicQuery = snapshot.metadata.topics.join(' ');
      const topicSessions = await this.searchEngine.search(topicQuery, { limit: 3 });
      recommendations.push({
        relatedSessions: topicSessions,
        reason: `相同主题：${snapshot.metadata.topics.join('、')}`,
      });
    }

    // 2. 基于记忆关联推荐
    if (snapshot.memoryRefs.length > 0) {
      const memories = await this.memoryStore.getByIds(snapshot.memoryRefs);
      const relatedSessionIds = new Set<string>();

      for (const memory of memories) {
        if (memory.referencedBy) {
          memory.referencedBy.forEach(sid => relatedSessionIds.add(sid));
        }
      }

      const relatedSessions = await Promise.all(
        Array.from(relatedSessionIds).slice(0, 3).map(id => this.storage.getMetadata(id))
      );

      recommendations.push({
        relatedSessions: relatedSessions.filter(Boolean),
        reason: '共享记忆引用',
      });
    }

    // 3. 基于工作目录推荐
    const sameDirSessions = await this.searchEngine.search('', {
      filter: { workingDirectory: snapshot.metadata.workingDirectory },
      limit: 3,
    });

    recommendations.push({
      relatedSessions: sameDirSessions,
      reason: `相同项目：${snapshot.metadata.workingDirectory}`,
    });

    return recommendations;
  }
}
```

---

## 四、CLI 命令设计

### 4.1 会话管理命令

```bash
# 保存会话（自动生成摘要）
/save [name]

# 保存会话（指定分类和标签）
/save --category coding --tags bug-fix,performance

# 列出会话（按时间）
/sessions

# 列出会话（按分类）
/sessions --category coding

# 搜索会话（语义搜索）
/sessions search "修复登录问题"

# 恢复会话
/resume <session-id>

# 查看会话详情
/sessions info <session-id>

# 查看会话关联
/sessions related <session-id>

# 删除会话
/sessions delete <session-id>

# 导出会话（Markdown）
/sessions export <session-id> [output-file]

# 会话统计
/sessions stats
```

### 4.2 会话详情展示

```
╭────────────────────────────────────────────────────╮
│ 会话详情                                            │
├────────────────────────────────────────────────────┤
│ ID:       abc-123-def                              │
│ 名称:     修复用户登录 403 错误                     │
│ 分类:     🐛 调试                                   │
│ 标签:     bug-fix, authentication, backend        │
│ 创建:     2026-03-15 14:30                         │
│ 更新:     2026-03-15 15:45 (75 分钟前)            │
│ 消息:     42 条                                     │
│ Token:    12,543 (成本: $0.15)                     │
│ 完成度:   ✓ 已完成                                 │
├────────────────────────────────────────────────────┤
│ 📝 摘要                                             │
├────────────────────────────────────────────────────┤
│ 目标: 修复用户登录时的 403 错误                     │
│ 过程: 1. 排查 JWT token 验证逻辑                   │
│       2. 发现过期时间配置错误                       │
│       3. 修改配置并测试                             │
│ 结果: ✓ 问题已解决                                 │
├────────────────────────────────────────────────────┤
│ 🔑 关键点                                           │
├────────────────────────────────────────────────────┤
│ [决策] 将 JWT 过期时间从 1h 改为 24h               │
│ [发现] 老版本客户端未正确处理 token 刷新           │
│ [错误] UserService.ts:45 空指针异常 → 已修复      │
├────────────────────────────────────────────────────┤
│ 🧠 生成记忆 (3)                                     │
├────────────────────────────────────────────────────┤
│ • JWT 配置最佳实践 (project_fact)                  │
│ • 登录 403 错误排查步骤 (error_resolution)         │
│ • 会话摘要: 修复登录错误 (session_summary)         │
├────────────────────────────────────────────────────┤
│ 🔗 相关会话 (2)                                     │
├────────────────────────────────────────────────────┤
│ • [2天前] 实现 JWT 认证中间件 (相同主题)           │
│ • [1周前] 用户权限系统重构 (共享记忆)              │
╰────────────────────────────────────────────────────╯
```

---

## 五、GUI 设计

### 5.1 会话列表视图

```
┌─ 会话 ────────────────────────────────────────────┐
│ 🔍 [搜索会话...]                [分类▼] [标签▼]  │
├────────────────────────────────────────────────────┤
│                                                    │
│ 📅 今天                                            │
│ ┌────────────────────────────────────────────┐   │
│ │ 🐛 修复用户登录 403 错误                    │   │
│ │ 💬 42 条消息 • 75 分钟前 • ✓ 已完成         │   │
│ │ 🏷️ bug-fix, authentication                 │   │
│ └────────────────────────────────────────────┘   │
│                                                    │
│ ┌────────────────────────────────────────────┐   │
│ │ 💻 实现用户偏好设置功能                     │   │
│ │ 💬 28 条消息 • 3 小时前 • ⏸ 进行中          │   │
│ │ 🏷️ feature, ui, database                   │   │
│ └────────────────────────────────────────────┘   │
│                                                    │
│ 📅 昨天                                            │
│ ┌────────────────────────────────────────────┐   │
│ │ 📚 学习 React Hooks 最佳实践                │   │
│ │ 💬 15 条消息 • 1 天前 • ✓ 已完成            │   │
│ │ 🏷️ learning, react, hooks                  │   │
│ └────────────────────────────────────────────┘   │
│                                                    │
│ [加载更多...]                                      │
└────────────────────────────────────────────────────┘
```

### 5.2 会话详情视图（侧边栏）

```
┌─ 会话详情 ─────────────────────────────────────────┐
│                                                     │
│ 修复用户登录 403 错误                               │
│ 🐛 调试 • 2026-03-15 14:30                         │
│                                                     │
│ ─────────────────────────────────────              │
│                                                     │
│ 📝 摘要                                             │
│ 目标: 修复用户登录时的 403 错误                     │
│ 过程: 排查 JWT 验证逻辑，修复过期时间配置          │
│ 结果: ✓ 问题已解决                                 │
│                                                     │
│ ─────────────────────────────────────              │
│                                                     │
│ 🔑 关键点 (3)                                       │
│ • 决策: JWT 过期时间改为 24h                       │
│ • 发现: 老客户端未处理 token 刷新                  │
│ • 错误: UserService 空指针 → 已修复               │
│                                                     │
│ ─────────────────────────────────────              │
│                                                     │
│ 🧠 生成记忆 (3)                                     │
│ • JWT 配置最佳实践                                  │
│ • 登录 403 错误排查步骤                            │
│ • 会话摘要                                          │
│                                                     │
│ ─────────────────────────────────────              │
│                                                     │
│ 🔗 相关会话 (2)                                     │
│ • 实现 JWT 认证中间件 (相同主题)                   │
│ • 用户权限系统重构 (共享记忆)                      │
│                                                     │
│ ─────────────────────────────────────              │
│                                                     │
│ 📊 统计                                             │
│ 消息: 42 条                                         │
│ Token: 12,543                                      │
│ 成本: $0.15                                        │
│ 时长: 75 分钟                                       │
│                                                     │
│ [恢复会话] [导出] [删除]                           │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 5.3 会话搜索视图

```
┌─ 搜索会话 ─────────────────────────────────────────┐
│                                                     │
│ 🔍 [修复登录问题...........................]  [搜索] │
│                                                     │
│ 筛选: [分类▼] [标签▼] [时间▼] [完成度▼]          │
│                                                     │
│ ─────────────────────────────────────              │
│                                                     │
│ 找到 3 个相关会话                                   │
│                                                     │
│ ┌────────────────────────────────────────────┐   │
│ │ 🐛 修复用户登录 403 错误          相似度: 95% │   │
│ │ 💬 42 条消息 • 1 天前 • ✓ 已完成            │   │
│ │ 排查 JWT 验证逻辑，修复过期时间配置...      │   │
│ └────────────────────────────────────────────┘   │
│                                                     │
│ ┌────────────────────────────────────────────┐   │
│ │ 🔧 实现登录重试机制               相似度: 78% │   │
│ │ 💬 28 条消息 • 3 天前 • ✓ 已完成            │   │
│ │ 为登录失败添加自动重试和指数退避...         │   │
│ └────────────────────────────────────────────┘   │
│                                                     │
│ ┌────────────────────────────────────────────┐   │
│ │ 💻 优化登录页面加载速度           相似度: 65% │   │
│ │ 💬 15 条消息 • 1 周前 • ✓ 已完成            │   │
│ │ 通过懒加载和代码分割优化首屏加载...         │   │
│ └────────────────────────────────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 六、实施计划

### Phase 1: 基础增强（1-2 天）

**目标**: 完善现有记忆驱动模式

- [x] SessionSummarizer 增强（结构化摘要）
- [x] SessionMemoryExtractor（关键点 → 记忆条目）
- [x] SessionMetadata 扩展（category, tags, topics, memoryRefs）
- [ ] SessionClassifier（自动分类）

### Phase 2: 搜索与推荐（2-3 天）

**目标**: 语义搜索和关联推荐

- [ ] SessionSearchEngine（向量检索）
- [ ] 为现有会话建立向量索引
- [ ] SessionRecommender（关联推荐）
- [ ] CLI 命令实现（/sessions search）

### Phase 3: GUI 集成（2-3 天）

**目标**: GUI 会话管理界面

- [ ] 会话列表组件（SessionListView）
- [ ] 会话详情侧边栏（SessionDetailPanel）
- [ ] 会话搜索界面（SessionSearchView）
- [ ] 会话关联图谱（SessionGraphView）

### Phase 4: 优化与测试（1-2 天）

**目标**: 性能优化和测试

- [ ] 向量索引增量更新
- [ ] 会话保存性能优化（并行处理）
- [ ] Token 节省效果验证
- [ ] E2E 测试

---

## 七、关键指标

### 7.1 Token 节省

| 指标 | 目标 | 实际 |
|------|------|------|
| 短会话（20 条）恢复 | 节省 40%+ | - |
| 中等会话（50 条）恢复 | 节省 60%+ | - |
| 长会话（100 条）恢复 | 节省 75%+ | - |

### 7.2 记忆质量

| 指标 | 目标 | 实际 |
|------|------|------|
| 摘要准确度 | 80%+ | - |
| 关键点提取率 | 70%+ | - |
| 记忆条目转化率 | 30%+ | - |

### 7.3 用户体验

| 指标 | 目标 | 实际 |
|------|------|------|
| 会话搜索准确度 | 85%+ | - |
| 关联推荐相关性 | 75%+ | - |
| 会话保存耗时 | < 3s | - |

---

## 八、技术亮点

### 8.1 记忆驱动架构

- ✅ **会话即记忆源**：会话自动转化为记忆条目
- ✅ **双向关联**：会话 ↔ 记忆，可追溯可引用
- ✅ **智能检索**：基于向量的语义搜索

### 8.2 Token 优化

- ✅ **增量保存**：只保存最近 N 条消息
- ✅ **摘要驱动**：用摘要 + 关键点替代完整历史
- ✅ **按需加载**：恢复时检索相关记忆，而非全量加载

### 8.3 智能化

- ✅ **自动分类**：AI 自动判断会话类型
- ✅ **主题提取**：自动提取会话主题和标签
- ✅ **关联推荐**：基于主题、记忆、项目的智能推荐

---

## 九、未来展望

### 9.1 会话合并

自动检测和合并相关会话：
```
会话 A: 修复登录 bug (50 条消息)
会话 B: 继续修复登录 bug (30 条消息)
          ↓
会话 AB: 修复登录 bug (合并后 80 条，但只保存摘要)
```

### 9.2 会话模板

为常见场景创建会话模板：
```
模板: 代码 Review
- 自动分类: coding
- 预设标签: code-review, quality
- 自动记忆提取: code patterns, best practices
```

### 9.3 跨会话学习

从历史会话中学习用户偏好：
```
用户在过去 10 个编程会话中：
- 80% 使用 TypeScript
- 70% 遵循 ESLint 规则
- 60% 添加单元测试

→ 自动生成用户偏好记忆
→ 新会话自动应用偏好
```

### 9.4 会话分析

统计和可视化：
```
- 时间分布：每天/每周会话数量
- 类型分布：编程 60%, 调试 20%, 学习 15%, 其他 5%
- 效率分析：平均完成度、平均耗时
- 成本分析：总 token 消耗、总成本
```

---

## 十、总结

### ✅ 核心价值

1. **记忆深度集成**
   - 会话自动转化为记忆，记忆驱动会话恢复
   - 双向关联，可追溯可引用

2. **智能管理**
   - 语义搜索、自动分类、关联推荐
   - 告别时间倒序，拥抱智能组织

3. **Token 优化**
   - 节省 60-80% tokens
   - 降低成本，提升效率

4. **用户体验**
   - CLI + GUI 双界面
   - 简洁直观，功能强大

### 📈 预期效果

**Before**:
```
会话 = 完整消息历史（独立存储，难以管理）
记忆 = 人工提取（无会话关联）
恢复 = 加载全量消息（Token 浪费）
查找 = 按时间翻页（效率低下）
```

**After**:
```
会话 = 摘要 + 关键点 + 记忆引用（智能管理）
记忆 = 自动提取 + 会话关联（双向引用）
恢复 = 摘要 + 检索记忆 + 最近消息（Token 节省 60%+）
查找 = 语义搜索 + 关联推荐（智能高效）
```

---

## 相关文档

- 现有实现：`src/session/`
- 记忆系统：`src/memory/`
- 类型定义：`src/session/types.ts`
- 配置：`src/core/config/defaults.ts`
