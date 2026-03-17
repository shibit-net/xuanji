# 记忆驱动会话系统实施报告（方案 A）

## 实施日期
2026-03-16

## 设计目标

将会话系统从"完整消息历史驱动"改造为"记忆驱动"架构，实现：

1. **会话轻量化**：不再保存完整消息历史，只保存摘要和最近 N 条消息
2. **自动记忆归档**：对话内容自动提取为记忆条目
3. **动态上下文构建**：恢复会话时，根据摘要检索相关记忆
4. **渐进式迁移**：保持向后兼容，支持旧会话数据

---

## 已完成的改造

### 1. 类型定义扩展（`src/session/types.ts`）

#### SessionSnapshot 扩展

```typescript
export interface SessionSnapshot {
  metadata: SessionMetadata;

  // === 记忆驱动字段（新） ===
  summary?: string;          // AI 生成的会话摘要
  keyPoints?: string[];      // 关键决策/结论列表
  memoryRefs?: string[];     // 相关记忆 ID 引用
  recentMessages?: Message[];// 最近 N 条消息（兼容性）

  // === 传统字段（兼容） ===
  messages: Message[];       // 旧会话保留，新会话为 []
  checkpoints: Checkpoint[];
  usage?: SessionUsage;
  historyMessages?: HistoryMessage[];
}
```

**设计说明**：
- 新会话：`messages` 为空数组，`recentMessages` 保存最近 N 条
- 旧会话：`messages` 保留完整历史，`recentMessages` 为 undefined
- 向后兼容：resume() 时优先使用 `recentMessages`，降级到 `messages`

#### ResumedSessionContext 扩展

```typescript
export interface ResumedSessionContext {
  sessionId: string;

  // === 记忆驱动字段（新） ===
  summary?: string;          // 会话摘要
  keyPoints?: string[];      // 关键点列表
  memories?: Array<{         // 检索到的相关记忆
    id: string;
    content: string;
    tags?: string[];
    timestamp: number;
  }>;

  // === 传统字段 ===
  messages: Message[];       // 最近消息（非完整历史）
  usage: SessionUsage;
  historyMessages: HistoryMessage[];
}
```

---

### 2. 会话摘要生成器（`src/session/SessionSummarizer.ts`）

**核心功能**：
- 使用 LLM 分析会话历史，生成摘要和关键点
- 支持降级方案（LLM 失败时返回简单摘要）
- 输出格式：JSON（summary + keyPoints）

**LLM Prompt 设计**：
```
## 输出格式
{
  "summary": "会话整体摘要（1-3句话）",
  "keyPoints": [
    "关键点 1（决策/结论/待办）",
    "关键点 2",
    ...
  ]
}

## 摘要原则
- summary: 主题、目标、进展
- keyPoints: 决策 > 结论 > 待办（最多 10 个）
- 忽略闲聊、重复、无关内容
```

**使用示例**：
```typescript
const summarizer = new SessionSummarizer({
  provider: anthropicProvider,
  config: { model: 'claude-haiku-4-5-20251001' },
});

const result = await summarizer.summarize(messages);
// {
//   summary: "用户请求实现记忆驱动会话系统...",
//   keyPoints: [
//     "决定采用方案 A：渐进式混合模式",
//     "保留最近 10 条消息作为兼容性保障",
//     "每 5 轮自动归档为记忆"
//   ]
// }
```

---

### 3. SessionManager 改造

#### 构造函数扩展

```typescript
export interface MemoryDrivenConfig {
  enabled: boolean;               // 是否启用（默认 true）
  keepRecentMessages: number;     // 保留最近 N 条（默认 10）
  archiveEveryNTurns: number;     // 每 N 轮归档（默认 5，0 禁用）
  generateSummaryOnSave: boolean; // 保存时生成摘要（默认 true）
}

const sessionManager = new SessionManager({
  memoryDriven: {
    enabled: true,
    keepRecentMessages: 10,
    archiveEveryNTurns: 5,
  },
  provider: anthropicProvider,
  providerConfig: { model: 'claude-haiku-4-5-20251001' },
  memoryManager: memoryManager,
});
```

#### save() 方法改造

**新流程**：
```
1. 生成摘要和关键点（如果启用）
   └─> SessionSummarizer.summarize()
2. 只保留最近 N 条消息
   └─> messages.slice(-keepRecentMessages)
3. 保存快照：
   - summary / keyPoints / memoryRefs / recentMessages
   - messages = []（新模式）
```

**代码示例**：
```typescript
await sessionManager.save(messages, 'My Session', {
  usage: { input: 1000, output: 500, cost: 0.01 },
  memoryRefs: ['mem-001', 'mem-002'],
});
// 自动生成摘要，只保存最近 10 条消息
```

#### resume() 方法改造

**新流程**：
```
1. 加载快照
2. 检索相关记忆（如果有 memoryRefs）
   └─> memoryManager.retrieve({ query: summary })
3. 返回：summary + keyPoints + memories + recentMessages
```

**代码示例**：
```typescript
const context = await sessionManager.resume('session-123');
// {
//   summary: "...",
//   keyPoints: ["...", "..."],
//   memories: [{ id, content, tags, timestamp }, ...],
//   messages: [...最近 10 条消息...],
// }
```

#### 新增方法：archiveMessagesToMemory()

**用途**：将最近的消息归档为记忆条目

**策略**：
1. **智能提取**（优先）：使用 `SmartMemoryExtractor` 提取关键信息
2. **降级方案**：直接保存消息内容为记忆

**触发时机**：
- 每 N 轮对话（通过 `shouldAutoArchive()` 检查）
- 手动调用（如 `/archive` 命令）

**使用示例**：
```typescript
// 自动归档（每 5 轮）
if (sessionManager.shouldAutoArchive(currentTurnCount)) {
  const recentMessages = messages.slice(-10); // 归档最近 10 条
  const memoryIds = await sessionManager.archiveMessagesToMemory(
    recentMessages,
    sessionId
  );
  console.log(`Archived ${memoryIds.length} memories`);
}
```

---

## 配置参数说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `true` | 是否启用记忆驱动模式 |
| `keepRecentMessages` | `10` | 保留最近 N 条消息（0 表示全部保留） |
| `archiveEveryNTurns` | `5` | 每 N 轮自动归档（0 表示禁用自动归档） |
| `generateSummaryOnSave` | `true` | 保存时是否生成摘要 |

**调整建议**：
- **短对话**（问答、翻译）：`keepRecentMessages: 5`，无需归档
- **长对话**（编程、调试）：`keepRecentMessages: 20`，`archiveEveryNTurns: 10`
- **纯记忆驱动**（实验）：`keepRecentMessages: 0`，依赖记忆检索

---

## 兼容性保证

### 旧会话数据

**检测方式**：
```typescript
const isOldSession = snapshot.messages.length > 0 && !snapshot.recentMessages;
```

**恢复策略**：
```typescript
const messages = snapshot.recentMessages && snapshot.recentMessages.length > 0
  ? snapshot.recentMessages  // 新会话
  : snapshot.messages;        // 旧会话（完整历史）
```

### 迁移工具（待实现）

```typescript
// 伪代码
async function migrateOldSession(sessionId: string) {
  const snapshot = await storage.loadSnapshot(sessionId);
  const summary = await summarizer.summarize(snapshot.messages);
  const recentMessages = snapshot.messages.slice(-10);

  await storage.saveSnapshot({
    ...snapshot,
    summary: summary.summary,
    keyPoints: summary.keyPoints,
    recentMessages,
    messages: [], // 清空完整历史
  });
}
```

---

## 下一步工作

### Phase 1: 集成到 ChatSession（未完成）

- [ ] ChatSession 构造时初始化 SessionManager（传入 provider/memoryManager）
- [ ] AgentLoop 每轮结束时检查自动归档触发条件
- [ ] /save 命令调用新的 save() 方法
- [ ] /resume 命令处理新的 ResumedSessionContext

### Phase 2: GUI 适配（未完成）

- [ ] 会话列表显示摘要（而非 preview）
- [ ] 会话详情页展示关键点
- [ ] 恢复会话时展示相关记忆
- [ ] 配置面板支持调整 keepRecentMessages 等参数

### Phase 3: 测试和优化（未完成）

- [ ] 单元测试：SessionSummarizer
- [ ] 集成测试：save/resume 流程
- [ ] 性能测试：大量会话检索记忆的速度
- [ ] 摘要质量评估：人工标注 vs LLM 生成

### Phase 4: 高级功能（可选）

- [ ] 会话合并：多个相关会话的记忆整合
- [ ] 跨会话检索：基于记忆查找历史对话
- [ ] 记忆权重：重要记忆优先检索
- [ ] 自动标签：从摘要中提取标签

---

## 风险与挑战

### 1. LLM 摘要成本

**问题**：每次 save() 都调用 LLM 生成摘要，增加 token 消耗

**缓解措施**：
- 使用 Haiku 模型（低成本）
- 增量摘要：只对新消息生成摘要，合并到旧摘要
- 延迟生成：用户显式触发（如 `/summarize`）

### 2. 记忆检索质量

**问题**：摘要不准确导致检索到无关记忆

**缓解措施**：
- 摘要中包含关键词（tags）
- 混合检索：向量相似度 + 关键词匹配
- 用户反馈：允许手动标记相关/无关记忆

### 3. 上下文丢失

**问题**：只保留最近 N 条消息，可能丢失早期重要信息

**缓解措施**：
- 保留 N 可配置（默认 10，用户可调整到 50）
- 关键点提取：重要决策保存在 keyPoints 中
- 检查点机制：重要节点手动创建 checkpoint

---

## 总结

**已完成**：
- ✅ 类型定义扩展（SessionSnapshot/ResumedSessionContext）
- ✅ 会话摘要生成器（SessionSummarizer）
- ✅ SessionManager 改造（save/resume/archiveMessagesToMemory）
- ✅ 配置系统（MemoryDrivenConfig）
- ✅ 向后兼容设计

**待完成**：
- ⏳ ChatSession 集成
- ⏳ GUI 适配
- ⏳ 测试和优化

**关键优势**：
1. 会话文件大小固定（不随时间增长）
2. 上下文主要来自记忆检索（更灵活）
3. 渐进式迁移（不影响现有功能）
4. 可配置性强（适应不同场景）

**实施建议**：
1. 先在单个会话中测试（`enabled: true`）
2. 验证摘要质量和记忆检索效果
3. 根据用户反馈调整参数
4. 逐步推广到所有会话
