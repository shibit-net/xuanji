# 工具执行异常处理修复

## 问题描述

用户报告：**xuanji 在调用 read_file 读取文件时，已经读取到文件内容，但是读取文件的指令仍然显示"执行中"的状态**

### 根本原因

在 `src/core/agent/AgentLoop.ts` 中，工具执行代码没有对异常进行处理：

```typescript
// 原始代码（有问题）
for (const toolCall of result.toolCalls) {
  const toolResult = await this.toolDispatcher.execute(toolCall);
  this.callbacks.onToolEnd?.(toolCall.id, toolCall.name, toolResult.content, toolResult.isError);
  this.messageManager.addToolResult(toolCall.id, toolResult);
}
```

当工具执行抛出异常时：
1. `await this.toolDispatcher.execute(toolCall)` 抛出异常
2. 代码直接跳到 catch 块
3. **`onToolEnd` 回调永远不被调用**
4. 工具在 CLI 的 `toolInfoRef` 中仍然存在
5. UI 继续显示"执行工具中..."（因为 `toolInfoRef.current.size > 0`）

## 解决方案

为工具执行添加 try-catch 异常处理：

```typescript
// 修复后的代码
for (const toolCall of result.toolCalls) {
  try {
    const toolResult = await this.toolDispatcher.execute(toolCall);
    this.callbacks.onToolEnd?.(toolCall.id, toolCall.name, toolResult.content, toolResult.isError);
    this.messageManager.addToolResult(toolCall.id, toolResult);
  } catch (toolError) {
    // 工具执行异常：记录错误并继续
    const errorMsg = toolError instanceof Error ? toolError.message : String(toolError);
    // 即使工具失败，也要调用 onToolEnd，并设置 isError=true
    this.callbacks.onToolEnd?.(toolCall.id, toolCall.name, `Error: ${errorMsg}`, true);
    this.messageManager.addToolResult(toolCall.id, {
      content: `Error: ${errorMsg}`,
      isError: true
    });
  }
}
```

### 关键改进

1. **确保 onToolEnd 始终被调用**：无论工具成功还是失败，UI 的 `onToolEnd` 回调都会被调用，从而从 `toolInfoRef` 中删除工具
2. **正确处理错误**：工具异常被作为错误结果传递给 LLM，而不是中断整个流程
3. **用户体验改善**：工具完成状态会正确更新，UI 不再显示"执行工具中"

## 修改文件

- `src/core/agent/AgentLoop.ts` - 添加工具执行异常处理

## 测试

添加了新的单元测试来验证修复：
- `test/unit/agent/ToolExecution.test.ts` - 基础工具执行测试
- `test/unit/agent/MultiToolExecution.test.ts` - 多工具并发执行测试
- `test/unit/agent/ToolErrorHandling.test.ts` - 工具异常处理测试

### 测试结果

```
✓ ToolExecution.test.ts (1 test)
✓ MultiToolExecution.test.ts (1 test)
✓ ToolErrorHandling.test.ts (1 test)
✓ TypeScript compilation passed
```

## 验证方式

1. **单元测试**：运行 `npm run test` 验证工具异常处理
2. **功能测试**：使用 CLI 调用可能失败的工具（如文件不存在的 read_file），验证 UI 正确显示错误并停止"执行中"状态
3. **集成测试**：多工具并发执行时，验证每个工具的完成状态都被正确更新

## 后续影响

此修复确保了：
- ✅ GUI 中工具执行状态的正确显示
- ✅ CLI 中"执行工具中..."状态的正确清理
- ✅ IM Bot 中工具回调的正确调用
- ✅ 错误工具不再导致 UI "卡住"

---

**提交**：2026-02-23
**修复者**：Claude Code
**优先级**：高（影响用户体验）
