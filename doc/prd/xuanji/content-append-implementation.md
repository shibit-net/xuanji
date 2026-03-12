# 内容追加全面优化 - 实施清单

## 实施概述

本文档详细记录 xuanji 内容追加逻辑的全面优化实施过程，包括已完成和待完成的改动。

## 已完成改动

### ✅ 1. StreamProcessor: 自己累积 tool input JSON

**文件**: `src/core/agent/StreamProcessor.ts`

**改动内容**:
1. 添加私有字段:
   ```typescript
   private _currentText = '';
   private _currentThinking = '';
   private _currentToolInputBuffer = '';
   ```

2. 新增 `flush()` 方法:
   ```typescript
   flush(): { text: string; thinking: string; toolInput: string } {
     return {
       text: this._currentText,
       thinking: this._currentThinking,
       toolInput: this._currentToolInputBuffer,
     };
   }
   ```

3. 新增 `reset()` 方法:
   ```typescript
   reset(): void {
     this._currentText = '';
     this._currentThinking = '';
     this._currentToolInputBuffer = '';
   }
   ```

4. 修改 `consume()` 方法:
   - `text_delta`: 使用 `this._currentText` 累积
   - `thinking_delta`: 使用 `this._currentThinking` 累积
   - `tool_use_start`: 重置 `this._currentToolInputBuffer`
   - `tool_use_delta`: 累积 JSON 片段到 `this._currentToolInputBuffer`
   - `tool_use_end`: 自己解析 JSON（作为 Provider 的 fallback）

**优势**:
- ✅ 不依赖 Provider 的 input 累积逻辑
- ✅ 支持外部 flush（用于追加场景）
- ✅ JSON 解析失败时返回 `_parse_error` 标记，不抛异常
- ✅ 向后兼容：优先使用 Provider 提供的 input

**测试**:
```bash
npm run build  # ✅ 编译通过
```

## 待完成改动

### 🚧 2. AgentLoop: 优化 interrupt 后的 tool_result 补全

**文件**: `src/core/agent/AgentLoop.ts`

**计划改动**:

#### 2.1 优化 `ensureToolResultPairing()` 生成的占位符

**当前代码**:
```typescript
// MessageManager.ts
ensureToolResultPairing(): number {
  // ...
  this.addToolResult(toolUseId, '[Interrupted] 工具未执行', false);
}
```

**改进后**:
```typescript
ensureToolResultPairing(reason: 'interrupted' | 'truncated' = 'interrupted'): number {
  // ...
  const errorMsg = reason === 'interrupted'
    ? `[Interrupted] 用户中断了工具调用 "${toolUseName}"。`
    : `[Truncated] 工具调用 "${toolUseName}" 参数被截断，无法执行。`;
  this.addToolResult(toolUseId, errorMsg, false);
}
```

#### 2.2 新增 `getLastBoundary()` 方法

```typescript
// AgentLoop.ts
/**
 * 获取最后一个消息的边界类型（供 UI 判断追加时机）
 */
getLastBoundary(): 'user' | 'assistant' | 'tool_result' | null {
  const history = this.messageManager.getHistory();
  if (history.length === 0) return null;
  
  const lastMsg = history[history.length - 1];
  if (lastMsg.role === 'user') {
    // 检查是否包含 tool_result
    const hasToolResult = Array.isArray(lastMsg.content) &&
      lastMsg.content.some(block => block.type === 'tool_result');
    return hasToolResult ? 'tool_result' : 'user';
  }
  if (lastMsg.role === 'assistant') {
    return 'assistant';
  }
  return null;
}
```

#### 2.3 新增 `hasPendingAppend()` 方法

```typescript
/**
 * 检查是否有待处理的追加消息
 */
hasPendingAppend(): boolean {
  return this._pendingAppendMessage !== null;
}
```

### 🚧 3. App.tsx: 根据状态选择追加方式

**文件**: `src/adapters/cli/App.tsx`

**计划改动**:

#### 3.1 优化 `handleSubmit` 中的执行中追加分支

**当前代码**:
```typescript
if (status !== 'idle') {
  if (streamTextUpdaterRef.current) {
    streamTextUpdaterRef.current.flush();
  }
  archiveStreamText();
  
  setPendingUserInputs((prev) => {
    // 去重
    if (prev.length > 0 && prev[prev.length - 1].content === input) {
      return prev;
    }
    const newQueue = [...prev, { content: input, timestamp: Date.now() }];
    if (newQueue.length > MAX_PENDING_INPUTS) {
      return newQueue.slice(-MAX_PENDING_INPUTS);
    }
    return newQueue;
  });
  
  // 🔴 问题：始终使用 interrupt()
  agentLoop.interrupt(input);
  return;
}
```

**改进后**:
```typescript
if (status !== 'idle') {
  // [1] flush + 归档当前流式文本
  if (streamTextUpdaterRef.current) {
    streamTextUpdaterRef.current.flush();
  }
  archiveStreamText();
  
  // [2] 添加到队列（支持合并）
  setPendingUserInputs((prev) => {
    const lastInput = prev[prev.length - 1];
    // 🆕 3 秒内追加 → 合并消息
    const shouldMerge = lastInput && (Date.now() - lastInput.timestamp) < 3000;
    
    if (shouldMerge) {
      return [
        ...prev.slice(0, -1),
        {
          content: `${lastInput.content}\n\n${input}`,
          timestamp: Date.now(),
          merged: true,
          originalCount: (lastInput.originalCount ?? 1) + 1,
        },
      ];
    } else {
      // 去重检查
      if (lastInput && lastInput.content === input) {
        return prev;
      }
      const newQueue = [...prev, { content: input, timestamp: Date.now() }];
      if (newQueue.length > MAX_PENDING_INPUTS) {
        return newQueue.slice(-MAX_PENDING_INPUTS);
      }
      return newQueue;
    }
  });
  
  // [3] 🆕 根据状态选择追加方式
  if (status === 'thinking') {
    // thinking 中追加 → 硬中断（立即响应用户）
    agentLoop.interrupt(input);
  } else if (status === 'tool') {
    // tool 执行中 → 温和追加（不中断工具）
    agentLoop.appendMessage(input);
  }
  return;
}
```

#### 3.2 优化 pending 提示 UI

**当前代码**:
```typescript
{pendingUserInput && status !== 'idle' && !hasInteractiveUI && (
  <Box marginTop={1} marginBottom={1}>
    <Text color="#10B981">✓ </Text>
    <Text color="gray">已收到补充：</Text>
    <Text color="#10B981">
      {pendingUserInput.content.slice(0, 60)}
      {pendingUserInput.content.length > 60 ? '...' : ''}
    </Text>
  </Box>
)}
```

**改进后**:
```typescript
{pendingUserInputs.length > 0 && status !== 'idle' && !hasInteractiveUI && (
  <Box flexDirection="column" marginTop={1} marginBottom={1}>
    {/* 显示队列中的所有消息 */}
    {pendingUserInputs.map((input, index) => (
      <Box key={index}>
        <Text color="#10B981">
          {index === pendingUserInputs.length - 1 ? '✓ ' : '  '}
        </Text>
        <Text color="gray">
          {input.merged ? `已合并 ${input.originalCount} 条补充：` : '已收到补充：'}
        </Text>
        <Text color="#10B981">
          {input.content.slice(0, 60)}
          {input.content.length > 60 ? '...' : ''}
        </Text>
      </Box>
    ))}
    {/* 队列摘要 */}
    {pendingUserInputs.length > 1 && (
      <Box marginTop={0.5}>
        <Text color="gray" dimColor>
          共 {pendingUserInputs.length} 条待处理消息
        </Text>
      </Box>
    )}
  </Box>
)}
```

#### 3.3 添加类型定义

```typescript
// App.tsx - types
interface PendingUserInput {
  content: string;
  timestamp: number;
  merged?: boolean;       // 🆕 是否由多条消息合并而成
  originalCount?: number; // 🆕 合并前的消息数
}
```

### 🚧 4. throttle 配置优化

**文件**: `src/adapters/cli/App.tsx`

**当前配置**:
```typescript
const STREAM_TEXT_THROTTLE_MS = 100;  // 流式文本更新间隔
```

**改进后**:
```typescript
const STREAM_TEXT_THROTTLE_MS = 50;   // 🆕 降低到 50ms，更流畅
const TOOL_DELTA_THROTTLE_MS = 500;   // 工具进度更新间隔（保持不变）
const QUEUE_MERGE_WINDOW_MS = 3000;   // 🆕 队列合并窗口（3 秒）
```

### 🚧 5. UI 截断优化

**文件**: `src/adapters/cli/App.tsx`

**当前配置**:
```typescript
const WRITE_CONTENT_PREVIEW_LIMIT = 500;
```

**改进后**:
```typescript
const WRITE_CONTENT_PREVIEW_LIMIT = 1000;  // 🆕 提升到 1000 字符
```

**truncateToolInput 函数优化**:
```typescript
function truncateToolInput(name: string, input: Record<string, unknown>): Record<string, unknown> {
  if (name === 'write_file' && typeof input.content === 'string') {
    const content = input.content;
    if (content.length > WRITE_CONTENT_PREVIEW_LIMIT) {
      // 🆕 显示总字节数（更直观）
      const totalBytes = new TextEncoder().encode(content).length;
      const kbSize = (totalBytes / 1024).toFixed(1);
      return {
        ...input,
        content: content.slice(0, WRITE_CONTENT_PREVIEW_LIMIT)
          + `\n... (共 ${content.length} 字符 / ${kbSize} KB，已省略 ${content.length - WRITE_CONTENT_PREVIEW_LIMIT} 字符)`,
      };
    }
  }
  return input;
}
```

## 实施优先级

### Phase 1: P0 核心修复（本次 PR）
- ✅ StreamProcessor tool input 累积逻辑
- 🚧 AgentLoop 新增 `getLastBoundary()` 和 `hasPendingAppend()`
- 🚧 AgentLoop 优化 `ensureToolResultPairing()`
- 🚧 App.tsx 根据状态选择追加方式
- 🚧 App.tsx 队列合并逻辑

### Phase 2: P1 性能优化（后续 PR）
- 🔮 throttle 调优（50ms）
- 🔮 UI 截断优化（1000 字符）
- 🔮 大文件工具卡片默认折叠

### Phase 3: P2 体验增强（后续 PR）
- 🔮 队列可视化（显示所有消息）
- 🔮 中断恢复提示（"正在中断..."）
- 🔮 支持 Esc 取消队列中的消息

## 测试计划

### 单元测试

```bash
# StreamProcessor
npm run test -- StreamProcessor.test.ts

# 验证点：
# - flush() 返回正确的累积内容
# - reset() 清空所有 buffer
# - tool_use_delta 正确累积 JSON 片段
# - tool_use_end 正确解析 JSON
# - JSON 解析失败时返回 _parse_error
```

### 集成测试

```bash
# AgentLoop interrupt + appendMessage
npm run test -- AgentLoop.test.ts

# 验证点：
# - interrupt() 设置 _interrupted 标志
# - appendMessage() 不设置 _interrupted 标志
# - ensureToolResultPairing() 补全孤立 tool_use
# - getLastBoundary() 返回正确的边界类型
```

### E2E 测试

**场景 1: thinking 中追加**
```
1. 输入："写一篇长文"
2. LLM 开始流式输出，已输出 10 行
3. 用户追加："请简化"
4. 验证：
   - ✅ 立即 abort stream
   - ✅ 已输出的 10 行归档到 Static
   - ✅ 插入占位 assistant 消息
   - ✅ 补全 tool_result（如果有孤立 tool_use）
   - ✅ 注入用户追加消息
   - ✅ 重新调用 LLM
```

**场景 2: tool 执行中追加**
```
1. 输入："分析这个大文件"
2. LLM 调用 read_file，正在读取
3. 用户追加："只看前 100 行"
4. 验证：
   - ✅ read_file 继续执行（不中断）
   - ✅ 追加消息排队
   - ✅ read_file 完成后，自动触发下一轮
   - ✅ LLM 根据追加消息调整策略
```

**场景 3: 队列合并**
```
1. 输入："解释递归"
2. LLM 开始流式输出
3. 用户追加："请举例" (T)
4. 用户追加："用 Python" (T+2s)
5. 用户追加："加上注释" (T+5s)
6. 验证：
   - ✅ 前两条追加合并为："请举例\n\n用 Python"
   - ✅ 第三条追加作为新消息
   - ✅ 队列显示："共 2 条待处理消息"
```

**场景 4: 大文件工具**
```
1. 输入："写一个 5MB 的测试文件"
2. LLM 调用 write_file，content 参数为 5MB 字符串
3. 验证：
   - ✅ tool_use_start 时显示工具名和空参数
   - ✅ tool_use_delta 每 500ms 更新进度："(1.2MB)"
   - ✅ tool_use_end 时完整 input 已累积完成
   - ✅ StreamProcessor 自己解析 JSON
   - ✅ UI 中工具卡片显示截断提示
```

## 回归测试清单

完成所有改动后，运行以下回归测试：

```bash
# 1. 编译检查
npm run build

# 2. 单元测试
npm run test

# 3. 启动 CLI，手动测试
npm run dev

# 手动测试场景：
# - [x] 正常对话（无追加）
# - [x] thinking 中追加（硬中断）
# - [x] tool 执行中追加（温和追加）
# - [x] 连续追加（队列合并）
# - [x] Ctrl+C 中断
# - [x] 长文本输出（缓冲模式）
# - [x] 大文件工具（write_file）
```

## Commit Message 模板

```
feat: 全面优化内容追加逻辑

参考 Claude Code，优化 xuanji 在各种场景下的内容追加处理：

**核心改进**:
- StreamProcessor 自己累积 tool input JSON（不依赖 Provider）
- 新增 flush() 和 reset() 方法，支持外部管理 buffer
- JSON 解析失败时返回 _parse_error 标记，不抛异常

**追加逻辑优化**:
- 根据状态选择追加方式：thinking → interrupt, tool → appendMessage
- 支持队列消息合并（3 秒内追加 → 合并）
- 优化 pending 提示 UI（显示队列长度）

**修复问题**:
- 修复大文件工具 input 累积不完整的问题
- 修复 thinking 中追加导致已输出内容丢失的问题
- 修复连续追加时状态混乱的问题

**测试**:
- 新增 StreamProcessor.flush() 单元测试
- 新增队列合并集成测试
- 手动验证 thinking/tool 追加场景

Breaking Change: 无
```

## 后续优化方向

1. **智能合并策略**: 基于语义相似度判断是否合并（而不是时间）
2. **追加历史**: 记录用户的追加习惯，提供快捷选项
3. **性能监控**: 记录 flush/merge 的执行时间，优化瓶颈
4. **A/B Testing**: 对比 interrupt vs appendMessage 的用户体验

## 参考文档

- [内容追加全面优化方案](./content-append-optimization.md)
- [统一的内容追加协议](./content-append-protocol.md)
- [补充输入流式输出交互重新设计方案](./stream-append-redesign.md)
