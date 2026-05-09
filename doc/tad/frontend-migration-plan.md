# 璇玑架构升级 — 前端迁移方案

## 一、改造总览

```
改造前 Store 架构                              改造后 Store 架构
══════════════════════════════════              ═══════════════════════════════

messageStore.ts (1690 行)                       SessionStore.ts (~100 行)
├─ messages[] 增删改                           ├─ messages[]
├─ _handleXxx 所有 handler                     ├─ addMessage / updateMessage
├─ _conversationState + status                 └─ (仅消息 CRUD, 无 handler)
├─ 子 agent 节点创建/管理
├─ team start/end/member handler               AgentStateMachine.ts (~250 行)
├─ tool 状态更新                               ├─ agents: Map<id, AgentState>
├─ citation 结果缓存                           ├─ transition(event) → 自动更新所有派生状态
├─ sendMessage (3 分支)                        ├─ moment 气泡自动生成
└─ 错误处理 (3 处重复)                         └─ 树搜索方法 (O(1) index)

activeAgentStore.ts (~250 行)                  AsyncTaskStore.ts (~120 行)
├─ mainAgent + subAgents 树                    ├─ tasks: Map<groupId, TaskState>
├─ addSubAgent / removeSubAgent                ├─ transition(event)
└─ getAgentById 等查询                         └─ 统一 task/team 监听

runtimeStore.ts (~200 行)                      CitationStore.ts (~60 行)
├─ processing (boolean)                        └─ citations[]
├─ agentActivity.currentMoments[]
├─ runStartTime / iteration / ...
└─ messageStream

backgroundTaskStore.ts (~150 行)               删除：
├─ tasks[] + teams[]                           ├─ runtimeStore (合并到 SessionStore 或删除)
└─ transitionTask / transitionMember            ├─ backgroundTaskStore (合并到 AsyncTaskStore)
                                                └─ activeAgentStore (合并到 AgentStateMachine)

EventBridge.ts (1022 行)                       EventAdapter.ts (~100 行)
├─ messageBus.on(...) 所有 handler (~800行)    └─ messageBus.on(事件) → 调用 store.transition()
├─ 3s 缓冲 / thinking 累加 / 树搜索            (薄转发, 每次 handler 仅 2-5 行)
└─ bgTaskStore 协调

新增文件:
├─ desktop/renderer/stores/SessionStore.ts
├─ desktop/renderer/stores/AgentStateMachine.ts
├─ desktop/renderer/stores/AsyncTaskStore.ts
├─ desktop/renderer/stores/CitationStore.ts
└─ desktop/renderer/services/EventAdapter.ts
```

---

## 二、改造步骤

### 步骤 1：创建 AgentStateMachine — 统一 Agent 生命周期

**新文件**: `desktop/renderer/stores/AgentStateMachine.ts`

这是前端架构升级的核心。AgentStateMachine 替代当前散落在 activeAgentStore、messageStore 和 EventBridge 中的所有 agent 节点管理逻辑。

```typescript
// ========== 类型定义 ==========

type AgentStatus = 'pending' | 'thinking' | 'executing' | 'writing' | 'reporting' | 'success' | 'failed' | 'cancelled' | 'cleared';

interface AgentMoment {
  id: string;
  icon: string;
  label: string;
  status: AgentStatus;
  startTime: number;
  toolName?: string;
  toolLabel?: string;
}

interface AgentState {
  id: string;
  parentId: string | null;
  name: string;
  status: AgentStatus;
  thought: string;
  moment: AgentMoment | null;
  subAgents: string[];         // children IDs
  multiAgent?: MultiAgentData;
  createdAt: number;
  toolCalls: ToolCallState[];
  // 各种缓冲区（从 EventBridge 迁移过来）
  thinkingBuffer: string;
  taskDisplayStart: number | null;
  taskDisplayTimer: NodeJS.Timeout | null;
}

// ========== 状态机核心 ==========

type AgentEvent =
  | { type: 'AGENT_CREATED'; agentId: string; parentId: string | null; name: string; multiAgent?: any }
  | { type: 'THINKING_DELTA'; agentId: string; thought: string }  // 合并 thinking + thinking-start
  | { type: 'TOOL_START'; agentId: string; toolCall: ToolCallData }
  | { type: 'TOOL_END'; agentId: string; toolCallId: string; result: any; isError: boolean }
  | { type: 'TEXT_DELTA'; agentId: string; text: string }
  | { type: 'SUBAGENT_END'; agentId: string; success: boolean; error?: string }
  | { type: 'AUTO_SUMMARIZE_START'; agentId: string }
  | { type: 'TASK_FAILED'; agentId: string; error: string }
  | { type: 'CLEANUP'; agentId: string };

interface AgentStateMachineStore {
  mainAgent: AgentState | null;
  // O(1) 索引: id → AgentState
  agentMap: Record<string, AgentState>;

  // 核心方法
  transition: (event: AgentEvent) => void;
  getAgentById: (id: string) => AgentState | undefined;
  findParentId: (id: string) => string | null;
  getAgentStatus: (id: string) => AgentStatus | null;

  // 供视图层订阅的派生状态
  getCurrentMoments: () => AgentMoment[];
  getActiveAgentIds: () => string[];
}
```

#### 1.1 状态转换规则

```typescript
transition(event: AgentEvent): void {
  // 终态屏蔽：如果 agent 已经是终态，忽略除 CLEANUP/CLEARED 外的事件
  const existing = this.agentMap[event.agentId];
  if (existing && isTerminalStatus(existing.status) && 
      event.type !== 'CLEANUP' && event.type !== 'AUTO_SUMMARIZE_START') {
    return; // 消除 findAgentStatus 递归搜索
  }

  // 自动 ensure agent 存在（消除 _promoteSubAgent 的 6 处调用）
  if (event.type !== 'AGENT_CREATED' && !existing) {
    this.ensureAgent(event);
  }

  switch (event.type) {
    case 'AGENT_CREATED':
      this.createAgent(event);
      break;
    case 'THINKING_DELTA':
      this.handleThinkingDelta(event);
      break;
    case 'TOOL_START':
      this.handleToolStart(event);
      break;
    case 'TOOL_END':
      this.handleToolEnd(event);
      break;
    case 'TEXT_DELTA':
      this.handleTextDelta(event);
      break;
    case 'SUBAGENT_END':
      this.handleSubAgentEnd(event);
      break;
    case 'AUTO_SUMMARIZE_START':
      this.handleAutoSummarizeStart(event);
      break;
    case 'TASK_FAILED':
      this.handleTaskFailed(event);
      break;
    case 'CLEANUP':
      this.handleCleanup(event);
      break;
  }
}
```

#### 1.2 关键状态转换实现

```typescript
// ========== thinking 处理（合并 agent:thinking 和 agent:thinking-start） ==========

private handleThinkingDelta(event: { agentId: string; thought: string }): void {
  const agent = this.agentMap[event.agentId];
  
  // 终态检查（已在 transition 开头统一完成，不需要每个 handler 各自检查）
  
  // 3 秒任务展示缓冲 — 统一逻辑，不再在各 handler 中重复
  if (!agent.taskDisplayStart) {
    agent.taskDisplayStart = Date.now();
    setAgentStatus(agent, 'thinking');
  } else if (Date.now() - agent.taskDisplayStart < 3000) {
    // 还未满 3 秒，缓冲思考内容
    agent.thinkingBuffer += event.thought;
  } else {
    // 满 3 秒，flush 缓冲区
    if (agent.thinkingBuffer) {
      agent.thought += agent.thinkingBuffer;
      agent.thinkingBuffer = '';
    }
    agent.thought += event.thought;
  }

  // 更新 moment — 统一在状态变更时自动设置
  updateMoment(agent);
}

// ========== moment 统一更新 ==========

private updateMoment(agent: AgentState): void {
  const momentConfig: Record<AgentStatus, { icon: string; label: string }> = {
    pending:    { icon: '⏳', label: '等待中' },
    thinking:   { icon: '💭', label: '思考中' },
    executing:  { icon: '🔧', label: '执行工具' },  // 会被工具特定 label 覆写
    writing:    { icon: '✏️', label: '输出中' },
    reporting:  { icon: '📝', label: '待汇报' },
    success:    { icon: '✅', label: '已完成' },
    failed:     { icon: '❌', label: '执行失败' },
    cancelled:  { icon: '🚫', label: '已取消' },
    cleared:    { icon: '',   label: '' },
  };

  const config = momentConfig[agent.status];
  agent.moment = {
    id: `${agent.id}-${agent.status}`,
    icon: config.icon,
    label: config.label,
    status: agent.status,
    startTime: Date.now(),
  };
}

// ========== tool start 处理 ==========

private handleToolStart(event: { agentId: string; toolCall: ToolCallData }): void {
  const agent = this.agentMap[event.agentId];
  
  // 任务展示缓冲：工具开始意味着可以 flush 缓冲区
  if (agent.taskDisplayTimer) {
    clearTimeout(agent.taskDisplayTimer);
    agent.taskDisplayTimer = null;
  }
  if (agent.thinkingBuffer) {
    agent.thought += agent.thinkingBuffer;
    agent.thinkingBuffer = '';
  }
  
  agent.toolCalls.push({ ...event.toolCall, status: 'running' });
  setAgentStatus(agent, 'executing');
  
  // 工具特定的 moment label
  const toolLabels: Record<string, string> = {
    file: '读取文件', bash: '执行命令', task: '调用子 Agent',
    agent_team: '组建团队', web_search: '搜索网页',
  };
  agent.moment = {
    ...agent.moment!,
    toolName: event.toolCall.name,
    toolLabel: toolLabels[event.toolCall.name] || event.toolCall.name,
  };
  updateMoment(agent);
}

// ========== subagent-end 处理 ==========

private handleSubAgentEnd(event: { agentId: string; success: boolean; error?: string }): void {
  const agent = this.agentMap[event.agentId];
  setAgentStatus(agent, event.success ? 'success' : 'failed');
  updateMoment(agent);
  // 3 秒后清理（不再是分散的 setTimeout）
  this.scheduleCleanup(event.agentId, 3000);
}

// ========== 自动汇总清理 ==========

private handleAutoSummarizeStart(event: { agentId: string }): void {
  const agent = this.agentMap[event.agentId];
  if (!agent) return;

  if (agent.multiAgent?.type === 'team') {
    // 清理所有团队成员
    const teamName = agent.multiAgent.teamName;
    Object.values(this.agentMap).forEach(a => {
      if (a.multiAgent?.teamName === teamName) {
        setAgentStatus(a, 'cleared');
      }
    });
  } else {
    setAgentStatus(agent, 'cleared');
  }
  // 延迟移除节点
  this.scheduleRemove(event.agentId, 3000);
}
```

#### 1.3 消除 _promoteSubAgent 的 ensureAgent

```typescript
// 当前 _promoteSubAgent 有 5 个分支（agent 已存在、pending 为空、已清理、有 pending、无 parentId）
// 改造后：transition() 开头统一 ensure

private ensureAgent(event: AgentEvent): void {
  // 如果 agent 已经被清理，不重新创建
  if (this.cleanedAgentIds.has(event.agentId)) return;

  // 从 rootAgentId 或事件推断 parentId
  const parentId = this.inferParentId(event);

  this.createAgent({
    type: 'AGENT_CREATED',
    agentId: event.agentId,
    parentId,
    name: this.inferName(event),
  });
}

// 只在一处实现，被所有事件 handler 共享
// 消除 EventBridge.ts:316-361 和 messageStore.ts:878-903 等多个创建点
```

#### 1.4 Zustand Store 包装

```typescript
export const useAgentStateMachine = create<AgentStateMachineStore>((set, get) => ({
  mainAgent: null,
  agentMap: {},

  transition: (event: AgentEvent) => {
    set(state => {
      const newState = { ...state, agentMap: { ...state.agentMap } };
      applyTransition(newState, event);
      return newState;
    });
  },

  getAgentById: (id: string) => get().agentMap[id],
  findParentId: (id: string) => get().agentMap[id]?.parentId ?? null,
  getAgentStatus: (id: string) => get().agentMap[id]?.status ?? null,

  getCurrentMoments: () => {
    const { agentMap } = get();
    return Object.values(agentMap)
      .filter(a => a.moment && a.status !== 'cleared')
      .map(a => a.moment!);
  },
}));
```

**关键改进**：
- 移除了 EventBridge.ts 中 4 种树搜索函数（findAgent、findAgentStatus、findAgentInTree、findParentId）
- 使用 `agentMap` (Record) 做 O(1) 查找
- `_promoteSubAgent` 的 6 处调用 + 5 种分支逻辑 → `ensureAgent` 一处 + 2 行
- 3 秒展示缓冲逻辑从 3 处手写 → `handleThinkingDelta` 一处
- Moment 从 8 处分散设置 → `updateMoment` 统一规则

---

### 步骤 2：创建 AsyncTaskStore — 统一 Task/Team 后台任务

**新文件**: `desktop/renderer/stores/AsyncTaskStore.ts`

替代当前的 backgroundTaskStore。统一管理 task 和 agent_team 的后台任务生命周期。

```typescript
type AsyncTaskType = 'task' | 'team';

interface AsyncTaskState {
  groupId: string;
  type: AsyncTaskType;
  status: 'creating' | 'running' | 'completed' | 'failed' | 'cancelled' | 'cleared';
  subAgentIds: string[];
  memberStates?: Record<string, 'pending' | 'running' | 'completed' | 'failed'>;
  startTime: number;
}

interface AsyncTaskStore {
  tasks: Record<string, AsyncTaskState>;
  
  transition: (event: AsyncTaskEvent) => void;
  getRunningCount: () => number;
  getCompletedCount: () => number;
  getTaskBySubAgentId: (subAgentId: string) => AsyncTaskState | null;
}

export const useAsyncTaskStore = create<AsyncTaskStore>((set, get) => ({
  tasks: {},

  transition: (event: AsyncTaskEvent) => {
    set(state => {
      const tasks = { ...state.tasks };
      
      switch (event.type) {
        case 'TASK_CREATED':
          tasks[event.groupId] = {
            groupId: event.groupId,
            type: event.taskType,
            status: 'creating',
            subAgentIds: event.subAgentIds,
            startTime: Date.now(),
          };
          break;
        case 'TASK_STARTED':
          if (tasks[event.groupId]) tasks[event.groupId].status = 'running';
          break;
        case 'TASK_COMPLETED':
          if (tasks[event.groupId]) tasks[event.groupId].status = 'completed';
          break;
        case 'TASK_FAILED':
          if (tasks[event.groupId]) tasks[event.groupId].status = 'failed';
          break;
        case 'TASK_CANCELLED':
          if (tasks[event.groupId]) tasks[event.groupId].status = 'cancelled';
          break;
        case 'TASK_CLEARED':
          delete tasks[event.groupId];
          break;
        case 'MEMBER_STATE_CHANGED':
          if (tasks[event.groupId]?.memberStates) {
            tasks[event.groupId].memberStates![event.memberId] = event.status;
          }
          break;
      }
      
      return { tasks };
    });
  },

  getRunningCount: () => {
    return Object.values(get().tasks).filter(t => t.status === 'running' || t.status === 'creating').length;
  },
  getCompletedCount: () => {
    return Object.values(get().tasks).filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled').length;
  },
  getTaskBySubAgentId: (subAgentId: string) => {
    return Object.values(get().tasks).find(t => t.subAgentIds.includes(subAgentId)) ?? null;
  },
}));
```

**关键改进**：
- task 和 agent_team 的 backend 执行路径相同，前端状态管理也统一
- 不再有 bgStore 的 registerTask + transitionTask + transitionMember 三种分散操作，统一 transition
- 不再有 EventBridge handler 中手动操作 bgStore（参见当前 handler 中 10+ 处 bgStore.transitionXxx 调用）

---

### 步骤 3：创建 EventAdapter — 替代 EventBridge

**新文件**: `desktop/renderer/services/EventAdapter.ts`

目标：1022 行 → ~100 行，每个 handler 仅 2-5 行。

```typescript
export function registerEventAdapter(): void {
  const messageBus = useMessageBus.getState();

  // ─── Session 级事件 ───
  messageBus.on('agent:started', (data) => {
    useSessionStore.getState().onAgentStarted(data);
  });

  messageBus.on('agent:completed', (data) => {
    useSessionStore.getState().onAgentCompleted(data);
  });

  messageBus.on('agent:conversation-state', (data) => {
    useSessionStore.getState().setConversationState(data.to);
  });

  // ─── Agent 生命周期事件 ───（不再区分 thinking/thinking-start）
  messageBus.on('agent:thinking', (data) => {
    useAgentStateMachine.getState().transition({
      type: 'THINKING_DELTA',
      agentId: data.parentAgentId,
      thought: data.thought,
    });
  });

  messageBus.on('agent:text', (data) => {
    useAgentStateMachine.getState().transition({
      type: 'TEXT_DELTA',
      agentId: data.parentAgentId,
      text: data.text,
    });
  });

  messageBus.on('agent:tool-start', (data) => {
    useAgentStateMachine.getState().transition({
      type: 'TOOL_START',
      agentId: data.parentAgentId,
      toolCall: { id: data.id, name: data.name, args: data.args },
    });
  });

  messageBus.on('agent:tool-end', (data) => {
    useAgentStateMachine.getState().transition({
      type: 'TOOL_END',
      agentId: data.parentAgentId,
      toolCallId: data.id,
      result: data.result,
      isError: data.isError,
    });
  });

  // ─── 异步任务事件 ───（统一 task/team）
  messageBus.on('agent:async-task-created', (data) => {
    useAsyncTaskStore.getState().transition({
      type: 'TASK_CREATED',
      groupId: data.groupId,
      taskType: data.taskType, // 'task' | 'team' — 不再用 team-exec- 前缀
      subAgentIds: data.subAgentIds,
    });
    // 同时创建 AgentStateMachine 节点
    useAgentStateMachine.getState().transition({
      type: 'AGENT_CREATED',
      agentId: data.subAgentId || data.teamName,
      parentId: data.parentAgentId,
      name: data.name,
      multiAgent: data.multiAgent,
    });
  });

  messageBus.on('agent:async-task-started', (data) => {
    useAsyncTaskStore.getState().transition({ type: 'TASK_STARTED', groupId: data.groupId });
  });

  messageBus.on('agent:async-task-completed', (data) => {
    useAsyncTaskStore.getState().transition({ type: 'TASK_COMPLETED', groupId: data.groupId });
    useAgentStateMachine.getState().transition({
      type: 'SUBAGENT_END',
      agentId: data.subAgentId,
      success: true,
    });
  });

  messageBus.on('agent:task-failed', (data) => {
    // 统一处理取消和失败
    useAsyncTaskStore.getState().transition({
      type: data.isCancelled ? 'TASK_CANCELLED' : 'TASK_FAILED',
      groupId: data.groupId,
    });
    useAgentStateMachine.getState().transition({
      type: 'TASK_FAILED',
      agentId: data.subAgentId,
      error: data.error,
    });
  });

  // ─── Team 事件 ───（不再需要单独 handler，走统一异步任务事件）
  messageBus.on('agent:team-start', (data) => {
    // 团队创建 → 统一走 async-task-created
    useAsyncTaskStore.getState().transition({
      type: 'TASK_CREATED',
      groupId: data.teamName,
      taskType: 'team',
      subAgentIds: data.members.map((m: any) => m.subAgentId || m.id),
    });
    // AgentStateMachine 只创建 leader 节点
    useAgentStateMachine.getState().transition({
      type: 'AGENT_CREATED',
      agentId: data.teamName,
      parentId: data.parentAgentId,
      name: data.teamName,
      multiAgent: { type: 'team', strategy: data.strategy, teamName: data.teamName },
    });
  });

  messageBus.on('agent:team-member-start', (data) => {
    useAsyncTaskStore.getState().transition({
      type: 'MEMBER_STATE_CHANGED',
      groupId: data.teamName,
      memberId: data.memberId,
      status: 'running',
    });
    useAgentStateMachine.getState().transition({
      type: 'AGENT_CREATED',
      agentId: data.memberId,
      parentId: data.teamName,
      name: data.name,
      multiAgent: { type: 'team-member', teamName: data.teamName, memberId: data.memberId },
    });
  });

  messageBus.on('agent:team-member-end', (data) => {
    useAsyncTaskStore.getState().transition({
      type: 'MEMBER_STATE_CHANGED',
      groupId: data.teamName,
      memberId: data.memberId,
      status: data.success ? 'completed' : 'failed',
    });
    useAgentStateMachine.getState().transition({
      type: 'SUBAGENT_END',
      agentId: data.memberId,
      success: data.success,
    });
  });

  messageBus.on('agent:team-end', (data) => {
    useAsyncTaskStore.getState().transition({
      type: data.success ? 'TASK_COMPLETED' : 'TASK_FAILED',
      groupId: data.teamName,
    });
  });

  // ─── 自动汇总 ───
  messageBus.on('agent:auto-summarize-start', (data) => {
    // 不再有 taskType 前缀 hack — 后端直接传 taskType
    useAsyncTaskStore.getState().transition({
      type: 'TASK_CLEARED',
      groupId: data.groupId,
    });
    useAgentStateMachine.getState().transition({
      type: 'AUTO_SUMMARIZE_START',
      agentId: data.subAgentId,
    });
  });

  // ─── Citation ───
  messageBus.on('agent:citation', (data) => {
    useCitationStore.getState().addCitation(data.citation);
  });
}
```

**关键变化**：

| 维度 | 改造前 EventBridge | 改造后 EventAdapter |
|------|-------------------|---------------------|
| 总行数 | ~1022 | ~120 |
| 每个 handler | 30-80 行（含递归搜索、状态判断、moment 设置、bgStore 操作） | 2-5 行（仅调用 store.transition） |
| 重复代码 | 树搜索 4 版、3s 缓冲 3 版、终态检查 7 处 | 0 处重复 |
| team 类型 hack | `team-exec-` 前缀 + `replace(/-?\d+$/, '')` | `taskType` 字段 |
| 状态同步 | 手动调用 bgStore + agentStore + messageStore | 各 store 独立处理自己的 event |

---

### 步骤 4：创建 SessionStore — 简化会话状态

**新文件**: `desktop/renderer/stores/SessionStore.ts`

合并 messageStore 中的 `status`、`_conversationState` 和 runtimeStore 中的 `processing`：

```typescript
interface SessionStore {
  // 从 messageStore 迁移
  status: 'idle' | 'thinking' | 'executing';    // 从 _conversationState 派生
  conversationState: ConversationState;          // idle/executing/outputting/waiting_async

  // 从 runtimeStore 迁移
  processing: boolean;
  iteration: number;
  runStartTime: number | null;

  // 计算属性
  canSendMessage: () => boolean;  // idle || waiting_async
  isRunning: () => boolean;       // executing || outputting

  // 方法
  onAgentStarted: (data: any) => void;
  onAgentCompleted: (data: any) => void;
  setConversationState: (state: string) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  status: 'idle',
  conversationState: 'idle',
  processing: false,
  iteration: 0,
  runStartTime: null,

  onAgentStarted: (data) => set({
    status: 'thinking',
    conversationState: 'executing',
    processing: true,
    iteration: get().iteration + 1,
    runStartTime: Date.now(),
  }),

  onAgentCompleted: (data) => set({
    status: 'idle',
    processing: false,
  }),

  setConversationState: (state) => {
    const chatStatus: Record<string, string> = {
      idle: 'idle', executing: 'thinking', outputting: 'thinking', waiting_async: 'idle',
    };
    set({
      conversationState: state as ConversationState,
      status: (chatStatus[state] || 'idle') as any,
      processing: state === 'executing' || state === 'outputting',
    });
  },

  canSendMessage: () => {
    const { conversationState } = get();
    return conversationState === 'idle' || conversationState === 'waiting_async';
  },

  isRunning: () => {
    const { conversationState } = get();
    return conversationState === 'executing' || conversationState === 'outputting';
  },

  reset: () => set({
    status: 'idle',
    conversationState: 'idle',
    processing: false,
    iteration: 0,
    runStartTime: null,
  }),
}));
```

**关键改进**：
- 消除前端三重状态变量（status + _conversationState + processing）
- `status` 直接从 `conversationState` 派生，不需要在 3 处手动同步
- `processing` 由 `setConversationState` 自动设置，不再在 sendMessage 中手动 set

---

### 步骤 5：简化 messageStore — 只负责消息 CRUD

**文件改造**: `desktop/renderer/stores/messageStore.ts`

改造后的 messageStore 只保留消息列表管理功能：

```typescript
interface MessageStore {
  messages: Message[];
  currentStreamingId: string | null;

  // 消息 CRUD
  addMessage: (msg: Message) => void;
  appendStreamingContent: (id: string, content: string) => void;
  finishStreaming: (id: string) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;

  // 用户发送消息（统一入口）
  sendMessage: (content: string) => Promise<void>;
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  messages: [],
  currentStreamingId: null,

  sendMessage: async (content: string) => {
    const id = generateId();
    // 1. 添加用户消息到列表
    const userMsg = { id, role: 'user', content, timestamp: Date.now() };
    set(s => ({ messages: [...s.messages, userMsg] }));

    // 2. 始终走统一的 IPC 通道 — 替代原来的 3 分支
    try {
      const result = await window.electron.agentUserAction({
        type: 'SEND_MESSAGE',
        content,
      });
      if (!result.success) {
        handleSendError(id, result.error);
      }
    } catch (err) {
      handleSendError(id, String(err));
    }
  },
  // ...
}));

// 统一的错误处理 — 消除 3 处重复
function handleSendError(msgId: string, error: string) {
  const errorMessage = {
    id: generateId(),
    role: 'assistant' as const,
    content: `❌ 错误：${error || '操作失败，请重试'}`,
    timestamp: Date.now(),
    isError: true,
  };
  useSessionStore.getState().reset();
  useMessageStore.setState(s => ({
    messages: trimMessages([...s.messages, errorMessage]),
  }));
}
```

**迁移出去的逻辑**：

| 迁移内容 | 目标模块 |
|---------|---------|
| `_handleAgentThinking` | AgentStateMachine.ts |
| `_handleAgentText` | messageStore 保留（流式文本气泡更新） |
| `_handleAgentToolStart` | AgentStateMachine.ts |
| `_handleAgentToolEnd` | AgentStateMachine.ts |
| `_handleAgentEnd` | SessionStore.ts + AgentStateMachine.ts |
| `_handleTeamStart` | AgentStateMachine.ts |
| `_handleTeamMemberStart` | AgentStateMachine.ts |
| `_handleTeamMemberEnd` | AgentStateMachine.ts |
| `_handleTeamEnd` | AgentStateMachine.ts |
| `_promoteSubAgent` | AgentStateMachine.ensureAgent |
| `_pendingSubAgents` / `_taskParentMap` / `_cleanedAgentIds` | AgentStateMachine 内部 |
| `status` / `_conversationState` | SessionStore.ts |
| 错误处理（3 处重复） | messageStore 内的 handleSendError |
| `sendMessage` 中的 runtimeStore 操作 | SessionStore.onAgentStarted |

---

### 步骤 6：创建 CitationStore

**新文件**: `desktop/renderer/stores/CitationStore.ts`

```typescript
interface CitationStore {
  citations: Citation[];
  addCitation: (citation: Citation) => void;
  clear: () => void;
}

export const useCitationStore = create<CitationStore>((set) => ({
  citations: [],
  addCitation: (citation) => set(s => ({
    citations: [...s.citations, citation],
  })),
  clear: () => set({ citations: [] }),
}));
```

---

### 步骤 7：组件更新

#### 7.1 InputArea.tsx — 简化 sendMessage

```typescript
// 改造前：3 个分支
const handleSubmit = () => {
  if (isIdle) {
    await messageStore.sendMessage(content);
  } else if (isExecuting) {
    await window.electron.agentInterrupt(content);
  } else if (isOutputting) {
    await window.electron.agentSendSupplment(content);
  }
};

// 改造后：始终走统一入口
const handleSubmit = () => {
  await messageStore.sendMessage(content);
  // messageStore.sendMessage 内部始终走 agent:user-action IPC
  // 后端 SessionStateMachine 自行决定是 run / queue / abort
};
```

#### 7.2 ExecutionFlow.tsx — 使用 AgentStateMachine

```typescript
// 改造前：读 activeAgentStore.mainAgent.subAgents
const mainAgent = useActiveAgentStore(s => s.mainAgent);

// 改造后：读 AgentStateMachine.agentMap
const agents = useAgentStateMachine(s => s.agentMap);
const mainAgent = useAgentStateMachine(s => s.mainAgent);
```

#### 7.3 StatusBar.tsx — 使用 AsyncTaskStore

```typescript
// 改造前：读 backgroundTaskStore
const runningCount = useBackgroundTaskStore(s => s.getRunningCount());
const completedCount = useBackgroundTaskStore(s => s.getCompletedCount());

// 改造后：读 AsyncTaskStore
const runningCount = useAsyncTaskStore(s => s.getRunningCount());
const completedCount = useAsyncTaskStore(s => s.getCompletedCount());
```

#### 7.4 WorkspaceMonitor — 已废弃，直接删除

`WorkspaceMonitor` 已被 `ExecutionFlow` (React Flow + Dagre) 完全替代。`ExecutionFlow.tsx:3` 注释确认：`完全替换旧的 Canvas WorkspaceMonitor`。

改造动作：删除 `desktop/renderer/components/WorkspaceMonitor/` 整个目录（无任何页面引用，仅 `runtimeStore.ts` 引用其 types）。

Moment 派生数据已由 `AgentStateMachine.getCurrentMoments()` 提供，供 ExecutionFlow / StatusBar / MessageBubble 使用。

---

## 三、Store 拆分对照表

| 改造前 | 改造后 | 职责 |
|--------|--------|------|
| messageStore (1690行) | messageStore (~200行) | 仅消息 CRUD + 流式文本更新 |
| messageStore._handleXxx | AgentStateMachine | Agent 生命周期管理 |
| messageStore._conversationState | SessionStore.conversationState | 会话状态 |
| messageStore.status | SessionStore.status | 派生自 conversationState |
| runtimeStore.processing | SessionStore.processing | 派生自 conversationState |
| runtimeStore.agentActivity | AgentStateMachine.getCurrentMoments() | Moment 派生 |
| activeAgentStore | AgentStateMachine | 节点管理 + 状态机 |
| backgroundTaskStore | AsyncTaskStore | 统一 task/team |
| (散落在 messageStore) | CitationStore | Citation 缓存 |
| EventBridge (1022行) | EventAdapter (~120行) | 薄转发 |

---

## 四、迁移策略

### Phase 1：新建模块，与旧代码共存

```
Week 1-2: 创建 AgentStateMachine.ts + AsyncTaskStore.ts + SessionStore.ts
Week 1-2: 在 EventBridge 中添加新 handler（与旧 handler 同时监听，新旧并行）
Week 2: 创建 CitationStore.ts
```

### Phase 2：逐个切换组件

```
Week 2: 切换 StatusBar → AsyncTaskStore
Week 2: 删除 WorkspaceMonitor 目录（已被 ExecutionFlow 替代）
Week 2: 切换 ExecutionFlow → AgentStateMachine
Week 3: 切换 InputArea → 统一 sendMessage
```

### Phase 3：清理

```
Week 3-4: 删除 EventBridge 中的旧 handler（保留新 EventAdapter）
Week 3-4: 删除 messageStore 中的 _handleXxx 方法
Week 4: 删除 backgroundTaskStore、activeAgentStore、runtimeStore
Week 4: 删除 _conversationState 手动同步逻辑
```

### Feature Flag

```typescript
// 组件中
const useNewArchitecture = process.env.NEXT_PUBLIC_USE_NEW_ARCH === 'true';

if (useNewArchitecture) {
  const agents = useAgentStateMachine(s => s.agentMap);
} else {
  const mainAgent = useActiveAgentStore(s => s.mainAgent);
}
```

---

## 五、影响评估

| 文件 | 改造前 | 改造后 | 变化 |
|------|--------|--------|------|
| messageStore.ts | 1690 行 | ~200 行 | -88% |
| EventBridge.ts | 1022 行 | ~120 行 (EventAdapter) | -88% |
| runtimeStore.ts | ~200 行 | 删除 | 合并到 SessionStore |
| activeAgentStore.ts | ~250 行 | 删除 | 合并到 AgentStateMachine |
| backgroundTaskStore.ts | ~150 行 | 删除 | 合并到 AsyncTaskStore |
| AgentStateMachine.ts | 0 | ~300 行 | 新增 |
| AsyncTaskStore.ts | 0 | ~120 行 | 新增 |
| SessionStore.ts | 0 | ~100 行 | 新增 |
| CitationStore.ts | 0 | ~60 行 | 新增 |
| **总计** | **~3300 行** | **~900 行** | **-73%** |

**消除的防御代码**：
- `_promoteSubAgent` 6 处调用 + 5 分支 → 移除
- `findAgent` / `findAgentStatus` / `findAgentInTree` / `findParentId` → 移除（用 O(1) agentMap 替代）
- 3 秒展示缓冲 3 处实现 → 1 处
- 终态防御检查 7 处 → AgentStateMachine.transition 开头 1 处
- `_cleanedAgentIds` 黑名单 → 移除（终态检查替代）
- `team-exec-` 字符串 hack → taskType 字段
- `agent:thinking` / `agent:thinking-start` 重复 handler → 合并
- 前端三重状态变量 → 单一 SessionStore
- EventBridge 中 800+ 行业务逻辑 → EventAdapter 中 5 行/事件
