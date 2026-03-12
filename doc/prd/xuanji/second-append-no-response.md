# 第二次补充输入无响应问题分析

## 问题描述

第一次补充输入正常工作，但第二次补充输入时没有响应。

## 根本原因

从日志分析：

```
[15:24:07.314] Finally: running=true, iterations=27/Infinity
[15:24:07.637] appendMessage() called but not running, ignoring  ← 323ms 后
[15:24:21.365] appendMessage() called but not running, ignoring  ← 又过了 13 秒
```

**时序分析**：
1. AgentLoop 完成第 27 轮迭代，进入 finally 块，设置 `running=false`
2. 323ms 后，用户输入补充内容
3. 此时：
   - `agentLoop.running = false`（AgentLoop 已停止）
   - 但 UI `status !== 'idle'`（状态还没更新，存在延迟）
4. 代码逻辑：
   ```typescript
   if (status !== 'idle') {
     // ... 添加到 pending 队列
     if (status === 'thinking') {
       interrupt(input);  // 被忽略，因为 running=false
     } else if (status === 'tool') {
       appendMessage(input);  // 被忽略，因为 running=false
     }
   }
   ```
5. **结果**：补充输入被添加到 pending 队列，但没有被处理

## 状态不一致窗口

**问题**：`agentLoop.running` 和 UI `status` 之间存在不一致的时间窗口。

**原因**：
- `running` 在 AgentLoop finally 块中立即设置为 false
- `status` 在 onEnd 回调中异步更新为 'idle'
- 两者之间存在延迟（几百毫秒）

## 修复方案

### 方案1：检查 agentLoop.running 状态（推荐）

在调用 `interrupt()` 或 `appendMessage()` 之前，先检查 AgentLoop 是否在运行。如果不在运行，当做 idle 状态处理。

**修改位置**：`src/adapters/cli/App.tsx:1825-1873`

```typescript
// [3] 根据状态选择追加方式
if (status !== 'idle') {
  // ★ 新增：检查 AgentLoop 是否在运行 ★
  const isAgentRunning = agentLoop.running;

  if (!isAgentRunning) {
    // AgentLoop 已停止但 UI 状态还没更新 → 当做 idle 处理
    // 清空 pending 队列（避免重复处理）
    setPendingUserInputs([]);

    // 当做新一轮对话处理
    // （走到下面的 idle 分支）
  } else if (status === 'thinking') {
    // thinking 中追加 → 硬中断
    // ... 现有逻辑
  } else if (status === 'tool') {
    // tool 执行中 → 温和追加
    agentLoop.appendMessage(input);
  }
  return;
}
```

### 方案2：立即触发新一轮对话

如果 AgentLoop 已停止，立即触发新一轮对话，处理 pending 队列中的所有输入。

```typescript
if (status !== 'idle') {
  const isAgentRunning = agentLoop.running;

  if (!isAgentRunning) {
    // AgentLoop 已停止 → 立即处理 pending 队列
    const allInputs = pendingUserInputs.map(p => p.content).join('\n\n');
    setPendingUserInputs([]);

    // 触发新一轮对话
    handleSubmit(allInputs);
    return;
  }

  // ... 现有逻辑
}
```

### 方案3：在 onEnd 时自动处理 pending 队列

在 AgentLoop 结束时（onEnd 回调），自动检查 pending 队列，如果有内容则立即触发新一轮。

```typescript
onEnd: () => {
  // ... 现有逻辑

  // ★ 新增：自动处理 pending 队列 ★
  if (pendingUserInputs.length > 0) {
    const allInputs = pendingUserInputs.map(p => p.content).join('\n\n');
    setPendingUserInputs([]);

    // 短暂延迟后触发新一轮
    setTimeout(() => {
      handleSubmit(allInputs);
    }, 100);
  }
},
```

## 推荐方案

**方案1 + 方案3 组合**：
1. 在补充输入时检查 `agentLoop.running`，如果已停止则不调用 interrupt/appendMessage
2. 在 onEnd 时自动处理 pending 队列，触发新一轮对话

**优点**：
- ✅ 避免无效的 interrupt/appendMessage 调用
- ✅ 自动处理 pending 队列，无需用户重新输入
- ✅ 用户体验流畅，不会"卡住"

## 实施步骤

1. 修改补充输入逻辑，添加 `agentLoop.running` 检查
2. 修改 onEnd 回调，添加 pending 队列自动处理
3. 测试多次连续补充输入
4. 验证不再出现"无响应"问题
