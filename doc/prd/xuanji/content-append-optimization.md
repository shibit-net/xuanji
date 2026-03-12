# Xuanji 内容追加全面优化方案

## 问题背景

参考 Claude Code，全面优化 xuanji 在各种场景下的内容追加处理逻辑，确保：
1. ✅ **流式输出连续**：text_delta 事件能正确累积，不丢失内容
2. ✅ **工具输入完整**：tool_use_delta 事件能正确构建 input JSON
3. ✅ **中断恢复正确**：interrupt 后消息序列不破坏
4. ✅ **UI 渲染高效**：避免频繁重渲染和闪烁
5. ✅ **状态同步准确**：动态区域和 Static 区域内容一致

## Claude Code 的内容追加模式分析

### 1. 流式文本追加 (text_delta)

**Claude Code 行为**：
- ✅ 每个 `text_delta` 事件包含一小段文本（通常 1-10 个 token）
- ✅ Handler 直接追加到当前 buffer，不做任何转换
- ✅ UI 层使用 **throttle**（~100ms）批量更新，避免过度渲染
- ✅ 长文本（>1000 行）时自动切换到 "生成中..." 模式

**Xuanji 现状**：
```typescript
case 'text_delta': {
  if (event.text) {
    currentText += event.text;  // ✅ 正确：直接追加
    this.textHandler?.(event.text);  // ✅ 正确：传递 delta
  }
  break;
}
```

**评估**：✅ 已正确实现

### 2. 思考内容追加 (thinking_delta)

**Claude Code 行为**：
- ✅ Extended Thinking 内容使用独立的累积 buffer
- ✅ 与 text 互斥：同一个 content block 只能是 text 或 thinking
- ✅ UI 中以灰色展示，与正常输出区分

**Xuanji 现状**：
```typescript
case 'thinking_delta': {
  if (event.thinking) {
    currentThinking += event.thinking;  // ✅ 正确
    this.thinkingHandler?.(event.thinking);  // ✅ 正确
  }
  break;
}
```

**评估**：✅ 已正确实现

### 3. 工具输入追加 (tool_use_delta)

**Claude Code 行为**：
- ✅ `tool_use_start` 时只有 id 和 name，input 为 `{}`
- ✅ `tool_use_delta` 事件持续传递 JSON 片段（字符串）
- ✅ 累积所有片段后在 `tool_use_end` 时解析为完整 JSON
- ✅ 大文件工具（write_file）的 input 可能超过 100KB，需分多次传递

**Xuanji 现状**：
```typescript
case 'tool_use_start': {
  // ✅ 正确：创建初始 toolCall，input 为 event.toolCall.input ?? {}
  const toolCall: ToolCall = {
    id: event.toolCall.id,
    name: event.toolCall.name,
    input: event.toolCall.input ?? {},
  };
  this.toolStartHandler?.(toolCall);
  break;
}

case 'tool_use_delta': {
  // ⚠️ 问题：只追踪 size，不累积 JSON 片段
  const deltaSize = event.text?.length ?? 0;
  currentToolInputSize += deltaSize;
  // 这里没有累积 event.text 到一个 buffer
  break;
}

case 'tool_use_end': {
  // ✅ 假设 event.toolCall.input 已经是完整对象
  const toolCall: ToolCall = {
    id: event.toolCall.id,
    name: event.toolCall.name,
    input: event.toolCall.input ?? {},
  };
  toolCalls.push(toolCall);
  this.toolUseHandler?.(toolCall);
  break;
}
```

**问题**：
1. ❌ `tool_use_delta` 只追踪大小，不累积 JSON 片段
2. ❌ 依赖 Provider（AnthropicProvider/OpenAIProvider）在 `tool_use_end` 时提供完整 input
3. ⚠️ 如果 Provider 的累积逻辑有 bug，StreamProcessor 无法发现

**优化方案**：
```typescript
// StreamProcessor 应该自己累积 tool input JSON 片段
private currentToolInputBuffer = '';

case 'tool_use_start': {
  currentToolId = event.toolCall.id;
  currentToolName = event.toolCall.name;
  currentToolInputSize = 0;
  this.currentToolInputBuffer = '';  // 🆕 重置 buffer
  
  const toolCall: ToolCall = {
    id: event.toolCall.id,
    name: event.toolCall.name,
    input: {},  // 初始为空
  };
  this.toolStartHandler?.(toolCall);
  break;
}

case 'tool_use_delta': {
  const deltaText = event.text ?? '';
  const deltaSize = deltaText.length;
  currentToolInputSize += deltaSize;
  this.currentToolInputBuffer += deltaText;  // 🆕 累积 JSON 片段
  
  if (this.toolDeltaHandler && currentToolId && currentToolName) {
    const now = Date.now();
    if (now - lastDeltaNotifyTime >= DELTA_THROTTLE_MS) {
      lastDeltaNotifyTime = now;
      this.toolDeltaHandler(currentToolId, currentToolName, currentToolInputSize);
    }
  }
  break;
}

case 'tool_use_end': {
  // 🆕 自己解析累积的 JSON（作为 Provider 的 fallback）
  let parsedInput = event.toolCall?.input;
  if (!parsedInput && this.currentToolInputBuffer) {
    try {
      parsedInput = JSON.parse(this.currentToolInputBuffer);
    } catch {
      parsedInput = { _parse_error: true, _raw: this.currentToolInputBuffer };
    }
  }
  
  const toolCall: ToolCall = {
    id: event.toolCall.id,
    name: event.toolCall.name,
    input: parsedInput ?? {},
  };
  toolCalls.push(toolCall);
  this.toolUseHandler?.(toolCall);
  
  // 清理
  this.currentToolInputBuffer = '';
  currentToolId = undefined;
  currentToolName = undefined;
  currentToolInputSize = 0;
  break;
}
```

### 4. 中断后的内容追加 (interrupt + append)

**Claude Code 行为**：
- ✅ 用户在流式输出中补充指令 → 立即 abort stream
- ✅ 当前 assistant 消息标记为 "[Interrupted]"
- ✅ 追加的用户消息作为新的 user message 注入
- ✅ LLM 重新生成，基于追加消息调整输出
- ✅ 如果已有 tool_use 但未执行 → 自动补全 tool_result 占位符

**Xuanji 现状**：
```typescript
// AgentLoop.ts - interrupt() 方法
interrupt(appendMessage: string): void {
  this._interrupted = true;
  this._pendingAppendMessage = appendMessage;
  
  // 中止工具和 stream
  this.toolDispatcher.abortAll();
  // ... abort stream logic
}

// AgentLoop.ts - run() 方法
if (this._pendingAppendMessage) {
  const appendMsg = this._pendingAppendMessage;
  const wasInterrupted = this._interrupted;
  this._interrupted = false;
  this._pendingAppendMessage = null;
  this.running = true;
  
  // 修复消息序列
  if (wasInterrupted) {
    const history = this.messageManager.getHistory();
    const lastMsg = history[history.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      // ✅ 插入占位 assistant 消息
      this.messageManager.addAssistantMessage([{
        type: 'text',
        text: '[Interrupted] 用户中断了当前执行并提交了新的指令。',
      }]);
    }
  }
  
  // ✅ 补全 tool_use/tool_result 配对
  const pairedCount = this.messageManager.ensureToolResultPairing();
  if (pairedCount > 0) {
    this.log.warn(`Injected ${pairedCount} placeholder tool_result(s)`);
  }
  
  // 注入用户消息
  this.messageManager.addUserMessage(appendMsg);
  messages = this.messageManager.getMessages();
  
  await sleep(wasInterrupted ? 1000 : 500);
}
```

**评估**：✅ 已正确实现，但有优化空间

**优化方案**：
1. **更细粒度的状态跟踪**：区分 "硬中断"（interrupt）和 "温和追加"（appendMessage）
2. **自动补全 tool_result 的内容**：不只是占位符，应包含中断信息
3. **UI 提示优化**：在动态区域显示 "正在中断..." 状态

### 5. 队列式追加 (Pending Inputs Queue)

**Claude Code 行为**：
- ✅ 用户在工具执行中追加输入 → 不中断工具，消息排队
- ✅ 工具执行完成后，自动触发下一轮对话
- ✅ Boundary-Aware：在"自然边界点"消费队列（tool_result 后、end_turn 后）
- ✅ 多次追加 → 合并为一条消息（避免过多轮次）

**Xuanji 现状**：
```typescript
// App.tsx - handleSubmit()
if (status !== 'idle') {
  // [1] flush + 归档当前流式文本
  if (streamTextUpdaterRef.current) {
    streamTextUpdaterRef.current.flush();
  }
  archiveStreamText();
  
  // [2] 保存到队列
  setPendingUserInputs((prev) => {
    if (prev.length > 0 && prev[prev.length - 1].content === input) {
      return prev;  // 去重
    }
    const newQueue = [...prev, { content: input, timestamp: Date.now() }];
    if (newQueue.length > MAX_PENDING_INPUTS) {
      return newQueue.slice(-MAX_PENDING_INPUTS);
    }
    return newQueue;
  });
  
  // [3] 硬中断
  agentLoop.interrupt(input);
  return;
}
```

**问题**：
1. ❌ 始终使用 `interrupt()`，即使是温和追加场景
2. ❌ 队列最多 5 条，但从不合并消息
3. ⚠️ 没有实现 Boundary-Aware 消费逻辑

**优化方案**：
```typescript
// 区分场景：
// - thinking 状态 → 硬中断（interrupt）
// - tool 状态 → 温和追加（appendMessage）

if (status !== 'idle') {
  // flush + 归档
  if (streamTextUpdaterRef.current) {
    streamTextUpdaterRef.current.flush();
  }
  archiveStreamText();
  
  // 保存到队列（支持合并）
  setPendingUserInputs((prev) => {
    // 🆕 如果最后一条是刚才添加的（时间差 < 3s），合并而不是新增
    const lastInput = prev[prev.length - 1];
    if (lastInput && (Date.now() - lastInput.timestamp) < 3000) {
      return [
        ...prev.slice(0, -1),
        {
          content: `${lastInput.content}\n\n${input}`,
          timestamp: Date.now(),
        },
      ];
    }
    
    // 否则新增
    const newQueue = [...prev, { content: input, timestamp: Date.now() }];
    if (newQueue.length > MAX_PENDING_INPUTS) {
      return newQueue.slice(-MAX_PENDING_INPUTS);
    }
    return newQueue;
  });
  
  // 🆕 根据状态选择追加方式
  if (status === 'thinking') {
    // thinking 中追加 → 硬中断（立即响应用户）
    agentLoop.interrupt(input);
  } else {
    // tool 执行中 → 温和追加（不中断工具）
    agentLoop.appendMessage(input);
  }
  return;
}
```

## 优化清单

### P0 - 核心逻辑修复

#### 1. StreamProcessor: 自己累积 tool input JSON

**文件**: `src/core/agent/StreamProcessor.ts`

**改动**:
- ✅ 添加 `currentToolInputBuffer` 字段
- ✅ 在 `tool_use_start` 时重置 buffer
- ✅ 在 `tool_use_delta` 时累积 JSON 片段
- ✅ 在 `tool_use_end` 时解析 JSON（作为 Provider 的 fallback）

#### 2. AgentLoop: 优化 interrupt 后的 tool_result 补全

**文件**: `src/core/agent/AgentLoop.ts`

**改动**:
- ✅ `ensureToolResultPairing()` 生成的占位符应包含中断信息
- ✅ 区分 "硬中断" 和 "温和追加" 的延迟时间
- ✅ 在 `interrupt()` 时添加调试日志

#### 3. App.tsx: 根据状态选择追加方式

**文件**: `src/adapters/cli/App.tsx`

**改动**:
- ✅ `handleSubmit` 中根据 `status` 选择 `interrupt()` 或 `appendMessage()`
- ✅ 实现队列消息合并逻辑（3 秒内追加 → 合并）
- ✅ 优化 pending 提示 UI（显示队列长度）

### P1 - 性能优化

#### 4. 流式文本更新的 throttle 调优

**文件**: `src/adapters/cli/App.tsx`

**改动**:
- ✅ `createThrottledUpdate` 的间隔从 100ms 降到 50ms（更流畅）
- ✅ 添加 `flush()` 强制刷新机制（在关键节点立即更新）
- ✅ 超长文本（>500 行）自动切换到缓冲模式

#### 5. 工具 input 的 UI 截断优化

**文件**: `src/adapters/cli/App.tsx`

**改动**:
- ✅ `WRITE_CONTENT_PREVIEW_LIMIT` 从 500 提升到 1000
- ✅ 显示截断提示时包含总字节数
- ✅ 可折叠的工具卡片默认折叠大文件工具

### P2 - 用户体验增强

#### 6. Pending Inputs 队列的可视化改进

**文件**: `src/adapters/cli/App.tsx`

**改动**:
- ✅ 显示队列中的所有消息（不只是最后一条）
- ✅ 添加 "合并中..." 动画
- ✅ 支持 Esc 取消队列中的消息

#### 7. 中断恢复的进度提示

**文件**: `src/adapters/cli/App.tsx`

**改动**:
- ✅ 在 `interrupt()` 时显示 "正在中断..."
- ✅ 在消息注入时显示 "正在恢复..."
- ✅ 显示预计等待时间（基于历史数据）

## 测试场景

### 场景 1: 流式输出中追加（thinking 状态）

**操作**:
1. 输入："写一篇长文"
2. LLM 开始流式输出，已输出 10 行
3. 用户追加："请简化"

**预期**:
- ✅ 立即 abort stream
- ✅ 已输出的 10 行归档到 Static
- ✅ 插入占位 assistant 消息（如果 last message 是 user）
- ✅ 补全 tool_result（如果有 orphaned tool_use）
- ✅ 注入用户追加消息
- ✅ 等待 1 秒后重新调用 LLM
- ✅ LLM 基于追加消息生成简化版本

### 场景 2: 工具执行中追加（tool 状态）

**操作**:
1. 输入："分析这个大文件"
2. LLM 调用 `read_file`，正在读取 1GB 文件
3. 用户追加："只看前 100 行"

**预期**:
- ✅ **不中断** read_file（继续执行）
- ✅ 追加消息排队（显示绿色提示）
- ✅ read_file 完成后，自动触发下一轮
- ✅ 下一轮消息中包含追加内容
- ✅ LLM 根据追加消息调整分析策略

### 场景 3: 连续追加（队列）

**操作**:
1. 输入："解释递归"
2. LLM 开始流式输出
3. 用户追加："请举例" (时间 T)
4. 用户追加："用 Python" (时间 T+2s)
5. 用户追加："加上注释" (时间 T+5s)

**预期**:
- ✅ 前两条追加（2 秒内）→ 合并为一条："请举例\n\n用 Python"
- ✅ 第三条追加（5 秒后）→ 作为新的消息
- ✅ 队列显示："2 条待处理消息"
- ✅ LLM 完成当前输出后，消费队列中的消息

### 场景 4: 大文件工具的流式输入

**操作**:
1. 输入："写一个 5MB 的测试文件"
2. LLM 调用 `write_file`，content 参数为 5MB 字符串
3. tool_use_delta 事件持续传递 JSON 片段

**预期**:
- ✅ `tool_use_start` 时显示工具名和空参数
- ✅ `tool_use_delta` 每 500ms 更新一次进度："(1.2MB)"
- ✅ `tool_use_end` 时完整 input 已累积完成
- ✅ StreamProcessor 自己解析 JSON，不依赖 Provider
- ✅ UI 中工具卡片默认折叠（content > 1KB）

### 场景 5: 中断 + 孤立 tool_use

**操作**:
1. 输入："分析项目"
2. LLM 生成 tool_use (read_file)，但 stream 被 interrupt 打断
3. 用户追加："算了，不用分析了"

**预期**:
- ✅ `ensureToolResultPairing()` 自动补全 tool_result
- ✅ tool_result 内容："[Interrupted] 用户中断了工具调用。"
- ✅ 追加消息注入后，LLM 不再尝试执行 read_file
- ✅ LLM 根据追加消息调整回答

## 实现优先级

### Phase 1: 核心修复（1-2 天）
- ✅ StreamProcessor tool input 累积逻辑
- ✅ AgentLoop 中断后的 tool_result 补全优化
- ✅ App.tsx 根据状态选择追加方式

### Phase 2: 性能优化（1 天）
- ✅ throttle 调优
- ✅ UI 截断优化

### Phase 3: 体验增强（1-2 天）
- ✅ 队列可视化
- ✅ 中断恢复提示

## 风险与缓解

### 风险 1: StreamProcessor 自己解析 JSON 可能与 Provider 冲突

**场景**: Provider 已经累积并解析了 input，StreamProcessor 再次解析

**缓解**:
- ✅ 优先使用 `event.toolCall.input`（Provider 提供的）
- ✅ 只有当 Provider 没有提供时才使用 StreamProcessor 的 fallback
- ✅ 添加日志，监控哪种路径被使用

### 风险 2: 队列合并逻辑可能误合并无关消息

**场景**: 用户快速输入两条无关命令，被合并

**缓解**:
- ✅ 合并时间窗口设为 3 秒（较短）
- ✅ 在 UI 中显示 "合并中..."，让用户知道
- ✅ 后续支持 Esc 取消合并

### 风险 3: interrupt 延迟导致用户困惑

**场景**: 用户输入追加后，等待 1 秒才看到响应

**缓解**:
- ✅ 立即显示 "正在中断..." 提示
- ✅ 在动态区域显示倒计时
- ✅ 如果 API 支持，使用 HTTP/2 的 stream cancel 而不是等待

## 后续优化方向

1. **智能合并策略**: 基于语义相似度判断是否合并（而不是时间）
2. **追加历史**: 记录用户的追加习惯，提供快捷选项
3. **多模态追加**: 支持追加图片、文件等
4. **协作模式**: 多用户同时追加时的冲突解决
