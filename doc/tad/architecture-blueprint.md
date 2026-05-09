# 璇玑架构升级方案（一）：架构蓝图与状态机设计

## 目录

1. [设计原则](#1-设计原则)
2. [核心状态机](#2-核心状态机)
3. [数据流架构](#3-数据流架构)
4. [模块职责边界](#4-模块职责边界)
5. [Agent 统一生命周期模型](#5-agent-统一生命周期模型)
6. [消息通道统一模型](#6-消息通道统一模型)

---

## 1. 设计原则

### 原则 1：单一数据源 (Single Source of Truth)

每一种业务状态只有一个 owner，其他模块通过只读接口消费。当前最大问题是前端维护了三份重叠的会话状态（`messageStore.status`、`messageStore._conversationState`、`runtimeStore.processing`）。

**目标**：前端只保留一份 `SessionState`，由 `SessionStateMachine` 统一管理，所有组件从这一个状态派生 UI。

### 原则 2：状态机驱动 (State Machine Driven)

所有生命周期流转必须经过显式的状态机，不允许直接设置状态字段。当前 `setAgentStatus(agentId, 'thinking')` 这样的调用散落在 20+ 个位置。

**目标**：`agentStateMachine.transition(agentId, 'thinking')` 是唯一入口，内部自动同步 moment、timeline、bgTask。

### 原则 3：事件→状态→UI (Event → State → UI)

事件（EventBus / IPC）只触发状态变更，UI 只响应状态变更。当前 EventBridge handler 中直接操作多个 store，包含了大量业务逻辑。

**目标**：EventBridge handler 只做 `stateMachine.dispatch(event)` 的薄转发。

### 原则 4：桥接层零逻辑 (Thin Bridge)

IPC 桥接层（agent-bridge.ts、EventBridge.ts）不包含任何业务逻辑——它们只是消息格式的适配器。当前这些文件包含了 agent 树搜索、moment 计算、bgTask 生命周期管理等业务逻辑。

**目标**：桥接层代码量缩减 70%+，所有逻辑下沉到对应的 service/store。

### 原则 5：Task/Team 统一模型

task 是只有一个成员的 team，共享相同的生命周期事件。当前它们走两条独立的前端处理链路。

**目标**：`AsyncTask` 统一模型，前端只有一套 handler。

---

## 2. 核心状态机

### 2.1 会话级状态机 — SessionStateMachine

```
                            ┌─────────────────────────────────────┐
                            │                                     │
                            ▼                                     │
   ┌──────────┐   run()   ┌──────────┐  onText   ┌──────────┐   │
   │          │──────────▶│          │──────────▶│          │   │
   │   IDLE   │           │EXECUTING │           │OUTPUTTING│   │
   │          │◀──────────│          │◀──────────│          │   │
   └──────────┘  done/    └──────────┘ onToolStart└──────────┘   │
        ▲         error         │                                  │
        │                       │ startAsyncTask                  │
        │                       ▼                                  │
        │                 ┌──────────────┐                        │
        │                 │              │  allAsyncTasksCleared  │
        │                 │WAITING_ASYNC │────────────────────────┘
        │                 │              │
        │                 └──────┬───────┘
        │                        │ userInput arrives
        │                        │ (含 interrupt/supplement)
        └────────────────────────┘
```

**状态定义**：

| 状态 | 含义 | 用户操作 |
|------|------|----------|
| `idle` | 空闲，等待输入 | sendMessage → 进入 executing |
| `executing` | Agent 正在思考/执行工具 | sendMessage → 入队（supplement 行为），stop → 硬终止 |
| `outputting` | Agent 正在输出文本 | sendMessage → 入队（supplement 行为），stop → 硬终止 |
| `waiting_async` | 有后台异步任务在跑 | sendMessage → 立即开始新轮次 |

**与当前 StateTracker 的区别**：

- 新状态机集成了 `queuedMessages` 管理（当前分散在 ChatSession._pendingQueue）
- 新状态机集成了 interrupt/supplement 的处理策略（当前分散在 ChatSession.interrupt/appendMessage）
- 前端不再需要 `_conversationState` 副本 — 状态机通过 EventBus 通知状态变更，前端消费单一事件

**入口方法**：

```typescript
class SessionStateMachine {
  private state: SessionState = 'idle';
  private queuedMessages: string[] = [];
  private abortRequested = false;
  private agentLoopState: AgentLoopState = 'idle';

  // 唯一入口：所有用户消息都走这里
  submitMessage(message: string): MessageAction {
    switch (this.state) {
      case 'idle':
      case 'waiting_async':
        // 启动新轮次
        return { type: 'run', message };
      case 'executing':
      case 'outputting':
        // 入队等待当前轮次结束
        this.queuedMessages.push(message);
        return { type: 'queued', message };
    }
  }

  // 停止当前执行
  requestStop(input?: string): StopAction {
    if (!input?.trim()) {
      // 纯停止：硬中断 + 清空队列
      this.abortRequested = true;
      this.queuedMessages = [];
      return { type: 'hardStop' };
    }
    // 中断 + 新消息：注入队列头部
    this.abortRequested = true;
    this.queuedMessages.unshift(input);
    return { type: 'softStop' };
  }

  // AgentLoop 空闲时调用，消费队列
  consumeQueue(): string | null {
    return this.queuedMessages.shift() ?? null;
  }

  transition(to: SessionState): void {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    eventBus.emit(SESSION_STATE_CHANGED, { from, to });
  }
}
```

### 2.2 Agent 级状态机 — AgentStateMachine

适用于主 agent 和所有子 agent（task / team member）：

```
                    ┌─────────────────────────────────────┐
                    │    agent:task-failed (cancelled)     │
                    │         3s 后 auto-cleanup           │
                    │                                     │
                    ▼                                     │
   ┌──────────┐  promote  ┌──────────┐  tool-start  ┌──────────┐  text  ┌──────────┐
   │          │──────────▶│          │─────────────▶│          │───────▶│          │
   │ PENDING  │           │ THINKING │               │EXECUTING │        │ WRITING  │
   │          │◀──────────│          │◀─────────────│          │◀───────│          │
   └──────────┘  (never)  └──────────┘  tool-end     └──────────┘  text  └────┬─────┘
        │                   │    ▲                                             │
        │                   │    │                                             │
        │                   │    └─── tool-end (最后一件工具) ──────────────────┘
        │                   │
        │                   ▼
        │             ┌──────────┐    allDone    ┌──────────┐  summarized  ┌──────────┐
        │             │          │──────────────▶│          │─────────────▶│          │
        │             │  FAILED  │               │REPORTING │              │ CLEARED  │
        │             │          │               │          │              │          │
        │             └──────────┘               └──────────┘              └──────────┘
        │                   ▲                          ▲                       ▲
        │                   │                          │                       │
        └───────────────────┘                          │                       │
            (从 pending 也可以失败)        subagent-end / team-member-end       │
                                          (success: false)                     │
                                                                               │
                                          subagent-end / team-member-end       │
                                          (success: true) ─────────────────────┘
```

**状态定义**：

| 状态 | 含义 | 允许的 UI moment | 数据来源 |
|------|------|------------------|----------|
| `pending` | 已注册但尚未开始执行 | ⏳ 等待执行 | subagent-start event |
| `thinking` | 正在思考推理 | 🧠 思考中 | thinking event |
| `executing` | 正在执行工具 | ⚙️ 工具名 | tool-start event |
| `writing` | 正在输出文本 | ✍️ 编写中 | text event |
| `failed` | 执行失败 | ⚠️ 执行失败 | subagent-end (success=false) |
| `reporting` | 已完成，等待主 agent 汇报 | 📤 待汇报 | subagent-end (success=true) |
| `cleared` | 已被汇总清理（节点移除） | — | auto-summarize-start |

**核心实现**：

```typescript
class AgentStateMachine {
  private agents = new Map<string, AgentLifecycle>();
  private listeners = new Set<AgentStateListener>();

  // === 唯一的状态转换入口 ===
  transition(agentId: string, to: AgentState, context?: TransitionContext): void {
    const agent = this.getOrCreate(agentId);
    const from = agent.state;
    
    if (!isValidTransition(from, to)) {
      // 非法转换：静默忽略（如终态 agent 收到 thinking 事件）
      if (isTerminal(from)) return;
      console.warn(`Invalid transition: ${agentId} ${from} → ${to}`);
      return;
    }

    agent.state = to;
    agent.transitionedAt = Date.now();

    // 统一派发副作用
    this.dispatchSideEffects(agentId, from, to, context);
  }

  // === 副作用：状态变更时统一触发 ===
  private dispatchSideEffects(
    agentId: string, from: AgentState, to: AgentState,
    context?: TransitionContext
  ): void {
    // 1. Moment 更新
    const moment = MOMENT_MAP[to];
    if (moment) {
      this.onMomentChange(agentId, { ...moment, context });
    }

    // 2. Timeline 事件更新
    if (to === 'executing' && context?.toolId) {
      this.onTimelineStart(agentId, context.toolId, context.toolName);
    }
    if (from === 'executing' && to === 'thinking' && context?.toolId) {
      this.onTimelineEnd(agentId, context.toolId, context.duration, context.isError);
    }

    // 3. BackgroundTaskStore 同步
    if (isTerminal(to)) {
      this.onAgentTerminal(agentId, to);
    }

    // 4. 通知监听器（UI 组件）
    for (const listener of this.listeners) {
      listener(agentId, from, to);
    }
  }

  // === 查询方法 ===
  getState(agentId: string): AgentState { ... }
  isTerminal(agentId: string): boolean { ... }
  findParent(agentId: string): string | null { ... }
  findChildren(agentId: string): string[] { ... }
  isTeamMember(agentId: string): boolean { ... }
}
```

**关键约束**：

1. **所有 agent 状态变更必须通过 `AgentStateMachine.transition()`**。禁止直接调用 `activeAgentStore.setAgentStatus()` 或 `runtimeStore.setAgentMoment()`。
2. **终态不可逆**：`failed`/`reporting`/`cleared` 状态的 agent 不能再 transition 到 `thinking`/`executing`/`writing`。
3. **副作用集中**：moment 更新、timeline 更新、bgTask 同步都在 `dispatchSideEffects` 中完成，保证一致性。

### 2.3 异步任务状态机 — AsyncTaskStateMachine

统一管理 task 和 agent_team 的后台执行：

```
   startTask()
        │
        ▼
   ┌──────────┐  first member starts  ┌──────────┐  all members done  ┌───────────┐  autoSummarize  ┌──────────┐
   │          │──────────────────────▶│          │───────────────────▶│           │───────────────▶│          │
   │ CREATING │                       │ RUNNING  │                    │ COMPLETED │                │ CLEARED  │
   │          │──────────┐            │          │──┐                 │           │                │          │
   └──────────┘          │            └──────────┘  │                 └───────────┘                └──────────┘
                         │                          │                       ▲
                         │            ┌──────────┐  │                       │
                         │            │          │  │                       │
                         └───────────▶│CANCELLED │◀─┘ (cancel / all fail)   │
                                      │          │──────────────────────────┘
                                      └──────────┘   (3s 展示后 auto-cleanup)
```

**与 TaskOrchestrator + TaskCompletionHandler 的关系**：

- `AsyncTaskStateMachine` 是状态存储，提供查询和转换
- `TaskOrchestrator` 负责实际的执行调度（启动/停止子进程或 AgentLoop）
- `TaskCompletionHandler` 负责结果汇总（注入 system prompt + 触发主 agent 汇报）
- 三者通过事件解耦，不再像当前这样彼此持有引用

---

## 3. 数据流架构

### 3.1 目标数据流

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Child Process (Backend)                          │
│                                                                              │
│  InputHandler (唯一入口)                                                      │
│    │                                                                         │
│    ├─ SessionStateMachine.submitMessage(msg)                                 │
│    │    ├─ idle → transition('executing') + AgentLoop.run(msg)               │
│    │    └─ executing/outputting → queuedMessages.push(msg)                   │
│    │                                                                         │
│    └─ SessionStateMachine.requestStop(msg?)                                  │
│         └─ abortRequested = true + queuedMessages.unshift/filter             │
│                                                                              │
│  AgentLoop.run()                                                             │
│    ├─ 每轮迭代: checkAbort() → 终止? 跳出                                     │
│    ├─ checkQueue()   → 队列有消息且未输出? 跳出                                │
│    └─ 结束: SessionStateMachine.consumeQueue() → 继续运行或回到 idle          │
│                                                                              │
│  EventBus (内部事件总线)                                                      │
│    ├─ AGENT_STARTED ────┐                                                    │
│    ├─ AGENT_TEXT_DELTA  │                                                    │
│    ├─ AGENT_TOOL_START  │────── 全部原始事件，不做任何过滤                     │
│    ├─ AGENT_TOOL_END    │                                                    │
│    ├─ AGENT_COMPLETED   │                                                    │
│    ├─ ASYNC_TASK_*      │                                                    │
│    └─ SESSION_STATE_* ──┘                                                    │
└──────────────────────┬──────────────────────────────────────────────────────┘
                       │ IPC (Thin Adapter: 格式转换 + 转发，零业务逻辑)
                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Renderer Process (Frontend)                        │
│                                                                              │
│  EventAdapter (唯一 IPC 入口，~100 行)                                       │
│    │                                                                         │
│    ├─ agent:started      → AgentStateMachine.transition(mainId, 'thinking')  │
│    ├─ agent:text         → AgentStateMachine.transition(agentId, 'writing')  │
│    ├─ agent:thinking     → AgentStateMachine.updateThinking(agentId, text)   │
│    ├─ agent:tool-start   → AgentStateMachine.transition(agentId, 'executing')│
│    ├─ agent:tool-end     → AgentStateMachine.endToolExecution(...)           │
│    ├─ agent:end          → SessionState.transition('idle')                   │
│    ├─ session-state      → SessionState.transition(newState)                 │
│    ├─ subagent-start     → AgentStateMachine.register(agentId, 'pending')    │
│    ├─ subagent-end       → AgentStateMachine.transition(agentId, terminal)   │
│    ├─ async-task-update  → AsyncTaskStateMachine.transition(taskId, to)      │
│    └─ auto-summarize     → AgentStateMachine.cleanupTerminalAgents()         │
│                                                                              │
│  Stores (纯状态容器 + 派生计算)                                               │
│    ├─ SessionStore       — 会话状态 (idle/executing/outputting/waiting_async)│
│    ├─ AgentTreeStore     — Agent 树形结构 + 状态 + moment + timeline         │
│    ├─ MessageStore       — 消息列表 + 流式文本缓冲区                           │
│    ├─ AsyncTaskStore     — 后台任务生命周期状态                               │
│    └─ UIStore            — 纯 UI 状态 (面板开合、光标位置等)                   │
│                                                                              │
│  Views (纯渲染)                                                              │
│    ├─ 读写 Stores (useStore selector)                                       │
│    └─ 调用 Actions (发送消息、停止等)                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 关键数据流变更对比

| 维度 | 当前 | 目标 |
|------|------|------|
| 用户消息入口 | `sendMessage` 内 3 分支 → 3 条 IPC 通道 | `sendMessage` 始终走 1 条 IPC 通道 |
| 会话状态 | 3 个变量分散在 2 个 store | `SessionStore` 单一状态 |
| Agent 状态变更 | `setAgentStatus` + `setAgentMoment` + `addTimelineEvent` 各自独立调用 | `AgentStateMachine.transition()` 一次调用完成所有副作用 |
| EventBridge 逻辑量 | ~800 行业务逻辑 | ~100 行纯转发 |
| task/team 前端处理 | 两条独立 handler 链 | 统一 `AsyncTaskStateMachine` |
| bgTask 同步 | EventBridge handler 中手动协调 | `AsyncTaskStateMachine` 内部自动同步 |

---

## 4. 模块职责边界

### 4.1 后端模块

```
┌──────────────────────────────────────────────────────────────────┐
│ agent-bridge.ts (子进程主文件，~400 行)                           │
│                                                                   │
│  职责：                                                           │
│  1. 进程生命周期管理 (初始化/优雅退出)                             │
│  2. IPC 消息注册 (channel.handle('xxx', ...))                    │
│  3. 下载事件转发                                                 │
│  4. 内存监控                                                     │
│                                                                   │
│  不做：                                                           │
│  ✗ 业务逻辑判断                                                   │
│  ✗ EventBus 事件监听（委托给 EventForwarder）                    │
│  ✗ Session 管理逻辑（委托给 ChatSession）                        │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ EventForwarder.ts (新增，~150 行)                                 │
│                                                                   │
│  职责：                                                           │
│  1. 监听 EventBus 所有事件                                       │
│  2. 格式转换：EventBus 事件 → IPC 消息格式                       │
│  3. 调用 safeSend 发送                                           │
│                                                                   │
│  不做：                                                           │
│  ✗ agentId 映射逻辑（事件本身携带正确的 agentId）                 │
│  ✗ 事件过滤/去重                                                 │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ ChatSession.ts                                                    │
│                                                                   │
│  职责：                                                           │
│  1. SessionStateMachine 持有者（会话状态权威来源）                 │
│  2. 队列管理：queuedMessages 入队/出队                            │
│  3. AgentLoop 生命周期：启动/停止/重置                            │
│  4. 协调 TaskCompletionHandler                                    │
│                                                                   │
│  不做：                                                           │
│  ✗ 意图路由（委托给 IntentRouter，ChatSession 只接收结果）        │
│  ✗ 权限确认（委托给 PermissionController）                       │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ AgentLoop.ts                                                      │
│                                                                   │
│  职责：                                                           │
│  1. ReAct 循环：LLM调用 → 工具执行 → 下一轮                      │
│  2. 中断检查：每个迭代边界检查 abort + pendingQueue              │
│  3. 卡住检测                                                     │
│  4. 上下文压缩                                                   │
│                                                                   │
│  状态暴露：                                                       │
│  - getState(): AgentLoopState (idle/running)                     │
│  - onStateChange(callback): 状态变更通知                          │
│                                                                   │
│  不做：                                                           │
│  ✗ 队列管理（ChatSession 负责）                                   │
│  ✗ pendingQueue 注入（ChatSession 通过中断检查接口注入）          │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ TaskOrchestrator.ts                                               │
│                                                                   │
│  职责：                                                           │
│  1. 异步任务执行调度 (startTask / cancelTask)                     │
│  2. 并发控制                                                     │
│  3. 超时管理                                                     │
│                                                                   │
│  不在本模块：                                                     │
│  ✗ 生命周期状态存储 → AsyncTaskStateMachine (子进程侧)            │
│  ✗ 结果汇总汇报 → TaskCompletionHandler                          │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 前端模块

```
┌──────────────────────────────────────────────────────────────────┐
│ EventAdapter.ts (替代 EventBridge.ts，~100 行)                    │
│                                                                   │
│  职责：                                                           │
│  1. messageBus.on('*') 注册所有 IPC 事件                         │
│  2. 每种事件只做一件事：调用对应 Store 的方法                     │
│  3. 不做任何条件判断、数据转换、业务逻辑                           │
│                                                                   │
│  示例：                                                           │
│    messageBus.on('agent:thinking', (data) => {                    │
│      AgentStateMachine.dispatch('thinking', data);                │
│    });                                                            │
│    messageBus.on('agent:subagent-end', (data) => {                │
│      AgentStateMachine.dispatch('subagentEnd', data);             │
│    });                                                            │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ AgentStateMachine.ts (替代分散在 messageStore 的 orchestration)   │
│                                                                   │
│  职责：                                                           │
│  1. Agent 生命周期状态机 (pending→thinking→executing→...)        │
│  2. transition() 是唯一的状态变更入口                             │
│  3. 副作用自动派发：moment / timeline / bgTask                    │
│  4. 树形结构维护 (parent/children 关系)                           │
│  5. 统一的树搜索接口 (findAgent/findParent/isTeamMember)          │
│                                                                   │
│  暴露接口：                                                       │
│    transition(agentId, to, context)                               │
│    register(agentId, parentId, config)                            │
│    cleanup(agentId)                                               │
│    findAgent(id)                                                  │
│    findParent(id)                                                 │
│    getState(id)                                                   │
│    subscribe(callback)                                            │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ AsyncTaskStore.ts (替代 current backgroundTaskStore +             │
│                    messageStore._taskParentMap 等)                 │
│                                                                   │
│  职责：                                                           │
│  1. 异步任务生命周期状态 (creating→running→completed→cleared)     │
│  2. 状态栏计数的派生计算 (getRunningCount/getCompletedCount)     │
│  3. 仅存储元数据；Agent 树中的节点由 AgentStateMachine 管理      │
│                                                                   │
│  同步机制：                                                       │
│  - AgentStateMachine 中 agent 变为 terminal 时 →                  │
│    自动调用 AsyncTaskStore.transitionTask(taskId, terminal)       │
│  - AsyncTaskStore 不主动操作 Agent 树                             │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ MessageStore.ts (精简版)                                          │
│                                                                   │
│  职责：                                                           │
│  1. 消息列表 CRUD                                                │
│  2. 流式文本缓冲管理 (streamTextBuffer + flush)                   │
│  3. 工具摘要气泡生成                                             │
│  4. 子 agent 流式气泡管理                                        │
│                                                                   │
│  移除：                                                           │
│  ✗ _conversationState（→ SessionStore）                          │
│  ✗ _teamIdMap / _teamParentMap / _taskParentMap（→ AsyncTaskStore）│
│  ✗ _pendingSubAgents / _cleanedAgentIds（→ AgentStateMachine）    │
│  ✗ _streamToUserMap / _subAgentStreams（→ SubAgentStreamManager） │
│  ✗ status（→ SessionStore）                                      │
│  ✗ cititionOutputs（→ CitationStore）                            │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ SessionStore.ts (替代 runtimeStore 中的会话状态部分)              │
│                                                                   │
│  职责：                                                           │
│  1. 会话状态 (idle/executing/outputting/waiting_async)            │
│  2. 当前模型信息                                                 │
│  3. Token 用量累计                                               │
│  4. 运行计数                                                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. Agent 统一生命周期模型

### 5.1 核心思想

**task 就是只有一个成员的 agent_team。** 两者在后端走相同的 `TaskOrchestrator.startTask()` → `AgentFactory.createAndRun()` 链路，在前端消费相同的 `AgentStateMachine.transition()` 入口。

### 5.2 事件统一

| 当前事件（分散） | 统一后事件 | 说明 |
|------------------|-----------|------|
| `agent:subagent-start` | `agent:lifecycle` (action: 'registered') | task 和 team member 统一 |
| `agent:team-start` | `agent:lifecycle` (action: 'groupCreated') | 携带 members 数组 |
| `agent:team-member-start` | `agent:lifecycle` (action: 'started') | 单个成员开始执行 |
| `agent:team-member-end` | `agent:lifecycle` (action: 'completed') | 携带 success/result |
| `agent:subagent-end` | `agent:lifecycle` (action: 'completed') | 同上 |
| `agent:task-failed` | `agent:lifecycle` (action: 'terminated') | 携带 reason |
| `agent:auto-summarize-start` | `agent:lifecycle` (action: 'summarized') | 触发清理 |

### 5.3 数据结构

```typescript
interface AgentLifecycle {
  id: string;
  name: string;
  parentId: string | null;
  state: AgentState;
  // === 统一的多 agent 扩展（task/team 通用）===
  group?: {
    type: 'task' | 'team';       // 不再用前缀区分
    groupId: string;              // TaskOrchestrator 的 groupId
    strategy?: string;            // 仅 team
    teamName?: string;            // 仅 team
  };
  // === 任务展示缓冲 ===
  taskDisplayStart?: number;      // 任务文本开始展示时间
  thinkingBuffer?: string;        // 思考内容缓冲
  // === 统计 ===
  stats: {
    tokenUsage: { input: number; output: number; cached: number };
    cost: number;
    toolCount: number;
    duration?: number;
  };
  // === 成员（仅 team） ===
  memberIds?: string[];
}
```

---

## 6. 消息通道统一模型

### 6.1 当前问题回顾

```
Renderer  ──┬── agent:send-message (request-response, 120s timeout) ──▶ Child
            ├── agent:interrupt     (fire-and-forget, process.send)  ──▶ Child
            └── agent:send-supplement (fire-and-forget, process.send) ──▶ Child
```

三条通道的不同机制导致：
- fire-and-forget 无响应，前端无法知道操作是否成功
- 各自进入不同的 `ChatSession` 方法（`handleUserInput` / `interrupt` / `appendMessage`）
- 竞态条件复杂

### 6.2 目标模型

```
Renderer  ──── agent:send-message (request-response) ────▶ Child
                         │
                  { message: string, 
                    action: 'send' | 'stop' | 'stopAndSend' }
                         │
                         ▼
                  InputHandler.submit(input)
                    ├─ 基于 SessionStateMachine 自动决定行为
                    └─ 返回 { accepted: true, action: 'running' | 'queued' | 'stopped' }
```

前端始终调用同一个 IPC 方法，携带 `action` 参数：

```typescript
// preload.ts
agentSendMessage: (message: string) => ipcRenderer.invoke('agent:send-message', {
  message,
  // action 由后端 ChatSession 根据状态自动决定，前端不需要传
});
```

**子进程处理**：

```typescript
// agent-bridge.ts
channel.handle('send-message', async (data) => {
  const input = data?.message || '';
  
  // 意图路由
  const route = await intentRouter.route(input);
  session.setCurrentAgent(route.agentId);
  channel.send('agent:intent-route', { agentId: route.agentId, confidence: route.confidence });
  
  // 统一入口：handleUserInput 内部根据 SessionStateMachine 做路由
  const action = session.handleUserInput(input);
  
  return { success: true, action };
});
```

**ChatSession.handleUserInput 内部**：

```typescript
handleUserInput(input: string): 'running' | 'queued' {
  const state = this.stateMachine.getState();
  
  switch (state) {
    case 'idle':
    case 'waiting_async':
      // 启动新轮次
      this.run(input);
      return 'running';
    
    case 'executing':
    case 'outputting':
      // 入队，不中断
      this.stateMachine.enqueue(input);
      return 'queued';
  }
}
```

**前端 sendMessage 简化**：

```typescript
sendMessage: async (content) => {
  // 添加用户消息气泡
  set(state => ({
    messages: [...state.messages, { id, role: 'user', content, timestamp }]
  }));
  
  try {
    // 始终走同一条通道
    const result = await window.electron.agentSendMessage(content);
    if (!result.success) {
      handleError(result.error);
    }
    // result.action 可用于 UI 提示 ("消息已排队" vs "正在执行")
  } catch (err) {
    handleError(err);
  }
}
```

### 6.3 纯停止 (无输入)

纯停止按钮仍然走同一个 IPC 通道，`message` 为空字符串：

```typescript
// InputArea.tsx
const handleStop = () => {
  window.electron.agentSendMessage('');  // 空消息 = 停止
};

// ChatSession.handleUserInput
if (!input.trim()) {
  this.agentLoop.hardStop();
  this.stateMachine.transition('idle');
  return 'stopped';
}
```

这样可以完全消除 `agentInterrupt` 和 `agentSendSupplment` 这两条 IPC 通道。

---

## 7. IntentRouter → Scene 系统的演进路径

### 7.1 当前状态

`IntentRouter` 是空壳，始终返回 `{ agentId: 'xuanji', confidence: 1.0 }`。但 Scene 系统（`scene-classifier.yaml`）已定义了完整的意图分类能力：使用本地小模型 (qwen2.5-1.5b) 对用户输入进行 scene/agent/complexity 三字段分类。

### 7.2 演进策略：不破坏状态机架构

Scene 系统通过替换 `IntentRouter.route()` 的实现即可接入，**不需要改动** SessionStateMachine、EventForwarder、ChatSession 的任何接口：

```
改造后 ChatSession.userAction():
  ├─ 1. route = intentRouter.route(message)  ← Scene 系统替换此方法的实现
  │     ├─ 旧实现: return { agentId: 'xuanji', confidence: 1.0 }
  │     └─ 新实现: sceneClassifier.classify(message) → { agentId, scene, complexity }
  │
  ├─ 2. session.setCurrentAgent(route.agentId)
  ├─ 3. 发送 'agent:intent-route' IPC 事件（携带 scene、complexity）
  │
  └─ 4. SessionStateMachine.transition(USER_MESSAGE)  ← 不受影响
```

### 7.3 接入步骤

| 阶段 | 动作 | 依赖 |
|------|------|------|
| Phase A | IntentRouter 接入 Scene 分类器（调用本地小模型） | SessionStateMachine 已就绪 |
| Phase B | IntentRoute 增加 `scene` 和 `complexity` 字段 | AgentFactory 可据此选择 agent/scene prompt |
| Phase C | `agent:intent-route` IPC 事件携带 scene 信息 | 前端可根据 scene 切换 UI 模式 |
| Phase D | 根据 complexity 选择 ACP 隔离还是进程内执行 | ACP 进程池配置 |

### 7.4 关键约束

Scene 系统的引入**不得**绕过 SessionStateMachine。Scene 分类只在 `userAction` 的第一步执行，分类结果不影响状态机流转——状态机始终根据 `USER_MESSAGE` 事件决定 `RUN_AGENT` / `QUEUE_ONLY` / `ABORT_AGENT`。

---

## 8. 相关文档

本架构升级方案分为四份文档：

| 文档 | 内容 | 读者 |
|------|------|------|
| **[architecture-blueprint.md](architecture-blueprint.md)** (本文) | 架构蓝图：设计原则、状态机设计、数据流、模块职责边界、统一生命周期模型 | 所有人 |
| **[backend-migration-plan.md](backend-migration-plan.md)** | 后端迁移方案：具体改造步骤、代码示例、迁移策略 | 后端开发者 |
| **[frontend-migration-plan.md](frontend-migration-plan.md)** | 前端迁移方案：Store 拆分、EventAdapter 创建、组件更新、迁移策略 | 前端开发者 |
| **[module-coordination-plan.md](module-coordination-plan.md)** | 跨模块协同改造方案：前后端通信适配、React Flow / 对话框 / 后台任务 / WorkspaceMonitor 适配、分批改造时序、端到端验证清单 | 全栈开发者 |

### 阅读顺序建议

1. 先读 **architecture-blueprint.md** 理解目标架构
2. 再读 **backend-migration-plan.md** 了解后端如何改造
3. 再读 **frontend-migration-plan.md** 了解前端 Store 如何拆分
4. 最后读 **module-coordination-plan.md** 理解各模块如何协同配合、分批实施

### 改造优先级总览

| 阶段 | 改造内容 | 预计周期 | 风险 |
|------|---------|---------|------|
| Phase 1 | 新建模块（SessionStateMachine、EventForwarder、AgentStateMachine、AsyncTaskStore）| 1-2 周 | 低（纯新增，不影响现有代码） |
| Phase 2 | 并行切换（新旧 handler 共存，逐一切换 IPC 通道和 Store）| 2-3 周 | 中（需要 feature flag + 充分测试） |
| Phase 3 | 清理旧代码（删除旧 handler、旧 store、轮询逻辑、防御代码）| 1 周 | 低（完全切换到新架构后） |

### 预期收益

| 指标 | 改造前 | 改造后 | 改善 |
|------|--------|--------|------|
| 后端代码行数 | ~2500 | ~1400 | -44% |
| 前端代码行数 | ~3300 | ~900 | -73% |
| 防御代码（重复逻辑、状态补丁） | 80+ 处 | 0 处 | 消除 |
| 前端状态变量数 | 3 个（status / _conversationState / processing） | 1 个 | -66% |
| IPC 通道数 | 3 条（不同模式） | 1 条 | -66% |
| Agent 节点创建点 | 5 处 | 1 处（AgentStateMachine.ensureAgent） | -80% |
| Moment 更新点 | 8 处 | 1 处（updateMoment） | -88% |
| 树搜索实现 | 4 种 | 0 种（O(1) agentMap） | 消除 |
