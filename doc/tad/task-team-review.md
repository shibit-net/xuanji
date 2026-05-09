# Task / Agent Team 生命周期与展示 Review

## 一、核心调用链路全景图

### Task（子 Agent）完整生命周期

```
                      后台执行线（异步）
                      ═══════════════════════════════════════════════
TaskTool.executeAsync()
  └─ TaskOrchestrator.startTask(groupId, executor)
       └─ executor(abortSignal):
            └─ AgentFactory.createAndRun(agentId, options)
                 ├─ emit HOOK_SUBAGENT_START ──────────────▶ agent:subagent-start (IPC)
                 │                                                ├─ bgStore.registerTask
                 │                                                ├─ msgStore._pendingSubAgents[id]
                 │                                                └─ setTimeout(3s) → _promoteSubAgent
                 │
                 ├─ emit HOOK_SUBAGENT_TEXT (streaming) ───▶ agent:subagent-text (IPC)
                 │                                                ├─ _promoteSubAgent (存活证明)
                 │                                                └─ if streamToUser → 创建气泡
                 │
                 └─ emit HOOK_SUBAGENT_END ───────────────▶ agent:subagent-end (IPC)
                      ├─ 成功: bgStore.transitionTask('completed')
                      │        activeAgentStore.setAgentStatus('success')
                      │        设置 '待汇报' moment
                      │
                      └─ 失败: bgStore.transitionTask('completed')
                               activeAgentStore.setAgentStatus('failed')
                               设置 '执行失败' moment
                               延迟移除节点(3s)

  └─ TaskOrchestrator.onTaskComplete()
       └─ emit ASYNC_TASK_COMPLETED / ASYNC_TASK_FAILED
            └─ TaskCompletionHandler.handleCompletion()
                 ├─ pendingCompletions.push(result)
                 ├─ citations → onCitationData callback
                 └─ if !isAutoSummarize && !isRunning():
                      └─ autoSummarize()
                           ├─ systemPromptSuffix('async-task-completion')
                           ├─ onAutoSummarize(subAgentId, groupId) ──▶ agent:auto-summarize-start (IPC)
                           │    ├─ bgStore.transitionTask('cleared')
                           │    ├─ activeAgentStore.removeSubAgent
                           │    └─ 清理 pendingSubAgents / citationOutputs / moment
                           │
                           └─ onRun('[系统通知]...') → 触发主 agent 自动汇报
```

关键时序问题：`agent:subagent-end` 和 `agent:auto-summarize-start` 之间存在窗口期。subagent-end 将状态设为 `success` + '待汇报' moment，auto-summarize-start 最终清理节点。如果用户在此期间发送新消息触发了新一轮 agent run，就会出问题。

---

### Agent Team 完整生命周期

```
TeamTool.executeAsync()
  └─ TaskOrchestrator.startTask(groupId, executor)
       └─ executor(abortSignal):
            ├─ TeamManager.createTeam(config)
            │    └─ emit HOOK_TEAM_START ─────────────────▶ agent:team-start (IPC)
            │         ├─ bgStore.registerTask(team)
            │         └─ _handleTeamStart:
            │              ├─ 为每个 member 调用 activeAgentStore.addSubAgent
            │              ├─ 设置 multiAgent 数据
            │              └─ 设置初始 '等待执行' moment
            │
            ├─ 注册 HookRegistry 监听器:
            │    ├─ TeamMemberStart → updateMemberStatus('running')
            │    └─ TeamMemberEnd → updateMemberStatus('completed'/'failed')
            │
            ├─ TeamManager.execute(goal, signal)
            │    │
            │    ├─ 每个 member 开始:
            │    │    └─ emit HOOK_TEAM_MEMBER_START ────▶ agent:team-member-start (IPC)
            │    │         ├─ bgStore.transitionMember('running')
            │    │         └─ _handleTeamMemberStart:
            │    │              ├─ agentExists → setAgentStatus('thinking')
            │    │              └─ !agentExists → addSubAgent + setAgentStatus('thinking')
            │    │
            │    ├─ 每个 member 结束:
            │    │    └─ emit HOOK_TEAM_MEMBER_END ──────▶ agent:team-member-end (IPC)
            │    │         ├─ bgStore.transitionMember('completed')
            │    │         └─ _handleTeamMemberEnd:
            │    │              ├─ 设置 member 终态 (success/failed)
            │    │              └─ 不设置 reporting moment（等 team-end）
            │    │
            │    └─ 团队整体结束:
            │         └─ emit HOOK_TEAM_END ────────────▶ agent:team-end (IPC)
            │              ├─ bgStore: 批量 transitionMember + transitionTask('completed')
            │              └─ _handleTeamEnd:
            │                   ├─ 递归查找所有 team 成员
            │                   ├─ 统一设置 '待汇报' / '已取消' moment
            │                   └─ 失败/取消时延迟 cleanup (3s)

  └─ TaskOrchestrator.onTaskComplete()
       └─ emit ASYNC_TASK_COMPLETED / ASYNC_TASK_FAILED
            └─ TaskCompletionHandler (同 task 流程)
                 └─ autoSummarize()
                      └─ onAutoSummarize('team-exec-*') ──▶ agent:auto-summarize-start (IPC)
                           └─ 匹配 teamName，批量清理所有成员节点
```

---

## 二、核心问题

### 问题 1：生命周期事件到达顺序不可靠，导致大量防御代码

**表现形式**：`_promoteSubAgent()` 被 6 处调用，`_cleanedAgentIds` 黑名单机制，`findAgentInTree` 重复递归搜索。

**根因**：sub-agent 的生命周期事件通过 IPC 异步到达渲染进程，到达顺序可能乱序：

```
预期顺序: subagent-start → thinking → tool-start → tool-end → subagent-end → auto-summarize-start
实际可能: thinking → subagent-start → tool-start → subagent-end → auto-summarize-start → thinking(迟到)
```

思考事件可能先于 subagent-start 到达，因为 thinking 通过 EventBus 事件直接发出，而 subagent-start 需要经过 AgentFactory.createAndRun() 的初始化流程。

每个 handler 的防御逻辑都在尝试修复这个乱序问题：

- `_promoteSubAgent` 在 thinking/text/tool-start/subagent-end 中被反复调用（"如果 agent 还不存在就创建"）
- `agent:thinking` handler 递归查找 agent 终态（"如果 agent 已是终态就不更新"）
- `_handleTeamMemberStart` 区分 agentExists/!agentExists 两条路径（"如果已被 team-start 创建了就激活，否则新建"）
- `_handleTeamEnd` 中`_cleanedAgentIds` 阻止重新创建已清理的 agent

**正确做法**：在渲染进程侧实现一个简单的状态机，保证：
1. agent 节点在 subagent-start 事件时**必定创建**（即使后续事件先到，也入队等待 subagent-start 到达后处理）
2. agent 进入终态后，忽略所有后续事件
3. 消除 `_cleanedAgentIds` 黑名单机制

---

### 问题 2：task 和 agent_team 的前端展示逻辑分裂为两条独立链路

**表现形式**：

| 维度 | task | agent_team |
|------|------|------------|
| 节点创建 | `_handleAgentToolEnd` + `_promoteSubAgent` | `_handleTeamStart` 一次性创建所有成员 |
| 状态管理 | `activeAgentStore.setAgentStatus` | 同样用 `activeAgentStore.setAgentStatus` |
| multiAgent 数据 | 无（task 没有 teamName 等） | 有（type, strategy, teamName, memberId...） |
| 终态 moment | `agent:subagent-end` handler 中设置 | `_handleTeamEnd` 中**统一批量**设置 |
| 节点清理 | `agent:auto-summarize-start` 单个清理 | `agent:auto-summarize-start` 批量清理 |
| 后台任务 | bgStore(type='task') | bgStore(type='team') |

但实际上 task 和 agent_team 的后台执行模型完全相同：
- 都通过 `TaskOrchestrator.startTask()` 启动
- 都通过 `TaskCompletionHandler.autoSummarize()` 通知主 agent
- 都通过 `agent:auto-summarize-start` 清理前端节点
- 唯一区别：team 有多个成员，task 只有一个

**问题**：两者的前端展示处理分散在不同的 handler 中（`_handleAgentToolEnd` vs `_handleTeamStart/TeamMemberStart/TeamMemberEnd/TeamEnd`），但后台模型几乎一致。`_handleTeamMemberEnd` 和 `agent:subagent-end` handler 的逻辑相似但细节不同（比如 team member 不设置 reporting moment 而 task 设置）。

**建议**：task 应该被视为 team 的特例（只有一个成员的 team），统一生命周期管理。

---

### 问题 3：`agent:auto-summarize-start` 逻辑同时处理 task 和 team 两种清理，通过 subAgentId 前缀区分

**代码位置**：EventBridge.ts:594-683

```typescript
if (data.subAgentId.startsWith('team-exec-')) {
  // team 级别汇总：找到 teamName 匹配的所有成员一起清理
  const teamName = data.subAgentId.replace('team-exec-', '').replace(/-?\d+$/, '');
  // ... 正则提取 teamName，递归查找成员 ...
} else {
  // 单个 task 子 agent 清理
}
```

**问题**：
1. 用字符串前缀 `team-exec-` 区分类型是 hack，应该用明确的 type 字段
2. `replace(/-?\d+$/, '')` 正则提取 teamName 依赖 teamName 中不能有数字结尾的约定，脆弱
3. 同一 handler 中两种清理路径各自维护一套 `_cleanedAgentIds`、`agentTaskDisplayStart`、`agentThinkingBuffer` 等清理逻辑

---

### 问题 4：`backgroundTaskStore` 的注释说它是"三个 UI 维度的单一数据源"，但实际上不是

**文件**：backgroundTaskStore.ts

注释声称：
> 统一管理 task / agent_team 创建的后台任务，作为 React Flow 节点、状态栏计数、moment 气泡三个 UI 维度的单一数据源。

但实际上：
- React Flow 节点的增减由 `activeAgentStore` 的 `addSubAgent`/`removeSubAgent` 驱动，不读 bgStore
- 状态栏计数由 `bgStore.getRunningCount()` / `getCompletedCount()` 驱动，这部分是对的
- Moment 气泡由 `runtimeStore.setAgentMoment` 驱动，不读 bgStore

三个 UI 维度实际上各自有不同的数据源：
- **ExecutionFlow 面板** → `activeAgentStore` 的树形结构
- **StatusBar 计数** → `backgroundTaskStore`
- **WorkspaceMonitor moment** → `runtimeStore.agentActivity`

这三个 store 之间的同步需要在 EventBridge handler 中手动协调，而不是 bgStore 自动驱动。

---

### 问题 5：`TaskCompletionHandler` 的自动汇报与用户新消息存在竞态

**TaskCompletionHandler.autoSummarize()** (TaskCompletionHandler.ts:136-180)：

```typescript
private async autoSummarize(): Promise<void> {
  this.isAutoSummarizeRun = true;
  
  // 注入 system prompt hint
  this.contextManager.setSystemPromptSuffix(hint, 'async-task-completion');
  
  // 通知前端 auto-summarize-start → 清理节点
  this.callbacks.onAutoSummarize?.(subAgentId, completion.groupId);
  
  // 触发主 agent 自动汇报
  await this.callbacks.onRun?.('[系统通知]...');
  
  // 如果还有 pending，再次触发
  if (this.pendingCompletions.length > 0) {
    this.autoSummarize();
  }
}
```

**问题场景**：
1. 子 agent 完成 → `autoSummarize()` 被触发 → 注入 hint + 清理节点
2. 但此时主 agent 的 `AgentLoop` 可能正在执行工具或输出文本
3. `callbacks.onRun?.()` 被调用时，`ChatSession.run()` 因为有 reentrancy guard 会把消息入队
4. 此时 `StateTracker` 被 `onRun` 内部的 `onText` 回调从 `idle` 转为 `outputting`
5. 前端 `agent:auto-summarize-start` handler 里调用 `activeAgentStore.removeSubAgent()` 清理节点
6. 但如果用户此时发送了新消息，`ChatSession.handleUserInput()` 的 `waiting_async` 分支会清理 `async-task-completion` suffix
7. 然后 `TaskCompletionHandler` 的新 auto-summarize 又会注入新的 suffix

这个多个异步流程交叉运行的场景非常容易出错。

---

### 问题 6：AgentTeam 的成员创建时机和前端节点的对应关系不一致

**Team 有两个并行的"成员列表"概念**：

1. **TeamManager 内部**的 `TaskMember[]` — 在 `buildMembers()` 中从 LLM 输入解析
2. **前端 activeAgentStore** 的 AgentState 树 — 通过 `_handleTeamStart` → `addSubAgent()` 创建

这导致 `_handleTeamStart` (messageStore.ts:1266-1350) 中需要手动同步两个数据结构：

```typescript
// _handleTeamStart 中：
data.members.forEach((member: any) => {
  const subAgentId = member.subAgentId || member.id;
  // ... 创建 frontend node
  activeAgentStore.addSubAgent(parentAgentId, { id: subAgentId, ... });
  
  // 然后再补设 multiAgent 数据（因为 _promoteSubAgent 可能先到并创建了裸节点）
  activeAgentStore.updateAgentMultiAgent(subAgentId, multiAgentData);
});
```

`updateAgentMultiAgent` (line 1331) 是一个补丁调用 — 它存在是因为 `_promoteSubAgent` 可能在 `_handleTeamStart` 之前被 `agent:tool-start` handler 调用，创建了一个没有 multiAgent 数据的裸节点。之后 team-start 到达时需要补设 multiAgent 字段才能让 buildFlow 正确识别为团队成员。

这是事件乱序的又一个症状。

---

### 问题 7：失败成员的清理延迟逻辑重复

**task 失败** → `agent:subagent-end` handler (EventBridge.ts:400-440)：
- 3s 延迟移除节点

**task 取消** → `agent:task-failed` handler (EventBridge.ts:528-565)：
- 3s 延迟移除节点

**team 失败/取消** → `_handleTeamEnd` (messageStore.ts:1623-1653)：
- 3s 延迟移除所有成员节点

三段延迟清理代码各自用 `setTimeout` 独立管理，延迟时间都是 3000ms 但没有共享常量。

---

### 问题 8：`AGENT_TOOL_END` 事件同时承载同步和异步结果

在 `AgentLoop.ts:280`：
```typescript
eventBus.emitSync(XuanjiEvent.AGENT_TOOL_END, {
  id: tc.id, name: tc.name, result: toolResult.content,
  isError: toolResult.isError, agentId: this._userId,
  metadata: toolResult.metadata,
});
```

对于 task/agent_team 工具，这个事件携带了 `metadata.taskAsync: true` 和 `metadata.subAgentId`。前端 `_handleAgentToolEnd` (messageStore.ts:807) 需要通过检查这些 metadata 来决定是否将 tool 标记为完成还是保持 running：

```typescript
const isAsyncTask = (data.name === "task" || data.name === "agent_team") && 
  !!((data as any).metadata)?.taskAsync;

if (isAsyncTask) {
  toolCall.status = 'running';  // 保持 running，等子 agent 通知
} else {
  toolCall.status = data.isError ? 'error' : 'success';
}
```

同一个 `AGENT_TOOL_END` 事件承载了两种根本不同的语义，前端需要解析 metadata 来判断走哪条分支。这应该用两个不同的事件类型。

---

## 三、改进建议

### 优先级 P0 — 统一 Task/Team 生命周期状态机

建立统一的异步任务生命周期：

```
                                     TaskOrchestrator.startTask()
                                              │
                                              ▼
  pending ──▶ running ──▶ completed ──▶ summarized ──▶ cleared
                 │            │
                 └──▶ cancelled ──▶ (3s 展示) ──▶ cleared
```

每个状态转换由 TaskOrchestrator 统一发送一个 `ASYNC_TASK_STATE_CHANGED` 事件（而不是分散的 subagent-start/subagent-end/team-start/team-end/auto-summarize-start），前端所有 store 统一监听这一个事件来更新。

### 优先级 P0 — 前端只维护一份 agent 节点状态

当前 agent 节点的信息分散在：
- `activeAgentStore`（节点树、status）
- `runtimeStore.agentActivity.currentMoments`（moment 气泡）
- `backgroundTaskStore`（任务生命周期）
- `messageStore._pendingSubAgents` / `_taskParentMap` / `_streamToUserMap` / `_cleanedAgentIds`

建议：`activeAgentStore` 成为唯一数据源。moment、timeline、background task 状态都从 `AgentState` 派生，而不是独立维护。

### 优先级 P1 — 消除字符串 hack

1. `team-exec-` 前缀 → 改用 `{ type: 'task' | 'team', groupId, subAgentId }` 结构体
2. `replace(/-?\d+$/, '')` 正则提取 teamName → 在 event payload 中直接传 teamName
3. `metadata.taskAsync` 语义判断 → 用独立事件 `TOOL_ASYNC_TASK_CREATED`

### 优先级 P1 — 统一清理逻辑

task 和 team 的节点清理统一到 `activeAgentStore.cleanupCompletedAgent()` 方法，延迟时间统一为常量。

### 优先级 P2 — 减少递归搜索

`findAgent` / `findAgentStatus` / `findAgentInTree` / `findParentId` 统一到 `activeAgentStore` 的内置方法，使用 Map 做 O(1) 查找而非 O(n) 递归。
