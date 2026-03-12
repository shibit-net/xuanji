# 统一的内容追加协议设计

## 设计目标

定义清晰的 API 和状态机，让各层（StreamProcessor、AgentLoop、App UI）统一遵循，确保：
1. ✅ 职责分离：每层只处理自己负责的追加逻辑
2. ✅ 状态可预测：任何时刻都能推导出下一步行为
3. ✅ 易于测试：每个场景都有明确的输入输出
4. ✅ 易于扩展：新增追加场景时不需要大幅重构

## 协议层次

```
┌─────────────────────────────────────────────────┐
│  UI Layer (App.tsx)                             │
│  - 用户输入捕获                                  │
│  - Pending 队列管理                              │
│  - 视觉反馈（提示、动画）                         │
│  - 根据状态路由到 interrupt/appendMessage        │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  Agent Layer (AgentLoop)                        │
│  - 消息序列管理                                  │
│  - interrupt/appendMessage 实现                  │
│  - tool_result 补全                              │
│  - Boundary-Aware 消息注入                       │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  Stream Layer (StreamProcessor)                 │
│  - text_delta 累积                               │
│  - thinking_delta 累积                           │
│  - tool_use_delta 累积                           │
│  - 中断检查 (interruptChecker)                   │
└─────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────┐
│  Provider Layer (AnthropicProvider/OpenAI)      │
│  - SSE/Streaming API 封装                        │
│  - 原始事件转换为 StreamEvent                     │
│  - 可选：累积 tool input JSON                    │
└─────────────────────────────────────────────────┘
```

## 状态机定义

### Agent 状态

```typescript
type AgentStatus = 
  | 'idle'       // 空闲，等待用户输入
  | 'thinking'   // LLM 思考中（流式输出 text/thinking）
  | 'tool';      // 工具执行中

type AppendMode = 
  | 'none'       // 无追加
  | 'hard'       // 硬中断（interrupt）
  | 'soft';      // 温和追加（appendMessage）

interface AgentState {
  status: AgentStatus;
  appendMode: AppendMode;
  pendingMessages: string[];  // 待追加消息队列
  lastBoundary: 'user' | 'assistant' | 'tool_result' | null;
}
```

### 状态转换规则

```typescript
// 1. 用户输入时的路由
if (status === 'idle') {
  // 正常提交
  submitNewTurn(input);
} else if (status === 'thinking') {
  // thinking 中追加 → 硬中断
  appendMode = 'hard';
  interrupt(input);
} else if (status === 'tool') {
  // tool 执行中 → 温和追加
  appendMode = 'soft';
  appendMessage(input);
}

// 2. 消息注入的时机（Boundary-Aware）
if (appendMode === 'hard') {
  // 硬中断：立即注入
  injectAtNextIteration();
} else if (appendMode === 'soft') {
  // 温和追加：等待自然边界
  if (lastBoundary === 'tool_result') {
    injectAfterToolResult();
  } else if (lastBoundary === 'assistant' && stopReason === 'end_turn') {
    injectAfterEndTurn();
  }
}
```

## API 定义

### StreamProcessor API

```typescript
class StreamProcessor {
  // ── 累积 buffer 管理 ──
  private currentText = '';
  private currentThinking = '';
  private currentToolInputBuffer = '';  // 🆕
  
  // ── Delta 事件处理 ──
  onTextDelta(handler: (delta: string) => void): void;
  onThinkingDelta(handler: (delta: string) => void): void;
  onToolDelta(handler: (id: string, name: string, receivedBytes: number) => void): void;
  
  // ── 完整块事件 ──
  onToolUse(handler: (toolCall: ToolCall) => void): void;
  
  // ── 中断控制 ──
  setInterruptChecker(checker: () => boolean): void;
  
  // ── 主流程 ──
  async consume(stream: AsyncIterable<StreamEvent>): Promise<ProcessResult>;
}
```

**新增方法**（优化后）：
```typescript
class StreamProcessor {
  // 🆕 手动 flush 累积的内容（在关键节点调用）
  flush(): { text: string; thinking: string; toolInput: string } {
    return {
      text: this.currentText,
      thinking: this.currentThinking,
      toolInput: this.currentToolInputBuffer,
    };
  }
  
  // 🆕 重置累积 buffer（在新一轮开始时调用）
  reset(): void {
    this.currentText = '';
    this.currentThinking = '';
    this.currentToolInputBuffer = '';
  }
}
```

### AgentLoop API

```typescript
class AgentLoop {
  // ── 现有方法 ──
  async run(userMessage: string): Promise<void>;
  stop(): void;
  reset(): void;
  
  // ── 追加方法 ──
  appendMessage(message: string): void;      // 温和追加（不中断）
  interrupt(appendMessage: string): void;    // 硬中断（立即响应）
  
  // ── 新增方法 ──
  
  // 🆕 获取当前边界类型（供 UI 判断）
  getLastBoundary(): 'user' | 'assistant' | 'tool_result' | null;
  
  // 🆕 检查是否有待处理追加
  hasPendingAppend(): boolean;
  
  // 🆕 手动触发消息注入（高级用法）
  flushPendingMessages(): void;
}
```

### App UI API

```typescript
interface AppProps {
  agentLoop: {
    run: (input: string) => Promise<void>;
    stop: () => void;
    interrupt: (appendMessage: string) => void;
    appendMessage: (message: string) => void;
    
    // 🆕 新增
    getLastBoundary: () => 'user' | 'assistant' | 'tool_result' | null;
    hasPendingAppend: () => boolean;
  };
}
```

**UI 层状态管理**：
```typescript
// Pending 队列
const [pendingUserInputs, setPendingUserInputs] = useState<
  Array<{ content: string; timestamp: number }>
>([]);

// 🆕 追加模式
const [appendMode, setAppendMode] = useState<'none' | 'hard' | 'soft'>('none');

// 提交逻辑
const handleSubmit = (input: string) => {
  if (status === 'idle') {
    // 正常提交
    await agentLoop.run(input);
  } else {
    // 执行中追加
    
    // [1] flush + 归档当前流式文本
    if (streamTextUpdaterRef.current) {
      streamTextUpdaterRef.current.flush();
    }
    archiveStreamText();
    
    // [2] 添加到队列（支持合并）
    setPendingUserInputs((prev) => {
      const lastInput = prev[prev.length - 1];
      const shouldMerge = lastInput && (Date.now() - lastInput.timestamp) < 3000;
      
      if (shouldMerge) {
        return [
          ...prev.slice(0, -1),
          { content: `${lastInput.content}\n\n${input}`, timestamp: Date.now() },
        ];
      } else {
        return [...prev, { content: input, timestamp: Date.now() }];
      }
    });
    
    // [3] 根据状态选择追加方式
    if (status === 'thinking') {
      setAppendMode('hard');
      agentLoop.interrupt(input);
    } else if (status === 'tool') {
      setAppendMode('soft');
      agentLoop.appendMessage(input);
    }
  }
};
```

## 事件流图

### 场景 1: 硬中断（thinking 中追加）

```
用户输入 "请简化"
    ↓
[UI] handleSubmit()
    ↓
[UI] flush() + archiveStreamText()  // 保存已输出内容
    ↓
[UI] setPendingUserInputs([...])    // 队列显示
    ↓
[UI] setAppendMode('hard')
    ↓
[UI] agentLoop.interrupt("请简化")
    ↓
[Agent] _interrupted = true
[Agent] _pendingAppendMessage = "请简化"
    ↓
[Agent] toolDispatcher.abortAll()   // 中止工具
[Agent] abort stream                 // 中止流
    ↓
[Stream] interruptChecker() → true
[Stream] break out of loop           // 停止消费事件
    ↓
[Agent] while 循环继续
[Agent] 检测到 _pendingAppendMessage
    ↓
[Agent] 修复消息序列：
    - 如果 last message 是 user → 插入占位 assistant
    - 补全孤立 tool_use → 插入 tool_result
    ↓
[Agent] messageManager.addUserMessage("请简化")
    ↓
[Agent] sleep(1000)  // 延迟 1 秒避免 API 429
    ↓
[Agent] 重新调用 LLM
    ↓
[Stream] 新的 stream 开始
[Stream] text_delta 累积到新的 buffer
    ↓
[UI] onText() → setStreamText()      // 新内容流式显示
    ↓
[Agent] onEnd()
    ↓
[UI] archiveStreamText()             // 归档新内容
[UI] clearPendingUserInputs()        // 清空队列
```

### 场景 2: 温和追加（tool 执行中追加）

```
用户输入 "只看前 100 行"
    ↓
[UI] handleSubmit()
    ↓
[UI] flush() + archiveStreamText()
    ↓
[UI] setPendingUserInputs([...])
    ↓
[UI] setAppendMode('soft')
    ↓
[UI] agentLoop.appendMessage("只看前 100 行")
    ↓
[Agent] _pendingAppendMessage = "只看前 100 行"
[Agent] _interrupted = false         // ⚠️ 不设置中断标志
    ↓
[Tool] read_file 继续执行            // 不中断
    ↓
[Tool] read_file 完成
    ↓
[Agent] onToolEnd() → messageManager.addToolResult()
    ↓
[Agent] while 循环继续
[Agent] 检测到 _pendingAppendMessage（非中断）
    ↓
[Agent] 🆕 boundary = 'tool_result'
[Agent] 注入追加消息到 tool_result 同一个 user message:
    - messageManager.addUserMessage([
        { type: 'tool_result', ... },
        { type: 'text', text: '只看前 100 行' }
      ])
    ↓
[Agent] sleep(500)  // 短延迟（非中断）
    ↓
[Agent] 重新调用 LLM
    ↓
[LLM] 看到 tool_result + 追加指令
[LLM] 调整分析策略：只分析前 100 行
```

### 场景 3: 队列合并

```
时间 T: 用户输入 "请举例"
    ↓
[UI] setPendingUserInputs([{ content: "请举例", timestamp: T }])
    ↓
时间 T+2s: 用户输入 "用 Python"
    ↓
[UI] setPendingUserInputs()
    - 检测到 timestamp 差 < 3s
    - 合并：[{ content: "请举例\n\n用 Python", timestamp: T+2s }]
    ↓
[UI] 显示: "✓ 已合并 2 条补充"
    ↓
时间 T+10s: 用户输入 "加上注释"
    ↓
[UI] setPendingUserInputs()
    - timestamp 差 > 3s
    - 新增：[
        { content: "请举例\n\n用 Python", timestamp: T+2s },
        { content: "加上注释", timestamp: T+10s }
      ]
    ↓
[Agent] 消费队列：
    - 第一轮注入："请举例\n\n用 Python"
    - LLM 完成
    - 第二轮注入："加上注释"
    - LLM 完成
```

## 数据结构定义

### PendingUserInput

```typescript
interface PendingUserInput {
  content: string;           // 用户输入内容
  timestamp: number;         // 添加时间（用于合并判断）
  merged?: boolean;          // 是否由多条消息合并而成
  originalCount?: number;    // 合并前的消息数（用于 UI 提示）
}
```

### AppendContext

```typescript
interface AppendContext {
  mode: 'hard' | 'soft';          // 追加模式
  triggerTime: number;            // 触发时间
  expectedBoundary: string | null; // 预期边界（soft 模式）
  aborted: boolean;               // 是否已中止（hard 模式）
}
```

## 错误处理

### 场景 1: interrupt 期间用户再次输入

```typescript
// AgentLoop.interrupt()
interrupt(appendMessage: string): void {
  if (this._interrupted) {
    // 已经在中断过程中，忽略新的 interrupt
    this.log.warn('Interrupt already in progress, ignoring new interrupt');
    // 可选：追加到 _pendingAppendMessage
    this._pendingAppendMessage = 
      `${this._pendingAppendMessage}\n\n${appendMessage}`;
    return;
  }
  
  // ... 正常中断逻辑
}
```

### 场景 2: appendMessage 期间用户 interrupt

```typescript
// AgentLoop.interrupt()
interrupt(appendMessage: string): void {
  // 清空 soft append，升级为 hard interrupt
  if (this._pendingAppendMessage && !this._interrupted) {
    this.log.info('Upgrading soft append to hard interrupt');
  }
  
  this._interrupted = true;
  this._pendingAppendMessage = appendMessage;
  
  // ... 中断逻辑
}
```

### 场景 3: 工具执行失败后的追加

```typescript
// AgentLoop.run()
try {
  const result = await this.toolDispatcher.execute(toolCall);
  // ... 正常逻辑
} catch (err) {
  // 工具执行失败
  
  // 🆕 检查是否有 pending append
  if (this._pendingAppendMessage) {
    // 将错误 + 追加消息一起反馈给 LLM
    const errorResult = `[ERROR] ${err.message}\n\n用户追加: ${this._pendingAppendMessage}`;
    this.messageManager.addToolResult(toolCall.id, errorResult, true);
    this._pendingAppendMessage = null;
  } else {
    // 正常错误处理
    this.messageManager.addToolResult(toolCall.id, `[ERROR] ${err.message}`, true);
  }
}
```

## 性能优化

### 1. throttle 配置

```typescript
// App.tsx
const STREAM_TEXT_THROTTLE_MS = 50;    // 流式文本更新间隔（降低到 50ms，更流畅）
const TOOL_DELTA_THROTTLE_MS = 500;    // 工具进度更新间隔（保持 500ms，避免过度渲染）
const QUEUE_MERGE_WINDOW_MS = 3000;    // 队列合并窗口（3 秒）
```

### 2. 批量状态更新

```typescript
// 使用 useReducer 而不是多个 useState
const [state, dispatch] = useReducer(appReducer, initialState);

// 一次 dispatch 更新多个字段
dispatch({
  type: 'APPEND_SUBMITTED',
  payload: {
    pendingInputs: [...],
    appendMode: 'hard',
    streamArchived: true,
  },
});
```

### 3. 大文本归档优化

```typescript
// archiveStreamText()
const archiveStreamText = () => {
  const text = streamTextRef.current;
  if (!text) return;
  
  // 超过 100KB 时，只保留最后 50KB
  const MAX_ARCHIVE_SIZE = 100 * 1024;
  const truncated = text.length > MAX_ARCHIVE_SIZE
    ? `... (省略 ${text.length - MAX_ARCHIVE_SIZE} 字符)\n\n` + text.slice(-MAX_ARCHIVE_SIZE / 2)
    : text;
  
  const aid = ++msgIdRef.current;
  setMessages((prev) => [
    ...prev,
    { id: aid, role: 'assistant', content: truncated, timestamp: Date.now() },
  ]);
  
  // 清空
  streamTextRef.current = '';
  streamBufferedRef.current = false;
  setStreamText('');
};
```

## 测试清单

### Unit Tests

- ✅ `StreamProcessor.consume()` 正确累积 text/thinking/tool input
- ✅ `AgentLoop.interrupt()` 设置正确的状态
- ✅ `AgentLoop.appendMessage()` 不中止 stream/工具
- ✅ `ensureToolResultPairing()` 补全孤立 tool_use
- ✅ 队列合并逻辑（3 秒内 → 合并，否则 → 新增）

### Integration Tests

- ✅ thinking 中追加 → 硬中断 → 重新生成
- ✅ tool 执行中追加 → 温和追加 → 工具继续 → 结果反馈
- ✅ 连续追加 → 队列合并 → 批量消费
- ✅ 大文件工具 → tool_use_delta 累积 → 正确解析 JSON
- ✅ 中断 + 孤立 tool_use → 自动补全 tool_result

### E2E Tests

- ✅ 用户在 CLI 中实际操作，验证 UI 反馈
- ✅ 使用真实 LLM API，验证消息序列正确性
- ✅ 压力测试：快速连续输入 10 条追加消息

## 总结

这套协议定义了：
1. **清晰的状态机**：每个状态的转换规则明确
2. **统一的 API**：各层职责分离，接口标准化
3. **完善的错误处理**：边界场景都有应对策略
4. **性能优化指南**：throttle、批量更新、大文本处理
5. **完整的测试清单**：覆盖所有场景

后续实现时，严格遵循这套协议，确保各模块之间的协同工作。
