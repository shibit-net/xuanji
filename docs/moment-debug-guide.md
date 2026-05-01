# Moment 状态切换问题诊断

## 问题现象

用户报告：在流式输出时触发了 `agent:subagent-text` 事件，但 moment 状态一直没有正确展示。

## 可能的原因

### 1. streamToUser 字段值不正确

**检查点**：
- ✅ `AgentState` 类型定义中包含 `streamToUser` 字段（第 52 行）
- ✅ `agent:subagent-start` 事件中保存了 `streamToUser`（第 2003 行）
- ❓ 后端传递的 `streamToUser` 值是否正确？

**验证方法**：
查看控制台日志：
```
[chatStore] agent:subagent-start - 设置 moment: {subAgentId: '...', streamToUser: ???}
```

如果 `streamToUser` 是 `undefined` 或 `false`，那么在 `agent:subagent-text` 中就不会切换到"编写"状态。

### 2. findAgentById 找不到子 agent

**可能原因**：
- `activeAgentStore.mainAgent` 还没有更新
- 子 agent 的 ID 不匹配
- 树结构有问题

**验证方法**：
查看控制台日志：
```
[chatStore] agent:subagent-text - 查找子 agent: {
  found: false,  // ← 如果是 false，说明找不到
  ...
}
```

如果找不到，会打印整个树结构：
```
[chatStore] agent:subagent-text - 找不到子 agent！打印树结构:
[chatStore] mainAgent: {...}
```

### 3. writingAgents Set 已经包含该 ID

**可能原因**：
- 之前已经设置过"编写"状态
- Set 没有被正确清理

**验证方法**：
查看控制台日志：
```
[chatStore] agent:subagent-text - 查找子 agent: {
  alreadyWriting: true,  // ← 如果是 true，说明已经设置过
  ...
}
```

### 4. moment 被设置了，但没有被渲染

**可能原因**：
- `runtimeStore.currentMoments` 没有更新
- WorkspaceMonitor 没有接收到更新
- CanvasRenderer 没有绘制

**验证方法**：
查看控制台日志链：
```
[chatStore] agent:subagent-text - 调用 setAgentMoment
[runtimeStore] setAgentMoment 被调用: {agentId: '...', moment: {...}}
[runtimeStore] setAgentMoment 之后的 currentMoments: {...}
[WorkspaceMonitor] currentMoments: {...}
[WorkspaceMonitor] SubAgent currentMoment: {subId: '...', currentMoment: {...}}
[CanvasRenderer] 绘制子 agent currentMoment: {agentId: '...', moment: {...}}
```

如果某个日志缺失，说明在那一步出了问题。

### 5. 颜色定义缺失（已修复）

**问题**：`getMomentBgColor` 方法中缺少 `writing` 和 `reporting` 类型的颜色定义。

**修复**：已添加颜色定义
```typescript
writing: 'rgba(52,211,153,0.8)',    // 绿色
reporting: 'rgba(59,130,246,0.8)',  // 蓝色
```

## 诊断步骤

### 步骤1：检查 streamToUser 值

在 `agent:subagent-start` 日志中查看：
```javascript
console.log('[chatStore] agent:subagent-start - 设置 moment:', {
  subAgentId: data.subAgentId,
  streamToUser: data.streamToUser,  // ← 检查这个值
});
```

**预期值**：
- 如果子 agent 直接输出到对话框：`streamToUser: true`
- 如果子 agent 返回给主 agent：`streamToUser: false` 或 `undefined`

**如果值不正确**：
问题在后端，需要检查：
1. `SubAgentFactory` 是否正确传递 `streamToUser`
2. `agent-bridge.ts` 是否正确转发
3. TaskTool 调用时是否设置了 `stream_to_user` 参数

### 步骤2：检查是否找到子 agent

在 `agent:subagent-text` 日志中查看：
```javascript
console.log('[chatStore] agent:subagent-text - 查找子 agent:', {
  found: !!subAgent,  // ← 检查这个值
  subAgentId: data.subAgentId,
  mainAgentId: activeAgentStore.mainAgent?.id,
  mainAgentSubAgentsCount: activeAgentStore.mainAgent?.subAgents?.length || 0,
  streamToUser: subAgent?.streamToUser,
  alreadyWriting: writingAgents.has(data.subAgentId),
});
```

**如果 found: false**：
问题在于 `findAgentById` 找不到子 agent。可能原因：
1. `addSubAgent` 还没有执行完成
2. 子 agent ID 不匹配
3. 树结构有问题

**解决方案**：
检查 `agent:subagent-start` 和 `agent:subagent-text` 的时序，确保 `addSubAgent` 先执行。

### 步骤3：检查 moment 是否被设置

查看日志链：
```
[chatStore] agent:subagent-text - 切换到"编写"状态
[chatStore] agent:subagent-text - 调用 setAgentMoment
[runtimeStore] setAgentMoment 被调用: {...}
[chatStore] agent:subagent-text - setAgentMoment 完成
```

**如果缺少某个日志**：
- 缺少"切换到编写状态"：条件判断失败，检查 `streamToUser` 和 `alreadyWriting`
- 缺少"setAgentMoment 被调用"：`runtimeStore.setAgentMoment` 没有执行
- 缺少"setAgentMoment 完成"：执行过程中出错

### 步骤4：检查 moment 是否被渲染

查看日志链：
```
[WorkspaceMonitor] SubAgent currentMoment: {subId: '...', currentMoment: {...}}
[CanvasRenderer] 绘制子 agent currentMoment: {agentId: '...', moment: {...}}
```

**如果缺少这些日志**：
- 缺少 WorkspaceMonitor 日志：`agentActivity.currentMoments` 没有更新
- 缺少 CanvasRenderer 日志：`agent.currentMoment` 是 `undefined`

## 快速修复方案

如果问题是 `streamToUser` 值不正确，可以临时修改代码，不依赖这个字段：

```typescript
// 临时方案：只要收到 agent:subagent-text 事件，就切换到"编写"状态
messageBus.on('agent:subagent-text', (data) => {
  if (!writingAgents.has(data.subAgentId)) {
    writingAgents.add(data.subAgentId);
    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setAgentMoment(data.subAgentId, {
      type: 'writing',
      icon: '✍️',
      label: '编写',
      durationMs: 0,
      status: 'running',
    });
  }
});
```

这样就不需要查找子 agent 和检查 `streamToUser` 字段了。

## 下一步

请提供以下信息：
1. 浏览器控制台的完整日志（特别是包含 `[chatStore]`、`[runtimeStore]`、`[WorkspaceMonitor]`、`[CanvasRenderer]` 的日志）
2. 是否看到 `agent:subagent-text` 事件被触发？
3. 是否看到"切换到编写状态"的日志？
4. `streamToUser` 的值是什么？

有了这些信息，我可以精确定位问题所在。
