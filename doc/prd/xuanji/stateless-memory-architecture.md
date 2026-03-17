# Xuanji 无会话记忆架构设计

## 设计目标

去掉传统的"会话"概念，完全依赖记忆系统维护上下文，实现：
- 跨会话的连续对话（记得上次聊到哪里）
- 无限上下文窗口（不受 token 限制）
- 知识积累（越用越了解用户和项目）
- 成本优化（只发送相关上下文）

---

## 架构对比

### 当前架构（会话驱动）

```
用户输入
  ↓
ChatSession（管理 message history）
  ↓
AgentLoop（发送完整历史给 LLM）
  ↓
LLM 响应（基于完整上下文）
```

**问题**：
- Token 窗口限制（8k-200k）
- 跨会话失忆（重启后需要重新解释）
- 成本高（每次发送完整历史）
- 无法积累长期知识

### 新架构（记忆驱动）

```
用户输入
  ↓
MemoryCoordinator（理解意图 + 检索相关记忆）
  ↓
ContextReconstructor（重建上下文）
  ↓
AgentLoop（发送动态上下文给 LLM）
  ↓
LLM 响应（基于相关上下文）
  ↓
MemoryWriter（保存新记忆）
```

**优势**：
- 无限上下文（记忆数据库无限）
- 跨会话连续性（记得几个月前的对话）
- 成本优化（只检索相关片段）
- 知识积累（用户偏好、项目知识）

---

## 三层记忆架构

### Layer 1: 工作记忆（Working Memory）

**生命周期**：当前任务期间

**内容**：
```typescript
interface WorkingMemory {
  // 当前任务上下文
  currentTask: {
    type: 'coding' | 'debugging' | 'discussion' | 'research';
    description: string;
    startedAt: number;
    context: {
      files: string[];              // 正在操作的文件
      lastCommands: string[];       // 最近执行的命令
      variables: Record<string, any>; // 上下文变量
      pendingActions: string[];     // 待完成的子任务
    };
  };

  // 最近 5 轮对话（用于代词消解）
  recentExchanges: Array<{
    user: string;
    assistant: string;
    timestamp: number;
    toolCalls?: string[];
  }>;

  // 临时引用
  references: {
    'that_file': string;
    'the_function': string;
    // 代词指代的实体
  };
}
```

**用途**：
- 代词消解："继续"、"那个文件"指代什么
- 多轮对话连贯性
- 任务跟踪

**清理策略**：
- 任务完成后保存摘要到短期记忆
- 清空工作记忆
- 保留关键引用（文件路径等）

---

### Layer 2: 短期记忆（Short-term Memory）

**生命周期**：7-30 天

**内容**：
```typescript
interface ShortTermMemory {
  // 每日摘要
  dailySummaries: Array<{
    date: string;
    summary: string;              // LLM 生成的摘要
    topics: string[];             // 主题标签
    files: string[];              // 涉及的文件
    keyDecisions: string[];       // 重要决策
    embedding: number[];          // 向量表示
  }>;

  // 原始对话（未压缩）
  rawExchanges: Array<{
    user: string;
    assistant: string;
    timestamp: number;
    toolCalls: ToolCall[];
    embedding: number[];
  }>;
}
```

**存储**：
- SQLite + sqlite-vec（向量检索）
- 表结构：
  ```sql
  CREATE TABLE short_term_memory (
    id TEXT PRIMARY KEY,
    type TEXT,              -- 'exchange' | 'summary'
    content TEXT,
    metadata JSON,          -- {topics, files, ...}
    embedding BLOB,
    created_at INTEGER,
    compressed BOOLEAN DEFAULT 0
  );

  CREATE VIRTUAL TABLE memory_vec USING vec0(
    id TEXT PRIMARY KEY,
    embedding FLOAT[384]
  );
  ```

**压缩策略**：
- 每日定时任务（凌晨 2 点）
- 将昨天的对话压缩为摘要
- 保留原始对话 7 天，删除后只保留摘要

---

### Layer 3: 长期记忆（Long-term Memory）

**生命周期**：永久

**内容**：
```typescript
interface LongTermMemory {
  // 事实性知识
  facts: Array<{
    type: 'project_info' | 'api_doc' | 'code_pattern';
    content: string;
    source: string;           // 来源（文件路径、URL）
    confidence: number;       // 置信度（0-1）
    lastUpdated: number;
    embedding: number[];
  }>;

  // 用户偏好
  preferences: Array<{
    category: 'code_style' | 'workflow' | 'tools';
    preference: string;       // "喜欢用 TypeScript"
    strength: number;         // 强度（基于出现频率）
    examples: string[];       // 佐证示例
  }>;

  // 技能和模式
  skills: Array<{
    name: string;             // "如何调试 React 组件"
    description: string;
    steps: string[];
    successRate: number;      // 历史成功率
  }>;
}
```

**更新策略**：
- 自动提取：从对话中识别事实性陈述
- 冲突检测：新信息与旧信息冲突时，标记为待确认
- 置信度衰减：长时间未使用的知识降低置信度

---

## 核心模块

### 1. MemoryCoordinator（记忆协调器）

**职责**：根据用户输入检索并重建上下文

```typescript
// src/memory/MemoryCoordinator.ts

export class MemoryCoordinator {
  constructor(
    private workingMemory: WorkingMemoryManager,
    private shortTermStore: VectorStore,
    private longTermStore: VectorStore,
    private embedding: EmbeddingService
  ) {}

  /**
   * 主入口：根据用户输入构建上下文
   */
  async buildContext(userInput: string): Promise<ContextBundle> {
    // 1. 意图理解
    const intent = await this.analyzeIntent(userInput);

    // 2. 代词消解
    const resolved = await this.resolveReferences(userInput, intent);

    // 3. 混合检索
    const memories = await this.retrieveRelevantMemories(resolved, {
      semanticWeight: 0.5,
      timeWeight: 0.3,
      taskWeight: 0.2,
    });

    // 4. 上下文重建
    const context = await this.reconstructContext(memories);

    // 5. 更新工作记忆
    await this.workingMemory.update(userInput, intent);

    return context;
  }

  /**
   * 意图分析
   */
  private async analyzeIntent(userInput: string): Promise<Intent> {
    // 快速规则匹配
    if (/^继续|接着|然后/.test(userInput)) {
      return { type: 'continue', target: 'last_task' };
    }

    if (/那个|这个|刚才/.test(userInput)) {
      return { type: 'reference', needsResolution: true };
    }

    if (/帮我|请|能不能/.test(userInput)) {
      return { type: 'new_task', requiresContext: true };
    }

    // LLM 语义理解（复杂情况）
    return { type: 'general', requiresContext: true };
  }

  /**
   * 代词消解
   */
  private async resolveReferences(
    userInput: string,
    intent: Intent
  ): Promise<string> {
    if (!intent.needsResolution) return userInput;

    const references = this.workingMemory.getReferences();
    let resolved = userInput;

    // 替换代词
    if (/那个文件|这个文件/.test(userInput) && references.file) {
      resolved = resolved.replace(/那个文件|这个文件/, references.file);
    }

    if (/继续/.test(userInput) && references.task) {
      resolved = `继续${references.task}：${userInput}`;
    }

    return resolved;
  }

  /**
   * 混合检索策略
   */
  private async retrieveRelevantMemories(
    query: string,
    weights: { semanticWeight: number; timeWeight: number; taskWeight: number }
  ): Promise<Memory[]> {
    // 1. 向量检索（语义相似）
    const embedding = await this.embedding.embed(query);
    const semanticMatches = await this.shortTermStore.search(embedding, 20);

    // 2. 时间衰减评分
    const now = Date.now();
    const timeScores = semanticMatches.map((m) => {
      const hoursSince = (now - m.timestamp) / (1000 * 60 * 60);
      return Math.exp(-hoursSince / 168); // 7天半衰期
    });

    // 3. 任务相关性评分
    const currentTask = this.workingMemory.getCurrentTask();
    const taskScores = semanticMatches.map((m) => {
      return this.calculateTaskRelevance(m, currentTask);
    });

    // 4. 混合评分
    const scored = semanticMatches.map((m, i) => ({
      memory: m,
      score:
        m.similarity * weights.semanticWeight +
        timeScores[i] * weights.timeWeight +
        taskScores[i] * weights.taskWeight,
    }));

    // 5. 返回 Top 10
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((s) => s.memory);
  }

  /**
   * 任务相关性计算
   */
  private calculateTaskRelevance(memory: Memory, task: Task | null): number {
    if (!task) return 0;

    let score = 0;

    // 文件重叠度
    const fileOverlap = this.calculateOverlap(
      memory.metadata.files || [],
      task.context.files
    );
    score += fileOverlap * 0.5;

    // 主题相似度
    const topicOverlap = this.calculateOverlap(
      memory.metadata.topics || [],
      task.topics || []
    );
    score += topicOverlap * 0.3;

    // 工具调用相似度
    const toolOverlap = this.calculateOverlap(
      memory.metadata.tools || [],
      task.context.lastCommands
    );
    score += toolOverlap * 0.2;

    return Math.min(score, 1.0);
  }
}
```

---

### 2. WorkingMemoryManager（工作记忆管理器）

```typescript
// src/memory/WorkingMemoryManager.ts

export class WorkingMemoryManager {
  private memory: WorkingMemory = {
    currentTask: null,
    recentExchanges: [],
    references: {},
  };

  /**
   * 更新工作记忆
   */
  async update(userInput: string, intent: Intent): Promise<void> {
    // 1. 添加到最近对话
    this.memory.recentExchanges.push({
      user: userInput,
      assistant: '', // 待填充
      timestamp: Date.now(),
    });

    // 保留最近 5 轮
    if (this.memory.recentExchanges.length > 5) {
      this.memory.recentExchanges.shift();
    }

    // 2. 更新任务状态
    if (intent.type === 'new_task') {
      await this.startNewTask(userInput);
    } else if (intent.type === 'continue') {
      // 任务继续，不变
    }

    // 3. 提取引用实体
    await this.extractReferences(userInput);
  }

  /**
   * 开始新任务
   */
  private async startNewTask(userInput: string): Promise<void> {
    // 如果有旧任务，保存摘要
    if (this.memory.currentTask) {
      await this.archiveCurrentTask();
    }

    // 创建新任务
    this.memory.currentTask = {
      type: this.inferTaskType(userInput),
      description: userInput,
      startedAt: Date.now(),
      context: {
        files: [],
        lastCommands: [],
        variables: {},
        pendingActions: [],
      },
    };
  }

  /**
   * 提取引用实体（NER）
   */
  private async extractReferences(text: string): Promise<void> {
    // 文件路径
    const fileMatches = text.match(/[\w/.-]+\.(ts|js|tsx|jsx|py|md)/g);
    if (fileMatches && fileMatches.length > 0) {
      this.memory.references.file = fileMatches[0];
    }

    // 函数名
    const funcMatches = text.match(/\b[a-z_][a-zA-Z0-9_]*\s*\(/g);
    if (funcMatches && funcMatches.length > 0) {
      this.memory.references.function = funcMatches[0].replace('(', '');
    }
  }

  /**
   * 归档当前任务
   */
  private async archiveCurrentTask(): Promise<void> {
    if (!this.memory.currentTask) return;

    const summary = await this.generateTaskSummary(this.memory.currentTask);

    // 保存到短期记忆
    await this.shortTermStore.add({
      type: 'task_summary',
      content: summary,
      metadata: {
        taskType: this.memory.currentTask.type,
        duration: Date.now() - this.memory.currentTask.startedAt,
        files: this.memory.currentTask.context.files,
      },
      timestamp: Date.now(),
    });
  }
}
```

---

### 3. ContextReconstructor（上下文重建器）

```typescript
// src/memory/ContextReconstructor.ts

export class ContextReconstructor {
  /**
   * 从记忆片段重建完整上下文
   */
  async reconstructContext(memories: Memory[]): Promise<ContextBundle> {
    // 1. 分类记忆
    const categorized = this.categorizeMemories(memories);

    // 2. 构建系统上下文
    const systemContext = this.buildSystemContext(categorized);

    // 3. 构建最近历史
    const recentHistory = this.buildRecentHistory(categorized.recent);

    // 4. 构建知识库
    const knowledgeBase = this.buildKnowledgeBase(categorized.facts);

    return {
      systemContext,
      recentHistory,
      knowledgeBase,
      totalTokens: this.estimateTokens(systemContext + recentHistory + knowledgeBase),
    };
  }

  /**
   * 分类记忆
   */
  private categorizeMemories(memories: Memory[]): CategorizedMemories {
    return {
      recent: memories.filter((m) => m.type === 'exchange' || m.type === 'summary'),
      facts: memories.filter((m) => m.type === 'fact'),
      preferences: memories.filter((m) => m.type === 'preference'),
      working: memories.filter((m) => m.metadata?.taskId === this.currentTaskId),
    };
  }

  /**
   * 构建系统上下文（注入 system prompt）
   */
  private buildSystemContext(categorized: CategorizedMemories): string {
    const parts: string[] = [];

    // 用户偏好
    if (categorized.preferences.length > 0) {
      parts.push('## 用户偏好');
      parts.push(categorized.preferences.map((p) => `- ${p.content}`).join('\n'));
    }

    // 项目知识
    const projectFacts = categorized.facts.filter((f) => f.metadata.type === 'project_info');
    if (projectFacts.length > 0) {
      parts.push('## 项目信息');
      parts.push(projectFacts.map((f) => f.content).join('\n'));
    }

    // 当前任务
    if (categorized.working.length > 0) {
      parts.push('## 当前任务');
      parts.push(`任务类型: ${this.currentTask?.type}`);
      parts.push(`任务描述: ${this.currentTask?.description}`);
      parts.push(`相关文件: ${this.currentTask?.context.files.join(', ')}`);
    }

    return parts.join('\n\n');
  }

  /**
   * 构建最近历史（用于代词消解和连续对话）
   */
  private buildRecentHistory(recent: Memory[]): string {
    // 最近 3-5 轮对话
    const exchanges = recent.slice(-5);

    return exchanges
      .map((m) => {
        if (m.type === 'exchange') {
          return `User: ${m.content.user}\nAssistant: ${m.content.assistant}`;
        } else if (m.type === 'summary') {
          return `[Earlier] ${m.content}`;
        }
        return '';
      })
      .join('\n\n');
  }

  /**
   * 构建知识库
   */
  private buildKnowledgeBase(facts: Memory[]): string {
    return facts
      .sort((a, b) => b.metadata.confidence - a.metadata.confidence)
      .slice(0, 10) // Top 10 相关事实
      .map((f) => `- ${f.content} (来源: ${f.metadata.source})`)
      .join('\n');
  }
}
```

---

### 4. MemoryWriter（记忆写入器）

```typescript
// src/memory/MemoryWriter.ts

export class MemoryWriter {
  /**
   * 保存对话到记忆
   */
  async saveExchange(
    userInput: string,
    assistantResponse: string,
    metadata: ExchangeMetadata
  ): Promise<void> {
    // 1. 生成 embedding
    const embedding = await this.embedding.embed(userInput + ' ' + assistantResponse);

    // 2. 提取元数据
    const enrichedMetadata = {
      ...metadata,
      topics: await this.extractTopics(userInput, assistantResponse),
      files: this.extractFiles(assistantResponse),
      tools: metadata.toolCalls?.map((t) => t.name) || [],
    };

    // 3. 保存到短期记忆
    await this.shortTermStore.add({
      id: `exchange-${Date.now()}`,
      type: 'exchange',
      content: {
        user: userInput,
        assistant: assistantResponse,
      },
      metadata: enrichedMetadata,
      embedding,
      timestamp: Date.now(),
    });

    // 4. 提取长期知识
    await this.extractLongTermKnowledge(userInput, assistantResponse);
  }

  /**
   * 提取长期知识（事实、偏好）
   */
  private async extractLongTermKnowledge(
    userInput: string,
    assistantResponse: string
  ): Promise<void> {
    // 使用 LLM 提取事实性陈述
    const prompt = `
从以下对话中提取需要长期记住的信息：

User: ${userInput}
Assistant: ${assistantResponse}

请提取：
1. 事实性知识（项目信息、API 用法、配置等）
2. 用户偏好（代码风格、工作流程等）

以 JSON 格式返回：
{
  "facts": ["事实1", "事实2"],
  "preferences": ["偏好1", "偏好2"]
}
`;

    const response = await this.llm.generate(prompt);
    const extracted = JSON.parse(response.text);

    // 保存到长期记忆
    for (const fact of extracted.facts) {
      await this.longTermStore.add({
        type: 'fact',
        content: fact,
        metadata: {
          source: `exchange-${Date.now()}`,
          confidence: 0.8,
        },
        timestamp: Date.now(),
      });
    }

    for (const pref of extracted.preferences) {
      await this.updatePreference(pref);
    }
  }
}
```

---

### 5. MemoryCompressor（记忆压缩器）

```typescript
// src/memory/MemoryCompressor.ts

export class MemoryCompressor {
  /**
   * 定时压缩任务（每日凌晨 2 点）
   */
  async compressDailyMemories(): Promise<void> {
    const yesterday = this.getYesterdayRange();
    const exchanges = await this.shortTermStore.query({
      type: 'exchange',
      timestamp: { gte: yesterday.start, lte: yesterday.end },
      compressed: false,
    });

    if (exchanges.length === 0) return;

    // 使用 LLM 生成摘要
    const summary = await this.generateDailySummary(exchanges);

    // 保存摘要
    await this.shortTermStore.add({
      type: 'daily_summary',
      content: summary.text,
      metadata: {
        date: yesterday.date,
        originalCount: exchanges.length,
        topics: summary.topics,
        files: summary.files,
        keyDecisions: summary.decisions,
      },
      embedding: await this.embedding.embed(summary.text),
      timestamp: Date.now(),
    });

    // 标记原始对话为已压缩
    await this.shortTermStore.updateMany(
      exchanges.map((e) => e.id),
      { compressed: true }
    );

    // 7 天后删除原始对话
    this.scheduleCleanup(exchanges, 7 * 24 * 60 * 60 * 1000);
  }

  /**
   * 生成每日摘要
   */
  private async generateDailySummary(exchanges: Memory[]): Promise<DailySummary> {
    const prompt = `
请总结以下对话记录（${exchanges.length} 条）：

${exchanges.map((e, i) => `[${i + 1}] User: ${e.content.user}\nAssistant: ${e.content.assistant}`).join('\n\n')}

要求：
1. 提取关键信息和决策
2. 列出涉及的主要话题
3. 列出修改的文件
4. 保留重要的上下文细节
5. 控制在 300 字以内

返回 JSON 格式：
{
  "text": "摘要内容",
  "topics": ["话题1", "话题2"],
  "files": ["文件1", "文件2"],
  "decisions": ["决策1", "决策2"]
}
`;

    const response = await this.llm.generate(prompt);
    return JSON.parse(response.text);
  }
}
```

---

## 集成到 ChatSession

### 修改 ChatSession.run()

```typescript
// src/core/chat/ChatSession.ts

export class ChatSession {
  private memoryCoordinator: MemoryCoordinator;
  private memoryWriter: MemoryWriter;

  async run(userInput: string): Promise<void> {
    // 1. 从记忆构建上下文（替代 message history）
    const context = await this.memoryCoordinator.buildContext(userInput);

    // 2. 注入上下文到 system prompt
    const enhancedSystemPrompt = `
${this.agentConfig.systemPrompt}

${context.systemContext}

## 最近对话
${context.recentHistory}

## 相关知识
${context.knowledgeBase}
`;

    // 3. 运行 Agent Loop（只发送当前轮输入）
    const result = await this.agentLoop.run([
      { role: 'user', content: userInput },
    ], {
      systemPrompt: enhancedSystemPrompt,
    });

    // 4. 保存到记忆
    await this.memoryWriter.saveExchange(userInput, result.text, {
      toolCalls: result.toolCalls,
      tokenUsage: result.usage,
    });

    // 5. 更新工作记忆
    this.memoryCoordinator.updateWorkingMemory(userInput, result.text);
  }
}
```

---

## 性能优化

### 1. 缓存策略

```typescript
class MemoryCache {
  // 工作记忆常驻内存
  private workingMemory: WorkingMemory;

  // 短期记忆 LRU 缓存
  private recentCache = new LRU<string, Memory[]>({
    max: 100,
    ttl: 1000 * 60 * 5, // 5 分钟
  });

  // Embedding 缓存
  private embeddingCache = new LRU<string, number[]>({
    max: 1000,
    ttl: 1000 * 60 * 60, // 1 小时
  });
}
```

### 2. 异步压缩

```typescript
// 后台线程运行
setInterval(async () => {
  await memoryCompressor.compressDailyMemories();
}, 24 * 60 * 60 * 1000); // 每 24 小时
```

### 3. 向量索引优化

```sql
-- 使用 sqlite-vec 的 IVF 索引
CREATE INDEX idx_memory_vec ON memory_vec USING ivf(embedding, 256);
```

---

## 迁移路径

### Phase 1: 混合模式（保留会话 + 添加记忆）

- 保留现有 message history
- 并行运行记忆系统
- 从记忆检索额外上下文注入 system prompt
- 用户可选择启用/禁用记忆增强

### Phase 2: 记忆优先（会话降级为备份）

- 默认使用记忆构建上下文
- message history 仅作为回退（记忆检索失败时）
- 添加"忘记"命令（清空工作记忆）

### Phase 3: 纯记忆模式（移除会话）

- 完全移除 SessionStorage 和 message history
- 所有上下文从记忆重建
- 添加记忆管理 UI（查看、编辑、删除记忆）

---

## 测试计划

### 1. 代词消解测试

```
User: 帮我写一个 React 组件
Assistant: [生成组件代码]
User: 把它改成 TypeScript
// 应该理解"它"指代刚生成的组件
```

### 2. 跨会话连续性测试

```
第一天:
User: 我在做一个 Electron 项目
Assistant: [回复]

第二天（新会话）:
User: 继续昨天的项目，帮我添加一个窗口
// 应该记得昨天的 Electron 项目
```

### 3. 长期知识积累测试

```
多次对话中提到"我喜欢用 Vue3 + TypeScript"
一周后:
User: 帮我搭建一个新项目
// 应该主动建议 Vue3 + TypeScript
```

---

## 总结

### 核心改动

1. **新增模块**（6 个）：
   - `MemoryCoordinator` - 记忆协调
   - `WorkingMemoryManager` - 工作记忆
   - `ContextReconstructor` - 上下文重建
   - `MemoryWriter` - 记忆写入
   - `MemoryCompressor` - 记忆压缩
   - `MemoryCache` - 缓存管理

2. **修改模块**（2 个）：
   - `ChatSession` - 使用记忆代替 message history
   - `AgentLoop` - 接受动态 system prompt

3. **数据库扩展**：
   - 短期记忆表（sqlite-vec）
   - 长期记忆表
   - 向量索引

### 预计工作量

- **Phase 1**（混合模式）：20-30 小时
- **Phase 2**（记忆优先）：10-15 小时
- **Phase 3**（纯记忆模式）：5-10 小时
- **总计**：35-55 小时

### 风险

1. **上下文不准确** - 检索结果可能不相关
2. **性能瓶颈** - 每次对话都要向量检索
3. **调试困难** - 难以追踪为什么给出某个回答
4. **用户体验** - 需要明确告知用户"记忆中"vs"遗忘"

### 建议

**不要完全去掉会话**，而是采用**混合模式**：
- 保留短期会话（当前任务）
- 长期上下文从记忆检索
- 用户可选择"开始新任务"（清空工作记忆）或"继续上次任务"

这样既获得了记忆的优势（跨会话连续性、知识积累），又保留了会话的可靠性（短期上下文准确）。
