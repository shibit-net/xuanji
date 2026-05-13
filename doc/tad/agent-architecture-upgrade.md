# Agent 架构升级：动态前台 Agent + 前后台分离 + 意图三要素

## 1. 问题背景

当前架构三个核心缺陷：

### 1.1 `setCurrentAgent()` 是空操作

`ChatSession.setCurrentAgent(agentId)` 仅设置 `_currentAgentId` 变量（ChatSession.ts:162），AgentLoop 的 provider、systemPrompt、tools 全部在 `SessionFactory.create()` 时固定。IntentRouter 路由到 `software-engineer` 也不会改变 AgentLoop 的实际行为。

### 1.2 无前后台区分

主 agent 和 task/team 子 agent 混在同一个 `agentMap` 中，生命周期无区分。`agent:end` 后主 agent 停留在 `writing` 永不清除。

### 1.3 Scene/Complexity 未被 AgentLoop 消费

IntentRouter 返回 `{ agentId, scene, complexity }` 三要素，但 `ChatSession.run()` 完全不使用 scene 和 complexity。`LayeredPromptBuilder.build()` 明确注释："scene 参数被忽略 — 主 agent 不路由 scene"。

## 2. 设计目标

1. **动态前台 agent**：意图路由到哪个 agent，就用哪个 agent 的完整配置（provider + systemPrompt + tools）直接面向用户执行
2. **前后台分离**：前台 agent 直接与用户交互；后台 agent 由 task/agent_team 创建，异步执行，完成后向父 agent 汇报
3. **意图三要素落地**：agent（谁执行）+ scene（什么场景）+ complexity（多复杂）全部影响实际执行
4. **React Flow 层级可视化**：前后台 agent 以父子关系展示，子 agent 完成后不立即消失
5. **并发用户输入处理**：后台任务运行期间，用户可发送新消息，合理排队/路由
6. **融入现有架构**：Zustand Store + `transition(event)` + EventAdapter 桥接

## 3. 架构总览

```
┌─ Renderer Process ─────────────────────────────────────────────┐
│                                                                 │
│  ┌──────────────────┐   ┌──────────────────┐                   │
│  │ AgentStateMachine │   │ ConversationStore │                   │
│  │  foregroundAgentId│   │  routingInfo      │                  │
│  │  agentMap (FG+BG) │   │  queuedMessages   │                  │
│  └───────┬──────────┘   └────────┬─────────┘                  │
│          │ transition(event)      │                              │
│  ┌───────┴──────────────────────┴─────────┐                    │
│  │         EventAdapter                    │                    │
│  └───────┬─────────────────────────────────┘                    │
└──────────┼──────────────────────────────────────────────────────┘
           │ IPC
┌──────────┼──────────────────────────────────────────────────────┐
│  Child Process                                                   │
│                                                                  │
│  agent-bridge.ts                                                 │
│    handleUserAction()                                            │
│      1. IntentRouter.route(message) → {agentId, scene, complexity}│
│      2. session.switchForegroundAgent(agentId, scene, complexity)│
│      3. session.userAction(data) → SessionStateMachine           │
│                                                                  │
│  ChatSession                                                     │
│    switchForegroundAgent() — [NEW] 完整替换 AgentLoop 配置        │
│    userAction() → run() → AgentLoop.run()                        │
│                                                                  │
│  AgentLoop                                                       │
│    applyAgentConfig() — [NEW] 运行时热替换 provider/prompt/tools  │
│                                                                  │
│  TaskOrchestrator / TeamManager (后台)                           │
│    SubAgentFactory.createAndRun() → 独立 AgentLoop               │
│    notifyCompletion() → TaskCompletionHandler                    │
│      → ChatSession.scheduleSummary() → 新一轮 run()              │
└──────────────────────────────────────────────────────────────────┘
```

## 4. 前后台 Agent 生命周期

### 4.1 前台 Agent（Foreground Agent）

直接面向用户的 agent，由意图路由决定。生命周期：

```
创建: 首次意图路由
  → SET_FOREGROUND_AGENT → status='pending', foregroundAgentId=agentId

激活: 每轮用户消息开始
  → agent:started (isForeground=true) → pending → 进入执行

思考: THINKING_DELTA → thinking
执行: TOOL_START → executing
输出: TEXT_DELTA → writing

运行完成:
  → FOREGROUND_COMPLETE → writing → pending（等待下一轮或清理）

切换: 意图路由到不同 agent
  → SET_FOREGROUND_AGENT → 新前台 → pending，旧前台保持不动（多前台共存）

清理: 会话重置/所有后台任务完成且无排队消息
  → CLEANUP_COMPLETED_TASKS → 前台 agent 保持 pending
```

关键设计：前台 agent 在运行完成后重置为 `pending`，不进入 `cleared`。这样 React Flow 中始终可见当前前台 agent。

### 4.2 后台 Agent（Background Agent — task/team 创建）

由前台 agent 通过 task/agent_team 工具创建，异步执行。生命周期：

```
创建: 前台 agent 调用 task/team 工具
  → AGENT_CREATED → status='pending', parentId=foregroundAgentId

激活: 子 agent 开始执行
  → agent:subagent-start → pending → thinking

执行: THINKING_DELTA → thinking, TOOL_START → executing, TEXT_DELTA → writing

完成/失败:
  → SUBAGENT_END → writing → reporting (success) / failed
  → AsyncTaskStore: TASK_COMPLETED / TASK_CANCELLED

汇报: 父 agent 收到完成通知 → AUTO_SUMMARIZE_START → reporting → cleared
      或父 agent 的新一轮 run 处理后台结果

清理: 整个对话轮次完成后
  → CLEANUP_COMPLETED_TASKS → cleared
```

### 4.3 React Flow 中的可见性规则

```
前台 agent: 始终可见（pending ↔ thinking ↔ executing ↔ writing ↔ pending）
后台 agent: 
  - 创建后立即可见（pending）
  - 执行中可见（thinking/executing/writing）
  - 完成后保持可见（reporting），不立即消失
  - 父 agent 汇总处理后才清除（AUTO_SUMMARIZE_START → cleared）
  - 或整个轮次结束时统一清除（CLEANUP_COMPLETED_TASKS）
```

父子关系：`parentId` 字段建立 React Flow 的 edge 连接。

## 5. 并发用户输入处理

### 5.1 场景分析

后台任务运行期间，SessionStateMachine 处于 `waiting_async` 状态。此时：
- 输入框可编辑（ConversationStore.conversationState 不是 executing/outputting）
- 用户可以输入新内容并发送

### 5.2 处理策略：排队 + 意图路由

```
用户在后台任务运行期间发送新消息
  ↓
1. 重新运行 IntentRouter.route(newMessage)
   → 新的意图分析结果可能与当前前台 agent 不同
  ↓
2. SessionStateMachine: waiting_async + USER_MESSAGE → QUEUE_ONLY
   → 不中断当前后台任务
   → 新消息加入 pendingMessages 队列
  ↓
3. React Flow: 
   - 当前前台 agent + 子 agent 保持可见
   - 排队消息以 pending indicator 显示
  ↓
4. 当前轮次所有后台任务完成 → 父 agent 汇总 → agent:end
  ↓
5. 消费 pending 队列:
   - 如果排队消息的意图路由到不同 agent → switchForegroundAgent(newAgentId)
   - 如果同一 agent → 复用当前前台 agent
   - RUN_AGENT → 新一轮执行
```

### 5.3 React Flow 展示

当有排队消息时：
- 当前轮次的前台 + 子 agent 继续显示（正在执行或等待汇报）
- 在 ExecutionFlow 顶部显示 "1 条消息排队中" 指示器
- 排队消息的路由结果（将使用的 agent）以半透明节点预览

如果排队消息路由到不同 agent：
```
当前: [software-engineer] ─── [subtask-1] (reporting)
                              └── [subtask-2] (executing)
排队: [product-manager] (pending, 灰色)
```

当前轮次完成后：software-engineer + 子 agent 清除，product-manager 变为前台 agent。

## 6. 各层改动方案

### Phase 0: AgentLoop.applyAgentConfig()

**文件**: `src/core/agent/AgentLoop.ts` (+25 行) + `src/core/tools/ToolGateway.ts` (+5 行)

```typescript
applyAgentConfig(config: {
  provider?: ILLMProvider;
  systemPrompt?: string;
  toolRegistry?: IToolRegistry;
  model?: string;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
}): void
```

**关键实现细节**（修复 Review 问题 1）：

1. **Provider 替换**：走已有 `updateProvider()` 路径（line 546），该方法重建 `StreamPipeline` 并重新注册回调
2. **SystemPrompt 替换**：`contextManager.updateSystemPrompt(prompt)` — **完全替换**（ContextManager.ts:153-159），不是追加。旧 system 消息的内容被整体替换
3. **ToolRegistry 替换**：**必须同步重建 ToolGateway**。原因：
   - `ToolGateway` 构造时存储 `this.registry` 为 private 字段（ToolGateway.ts:28），无 setter
   - `AgentLoop.run()` 也直接读取 `this.registry.getSchemas()`（AgentLoop.ts:253）和 `getPermissionController()`（:226）
   - 单纯替换 `this.registry` 会导致 `this.toolGateway` 内部仍指向旧 registry
   - **方案**：在 ToolGateway 新增 `setRegistry(registry: IToolRegistry): void`，替换内部 `this.registry`。`applyAgentConfig()` 同时调用 `this.toolGateway.setRegistry(newRegistry)` + `this.registry = newRegistry`
   - 备选方案：如果不想改 ToolGateway，则直接 `this.toolGateway = new ToolGateway(newRegistry)` 重建，调用方需重新注册 custom tools（但当前无此需求）
4. **不重建 StreamPipeline**（除非 provider 也变了）。StreamPipeline 与 registry 无关

### Phase 1: LayeredPromptBuilder — 支持主 agent 按 scene+complexity 构建

**文件**: `src/core/prompt/LayeredPromptBuilder.ts`，~30 行

**现有接口**（types.ts:165-182）：

```typescript
interface LayeredPromptBuildOptions {
  userMessage?: string;
  scene?: SceneType | 'auto';     // 已有字段，但当前被忽略
  complexity?: IntentComplexity;   // 已有字段
  agent?: string;
  matchMethod?: 'keyword' | 'embedding' | 'default' | 'llm';
  language?: string;
  toolList?: any[];
  config?: AppConfig;
}
// build(options): Promise<PromptBuildResult>  — line 210
// SceneType = string (open type)              — types.ts:49
```

**当前行为**：`build()` 是"主 agent 路径"，硬编码只加载 L0 + L3（line 232-237），`scene` 参数声明但被忽略（line 221 注释："主 agent 不路由 scene"）。`shouldInclude()` 和 `selectComponents()` 中已有 L1/L2 的过滤逻辑但未被 `build()` 调用。

**修改**：
- `options.scene` 有值 → L0 + 匹配 scene 的 L1（复用已有 `shouldInclude()` 按 `component.scenes` 过滤） + (complexity='complex' 时 L2) + L3
- `options.scene` 无值 → 现有 L0 + L3（向后兼容）
- 不引入新参数，只激活已有但未使用的代码路径

### Phase 2: ChatSession.switchForegroundAgent()

**文件**: `src/core/chat/ChatSession.ts` (+60 行) + `SessionFactory.ts` (~5 行)

```typescript
async switchForegroundAgent(agentId: string, scene?: string, complexity?: string): Promise<void>
```

完整替换流程：

1. `AgentRegistry.get(agentId)` → 完整 agent config（含 yaml 中的 `systemPrompt` 字段）
2. Provider 解析：agent 有独立 provider 则用，否则 fallback 全局
3. **Prompt 策略（两层拼接）**：
   - **始终经过 LayeredPromptBuilder**：`builder.build({ scene, complexity })` 按场景加载 L0+(L1)+(L2)+L3 分层组件。无论 agent 是否有自己的 systemPrompt，builder 始终运行
   - **agent 自身 systemPrompt 追加**：builder 结果 + `\n\n` + agent 自身的 systemPrompt。agent 的个性化指令附加在分层 prompt 之后
   - **最终结构**：`L0基础层 + (L1场景层) + (L2复杂协调层) + L3项目层 + agent自定义指令`
   - 这保证了即使 agent 有自定义 systemPrompt，也能获得 L0（身份）+ L3（项目上下文）等基础组件
4. 工具过滤：按 agent 配置的 `tools` 列表过滤 ToolRegistry
5. `AgentLoop.applyAgentConfig()` → 应用全部配置（provider + systemPrompt + toolRegistry）

废弃 `setCurrentAgent()`，保留方法内部委托。

### Phase 3: AgentStateMachine — foregroundAgentId + 前后台分离

**文件**: `desktop/renderer/stores/AgentStateMachine.ts`，+80 行

#### 3a. 新增字段

```typescript
foregroundAgentId: string | null;  // [NEW] 当前前台 agent ID
queuedMessageCount: number;        // [NEW] 排队消息数，由 IPC 事件驱动
```

AgentState 不新增字段，通过 `foregroundAgentId === agent.id` 判定前后台。

#### 3b. 新增事件

```typescript
| { type: 'SET_FOREGROUND_AGENT'; agentId: string; name: string }
| { type: 'FOREGROUND_COMPLETE'; agentId: string }
| { type: 'QUEUED_MESSAGE' }        // [NEW] queuedMessageCount++
| { type: 'CLEAR_QUEUED_MESSAGE' }  // [NEW] queuedMessageCount = 0
```

#### 3c. 清理策略（v2）

**核心规则：多个前台 agent 共存，各自等子 agent 完成后再清理。**

```
SET_FOREGROUND_AGENT:
  → 新前台 → pending（不存在则 create，已存在则重置）
  → 旧前台不清理 — 允许多个前台共存于 React Flow

FOREGROUND_COMPLETE:
  → 当前前台 writing/thinking/executing → pending（等待下一轮或清理）

CLEANUP_COMPLETED_TASKS:
  → 前台 agent（parentId === null && taskType === undefined）：
      - 活跃状态 → pending
      - pending 状态下，检查所有子 agent 是否已 cleared：
          - 有子 agent 且全部 cleared → 清除该前台
          - 无子 agent → 立即清除（空集满足"全部已清理"）
  → 后台 task 子 agent（taskType === 'task'）：终态/活跃 → cleared
  → 后台 team 成员（taskType === 'team'）：跳过 — 不单独清理，由 agent:team-end 统一清理

子 agent 清理规则：
  - task 类型：自身任务完成后清理（SUBAGENT_END → reporting → AUTO_SUMMARIZE_START → cleared）
  - team 类型：applySubAgentEnd 不对 team 成员做状态变更；agent:team-end 时整个 team + 所有成员统一 CLEANUP
```

**多轮对话场景**：用户连续 3 轮路由到 software-engineer / product-manager / ui-designer → 3 个前台节点同时出现在 React Flow，各自等待子 agent 完成 → 子 agent 清完后逐轮清理前台。

#### 3d. `queuedMessageCount` 数据流（修复 Review 问题 5）

```
ChatSession.userActionNewPath()
  → SessionStateMachine 返回 QUEUE_ONLY action
  → eventBus.emit('queue:message-queued')
  → agent-bridge 监听 → channel.send('agent:message-queued')
  → EventAdapter → QUEUED_MESSAGE transition → queuedMessageCount++

ChatSession.run() 消费 pending 队列后
  → eventBus.emit('queue:consumed')
  → agent-bridge 监听 → channel.send('agent:queue-consumed')
  → EventAdapter → CLEAR_QUEUED_MESSAGE → queuedMessageCount = 0
```

ChatSession 不直接持有 IPC channel，通过 EventBus 桥接到 agent-bridge。

#### 3e. 修改 getCurrentMoments()

返回 `foregroundAgentId` + 所有非 cleared 的 agent（包括 reporting 状态的子 agent），供 React Flow 渲染。

### Phase 4: EventAdapter — 新事件桥接 + 前后台区分

**文件**: `desktop/renderer/services/EventAdapter.ts`，~50 行

#### 4a. 新增监听

```typescript
// 前台切换（来自 agent-bridge）
messageBus.on('agent:switch-foreground', (data: { agentId: string; name: string }) => {
  useAgentStateMachine.getState().transition({
    type: 'SET_FOREGROUND_AGENT', agentId: data.agentId, name: data.name,
  });
});

// 排队消息通知（来自 agent-bridge，修复 Review 问题 5）
messageBus.on('agent:message-queued', () => {
  useAgentStateMachine.getState().transition({ type: 'QUEUED_MESSAGE' });
});
messageBus.on('agent:queue-consumed', () => {
  useAgentStateMachine.getState().transition({ type: 'CLEAR_QUEUED_MESSAGE' });
});
```

#### 4b. 修改 agent:started

前台 `agent:started` 携带 `isForeground: true`，EventAdapter 不再重复创建 AGENT_CREATED。后台子 agent 保持现有创建逻辑。

#### 4c. 修改 agent:end — FOREGROUND_COMPLETE 是客户端合成事件（修复 Review 问题 4）

`FOREGROUND_COMPLETE` **不由后端发出**。后端 agent-bridge 不知道前端的 `foregroundAgentId`。处理逻辑：

```typescript
messageBus.on('agent:end', () => {
  const store = useAgentStateMachine.getState();
  // 1. 前台完成后回 pending（客户端合成，无需后端感知）
  if (store.foregroundAgentId) {
    store.transition({
      type: 'FOREGROUND_COMPLETE', agentId: store.foregroundAgentId,
    });
  }
  // 2. 后台子 agent 全部清理
  store.transition({ type: 'CLEANUP_COMPLETED_TASKS' });
});
```

`FOREGROUND_COMPLETE` 事件不暴露给 IPC，仅在 EventAdapter 内部由 `agent:end` 触发。

#### 4d. 修改默认 agentId

`agent:thinking` / `agent:tool-start` 等事件的 agentId 不再硬编码 `'xuanji'`，改为 `useAgentStateMachine.getState().foregroundAgentId || 'xuanji'`。

### Phase 5: agent-bridge — 路由后真实切换 + 排队通知

**文件**: `desktop/main/agent-bridge.ts`，~25 行

`handleUserAction()` 中路由完成后：

```typescript
const route = await intentRouter.route(message, onProgress);
await session.switchForegroundAgent(route.agentId, route.scene, route.complexity);
channel.send('agent:switch-foreground', { agentId: route.agentId, name: route.agentId });
```

`AGENT_STARTED` 映射中携带 `isForeground: true`。

**新增排队 IPC 事件**（修复 Review 问题 5）：

ChatSession 通过 EventBus 发出队列事件，agent-bridge 监听并转发为 IPC：

```typescript
// ChatSession.userActionNewPath() — QUEUE_ONLY 时
eventBus.emit('queue:message-queued');

// ChatSession.run() — 消费 pending 队列后
if (sm.pendingMessages.length === 0) {
  eventBus.emit('queue:consumed');
}

// agent-bridge.ts — 监听并转发
eventBus.on('queue:message-queued', () => {
  channel.send('agent:message-queued');
});
eventBus.on('queue:consumed', () => {
  channel.send('agent:queue-consumed');
});
```

ChatSession 不直接持有 IPC channel，必须通过 EventBus 桥接。

### Phase 6: React Flow 适配

**文件**: `desktop/renderer/components/ExecutionFlow.tsx`

- 前台节点：蓝色边框、加粗名称、始终可见
- 后台节点：灰色边框、通过 edge 连接到父 agent
- reporting 状态的节点保持可见（不立即消失）
- 排队消息指示器

## 7. 改动文件汇总

| 文件 | Phase | 改动量 | 风险 |
|------|-------|--------|------|
| `src/core/agent/AgentLoop.ts` | 0 | +25 行 | 低 |
| `src/core/tools/ToolGateway.ts` | 0 | +5 行（setRegistry） | 低 |
| `src/core/prompt/LayeredPromptBuilder.ts` | 1 | ~30 行 | 中 |
| `src/core/chat/ChatSession.ts` | 2 | +60 行 | 中 |
| `src/core/chat/SessionFactory.ts` | 2 | ~5 行 | 低 |
| `desktop/renderer/stores/AgentStateMachine.ts` | 3 | +80 行 | 中 — 状态机核心 |
| `desktop/renderer/services/EventAdapter.ts` | 4 | ~55 行 | 低 — 增量 |
| `desktop/main/agent-bridge.ts` | 5 | ~25 行 | 低 |
| `desktop/renderer/components/ExecutionFlow.tsx` | 6 | ~30 行 | 中 |

## 8. feature flag

所有改动由 `USE_DYNAMIC_FOREGROUND_AGENT` 环境变量控制。false 时完全向后兼容。

## 9. 向后兼容

- `setCurrentAgent()` 委托给 `switchForegroundAgent('xuanji')`
- `updateProvider()` 委托给 `applyAgentConfig({ provider })`
- `foregroundAgentId === null` 时 CLEANUP_COMPLETED_TASKS 恢复旧行为
- 新增 IPC 事件增量，旧 renderer 忽略

## 10. 验证步骤

1. "帮我写排序算法" → 路由到 software-engineer → React Flow 显示 software-engineer → 正常清理
2. "重构项目架构" → 路由到 xuanji（complex）→ 创建 task 子 agent → React Flow 父子层级 → 子 agent 完成后保持 reporting → 父 agent 汇总后统一清除
3. 后台任务期间发送新消息 → 排队 → React Flow 显示排队指示器 → 当前轮次完成后消费排队
4. 排队消息路由到不同 agent → 前台 agent 切换 → React Flow 显示新前台
5. TypeScript 检查 desktop 目录零错误
