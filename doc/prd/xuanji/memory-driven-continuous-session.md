# 记忆驱动的连续会话设计

## 背景

当前架构是"每个会话独立上下文",需要用户手动 `/save` 和 `/resume` 来切换会话。虽然已经实现了强大的记忆系统(向量检索、智能提取、主题提取),但记忆主要用于会话内优化,未充分利用记忆驱动会话间的连续性。

**核心问题**:
- 用户体验不连贯:每次新会话都是"空白"开始
- 上下文孤岛:之前的对话知识无法自动传递
- 会话切换成本高:打断工作流

## 目标

重新设计会话交互,借鉴 Claude Code 和 OpenClaw 的理念:
**"用户只有一个连续的对话流,后台自动管理记忆和上下文归档"**

## 设计方案

### 核心理念

1. **单一连续会话** - 用户视角只有一个"对话",无需关心会话边界
2. **记忆自动驱动** - 每轮对话自动检索相关记忆,注入 system prompt
3. **智能归档** - 达到阈值时自动归档旧消息,保留摘要在记忆中
4. **透明恢复** - 下次启动时,基于记忆恢复上下文(而非完整历史)
5. **直接切换** - 不保留旧模式,直接迁移到新架构

### 设计原则

1. **最小化用户感知** - 归档过程对用户透明,无需手动触发
2. **智能阈值判断** - 综合消息数、Token 数、时间等多维度判断归档时机
3. **质量优于数量** - 提取高质量记忆,而非机械地保存所有对话
4. **简化架构** - 不增加模式配置,直接修改现有行为

---

## 架构设计

### 1. 配置层:简化会话配置

```typescript
// src/core/types/config.ts
export interface SessionConfig {
  /** 归档触发条件(满足任一即触发) */
  archiveThresholds: {
    /** 消息数阈值(默认 50 条) */
    messageCount: number;
    /** Token 数阈值(默认 100k) */
    tokenCount: number;
    /** 时间阈值(默认 120 分钟) */
    timeMinutes: number;
  };

  /** 归档策略 */
  archiveStrategy: {
    /** 归档后保留最近消息数(默认 10) */
    keepRecentMessages: number;
    /** 是否生成会话摘要(默认 true) */
    generateSummary: boolean;
    /** 是否提取关键点(默认 true) */
    extractKeyPoints: boolean;
  };

  /** 启动时是否自动恢复上一次对话(默认 true) */
  autoResumeLastSession: boolean;
  /** 检索记忆条数(默认 20) */
  memoryRetrievalCount: number;
  /** 是否显示恢复提示(默认 true) */
  showResumeNotification: boolean;
}
```

### 2. 核心改造:直接修改 `SessionManager`

```typescript
// src/session/SessionManager.ts

/**
 * 会话生命周期管理（连续模式）
 *
 * 职责:
 * 1. 自动判断归档时机(基于阈值)
 * 2. 执行归档:提取记忆 → 生成摘要 → 保留最近消息
 * 3. 自动检索记忆并注入 system prompt
 * 4. 透明恢复上次对话
 */
export class SessionManager {
  // ... 现有字段保留 ...

  /** 会话配置 */
  private sessionConfig: SessionConfig;
  /** 上次归档后的消息起始索引 */
  private lastArchiveMessageIndex: number = 0;
  /** 上次归档时间 */
  private lastArchiveTime: number = Date.now();

  constructor(options?: SessionManagerOptions) {
    // ... 现有初始化代码 ...
    this.sessionConfig = options?.sessionConfig ?? DEFAULT_SESSION_CONFIG;
  }

  /**
   * 初始化:恢复上一次对话(如果启用)
   */
  async initialize(): Promise<{
    resumed: boolean;
    sessionId?: string;
    summary?: string;
    memories?: MemoryEntry[];
  }> {
    if (!this.sessionConfig.autoResumeLastSession) {
      return { resumed: false };
    }

    // 1. 查找最后一个会话
    const sessions = await this.sessionManager.list();
    const lastSession = sessions
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];

    if (!lastSession) {
      return { resumed: false };
    }

    // 2. 恢复会话上下文
    const context = await this.sessionManager.resume(lastSession.id);
    this.currentSessionId = context.sessionId;

    // 3. 检索相关记忆
    const memories = await this.memoryManager.retrieve(
      context.summary || '',
      { maxResults: this.sessionConfig.memoryRetrievalCount }
    );

    return {
      resumed: true,
      sessionId: context.sessionId,
      summary: context.summary,
      memories,
    };
  }

  /**
   * 检查是否需要归档
   */
  shouldArchive(
    messageCount: number,
    tokenCount: number,
    currentTime: number = Date.now()
  ): boolean {
    const { archiveThresholds } = this.sessionConfig;

    // 消息数超过阈值
    const messagesSinceArchive = messageCount - this.lastArchiveMessageIndex;
    if (messagesSinceArchive >= archiveThresholds.messageCount) {
      return true;
    }

    // Token 数超过阈值
    if (tokenCount >= archiveThresholds.tokenCount) {
      return true;
    }

    // 时间超过阈值
    const timeSinceArchive = currentTime - this.lastArchiveTime;
    const thresholdMs = archiveThresholds.timeMinutes * 60 * 1000;
    if (timeSinceArchive >= thresholdMs) {
      return true;
    }

    return false;
  }

  /**
   * 执行归档
   *
   * 流程:
   * 1. 生成会话摘要和关键点
   * 2. 提取记忆(调用 SmartMemoryExtractor)
   * 3. 保存到长期记忆
   * 4. 保留最近 N 条消息
   * 5. 更新归档状态
   */
  async archive(
    messages: Message[],
    currentMessageIndex: number
  ): Promise<{
    archivedCount: number;
    memoriesExtracted: number;
    summary?: string;
    keyPoints?: string[];
  }> {
    const { archiveStrategy } = this.sessionConfig;
    const now = Date.now();

    // 1. 确定归档范围(从上次归档到当前)
    const archiveMessages = messages.slice(
      this.lastArchiveMessageIndex,
      currentMessageIndex - archiveStrategy.keepRecentMessages
    );

    if (archiveMessages.length === 0) {
      return { archivedCount: 0, memoriesExtracted: 0 };
    }

    // 2. 生成会话摘要
    let summary: string | undefined;
    let keyPoints: string[] | undefined;

    if (archiveStrategy.generateSummary) {
      // 调用 SessionSummarizer
      const summaryResult = await this.generateSummary(archiveMessages);
      summary = summaryResult.summary;
      keyPoints = summaryResult.keyPoints;
    }

    // 3. 提取记忆
    const sessionMemory: SessionMemory = {
      sessionId: this.currentSessionId ?? 'continuous',
      userMessages: archiveMessages
        .filter(m => m.role === 'user')
        .map(m => typeof m.content === 'string' ? m.content : ''),
      assistantMessages: archiveMessages
        .filter(m => m.role === 'assistant')
        .map(m => typeof m.content === 'string' ? m.content : ''),
      summary,
      keyDecisions: keyPoints,
    };

    // 4. 保存到记忆系统(自动提取 + 持久化)
    await this.memoryManager.save(sessionMemory);

    // 5. 更新归档状态
    this.lastArchiveMessageIndex = currentMessageIndex - archiveStrategy.keepRecentMessages;
    this.lastArchiveTime = now;

    // 6. 获取提取的记忆数量(通过查询)
    const recentMemories = await this.memoryManager.retrieve(
      summary || '',
      { maxResults: 5 }
    );

    return {
      archivedCount: archiveMessages.length,
      memoriesExtracted: recentMemories.length,
      summary,
      keyPoints,
    };
  }

  /**
   * 检索相关记忆(用于注入 system prompt)
   */
  async retrieveMemories(query: string): Promise<MemoryEntry[]> {
    return this.memoryManager.retrieve(query, {
      maxResults: this.sessionConfig.memoryRetrievalCount,
    });
  }

  /**
   * 获取当前会话 ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * 设置当前会话 ID
   */
  setCurrentSessionId(id: string): void {
    this.currentSessionId = id;
  }

  // ─── 私有方法 ─────────────────────────────────────────

  private async generateSummary(messages: Message[]): Promise<{
    summary: string;
    keyPoints: string[];
  }> {
    // 这里复用 SessionSummarizer
    // 实现省略...
    return { summary: '', keyPoints: [] };
  }
}
```

### 3. 集成到 `ChatSession`

```typescript
// src/core/chat/ChatSession.ts

export class ChatSession {
  async init(options: InitOptions): Promise<void> {
    // ... 现有初始化代码 ...

    // 尝试恢复上一次对话
    const resumeResult = await this.sessionManager.initialize();

    if (resumeResult.resumed) {
      log.info(`Resumed session ${resumeResult.sessionId}`);

      // 注入恢复的记忆到 system prompt
      if (resumeResult.memories && resumeResult.memories.length > 0) {
        const memoryPrompt = this.memoryManager.formatForPrompt(resumeResult.memories);
        // 添加到 system message
        this.agentLoop.injectSystemPrompt(memoryPrompt);
      }

      // 显示恢复提示
      if (this.config.session?.showResumeNotification) {
        this.callbacks?.onResumeNotification?.(
          resumeResult.summary || '继续上次对话...',
          resumeResult.memories?.length || 0
        );
      }
    }
  }

  async run(userMessage: string): Promise<void> {
    // 每轮对话前检索相关记忆
    const memories = await this.sessionManager.retrieveMemories(userMessage);

    if (memories.length > 0) {
      const memoryPrompt = this.memoryManager.formatForPrompt(memories);
      this.agentLoop.injectSystemPrompt(memoryPrompt);
    }

    // 正常执行对话
    await this.agentLoop.run(userMessage);

    // 对话后检查是否需要归档
    const messageCount = this.agentLoop.getMessageHistory().length;
    const tokenCount = this.agentLoop.getTokenUsage().input + this.agentLoop.getTokenUsage().output;

    if (this.sessionManager.shouldArchive(messageCount, tokenCount)) {
      // 异步归档(不阻塞用户)
      this.archiveInBackground(messageCount).catch(err => {
        log.warn('Background archive failed:', err);
      });
    }
  }

  private async archiveInBackground(currentMessageIndex: number): Promise<void> {
    const messages = this.agentLoop.getMessageHistory();

    const result = await this.sessionManager.archive(messages, currentMessageIndex);

    log.info(
      `Auto-archived ${result.archivedCount} messages, ` +
      `extracted ${result.memoriesExtracted} memories`
    );

    // 通知用户归档完成
    this.callbacks?.onArchiveNotification?.(result);

    // 清理 AgentLoop 中的旧消息(保留最近的)
    const keepCount = this.config.session?.archiveStrategy?.keepRecentMessages ?? 10;
    this.agentLoop.truncateMessages(keepCount);
  }
}
```

### 4. 新增回调接口

```typescript
// src/core/chat/ChatSession.ts

export interface ChatSessionCallbacks extends AgentCallbacks {
  /** 恢复上次对话通知 */
  onResumeNotification?: (summary: string, memoryCount: number) => void;

  /** 自动归档通知 */
  onArchiveNotification?: (result: {
    archivedCount: number;
    memoriesExtracted: number;
    summary?: string;
  }) => void;
}
```

### 5. CLI 适配

```typescript
// src/cli/ChatView.tsx

const ChatView: React.FC<ChatViewProps> = ({ session, config }) => {
  const [archiveNotification, setArchiveNotification] = useState<string | null>(null);

  useEffect(() => {
    // 注册归档通知回调
    session.setCallbacks({
      ...session.getCallbacks(),
      onArchiveNotification: (result) => {
        setArchiveNotification(
          `📦 已归档 ${result.archivedCount} 条消息，提取 ${result.memoriesExtracted} 条记忆`
        );

        // 3 秒后自动消失
        setTimeout(() => setArchiveNotification(null), 3000);
      },
    });
  }, [session]);

  return (
    <Box flexDirection="column">
      {/* 归档通知(顶部提示) */}
      {archiveNotification && (
        <Box borderStyle="single" borderColor="green" paddingX={1}>
          <Text color="green">{archiveNotification}</Text>
        </Box>
      )}

      {/* 对话区域 */}
      {/* ... */}
    </Box>
  );
};
```

---

## 实现计划

### Phase 1: 基础架构(1-2 天)

- [ ] 简化配置类型 `SessionConfig`(删除 mode,直接改为连续模式配置)
- [ ] 在 `SessionManager` 中新增方法:
  - [ ] `shouldArchive()` - 阈值判断
  - [ ] `archive()` - 归档流程
  - [ ] `retrieveMemories()` - 记忆检索
  - [ ] `initialize()` - 自动恢复
- [ ] 集成到 `ChatSession.init()`

### Phase 2: 智能归档(1-2 天)

- [ ] `SessionManager.archive()` 集成 `SessionSummarizer` 生成摘要
- [ ] `SessionManager.archive()` 调用 `MemoryManager.save()` 提取记忆
- [ ] 实现 `AgentLoop.truncateMessages()` 截断旧消息
- [ ] 添加归档日志和统计

### Phase 3: 自动恢复(1 天)

- [ ] 实现启动时自动恢复上次对话
- [ ] 检索记忆并注入 system prompt
- [ ] 显示恢复提示(CLI/GUI)

### Phase 4: UI 适配(1 天)

- [ ] CLI:归档通知、恢复提示
- [ ] GUI:归档动画、记忆卡片展示
- [ ] 命令:`/archive` 手动触发归档
- [ ] 删除旧的 `/save` `/resume` 命令提示(保留实现以兼容)

### Phase 5: 测试与优化(1-2 天)

- [ ] 单元测试:`ContinuousSessionManager`
- [ ] 集成测试:完整归档流程
- [ ] 性能测试:大量消息归档
- [ ] 向后兼容测试:旧会话恢复

---

## 配置示例

### 默认配置

```typescript
// src/core/config/defaults.ts

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  archiveThresholds: {
    messageCount: 50,      // 50 条消息
    tokenCount: 100_000,   // 100k tokens
    timeMinutes: 120,      // 2 小时
  },

  archiveStrategy: {
    keepRecentMessages: 10,
    generateSummary: true,
    extractKeyPoints: true,
  },

  autoResumeLastSession: true,
  memoryRetrievalCount: 20,
  showResumeNotification: true,
};
```

### 用户自定义配置

```json
// ~/.xuanji/config.json

{
  "session": {
    "archiveThresholds": {
      "messageCount": 30,
      "tokenCount": 80000
    },
    "archiveStrategy": {
      "keepRecentMessages": 15
    },
    "autoResumeLastSession": false,
    "showResumeNotification": false
  }
}
```

---

## 向后兼容

### 1. 命令兼容

- `/archive` - 手动触发归档(新增)
- `/save` - 保留实现,但淡化提示(实际调用 archive)
- `/resume <session-id>` - 保留,用于切换到历史归档点
- `/sessions` - 列出所有已归档的会话片段

### 2. 数据兼容

- 旧会话(SessionSnapshot.messages 存在)读取时自动迁移:取最近 10 条作为 recentMessages
- 新会话直接使用 recentMessages + summary + keyPoints
- SessionStorage 向后兼容读取旧格式

---

## 用户体验示例

### 场景 1: 首次启动(空白)

```
$ xuanji

璇玑 v0.1.0
正在初始化...
✓ 已加载 0 条记忆

> 你好,我想用 TypeScript 写一个 HTTP 服务器
```

### 场景 2: 二次启动(自动恢复)

```
$ xuanji

璇玑 v0.1.0
正在初始化...
✓ 已加载 245 条记忆
✓ 恢复上次对话(检索到 12 条相关记忆)

💡 上次聊到:实现 HTTP 服务器的路由功能

> 继续,实现 POST 请求处理
```

### 场景 3: 自动归档(对用户透明)

```
> (连续对话 50 条消息后...)

📦 已归档 40 条消息,提取 8 条记忆(保留最近 10 条)

> (继续对话,无需关心归档)
```

### 场景 4: 手动触发归档

```
> /archive

📦 正在归档...
✓ 已归档 35 条消息,提取 6 条记忆(保留最近 10 条)

> (继续对话)
```

---

## 优势

1. **无缝体验** - 用户无需关心会话边界,专注对话内容
2. **自动优化** - 后台自动归档,避免上下文过长导致的性能问题
3. **知识积累** - 每次对话自动提取记忆,长期使用越来越"聪明"
4. **透明恢复** - 下次启动自动恢复,无需重新建立上下文
5. **简化架构** - 删除模式切换,直接提供最佳体验

---

## 潜在问题与解决方案

### 问题 1: 归档时机不准确

**风险**: 在对话中间突然归档,打断用户思路

**解决方案**:
- 仅在对话轮次结束后检查归档条件
- 归档前检查是否有未完成的工具调用
- 提供 `/pause-archive` 命令临时禁用自动归档

### 问题 2: 恢复后记忆不相关

**风险**: 检索到的记忆与当前对话无关

**解决方案**:
- 改进向量检索质量(调整混合评分权重)
- 使用会话摘要作为查询,而非单条消息
- 允许用户手动选择恢复的记忆范围

### 问题 3: 性能开销

**风险**: 每轮对话都检索记忆,增加延迟

**解决方案**:
- 记忆检索并行于用户输入处理
- 添加记忆缓存(短期记忆中缓存最近检索结果)
- 提供 `memoryRetrievalCount` 配置控制检索数量

---

## 总结

本设计方案通过 **直接迁移到连续会话架构**,充分利用已有的记忆系统,实现:

1. **单一连续对话流** - 用户视角无会话边界
2. **自动归档与恢复** - 后台管理上下文,对用户透明
3. **记忆驱动对话** - 每轮自动检索相关记忆,注入上下文
4. **简化架构** - 删除模式选择,直接提供最佳体验

实现路径清晰,分 5 个阶段渐进式推进,预计 5-7 天完成。
