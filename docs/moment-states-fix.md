# 编写和汇报 Moment 状态展示修复

## 问题描述

子 agent 只展示了"思考中"状态，没有展示"编写"和"汇报"两个 moment 状态。

## 根本原因

### 问题1：汇报状态一闪而过

在 `agent:subagent-end` 事件处理中，代码先设置"汇报" moment，然后**立即**调用 `finishAgentMoment` 清除它：

```typescript
// 设置汇报 moment
runtimeStore.setAgentMoment(data.subAgentId, {
  type: 'reporting',
  icon: '📋',
  label: '汇报',
});

// 立即清除！用户根本看不到
runtimeStore.finishAgentMoment(data.subAgentId);
```

### 问题2：编写状态可能没有触发

`agent:subagent-text` 事件可能：
1. 没有被触发
2. `subAgent.streamToUser` 值不正确
3. 每次文本输出都重复设置，导致性能问题

## 修复方案

### 1. 延迟清除汇报状态

让"汇报"状态保持 1 秒，让用户能看到：

```typescript
if (subAgent && !subAgent.streamToUser) {
  // 设置汇报 moment
  runtimeStore.setAgentMoment(data.subAgentId, {
    type: 'reporting',
    icon: '📋',
    label: '汇报',
    durationMs: data.duration || 0,
    status: 'success',
  });

  // 🔧 延迟清除 moment，让用户能看到"汇报"状态（1秒后清除）
  setTimeout(() => {
    runtimeStore.finishAgentMoment(data.subAgentId);
  }, 1000);
} else {
  // 如果是 streamToUser=true，立即清除
  runtimeStore.finishAgentMoment(data.subAgentId);
}
```

### 2. 优化编写状态切换

使用 Set 记录已经切换到"编写"状态的 agent，避免重复设置：

```typescript
// 记录已经切换到"编写"状态的子 agent
const writingAgents = new Set<string>();

messageBus.on('agent:subagent-text', (data) => {
  const subAgent = findAgentById(activeAgentStore.mainAgent, data.subAgentId);

  // 只在第一次收到文本时切换到"编写"状态
  if (subAgent && subAgent.streamToUser && !writingAgents.has(data.subAgentId)) {
    writingAgents.add(data.subAgentId);
    runtimeStore.setAgentMoment(data.subAgentId, {
      type: 'writing',
      icon: '✍️',
      label: '编写',
      durationMs: 0,
      status: 'running',
    });
  }
});

// 在 agent:subagent-end 中清理
messageBus.on('agent:subagent-end', (data) => {
  writingAgents.delete(data.subAgentId);
  // ...
});
```

### 3. 添加详细的调试日志

```typescript
console.log('[chatStore] ===== agent:subagent-text 事件接收 =====');
console.log('[chatStore] subAgentId:', data.subAgentId);
console.log('[chatStore] agent:subagent-text - 查找子 agent:', {
  found: !!subAgent,
  streamToUser: subAgent?.streamToUser,
  alreadyWriting: writingAgents.has(data.subAgentId),
});
```

## 完整的状态流转

### 场景1：streamToUser=true（直接输出到对话框）

```
子 agent 启动
  ↓
agent:subagent-start
  ↓
🤔 思考中（保持）
  ↓
开始输出文本
  ↓
agent:subagent-text（第一次）
  ↓
✍️ 编写（保持到结束）
  ↓
继续输出文本
  ↓
agent:subagent-text（后续）
  ↓
✍️ 编写（不重复设置）
  ↓
执行完成
  ↓
agent:subagent-end
  ↓
立即清除 moment
  ↓
从界面消失
```

### 场景2：streamToUser=false（返回给主 agent）

```
子 agent 启动
  ↓
agent:subagent-start
  ↓
🤔 思考中（保持到结束）
  ↓
执行完成
  ↓
agent:subagent-end
  ↓
📋 汇报（显示 1 秒）
  ↓
1 秒后清除 moment
  ↓
从界面消失
```

## 时间线对比

### 修复前

```
0s    1s    2s    3s    4s    5s
|-----|-----|-----|-----|-----|
🤔 思考中........................
                              ✗ 汇报（一闪而过，看不到）
```

### 修复后

```
0s    1s    2s    3s    4s    5s    6s
|-----|-----|-----|-----|-----|-----|
🤔 思考中.............................
                                📋 汇报（1秒）
```

或者（streamToUser=true）：

```
0s    1s    2s    3s    4s    5s
|-----|-----|-----|-----|-----|
🤔 思考中.....
      ✍️ 编写...................
```

## 验证步骤

### 测试场景1：单个子 agent（streamToUser=true）

**输入**：
```
解读《出师表》
```

**预期**：
1. 子 agent 启动：显示 🤔 思考中
2. 开始输出：切换到 ✍️ 编写
3. 持续输出：保持 ✍️ 编写
4. 完成：moment 消失，节点消失

**控制台日志**：
```
[chatStore] agent:subagent-start - 设置 moment: {subAgentId: '...', streamToUser: true}
[chatStore] ===== agent:subagent-text 事件接收 =====
[chatStore] agent:subagent-text - 切换到"编写"状态
[chatStore] agent:subagent-end - 立即清除 moment
```

### 测试场景2：多个子 agent 协作（streamToUser=false）

**输入**：
```
重构 MainAgent.ts 文件
```

**预期**：
1. 探索 agent 启动：显示 🤔 思考中
2. 探索完成：切换到 📋 汇报（显示 1 秒）
3. 编码 agent 启动：显示 🤔 思考中
4. 编码完成：切换到 📋 汇报（显示 1 秒）

**控制台日志**：
```
[chatStore] agent:subagent-start - 设置 moment: {subAgentId: 'explore-...', streamToUser: false}
[chatStore] agent:subagent-end - 设置汇报 moment
[chatStore] agent:subagent-end - 延迟清除 moment
```

## 相关文件

- `desktop/renderer/stores/chatStore.ts` - 主要修复文件
  - 添加 `writingAgents` Set
  - 修改 `agent:subagent-text` 事件处理
  - 修改 `agent:subagent-end` 事件处理
  - 添加详细的调试日志

## 注意事项

1. **延迟时间**：汇报状态显示 1 秒，可以根据需要调整
2. **内存清理**：`writingAgents` Set 在 agent 结束时清理，避免内存泄漏
3. **性能优化**：使用 Set 避免重复设置 moment，提高性能
4. **用户体验**：确保用户能看到状态变化，不会一闪而过

## 总结

通过以下修复：
1. ✅ 延迟清除汇报状态，让用户能看到
2. ✅ 优化编写状态切换，避免重复设置
3. ✅ 添加详细的调试日志，方便追踪问题

现在用户可以清楚地看到子 agent 的三种状态：
- 🤔 思考中
- ✍️ 编写（streamToUser=true）
- 📋 汇报（streamToUser=false）
