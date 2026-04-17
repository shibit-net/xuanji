# GUI 崩溃感知修复

## 问题描述

当 Agent 子进程发生未捕获的异常时，进程会崩溃退出，但 GUI 无法感知到错误，导致界面卡在"思考中"状态，用户体验极差。

## 根本原因

1. **agent-bridge.ts 缺少全局错误处理**
   - 没有监听 `uncaughtException` 事件
   - 没有监听 `unhandledRejection` 事件
   - 子进程崩溃时没有通知主进程

2. **工具执行中的空指针访问**
   - `result.toolCalls` 可能是 `undefined`
   - 多处代码直接访问 `.length` 导致 `TypeError`
   - 错误抛出后导致进程崩溃

## 修复方案

### 1. 添加全局错误处理（agent-bridge.ts）

```typescript
// 捕获未处理的同步异常
process.on('uncaughtException', (err: Error) => {
  console.error('[agent-bridge] ❌ Uncaught Exception:', err);

  // 通知 GUI 发生错误
  safeSend({
    type: 'agent:error',
    data: `致命错误: ${err.message}`,
  });

  // 通知 GUI 恢复到 idle 状态
  safeSend({
    type: 'agent:end',
    data: { tokenUsage: {...}, cost: 0, currentIteration: 0 },
  });

  // 延迟退出，确保消息发送成功
  setTimeout(() => process.exit(1), 100);
});

// 捕获未处理的 Promise rejection
process.on('unhandledRejection', (reason: any) => {
  console.error('[agent-bridge] ❌ Unhandled Rejection:', reason);

  safeSend({
    type: 'agent:error',
    data: `未处理的异步错误: ${errorMessage}`,
  });

  safeSend({
    type: 'agent:end',
    data: { tokenUsage: {...}, cost: 0, currentIteration: 0 },
  });

  setTimeout(() => process.exit(1), 100);
});
```

**关键点**：
- ✅ 发送 `agent:error` 显示错误消息
- ✅ 发送 `agent:end` 让 GUI 恢复到 idle 状态
- ✅ 延迟 100ms 退出，确保消息发送成功
- ✅ 消息格式与 `onError` 回调一致（字符串，不是对象）

### 2. 修复空指针访问（AgentLoop.ts）

```typescript
// 修复前
result.toolCalls.length  // ❌ 如果 toolCalls 是 undefined，崩溃

// 修复后
result.toolCalls?.length ?? 0  // ✅ 安全访问
```

**修复位置**：
- AgentLoop.ts 第 345 行
- AgentLoop.ts 第 360 行
- AgentLoop.ts 第 366 行

### 3. 添加防御性检查（ToolExecutionCoordinator.ts）

```typescript
async executeTools(result: ProcessResult, ...): Promise<ToolExecutionResult> {
  // 防御性检查：如果没有工具调用，直接返回空结果
  if (!result.toolCalls || result.toolCalls.length === 0) {
    return {
      resultsMap: new Map(),
      totalDurationMs: 0,
      statsUpdates: new Map(),
      fileChanges: [],
    };
  }

  // ... 正常执行逻辑
}
```

**修复位置**：
- `executeTools()` 方法开头
- `groupAndPrepareTools()` 方法开头

## 测试场景

### 场景 1：工具执行出错
```
用户：调用一个会崩溃的工具
  ↓
工具抛出未捕获的异常
  ↓
uncaughtException 捕获错误
  ↓
发送 agent:error + agent:end
  ↓
GUI 显示错误消息并恢复到 idle 状态 ✅
```

### 场景 2：异步错误
```
用户：触发一个未处理的 Promise rejection
  ↓
unhandledRejection 捕获错误
  ↓
发送 agent:error + agent:end
  ↓
GUI 显示错误消息并恢复到 idle 状态 ✅
```

### 场景 3：空工具调用
```
LLM 返回响应，但没有工具调用
  ↓
result.toolCalls 是 undefined
  ↓
防御性检查返回空结果
  ↓
正常继续执行，不会崩溃 ✅
```

## 用户体验改进

### 修复前
```
用户：发送消息
GUI：显示"思考中..."
Agent：崩溃（未捕获异常）
GUI：永远卡在"思考中"状态 ❌
用户：不知道发生了什么，只能重启应用
```

### 修复后
```
用户：发送消息
GUI：显示"思考中..."
Agent：崩溃（未捕获异常）
GUI：显示"❌ 错误：致命错误: xxx" ✅
GUI：恢复到 idle 状态，可以继续使用 ✅
用户：知道发生了错误，可以重试或报告问题
```

## 相关文件

### 修改的文件
- `desktop/main/agent-bridge.ts` — 添加全局错误处理
- `src/core/agent/AgentLoop.ts` — 修复空指针访问
- `src/core/agent/ToolExecutionCoordinator.ts` — 添加防御性检查
- `src/core/tools/TodoArchiveTool.ts` — 修复返回格式

### 已有的错误处理链
1. **agent-bridge.ts** → 捕获全局错误 → 发送 `agent:error`
2. **index.ts (主进程)** → 转发 `agent:error` → 渲染进程
3. **chatStore.ts** → `_handleAgentError()` → 显示错误消息

## 最佳实践

### 1. 所有异步操作都应该有错误处理
```typescript
// ❌ 不好
async function doSomething() {
  await riskyOperation();  // 如果出错，unhandledRejection
}

// ✅ 好
async function doSomething() {
  try {
    await riskyOperation();
  } catch (err) {
    logger.error('Operation failed:', err);
    throw err;  // 或者返回错误结果
  }
}
```

### 2. 访问可能为空的属性时使用可选链
```typescript
// ❌ 不好
const length = result.toolCalls.length;

// ✅ 好
const length = result.toolCalls?.length ?? 0;
```

### 3. 工具返回值必须符合 ToolResult 接口
```typescript
// ❌ 不好
return { success: true, data: '...' };

// ✅ 好
return { content: '...', isError: false };
```

## 监控和调试

### 查看错误日志
```bash
# 主进程日志
tail -f ~/Library/Logs/xuanji/main.log

# 渲染进程日志（开发者工具 Console）
```

### 触发测试错误
```typescript
// 在 agent-bridge.ts 中临时添加
setTimeout(() => {
  throw new Error('Test uncaught exception');
}, 5000);
```

## 总结

通过这次修复，xuanji 的错误处理机制更加健壮：

✅ **全局错误捕获** — 任何未处理的异常都会被捕获
✅ **GUI 感知错误** — 用户能看到错误消息，不会卡住
✅ **优雅降级** — 错误发生后 GUI 恢复到可用状态
✅ **防御性编程** — 空指针检查防止崩溃
✅ **一致的错误格式** — 所有错误消息格式统一

现在即使 Agent 崩溃，用户也能知道发生了什么，并且可以继续使用应用！
