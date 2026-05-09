# 璇玑架构升级 — 后端迁移方案

## 一、改造总览

```
改造前                                                      改造后
═══════════════════════════════════════════════            ═══════════════════════════════════════════
agent-bridge.ts (1896 行)                                 agent-bridge.ts (~400 行)
├─ handleSendMessage                                     ├─ handleMessage(action, data)
├─ handleInterrupt                                       │   └─ ChatSession.userAction(action, data)
├─ handleAppendMessage                                   │       (唯一入口，替代 3 个 handler)
├─ IntentRouter (空壳)                                   └─ registerEventForwarder()
├─ SessionManager                                        (EventForwarder 提取到独立模块)
├─ registerHookEventBridge() (400+ 行 EventBus→IPC 映射)
├─ TaskOrchestrator 初始化
└─ 各种钩子注册

ChatSession.ts (270 行)                                  ChatSession.ts (~200 行)
├─ handleUserInput() + run() + interrupt()               ├─ userAction(action, data) — 统一入口
│   + appendMessage() + drainPendingQueue()              └─ SessionStateMachine (嵌入)
├─ 三重 reentrancy guard
└─ interrupt() 50ms 轮询

AgentLoop.ts                                             AgentLoop.ts (~300 行，基本不变)
├─ checkShouldStop() (两个检查点)                        ├─ checkShouldStop() — 简化为纯状态查询
├─ checkShouldAbort()                                    └─ 移除 interruptChecker 注入
└─ 上下文压缩 / 卡住检测

TaskOrchestrator.ts                                      TaskOrchestrator.ts (变化较小)
└─ 管理 TaskGroup + 回调分发                             └─ 增加 AsyncTaskStateMachine 通知

TaskCompletionHandler.ts                                 TaskCompletionHandler.ts (简化)
├─ autoSummarize() + pendingCompletions 队列             └─ 仍保留，但队列逻辑简化
└─ 竞态处理

新增文件:
├─ src/core/state/SessionStateMachine.ts
├─ src/core/event/EventForwarder.ts
└─ src/core/task/AsyncTaskStateMachine.ts
```

**核心原则**：
1. 每个模块只有一个职责，消除重叠的 guard
2. 状态机驱动状态转换，外部只发出意图（Intent），不直接操作状态
3. EventBus → IPC 的映射集中在一个地方，薄转发无业务逻辑
4. 异步任务的生命周期由独立的 AsyncTaskStateMachine 管理，不嵌入 agent-bridge

---

## 二、改造步骤

### 步骤 1：创建 SessionStateMachine

**新文件**: `src/core/state/SessionStateMachine.ts`

当前 `StateTracker` 只做 4 状态转换（idle/executing/outputting/waiting_async），但 `ChatSession` 还需要管理 `_pendingQueue`、中断逻辑、补充消息语义。SessionStateMachine 统一所有这些：

```typescript
// 事件类型
type SessionEvent =
  | { type: 'USER_MESSAGE'; message: string }
  | { type: 'USER_INTERRUPT'; message?: string }
  | { type: 'AGENT_STARTED' }
  | { type: 'AGENT_TEXT_STARTED' }
  | { type: 'AGENT_COMPLETED' }
  | { type: 'AGENT_ERROR'; error: string }
  | { type: 'ASYNC_TASK_COMPLETED'; subAgentId: string; result: any }
  | { type: 'USER_NEW_SESSION' };

// 状态
type SessionState = 
  | 'idle'
  | 'executing'       // AgentLoop 运行中，尚未输出文字
  | 'outputting'      // AgentLoop 运行中，已在输出文字
  | 'waiting_async';  // AgentLoop 空闲但有异步任务未汇总

interface SessionContext {
  state: SessionState;
  pendingMessages: string[];     // 替代当前的 _pendingQueue
  isTextOutputStarted: boolean;   // 替代当前的 _hasOutputInThisRun
  abortRequested: boolean;
  hasPendingAsyncTasks: boolean;  // 替代 waiting_async 的判断
}

export class SessionStateMachine {
  private context: SessionContext;
  
  get state(): SessionState { return this.context.state; }
  get pendingMessages(): string[] { return this.context.pendingMessages; }
  get shouldAbort(): boolean { return this.context.abortRequested; }
  get hasPendingWork(): boolean { return this.context.pendingMessages.length > 0; }

  // 核心方法：处理用户操作，返回 AgentLoop 的预期生命周期事件
  transition(event: SessionEvent): SessionAction {
    switch (this.context.state) {
      case 'idle':
        return this.handleIdle(event);
      case 'executing':
        return this.handleExecuting(event);
      case 'outputting':
        return this.handleOutputting(event);
      case 'waiting_async':
        return this.handleWaitingAsync(event);
    }
  }

  private handleIdle(event: SessionEvent): SessionAction {
    if (event.type === 'USER_MESSAGE') {
      this.context.pendingMessages = [event.message];
      this.transitionTo('executing');
      return { type: 'RUN_AGENT', message: event.message };
    }
    return { type: 'NOOP' };
  }

  private handleExecuting(event: SessionEvent): SessionAction {
    switch (event.type) {
      case 'USER_MESSAGE':
        // executing 态收到新消息：排队
        this.context.pendingMessages.push(event.message);
        return { type: 'NOOP' };
      case 'USER_INTERRUPT':
        // 有消息 = 补充语义，无消息 = 纯停止
        if (event.message && event.message.trim()) {
          this.context.pendingMessages.unshift(event.message);
        }
        this.context.abortRequested = true;
        return { type: 'ABORT_AGENT' };
      case 'AGENT_TEXT_STARTED':
        this.transitionTo('outputting');
        return { type: 'NOOP' };
      case 'AGENT_COMPLETED':
        return this.handleAgentCompleted();
    }
    return { type: 'NOOP' };
  }

  private handleOutputting(event: SessionEvent): SessionAction {
    switch (event.type) {
      case 'USER_MESSAGE':
        // outputting 态：打断当前输出，消息排队
        this.context.pendingMessages.push(event.message);
        this.context.abortRequested = true;
        return { type: 'ABORT_AGENT' };
      case 'USER_INTERRUPT':
        this.context.abortRequested = true;
        if (event.message && event.message.trim()) {
          this.context.pendingMessages.unshift(event.message);
        }
        return { type: 'ABORT_AGENT' };
      case 'AGENT_COMPLETED':
        return this.handleAgentCompleted();
    }
    return { type: 'NOOP' };
  }

  private handleWaitingAsync(event: SessionEvent): SessionAction {
    switch (event.type) {
      case 'USER_MESSAGE':
        // waiting_async 态：开始新对话，清除 pending async task suffix
        this.context.pendingMessages = [event.message];
        this.transitionTo('executing');
        return { type: 'RUN_AGENT', message: event.message, clearAsyncSuffix: true };
      case 'ASYNC_TASK_COMPLETED':
        // 异步任务完成，自动触发汇总
        this.transitionTo('executing');
        return { type: 'RUN_AUTO_SUMMARIZE', subAgentId: event.subAgentId, result: event.result };
      case 'AGENT_COMPLETED':
        this.context.pendingMessages = []; // AgentLoop 清理完排队后空闲
        this.transitionTo('idle');
        return { type: 'NOOP' };
    }
    return { type: 'NOOP' };
  }

  private handleAgentCompleted(): SessionAction {
    if (this.context.pendingMessages.length > 0) {
      // 有排队消息，继续运行
      const combined = [...this.context.pendingMessages];
      this.context.pendingMessages = [];
      this.transitionTo('executing');
      return { type: 'RUN_AGENT', message: combined.join('\n') };
    }
    if (this.context.hasPendingAsyncTasks) {
      this.transitionTo('waiting_async');
      return { type: 'NOOP' };
    }
    this.transitionTo('idle');
    return { type: 'EMIT_SESSION_IDLE' };
  }
}

// AgentLoop 需要的可注入查询接口
export interface InterruptChecker {
  shouldStop(): boolean;
  shouldAbort(): boolean;
}
```

**关键改进**：
- 原来 `handleUserInput` / `interrupt` / `appendMessage` 三个入口统一为一个 `transition(event)` 方法
- 原来 `drainPendingQueue` 的轮询和 `\n` join 逻辑被 `handleAgentCompleted` 中的一次检查取代
- `executing` 和 `outputting` 的「新消息入队 vs 打断」语义由状态机明确定义
- `interrupt()` 的 50ms 轮询被消除：结果由 `AGENT_COMPLETED` 事件驱动

---

### 步骤 2：改造 ChatSession

**文件**: `src/core/chat/ChatSession.ts`

#### 2.1 简化方法签名

```typescript
// 改造前：3 个独立入口
handleUserInput(input: string): string
interrupt(input: string): void
appendMessage(message: string): void
run(input: string): Promise<void>

// 改造后：1 个统一入口
userAction(action: UserAction): Promise<ActionResult>
run(input: string): Promise<void> // 内部方法，仅 SessionStateMachine 驱动调用
```

`UserAction` 定义：
```typescript
type UserAction = 
  | { type: 'SEND_MESSAGE'; content: string }
  | { type: 'INTERRUPT'; message?: string };
```

#### 2.2 改造 ChatSession 类

```typescript
export class ChatSession {
  private stateMachine: SessionStateMachine;
  private agentLoop: AgentLoop;
  // 移除: _pendingQueue, interrupt 轮询逻辑
  // 保留: contextManager, toolGateway

  async userAction(action: UserAction): Promise<ActionResult> {
    // 1. 如果 action 是 SEND_MESSAGE，先发送 intent-route 事件
    if (action.type === 'SEND_MESSAGE') {
      const route = await this.intentRouter.route(action.content);
      this.setCurrentAgent(route.agentId);
      this.emitIntentRoute(route);
    }

    // 2. 转换为状态机事件
    const event: SessionEvent = action.type === 'SEND_MESSAGE'
      ? { type: 'USER_MESSAGE', message: action.content }
      : { type: 'USER_INTERRUPT', message: action.message };

    // 3. 通过状态机决定行为
    const sessionAction = this.stateMachine.transition(event);

    // 4. 执行状态机返回的 action
    switch (sessionAction.type) {
      case 'RUN_AGENT':
        await this.run(sessionAction.message, { clearAsyncSuffix: sessionAction.clearAsyncSuffix });
        break;
      case 'ABORT_AGENT':
        this.agentLoop.requestAbort();
        // 不需要再轮询 — AgentLoop 完成后自然会触发 AGENT_COMPLETED 事件
        break;
      case 'EMIT_SESSION_IDLE':
        this.emitConversationState('idle');
        break;
      case 'RUN_AUTO_SUMMARIZE':
        await this.autoSummarizeTask(sessionAction.subAgentId, sessionAction.result);
        break;
      case 'NOOP':
        break;
    }

    return { success: true, state: this.stateMachine.state };
  }

  async run(input: string, options?: RunOptions): Promise<void> {
    if (this.agentLoop.running) {
      // AgentLoop 的 reentrancy guard 保留，因为 SessionStateMachine
      // 已经保证了不会在 running 时调用 run()，这里仅做安全断言
      throw new Error('AgentLoop is already running');
    }

    if (options?.clearAsyncSuffix) {
      this.contextManager.removeSystemPromptSuffix('async-task-completion');
    }

    await this.agentLoop.run(input);
    // AgentLoop.run() 完成后，callback 中会调用
    // stateMachine.transition({ type: 'AGENT_COMPLETED' })
    // 并根据返回值决定是否发射 CONVERSATION_STATE_CHANGED
  }

  // 注册 AgentLoop 回调（在构造函数中完成）
  private setupAgentLoopCallbacks(): void {
    this.agentLoop.on({
      onStart: () => {
        this.stateMachine.transition({ type: 'AGENT_STARTED' });
      },
      onTextStart: () => {
        this.stateMachine.transition({ type: 'AGENT_TEXT_STARTED' });
      },
      onEnd: () => {
        const action = this.stateMachine.transition({ type: 'AGENT_COMPLETED' });
        this.executeSessionAction(action); // 如果需要继续 run 则递归调用
      },
    });
  }
}
```

**关键变化**：
1. 消除 `_pendingQueue` — 由 SessionStateMachine 管理
2. 消除 `interrupt()` 的 50ms 轮询 — onEnd 回调触发状态机
3. 消除三重 reentrancy guard — 状态机保证单一路径
4. `handleUserInput` / `interrupt` / `appendMessage` 合并为 `userAction`

---

### 步骤 3：提取 EventForwarder

**新文件**: `src/core/event/EventForwarder.ts`

将 agent-bridge.ts 中 `registerHookEventBridge()` 的 400+ 行 EventBus → IPC 映射提取到独立模块：

```typescript
export class EventForwarder {
  private eventBus: EventBus;
  private safeSend: (msg: any) => void;
  private getAgentMapping: (payload: any) => string;

  constructor(deps: {
    eventBus: EventBus;
    safeSend: (msg: any) => void;
    getAgentMapping: (payload: any) => string; // 子 agent → parent agent 映射
  }) {
    this.eventBus = deps.eventBus;
    this.safeSend = deps.safeSend;
    this.getAgentMapping = deps.getAgentMapping;
  }

  register(): void {
    // 统一的事件→IPC 映射表
    const mappings: EventMapping[] = [
      // Session 级事件
      { event: XuanjiEvent.AGENT_STARTED,       channel: 'agent:started',       map: this.mapSession },
      { event: XuanjiEvent.AGENT_COMPLETED,      channel: 'agent:completed',     map: this.mapSession },
      { event: XuanjiEvent.CONVERSATION_STATE_CHANGED, channel: 'agent:conversation-state', map: p => p },
      
      // Agent 生命周期事件
      { event: XuanjiEvent.HOOK_SUBAGENT_START,  channel: 'agent:subagent-start',  map: this.mapAgent },
      { event: XuanjiEvent.HOOK_SUBAGENT_END,    channel: 'agent:subagent-end',    map: this.mapAgent },
      
      // Thinking 事件（合并 thinking 和 thinking-start）
      { event: XuanjiEvent.AGENT_THINKING_DELTA, channel: 'agent:thinking',        map: this.mapThinking },
      
      // Text 事件
      { event: XuanjiEvent.AGENT_TEXT_DELTA,     channel: 'agent:text',            map: this.mapAgent },
      
      // Tool 事件
      { event: XuanjiEvent.AGENT_TOOL_START,     channel: 'agent:tool-start',      map: this.mapAgent },
      { event: XuanjiEvent.AGENT_TOOL_END,       channel: 'agent:tool-end',        map: this.mapAgent },
      
      // Task 事件
      { event: XuanjiEvent.ASYNC_TASK_STARTED,   channel: 'agent:async-task-started',  map: this.mapTask },
      { event: XuanjiEvent.ASYNC_TASK_COMPLETED, channel: 'agent:async-task-completed', map: this.mapTask },
      { event: XuanjiEvent.ASYNC_TASK_FAILED,    channel: 'agent:task-failed',         map: this.mapTask },
      
      // Team 事件
      { event: XuanjiEvent.HOOK_TEAM_START,        channel: 'agent:team-start',        map: this.mapTeam },
      { event: XuanjiEvent.HOOK_TEAM_MEMBER_START, channel: 'agent:team-member-start', map: this.mapTeamMember },
      { event: XuanjiEvent.HOOK_TEAM_MEMBER_END,   channel: 'agent:team-member-end',   map: this.mapTeamMember },
      { event: XuanjiEvent.HOOK_TEAM_END,          channel: 'agent:team-end',          map: this.mapTeam },
      
      // Auto-summarize
      { event: XuanjiEvent.AUTO_SUMMARIZE_START, channel: 'agent:auto-summarize-start', map: this.mapTask },
      
      // Citation
      { event: XuanjiEvent.AGENT_CITATION, channel: 'agent:citation', map: this.mapSession },
    ];

    for (const { event, channel, map } of mappings) {
      this.eventBus.on(event, (payload) => {
        const data = map(payload);
        this.safeSend({ type: channel, data });
      });
    }
  }

  // 映射函数：统一 agentId 路由逻辑
  private mapAgent = (payload: any) => ({
    ...payload,
    parentAgentId: this.getAgentMapping(payload.agentId),
  });

  private mapThinking = (payload: any) => ({
    ...payload,
    parentAgentId: this.getAgentMapping(payload.agentId),
    // 不再区分 thinking 和 thinking-start，前端状态机处理所有 thinking
  });

  private mapTeam = (payload: any) => ({
    ...payload,
    // type 字段直接标识 team 类型，不再用前缀 hack
    taskType: 'team',
  });

  private mapTask = (payload: any) => ({
    ...payload,
    taskType: 'task',
  });

  private mapTeamMember = (payload: any) => ({
    ...payload,
    taskType: 'team-member',
    teamName: payload.teamName, // 直接传 teamName，不依赖正则提取
  });

  private mapSession = (payload: any) => payload;
}
```

**关键改进**：
- 所有 EventBus → IPC 映射集中在一个地方，统一修改
- 消除 `team-exec-` 前缀 hack，改用 `taskType` 字段
- 消除 `metadata.taskAsync` 的判断，改用 `ASYNC_TASK_STARTED` 独立事件
- 合并 `agent:thinking` 和 `agent:thinking-start` — 前端状态机处理所有 thinking

---

### 步骤 4：改造 agent-bridge.ts

agent-bridge.ts 从 1896 行缩减到 ~400 行：

```typescript
// agent-bridge.ts 改造后的结构

// 1. Channel 初始化（保留）
// 2. IPC handler 注册（简化）

channel.handle('user-action', async (data: UserActionIPC) => {
  return await session.userAction(data.action);
  // 统一入口，替代原来的 handleSendMessage / handleInterrupt / handleAppendMessage
});

// 3. EventForwarder 初始化（替代 registerHookEventBridge）
const eventForwarder = new EventForwarder({
  eventBus,
  safeSend: (msg) => channel.send('event', msg),
  getAgentMapping: (subAgentId) => session.getParentAgentId(subAgentId),
});
eventForwarder.register();

// 4. 移除：IntentRouter 的空壳调用（保留但不作为路由组件）
// 5. 移除：_pendingQueue 管理
// 6. 移除：interrupt 的 50ms 轮询
```

**IPC 协议变更**（向后兼容方案见步骤 6）：

```
// 改造前（3 条 IPC 通道）
'agent:send-message'    → request-response, 120s timeout
'agent:interrupt'       → fire-and-forget
'agent:send-supplement' → fire-and-forget

// 改造后（1 条 IPC 通道）
'agent:user-action'     → request-response, 120s timeout
// payload: { action: { type: 'SEND_MESSAGE', content } | { type: 'INTERRUPT', message? } }
```

---

### 步骤 5：简化 AgentLoop

**文件**: `src/core/agent/AgentLoop.ts`

#### 5.1 消除 `interruptChecker` 注入

```typescript
// 改造前：StreamPipeline 需要外部注入 interruptChecker
const interruptChecker: InterruptChecker = {
  shouldStop: () => this.checkShouldStop(),
  shouldAbort: () => this.checkShouldAbort(),
};

// 改造后：AgentLoop 内部持有 InterruptChecker
// SessionStateMachine 实现 InterruptChecker 接口，在 onEnd 时处理队列
class AgentLoop {
  private sessionState: InterruptChecker; // 直接注入接口，不再需要两个独立方法

  async run(input: string): Promise<void> {
    this.running = true;
    try {
      let currentInput = input;
      while (this.running && this.iteration < this.maxIterations) {
        // 检查中断
        if (this.sessionState.shouldAbort()) {
          break;
        }

        // StreamPipeline 不再需要外部 interruptChecker
        const response = await this.streamPipeline.execute(currentInput);

        // 检查是否需要在文字输出前中断（补充消息排队）
        if (this.sessionState.shouldStop()) {
          break;
        }

        // 工具执行
        const toolResults = await this.toolGateway.executeBatch(response.toolCalls);
        currentInput = this.buildNextInput(response, toolResults);

        // 上下文压缩
        await this.maybeCompress();
      }
    } finally {
      this.running = false;
      this.callbacks.onEnd?.();
    }
  }
}
```

#### 5.2 消除 `checkShouldStop` 中的复杂判断

```typescript
// 改造前
checkShouldStop(): boolean {
  if (this._abortRequested) { this.running = false; return true; }
  if (!this._hasOutputInThisRun && this._pendingQueue.length > 0) {
    this.running = false;
    return true;
  }
  return false;
}

// 改造后 — 纯委托给状态机
// 移除,因为状态已经由 SessionStateMachine 统一管理
// AgentLoop 只需要知道两个布尔值:
//   - shouldAbort: 是否立即终止（对应 abortRequested）
//   - shouldStop: 是否完成当前 iteration 后停止（对应 pendingQueue 非空 + 未输出文字）
```

---

### 步骤 6：创建 AsyncTaskStateMachine

**新文件**: `src/core/task/AsyncTaskStateMachine.ts`

```typescript
type AsyncTaskEvent =
  | { type: 'TASK_CREATED'; groupId: string; taskType: 'task' | 'team'; subAgentIds: string[] }
  | { type: 'SUBAGENT_STARTED'; subAgentId: string }
  | { type: 'SUBAGENT_ENDED'; subAgentId: string; success: boolean; error?: string }
  | { type: 'TASK_COMPLETED'; groupId: string }
  | { type: 'TASK_FAILED'; groupId: string; error: string }
  | { type: 'SUMMARIZE_STARTED'; groupId: string }
  | { type: 'SUMMARIZE_COMPLETED'; groupId: string }
  | { type: 'TASK_CANCELLED'; groupId: string };

type AsyncTaskState = 
  | 'creating'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'summarizing'
  | 'cleared';

interface AsyncTaskStateMachineConfig {
  onTaskStateChanged: (groupId: string, from: AsyncTaskState, to: AsyncTaskState) => void;
  onTaskLifecycleEvent: (event: AsyncTaskEvent) => void;
}

export class AsyncTaskStateMachine {
  private tasks: Map<string, AsyncTaskContext> = new Map();
  private config: AsyncTaskStateMachineConfig;

  constructor(config: AsyncTaskStateMachineConfig) {
    this.config = config;
  }

  // 前端关心的状态转换事件由 callback 统一发出，替代分散的 subagent-start/end/team-* 事件
  transition(event: AsyncTaskEvent): void {
    this.config.onTaskLifecycleEvent(event);

    switch (event.type) {
      case 'TASK_CREATED':
        this.tasks.set(event.groupId, {
          state: 'creating',
          taskType: event.taskType,
          subAgentIds: event.subAgentIds,
          memberStates: new Map(),
        });
        break;

      case 'SUBAGENT_STARTED':
        // ... 
        this.updateTaskState(event.subAgentId, 'running');
        break;

      case 'SUBAGENT_ENDED':
        this.updateTaskState(event.subAgentId, event.success ? 'completed' : 'failed');
        if (this.allMembersCompleted(event)) {
          this.transitionTask(event, 'completed');
        }
        break;

      case 'SUMMARIZE_STARTED':
        this.changeTaskState(event.groupId, 'summarizing');
        break;

      case 'TASK_COMPLETED':
      case 'TASK_FAILED':
      case 'TASK_CANCELLED':
        this.changeTaskState(event.groupId, event.type === 'TASK_COMPLETED' ? 'completed' : 
                             event.type === 'TASK_FAILED' ? 'failed' : 'cancelled');
        break;
    }
  }

  private changeTaskState(groupId: string, newState: AsyncTaskState): void {
    const task = this.tasks.get(groupId);
    if (!task) return;
    const oldState = task.state;
    task.state = newState;
    this.config.onTaskStateChanged(groupId, oldState, newState);
  }

  // 查询接口供 TeamManager/TaskTool 使用
  getTaskState(groupId: string): AsyncTaskState | null { ... }
  isTaskRunning(groupId: string): boolean { ... }
}
```

**关键改进**：
- 消除 task 和 team 的前端代码分叉 — 统一的生命周期事件
- `onTaskStateChanged` 回调可以直接映射到 IPC，替代分散的 10+ 个事件

---

### 步骤 7：简化 TaskCompletionHandler

**文件**: `src/core/agent/async/TaskCompletionHandler.ts`

当前 TaskCompletionHandler 的 autoSummarize 逻辑包含 pending 队列管理、竞态处理、suffix 注入。改造后：

```typescript
// 改造后 — 只做三件事
export class TaskCompletionHandler {
  // 1. 接收 TaskOrchestrator 通知
  onTaskCompleted(groupId: string, result: TaskResult): void {
    // 2. 通知 SessionStateMachine（SessionStateMachine.waitingAsync 态处理）
    this.callbacks.onAsyncTaskCompleted(groupId, result);
  }

  // 移除: pendingCompletions 队列 — SessionStateMachine 管理队列
  // 移除: autoSummarize 的递归调用 — 状态机驱动
  // 保留: system prompt suffix 注入 — 但由 SessionStateMachine 在 RUN_AUTO_SUMMARIZE action 时注入
}
```

---

### 步骤 8：统一 TaskOrchestrator 通知

**文件**: `src/core/task/TaskOrchestrator.ts`

```typescript
// 当前 TaskOrchestrator 发送事件:
//   ASYNC_TASK_COMPLETED / ASYNC_TASK_FAILED / HOOK_SUBAGENT_START / HOOK_SUBAGENT_END
// 改造后 — 统一为 AsyncTaskStateMachine 事件:
this.asyncTaskStateMachine.transition({ type: 'TASK_CREATED', ... });
this.asyncTaskStateMachine.transition({ type: 'SUBAGENT_STARTED', ... });
// ...
```

---

## 三、向后兼容迁移策略

改造不能一蹴而就，需要逐步迁移。

### Phase 1：新增模块（不影响现有代码）

```
Week 1: src/core/state/SessionStateMachine.ts (新建，与现有 StateTracker + ChatSession 共存)
Week 1: src/core/event/EventForwarder.ts (新建，agent-bridge.ts 保留旧映射)
Week 2: src/core/task/AsyncTaskStateMachine.ts (新建，与现有事件并行)
```

### Phase 2：ChatSession 渐进替换

```
Week 2-3: ChatSession 内部引入 SessionStateMachine（与旧逻辑并行，feature flag 控制）
Week 3: 依次切换每条 IPC 通道到新 userAction 入口
Week 3: 前端同步迁移完成后，移除旧 IPC handler
```

### Phase 3：清理

```
Week 4: 删除 ChatSession 中的 _pendingQueue / 50ms 轮询 / 三重 guard
Week 4: 删除 agent-bridge.ts 中的 registerHookEventBridge
Week 4: 删除 StateTracker（功能被 SessionStateMachine 替代）
```

### Feature Flag

```typescript
// ChatSession 中
if (process.env.USE_SESSION_STATE_MACHINE === 'true') {
  const action = this.stateMachine.transition(event);
  // 新逻辑
} else {
  // 旧逻辑
  switch (this.stateTracker.getState()) { ... }
}
```

---

## 四、改造影响评估

| 文件 | 改造前行数 | 改造后行数 | 复杂度变化 | 关键变更 |
|------|-----------|-----------|-----------|----------|
| agent-bridge.ts | 1896 | ~400 | 大幅降低 | 3 handler → 1 handler；EventForwarder 接管 EventBus 映射 |
| ChatSession.ts | 270 | ~200 | 逻辑简化 | 消除 `_pendingQueue` / `_drainRunning` / 50ms 轮询 / setPendingQueue 引用注入 |
| AgentLoop.ts | ~350 | ~280 | 移除 `setPendingQueue` | 改由 InterruptChecker 接口查询，不再持有队列引用 |
| TaskCompletionHandler.ts | ~200 | ~80 | 移除队列逻辑 | 逐条消费保留，autoSummarize 由状态机驱动 |
| AgentFactory.ts | ~300 | ~250 | ACP onEvent 转发集中化 | forwardAcpEventToEventBus 统一方法 |
| SessionStateMachine.ts | 0 | ~150 | 新增 | 队列唯一所有者 + InterruptChecker 实现者 |
| EventForwarder.ts | 0 | ~180 | 新增 | 完整 XuanjiEvent→IPC 映射表（15+ 事件） |
| AsyncTaskStateMachine.ts | 0 | ~130 | 新增 | 统一 task/team 生命周期 |
| AcpProcessManager.ts | ~250 | ~250 | 不受影响 | |
| HookRegistry.ts | ~300 | ~300 | 不受影响 | |
| StateTracker.ts | ~80 | 删除 | 被 SessionStateMachine 替代 | |

---

### 步骤 9：ACP 子进程通信适配

**背景**：`AcpProcessManager` 通过 `child_process.fork()` 启动 `acp-worker.ts` 在独立进程中运行子 Agent。ACP 子进程的 IPC 通道（`process.send()/process.on('message')`）与主 agent-bridge 的 EnhancedMessageBus 是两套独立的通信基础设施。

**ACP 当前通信模型**：

```
AgentFactory.createAndRun()
  └─ AcpProcessManager.run(agentId, task, options)
       ├─ acquireWorker() → 从进程池获取/创建 worker (child_process.fork)
       ├─ worker.process.send({ type: 'run', requestId, payload: { task, ... } })
       │
       └─ acp-worker.ts (子进程):
            ├─ process.on('message') 接收 { type: 'run' | 'cancel' }
            ├─ handleRun() → AgentLoop.run()
            ├─ sendEvent(requestId, 'thinking' | 'text' | 'tool_start' | 'tool_end')
            └─ sendResult(requestId, { success, output, tokensUsed })
```

**影响分析**：ACP 子进程的 AgentLoop 运行在完全独立的 Node.js 进程中，不经过 ChatSession。因此：
- `SessionStateMachine` 的引入**不影响 ACP 内部**（ACP 子进程内没有 ChatSession）
- `EventForwarder` 需要额外注册 ACP 的回调事件（`onEvent` 回调）来发出 `HOOK_SUBAGENT_START/END` 事件
- 主进程侧的 `AgentFactory` 在 ACP 完成后调用 `TaskCompletionHandler.handleCompletion()`，这个流程不受影响

**需适配的 ACP 事件回调**：

```typescript
// AgentFactory.ts 中调用 ACP 时，onEvent 回调需要转发到 EventForwarder
const acpResult = await acp.run(agentId, task, {
  parentConfig: ...,
  tools: ...,
  onEvent: (event) => {
    // 将 ACP 子进程事件转发到 EventBus，由 EventForwarder 统一发出 IPC
    switch (event.payload.eventType) {
      case 'thinking':
        eventBus.emit(XuanjiEvent.HOOK_SUBAGENT_THINKING, {
          subAgentId, agentId: parentAgentId, content: event.payload.data.content
        });
        break;
      case 'text':
        eventBus.emit(XuanjiEvent.HOOK_SUBAGENT_TEXT, {
          subAgentId, agentId: parentAgentId, text: event.payload.data.text
        });
        break;
      case 'tool_start':
        eventBus.emit(XuanjiEvent.HOOK_SUBAGENT_TOOL_START, {
          subAgentId, agentId: parentAgentId, toolName: event.payload.data.name
        });
        break;
      case 'tool_end':
        eventBus.emit(XuanjiEvent.HOOK_SUBAGENT_TOOL_END, {
          subAgentId, agentId: parentAgentId, toolName: event.payload.data.name
        });
        break;
    }
  },
});
```

**AgentFactory 改造后的 ACP 集成**：

```typescript
// AgentFactory.createAndRun() 改造后
async createAndRun(agentId: string, task: string, options: CreateAndRunOptions): Promise<CreateAndRunResult> {
  // 1. 使用 ACP 进程隔离运行（保持现有逻辑）
  const acpResult = await AcpProcessManager.getInstance().run(agentId, task, {
    userId: options.userId,
    systemPrompt: options.systemPrompt,
    tools: options.tools,
    timeout: options.timeout,
    maxIterations: options.maxIterations,
    workingDir: options.workingDir,
    parentConfig: options.parentConfig,
    onEvent: (event) => {
      // ACP 事件通过 EventBus 统一发出，不再散落在 AgentFactory 中
      this.forwardAcpEventToEventBus(event, agentId, options.parentAgentId);
    },
  });

  // 2. 通知异步任务状态机
  this.asyncTaskStateMachine.transition({
    type: 'SUBAGENT_COMPLETED',
    subAgentId: agentId,
    groupId: options.groupId,
    success: acpResult.success,
  });

  return { result: acpResult.output, ... };
}
```

**ACP 改造要点总结**：

| 方面 | 改造前 | 改造后 | 变化 |
|------|--------|--------|------|
| ACP 进程模型 | child_process.fork + 进程池复用 | **不变** | 进程模型不受影响 |
| ACP 事件转发 | AgentFactory 中手动 emit XuanjiEvent | AgentFactory 调用 `forwardAcpEventToEventBus` 统一方法 | 集中管理 |
| ACP 结果通知 | AgentFactory → TaskCompletionHandler.handleCompletion() | AgentFactory → AsyncTaskStateMachine.transition() → TaskCompletionHandler | 走状态机 |
| 主 Agent IPC | EnhancedMessageBus | EnhancedMessageBus | 不受影响 |
| ACP 子进程内部 | AgentLoop.run() 独立运行 | AgentLoop.run() 独立运行 | 不受影响 |

---

### 步骤 10：EventBus + HookRegistry 合并方案

**当前现状**：

| 系统 | 职责 | 使用者 | 事件类型 |
|------|------|--------|---------|
| **EventBus** (`src/core/events/EventBus`) | 核心事件总线，发射 XuanjiEvent | AgentLoop、TaskOrchestrator、AgentFactory、agent-bridge | AGENT_STARTED、AGENT_TEXT_DELTA、HOOK_SUBAGENT_START 等 40+ 事件 |
| **HookRegistry** (`src/hooks/HookRegistry`) | Hook 配置加载 + Handler 分发（command/prompt/agent 三种类型） | team/子Agent 的 PreToolUse/PostToolUse 拦截 | PreToolUse、PostToolUse、PostToolUseFailure 等工具级事件 |

**两者关系**：HookRegistry 拦截的是**工具执行前/后**的细粒度事件（决定是否允许执行、是否注入 prompt），EventBus 发射的是**生命周期级**的粗粒度事件（供 IPC 转发到渲染进程）。两个系统**不重叠**，HookRegistry 的结果通过 EventBus 的 `HOOK_*` 事件间接通知前端。

**改造方案 — 不需要合并，需要明确边界**：

```
HookRegistry（工具级拦截）
  ├─ PreToolUse → 决定是否阻止工具执行
  ├─ PostToolUse → 工具执行后的后置处理（prompt 注入）
  └─ 结果通过 EventBus.HOOK_* 事件通知前端

EventBus（生命周期级通知）
  ├─ AGENT_* / SESSION_* 等粗粒度事件
  ├─ HOOK_* 事件（HookRegistry 结果的传递通道）
  └─ 全部由 EventForwarder 统一转发到 IPC
```

**EventForwarder 改造**：需要同时注册两类事件监听：

```typescript
// EventForwarder — 同时监听 EventBus 事件和 HookRegistry 产出的 HOOK 事件
export class EventForwarder {
  register(): void {
    // 1. Agent 生命周期事件（EventBus 直接发出）
    this.registerAgentEvents();
    // 2. Hook 相关事件（HookRegistry 处理后通过 EventBus 发出）
    this.registerHookEvents();
    // 3. AsyncTask 事件（AsyncTaskStateMachine 发出）
    this.registerAsyncTaskEvents();
  }

  private registerHookEvents(): void {
    // HookRegistry 结果事件 → 前端 AgentStateMachine 消费
    this.eventBus.on(XuanjiEvent.HOOK_SUBAGENT_START, (p) => {
      this.safeSend({ type: 'agent:subagent-start', data: this.mapAgent(p) });
    });
    this.eventBus.on(XuanjiEvent.HOOK_TEAM_START, (p) => {
      this.safeSend({ type: 'agent:team-start', data: this.mapTeam(p) });
    });
    // ... 其他 HOOK 事件
  }
}
```

**关键结论**：EventBus 和 HookRegistry 不需要合并。HookRegistry 是工具拦截层，EventBus 是事件分发层，分工明确。EventForwarder 同时监听两者产出的 EventBus 事件即可。

---

### 步骤 11：Handoff 系统影响分析

**当前 handoff 机制**：

```
TaskCompletionHandler.autoSummarize()
  └─ 写入 .xuanji/handoff/{strategyName}.json
       └─ { strategyName, groupId, status: 'completed', timestamp }

L3 Prompt 构建 (l3-project.ts)
  └─ 读取 .xuanji/handoff/*.json
       └─ 注入到 system prompt 作为 "Previous Strategy History"
```

**改造影响分析**：

| 改造项 | 对 handoff 的影响 | 风险等级 |
|--------|------------------|---------|
| TaskCompletionHandler 简化为调用 SessionStateMachine | handoff 写入逻辑**不受影响** — 文件 I/O 是独立操作，不依赖 ChatSession | 低 |
| autoSummarize 改为状态机驱动 | handoff 写入在 `autoSummarize` 内部，`autoSummarize` 的调用时机可能变化但写入逻辑不变 | 低 |
| ChatSession.userAction 统一入口 | 不影响 handoff 读取（读取发生在 L3 prompt 构建阶段，独立于消息处理） | 无 |
| SessionStateMachine.waiting_async 状态 | handoff 写入发生在 autoSummarize **之前**（sub-agent 完成时），不依赖 SessionStateMachine | 无 |

**无需改动**。Handoff 系统的读写流程与 SessionStateMachine / EventForwarder / AsyncTaskStateMachine 均无耦合。迁移后保持现有逻辑不变。

---

### 步骤 12：TaskCompletionHandler 逐条消费机制（已实现，归档说明）

**现状**（已在当前代码中实现）：
`TaskCompletionHandler.autoSummarize()` 已改为一次只 `shift()` 一个 completion 逐个处理：

```typescript
// 当前代码中的逐条消费逻辑 (TaskCompletionHandler.ts:140)
private async autoSummarize(): Promise<void> {
  const completion = this.pendingCompletions.shift();  // 每次只取一个
  if (!completion) return;
  
  // 处理完成后，如果还有 pending 则递归调用
  if (this.pendingCompletions.length > 0) {
    this.autoSummarize().catch(...);
  }
}
```

**改造后对齐**：此逻辑在重构中保持不变。`SessionStateMachine` 的`waiting_async` 态会自然串行化 autoSummarize 的触发——每次 `RUN_AUTO_SUMMARIZE` action 完成后 AgentLoop 回到 idle，`handleAgentCompleted` 检查 `hasPendingAsyncTasks` 决定是否再次触发。这与当前逐条 `shift()` 的行为完全一致。

---

### 步骤 13：消除 `_pendingQueue` 的引用注入

**当前问题**：`ChatSession._pendingQueue` 是一个数组，通过 `agentLoop.setPendingQueue(this._pendingQueue)` 直接传给 AgentLoop。两个对象持有**同一个引用**，各自读写：

```typescript
// ChatSession.ts:66 — 引用注入
agentLoop.setPendingQueue(this._pendingQueue);

// AgentLoop.ts:110 — AgentLoop 直接读取
if (!this._hasOutputInThisRun && this._pendingQueue !== null && this._pendingQueue.length > 0) {
  // 思考阶段打断
}

// ChatSession.ts:248 — ChatSession 同时写入
this._pendingQueue.unshift(input);
```

这违反了单一职责——消息队列的所有权不明确，两个对象都能修改。

**改造方案**：SessionStateMachine 成为队列的唯一所有者：

```typescript
// 改造后 — AgentLoop 不再持有队列引用
class AgentLoop {
  private interruptChecker: InterruptChecker; // 仅接口，不持有引用
  
  async run(input: string): Promise<void> {
    while (this.running) {
      // 通过接口查询，不直接读队列
      if (this.interruptChecker.shouldStop()) break;
      if (this.interruptChecker.shouldAbort()) break;
      // ...
    }
  }
}

// SessionStateMachine 实现 InterruptChecker
class SessionStateMachine implements InterruptChecker {
  pendingMessages: string[] = []; // 唯一所有者

  shouldStop(): boolean {
    return !this.isTextOutputStarted && this.pendingMessages.length > 0;
  }

  shouldAbort(): boolean {
    return this.abortRequested;
  }
}
```

**中间态共存策略**（Week 2-3 feature flag 期间）：

```typescript
// ChatSession 中 feature flag 控制
if (useSessionStateMachine) {
  // 新路径：AgentLoop 通过 InterruptChecker 接口查询
  agentLoop.setInterruptChecker(sessionStateMachine);
} else {
  // 旧路径：AgentLoop 通过 setPendingQueue 引用注入
  agentLoop.setPendingQueue(this._pendingQueue);
}
```

切换时机：前端迁移完成 + `USE_SESSION_STATE_MACHINE` flag 全开后，删除 `setPendingQueue` 方法和 `_pendingQueue` 字段。

---

### 步骤 14：消除 `_drainRunning` guard

**当前问题**：`ChatSession._drainRunning` 是第 4 层 reentrancy guard（line 37），防止 `drainPendingQueue()` 重入：

```typescript
private _drainRunning = false;

drainPendingQueue(): void {
  if (this._pendingQueue.length === 0) return;
  if (this._drainRunning) return; // <== 第 4 层 guard
  this._drainRunning = true;
  // ...
}
```

与前三层 guard（AgentLoop.running、ChatSession.run、handleUserInput）相比，`_drainRunning` 的触发场景更窄：仅在 AgentLoop.onEnd 回调中 `drainPendingQueue` → `run()` 期间，如果再次触发 onEnd（异常情况），防止递归。

**改造后**：`SessionStateMachine.handleAgentCompleted()` 中消费队列的逻辑本身就是幂等的（消费后立即清空 `pendingMessages`），不会重入。`_drainRunning` 随旧 drainPendingQueue 一起删除。

---

### 步骤 15：EventForwarder XuanjiEvent 完整映射表

文档中的 EventForwarder 映射表使用了简化的事件名（如 `AGENT_STARTED`），实际代码中 XuanjiEvent 使用 dot-separated 命名。以下是完整映射：

```typescript
// EventForwarder 完整映射表 — 与 src/core/events/events.ts 对齐

export const EVENT_IPC_MAPPINGS: EventMapping[] = [
  // ── Session 级事件 ──
  { event: XuanjiEvent.CONVERSATION_STATE_CHANGED, channel: 'agent:conversation-state', map: 'passthrough' },
  { event: XuanjiEvent.AGENT_STARTED,               channel: 'agent:started',          map: 'passthrough' },
  { event: XuanjiEvent.AGENT_COMPLETED,              channel: 'agent:completed',        map: 'passthrough' },
  { event: XuanjiEvent.AGENT_ERROR,                  channel: 'agent:error',            map: 'passthrough' },

  // ── Agent 文本/思考事件 ──
  { event: XuanjiEvent.AGENT_TEXT_DELTA,             channel: 'agent:text',             map: 'agent' },
  { event: XuanjiEvent.AGENT_THINKING_DELTA,          channel: 'agent:thinking',         map: 'agent' },

  // ── Agent 工具事件 ──
  { event: XuanjiEvent.AGENT_TOOL_START,             channel: 'agent:tool-start',       map: 'agent' },
  { event: XuanjiEvent.AGENT_TOOL_DELTA,             channel: 'agent:tool-delta',       map: 'agent' },
  { event: XuanjiEvent.AGENT_TOOL_END,               channel: 'agent:tool-end',         map: 'agent' },

  // ── 异步任务事件 ──
  { event: XuanjiEvent.ASYNC_TASK_STARTED,           channel: 'agent:async-task-update', map: 'asyncTask' },
  { event: XuanjiEvent.ASYNC_TASK_PROGRESS,          channel: 'agent:async-task-update', map: 'asyncTask' },
  { event: XuanjiEvent.ASYNC_TASK_COMPLETED,         channel: 'agent:async-task-update', map: 'asyncTask' },
  { event: XuanjiEvent.ASYNC_TASK_FAILED,            channel: 'agent:task-failed',       map: 'asyncTask' },

  // ── Hook 桥接事件 (HookRegistry → EventBus → IPC) ──
  { event: XuanjiEvent.HOOK_SUBAGENT_START,          channel: 'agent:subagent-start',     map: 'agent' },
  { event: XuanjiEvent.HOOK_SUBAGENT_END,            channel: 'agent:subagent-end',       map: 'agent' },
  { event: XuanjiEvent.HOOK_SUBAGENT_TEXT,           channel: 'agent:subagent-text',      map: 'agent' },
  { event: XuanjiEvent.HOOK_TEAM_START,              channel: 'agent:team-start',         map: 'team' },
  { event: XuanjiEvent.HOOK_TEAM_END,                channel: 'agent:team-end',           map: 'team' },
  { event: XuanjiEvent.HOOK_TEAM_MEMBER_START,       channel: 'agent:team-member-start',  map: 'teamMember' },
  { event: XuanjiEvent.HOOK_TEAM_MEMBER_END,         channel: 'agent:team-member-end',    map: 'teamMember' },

  // ── Citation ──
  { event: XuanjiEvent.AGENT_FILE_CHANGES,           channel: 'agent:citation',           map: 'passthrough' },

  // ── Workspace Monitor ──（保留用于 ExecutionFlow 实时更新）
  { event: XuanjiEvent.WORKSPACE_NODE_UPDATED,       channel: 'agent:workspace-update',   map: 'passthrough' },
];

// map 字段含义:
//   'passthrough' — 原样转发 payload
//   'agent'       — 调用 mapAgent(payload) 附加 parentAgentId
//   'team'        — 调用 mapTeam(payload) 附加 taskType: 'team'
//   'teamMember'  — 调用 mapTeamMember(payload) 附加 teamName
//   'asyncTask'   — 调用 mapAsyncTask(payload) 附加 taskType + groupId
```

---

### 步骤 16：非核心 IPC 通道（Agent CRUD 等）不受影响

经代码交叉验证，以下 IPC 方法与 `agent:user-action` 改造**无关**，保持不变：

| IPC 方法 | 用途 | 是否受影响 |
|----------|------|-----------|
| `agent:init` | 初始化会话 | 否 — 调用链不变 |
| `agent:list` / `agent:create` / `agent:update` / `agent:delete` | Agent CRUD | 否 — 通过 `window.electron.agentList()` 等独立通道 |
| `agent:settings:*` | 设置管理 | 否 |
| `agent:tools:*` | 工具管理 | 否 |
| `agent:logs:*` | 日志管理 | 否 |
| `agent:download:*` | 下载管理 | 否 |

**preload.ts 改造结论**：仅需新增 `agentUserAction` 方法，其余所有 `window.electron.*` 方法签名不变。Phase 5 清理时删除 `agentInterrupt`、`agentSendSupplment` 两个方法。

---

## 五、改造影响评估（更新后）
