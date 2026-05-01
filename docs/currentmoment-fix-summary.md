# currentMoment 展示问题修复总结

## 问题描述

子 agent 的 currentMoment（思考中/编写/汇报等状态标签）没有在 WorkspaceMonitor 中展示。

## 根本原因

在 `CanvasRenderer.ts` 的 `drawSubAgents` 方法中，**缺少绘制 currentMoment 的代码**。

虽然主 agent 的 `drawMainAgent` 方法中有绘制 currentMoment 的逻辑（第 386-388 行），但子 agent 的 `drawSubAgents` 方法中没有对应的代码。

## 修复方案

在 `drawSubAgents` 方法中添加绘制 currentMoment 的代码：

```typescript
// 🔧 绘制 currentMoment（思考中/编写/汇报等状态）
if (agent.currentMoment) {
  console.log('[CanvasRenderer] 绘制子 agent currentMoment:', {
    agentId: agent.id,
    agentName: agent.name,
    moment: agent.currentMoment,
  });
  this.drawMomentTag(pos, radius, agent.currentMoment);
}
```

## 完整的数据流

### 1. 后端发送事件

```typescript
// SubAgentFactory.ts
this.hookRegistry.emit('SubAgentStart', {
  subAgentId,
  data: {
    task: options.task,
    role: config.id,
    name: config.name,
    streamToUser: options.streamToUser || false,
  },
});
```

### 2. agent-bridge 转发事件

```typescript
// agent-bridge.ts
safeSend({
  type: 'agent:subagent-start',
  data: {
    subAgentId: ctx.subAgentId,
    name: ctx.data?.name || role,
    streamToUser: ctx.data?.streamToUser || false,
  },
});
```

### 3. chatStore 处理事件并设置 moment

```typescript
// chatStore.ts
messageBus.on('agent:subagent-start', (data) => {
  // 添加子 agent 到 activeAgentStore
  activeAgentStore.addSubAgent(data.parentId, {
    id: data.subAgentId,
    name: data.name,
    streamToUser: data.streamToUser,
    // ...
  });

  // 设置 moment
  runtimeStore.setAgentMoment(data.subAgentId, {
    type: 'thinking',
    icon: '🤔',
    label: '思考中',
    durationMs: 0,
    status: 'running',
  });
});
```

### 4. WorkspaceMonitor 构建状态

```typescript
// index.tsx
const subAgents: SubAgentData[] = activeMainAgent ? flattenAgents(activeMainAgent, mainId) : [];

// flattenAgents 中
currentMoment: agentActivity.currentMoments[subId],  // 从 runtimeStore 获取
```

### 5. CanvasRenderer 渲染

```typescript
// CanvasRenderer.ts - drawSubAgents
visibleAgents.forEach((agent) => {
  // ... 绘制圆形、图标、名称等

  // 🔧 绘制 currentMoment
  if (agent.currentMoment) {
    this.drawMomentTag(pos, radius, agent.currentMoment);
  }
});
```

## moment 状态流转

### 子 agent 启动
```
agent:subagent-start
  ↓
setAgentMoment(subAgentId, {
  type: 'thinking',
  icon: '🤔',
  label: '思考中'
})
  ↓
WorkspaceMonitor 显示：🤔 思考中
```

### 子 agent 开始输出（streamToUser=true）
```
agent:subagent-text
  ↓
setAgentMoment(subAgentId, {
  type: 'writing',
  icon: '✍️',
  label: '编写'
})
  ↓
WorkspaceMonitor 显示：✍️ 编写
```

### 子 agent 完成（streamToUser=false）
```
agent:subagent-end
  ↓
setAgentMoment(subAgentId, {
  type: 'reporting',
  icon: '📋',
  label: '汇报'
})
  ↓
finishAgentMoment(subAgentId)
  ↓
WorkspaceMonitor 显示：📋 汇报（短暂显示后消失）
```

## 修复的文件

### 1. CanvasRenderer.ts
**位置**：`desktop/renderer/components/WorkspaceMonitor/CanvasRenderer.ts`

**修改**：在 `drawSubAgents` 方法中添加绘制 currentMoment 的代码

**代码行**：约第 563-570 行

### 2. 之前的修复（已完成）

- ✅ `chatStore.ts` - 设置 moment 的逻辑
- ✅ `index.tsx` - 状态更新顺序修复
- ✅ `activeAgentStore.ts` - 添加 streamToUser 字段
- ✅ `types.ts` - 添加 writing 和 reporting 类型

## 验证步骤

1. 启动应用并执行一个任务
2. 观察 WorkspaceMonitor 中子 agent 的出现
3. 查看浏览器控制台日志：
   ```
   [chatStore] agent:subagent-start - 设置 moment: {subAgentId: '...', streamToUser: false}
   [runtimeStore] setAgentMoment 被调用: {agentId: '...', moment: {...}}
   [WorkspaceMonitor] SubAgent currentMoment: {subId: '...', currentMoment: {...}}
   [CanvasRenderer] 绘制子 agent currentMoment: {agentId: '...', moment: {...}}
   ```
4. 确认子 agent 节点旁边显示 moment 标签

## 预期效果

### 思考中
```
     ┌─────────┐
     │ 🤖 Main │
     └────┬────┘
          │
          ├─ 🔍 Sub Agent 1  🤔 思考中
          │
          └─ 📝 Sub Agent 2  🤔 思考中
```

### 编写中（streamToUser=true）
```
     ┌─────────┐
     │ 🤖 Main │
     └────┬────┘
          │
          └─ 🔍 Sub Agent 1  ✍️ 编写
```

### 汇报中（streamToUser=false）
```
     ┌─────────┐
     │ 🤖 Main │
     └────┬────┘
          │
          └─ 🔍 Sub Agent 1  📋 汇报
```

## 相关文件

- `desktop/renderer/components/WorkspaceMonitor/CanvasRenderer.ts` - 渲染逻辑
- `desktop/renderer/components/WorkspaceMonitor/index.tsx` - 状态构建
- `desktop/renderer/stores/chatStore.ts` - 事件处理和 moment 设置
- `desktop/renderer/stores/runtimeStore.ts` - moment 存储
- `desktop/renderer/stores/activeAgentStore.ts` - agent 状态管理
- `desktop/renderer/components/WorkspaceMonitor/types.ts` - 类型定义

## 总结

问题的根本原因是 `drawSubAgents` 方法中缺少绘制 currentMoment 的代码。虽然数据流是正确的（moment 被正确设置到 runtimeStore，并传递到 WorkspaceMonitor），但在最后的渲染环节被遗漏了。

修复后，子 agent 和主 agent 都会正确显示 currentMoment 标签，用户可以清楚地看到每个 agent 的当前状态。
