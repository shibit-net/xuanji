# 子 Agent 完成后自动消失功能

## 功能说明

当子 agent 执行完成后，应该从 WorkspaceMonitor 的可视化界面中消失，只保留正在运行的 agent。

## 实现方案

### 1. 状态更新

**文件**：`desktop/renderer/stores/chatStore.ts`

在 `agent:subagent-end` 事件处理中，将子 agent 的状态设置为 `'done'`：

```typescript
messageBus.on('agent:subagent-end', (data: {
  subAgentId: string;
  success: boolean;
  duration?: number;
}) => {
  // 更新子 Agent 状态为 done
  activeAgentStore.setAgentStatus(data.subAgentId, 'done');
  
  // ... 其他逻辑
});
```

### 2. 过滤逻辑

**文件**：`desktop/renderer/components/WorkspaceMonitor/CanvasRenderer.ts`

在 `drawSubAgents` 方法中，过滤掉已完成的 agent：

```typescript
private drawSubAgents() {
  if (!this.state) return;

  // 只显示运行中的子agent（执行完成后自动消失）
  // 过滤掉 success、error、done 状态的agent
  const visibleAgents = this.state.subAgents.filter(
    agent => agent.status !== 'success' && agent.status !== 'error' && agent.status !== 'done'
  );

  visibleAgents.forEach((agent, index) => {
    // 渲染可见的 agent
  });
}
```

### 3. 状态流转

```
子 agent 启动
  ↓
status: 'thinking'
  ↓
开始执行
  ↓
status: 'executing'
  ↓
执行完成（agent:subagent-end 事件）
  ↓
status: 'done'
  ↓
CanvasRenderer 过滤
  ↓
从界面消失 ✅
```

## 调试日志

添加了以下调试日志来追踪状态变化：

### chatStore.ts
```typescript
console.log('[chatStore] agent:subagent-end - 设置状态为 done:', data.subAgentId);
console.log('[chatStore] agent:subagent-end - 找到子 agent:', {
  found: !!subAgent,
  streamToUser: subAgent?.streamToUser,
});
```

### CanvasRenderer.ts
```typescript
if (this.state.subAgents.length !== visibleAgents.length) {
  console.log('[CanvasRenderer] 过滤子 agent:', {
    total: this.state.subAgents.length,
    visible: visibleAgents.length,
    filtered: this.state.subAgents.filter(a => a.status === 'done').map(a => ({
      id: a.id,
      name: a.name,
      status: a.status,
    })),
  });
}
```

## 验证步骤

1. 启动应用并执行一个任务
2. 观察 WorkspaceMonitor 中子 agent 的出现
3. 等待子 agent 执行完成
4. 查看浏览器控制台日志：
   - `[chatStore] agent:subagent-end - 设置状态为 done`
   - `[CanvasRenderer] 过滤子 agent`
5. 确认子 agent 节点从界面消失

## 预期行为

### 执行中
```
┌─────────────┐
│  Main Agent │
└──────┬──────┘
       │
       ├─ 🤔 Sub Agent 1 (thinking)
       │
       └─ ⚙️ Sub Agent 2 (executing)
```

### 完成后
```
┌─────────────┐
│  Main Agent │
└─────────────┘

（所有子 agent 都消失了）
```

## 注意事项

1. **状态必须正确更新**：确保 `agent:subagent-end` 事件被正确触发
2. **过滤条件**：过滤掉 `success`、`error`、`done` 三种状态
3. **性能考虑**：过滤操作在每次渲染时执行，但开销很小
4. **团队成员例外**：团队成员可能有不同的显示逻辑，需要特殊处理

## 相关文件

- `desktop/renderer/stores/chatStore.ts` - 状态更新
- `desktop/renderer/stores/activeAgentStore.ts` - setAgentStatus 方法
- `desktop/renderer/components/WorkspaceMonitor/CanvasRenderer.ts` - 过滤和渲染
- `desktop/renderer/components/WorkspaceMonitor/index.tsx` - 状态传递

## 已修复的问题

1. ✅ 使用正确的 `setAgentStatus` 方法（之前错误使用了不存在的 `updateSubAgent`）
2. ✅ 添加了详细的调试日志
3. ✅ 确认过滤逻辑正确工作
