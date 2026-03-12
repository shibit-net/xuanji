# 第二次补充输入无响应 - 修复总结

## 问题描述

第一次补充输入正常工作，但第二次补充输入时没有响应，日志显示：
```
appendMessage() called but not running, ignoring
```

## 根本原因

**状态不一致窗口**：`agentLoop.running` 和 UI `status` 之间存在时间差。

**时序分析**：
1. AgentLoop 完成执行，在 finally 块中设置 `running=false`
2. 几百毫秒后，onEnd 回调更新 UI `status='idle'`
3. 在这个窗口期内，用户输入补充内容：
   - `status !== 'idle'`（UI 状态未更新）
   - `agentLoop.running === false`（AgentLoop 已停止）
4. 代码调用 `interrupt()` 或 `appendMessage()`，但因为 `running=false` 被忽略
5. 补充输入被添加到 pending 队列，但从未被处理

## 修复方案

### 修复1：在调用 interrupt/appendMessage 前检查 running 状态

**位置**：`src/adapters/cli/App.tsx:1826-1873`

**逻辑**：
```typescript
if (status === 'thinking') {
  // ★ 新增：检查 AgentLoop 是否在运行 ★
  if (!agentLoop.running) {
    // 已停止 → 不调用 interrupt
    // pending 队列会在 onEnd 时自动处理
    return;
  }

  // ... interrupt 逻辑
}
```

**效果**：
- ✅ 避免无效的 interrupt/appendMessage 调用
- ✅ 避免日志中的"ignoring"警告
- ✅ pending 队列等待 onEnd 自动处理

### 修复2：在 onEnd 时自动处理 pending 队列

**位置**：`src/adapters/cli/App.tsx:1115-1127`

**逻辑**：
```typescript
onEnd: () => {
  // ... 现有逻辑

  // 处理 pending 用户输入队列：自动触发新一轮对话
  if (pendingUserInputs.length > 0) {
    const combinedInput = pendingUserInputs.map(p => p.content).join('\n\n');
    setPendingUserInputs([]);

    // 短暂延迟后触发新一轮对话
    setTimeout(() => {
      handleSubmit(combinedInput);  // 自动添加消息并开始新一轮
    }, 100);
  }
},
```

**效果**：
- ✅ pending 队列中的输入自动被处理
- ✅ 用户无需重新输入
- ✅ 体验流畅，无"卡住"感

## 测试场景

### 场景1：第二次补充输入

**步骤**：
1. 输入："测试你的所有功能"
2. 等待流式输出开始
3. 输入补充："使用英文"（第一次）
4. 等待输出完成
5. 在完成后立即输入："添加更多细节"（第二次，在状态不一致窗口期）

**预期结果**：
- ✅ 第一次补充：正常中断并响应
- ✅ 第二次补充：自动触发新一轮对话（不会"卡住"）
- ✅ 日志无"ignoring"警告
- ✅ 所有补充输入都被正确处理

### 场景2：连续多次补充

**步骤**：
1. 输入："测试你的所有功能"
2. 快速连续补充 3 次：
   - "使用英文"
   - "添加更多细节"
   - "用日语总结"

**预期结果**：
- ✅ 所有补充输入都被处理（可能合并）
- ✅ 无"卡住"或无响应
- ✅ 最终输出符合最后的指令

## 修改文件

- `src/adapters/cli/App.tsx`
  - L1826-1873：添加 `agentLoop.running` 检查
  - L1115-1127：onEnd 时自动处理 pending 队列

## 预期效果

✅ **根本问题解决**：
- 状态不一致窗口期不再导致补充输入丢失
- 第二次、第三次补充输入都能正常工作

✅ **用户体验提升**：
- 无需重新输入
- 无"卡住"感
- 自动连续处理多个补充输入

✅ **代码健壮性**：
- 避免无效的 API 调用
- 日志更清晰（无误导性警告）
- pending 队列可靠处理
