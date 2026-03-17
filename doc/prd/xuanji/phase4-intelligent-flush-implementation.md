# Phase 4: IntelligentMemoryFlush 实施完成报告

## 实施日期
2026-03-16

## 概述
完成 OpenClaw 启发的智能记忆刷新功能，使用 LLM 评估对话价值并分类归档（topic / timeline / discard）。

---

## 已完成工作

### 1. 核心文件创建

#### IntelligentMemoryFlush.ts（~500 行）
- 位置：`src/memory/IntelligentMemoryFlush.ts`
- 功能：
  - 智能触发检查（上下文 > 75% 或时间 > 30 分钟）
  - LLM 驱动的价值评估
  - 三分类归档（topic / timeline / discard）
  - 自动清理消息历史（保留最近 N 条）
  - 降级策略（LLM 失败时全部归为 timeline）

#### 核心方法

**checkAndFlush()**
```typescript
async checkAndFlush(context: FlushContext): Promise<boolean>
```
- 输入：FlushContext（messages, currentTokens, maxTokens, timeSinceLastFlush, sessionId）
- 输出：boolean（是否执行了刷新）
- 流程：
  1. 检查触发条件
  2. LLM 评估价值
  3. 分类归档
  4. 清理消息历史

**evaluateMemoryValue()**
```typescript
private async evaluateMemoryValue(messages: Message[]): Promise<Evaluation>
```
- 构建评估 prompt
- 调用 LLM（流式 API）
- 解析 JSON 评估结果
- 降级处理（LLM 失败时）

**archiveSegments()**
```typescript
private async archiveSegments(
  segments: EvaluationSegment[],
  sessionId?: string
): Promise<Stats>
```
- 过滤 discard 类型
- 过滤价值评分 < 阈值
- 构建 MemoryEntry
- 保存到 MemoryManager
- 返回统计信息

### 2. 类型定义

#### SegmentCategory
```typescript
type SegmentCategory = 'topic' | 'timeline' | 'discard';
```

#### EvaluationSegment
```typescript
interface EvaluationSegment {
  category: SegmentCategory;
  content: string;
  topicId?: string;
  memoryType?: MemoryEntryType;
  importance?: 'high' | 'medium' | 'low';
  confidence?: number;
  valueScore?: number;
}
```

#### Evaluation
```typescript
interface Evaluation {
  segments: EvaluationSegment[];
  totalValue: number;
  summary: string;
}
```

#### FlushContext
```typescript
interface FlushContext {
  messages: Message[];
  currentTokens: number;
  maxTokens: number;
  timeSinceLastFlush: number;
  sessionId?: string;
}
```

#### FlushConfig
```typescript
interface FlushConfig {
  tokenThreshold?: number;        // 默认 0.75
  timeThreshold?: number;          // 默认 30 分钟
  valueThreshold?: number;         // 默认 50
  autoDiscard?: boolean;           // 默认 true（已简化，discard 始终跳过）
  keepRecentMessages?: number;     // 默认 5
}
```

### 3. MemoryManager 集成

#### 新增字段
```typescript
private intelligentFlush: IntelligentMemoryFlush | null = null;
```

#### 修改的方法

**setProvider()**
- 初始化 IntelligentMemoryFlush
- 传入 LLM Provider 和配置
- 优先使用 lightModel（节省成本）
- 传入 MemoryManager（this）作为依赖

**新增 getIntelligentFlush()**
```typescript
getIntelligentFlush(): IntelligentMemoryFlush | null
```
- 返回 IntelligentMemoryFlush 实例
- 供 ChatSession 使用

### 4. 测试覆盖

#### IntelligentMemoryFlush.test.ts
- 位置：`test/unit/memory/IntelligentMemoryFlush.test.ts`
- 9 个测试用例，全部通过 ✅
- 覆盖场景：
  1. Token 超过阈值触发刷新
  2. 时间超过阈值触发刷新
  3. 未达到阈值不触发刷新
  4. 清理消息历史，保留最近 N 条
  5. 跳过 discard 类型片段
  6. 跳过价值评分低于阈值的片段
  7. 解析 JSON 格式评估结果
  8. 解析带代码块包裹的 JSON
  9. LLM 失败时使用降级评估

---

## 技术细节

### 触发条件

**条件 1: Token 阈值**
```typescript
currentTokens / maxTokens > 0.75
```

**条件 2: 时间阈值**
```typescript
timeSinceLastFlush > 30 * 60 * 1000  // 30 分钟
```

### LLM 评估 Prompt

**输入格式**：
```
[1] User: Hello
[2] Assistant: Hi there!
[3] User: What's the weather?
...
```

**输出格式**：
```json
{
  "segments": [
    {
      "category": "topic",
      "content": "User prefers Bun over npm",
      "topicId": "user-preferences",
      "memoryType": "user_preference",
      "importance": "high",
      "valueScore": 90
    },
    {
      "category": "timeline",
      "content": "Discussed memory system architecture",
      "importance": "medium",
      "valueScore": 70
    },
    {
      "category": "discard",
      "content": "Greeting and small talk",
      "valueScore": 10
    }
  ],
  "totalValue": 85,
  "summary": "Extracted 1 topic and 1 timeline segment"
}
```

### 分类归档逻辑

**topic 类型**：
- 设置 `category: 'topic'`
- 设置 `topicId`（从 LLM 评估结果获取）
- 设置 `type`（memoryType）

**timeline 类型**：
- 设置 `category: 'timeline'`
- 设置 `dayKey`（今天的日期，格式 "2026-03-16"）
- 设置 `sessionId`（会话 ID）

**discard 类型**：
- 直接跳过，不保存到记忆系统
- 统计到 `discarded` 计数

### 价值过滤

```typescript
if (segment.category === 'discard') {
  stats.discarded++;
  continue;
}

if (segment.valueScore && segment.valueScore < 50) {
  stats.discarded++;
  continue;
}
```

### 消息清理

```typescript
private pruneMessages(messages: Message[], keepCount: number): void {
  if (messages.length <= keepCount) return;

  const toRemove = messages.length - keepCount;
  messages.splice(0, toRemove); // 删除前 N 条，保留最后 keepCount 条
}
```

### 降级策略

**LLM 失败时**：
```typescript
private fallbackEvaluation(messages: Message[]): Evaluation {
  const segments = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      category: 'timeline' as const,
      content: this.extractTextContent(m).slice(0, 200),
      importance: 'medium' as const,
      valueScore: 60,
    }));

  return { segments, totalValue: 60, summary: 'Fallback evaluation' };
}
```

---

## 使用示例

### 在 ChatSession 中使用

```typescript
import type { IntelligentMemoryFlush, FlushContext } from '@/memory/IntelligentMemoryFlush';

class ChatSession {
  private memoryManager: MemoryManager;
  private intelligentFlush: IntelligentMemoryFlush | null = null;
  private lastFlushTime: number = Date.now();

  async init() {
    // ... 其他初始化 ...

    // 获取 IntelligentMemoryFlush 实例
    this.intelligentFlush = this.memoryManager.getIntelligentFlush();
  }

  async run(userMessage: string) {
    // ... 添加消息到历史 ...

    // 检查是否需要刷新
    if (this.intelligentFlush) {
      const context: FlushContext = {
        messages: this.messages,
        currentTokens: this.calculateTokens(),
        maxTokens: this.config.maxTokens || 200000,
        timeSinceLastFlush: Date.now() - this.lastFlushTime,
        sessionId: this.sessionId,
      };

      const flushed = await this.intelligentFlush.checkAndFlush(context);

      if (flushed) {
        this.lastFlushTime = Date.now();
        console.log('Memory flushed and message history cleaned');
      }
    }

    // ... LLM 调用 ...
  }
}
```

### 手动触发刷新

```typescript
const flush = memoryManager.getIntelligentFlush();

if (flush) {
  const context = {
    messages: currentMessages,
    currentTokens: 15000,
    maxTokens: 20000,
    timeSinceLastFlush: 40 * 60 * 1000, // 40 分钟
    sessionId: 'sess-123',
  };

  const flushed = await flush.checkAndFlush(context);

  if (flushed) {
    console.log('Memory flushed successfully');
  }
}
```

---

## 测试结果

```bash
$ npm test -- test/unit/memory/IntelligentMemoryFlush.test.ts

 ✓ test/unit/memory/IntelligentMemoryFlush.test.ts  (9 tests) 12ms

 Test Files  1 passed (1)
      Tests  9 passed (9)
```

**测试覆盖**：
- ✅ Token 阈值触发
- ✅ 时间阈值触发
- ✅ 未达阈值不触发
- ✅ 消息历史清理
- ✅ discard 类型过滤
- ✅ 价值评分过滤
- ✅ JSON 解析（普通格式）
- ✅ JSON 解析（代码块包裹）
- ✅ LLM 失败降级

---

## 对比 OpenClaw

| 特性 | OpenClaw | xuanji IntelligentMemoryFlush |
|------|----------|------------------------------|
| 触发条件 | 上下文 > 75% | ✅ 上下文 > 75%<br>✅ 时间 > 30 分钟 |
| 价值评估 | 无（全部归档） | ✅ LLM 评估<br>✅ 分类：topic/timeline/discard |
| 归档策略 | 追加到日志 | ✅ topic 提取（可复用知识）<br>✅ timeline 归档（重要上下文）<br>✅ 低价值丢弃 |
| 消息清理 | 未实现 | ✅ 保留最近 N 条（默认 5） |
| 降级处理 | 无 | ✅ LLM 失败时全部归为 timeline |
| 配置灵活性 | 硬编码 | ✅ FlushConfig 可配置 |

---

## 配置项

### 当前默认配置

```typescript
{
  tokenThreshold: 0.75,           // Token 阈值
  timeThreshold: 30 * 60 * 1000,  // 30 分钟
  valueThreshold: 50,             // 价值评分阈值（0-100）
  autoDiscard: true,              // 自动丢弃 discard 类型（已简化，始终跳过）
  keepRecentMessages: 5,          // 保留最近 N 条消息
}
```

### 建议未来配置化

```json
// ~/.xuanji/config.json
{
  "memory": {
    "intelligentFlush": {
      "enabled": true,
      "tokenThreshold": 0.75,
      "timeThreshold": 1800000,      // 30 分钟（毫秒）
      "valueThreshold": 50,
      "keepRecentMessages": 5,
      "useLightModel": true           // 优先使用轻量模型
    }
  }
}
```

---

## 遗留问题与改进方向

### 1. LLM Prompt 优化（可选）

**当前实现**：
- 固定 prompt 模板
- 示例驱动输出格式

**改进方向**：
- 根据对话长度动态调整 prompt
- 添加更多示例（Few-shot learning）
- 支持自定义分类规则

### 2. 统计信息记录（未实现）

**建议**：
- 记录每次刷新的统计信息
- 分析刷新频率和效果
- 优化阈值设置

### 3. 增量刷新（可选）

**当前实现**：
- 一次性评估所有消息

**改进方向**：
- 增量评估（只评估新增消息）
- 合并之前的评估结果
- 减少 LLM 调用次数

### 4. 自定义评估器（未实现）

**建议**：
- 支持插件式评估器
- 允许用户自定义分类逻辑
- 集成外部评估服务

---

## 下一步工作

### Phase 5: ChatSession Integration（1 天）
- 集成 IntelligentMemoryFlush 到会话流程
- 自动触发刷新（每轮对话后检查）
- 追踪 lastFlushTime
- 计算 currentTokens
- 测试端到端流程

### Phase 6: Testing and Optimization（2 天）
- 端到端集成测试
- 性能优化（LLM 调用延迟）
- 文档完善
- 用户手册

---

## 总结

✅ **Phase 4 已完成**：
- IntelligentMemoryFlush 核心功能实现（~500 行）
- MemoryManager 集成（初始化 + getter 方法）
- 单元测试全部通过（9/9）
- 类型检查无错误

📊 **代码统计**：
- 新增代码：~500 行（IntelligentMemoryFlush.ts）
- 测试代码：~350 行（IntelligentMemoryFlush.test.ts）
- 修改文件：2 个（IntelligentMemoryFlush.ts, MemoryManager.ts）

🎯 **核心价值**：
- 智能触发条件（上下文 + 时间）
- LLM 驱动价值评估（比 OpenClaw 更智能）
- 三分类归档（topic / timeline / discard）
- 自动清理消息历史（节省上下文）
- 降级策略（LLM 失败时仍可工作）
- 完全配置化（灵活调整阈值）

🚀 **性能优化**：
- 优先使用 lightModel（节省 API 成本）
- 低价值内容丢弃（减少存储）
- 消息历史清理（释放内存）
- 价值评分过滤（精准存储）
