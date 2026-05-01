# Task工具重复展示问题 - 最终修复

## 问题描述

在WorkspaceMonitor中，主agent调用task工具时，右侧显示了2个task标签：
1. 蓝色的：`🤖 task 19.2s`（正在运行，实时显示耗时）
2. 灰色的：`🤖 task`（状态不明）

## 问题根因

通过日志分析发现：
- **只有一个task工具被添加到timeline**（ID: `tooluse_SWCXBYtMhN0LMCoL14u3Yb`）
- 但是**两个不同的方法都在绘制这个工具**：
  1. `drawMomentTag`（第379行）- 绘制`currentMoment`（灰色背景，type='bash'）
  2. `drawToolCallStack`（第385行）- 绘制`timelineEvents`（蓝色背景，status='running'）

**根本原因**：
- `currentMoment`和`timelineEvents`包含了同一个工具调用
- `currentMoment`来自`agentActivity.currentMoments[mainId]`
- `timelineEvents`来自`agentActivity.timelineEvents[mainId]`
- 两者都在`_handleAgentToolStart`中被设置，导致重复

## 解决方案

修改`CanvasRenderer.ts`的`drawMainAgent`方法，优先展示`timelineEvents`：

```typescript
// 区域3：右侧工具调用列表（最近 5 个）
// 🔧 优先展示 timelineEvents（工具调用堆栈）
const hasTimelineEvents = agent.timelineEvents && agent.timelineEvents.length > 0;
if (hasTimelineEvents) {
  const recent5 = agent.timelineEvents.slice(-5);
  this.drawToolCallStack(pos, radius, recent5);
} else if (agent.currentMoment) {
  // 🔧 只有在没有 timelineEvents 时才展示 currentMoment
  // 避免重复展示（currentMoment 和 timelineEvents 可能包含同一个工具）
  this.drawMomentTag(pos, radius, agent.currentMoment);
}
```

**修改前**：
```typescript
// 先绘制 currentMoment
if (agent.currentMoment) {
  this.drawMomentTag(pos, radius, agent.currentMoment);
}

// 再绘制 timelineEvents
if (agent.timelineEvents && agent.timelineEvents.length > 0) {
  const recent5 = agent.timelineEvents.slice(-5);
  this.drawToolCallStack(pos, radius, recent5);
}
```

**修改后**：
- 优先展示`timelineEvents`（工具调用堆栈）
- 只有在没有`timelineEvents`时才展示`currentMoment`
- 避免重复展示同一个工具

## 展示逻辑

### 工具调用展示优先级

1. **有timelineEvents** → 展示工具调用堆栈（`drawToolCallStack`）
   - 蓝色背景（running）
   - 绿色背景（success）
   - 红色背景（error）
   - 显示实时耗时

2. **无timelineEvents，有currentMoment** → 展示当前动作（`drawMomentTag`）
   - 用于展示非工具调用的动作（如thinking、memory等）
   - 灰色背景（bash类型）

### 为什么会有两个数据源？

- **`currentMoment`**：用于展示agent当前的"瞬时动作"（thinking、memory_read等）
- **`timelineEvents`**：用于展示工具调用的"历史堆栈"（最近5个）

在`_handleAgentToolStart`中，两者都被设置：
```typescript
// 设置 currentMoment
actStore.setAgentMoment(currentAgentId, {
  type: momentType.type,
  icon: momentType.icon,
  label: data.name.slice(0, 20),
  durationMs: 0,
  status: 'running',
});

// 设置 timelineEvents
actStore.addTimelineEvent(currentAgentId, {
  id: data.id,
  icon: momentType.icon,
  label: data.name.slice(0, 12),
  status: 'running',
  startTime: Date.now(),
});
```

这导致同一个工具调用被记录在两个地方，如果不做优先级处理，就会重复展示。

## 其他修复

### 1. 删除重复的addTimelineEvent调用

在`chatStore.ts`的`_handleAgentToolStart`中，删除了第753-761行的重复调用。

### 2. 添加防重复逻辑

在`runtimeStore.ts`的`addTimelineEvent`方法中添加了防重复检查：
```typescript
const exists = prev.some(e => e.id === event.id);
if (exists) {
  console.warn('[runtimeStore] ⚠️ 事件已存在，跳过添加:', event.id, event.label);
  return state;
}
```

### 3. 修复mainAgent的ID

将mainAgent的ID从`agent-${Date.now()}`改为固定的`'main'`，确保parentAgentId匹配。

## 验证清单

- [x] task工具不会重复展示
- [x] 蓝色的task标签显示实时耗时
- [x] 灰色的task标签不再出现
- [x] currentMoment和timelineEvents不会同时展示同一个工具
- [x] 子agent的工具调用正确展示在子agent节点下

## 总结

问题的根本原因是**同一个工具调用被记录在两个不同的数据源**（`currentMoment`和`timelineEvents`），并且**两个不同的绘制方法都在绘制它们**。

解决方案是**建立优先级**：优先展示`timelineEvents`（工具调用堆栈），只有在没有`timelineEvents`时才展示`currentMoment`（用于非工具调用的动作）。
