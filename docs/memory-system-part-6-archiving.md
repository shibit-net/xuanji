# Xuanji 记忆系统 · 上下文归档与子 Agent 结果持久化

> 版本: 1.0 | 日期: 2026-05-16
> 依赖: 记忆系统基础架构（Part 1-5）

---

## 目录

1. [问题分析](#1-问题分析)
2. [设计思路](#2-设计思路)
3. [ContextArchiver：压缩时的记忆归档](#3-contextarchiver-压缩时的记忆归档)
4. [SubAgentResultStore：子 Agent 结果持久化](#4-subagentresultstore-子-agent-结果持久化)
5. [检索与注入](#5-检索与注入)
6. [文件清单](#6-文件清单)

---

## 1. 问题分析

### 问题 1：上下文压缩会丢掉历史

ContextManager 的 `simpleCompress()` / `aggressiveCompress()` 会丢弃旧消息：

```
压缩前: [system] [msg1] [msg2] ... [msg50] [msg51]
压缩后: [system] [摘要] [msg45] ... [msg51]
                        ↑ 丢弃了 msg1~44
                        ↑ 只替换成一行"[上下文摘要]之前 N 条消息已压缩"
```

问题：用户接下来可以问"刚才说的那个配置参数是什么"，但具体内容已经在被丢弃的消息里了。Agent 无法回答。

### 问题 2：子 Agent 结果被主 Agent 总结后丢弃

AgentLoop 的执行流程：

```
用户 -> 主 Agent -> task(子Agent) -> 子Agent执行 -> 返回结果 -> 主Agent总结 -> 回复用户
                                                                  │
                                                                  └── 子Agent的完整返回结果
                                                                      被放入 tool_result，随
                                                                      下一次压缩被丢弃
```

用户追问"那个子 Agent 具体改了哪些文件"，主 Agent 已经记不住细节了——它只记得自己写的总结。

---

## 2. 设计思路

**这两个问题本质是同一个：有价值的中间数据没有持久化。**

解决方案也很简单——**在数据被丢弃之前，把它存入记忆库**。两个切入点：

```
上下文压缩 → archiveMessages() 被调用 → 把要丢弃的消息提取 key info → 存入 events/facts
子Agent完成 → tool_result 返回 → 把完整结果存入独立的结构化存储
```

**关键原则**：不修改 ContextManager 的内部逻辑。它已经有 `archiveDelegate` 接口——MemoryManager 实现它即可。

---

## 3. ContextArchiver：压缩时的记忆归档

### 3.1 实现 ArchiveDelegate

`ContextManager` 已经在压缩前调用 `archiveDelegate.archiveMessages(messages)`。MemoryManager 实现这个接口：

```typescript
// MemoryManager 实现 ArchiveDelegate
class MemoryManager implements ArchiveDelegate {
  /**
   * ContextManager 压缩前回调——要丢弃的消息传到这里。
   *
   * 从中提取有价值的信息存入记忆库：
   * - 用户的偏好声明（"我喜欢用 Docker Compose"）
   * - 项目决策（"决定用 JWT"）
   * - 技术选型变更（"从 MySQL 改 PostgreSQL"）
   *
   * 不存的信息：
   * - 闲聊内容
   * - 一次性查询（"查一下天气"）
   * - 已经通过 memory_store 存过的内容
   */
  async archiveMessages(messages: Message[]): Promise<void> {
    // 只在消息量大时才做提取（避免频繁调用）
    if (messages.length < 5) return;

    // 异步执行，不阻塞压缩流程
    setTimeout(async () => {
      try {
        await this.extractFromMessages(messages);
      } catch (err) {
        log.error('Context archive extraction failed:', err);
      }
    }, 0);
  }

  private async extractFromMessages(messages: Message[]): Promise<void> {
    // 1. 找到所有 tool_result（子 agent 产出）
    const subAgentResults = this.extractToolResults(messages);
    
    // 2. 如果子 Agent 结果还没存过，存到 SubAgentResultStore
    for (const result of subAgentResults) {
      if (!this.subAgentStore?.exists(result.id)) {
        await this.subAgentStore?.store(result);
      }
    }

    // 3. 用便宜 LLM 提取事实和偏好
    // （复用已有的 extractFromSession 逻辑）
    if (this.cheapLLM) {
      const formatted = this.formatMessagesForExtraction(messages);
      if (formatted.length < 2000) return;  // 内容太少，没提取价值

      const items = await this.cheapLLMExtract(formatted);
      for (const item of items) {
        if (item.confidence >= 0.8) {
          await this.store(item.type, item.data, item.scene);
        }
      }
    }
  }

  /**
   * 从消息中提取所有 tool_result
   */
  private extractToolResults(messages: Message[]): SubAgentRecord[] {
    const results: SubAgentRecord[] = [];
    
    for (const msg of messages) {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result' && block.content && typeof block.content === 'string') {
            // 检查是否包含子 agent 结果标记
            if (block.content.includes('[Sub-agent completed]') ||
                block.content.includes('[Task completed]')) {
              results.push({
                id: this.extractAgentId(block.content),
                content: block.content,
                timestamp: Date.now(),
                source: this.extractSource(block.content),
              });
            }
          }
        }
      }
    }
    
    return results;
  }

  // 注：第 3 步的 cheapLLM 调用是异步、低优先级、失败无害的。
  // 提取到的内容通过 checkDuplicate 去重后存入。
}
```

### 3.2 注入点

```typescript
// SessionFactory 或 ChatSession 初始化时
const contextManager = agentLoop.getContextManager();
contextManager.setArchiveDelegate(memoryManager);
```

一行代码，已有接口。ContextManager 代码不用改。

### 3.3 为什么不做实时提取（压缩时才做）

可能你会想"为什么不每次 tool_result 回来就提取？"

因为大部分 tool_result 是中间过程（代码搜索、文件读取、编译输出），只有被压缩丢掉的那一部分才是"以后再也不会回到上下文中的"。**压缩触发时才提取，效率最高。**

---

## 4. SubAgentResultStore：子 Agent 结果持久化

### 4.1 存储设计

子 Agent 的结果——文件修改、代码生成、调研报告——是结构化的多行文本，不适合放进 entities/facts 表。

独立存储，用 JSONL 格式（跟你已有的 SessionStorage 一致）：

```
~/.xuanji/users/{userId}/memory/
├── memory.db                        ← SQLite（不变）
├── embeddings.data                  ← 语义向量（Part 5）
├── subagent_results/                ← 新增目录
│   ├── 2026-05-16.jsonl             ← 按日期分文件
│   ├── 2026-05-17.jsonl
│   └── ...
```

每条记录：

```jsonl
{"id": "subagent_abc123", "timestamp": 1747360000000, "source": "task:software-engineer", "scene": "开发", "agent_name": "软件工程师", "task_description": "实现用户注册接口", "summary": "完成了注册接口的JWT认证和bcrypt加密", "full_output": "## 执行摘要\n完成了用户注册接口的POST /api/register 实现...\n## 文件变更\n- src/auth/register.ts (新增)\n- src/auth/jwt.ts (修改)\n## 关键决策\n- 使用JWT而不是session...", "key_entities": ["项目A", "JWT", "bcrypt"], "token_count": 1200, "expires_at": 1749945600000}
```

### 4.2 存储逻辑

```typescript
class SubAgentResultStore {
  private baseDir: string;

  constructor(memoryDir: string) {
    this.baseDir = path.join(memoryDir, 'subagent_results');
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  /**
   * 存储子 Agent 执行结果
   *
   * 在 AgentLoop 的 onToolEnd 回调中调用。
   * 同时将结果摘要写入 events 表（主记忆库），
   * 完整内容存入 JSONL 文件。
   */
  async store(input: SubAgentRecord): Promise<void> {
    const date = new Date(input.timestamp).toISOString().slice(0, 10);
    const filePath = path.join(this.baseDir, `${date}.jsonl`);

    await fs.appendFile(filePath, JSON.stringify(input) + '\n', 'utf-8');

    // 同时写入主记忆库（摘要）
    // events 表存"完成了什么"
    // facts 表存关键决策
  }

  /**
   * 按 ID 检索完整结果
   */
  async getById(id: string): Promise<SubAgentRecord | null> {
    const files = await fs.readdir(this.baseDir);
    for (const file of files.sort().reverse()) {  // 从最新文件开始
      const lines = await fs.readFile(path.join(this.baseDir, file), 'utf-8');
      for (const line of lines.split('\n').filter(Boolean).reverse()) {  // 从最后一行开始
        const record = JSON.parse(line);
        if (record.id === id) {
          // 过期检查：超 7 天的标记为过期
          if (record.expires_at && record.expires_at < Date.now()) {
            return { ...record, expired: true };
          }
          return record;
        }
      }
    }
    return null;
  }

  /**
   * 全文搜索（遍历 JSONL，适合小规模）
   * 未来可切换到 FTS5 或语义搜索
   */
  async search(keyword: string, limit: number = 5): Promise<SubAgentRecord[]> {
    const results: SubAgentRecord[] = [];
    const files = await fs.readdir(this.baseDir);
    for (const file of files.sort().reverse()) {
      const lines = await fs.readFile(path.join(this.baseDir, file), 'utf-8');
      for (const line of lines.split('\n').filter(Boolean).reverse()) {
        const record = JSON.parse(line);
        if (record.full_output?.includes(keyword) || record.summary?.includes(keyword)) {
          results.push(record);
          if (results.length >= limit) return results;
        }
      }
    }
    return results;
  }
}
```

### 4.3 触发时机

在 `AgentLoop` 的 `onToolEnd` 回调中接入（AgentLoop.ts:343-351）：

```typescript
// AgentLoop.ts — 已有的 onToolEnd
this.callbacks.onToolEnd?.(tc.id, tc.name, toolResult.content, toolResult.isError, toolResult.metadata);

// ← 新增：子 Agent 完成时，异步存储结果
if ((tc.name === 'task' || tc.name === 'agent_team') && !toolResult.isError) {
  this.subAgentStore?.store({
    id: tc.id,
    timestamp: Date.now(),
    source: `${tc.name}:${tc.input?.subagent_type || tc.input?.team_name || 'unknown'}`,
    agent_name: tc.input?.subagent_type || tc.input?.team_name || 'unknown',
    task_description: typeof tc.input?.description === 'string'
      ? tc.input.description.slice(0, 200) : '',
    summary: toolResult.content.slice(0, 500),
    full_output: toolResult.content,
    key_entities: [],
    token_count: toolResult.content.length / 4,
    expires_at: Date.now() + 7 * 24 * 3600_000,  // 7 天后过期
  }).catch(err => log.error('Failed to store sub-agent result:', err));
}
```

### 4.4 过期策略

子 Agent 的完整输出不是永久记忆——它只是上下文缓存。默认 7 天后自动清理：

```typescript
async cleanup(): Promise<void> {
  const files = await fs.readdir(this.baseDir);
  for (const file of files) {
    const filePath = path.join(this.baseDir, file);
    const lines = await fs.readFile(filePath, 'utf-8');
    const valid = lines.split('\n').filter(Boolean).filter(line => {
      try {
        const record = JSON.parse(line);
        return !record.expires_at || record.expires_at >= Date.now();
      } catch { return false; }
    });
    await fs.writeFile(filePath, valid.join('\n') + '\n', 'utf-8');
  }
}
```

---

## 5. 检索与注入

### 5.1 memory_search 工具扩展

`memory_search` 新增一个 `source` 参数：

```typescript
input_schema: {
  properties: {
    query: { type: 'string' },
    source: {
      type: 'string',
      enum: ['auto', 'memory', 'subagent', 'archived', 'episode'],
      description: '搜索范围：memory=记忆库, subagent=子Agent结果, archived=压缩归档, auto=全部',
      default: 'auto',
    },
    // ...
  },
}
```

**需要在 MemorySearchTool 构造函数中注入 subAgentStore**：

```typescript
// MemorySearchTool 构造函数更新
constructor(
  private memoryManager: MemoryManager,
  private subAgentStore?: SubAgentResultStore,  // ← 新增
) { super(); }
```

`source=subagent` 时，搜索 SubAgentResultStore：

```typescript
async execute(input: Record<string, unknown>): Promise<ToolResult> {
  const source = (input.source as string) || 'auto';
  const query = input.query as string;
  const results: string[] = [];

  // 1. 搜索主记忆库（source = auto 或 memory）
  if (source === 'auto' || source === 'memory') {
    const memoryResults = await this.memoryManager.search(query, { limit: 5 });
    results.push(this.formatMemoryResults(memoryResults));
  }

  // 2. 搜索子 Agent 结果（source = auto 或 subagent）
  if (source === 'auto' || source === 'subagent') {
    const subResults = await this.subAgentStore?.search(query, 3) || [];
    if (subResults.length > 0) {
      results.push('## 子 Agent 执行记录');
      for (const r of subResults) {
        results.push(`### ${r.agent_name} — ${r.task_description}`);
        results.push(`${r.summary}`);
        results.push(`> 完整结果 ID: ${r.id}`);
      }
    }
  }

  return this.success(results.join('\n\n'));
}
```

### 5.2 用户追问时的自动检索

当用户问"刚才子 Agent 具体改了哪些文件"时，主 Agent 可以在回复前自动搜索子 Agent 结果：

```
用户: "那个软件工程师具体改了哪些文件？"

主 Agent:
  1. 发现上下文里没有子 Agent 的原始输出（已被压缩丢掉）
  2. 自动调用 memory_search({ query: "软件工程师 文件修改", source: "subagent" })
  3. 找到 subagent_results 里的完整记录
  4. 从中提取文件变更列表
  5. 回复用户具体改了哪些文件
```

### 5.3 Prompt 引导

在 `l0-base-memory-guide.yaml` 中补充一条：

```yaml
  ## 搜索被压缩的上下文

  当用户在追问之前对话中的细节，但你发现上下文里没有时：
  - 在当前上下文中搜索（memory_search source="memory"）
  - 如果找不到，搜索被压缩归档的内容（memory_search source="subagent"）
  - 仍找不到，搜索子 Agent 的执行结果（memory_search source="archived"）

  注意：向用户说明"我在历史记录中找到了"，而不是"我不记得了"。
```

---

## 6. 文件清单

```
src/core/memory/
├── MemoryManager.ts          ← 修改：实现 ArchiveDelegate 接口
├── SubAgentResultStore.ts    ← 新增：子 Agent 结果持久化
└── types.ts                  ← 修改：新增 SubAgentRecord 类型

docs/
└── memory-system-part-6-archiving.md (本文)
```

## 7. 与现有系统的集成点

| 文件 | 修改 |
|------|------|
| `src/core/context/ContextManager.ts` | 不变（已有 ArchiveDelegate 接口） |
| `src/core/agent/AgentLoop.ts` | `onToolEnd` 回调中新增 `subAgentStore.store()` 调用 |
| `SessionFactory.ts` | 注入 `memoryManager` 作为 `archiveDelegate` |
| `docs/memory-system-part-3-integration.md` | 补充 archiveDelegate 注入步骤 |
| `docs/memory-system-part-2-retrieval.md` | memory_search 新增 source 参数说明 |
