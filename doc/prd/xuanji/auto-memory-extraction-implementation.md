# 自动记忆提取实现文档

## 实施日期
2026-03-15

## 背景

### 问题分析
在之前的设计中，璇玑的记忆保存完全依赖 LLM 主动调用 `memory_store` 工具，存在以下问题：

1. **LLM 遵循不稳定**
   - 强模型（Claude Opus/Sonnet、GPT-4）遵循度高
   - 弱模型可能忽略记忆保存指令
   - 在高压任务下（多工具调用）可能遗忘

2. **没有自动触发**
   - 用户主动调用 `memoryManager.save()` 的代码路径**不存在**
   - 完全依赖 LLM 调用 `memory_store` 工具
   - 如果 LLM 没调用，记忆就不会被保存

3. **缺少兜底机制**
   - 会话结束时没有自动触发记忆提取
   - `/save` 命令只保存会话，不提取记忆
   - SmartMemoryExtractor V1/V2 的自动提取链**从未被调用**

## 设计方案

### 1. 混合模式（LLM 主动 + 自动兜底）

```typescript
┌─────────────────────────────────────────────────────┐
│              记忆保存双保险机制                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  首选：LLM 主动保存（memory_store 工具）               │
│  ├─ 语义精准，质量高                                  │
│  ├─ 实时性强，即时保存                                │
│  └─ 符合用户直觉                                      │
│                                                     │
│  兜底：自动提取（memoryManager.save）                 │
│  ├─ SmartExtractorV2 → V1 → Compactor               │
│  ├─ 4 个触发时机                                      │
│  └─ 确保重要信息不丢失                                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 2. 自动提取触发时机

| 触发点 | 时机 | 配置模式 | 优先级 |
|--------|------|---------|--------|
| **on-save** | 用户执行 `/save` 命令 | `on-save`, `all` | 高 |
| **on-evict** | 消息淘汰（达到上限） | `on-evict`, `all` | 高 |
| **periodic** | 每 N 轮对话后 | `periodic`, `all` | 中 |
| **cleanup** | 会话退出时 | 总是触发 | 最高 |

### 3. 配置选项

```typescript
// src/memory/types.ts
interface MemoryConfig {
  // 现有配置...

  /** 是否启用自动记忆提取（默认 true） */
  autoExtract?: boolean;

  /** 自动提取触发条件（默认 'all'）
   * - 'on-save': 仅在用户执行 /save 命令时提取
   * - 'on-evict': 仅在消息淘汰时提取
   * - 'periodic': 每 N 轮对话后提取
   * - 'all': 以上所有时机都提取
   */
  autoExtractMode?: 'on-save' | 'on-evict' | 'periodic' | 'all';

  /** 定期自动提取的间隔（轮数，默认 5） */
  autoExtractInterval?: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  // ...
  autoExtract: true,
  autoExtractMode: 'all',
  autoExtractInterval: 5,
};
```

## 实现细节

### 1. ChatSession 核心方法

#### 1.1 `autoExtractMemories(trigger)` - 自动提取入口

```typescript
private async autoExtractMemories(
  trigger: 'on-save' | 'on-evict' | 'periodic'
): Promise<void> {
  if (!this.memoryManager || !this.agentLoop) return;

  const config = this.config?.memory;
  if (!config?.enabled || !config?.autoExtract) return;

  // 检查是否应该触发
  const mode = config.autoExtractMode ?? 'all';
  const shouldExtract =
    mode === 'all' ||
    mode === trigger ||
    (mode === 'periodic' && trigger === 'periodic');

  if (!shouldExtract) return;

  // 定期触发需要检查间隔
  if (trigger === 'periodic') {
    const interval = config.autoExtractInterval ?? 5;
    if (this.turnCount % interval !== 0) return;
  }

  try {
    log.debug(`Auto-extracting memories (trigger: ${trigger}, turn: ${this.turnCount})`);

    // 构建 SessionMemory 对象
    const sessionMemory = this.buildSessionMemory();

    // 调用 MemoryManager.save() 触发智能提取链
    await this.memoryManager.save(sessionMemory);

    log.info(`Memory auto-extracted successfully (trigger: ${trigger})`);
  } catch (err) {
    log.warn('Auto memory extraction failed:', err instanceof Error ? err.message : String(err));
  }
}
```

#### 1.2 `buildSessionMemory()` - 构建会话记忆对象

```typescript
private buildSessionMemory(): SessionMemory {
  if (!this.agentLoop) {
    throw new Error('AgentLoop not initialized');
  }

  const messages = this.agentLoop.getMessageHistory();

  // 提取用户消息和助手响应
  const userMessages: string[] = [];
  const assistantHighlights: string[] = [];
  const toolCalls: ToolCallRecord[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        userMessages.push(msg.content);
      }
    } else if (msg.role === 'assistant') {
      if (Array.isArray(msg.content)) {
        // 提取文本块
        const textBlocks = msg.content
          .filter(block => block.type === 'text' && block.text)
          .map(block => (block as any).text);
        if (textBlocks.length > 0) {
          assistantHighlights.push(textBlocks.join('\n'));
        }

        // 提取工具调用记录
        const toolUseBlocks = msg.content.filter(block => block.type === 'tool_use');
        for (const block of toolUseBlocks) {
          const toolUse = block as any;
          toolCalls.push({
            name: toolUse.name,
            input: toolUse.input,
            resultSummary: '',
            isError: false,
          });
        }
      }
    }
  }

  const sessionId = this.sessionManager.getActiveSessionId() ?? 'unknown';
  const model = this.config?.provider?.model ?? 'unknown';
  const now = new Date().toISOString();

  return {
    sessionId,
    startTime: now,
    endTime: now,
    userMessages,
    assistantHighlights,
    toolCalls,
    durationMs: undefined,
    model,
  };
}
```

### 2. 触发点集成

#### 2.1 `/save` 命令时

```typescript
async saveSession(
  name?: string,
  options?: { usage?: SessionUsage; historyMessages?: HistoryMessage[] },
): Promise<string> {
  this.ensureInitialized();
  const messages = this.agentLoop!.getMessageHistory();

  // ... usage 提取逻辑 ...

  // 🆕 自动记忆提取（兜底机制）
  await this.autoExtractMemories('on-save');

  return this.sessionManager.save(messages as SessionMessage[], name, { usage, historyMessages: options?.historyMessages });
}
```

#### 2.2 消息淘汰时

```typescript
private async evictIfNeeded(): Promise<void> {
  // ... 压缩摘要、保存会话逻辑 ...

  // 🆕 在淘汰前提取记忆（保存当前会话的重要信息）
  await this.autoExtractMemories('on-evict');

  // ... 重置 AgentLoop 逻辑 ...
}
```

#### 2.3 每轮对话后（定期）

```typescript
async run(userMessage: string): Promise<void> {
  // ... 意图路由、记忆检索、AgentLoop 执行 ...

  // 6. 消息淘汰检查
  await this.evictIfNeeded();

  // 🆕 7. 定期自动记忆提取
  await this.autoExtractMemories('periodic');
}
```

#### 2.4 会话退出时

```typescript
async cleanup(): Promise<void> {
  // 🆕 退出时提取记忆（final safety net）
  if (this.memoryManager && this.agentLoop) {
    const config = this.config?.memory;
    if (config?.enabled && config?.autoExtract) {
      try {
        log.debug('Extracting memories before session cleanup...');
        const sessionMemory = this.buildSessionMemory();
        await this.memoryManager.save(sessionMemory);
        log.info('Final memory extraction completed');
      } catch (extractErr) {
        log.warn('Final memory extraction failed:', extractErr instanceof Error ? extractErr.message : String(extractErr));
      }
    }
  }

  // ... 会话保存、MCP 关闭等清理逻辑 ...
}
```

### 3. 审计日志增强

#### 3.1 MemoryStoreTool 调用记录

```typescript
// src/core/tools/MemoryStoreTool.ts
async execute(input: Record<string, unknown>): Promise<ToolResult> {
  // ... 参数验证、记忆构建 ...

  // 保存到长期记忆
  const longTerm = this.memoryManager.getLongTermMemory();
  await longTerm.save(entry);

  // 🆕 审计日志：记录 LLM 主动调用 memory_store
  log.info(`✅ LLM stored memory: [${type}] ${content.slice(0, 60)}... (confidence: ${confidence})`);

  return this.success(`Memory stored successfully: [${type}] ${content.slice(0, 60)}...`);
}
```

## 工作流程

### 正常流程（LLM 主动保存）

```
用户输入: "我不吃辣，Alice 喜欢日料，她生日是 3 月 8 号"
    ↓
LLM 分析并调用 memory_store 工具 (3 次)
    ↓
MemoryStoreTool.execute()
    ├─ memory_store({type: "user_preference", content: "不吃辣", ...})
    ├─ memory_store({type: "relationship", content: "Alice 喜欢日料", ...})
    └─ memory_store({type: "important_date", content: "Alice 生日 3月8号", ...})
    ↓
每次调用记录审计日志:
    ✅ LLM stored memory: [user_preference] 不吃辣... (confidence: 0.95)
    ✅ LLM stored memory: [relationship] Alice 喜欢日料... (confidence: 0.9)
    ✅ LLM stored memory: [important_date] Alice 生日 3月8号... (confidence: 0.95)
    ↓
记忆已保存 ✓
```

### 兜底流程（自动提取）

```
情况 1: 用户执行 /save
    ↓
ChatSession.saveSession()
    ↓
autoExtractMemories('on-save')
    ↓
buildSessionMemory() → memoryManager.save()
    ↓
SmartExtractorV2 分析会话 → 提取记忆
    ↓
记忆已保存 ✓

情况 2: 消息达到上限淘汰
    ↓
ChatSession.evictIfNeeded()
    ↓
autoExtractMemories('on-evict')
    ↓
记忆已保存 ✓

情况 3: 每 5 轮对话
    ↓
ChatSession.run() (turnCount % 5 === 0)
    ↓
autoExtractMemories('periodic')
    ↓
记忆已保存 ✓

情况 4: 用户退出
    ↓
ChatSession.cleanup()
    ↓
buildSessionMemory() → memoryManager.save()
    ↓
记忆已保存 ✓
```

## 配置示例

### 1. 默认配置（全触发）

```json
{
  "memory": {
    "enabled": true,
    "autoExtract": true,
    "autoExtractMode": "all",
    "autoExtractInterval": 5
  }
}
```

### 2. 仅在保存时提取

```json
{
  "memory": {
    "enabled": true,
    "autoExtract": true,
    "autoExtractMode": "on-save",
    "autoExtractInterval": 5
  }
}
```

### 3. 定期提取（每 10 轮）

```json
{
  "memory": {
    "enabled": true,
    "autoExtract": true,
    "autoExtractMode": "periodic",
    "autoExtractInterval": 10
  }
}
```

### 4. 禁用自动提取（仅 LLM 主动）

```json
{
  "memory": {
    "enabled": true,
    "autoExtract": false
  }
}
```

## 性能优化

### 1. 避免重复提取

- `autoExtractMemories()` 检查配置，不符合条件时立即返回
- 定期触发检查轮数间隔，避免过于频繁
- cleanup 时的提取在所有其他触发点之后，可能包含已提取的内容（SmartExtractor 会自动去重）

### 2. 异步执行

- 所有 `autoExtractMemories()` 调用都使用 `await`
- 不阻塞用户交互
- 错误捕获，失败不影响主流程

### 3. 日志分级

- `log.debug`: 触发检查、构建过程
- `log.info`: 成功提取、审计记录
- `log.warn`: 提取失败（降级）

## 测试验证

### 手动测试

```bash
# 1. 启动 CLI
npm run dev

# 2. 测试 LLM 主动保存
用户: "我不吃辣，Alice 喜欢日料"
→ 观察日志是否有 "✅ LLM stored memory" 输出

# 3. 测试 /save 命令触发
用户: "帮我重构这个项目"
（LLM 执行任务但未调用 memory_store）
用户: "/save 重构项目"
→ 观察日志是否有 "Auto-extracting memories (trigger: on-save)"

# 4. 测试定期触发
连续对话 5 轮
→ 观察日志是否有 "Auto-extracting memories (trigger: periodic)"

# 5. 测试退出触发
用户: "/exit"
→ 观察日志是否有 "Extracting memories before session cleanup"
```

### 日志示例

```log
# LLM 主动保存
[2026-03-15 10:30:45] ✅ LLM stored memory: [user_preference] 不吃辣，但微辣可以... (confidence: 0.95)

# 自动提取触发
[2026-03-15 10:35:12] Auto-extracting memories (trigger: on-save, turn: 3)
[2026-03-15 10:35:13] Memory auto-extracted successfully (trigger: on-save)

# 定期触发
[2026-03-15 10:40:20] Auto-extracting memories (trigger: periodic, turn: 5)
[2026-03-15 10:40:21] SmartExtractorV2 extracted 2 memories

# 退出触发
[2026-03-15 10:45:00] Extracting memories before session cleanup...
[2026-03-15 10:45:01] Final memory extraction completed
```

## 总结

### 实现的功能

✅ **自动记忆提取兜底机制**
- 4 个触发时机：on-save / on-evict / periodic / cleanup
- 可配置的触发模式和间隔
- SmartExtractor V2 → V1 → Compactor 降级链

✅ **LLM 主动保存增强**
- 审计日志记录每次 memory_store 调用
- 便于调试和统计 LLM 遵循度

✅ **配置灵活性**
- 支持 4 种提取模式
- 可调节定期间隔
- 可完全禁用自动提取

### 设计亮点

1. **双保险机制**：LLM 主动 + 自动兜底，确保记忆不丢失
2. **智能降级**：优先使用高质量的 LLM 主动保存，自动提取作为备份
3. **最小侵入**：仅在关键节点添加调用，不影响现有逻辑
4. **性能友好**：配置化控制，避免过度提取
5. **可观测性**：详细的审计日志，便于调试和优化

### 后续优化

1. **统计分析**：记录 LLM 主动保存 vs 自动提取的比例
2. **智能调整**：根据 LLM 遵循度动态调整自动提取频率
3. **去重优化**：SmartExtractor V2 检测重复记忆时跳过提取
4. **批量提取**：多轮对话累积后一次性提取，减少 LLM 调用
