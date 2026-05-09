# 璇玑架构升级（四）：跨模块协同改造适配方案

## 目录

1. [文档定位](#1-文档定位)
2. [IPC 通信层协同改造](#2-ipc-通信层协同改造)
3. [EventAdapter 与各 Store 的配合](#3-eventadapter-与各-store-的配合)
4. [React Flow (ExecutionFlow) 适配方案](#4-react-flow-executionflow-适配方案)
5. [输入框 + 后台任务展示适配方案](#5-输入框--后台任务展示适配方案)
6. [对话气泡 (MessageBubble) 适配方案](#6-对话气泡-messagebubble-适配方案)
7. [WorkspaceMonitor 适配方案](#7-workspacemonitor-适配方案)
8. [其他受影响的组件适配清单](#8-其他受影响的组件适配清单)
9. [模块改造协同顺序图](#9-模块改造协同顺序图)
10. [数据流端到端验证清单](#10-数据流端到端验证清单)

---

## 1. 文档定位

前三份文档分别描述了**目标架构**、**后端改造**、**前端 Store 拆分**。本文档解决的是：**所有这些模块加在一起，如何互相配合完成一次完整的用户交互**。

阅读本文档前，应先理解：
- `architecture-blueprint.md` — 目标架构和状态机设计
- `backend-migration-plan.md` — 后端具体改造步骤
- `frontend-migration-plan.md` — 前端 Store 拆分步骤

---

## 2. IPC 通信层协同改造

### 2.1 改造前的 IPC 协议全景

```
┌─ Renderer Process ───────────────────────┐  ┌─ Main Process ──────┐  ┌─ Child Process ──────┐
│                                           │  │                     │  │                      │
│  preload.ts 暴露的 window.electron 方法:   │  │  ipc/agent.ts:      │  │  agent-bridge.ts:    │
│                                           │  │                     │  │                      │
│  agentInit()         ─── invoke ────────▶ │  agent:init           │  │  initChatSession()   │
│  agentSendMessage()  ─── invoke ────────▶ │  agent:send-message   │  │  handleSendMessage() │
│  agentInterrupt()    ─── send ──────────▶ │  agent:interrupt      │  │  handleInterrupt()   │
│  agentSendSupplment()─── send ──────────▶ │  agent:send-supplement│  │  handleAppendMessage │
│                                           │                     │  │                      │
│  事件接收 (fire-and-forget 下行):          │                     │  │                      │
│  on('agent:started') ◀── channel.send ── │  ◀── EventBus ────── │  registerEventBridge()│
│  on('agent:text')    ◀── channel.send ── │  ◀── EventBus ────── │  (40+ 个事件映射)      │
│  on('agent:thinking')◀── channel.send ── │  ◀── EventBus ────── │                      │
│  ... (40+ 个事件类型)                     │                     │  │                      │
└───────────────────────────────────────────┘  └─────────────────────┘  └──────────────────────┘
```

### 2.2 改造后的 IPC 协议

```
┌─ Renderer ───────────────────────────────┐  ┌─ Main Process ──────┐  ┌─ Child Process ───────┐
│                                           │  │                     │  │                       │
│  agentUserAction(action) ── invoke ──────▶│  agent:user-action    │  │  session.userAction()  │
│    { type: 'SEND_MESSAGE', content }     │  │  (统一入口)          │  │    │                   │
│    { type: 'INTERRUPT', message? }       │  │                     │  │    ▼                   │
│                                           │  │                     │  │  SessionStateMachine   │
│  事件接收 (下行不变):                      │  │                     │  │    .transition(event)  │
│  on('agent:started') ◀── channel.send ── │  ◀── EventForwarder ── │  │    │                   │
│  on('agent:text')    ◀── channel.send ── │  ◀── EventForwarder ── │  │    返回 SessionAction  │
│  on('agent:thinking')◀── channel.send ── │  ◀── EventForwarder ── │  │    │                   │
│  ... (事件名不变, 但合并 thinking-start)   │  │                     │  │    ├─ RUN_AGENT        │
│                                           │  │                     │  │    ├─ ABORT_AGENT      │
│  新增统一事件:                             │  │                     │  │    └─ QUEUE_ONLY       │
│  on('agent:async-task-update') ◀──────────│──│◀── AsyncTaskMachine │  │                       │
└───────────────────────────────────────────┘  └─────────────────────┘  └───────────────────────┘
```

### 2.3 协议变更清单（按改造阶段）

#### Phase 1：新增（不影响现有协议）

| 新 IPC 通道 | 方向 | 机制 | payload | 
|------------|------|------|---------|
| `agent:user-action` | Renderer → Child | request-response | `{ action: { type, content/message } }` |
| `agent:async-task-update` | Child → Renderer | channel.send | `{ groupId, taskType, from, to, subAgentIds }` |

#### Phase 2：事件合并（新旧并行）

| 旧事件（保留） | 新事件（新增） | 合并策略 |
|---------------|---------------|---------|
| `agent:thinking` | 保留（合并 thinking-start 语义） | thinking-start 触发时也发 thinking |
| `agent:thinking-start` | **弃用** | AgentStateMachine 的 THINKING_DELTA 统一处理 |

#### Phase 3：清理旧协议

| 删除的 IPC 通道 | 替代方案 |
|----------------|---------|
| `agent:interrupt` | `agent:user-action` (INTERRUPT) |
| `agent:send-supplement` | `agent:user-action` (SEND_MESSAGE，后端状态机判断) |

### 2.4 preload.ts 改造对照

```typescript
// ═══ 改造前 ═══
agentSendMessage: (content: string) => ipcRenderer.invoke('agent:send-message', content),
agentInterrupt: (content?: string) => ipcRenderer.send('agent:interrupt', content),
agentSendSupplment: (content: string) => ipcRenderer.send('agent:send-supplement', content),

// ═══ 改造后 ═══
agentUserAction: (action: UserAction) => ipcRenderer.invoke('agent:user-action', { action }),
// UserAction = { type: 'SEND_MESSAGE'; content: string } | { type: 'INTERRUPT'; message?: string }

// 事件监听保持不变（事件名不变）
on: (channel: string, callback: (data: any) => void) => {
  const handler = (_event: any, data: any) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
},
```

### 2.5 main process IPC handler 改造对照

```typescript
// ═══ desktop/main/ipc/agent.ts — 改造前 ═══
ipcMain.handle('agent:send-message', async (_event, content) => {
  return sendRequest('send-message', content, 120000);
});
ipcMain.handle('agent:interrupt', async (_event, content) => {
  const ap = getAgentProcess();
  ap?.send({ type: 'interrupt', content });
  return { success: true };
});
ipcMain.handle('agent:send-supplement', async (_event, content) => {
  const ap = getAgentProcess();
  ap?.send({ type: 'supplement', content });
  return { success: true };
});

// ═══ 改造后 ═══
ipcMain.handle('agent:user-action', async (_event, data) => {
  return sendRequest('user-action', data, 120000);
  // 统一一条通道, request-response 模式
});
// agent:interrupt 和 agent:send-supplement 删除
```

### 2.6 agent-bridge.ts 子进程 handler 改造对照

```typescript
// ═══ 改造前 — 3 个 handler ═══
channel.handle('send-message', async (data) => { ... });
channel.handle('interrupt', async (data) => { ... });
channel.handle('supplement', async (data) => { ... });

// ═══ 改造后 — 1 个 handler ═══
channel.handle('user-action', async (data) => {
  const { action } = data;
  const result = await session.userAction(action);
  // result: { success: boolean, state: SessionState, action: 'running' | 'queued' | 'stopped' }
  return result;
});
```

### 2.7 `agent:thinking-start` 弃用与事件合并策略

**Phase 2（并行期）**：后端同时发送 `agent:thinking` 和 `agent:thinking-start` 两个事件，



**Phase 3（清理期）**：后端停止发送 `agent:thinking-start`，前端移除对应 handler。

```typescript
// agent-bridge.ts — Phase 2 并行策略
// 子 agent 首次思考（原 thinking-start 触发点）：
//   同时发送 thinking 和 thinking-start（向后兼容）
if (isFirstThinking) {
  safeSend({ type: 'agent:thinking-start', data: { agentId: routedId, task: payload.task } });
}
// 始终发送 thinking（合并后唯一事件）
safeSend({ type: 'agent:thinking', data: { agentId: routedId, thought: payload.thought } });
```

```typescript
// EventAdapter.ts — Phase 2 兼容策略
// thinking-start 与 thinking 共存，由 AgentStateMachine 去重
msg.on('agent:thinking-start', (d) => {
  // Phase 2: 只做子 agent 清理（auto-summarize 触发的清理逻辑）
  // 思考更新由 agent:thinking handler 统一处理
  useAgentStateMachine.getState().handleThinkingStartCleanup(d.agentId);
});
msg.on('agent:thinking', (d) => {
  // 统一的思考更新入口
  useAgentStateMachine.getState().transition({
    type: 'THINKING_DELTA', agentId: d.parentAgentId, thought: d.thought,
  });
});
```

### 2.8 Phase 2 并行期事件去重策略

新旧 IPC 通道和事件同时存在期间，消息重复和数据乱序的风险通过以下机制缓解：

```typescript
// EventAdapter.ts — 消息去重
const processedMessageIds = new Set<string>();

function dedupOrProcess(messageId: string, fn: () => void): void {
  if (processedMessageIds.has(messageId)) return;  // 已处理，跳过
  processedMessageIds.add(messageId);
  fn();
  // 每 1000 条清理一次旧 ID（防止内存泄漏）
  if (processedMessageIds.size > 1000) {
    const entries = [...processedMessageIds];
    processedMessageIds.clear();
    entries.slice(-500).forEach(id => processedMessageIds.add(id));
  }
}

// 每个 handler 中使用:
msg.on('agent:thinking', (d) => {
  dedupOrProcess(d.messageId || d.agentId + d.timestamp, () => {
    useAgentStateMachine.getState().transition({ type: 'THINKING_DELTA', ... });
  });
});
```

**关键原则**：`
- 每条事件携带 `messageId` 或 `agentId + timestamp` 组合作为幂等键
- `processedMessageIds` 集合在 EventAdapter 内维护，滑动窗口去重
- AgentStateMachine.transition() 本身也是幂等的（终态检查），double-safety

---

## 3. EventAdapter 与各 Store 的配合

### 3.1 EventAdapter 的职责边界（强调）

EventAdapter **只做一件事**：将 IPC 事件转换为 Store 方法调用。它不包含任何业务逻辑。

```typescript
// EventAdapter.ts — 完整的事件→Store 映射表

export function registerEventAdapter(): void {
  const msg = useMessageBus.getState();

  // ═══════════════════════════════════════════════
  // Session 级事件 → SessionStore
  // ═══════════════════════════════════════════════
  msg.on('agent:started', (d) => useSessionStore.getState().onAgentStarted(d));
  msg.on('agent:completed', (d) => useSessionStore.getState().onAgentCompleted(d));
  msg.on('agent:conversation-state', (d) => useSessionStore.getState().setConversationState(d.to));
  msg.on('agent:end', (d) => {
    useSessionStore.getState().onAgentCompleted(d);
    useMessageStore.getState().finishStreaming();
  });

  // ═══════════════════════════════════════════════
  // Agent 生命周期事件 → AgentStateMachine
  // ═══════════════════════════════════════════════
  msg.on('agent:thinking', (d) => {
    useAgentStateMachine.getState().transition({
      type: 'THINKING_DELTA',
      agentId: d.parentAgentId ?? d.agentId,
      thought: d.thought ?? d.text ?? '',
    });
  });

  msg.on('agent:text', (d) => {
    // 1. 更新 AgentStateMachine 状态
    useAgentStateMachine.getState().transition({
      type: 'TEXT_DELTA',
      agentId: d.parentAgentId ?? d.agentId,
      text: d.text,
    });
    // 2. 同时更新 messageStore 的流式气泡
    useMessageStore.getState().appendStreamingText(d.agentId, d.text);
  });

  msg.on('agent:tool-start', (d) => {
    useAgentStateMachine.getState().transition({
      type: 'TOOL_START',
      agentId: d.parentAgentId ?? d.agentId,
      toolCall: { id: d.id, name: d.name, args: d.args },
    });
  });

  msg.on('agent:tool-end', (d) => {
    useAgentStateMachine.getState().transition({
      type: 'TOOL_END',
      agentId: d.parentAgentId ?? d.agentId,
      toolCallId: d.id,
      result: d.result,
      isError: d.isError,
    });
  });

  // ═══════════════════════════════════════════════
  // 异步任务事件 → AsyncTaskStore + AgentStateMachine
  // ═══════════════════════════════════════════════
  msg.on('agent:async-task-update', (d) => {
    // 1. 更新后台任务 store
    useAsyncTaskStore.getState().transition({
      type: 'TASK_STATE_CHANGED',
      groupId: d.groupId,
      from: d.from,
      to: d.to,
      taskType: d.taskType,
      subAgentIds: d.subAgentIds,
    });

    // 2. 如果是 TASK_CREATED，同步创建 AgentStateMachine 节点
    if (d.to === 'running') {
      for (const subAgentId of d.subAgentIds) {
        useAgentStateMachine.getState().transition({
          type: 'AGENT_CREATED',
          agentId: subAgentId,
          parentId: d.parentAgentId,
          name: d.name ?? subAgentId,
          multiAgent: { type: d.taskType, groupId: d.groupId, ...d.multiAgent },
        });
      }
    }
  });

  // 保留以下事件用于向后兼容（Phase 2 期间）
  msg.on('agent:subagent-start', (d) => {
    useAgentStateMachine.getState().transition({
      type: 'AGENT_CREATED',
      agentId: d.subAgentId,
      parentId: d.parentAgentId,
      name: d.name,
    });
  });

  msg.on('agent:subagent-end', (d) => {
    useAgentStateMachine.getState().transition({
      type: 'SUBAGENT_END',
      agentId: d.subAgentId,
      success: d.success,
      error: d.error,
    });
  });

  msg.on('agent:task-failed', (d) => {
    useAgentStateMachine.getState().transition({
      type: 'TASK_FAILED',
      agentId: d.subAgentId,
      error: d.error,
    });
  });

  msg.on('agent:auto-summarize-start', (d) => {
    useAgentStateMachine.getState().transition({
      type: 'AUTO_SUMMARIZE_START',
      agentId: d.subAgentId,
      taskType: d.taskType, // 新字段，替代 team-exec- 前缀
    });
  });

  // ═══════════════════════════════════════════════
  // Team 事件 → AgentStateMachine + AsyncTaskStore
  // ═══════════════════════════════════════════════
  msg.on('agent:team-start', (d) => {
    // 创建 team leader 节点
    useAgentStateMachine.getState().transition({
      type: 'AGENT_CREATED',
      agentId: d.teamName,
      parentId: d.parentAgentId,
      name: d.teamName,
      multiAgent: { type: 'team', strategy: d.strategy, teamName: d.teamName },
    });
    // 为每个 member 预创建节点 (pending 状态)
    d.members.forEach((m: any) => {
      useAgentStateMachine.getState().transition({
        type: 'AGENT_CREATED',
        agentId: m.subAgentId || m.id,
        parentId: d.teamName,
        name: m.name,
        status: 'pending',
        multiAgent: { type: 'team-member', teamName: d.teamName, memberId: m.id },
      });
    });
  });

  msg.on('agent:team-member-start', (d) => {
    useAgentStateMachine.getState().transition({
      type: 'THINKING_DELTA',
      agentId: d.memberId,
      thought: '',
    });
  });

  msg.on('agent:team-member-end', (d) => {
    useAgentStateMachine.getState().transition({
      type: 'SUBAGENT_END',
      agentId: d.memberId,
      success: d.success,
    });
  });

  msg.on('agent:team-end', (d) => {
    // 批量设置所有成员终态 — 不再在 messageStore._handleTeamEnd 中批量操作
    const machine = useAgentStateMachine.getState();
    const teamAgent = machine.getAgentById(d.teamName);
    if (teamAgent) {
      // 递归找到所有团队成员
      const members = machine.getDescendants(d.teamName);
      members.forEach(m => {
        machine.transition({
          type: 'SUBAGENT_END',
          agentId: m.id,
          success: d.success,
        });
      });
    }
  });

  // ═══════════════════════════════════════════════
  // Citation 事件 → CitationStore
  // ═══════════════════════════════════════════════
  msg.on('agent:citation', (d) => {
    useCitationStore.getState().addCitation(d);
  });
}
```

### 3.2 Store 之间的交叉通知

AgentStateMachine 的状态变更可能需要通知其他 Store，通过内部回调实现，**不在 EventAdapter 中处理**：

```typescript
// AgentStateMachine 内部
class AgentStateMachineImpl {
  private onStateChanged?: (agentId: string, from: AgentStatus, to: AgentStatus) => void;
  private onAgentCleaned?: (agentId: string) => void;

  constructor() {
    // Agent 变为终态时 → 通知 AsyncTaskStore
    this.onStateChanged = (agentId, from, to) => {
      if (isTerminalStatus(to) && !isTerminalStatus(from)) {
        const agent = this.agentMap[agentId];
        if (agent?.multiAgent?.groupId) {
          useAsyncTaskStore.getState().transition({
            type: 'MEMBER_COMPLETED',
            groupId: agent.multiAgent.groupId,
            memberId: agentId,
            success: to === 'success',
          });
        }
      }
    };

    // Agent 被清理时 → 通知 messageStore 关闭对应流式气泡
    this.onAgentCleaned = (agentId) => {
      useMessageStore.getState().finishSubAgentStream(agentId);
    };
  }
}
```

**关键原则**：Store 之间的依赖通过回调/订阅实现，不在 EventAdapter 中写 Store A 调 Store B 的逻辑。

### 3.3 Store 间交叉通知的防循环依赖方案

内部回调方式存在循环依赖风险（AgentStateMachine 引用 AsyncTaskStore，AsyncTaskStore 引用 AgentStateMachine）。提供两个方案对比：

#### 方案 A：延迟 import（Lazy Reference） — 简单但不够优雅

```typescript
// AgentStateMachine 内部 — 不直接 import AsyncTaskStore
class AgentStateMachineImpl {
  private onStateChanged?: (agentId: string, from: AgentStatus, to: AgentStatus) => void;

  // 由外部（EventAdapter 初始化时）注入回调
  setCrossStoreNotifier(notifier: CrossStoreNotifier): void {
    this.onStateChanged = notifier.onAgentStateChanged;
  }
}

// EventAdapter 初始化时注入（EventAdapter 是唯一知道所有 Store 的模块）
const notifier: CrossStoreNotifier = {
  onAgentStateChanged: (agentId, from, to) => {
    // 此处可以安全引用 AsyncTaskStore（EventAdapter 不参与 Store 循环）
    if (isTerminalStatus(to)) {
      const agent = useAgentStateMachine.getState().getAgentById(agentId);
      if (agent?.multiAgent?.groupId) {
        useAsyncTaskStore.getState().transition({ type: 'MEMBER_COMPLETED', ... });
      }
    }
  },
  onAgentCleaned: (agentId) => {
    useMessageStore.getState().finishSubAgentStream(agentId);
  },
};
useAgentStateMachine.getState().setCrossStoreNotifier(notifier);
```

#### 方案 B：微 EventBus（推荐） — 类型安全 + 松耦合

```typescript
// desktop/renderer/utils/StoreEventBus.ts (新增，~30 行)
type StoreEventHandler = (...args: any[]) => void;

class StoreEventBus {
  private handlers = new Map<string, Set<StoreEventHandler>>();

  on(event: string, handler: StoreEventHandler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: any[]): void {
    this.handlers.get(event)?.forEach(h => h(...args));
  }
}

export const storeEventBus = new StoreEventBus();

// AgentStateMachine 中 — 发射事件，不引用其他 Store
this.storeEventBus.emit('agent:terminal', { agentId, from, to });

// AsyncTaskStore 初始化时 — 订阅事件
storeEventBus.on('agent:terminal', ({ agentId, from, to }) => {
  if (isTerminalStatus(to) && to === 'success') {
    useAsyncTaskStore.getState().transition({ type: 'MEMBER_COMPLETED', ... });
  }
});

// EventAdapter 中 — 同时订阅用于调试/日志（可选）
storeEventBus.on('agent:terminal', ({ agentId, from, to }) => {
  console.debug(`[StoreEvent] ${agentId}: ${from} → ${to}`);
});
```

**结论**：推荐方案 B（微 EventBus）。与直接用回调相比的优势：
- Store A 发射事件不需要知道 Store B 的存在（真正的松耦合）
- 多个 Store 可以独立订阅同一事件（不用修改 AgentStateMachine 内部）
- 调试方便（单点监听所有 Store 间事件）
- 不会出现循环 import（Store 只 import `storeEventBus`，不 import 彼此）

---

## 4. React Flow (ExecutionFlow) 适配方案

### 4.1 当前数据来源 vs 改造后数据来源

| 数据 | 当前来源 | 改造后来源 | 接入方式 |
|------|---------|-----------|---------|
| Agent 节点列表 | `activeAgentStore.mainAgent.subAgents` 递归遍历 | `AgentStateMachine.agentMap` (Record) | `Object.values(agentMap)` |
| 节点状态 | `activeAgentStore.subAgents[].status` | `AgentStateMachine.agentMap[id].status` | 直接读取 |
| 边 (父子关系) | `activeAgentStore.subAgents[].parentId` | `AgentStateMachine.agentMap[id].parentId` | 直接读取 |
| 工具调用 | `activeAgentStore.subAgents[].toolCalls` | `AgentStateMachine.agentMap[id].toolCalls` | 不变 |
| multiAgent 数据 | `activeAgentStore.subAgents[].multiAgent` | `AgentStateMachine.agentMap[id].multiAgent` | 不变 |
| Moment 气泡 | `runtimeStore.agentActivity.currentMoments` | `AgentStateMachine.getCurrentMoments()` | 派生方法 |
| Timeline 事件 | `runtimeStore.agentActivity.histories` | `AgentStateMachine.getTimeline()` | 派生方法 |

### 4.2 ExecutionFlow.tsx 改造对照

```typescript
// ═══════════════ 改造前 ═══════════════
import { useActiveAgentStore } from '../stores/activeAgentStore';
import { useRuntimeStore } from '../stores/runtimeStore';

function ExecutionFlow() {
  const mainAgent = useActiveAgentStore(s => s.mainAgent);
  const moments = useRuntimeStore(s => s.agentActivity.currentMoments);
  
  // 手动递归遍历 subAgents 树
  const allNodes = flattenAgentTree(mainAgent);
  const allEdges = buildEdges(mainAgent);
  // ...
}

// ═══════════════ 改造后 ═══════════════
import { useAgentStateMachine } from '../stores/agentStateMachine';

function ExecutionFlow() {
  // 从统一数据源读取
  const mainAgent = useAgentStateMachine(s => s.mainAgent);
  const agentMap = useAgentStateMachine(s => s.agentMap);
  const moments = useAgentStateMachine(s => s.getCurrentMoments());
  
  // 不再需要递归 — agentMap 已经是扁平化的
  const allNodes = Object.values(agentMap)
    .filter(a => a.status !== 'cleared')
    .map(toFlowNode);
  const allEdges = Object.values(agentMap)
    .filter(a => a.parentId && agentMap[a.parentId])
    .map(a => toFlowEdge(a, agentMap[a.parentId]!));
  // ...
}
```

### 4.3 React Flow 节点类型映射

AgentStateMachine 状态到 React Flow 节点外观的映射表：

```typescript
// ExecutionFlow 中的节点样式配置
const STATUS_NODE_STYLE: Record<AgentStatus, { color: string; animated: boolean }> = {
  pending:    { color: '#94a3b8', animated: false },  // 灰色等待
  thinking:   { color: '#6366f1', animated: true  },  // 紫色脉冲
  executing:  { color: '#f59e0b', animated: true  },  // 橙色旋转
  writing:    { color: '#3b82f6', animated: true  },  // 蓝色流式
  reporting:  { color: '#8b5cf6', animated: false },  // 深紫等待
  success:    { color: '#22c55e', animated: false },  // 绿色完成
  failed:     { color: '#ef4444', animated: false },  // 红色失败
  cancelled:  { color: '#78716c', animated: false },  // 灰色取消
  cleared:    { color: '#transparent', animated: false }, // 不渲染
};
```

组件无需改变节点渲染逻辑 — 只需将数据源从 `activeAgentStore` 切换到 `AgentStateMachine`。

### 4.4 构建 buildFlow 的辅助工具

当前 `activeAgentStore` 有 `buildFlow` 方法。改造后需要新的辅助函数：

```typescript
// desktop/renderer/utils/flowBuilder.ts (新增)
import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

const LAYOUT_CONFIG = {
  rankdir: 'TB',        // 从上到下
  nodesep: 80,          // 水平间距
  ranksep: 120,         // 垂直间距
  marginx: 40,
  marginy: 40,
};

export function buildFlowNodesAndEdges(agentMap: Record<string, AgentState>): {
  nodes: Node[];
  edges: Edge[];
} {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph(LAYOUT_CONFIG);

  const activeAgents = Object.values(agentMap).filter(a => a.status !== 'cleared');

  // 添加节点到 dagre 图
  for (const agent of activeAgents) {
    const isTeam = agent.multiAgent?.type === 'team';
    const nodeWidth = isTeam ? 200 : 160;
    const nodeHeight = isTeam ? 100 : 80;
    g.setNode(agent.id, { width: nodeWidth, height: nodeHeight });
  }

  // 添加边到 dagre 图
  for (const agent of activeAgents) {
    if (agent.parentId && agentMap[agent.parentId] && agentMap[agent.parentId].status !== 'cleared') {
      g.setEdge(agent.parentId, agent.id);
    }
  }

  // 运行 dagre 布局
  dagre.layout(g);

  // 转换为 React Flow 格式
  const nodes: Node[] = activeAgents.map(agent => {
    const pos = g.node(agent.id);
    const isTeam = agent.multiAgent?.type === 'team';
    const isTeamMember = agent.multiAgent?.type === 'team-member';

    return {
      id: agent.id,
      type: isTeam ? 'teamNode' : isTeamMember ? 'teamMemberNode' : 'agentNode',
      position: { x: pos.x - (isTeam ? 100 : 80), y: pos.y - (isTeam ? 50 : 40) },
      data: {
        label: agent.name,
        status: agent.status,
        thought: agent.thought,
        toolCalls: agent.toolCalls,
        multiAgent: agent.multiAgent,
        moment: agent.moment,
      },
    };
  });

  const edges: Edge[] = activeAgents
    .filter(a => a.parentId && agentMap[a.parentId] && agentMap[a.parentId].status !== 'cleared')
    .map(a => ({
      id: `${a.parentId}->${a.id}`,
      source: a.parentId!,
      target: a.id,
      animated: a.status === 'thinking' || a.status === 'executing',
    }));

  return { nodes, edges };
}
```

**改造说明**：`calculatePosition(agent, agentMap)` 的占位已被 dagre 完整实现替代。dagre 自动计算节点位置，支持嵌套树（team → member）的层次布局。

---

## 5. 输入框 + 后台任务展示适配方案

### 5.1 当前状态梳理

**InputArea.tsx** 当前依赖：
- `messageStore._conversationState` — 判断走 send/interrupt/supplement 三条 IPC 通道
- `messageStore._autoSummarizeActive` — 自动汇总状态提示
- `backgroundTaskStore` — 后台任务计数（输入框上方的运行中任务展示）
- `runtimeStore.processing` — 是否正在处理

**输入框上方的后台任务展示区域** 当前依赖：
- `backgroundTaskStore.tasks` — 运行中的 task 列表
- `backgroundTaskStore.teams` — 运行中的 team 列表
- `backgroundTaskStore.getRunningCount()` — 运行中计数
- `backgroundTaskStore.getCompletedCount()` — 已完成计数

### 5.2 InputArea 改造

```typescript
// ═══════════════ InputArea.tsx — 改造前 ═══════════════
function InputArea() {
  const convState = useMessageStore(s => s._conversationState);
  const processing = useRuntimeStore(s => s.processing);
  const autoSummarizeActive = useMessageStore(s => s._autoSummarizeActive);
  
  const handleSubmit = async (content: string) => {
    if (convState === 'idle' || convState === 'waiting_async') {
      await window.electron.agentSendMessage(content);
    } else if (convState === 'executing') {
      await window.electron.agentInterrupt(content);
    } else if (convState === 'outputting') {
      await window.electron.agentSendSupplment(content);
    }
  };

  const handleStop = () => {
    window.electron.agentInterrupt(); // 无参数 = 纯停止
  };
}

// ═══════════════ InputArea.tsx — 改造后 ═══════════════
function InputArea() {
  const conversationState = useSessionStore(s => s.conversationState);
  const isRunning = useSessionStore(s => s.isRunning());
  
  const handleSubmit = async (content: string) => {
    // 始终走统一通道，后端自己决定行为
    await window.electron.agentUserAction({ type: 'SEND_MESSAGE', content });
  };

  const handleStop = () => {
    // 空消息 = 纯停止
    window.electron.agentUserAction({ type: 'INTERRUPT' });
  };

  // 根据状态展示不同的输入框提示
  const placeholder = isRunning 
    ? 'Agent 正在执行，输入内容将打断当前任务...' 
    : '输入消息...';
}
```

### 5.3 后台任务展示区域适配

输入框上方的后台任务展示区域（通常是 `BackgroundTaskBar` 或内嵌在 `InputArea` 中的组件），从 `backgroundTaskStore` 切换到 `AsyncTaskStore`：

```typescript
// ═══════════════ 改造前 ═══════════════
function BackgroundTaskIndicator() {
  const tasks = useBackgroundTaskStore(s => s.tasks);
  const teams = useBackgroundTaskStore(s => s.teams);
  const runningCount = useBackgroundTaskStore(s => s.getRunningCount());
  
  return (
    <div className="task-indicator">
      {runningCount > 0 && (
        <span>🔧 {runningCount} 个后台任务运行中</span>
      )}
      {/* 展开显示每个 task/team 的详细状态 */}
    </div>
  );
}

// ═══════════════ 改造后 ═══════════════
function BackgroundTaskIndicator() {
  const tasks = useAsyncTaskStore(s => s.tasks);
  const runningCount = useAsyncTaskStore(s => s.getRunningCount());
  const completedCount = useAsyncTaskStore(s => s.getCompletedCount());
  
  // tasks 结构统一: Record<groupId, AsyncTaskState>
  // taskType 字段区分 task/team，不再有两个独立数组
  const runningTasks = Object.values(tasks).filter(t => 
    t.status === 'creating' || t.status === 'running'
  );
  
  return (
    <div className="task-indicator">
      {runningCount > 0 && (
        <span>🔧 {runningCount} 个后台任务运行中</span>
      )}
      {completedCount > 0 && (
        <span>✅ {completedCount} 个已完成，等待汇总</span>
      )}
      {runningTasks.map(task => (
        <TaskItem key={task.groupId} task={task} />
        // task.type === 'team' 时展示团队名和成员数
      ))}
    </div>
  );
}
```

### 5.4 发送按钮的启用/禁用逻辑

```typescript
// 改造后：始终可发送（后端决定是 run 还是 queue）
const canSend = true; // 不再根据前端状态 disabled

// 停止按钮：仅在运行时可见
const showStop = useSessionStore(s => s.isRunning());

// 自动汇总提示
const autoSummarizeActive = useSessionStore(s => s.conversationState === 'waiting_async');
```

---

## 6. 对话气泡 (MessageBubble) 适配方案

### 6.1 当前状态

`MessageBubble.tsx` 当前依赖多个 store：

```typescript
// 当前
import { useMessageStore } from '../stores/messageStore';       // 消息数据
import { useRuntimeStore } from '../stores/runtimeStore';       // processing, agentActivity
import { useActiveAgentStore } from '../stores/activeAgentStore'; // 子 agent 工具状态
```

### 6.2 改造后数据来源

| 气泡类型 | 当前数据来源 | 改造后数据来源 |
|---------|------------|--------------|
| 用户消息 | `messageStore.messages` | `messageStore.messages` (不变) |
| 助手文本气泡 | `messageStore.messages` + `runtimeStore.messageStream` | `messageStore.messages` + `messageStore.streamBuffers` (内部管理) |
| 工具调用气泡 | `messageStore.messages[].toolCalls` | `messageStore.messages[].toolCalls` (不变) |
| 子 Agent 气泡 | `messageStore._subAgentStreams` | `messageStore.subAgentStreams` (接口不变, 内部实现变化) |
| 工具摘要气泡 | `messageStore` + `activeAgentStore` | `messageStore` (自管理) |
| 错误气泡 | `messageStore.messages` | `messageStore.messages` (不变) |

### 6.3 MessageBubble 改造

```typescript
// ═══════════════ MessageBubble.tsx — 改造后 ═══════════════

function MessageBubble({ message }: { message: Message }) {
  // 会话状态 — 用于判断是否正在流式输出
  const isRunning = useSessionStore(s => s.isRunning());
  
  // 消息数据 — 只从 messageStore 读取
  const streamBuffer = useMessageStore(s => 
    message.id === s.currentStreamingId ? s.streamBuffer : ''
  );

  // Agent 状态 — 用于展示工具调用对应的子 agent 状态
  const agentStatus = useAgentStateMachine(s => 
    message.agentId ? s.getAgentById(message.agentId)?.status : null
  );

  // Moment — 用于展示工具状态栏气泡
  const moment = useAgentStateMachine(s => 
    message.agentId ? s.getAgentById(message.agentId)?.moment : null
  );

  switch (message.role) {
    case 'user':
      return <UserBubble content={message.content} />;
    
    case 'assistant':
      return (
        <AssistantBubble
          content={message.content}
          toolCalls={message.toolCalls}
          isStreaming={message.id === useMessageStore.getState().currentStreamingId}
          streamBuffer={streamBuffer}
          agentStatus={agentStatus}
          moment={moment}
        />
      );
    
    case 'tool':
      return <ToolResultBubble message={message} />;
    
    case 'subagent':
      return <SubAgentBubble message={message} />;
  }
}
```

### 6.4 流式文本气泡的处理

流式文本仍然由 messageStore 管理：

```typescript
// messageStore.ts — 保留的流式处理逻辑
appendStreamingText: (agentId: string, text: string) => {
  const state = get();
  if (state.currentStreamingId) {
    // 追加到当前流式气泡
    set(s => ({
      streamBuffer: s.streamBuffer + text,
    }));
  } else {
    // 创建新的流式气泡
    const newId = generateId();
    set(s => ({
      currentStreamingId: newId,
      streamBuffer: text,
      messages: [...s.messages, {
        id: newId,
        role: 'assistant',
        content: text,
        agentId,
        timestamp: Date.now(),
        isStreaming: true,
      }],
    }));
  }
},

finishStreaming: () => {
  set(s => ({
    currentStreamingId: null,
    streamBuffer: '',
  }));
  // 将最后一条助手消息的 isStreaming 标记为 false
  const msgs = get().messages;
  if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
    set(s => ({
      messages: s.messages.map((m, i) => 
        i === s.messages.length - 1 ? { ...m, isStreaming: false } : m
      ),
    }));
  }
},
```

### 6.5 工具摘要气泡 (ToolSummary)

当前 `toolSummary.ts` 生成工具调用摘要气泡。改造后逻辑不变，但数据来源从 `activeAgentStore` 切换到 `AgentStateMachine`：

```typescript
// desktop/renderer/utils/toolSummary.ts — 改造仅涉及数据读取

export function buildToolSummary(toolCall: ToolCall): ToolSummary {
  // 如果有 subAgentId，从 AgentStateMachine 获取子 agent 状态
  if (toolCall.subAgentId) {
    const agent = useAgentStateMachine.getState().getAgentById(toolCall.subAgentId);
    if (agent) {
      return {
        status: agent.status,
        icon: STATUS_ICONS[agent.status],
        label: STATUS_LABELS[agent.status],
        // ...
      };
    }
  }
  // ...
}
```

---

## 7. WorkspaceMonitor — 已废弃（直接删除）

### 7.1 状态确认

`WorkspaceMonitor` 已被 `ExecutionFlow` (React Flow + Dagre 布局) 完全替换。`ExecutionFlow.tsx` 头部注释明确说明：

> 完全替换旧的 Canvas WorkspaceMonitor

**实际引用情况**：
- 没有任何 Page/Layout 导入 `WorkspaceMonitor` 组件
- 仅 `runtimeStore.ts` 仍引用其 types：`import type { AgentMoment, HistoryDot, TimelineEvent, RecentEvent } from '../components/WorkspaceMonitor/types'`
- 组件本身 (~31KB index.tsx + 子组件) 已成死代码

### 7.2 改造动作

| 动作 | 说明 |
|------|------|
| 删除 `desktop/renderer/components/WorkspaceMonitor/` 整个目录 | 死代码，ExecutionFlow 已替代 |
| 迁移 `WorkspaceMonitor/types.ts` 中的类型到 `AgentStateMachine.ts` | `AgentMoment`、`HistoryDot`、`TimelineEvent` 等类型由 AgentStateMachine 统一导出 |
| 更新 `runtimeStore.ts` 的 import | 改为从 `AgentStateMachine` 导入类型，或随 runtimeStore 一起删除 |

### 7.3 WorkspaceMonitor 的 Moment/Timeline 功能归属

WorkspaceMonitor 曾经承担的 Moment 气泡展示功能，现已分散到：
- **ExecutionFlow** — React Flow 节点状态可视化（替代 Canvas 绘制）
- **StatusBar** — 状态栏全局状态提示
- **MessageBubble** — 对话框中的工具执行状态（tool 摘要气泡）

这些组件的适配方案分别见第 4 节 (ExecutionFlow)、第 5 节 (StatusBar)、第 6 节 (MessageBubble)。

---

## 8. 其他受影响的组件适配清单

### 8.1 SessionStore 替代 runtimeStore 的组件

以下组件当前从 `runtimeStore` 读取会话状态，改造后切换到 `SessionStore`：

| 组件 | 当前读取 | 改造后读取 | 影响程度 |
|------|---------|-----------|---------|
| `MainPage.tsx` | `runtimeStore.processing` | `sessionStore.processing` | 小（变量名不变） |
| `ChatArea.tsx` | `runtimeStore.messageStream` | `messageStore.streamBuffer` | 中 |
| `StatusBar.tsx` | `messageStore.status` | `sessionStore.status` | 小 |
| `ContextPanel.tsx` | 间接通过 messageStore | `messageStore.contextInfo` | 小 |
| `RightPanel.tsx` | `messageStore.status` | `sessionStore.status` | 小 |
| `monitors/ContextView.tsx` | `runtimeStore.contextInfo` | `messageStore.contextInfo` | 中 |

### 8.2 AgentStateMachine 替代 activeAgentStore 的组件

| 组件 | 当前读取 | 改造后读取 | 影响程度 |
|------|---------|-----------|---------|
| `ExecutionFlow.tsx` | `activeAgentStore.mainAgent` | `agentStateMachine.agentMap` | 大（见第 4 节） |
| `MainPage.tsx` | `activeAgentStore.mainAgent` (token 统计) | `agentStateMachine.mainAgent` | 小（仅统计） |
| `ToolSection.tsx` | `activeAgentStore.subAgents` | `agentStateMachine.getDescendants()` | 中 |
| `AgentStatusList.tsx` | `activeAgentStore` 全部 | `agentStateMachine.agentMap` | 中 |
| `ActiveAgentView.tsx` | `activeAgentStore` | `agentStateMachine.mainAgent` | 中 |
| `ExecutionPanel.tsx` | 间接 | `agentStateMachine` | 小 |
| `ExecutionWorkspace.tsx` | 间接 | `agentStateMachine` | 小 |

### 8.3 直接删除的组件/目录

| 组件/文件 | 原因 |
|----------|------|
| `WorkspaceMonitor/` 整个目录 | 已被 ExecutionFlow 替代，无任何页面引用 |
| `WorkspaceMonitor/index.tsx` (~31KB) | Canvas 绘制逻辑已废弃 |
| `WorkspaceMonitor/MainFlowVisualization.tsx` | 功能已迁移到 ExecutionFlow |
| `WorkspaceMonitor/WorkspaceMonitor.tsx` | 死代码 |
| `WorkspaceMonitor/MainFlowVisualization.css` | 死代码 |

### 8.4 需要更新的 IPC 调用

以下组件直接调用 `window.electron.*`，需要更新方法名：

| 组件 | 当前调用 | 改造后调用 |
|------|---------|-----------|
| `InputArea.tsx` | `agentSendMessage(content)` | `agentUserAction({ type: 'SEND_MESSAGE', content })` |
| `InputArea.tsx` | `agentInterrupt(content?)` | `agentUserAction({ type: 'INTERRUPT', message: content })` |
| `InputArea.tsx` | `agentSendSupplment(content)` | `agentUserAction({ type: 'SEND_MESSAGE', content })` |
| `StatusBar.tsx` | `agentInterrupt()` | `agentUserAction({ type: 'INTERRUPT' })` |

其余通过 `window.electron.on()` 接收事件的组件（`MessageBubble`、`ExecutionFlow`、`WorkspaceMonitor` 等）**不需要修改**，因为事件名不变，数据由 EventAdapter 处理后写入新 Store。

### 8.5 不需要修改的组件

以下组件不受影响或仅需最小改动：

| 组件 | 原因 |
|------|------|
| `TitleBar.tsx` | 仅操作窗口，不涉及 agent 状态 |
| `SettingsPage.tsx` | 配置管理，不变 |
| `PermissionsPage.tsx` | 权限管理，不变 |
| `ToolsPage.tsx` | 工具管理，不变 |
| `AgentsPage.tsx` | Agent 配置，不变 |
| `SystemPromptManager.tsx` | System prompt 管理，不变 |
| `DiagnosticsDialog.tsx` | 诊断，仅需确认 IPC 调用不变 |
| `DownloadQueue.tsx` | 下载队列，不变 |
| `AgentManager.tsx` | Agent 管理，不变 |
| `AgentEditor.tsx` | Agent 编辑，不变 |
| `PermissionDialog.tsx` | 权限弹窗，不变 |
| `AskUserDialog.tsx` | 用户询问弹窗，不变 |
| `PlanReviewDialog.tsx` | 计划审核弹窗，不变 |
| `ProjectFilesPanel.tsx` | 项目文件面板，不变 |
| `TodoPanel.tsx` | Todo 面板，仅读取 executionStore |
| `FloatingTodoPanel.tsx` | 浮动 Todo，仅读取 executionStore |
| `StatsDialog.tsx` | 统计弹窗，消息读取不变 |

---

## 9. 模块改造协同顺序图

### 9.1 依赖关系图

```
新模块无外部依赖（可独立开发）:
  SessionStateMachine.ts ─────────────────────────────────────────────┐
  EventForwarder.ts ──────────────────────────────────────────────────┤
  AsyncTaskStateMachine.ts (子进程侧) ────────────────────────────────┤
  AgentStateMachine.ts ───────────────────────────────────────────────┤
  AsyncTaskStore.ts ──────────────────────────────────────────────────┤
  CitationStore.ts ───────────────────────────────────────────────────┤
  SessionStore.ts ────────────────────────────────────────────────────┤
                                                                      │
需要新模块就绪后才能改造:                                              │
  ChatSession.ts ──────────── 依赖 SessionStateMachine                 │
  AgentLoop.ts ────────────── 依赖 SessionStateMachine (InterruptChecker)│
  agent-bridge.ts ─────────── 依赖 EventForwarder + ChatSession.userAction│
  TaskCompletionHandler.ts ── 依赖 AsyncTaskStateMachine                │
  TaskOrchestrator.ts ─────── 依赖 AsyncTaskStateMachine                │
                                                                      │
需要后端改造完成后才能改造:                                            │
  preload.ts ──────────────── 依赖 IPC 协议稳定                         │
  EventAdapter.ts ─────────── 依赖 IPC 事件名稳定                        │
                                                                      │
需要 Store 就绪后才能改造:                                             │
  messageStore.ts ─────────── 移除 orchestration 逻辑                   │
  ExecutionFlow.tsx ───────── 依赖 AgentStateMachine                    │
  WorkspaceMonitor ────────── 依赖 AgentStateMachine + SessionStore      │
  InputArea.tsx ───────────── 依赖 SessionStore + 新 IPC 方法            │
  MessageBubble.tsx ───────── 依赖 AgentStateMachine.getCurrentMoments   │
  BackgroundTaskIndicator ─── 依赖 AsyncTaskStore                        │
  StatusBar.tsx ───────────── 依赖 SessionStore                          │
  ... 其他组件                                                          │
```

### 9.2 分批改造时序

```
Week 1 ──── 第一批：纯新增模块（零风险）
  □ src/core/state/SessionStateMachine.ts      (后端状态机)
  □ src/core/event/EventForwarder.ts           (后端事件转发)
  □ src/core/task/AsyncTaskStateMachine.ts     (后端异步任务状态机)
  □ desktop/renderer/stores/AgentStateMachine.ts (前端 Agent 状态机)
  □ desktop/renderer/stores/AsyncTaskStore.ts  (前端异步任务 Store)
  □ desktop/renderer/stores/CitationStore.ts   (前端 Citation Store)
  □ desktop/renderer/stores/SessionStore.ts    (前端会话 Store)
  
  验证: 所有新模块可独立编译通过，无 import 错误

Week 2 ──── 第二批：后端改造（中风险，需要测试）
  □ ChatSession.ts → 引入 SessionStateMachine (feature flag)
  □ AgentLoop.ts → 注入 InterruptChecker
  □ agent-bridge.ts → 新增 user-action handler (保留旧 handler)
  □ agent-bridge.ts → 接入 EventForwarder (与旧 registerEventBridge 并行)
  □ TaskCompletionHandler.ts → 接入 AsyncTaskStateMachine
  □ main process ipc/agent.ts → 新增 agent:user-action handler

  验证: 
  - 原有 e2e 测试全部通过
  - 新旧 handler 同时工作，旧功能不受影响
  - 新 handler 可通过 curl/手动测试验证

Week 3 ──── 第三批：前端 IPC + EventAdapter（中风险）
  □ preload.ts → 新增 agentUserAction 方法
  □ EventAdapter.ts → 创建并注册（与 EventBridge 并行监听）
  □ 验证: 新旧两条 EventBridge 同时工作，UI 无变化

Week 3-4 ──── 第四批：前端组件逐一切换（逐组件、可回滚）
  □ StatusBar.tsx → SessionStore（最低风险组件，先切换验证）
  □ BackgroundTaskIndicator → AsyncTaskStore
  □ WorkspaceMonitor → AgentStateMachine.getCurrentMoments()
  □ ExecutionFlow.tsx → AgentStateMachine.agentMap + buildFlowNodes
  □ InputArea.tsx → agentUserAction + SessionStore
  □ MessageBubble.tsx → AgentStateMachine + SessionStore
  □ 其余组件（ContextPanel, RightPanel, ToolSection 等）

  每个组件切换后验证:
  - 组件渲染正确
  - 状态更新正确
  - 不影响其他组件

Week 4 ──── 第五批：清理旧代码
  □ 删除 EventBridge.ts 中的旧 handler（保留 EventAdapter）
  □ 删除 messageStore._handleXxx 方法
  □ 删除 runtimeStore、activeAgentStore、backgroundTaskStore
  □ 删除 messageStore._conversationState、status 等冗余字段
  □ 删除 agent-bridge.ts 中的旧 handler + 旧 EventBus 映射
  □ 删除 main process 中的 agent:interrupt / agent:send-supplement handler
  □ 删除 preload.ts 中的旧 IPC 方法
  □ 删除 StateTracker.ts

  验证: 全功能回归测试
```

### 9.3 Feature Flag 控制表

| Flag | 控制范围 | 默认值 | 切换时机 |
|------|---------|--------|---------|
| `USE_SESSION_STATE_MACHINE` | ChatSession 是否使用新状态机 | `false` | Week 2 后端改造完成后 |
| `USE_EVENT_FORWARDER` | agent-bridge 是否使用 EventForwarder | `false` | Week 2 后端改造完成后 |
| `USE_AGENT_STATE_MACHINE` | 前端是否使用 AgentStateMachine | `false` | Week 3 EventAdapter 就绪后 |
| `USE_NEW_IPC` | 前端是否使用 agent:user-action | `false` | Week 3 preload 改造完成后 |
| `USE_SESSION_STORE` | 前端是否使用 SessionStore | `false` | Week 3 SessionStore 就绪后 |

---

## 10. 数据流端到端验证清单

### 10.1 核心用户场景验证

#### 场景 1：用户发送消息

```
[ ] 1. InputArea 调用 agentUserAction({ type: 'SEND_MESSAGE', content })
[ ] 2. preload.ts 发送 IPC 'agent:user-action' (invoke)
[ ] 3. main process agent.ts 转发到子进程
[ ] 4. agent-bridge channel.handle('user-action') 收到
[ ] 5. session.userAction() 调用 SessionStateMachine.transition(USER_MESSAGE)
[ ] 6. 状态机返回 RUN_AGENT → session.run(message)
[ ] 7. AgentLoop.run() 开始，emit AGENT_STARTED
[ ] 8. EventForwarder 发出 IPC 'agent:started'
[ ] 9. EventAdapter 收到 → SessionStore.onAgentStarted()
[ ] 10. InputArea 看到 isRunning=true → 显示停止按钮
[ ] 11. MessageBubble 看到 processing=true → 显示加载动画

验证点: 前端状态与后端状态一致，input 框正确切换
```

#### 场景 2：Agent 输出文字

```
[ ] 1. AgentLoop 调用 StreamPipeline → LLM 返回 text delta
[ ] 2. emit AGENT_TEXT_DELTA → EventForwarder 发出 IPC 'agent:text'
[ ] 3. EventAdapter → AgentStateMachine.transition(TEXT_DELTA) + messageStore.appendStreamingText
[ ] 4. MessageBubble 显示流式文字气泡
[ ] 5. WorkspaceMonitor 更新 moment → '输出中'

验证点: 流式文字正确显示，Moment 更新正确
```

#### 场景 3：创建异步 task

```
[ ] 1. AgentLoop 调用 TaskTool → TaskOrchestrator.startTask()
[ ] 2. emit ASYNC_TASK_STARTED → EventForwarder 发出 IPC 'agent:async-task-update'
[ ] 3. EventAdapter → AsyncTaskStore.transition + AgentStateMachine.transition(AGENT_CREATED)
[ ] 4. ExecutionFlow 显示新节点 (pending 状态)
[ ] 5. InputArea 上方的 BackgroundTaskIndicator 显示运行中任务

验证点: task 节点正确创建，后台任务计数正确
```

#### 场景 4：task 子 agent 执行

```
[ ] 1. 子 agent thinking → EventForwarder 发出 IPC 'agent:thinking' (携带 parentAgentId)
[ ] 2. EventAdapter → AgentStateMachine.transition(THINKING_DELTA)
[ ] 3. ExecutionFlow 节点状态: pending → thinking (紫色脉冲)
[ ] 4. WorkspaceMonitor moment: '思考中'

[ ] 5. 子 agent tool-start → EventForwarder 发出 IPC 'agent:tool-start'
[ ] 6. EventAdapter → AgentStateMachine.transition(TOOL_START)
[ ] 7. ExecutionFlow 节点状态: thinking → executing (橙色旋转)
[ ] 8. ToolSection 显示工具调用详情

[ ] 9. 子 agent text → EventForwarder 发出 IPC 'agent:text'
[ ] 10. MessageBubble 创建子 agent 流式气泡 (如果 streamToUser=true)

验证点: 子 agent 生命周期各阶段正确展示
```

#### 场景 5：task 完成后自动汇总

```
[ ] 1. 子 agent 完成 → emit SUBAGENT_END → IPC 'agent:subagent-end' (success)
[ ] 2. EventAdapter → AgentStateMachine.transition(SUBAGENT_END, success: true)
[ ] 3. ExecutionFlow 节点状态: executing → success (绿色)
[ ] 4. WorkspaceMonitor moment: '待汇报'

[ ] 5. TaskCompletionHandler.autoSummarize() → emit AUTO_SUMMARIZE → IPC
[ ] 6. EventAdapter → AgentStateMachine.transition(AUTO_SUMMARIZE_START)
[ ] 7. ExecutionFlow 节点: 3 秒后移除
[ ] 8. BackgroundTaskIndicator: 任务从 running → completed → cleared

验证点: task 完成 → 汇总 → 清理全流程正确
```

#### 场景 6：用户在 outputting 时发送新消息

```
[ ] 1. InputArea 调用 agentUserAction({ type: 'SEND_MESSAGE', content })
[ ] 2. 后端 SessionStateMachine 状态 = 'outputting'
[ ] 3. 状态机: USER_MESSAGE → pendingMessages.push() + abortRequested = true
[ ] 4. AgentLoop 下一个迭代边界检测到 abortRequested → 结束
[ ] 5. AgentLoop.onEnd 触发 → sessionStateMachine AGENT_COMPLETED
[ ] 6. 状态机: pendingMessages 非空 → RUN_AGENT (新一轮)
[ ] 7. 前端: agent:started → 新一轮 UI 初始化

验证点: 补充消息正确打断当前输出并启动新轮次
```

#### 场景 7：创建 agent_team

```
[ ] 1. TeamTool → TeamManager.createTeam() → emit HOOK_TEAM_START
[ ] 2. EventForwarder → IPC 'agent:team-start' (携带 members 列表)
[ ] 3. EventAdapter → AgentStateMachine.transition(AGENT_CREATED, team leader)
[ ] 4. EventAdapter → AgentStateMachine.transition(AGENT_CREATED) × N (各 member, pending)
[ ] 5. ExecutionFlow: team leader 节点 + N 个 member 子节点 (pending)
[ ] 6. BackgroundTaskIndicator: 1 个 team 类型任务运行中

[ ] 7. 各 member 开始 → HOOK_TEAM_MEMBER_START → IPC
[ ] 8. EventAdapter → AgentStateMachine.transition(THINKING_DELTA)
[ ] 9. ExecutionFlow: member 节点 pending → thinking

[ ] 10. team 结束 → HOOK_TEAM_END → IPC
[ ] 11. EventAdapter 批量设置所有 member 终态
[ ] 12. AgentStateMachine 批量更新 moment

验证点: team 的创建、成员执行、批量结束全流程正确
```

### 10.2 IPC 事件收发包验证

```
[ ] agent:user-action 正常返回 { success: true, action: 'running' | 'queued' }
[ ] agent:user-action 超时场景正确处理（120s timeout）
[ ] agent:started → SessionStore.onAgentStarted 正确设置
[ ] agent:text → messageStore 流式气泡 + AgentStateMachine 状态同步
[ ] agent:thinking → AgentStateMachine THINKING_DELTA（含 3s 缓冲）
[ ] agent:tool-start / tool-end → AgentStateMachine 工具状态
[ ] agent:async-task-update → AsyncTaskStore + AgentStateMachine 同步
[ ] agent:subagent-start / end (向后兼容期间) → AgentStateMachine
[ ] agent:team-start / team-member-start / team-member-end / team-end
[ ] agent:auto-summarize-start → AgentStateMachine 清理
[ ] agent:task-failed → AgentStateMachine TASK_FAILED
[ ] agent:citation → CitationStore
[ ] agent:conversation-state → SessionStore.setConversationState
[ ] agent:end → SessionStore.onAgentCompleted + messageStore.finishStreaming
```

### 10.3 Store 数据一致性验证

```
[ ] SessionStore.conversationState 与后端 SessionStateMachine 状态一致
[ ] AgentStateMachine.agentMap 中 agent 数量与 ExecutionFlow 节点数量一致
[ ] AgentStateMachine.getCurrentMoments() 与 WorkspaceMonitor 显示的 moment 一致
[ ] AsyncTaskStore.getRunningCount() 与 BackgroundTaskIndicator 显示的计数一致
[ ] AgentStateMachine.agentMap[id].status 变更时，ExecutionFlow 节点样式同步更新
[ ] AgentStateMachine.agentMap[id].status 变更时，Moment 自动更新（不需要手动 setAgentMoment）
[ ] agent 被清理时，ExecutionFlow 节点在延迟后正确移除
[ ] agent 被清理时，对应的 MessageBubble 子 agent 气泡正确完成
[ ] citation 数据写入 CitationStore 后，引用面板正确显示
```

---

## 附录 A：改造优先级速查

| 优先级 | 模块 | 原因 |
|--------|------|------|
| P0 | SessionStateMachine + AgentStateMachine | 核心状态机，所有其他模块依赖 |
| P0 | EventAdapter (替代 EventBridge) | 事件分发枢纽，所有前端改造依赖 |
| P1 | SessionStore | 替代 runtimeStore 的会话状态 |
| P1 | messageStore 精简 | 消息展示的核心数据源 |
| P1 | AsyncTaskStore | 替代 backgroundTaskStore |
| P2 | ExecutionFlow 适配 | 依赖 AgentStateMachine 就绪 |
| P2 | WorkspaceMonitor 适配 | 依赖 AgentStateMachine + SessionStore |
| P2 | InputArea 适配 | 依赖新 IPC 方法 + SessionStore |
| P2 | MessageBubble 适配 | 依赖 messageStore + AgentStateMachine |
| P3 | 其余组件适配 | 小改动，逐个迁移 |
| P3 | 旧代码清理 | 最后一步，验证充分后执行 |

## 附录 B：改造风险矩阵

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| IPC 事件丢失（新旧 EventBridge 并行期间重复消费） | 高 | EventAdapter 和 EventBridge 监听同一事件时使用 `once` + `messageId` 去重 |
| agent:user-action 与旧 send-message 行为不一致 | 高 | feature flag 控制，默认走旧通道，充分测试后再切换 |
| AgentStateMachine 状态机 bug 导致 UI 卡死 | 中 | 单元测试覆盖所有状态转换路径 |
| Store 拆分后组件渲染性能下降 | 低 | Zustand selector 精确定位，避免全量订阅 |
| 旧 store 删除后残留引用导致编译错误 | 低 | TypeScript 编译器会在 CI 中捕获 |
| Store 间交叉通知导致循环依赖 | 中 | 方案 B（微 StoreEventBus），Store 只 import storeEventBus 不 import 彼此 |
| 新旧 IPC 并行期间事件重复消费 | 中 | EventAdapter 内置 dedupOrProcess，messageId 幂等键滑动窗口去重 |
| Feature flag 组合爆炸 | 低 | CI 矩阵覆盖 3 种 profile (all-off / backend-new / all-on) |

---

## 附录 C：Feature Flag CI 测试矩阵

重构期间 CI 需要覆盖 flag 的三种组合：

```yaml
# .github/workflows/test.yml (新增矩阵)
strategy:
  matrix:
    flag-profile:
      - name: all-off         # Week 1 基线状态 = 全部关闭
        USE_SESSION_STATE_MACHINE: 'false'
        USE_EVENT_FORWARDER: 'false'
        USE_AGENT_STATE_MACHINE: 'false'
        USE_NEW_IPC: 'false'
        USE_SESSION_STORE: 'false'
      - name: backend-new     # Week 2 状态 = 后端新模块启用
        USE_SESSION_STATE_MACHINE: 'true'
        USE_EVENT_FORWARDER: 'true'
        USE_AGENT_STATE_MACHINE: 'false'
        USE_NEW_IPC: 'false'
        USE_SESSION_STORE: 'false'
      - name: all-on          # Week 4 目标状态
        USE_SESSION_STATE_MACHINE: 'true'
        USE_EVENT_FORWARDER: 'true'
        USE_AGENT_STATE_MACHINE: 'true'
        USE_NEW_IPC: 'true'
        USE_SESSION_STORE: 'true'
```

验证规则：
- `all-off` — 所有现有测试必须通过（基线）
- `backend-new` — 后端新模块测试通过 + 现有 e2e 测试通过（后端兼容性）
- `all-on` — 全部新模块测试通过 + 核心场景 e2e 通过（目标状态）
- 混合模式 — 按需增加，用于逐组件切换阶段的针对性验证

## 附录 D：旧代码清理确认检查清单

Week 4 清理旧代码时，逐项运行以下检查脚本确认无残留引用：

### 后端清理
```bash
# 检查残留引用
grep -r "StateTracker" src/ | grep -v "node_modules" | grep -v ".git"
grep -r "_pendingQueue" src/
grep -r "handleInterrupt\|handleAppendMessage" src/ desktop/main/
grep -r "registerHookEventBridge" desktop/main/
grep -r "agent:interrupt\|agent:send-supplement" desktop/main/ipc/

# 确认编译通过
npx tsc --noEmit

# 确认测试通过
npm test
```

### 前端清理
```bash
# 检查残留引用
grep -r "from.*runtimeStore" desktop/renderer/
grep -r "from.*activeAgentStore" desktop/renderer/
grep -r "from.*backgroundTaskStore" desktop/renderer/
grep -r "_conversationState\|_promoteSubAgent\|_cleanedAgentIds" desktop/renderer/
grep -r "findAgent[^S]\|findAgentInTree\|findParentId" desktop/renderer/
grep -r "agentInterrupt\|agentSendSupplment" desktop/renderer/
grep -r "from.*WorkspaceMonitor" desktop/renderer/

# 确认编译通过
npx tsc --noEmit

# 确认构建通过
npm run build
```

### 确认后删除
```bash
git rm src/core/state/StateTracker.ts
git rm desktop/renderer/stores/runtimeStore.ts
git rm desktop/renderer/stores/activeAgentStore.ts
git rm desktop/renderer/stores/backgroundTaskStore.ts
git rm -r desktop/renderer/components/WorkspaceMonitor/
git rm desktop/renderer/services/EventBridge.ts
git commit -m "chore: remove legacy modules after architecture migration"
```
