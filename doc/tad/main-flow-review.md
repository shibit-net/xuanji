# 主流程 Review：用户输入 → Agent 执行 + 补充消息机制

## 一、完整调用链路

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           Renderer Process                               │
│                                                                          │
│  InputArea.tsx                                                           │
│  ├─ handleSubmit() → messageStore.sendMessage(content)                   │
│  │   ├─ 判断 convState:                                                 │
│  │   │   ├─ idle/waiting_async → agentSendMessage(content)  (IPC request-response)
│  │   │   ├─ executing           → agentInterrupt(content)   (IPC fire-and-forget)
│  │   │   └─ outputting         → agentSendSupplment(content) (IPC fire-and-forget)
│  │   └─ 错误处理: 三次相同的 errorMessage 构建代码                         │
│  │                                                                       │
│  handleStop() → agentInterrupt()  (无参数，纯停止)                        │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ IPC (invoke/send)
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        Main Process (agent.ts)                           │
│                                                                          │
│  ipcMain.handle('agent:send-message')  → sendRequest('send-message')    │
│      request-response 模式，120s 超时                                    │
│                                                                          │
│  ipcMain.handle('agent:interrupt')     → agentProcess.send({type:'interrupt'})│
│   └─ 预检查: isSessionReady() → getAgentProcess() → 均 fire-and-forget  │
│                                                                          │
│  ipcMain.handle('agent:send-supplement') → agentProcess.send({type:'supplement'})│
│   └─ 同上 fire-and-forget                                               │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │ EnhancedMessageBus
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                       Child Process (agent-bridge.ts)                    │
│                                                                          │
│  channel.handle('send-message') → handleSendMessage(data)               │
│    ├─ IntentRouter.route(message) → 当前固定返回 'xuanji'                │
│    ├─ session.setCurrentAgent(route.agentId)                            │
│    ├─ channel.send('agent:intent-route', ...)                           │
│    └─ session.handleUserInput(message) ──┐                              │
│                                           │                              │
│  channel.handle('interrupt') → handleInterrupt(data)                     │
│    └─ session.interrupt(msg) ─────────────┤                              │
│                                           │                              │
│  channel.handle('supplement') → handleAppendMessage(data)                │
│    └─ session.appendMessage(message) ─────┤                              │
│                                           ▼                              │
│                              ChatSession                                 │
│                               │                                          │
│                    handleUserInput(input)                                │
│                      │                                                   │
│              StateTracker.getState()                                     │
│                │         │         │                                     │
│           idle/     executing/   default                                 │
│        waiting_async outputting                                         │
│                │         │         │                                     │
│                ▼         ▼         ▼                                     │
│           run(input)  appendMessage  run(input)                          │
│                        (入队)                                            │
│                                                                          │
│  interrupt(input)                                                        │
│    ├─ !input.trim() → hardStop() (kill LLM流 + 终止工具)                 │
│    └─ input.trim()  → pendingQueue.unshift(input)                       │
│                     → requestAbort() (软中断)                            │
│                     → waitAndDrain() (轮询 idle → drainPendingQueue)     │
└──────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                            AgentLoop.run()                               │
│                                                                          │
│  while (running && iteration < max):                                    │
│    │                                                                     │
│    ├─ LLM 调用 (StreamPipeline.execute)                                  │
│    │   └─ interruptChecker 每次 iteration 检查:                          │
│    │       abortRequested || (!hasOutput && pendingQueue.length > 0)     │
│    │                                                                     │
│    ├─ 检查点 A (流式输出结束) → checkShouldStop()                        │
│    │                                                                     │
│    ├─ 工具执行 (ToolGateway.executeBatch)                                │
│    │                                                                     │
│    ├─ 检查点 B (工具执行结束) → checkShouldStop()                        │
│    │                                                                     │
│    └─ 卡住检测 + 上下文压缩                                              │
│                                                                          │
│  checkShouldStop():                                                      │
│    ├─ _abortRequested → running=false, 返回 true                         │
│    └─ !_hasOutputInThisRun && pendingQueue.length > 0 → running=false    │
│       (仅在整个 run() 未输出过文字时生效 — 思考阶段打断)                  │
└──────────────────────────────────────────────────────────────────────────┘
                                   │
                          EventBus / IPC
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    EventBridge.ts → messageStore                         │
│                                                                          │
│  conversation-state → _conversationState + status                        │
│  text → _handleAgentText (流式文本气泡)                                   │
│  thinking → _handleAgentThinking (思考状态)                               │
│  tool-start → _handleAgentToolStart                                      │
│  tool-end → _handleAgentToolEnd                                          │
│  end → _handleAgentEnd (收尾气泡 + 状态复位)                             │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 二、核心问题

### 问题 1：同一个语义触发三条不同的 IPC 通道

用户发送消息 → 前端根据 `_conversationState` 选择三条 IPC 通道：

| convState | 前端调用 | IPC handler | 子进程处理 | 机制 |
|-----------|---------|-------------|-----------|------|
| idle | `agentSendMessage` | `agent:send-message` (request-response) | `handleUserInput` → state machine → `run()` | 同步等响应 |
| executing | `agentInterrupt` | `agent:interrupt` (fire-and-forget) | `session.interrupt` → stop + queue | 不等待 |
| outputting | `agentSendSupplment` | `agent:send-supplement` (fire-and-forget) | `session.appendMessage` → 仅 push queue | 不等待 |

**问题**：
- `agent:interrupt` 和 `agent:send-supplement` 都是 fire-and-forget，渲染进程无法知道操作是否真正成功
- 三条通道最终都归结到 `ChatSession` 的 `_pendingQueue`，但入口方法不同（`handleUserInput` vs `interrupt` vs `appendMessage`），行为语义也不同
- 如果前端状态和后端状态不同步（例如 IPC 延迟导致 `_conversationState` 仍是 'executing' 但后端已是 'idle'），前端会走 interrupt 通道，但 `session.interrupt()` 会调用 `hardStop()` → `agentLoop.stop()` → `running = false` — 实际上后面没有任何 run 了，interrupt 的排队消息也不会被消费

**正确做法**：前端始终走一条通道 `sendMessage`，后端 `ChatSession.handleUserInput()` 自身做状态路由。当前 `handleUserInput` 中的 `executing/outputting` 分支已经做了 `appendMessage`，前端不需要自己区分。

前端 `sendMessage` 中的 `isExecuting → agentInterrupt(content)` 和 `isOutputting → agentSendSupplment(content)` 分支应该被消除，改为始终调用 `agentSendMessage(content)`。

---

### 问题 2：`sendMessage` 中错误处理代码重复三次

messageStore.ts:434-479 三段完全相同的错误处理：

```typescript
// executing 分支 (line 438-449)
if (!result.success) {
  const errorMessage = { id, role: 'assistant', content: `❌ 错误：...`, ... };
  useRuntimeStore.getState().setProcessing(false);
  set(state => ({ messages: trimMessages([...state.messages, errorMessage]), status: 'idle' }));
}

// idle 分支 (line 453-465) — 完全相同的代码
// catch 分支 (line 467-479) — 完全相同的代码
```

三段代码做完全相同的事：构建 error message → setProcessing(false) → 添加 message → set status idle。应提取为内部方法。

---

### 问题 3：`AgentLoop.run()` 的 reentrancy guard 与 `ChatSession.run()` 的双重检查

**AgentLoop.run()** (line 175-178)：
```typescript
if (this.running) {
  this.log.warn('run() called while already running, ignoring');
  return;
}
```

**ChatSession.run()** (line 75-80)：
```typescript
if (this.agentLoop.getState().status !== 'idle') {
  log.warn('run() called while AgentLoop is still running, queuing instead');
  this._pendingQueue.push(input);
  return;
}
```

**ChatSession.handleUserInput()** (line 152-155)：
```typescript
if (this.agentLoop.getState().status !== 'idle') {
  log.warn(`StateTracker=${state} but AgentLoop is still running, queuing`);
  this.appendMessage(input);
  return 'queued';
}
```

三个层级的三重 reentrancy 检查，每层的行为不同：
- AgentLoop: silently ignore
- ChatSession.run: queue the message
- ChatSession.handleUserInput: queue the message

且 `handleUserInput` 中 StateTracker 和 AgentLoop 的状态可能不一致（注释说"StateTracker 可能因竞态短暂不一致"），这就是一个防御 hack。

**根因**：StateTracker 的状态转换和 AgentLoop.running 不是原子操作。

---

### 问题 4：`interrupt()` 中的轮询等待是 hack

ChatSession.ts:251-257：
```typescript
const waitAndDrain = () => {
  if (this.agentLoop.getState().status !== 'idle') {
    setTimeout(waitAndDrain, 50);  // 50ms 轮询
    return;
  }
  this.drainPendingQueue();
};
setTimeout(waitAndDrain, 50);
```

用 50ms `setTimeout` 轮询检查 AgentLoop 是否变为 idle 是典型的反模式。应该用 Promise/事件通知机制。

AgentLoop 的 `callbacks.onEnd` 在 finally 块调用（line 434），此时 `running` 已为 false。`interrupt` 应该监听 `onEnd` 回调而非轮询。

---

### 问题 5：补充消息在 outputting 状态下的语义混乱

用户在前端 outputting 状态下发送消息 → `agentSendSupplment(content)` → `handleAppendMessage` → `session.appendMessage(message)` → 仅 push 到 `_pendingQueue`。

在 AgentLoop 中：
- `checkShouldStop()` 仅在 `!_hasOutputInThisRun` 时才会因 pendingQueue 非空而停止
- 但 outputting 状态下 `_hasOutputInThisRun` 已经是 true
- 所以当前流的 text 会继续输出，补充消息将在 run 结束后由 `drainPendingQueue()` 消费

**问题**：这意味着补充消息实际上**退化为排队消息**，等待当前整个 run 结束才能被处理。如果当前 run 需要执行多个工具（多轮 iteration），补充消息可能等很久才生效。这不是"补充"的语义 — 补充应该让 LLM 在当前回复中参考新内容，而不是排队等下一轮。

---

### 问题 6：`agent:conversation-state` 事件到达时前端处理逻辑不完整

EventBridge.ts:113-123：
```typescript
messageBus.on('agent:conversation-state', (data: { from: string; to: string }) => {
  const chatStatus: Record<string, string> = {
    idle: 'idle', executing: 'thinking', outputting: 'thinking', waiting_async: 'idle',
  };
  useMessageStore.setState({ 
    status: (chatStatus[data.to] || 'idle') as any, 
    _conversationState: data.to as any 
  });
  // ...
});
```

`executing` 和 `outputting` 都映射到前端的 `thinking` 状态。这意味着：
- 前端无法区分 "正在思考/执行工具" 和 "正在输出文本"
- 但前端 `sendMessage` 中的分支（executing vs outputting）依赖 `_conversationState` 来区分这两种情况
- 而 `_conversationState` 保留的是后端 StateTracker 的精确值（`executing`/`outputting`）
- 所以 `status` 和 `_conversationState` 是两个重叠但粒度不同的状态

这造成了前端有两个状态变量表达同一个概念，且粒度不同：
- `status` (thinking/idle/executing) → 用于 UI 展示
- `_conversationState` (idle/executing/outputting/waiting_async) → 用于业务逻辑路由

---

### 问题 7：`sendMessage` 中 idle 分支也设置状态，但 `agent:started` 事件又会再设置一次

**sendMessage idle 分支** (messageStore.ts:410-424)：
```typescript
runtimeStore.setProcessing(true);
runtimeStore.incrementIteration();
runtimeStore.resetMessageStream();
runtimeStore.setRunStartTime(Date.now());
runtimeStore.setAgentStatus(...);
// ... startMainAgent or setAgentStatus('thinking')
```

**EventBridge agent:started handler** (EventBridge.ts:64-83)：
```typescript
runtimeStore.setProcessing(true);
runtimeStore.incrementIteration();
runtimeStore.resetMessageStream();
runtimeStore.setRunStartTime(Date.now());
// ... setAgentStatus('thinking') or startMainAgent
```

两段初始化逻辑几乎一模一样，但 `agent:started` 是后端 `AgentLoop.run()` 中 `emitSync(AGENT_STARTED)` 触发的（line 185），而 `sendMessage` 是前端主动设置的。

这意味着 `sendMessage` 中的初始化是**乐观设置**（假设后端会启动），然后 `agent:started` 事件到达时**重复设置**。如果后端实际没有启动（比如 reentrancy guard 触发 queued），则 `sendMessage` 中的乐观设置会让 UI 显示 "思考中" 但实际什么也没发生。

注释 (line 94-95) 承认了这一点：
> 与 sendMessage 闲时逻辑完全一致：重置所有状态 + 启动主 agent

---

### 问题 8：IntentRouter 是空壳，但完整的意图路由流程已被构建

IntentRouter.ts 整个实现：
```typescript
async route(_message: string): Promise<IntentRoute> {
  return { agentId: this.defaultAgentId, confidence: 1.0 };
}
```

但它的调用链路被完整构建：
1. `agent-bridge.handleSendMessage` 中实例化 IntentRouter → route → 设置 currentAgent
2. 发送 `agent:intent-route` IPC 事件到渲染进程
3. EventBridge 中接收并更新 `rootAgentId`

而且 EventBus 中定义了完整的意图分析事件链：
- `HOOK_MODEL_CLASSIFIER_START/END`
- `HOOK_INTENT_ANALYSIS_START/END`
- `HOOK_TASK_PLANNING_START/END`
- `HOOK_TASK_EXECUTION_START/END`
- `HOOK_RESULT_AGGREGATION_START/END`

这些事件都被注册、转发到渲染进程，但后端 IntentRouter 始终返回固定值。

---

### 问题 9：`drainPendingQueue()` 中合并多条消息的语义可疑

ChatSession.ts:197-201：
```typescript
const combined = [next];
while (this._pendingQueue.length > 0) {
  combined.push(this._pendingQueue.shift()!);
}
await this.run(combined.join('\n'));
```

将队列中的所有消息用 `\n` 拼接成一条消息调用 `run()`。这意味着：
- 多条补充消息会被合并成一条巨大的用户输入
- LLM 会同时收到多条指令，可能产生非预期行为
- 如果队列中有来自 `interrupt` 的 unshift 消息和来自 `supplement` 的 append 消息混在一起，顺序可能错乱

---

### 问题 10：主流程中 `AGENT_STARTED` 和 `AGENT_COMPLETED` 的 rootAgentId 映射不一致

在 agent-bridge.ts 的 `registerHookEventBridge()` 中：

```typescript
// AGENT_STARTED (line 967)
eventBus.on(XuanjiEvent.AGENT_STARTED, (payload) => {
  safeSend({ type: 'agent:started', data: { model: payload.model, agentId: routedAgentId } });
});

// AGENT_TEXT_DELTA (line 970)
eventBus.on(XuanjiEvent.AGENT_TEXT_DELTA, (payload) => {
  const agentId = (payload.agentId && payload.agentId !== currentUserId) ? payload.agentId : routedAgentId;
  safeSend({ type: 'agent:text', data: { text: payload.text, agentId } });
});
```

`AGENT_STARTED` 始终使用 `routedAgentId`，而 `AGENT_TEXT_DELTA` 会区分是否是子 agent（`payload.agentId !== currentUserId`）。这种不一致意味着子 agent 的 text 可以正确路由到子 agent，但子 agent 的 started 事件可能映射到错误的 agentId。

实际上子 agent 不会触发 `AGENT_STARTED`（它们通过 `HOOK_SUBAGENT_START` 通知），所以目前这不是 bug。但逻辑不一致容易在未来引入问题。

---

## 三、改进建议

### 优先级 P0 — 统一 IPC 入口

前端 `sendMessage` 始终走 `agentSendMessage` 一条通道。将 `agentInterrupt` 和 `agentSendSupplment` 的区分逻辑移到后端 `ChatSession.handleUserInput()` 中。

```typescript
// 改进后 sendMessage
sendMessage: async (content) => {
  const userMessage = { ... };
  set(state => ({ messages: [...state.messages, userMessage] }));
  
  // 始终走同一条 IPC 通道，后端自己决定行为
  const result = await window.electron.agentSendMessage(content);
  if (!result.success) handleError(result.error);
}
```

后端 `handleUserInput` 已经包含了完整的状态路由，不需要前端绕过它。

### 优先级 P0 — 用 Promise 替代轮询

```typescript
// 改进后 interrupt
interrupt(input: string): void {
  this._pendingQueue.unshift(input);
  this.agentLoop.requestAbort();
  // 用 onEnd 回调替代轮询
  const originalOnEnd = this.agentLoop.callbacks.onEnd;
  this.agentLoop.on({
    onEnd: (state) => {
      originalOnEnd?.(state);
      this.drainPendingQueue();
    }
  });
}
```

### 优先级 P1 — 消除前端 double-init

`sendMessage` 中的乐观状态初始化（setProcessing/incrementIteration/resetMessageStream 等）应归一到 `agent:started` 事件 handler。`sendMessage` 只负责添加用户消息到 UI 列表。

### 优先级 P1 — 补充消息应支持"真正补充"语义

当 agent 在 outputting 状态时，用户的消息应该被注入到 LLM 的上下文并影响当前回复，而不是排队等下一轮。方案：
- 如果当前还在 outputting（文本流输出中），新消息追加到 `pendingQueue` 同时在 system prompt 中注入提示，让 LLM 在当前回复的后续部分回应用户补充
- 或者改为打断当前流式输出（类似 executing 的 interrupt 行为），开始新轮次

### 优先级 P2 — 消除重复的错误处理

提取 `_handleSendError` 方法统一处理 `sendMessage` 的三段错误代码。

### 优先级 P2 — 合并 `status` 和 `_conversationState`

前端只保留一个会话状态变量，从 `_conversationState` (StateTracker 的精确值) 派生 UI 展示状态，而非同时维护两个。
