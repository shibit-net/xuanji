# 记忆驱动 vs 会话驱动 架构对比

## 当前状态（混合模式）

### 会话系统（传统）
- **存储**: 完整的对话历史（Message[]）
- **隔离**: 按会话 ID 分组
- **检索**: 按时间线性检索
- **用户体验**: 需要显式"新建会话"、"切换会话"

### 记忆系统（现代）
- **存储**: 语义化的知识片段（MemoryEntry）
- **隔离**: 无边界，全局共享
- **检索**: 按相关性向量检索
- **用户体验**: 隐式学习，无需管理

## 架构演进路径

### Phase 1: 会话 + 记忆（当前）
```typescript
ChatSession {
  messages: Message[]              // 短期缓存
  memoryManager.retrieve(query)    // 长期检索

  // 用户需要手动管理会话
  save() → SessionStorage
  resume() → 恢复历史
}
```

**问题**：
- ❌ 会话切换打断思路
- ❌ 重要上下文被会话边界割裂
- ❌ 用户需要记住"哪个会话讨论了什么"

### Phase 2: 记忆优先（推荐）
```typescript
MemoryDrivenChat {
  currentWindow: Message[]         // 滑动窗口（最近 10 条）
  relevantMemories: MemoryEntry[]  // 动态检索

  onUserInput(input) {
    // 1. 检索相关记忆
    const memories = await memoryManager.retrieve(input);

    // 2. 构建上下文
    const context = [...relevantMemories, ...currentWindow];

    // 3. LLM 响应
    const response = await llm.chat(context);

    // 4. 提取新记忆
    await memoryManager.extract(response);
  }
}
```

**优势**：
- ✅ 自然对话流程，无会话概念
- ✅ 跨时间上下文延续
- ✅ 按相关性智能检索
- ✅ 符合人类记忆模型

### Phase 3: 纯记忆驱动（未来）
```typescript
// 完全移除会话概念
Agent {
  // 只有记忆，没有会话
  memory: UnifiedMemory

  // 所有历史对话变成记忆的一部分
  chat(input) →
    retrieve(input) →
    generate(context) →
    extract(response)
}
```

## GUI 改造建议

### 当前 GUI（会话中心）
```
┌─ 侧边栏 ──────────┐
│ 📁 会话列表        │
│   • 今天           │
│     - 重构项目     │
│     - 修复 Bug     │
│   • 昨天           │
│     - 架构讨论     │
│                    │
│ [+ 新建会话]       │
└───────────────────┘
```

### 推荐 GUI（记忆中心）
```
┌─ 侧边栏 ──────────┐
│ 🧠 智能记忆        │
│   📌 固定话题       │
│     - Xuanji 架构  │
│     - 性能优化     │
│                    │
│   🕐 最近对话       │
│     - 2 小时前     │
│     - 昨天 15:30   │
│                    │
│ [🔍 搜索历史]      │
│ [🧹 清空对话]      │
└───────────────────┘
```

### 关键变化

| 会话驱动 | 记忆驱动 |
|---------|---------|
| 新建会话 | 清空对话（清空滑动窗口） |
| 会话列表 | 历史记录 |
| 切换会话 | 搜索历史 |
| 保存会话 | 固定话题（Pin Topic） |
| 删除会话 | 清理记忆（归档） |

## 实施步骤

### Step 1: 淡化会话（立即）
1. 移除"新建会话"按钮 → "清空对话"
2. 侧边栏改为"历史记录"（不强调会话边界）
3. 自动创建隐式会话（用户无感知）

### Step 2: 引入固定话题（近期）
```typescript
interface PinnedTopic {
  id: string;
  name: string;
  description: string;
  relatedMemories: string[];  // Memory IDs
  createdAt: Date;
}

// 用户可以：
// - 给当前对话打标签 → 创建 PinnedTopic
// - 点击 PinnedTopic → 检索相关记忆 + 继续对话
```

### Step 3: 完全记忆驱动（长期）
1. 移除 SessionManager
2. HistoryStore 只记录时间线（用于搜索）
3. 所有上下文通过 MemoryManager.retrieve() 获取

## 兼容性

### 保留功能
- ✅ **历史记录**：仍然保存所有对话（审计、回顾）
- ✅ **搜索**：按内容/时间搜索
- ✅ **导出**：导出特定时间段的对话

### 移除功能
- ❌ 会话切换
- ❌ 会话命名
- ❌ 会话隔离

## 技术实现

### 记忆检索策略
```typescript
class MemoryDrivenChat {
  private windowSize = 10;  // 滑动窗口大小

  async buildContext(userInput: string): Promise<Message[]> {
    // 1. 检索相关记忆（向量检索）
    const memories = await this.memoryManager.retrieve(userInput, {
      maxResults: 5,
      minConfidence: 0.7,
    });

    // 2. 格式化为系统消息
    const memoryContext = this.formatMemoriesAsContext(memories);

    // 3. 合并滑动窗口
    return [
      ...memoryContext,
      ...this.currentWindow.slice(-this.windowSize),
    ];
  }
}
```

### 自动记忆提取
```typescript
class MemoryExtractor {
  async extractFromConversation(messages: Message[]): Promise<MemoryEntry[]> {
    // 使用 LLM 提取关键信息
    const prompt = `
      从以下对话中提取重要信息：
      1. 用户偏好
      2. 决策和理由
      3. 学到的知识
      4. 重要日期/事件

      对话：${messages.map(m => m.content).join('\n')}
    `;

    const extracted = await this.llm.extract(prompt);
    return this.parseToMemoryEntries(extracted);
  }
}
```

## 总结

**推荐方案**：Phase 2（记忆优先）
- 保留底层会话机制（兼容性）
- GUI 完全淡化会话概念
- 引入"固定话题"替代"保存会话"
- 所有上下文通过记忆检索获取

**收益**：
- 更自然的对话体验
- 更智能的上下文延续
- 更符合人类思维模式
- 为未来 AI Agent 协作奠定基础
