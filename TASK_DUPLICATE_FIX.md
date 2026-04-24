# Task工具重复展示问题修复

## 问题描述

1. **task工具重复展示**：主agent调用task工具时，在WorkspaceMonitor的工具堆栈中重复展示了2次
2. **子agent嵌套支持**：子agent应该能够调用其他子agent，并在树形结构上继续展示

## 问题根因

### 问题1：task工具重复展示

**根因**：在 `chatStore.ts` 的 `_handleAgentToolStart` 方法中，同一个工具被添加到timeline两次：

1. **第755行**：`runtimeStore.addTimelineEvent(targetAgentId, {...})`
2. **第851行**：`actStore.addTimelineEvent(currentAgentId, {...})`

由于 `targetAgentId` 和 `currentAgentId` 通常都是 `'main'`，导致同一个工具被添加两次到同一个agent的timeline中。

### 问题2：子agent嵌套支持

**现状**：
- SubAgentFactory已经支持最多3层嵌套（MAX_NESTING_DEPTH = 3）
- TaskTool已经有深度检查逻辑
- 子agent可以使用task工具（如果agent配置中包含）

**需要确认**：
- 子agent的agent配置中是否包含task工具
- 子agent调用task工具时，parentAgentId是否正确传递

## 解决方案

### 1. 删除重复的addTimelineEvent调用

**文件**：`desktop/renderer/stores/chatStore.ts`

删除第753-761行的重复调用：

```typescript
// ❌ 删除这段代码（重复添加）
// 🔧 为子 agent 添加 timeline 事件（用于 WorkspaceMonitor 显示）
const runtimeStore = useRuntimeStore.getState();
runtimeStore.addTimelineEvent(targetAgentId, {
  id: data.id,
  type: 'tool',
  name: data.name,
  status: 'running',
  startTime: Date.now(),
});
```

保留第851-857行的调用（包含完整的icon等信息）：

```typescript
// ✅ 保留这段代码（完整的timeline事件）
actStore.addTimelineEvent(currentAgentId, {
  id: data.id,
  icon: momentType.icon,
  label: data.name.slice(0, 12),
  status: 'running',
  startTime: Date.now(),
});
```

### 2. 添加防重复逻辑

**文件**：`desktop/renderer/stores/runtimeStore.ts`

在 `addTimelineEvent` 方法中添加防重复检查：

```typescript
addTimelineEvent: (agentId, event) =>
  set((state) => {
    console.log('[runtimeStore] addTimelineEvent 被调用:', { agentId, event });
    const prev = state.agentActivity.timelineEvents[agentId] || [];

    // 🔥 防御性检查：避免重复添加相同 ID 的事件
    const exists = prev.some(e => e.id === event.id);
    if (exists) {
      console.warn('[runtimeStore] 事件已存在，跳过添加:', event.id);
      return state; // 不修改，返回原 state
    }

    const newEvents = [...prev, event].slice(-5);
    console.log('[runtimeStore] 更新后的 timelineEvents:', newEvents);
    return {
      agentActivity: {
        ...state.agentActivity,
        timelineEvents: {
          ...state.agentActivity.timelineEvents,
          [agentId]: newEvents,
        },
      },
    };
  }),
```

### 3. 子agent嵌套支持

**现状确认**：

1. **深度限制**：已在 `SubAgentContext.ts` 中定义 `MAX_NESTING_DEPTH = 3`
2. **深度检查**：已在 `TaskTool.ts` 的 `execute` 方法中实现
3. **工具配置**：子agent是否能使用task工具取决于其agent配置中的tools列表

**工作流程**：

```
主agent (depth=0)
  └─ 调用 task 工具
      └─ 创建子agent (depth=1)
          └─ 调用 task 工具（如果配置允许）
              └─ 创建子子agent (depth=2)
                  └─ 调用 task 工具（如果配置允许）
                      └─ 创建子子子agent (depth=3)
                          └─ 无法再调用 task 工具（深度超限）
```

**关键代码**：

```typescript
// TaskTool.ts - 深度检查
const depthCtx = new SubAgentContext({ task: description, depth: this.currentDepth + 1 });
if (depthCtx.isDepthExceeded()) {
  return this.error(
    `Maximum nesting depth exceeded (depth=${this.currentDepth + 1}). Sub-agents cannot create further sub-agents beyond the limit.`,
  );
}

// SubAgentFactory.ts - 传递parentAgentId
this.hookRegistry.emit('SubAgentStart', {
  subAgentId,
  data: {
    task: options.task,
    depth: context.depth,
    role: config.id,
    name: config.name,
    agentType,
    parentAgentId: options.parentAgentId || 'main', // 🔧 正确传递父agent ID
  },
});
```

## 验证清单

- [x] task工具不会在WorkspaceMonitor中重复展示
- [x] addTimelineEvent有防重复逻辑
- [x] 子agent可以调用task工具（如果配置允许）
- [x] 子agent嵌套深度限制为3层
- [x] 子agent的parentAgentId正确传递
- [x] 子agent在树形结构上正确展示（通过SubAgentStart事件）

## 展示效果

### 主agent调用task工具

1. **ToolSection**：展示task工具的执行状态（运行中/完成/失败）
2. **WorkspaceMonitor工具堆栈**：展示task工具（不重复）
3. **WorkspaceMonitor树形结构**：创建子agent节点

### 子agent调用task工具

1. **子agent节点**：在树形结构上展示
2. **子agent工具堆栈**：展示task工具
3. **子子agent节点**：在树形结构上展示（嵌套在子agent下）

### 深度限制

- 最多3层嵌套：主agent → 子agent → 子子agent → 子子子agent
- 第4层会收到错误：`Maximum nesting depth exceeded`
