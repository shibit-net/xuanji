# 意图分析Prompt组合内容展示问题

## 问题描述

在WorkspaceMonitor中，当task工具开始执行时，右侧显示了一个蓝色标签，包含多行内容：
```
🤖 task    22.5s
   Base Identity
   Memory Guide
   Task Execution
   ...
```

**问题**：这些详细的prompt组合内容应该在任务开始执行时就消失，只保留简单的"task 22.5s"。

## 问题根因

这个多行内容来自之前的`currentMoment`设置。在修改之前，工具调用会同时设置：
1. `currentMoment` - 用于展示当前动作（可能包含详细信息）
2. `timelineEvents` - 用于展示工具调用堆栈

`drawMomentTag`方法支持多行文本（用`\n`分隔），所以如果`currentMoment.label`包含换行符，就会显示成多行。

## 解决方案

我们已经在之前的修改中移除了工具调用的`setAgentMoment`调用：

### 修改位置：`desktop/renderer/stores/chatStore.ts`

**修改前**：
```typescript
// _handleAgentToolStart 中
actStore.setAgentMoment(currentAgentId, {
  type: momentType.type,
  icon: momentType.icon,
  label: data.name.slice(0, 20), // 可能包含详细信息
  durationMs: 0,
  status: 'running',
});
actStore.addTimelineEvent(currentAgentId, {
  id: data.id,
  icon: momentType.icon,
  label: data.name.slice(0, 12),
  status: 'running',
  startTime: Date.now(),
});
```

**修改后**：
```typescript
// _handleAgentToolStart 中
// 🔧 工具调用统一使用 timelineEvents 展示，不再使用 currentMoment
actStore.addTimelineEvent(currentAgentId, {
  id: data.id,
  icon: momentType.icon,
  label: data.name.slice(0, 12), // 只显示工具名称，最多12个字符
  status: 'running',
  startTime: Date.now(),
});
```

## 展示效果

### 修改前（有问题）
```
┌─────────────────┐
│                 │
│   🤖 Xuanji    │
│                 │
└─────────────────┘
         │
         └─→ 🤖 task    22.5s  ← currentMoment（多行，包含详细信息）
                Base Identity
                Memory Guide
                Task Execution
                ...
```

### 修改后（正确）
```
┌─────────────────┐
│                 │
│   🤖 Xuanji    │
│                 │
└─────────────────┘
         │
         └─→ 🤖 task  22.5s  ← timelineEvents（单行，只显示工具名和耗时）
```

## 验证

修改后，工具调用只会在`timelineEvents`中展示，显示格式为：
- **图标** + **工具名**（最多12个字符）+ **耗时**
- 单行显示
- 不包含详细的input参数信息

详细的input参数信息只会在：
1. **recentEvents**（左下角事件流）中显示前40个字符
2. **悬停详情卡片**中显示（如果实现了）

## 相关修改

这个问题的修复是"统一使用timelineEvents展示工具调用"的一部分，相关文档：
- `UNIFIED_TIMELINE_EVENTS.md` - 统一使用timelineEvents的完整方案
- `TASK_DUPLICATE_FINAL_FIX.md` - task工具重复展示问题的修复

## 注意事项

如果在修改后仍然看到多行内容，可能是因为：
1. **缓存问题** - 需要刷新页面或重启应用
2. **旧数据残留** - 之前的`currentMoment`数据还在store中，需要等待新的工具调用覆盖
3. **其他地方设置了多行label** - 需要检查是否有其他地方设置了包含换行符的label

## 排查步骤

如果问题仍然存在，可以：

1. **检查控制台日志**：
   ```
   [runtimeStore] ===== addTimelineEvent 被调用 =====
   [runtimeStore] event.label: task
   ```
   确认label只包含工具名称，不包含详细信息

2. **检查是否还有setAgentMoment调用**：
   ```bash
   grep -n "setAgentMoment.*task" desktop/renderer/stores/chatStore.ts
   ```
   应该没有结果

3. **清除store数据**：
   - 刷新页面
   - 或者重启应用
   - 或者清除浏览器缓存
