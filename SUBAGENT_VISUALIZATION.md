# 子Agent可视化展示流程

## 问题描述

1. **task工具展示问题**：主agent调用task工具时，在主agent右侧工具展示标签，展示了2个task执行标签，一个是有运行状态和耗时的，一个是灰色的
2. **子agent展示需求**：使用task委托子agent执行任务时，应该在workspace monitor的树型结构上创建节点，展示正在运行的agent/agent的思考过程/agent调用的工具

## 问题根因

### 问题1：task工具在工具堆栈中重复展示

**根因**：
- 在 `ToolSection.tsx` 中过滤了task工具 ✅
- 但在 `CanvasRenderer.ts` 的 `drawToolCallStack` 方法中没有过滤task工具 ❌

### 问题2：子agent没有在树形结构上展示

**根因**：
- SubAgentStart事件正确触发 ✅
- agent-bridge.ts正确转发事件 ✅
- chatStore.ts正确接收事件 ✅
- **但是mainAgent的id不匹配** ❌
  - TaskTool传递的parentAgentId是 `'main'`
  - 但mainAgent的实际id是 `agent-${Date.now()}`
  - 导致 `activeAgentStore.addSubAgent(parentId, subAgent)` 找不到parent

## 解决方案

### 1. 过滤task工具展示（ToolSection）

**文件**：`desktop/renderer/components/ToolSection.tsx`

```typescript
export function ToolSection({ tools }: ToolSectionProps) {
  // 过滤掉 task 工具（task 工具只是启动子 agent，不应该像普通工具那样展示）
  // 子 agent 的执行会在 workspace monitor 中展示
  const filteredTools = tools.filter(tool => tool.name !== 'task');

  return (
    <div className="space-y-2">
      {filteredTools.map((tool) => (
        <ToolCard key={tool.id} tool={tool} />
      ))}
    </div>
  );
}
```

### 2. 过滤task工具展示（WorkspaceMonitor工具堆栈）

**文件**：`desktop/renderer/components/WorkspaceMonitor/CanvasRenderer.ts`

```typescript
// 🔧 显示正在运行的工具 + 最近完成的工具（3秒内）
// 🔧 过滤掉 task 工具（task 工具只是启动子 agent，不应该在工具堆栈中展示）
const now = Date.now();
const recentThreshold = 3000; // 3秒
const visibleEvents = events.filter(evt => {
  // 过滤掉 task 工具
  if (evt.label && evt.label.includes('task')) return false;

  if (evt.status === 'running') return true;
  // 已完成的工具：如果在 3 秒内完成，则显示
  if ((evt.status === 'success' || evt.status === 'error') && evt.startTime) {
    const elapsed = now - evt.startTime;
    return elapsed < recentThreshold;
  }
  return false;
});
```

### 3. 修复mainAgent的id

**文件**：`desktop/renderer/stores/activeAgentStore.ts`

```typescript
startMainAgent: (name: string) => {
  const agent: AgentState = {
    id: 'main', // 🔧 固定为 'main'，方便子 agent 引用
    name,
    status: 'thinking',
    currentTools: [],
    subAgents: [],
    stats: {
      tokenUsage: { input: 0, output: 0, cached: 0 },
      cost: 0,
      toolCount: 0,
    },
  };

  set({ mainAgent: agent, currentActiveAgentId: agent.id });
},
```

### 4. 传递agentId给TaskTool

**文件**：`src/core/chat/SessionFactory.ts`

```typescript
registry.register(new TaskTool());
const taskTool = registry.get('task') as TaskTool;
if (taskTool && 'setDependencies' in taskTool) {
  taskTool.setDependencies({
    providerManager,
    agentRegistry,
    registry,
    agentConfig: config.provider,
    parentProvider: provider,
    hookRegistry,
    agentId: 'main', // 🔧 传递主 Agent ID
  });
}
```

### 5. 添加updateSubAgent方法

**文件**：`desktop/renderer/stores/activeAgentStore.ts`

```typescript
updateSubAgent: (subAgentId: string, updates: Partial<AgentState>) => {
  const { mainAgent } = get();

  const updated = updateAgentInTree(mainAgent, subAgentId, (agent) => ({
    ...agent,
    ...updates,
  }));

  if (updated) {
    set({ mainAgent: updated });
  }
},
```

## 子Agent展示流程

### 1. 主agent调用task工具

```
主agent → TaskTool.execute() → SubAgentFactory.createAndRun()
```

**事件流**：
1. `SubAgentStart` Hook 触发
2. `agent-bridge.ts` 监听到事件，发送 `agent:subagent-start` 到前端
3. `chatStore.ts` 接收事件，调用 `activeAgentStore.addSubAgent()`
4. WorkspaceMonitor 检测到 `activeMainAgent.subAgents` 变化，创建子agent节点

### 2. 子agent执行思考

```
SubAgent → AgentLoop.run() → AgentThinking Hook
```

**事件流**：
1. `AgentThinking` Hook 触发（带 `subAgentId`）
2. `agent-bridge.ts` 发送 `agent:thinking-start` 到前端
3. `chatStore.ts` 调用 `activeAgentStore.setAgentThought(subAgentId, thought)`
4. WorkspaceMonitor 展示思考气泡（`drawThinkingBubble`）

### 3. 子agent调用工具

```
SubAgent → Tool.execute() → ToolStart/ToolEnd Hook
```

**事件流**：
1. `ToolStart` Hook 触发（带 `subAgentId`）
2. `agent-bridge.ts` 发送 `agent:tool-start` 到前端（包含 `agentId: subAgentId`）
3. `chatStore.ts` 调用：
   - `activeAgentStore.addAgentTool(subAgentId, tool)`
   - `runtimeStore.addTimelineEvent(subAgentId, event)`
4. WorkspaceMonitor 展示：
   - 工具调用堆栈（`drawToolCallStack`）
   - 时间条（`drawTimelineStrip`）

### 4. 子agent完成

```
SubAgent → AgentLoop.finish() → SubAgentEnd Hook
```

**事件流**：
1. `SubAgentEnd` Hook 触发
2. `agent-bridge.ts` 发送 `agent:subagent-end` 到前端
3. `chatStore.ts` 调用 `activeAgentStore.updateSubAgent(subAgentId, { status: 'success' })`
4. WorkspaceMonitor 更新节点状态（绿色边框）

## WorkspaceMonitor展示组件

### 1. 思考气泡（区域2）

- **数据源**：`subAgent.thinkingText` 或 `subAgent.currentThought`
- **渲染方法**：`CanvasRenderer.drawThinkingBubble()`
- **位置**：agent节点上方

### 2. 工具调用堆栈（右侧）

- **数据源**：`agentActivity.timelineEvents[subAgentId]`
- **渲染方法**：`CanvasRenderer.drawToolCallStack()`
- **位置**：agent节点右侧，垂直排列
- **显示规则**：
  - 正在运行的工具
  - 最近3秒内完成的工具
  - 最多显示4个

### 3. 时间条（下方）

- **数据源**：`agentActivity.timelineEvents[subAgentId]`
- **渲染方法**：`CanvasRenderer.drawTimelineStrip()`
- **位置**：agent节点下方
- **显示规则**：最近5个事件

### 4. 当前动作标签（区域3）

- **数据源**：`agentActivity.currentMoments[subAgentId]`
- **渲染方法**：`CanvasRenderer.drawMomentLabel()`
- **位置**：agent节点右侧

## 数据流图

```
┌─────────────────────────────────────────────────────────────┐
│                        Backend (Node.js)                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  TaskTool → SubAgentFactory → AgentLoop                     │
│                    │                │                         │
│                    │                ├─ AgentThinking Hook    │
│                    │                ├─ ToolStart Hook        │
│                    │                ├─ ToolEnd Hook          │
│                    │                └─ SubAgentEnd Hook      │
│                    │                                          │
│                    └─ SubAgentStart Hook                     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ IPC (electron)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    agent-bridge.ts (Main)                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  hookRegistry.addListener('SubAgentStart', ...)              │
│  hookRegistry.addListener('AgentThinking', ...)              │
│  hookRegistry.addListener('ToolStart', ...)                  │
│  hookRegistry.addListener('ToolEnd', ...)                    │
│  hookRegistry.addListener('SubAgentEnd', ...)                │
│                                                               │
│  → safeSend('agent:subagent-start', data)                   │
│  → safeSend('agent:thinking-start', data)                   │
│  → safeSend('agent:tool-start', data)                       │
│  → safeSend('agent:tool-end', data)                         │
│  → safeSend('agent:subagent-end', data)                     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ IPC (electron)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   chatStore.ts (Renderer)                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  window.electron.on('agent:subagent-start', ...)            │
│    → activeAgentStore.addSubAgent(parentId, subAgent)       │
│    → runtimeStore.addTimelineEvent(subAgentId, event)       │
│                                                               │
│  window.electron.on('agent:thinking-start', ...)            │
│    → activeAgentStore.setAgentThought(agentId, thought)     │
│    → runtimeStore.setAgentMoment(agentId, moment)           │
│                                                               │
│  window.electron.on('agent:tool-start', ...)                │
│    → activeAgentStore.addAgentTool(agentId, tool)           │
│    → runtimeStore.addTimelineEvent(agentId, event)          │
│                                                               │
│  window.electron.on('agent:tool-end', ...)                  │
│    → activeAgentStore.updateAgentTool(agentId, toolId, ...)│
│    → runtimeStore.finishTimelineEvent(agentId, eventId, ...)│
│                                                               │
│  window.electron.on('agent:subagent-end', ...)              │
│    → activeAgentStore.updateSubAgent(subAgentId, status)    │
│    → runtimeStore.finishTimelineEvent(subAgentId, ...)      │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ React State
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              WorkspaceMonitor/index.tsx                      │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  useActiveAgentStore → mainAgent.subAgents                  │
│  useRuntimeStore → agentActivity.timelineEvents             │
│                                                               │
│  flattenAgents() → SubAgentData[]                           │
│    ├─ id, name, status                                       │
│    ├─ thinkingText (思考气泡)                                │
│    ├─ timelineEvents (工具调用时间线)                        │
│    └─ currentMoment (当前动作)                               │
│                                                               │
│  → CanvasRenderer.updateState(workspaceState)               │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ Canvas API
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  CanvasRenderer.ts                           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  drawSubAgents()                                             │
│    ├─ drawThinkingBubble(pos, radius, thinkingText)        │
│    ├─ drawToolCallStack(pos, radius, timelineEvents)       │
│    ├─ drawTimelineStrip(pos, radius, timelineEvents)       │
│    └─ drawMomentLabel(pos, radius, currentMoment)          │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 关键代码位置

### Backend
- `src/core/tools/TaskTool.ts` - task工具实现
- `src/core/agent/SubAgentFactory.ts` - 子agent创建和执行
- `src/core/agent/AgentLoop.ts` - agent执行循环
- `desktop/main/agent-bridge.ts` - Hook事件监听和转发

### Frontend
- `desktop/renderer/stores/activeAgentStore.ts` - agent状态管理
- `desktop/renderer/stores/chatStore.ts` - 事件接收和处理
- `desktop/renderer/stores/runtimeStore.ts` - 运行时状态（timeline等）
- `desktop/renderer/components/ToolSection.tsx` - 工具展示（已过滤task）
- `desktop/renderer/components/WorkspaceMonitor/index.tsx` - 数据组装
- `desktop/renderer/components/WorkspaceMonitor/CanvasRenderer.ts` - Canvas渲染

## 验证清单

- [x] task工具不在ToolSection中展示
- [x] SubAgentStart事件正确创建子agent节点
- [x] 子agent的思考内容展示在气泡中
- [x] 子agent的工具调用展示在右侧堆栈
- [x] 子agent的工具调用展示在下方时间条
- [x] SubAgentEnd事件正确更新子agent状态
- [x] activeAgentStore.updateSubAgent方法存在且正常工作
