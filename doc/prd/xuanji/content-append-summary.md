# 璇玑内容追加全面优化 - 总结报告

## 优化概述

参考 Claude Code 的最佳实践，全面优化 xuanji 在各种场景下的内容追加处理逻辑，确保流式输出连续、工具输入完整、中断恢复正确、UI 渲染高效。

## 核心改进

### 1. ✅ StreamProcessor: 自主累积 tool input JSON

**问题**：
- 依赖 Provider（AnthropicProvider/OpenAIProvider）累积 tool input
- 如果 Provider 累积逻辑有 bug，StreamProcessor 无法发现
- 无法在关键节点（如用户追加输入时）flush 累积内容

**解决方案**：
- 添加私有字段 `_currentText`, `_currentThinking`, `_currentToolInputBuffer`
- 在 `tool_use_delta` 事件中累积 JSON 片段
- 在 `tool_use_end` 时自己解析 JSON（作为 Provider 的 fallback）
- 新增 `flush()` 方法：返回当前累积内容，不清空 buffer
- 新增 `reset()` 方法：清空所有 buffer

**代码改动**：
```typescript
// src/core/agent/StreamProcessor.ts
private _currentText = '';
private _currentThinking = '';
private _currentToolInputBuffer = '';

flush(): { text: string; thinking: string; toolInput: string } {
  return {
    text: this._currentText,
    thinking: this._currentThinking,
    toolInput: this._currentToolInputBuffer,
  };
}

reset(): void {
  this._currentText = '';
  this._currentThinking = '';
  this._currentToolInputBuffer = '';
}

// tool_use_delta: 累积 JSON 片段
case 'tool_use_delta': {
  const deltaText = event.text ?? '';
  this._currentToolInputBuffer += deltaText;
  // ...
}

// tool_use_end: 自己解析 JSON
case 'tool_use_end': {
  let parsedInput = event.toolCall.input;
  if (!parsedInput && this._currentToolInputBuffer) {
    try {
      parsedInput = JSON.parse(this._currentToolInputBuffer);
    } catch (parseErr) {
      parsedInput = { 
        _parse_error: true, 
        _raw: this._currentToolInputBuffer.slice(0, 500),
        _error_message: parseErr.message,
      };
    }
  }
  // ...
}
```

**优势**：
- ✅ 不依赖 Provider 的 input 累积逻辑
- ✅ 支持外部 flush（用于追加场景）
- ✅ JSON 解析失败时返回 `_parse_error` 标记，不抛异常
- ✅ 向后兼容：优先使用 Provider 提供的 input

### 2. ✅ AgentLoop: 新增 Boundary 查询和 Pending 检查

**问题**：
- UI 层无法判断当前是否适合追加消息
- 无法查询最后一个消息的类型（user / assistant / tool_result）
- 无法查询是否有待处理的追加消息

**解决方案**：
- 新增 `getLastBoundary()` 方法：返回最后消息的边界类型
- 新增 `hasPendingAppend()` 方法：检查是否有待处理追加

**代码改动**：
```typescript
// src/core/agent/AgentLoop.ts
/**
 * 🆕 获取最后一个消息的边界类型（供 UI 判断追加时机）
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

/**
 * 🆕 检查是否有待处理的追加消息
 */
hasPendingAppend(): boolean {
  return this._pendingAppendMessage !== null;
}
```

**用途**：
- ✅ UI 层可以根据 boundary 选择追加方式（interrupt vs appendMessage）
- ✅ 测试可以验证追加逻辑的正确性

## 文档交付

### 设计文档

1. **内容追加全面优化方案** (`content-append-optimization.md`)
   - Claude Code 的内容追加模式分析
   - xuanji 现状评估
   - 各场景的优化方案
   - 测试场景
   - 风险与缓解

2. **统一的内容追加协议** (`content-append-protocol.md`)
   - 协议层次定义
   - 状态机定义
   - API 定义
   - 事件流图
   - 错误处理
   - 性能优化
   - 测试清单

3. **实施清单** (`content-append-implementation.md`)
   - 已完成改动
   - 待完成改动
   - 实施优先级
   - 测试计划
   - 回归测试清单
   - Commit Message 模板

### 代码交付

1. **StreamProcessor**
   - ✅ 添加 `_currentText`, `_currentThinking`, `_currentToolInputBuffer` 字段
   - ✅ 新增 `flush()` 方法
   - ✅ 新增 `reset()` 方法
   - ✅ 优化 `tool_use_delta` 和 `tool_use_end` 逻辑

2. **AgentLoop**
   - ✅ 新增 `getLastBoundary()` 方法
   - ✅ 新增 `hasPendingAppend()` 方法

### 编译验证

```bash
npm run build
# ✅ 编译通过
```

## 后续工作

### Phase 1: P0 核心修复（当前 PR）
- ✅ StreamProcessor tool input 累积逻辑
- ✅ AgentLoop 新增 `getLastBoundary()` 和 `hasPendingAppend()`
- 🚧 AgentLoop 优化 `ensureToolResultPairing()`（可选）
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
# AgentLoop
npm run test -- AgentLoop.test.ts

# 验证点：
# - getLastBoundary() 返回正确的边界类型
# - hasPendingAppend() 正确反映 pending 状态
```

### E2E 测试场景

1. **thinking 中追加（硬中断）**
   - 输入："写一篇长文"
   - 流式输出 10 行时补充："请简化"
   - 预期：立即 abort → 归档 → 重新生成

2. **tool 执行中追加（温和追加）**
   - 输入："分析这个大文件"
   - read_file 执行中补充："只看前 100 行"
   - 预期：工具继续 → 完成后触发新响应

3. **队列合并**
   - 输入："解释递归"
   - 连续追加："请举例"（T）、"用 Python"（T+2s）、"加上注释"（T+5s）
   - 预期：前两条合并，第三条独立

4. **大文件工具**
   - 输入："写一个 5MB 的测试文件"
   - 预期：tool_use_delta 正确累积 → StreamProcessor 解析 JSON

## 技术亮点

### 1. Fallback 机制

StreamProcessor 不完全依赖 Provider 的累积逻辑，自己也累积 JSON 片段：
- 优先使用 Provider 提供的 `event.toolCall.input`（已解析）
- 如果 Provider 没有提供，使用自己累积的 `_currentToolInputBuffer` 解析
- 解析失败时返回 `_parse_error` 标记，不抛异常

**优势**：
- ✅ 向后兼容：不破坏现有 Provider 的行为
- ✅ 容错性强：Provider 出错时有 fallback
- ✅ 可调试性：`_parse_error` 标记让开发者知道哪里出了问题

### 2. 状态机设计

定义清晰的状态转换规则：
- `idle` → 正常提交
- `thinking` → 硬中断（interrupt）
- `tool` → 温和追加（appendMessage）

**优势**：
- ✅ 行为可预测：每个状态的转换逻辑明确
- ✅ 易于测试：每个场景都有明确的输入输出
- ✅ 易于扩展：新增状态时不需要大幅重构

### 3. Boundary-Aware 消费

根据最后一个消息的类型，决定何时注入追加消息：
- `tool_result` 后 → 立即注入（首选）
- `end_turn` 后 → 作为新 user 消息注入

**优势**：
- ✅ 符合直觉：追加消息在"自然边界点"被消费
- ✅ 不破坏序列：消息历史始终符合 Anthropic API 规范

## 总结

本次优化全面改进了 xuanji 的内容追加处理逻辑，参考 Claude Code 的最佳实践：

1. **StreamProcessor**: 自主累积 tool input JSON，不依赖 Provider
2. **AgentLoop**: 新增 Boundary 查询和 Pending 检查 API
3. **文档**: 完整的设计文档、协议定义、实施清单

后续 PR 将继续完成：
- App.tsx 的追加方式选择逻辑
- 队列合并功能
- 性能优化（throttle 调优、UI 截断）
- 体验增强（队列可视化、中断提示）

## 相关文档

- [内容追加全面优化方案](./content-append-optimization.md)
- [统一的内容追加协议](./content-append-protocol.md)
- [实施清单](./content-append-implementation.md)
