# 璇玑 (Xuanji) 业务逻辑与代码质量全面 Review

## 核心调用链路

```
用户输入 → ChatSession.handleUserInput() → StateTracker.transitionTo()
  → AgentLoop.run() → StreamPipeline → LLM
    → ToolGateway.executeBatch()
      → TaskOrchestrator (子Agent/团队)
  → EventBus.emit(XuanjiEvent.*)
    → agent-bridge.ts: registerHookEventBridge() → safeSend() → IPC
      → EventBridge.ts: messageBus.on() → messageStore / activeAgentStore / runtimeStore / bgTaskStore
```

---

## 问题一：防御式补丁代码替代了状态机流转

### 1.1 前端三重状态变量，各自独立维护

后端有干净的 `StateTracker`（`idle → executing → outputting → waiting_async`），但前端有三个分散的状态变量：

| 变量 | 位置 | 语义 |
|------|------|------|
| `messageStore._conversationState` | messageStore.ts | 后端 StateTracker 的镜像 |
| `messageStore.status` | messageStore.ts | idle / thinking / executing |
| `runtimeStore.processing` | runtimeStore.ts | boolean，是否在运行 |

这三者需要在所有事件 handler 中手动保持同步，例如：
- `sendMessage` 里显式管理 `runtimeStore.setProcessing(true)` (messageStore.ts:413)
- `_handleAgentThinking` 里同时 `setProcessing(true)` + 设置 `status: 'thinking'` (line 596-614)
- `_handleAgentEnd` 里同时 `setProcessing(false)` + `status: 'idle'` (line 1147, 1178)

**问题**：一个状态变更需要手动同步三个地方，任一遗漏就会导致 UI 状态不一致。`StateTracker` 的后端单源真相在前端被拆成了三个需要手动维护的副本。

### 1.2 `_promoteSubAgent()` 被6个不同 handler 调用作为存活证明

`_promoteSubAgent` (messageStore.ts:1198) 的设计意图是在事件到达时确认子 agent 节点存在，但调用点太多了：

- `_handleAgentToolStart` line 725 — "子 agent 的 tool-start 事件作为存活性证明"
- `agent:text` handler line 97 — "仅更新 workspace monitor 状态"
- `agent:thinking` handler line 137 — "提前创建子 agent 节点"
- `agent:subagent-text` handler line 364
- `agent:subagent-end` handler line 406
- `agent:thinking-start` handler line 736

该方法内部有5个分支处理不同情况：agent已存在、无pending条目、已清理、有pending、无parentId。这本质是因为事件到达顺序不可预测，而没有一个统一的状态机在事件到达前保证 agent 节点已创建。

### 1.3 `agent:thinking` handler 里的终态防御逻辑 (EventBridge.ts:143-155)

```typescript
const findAgentStatus = (agent: any, targetId: string): string | null => {
  // 递归搜索整个 agent 树...
};
const agentThinkingStatus = findAgentStatus(s.mainAgent, agentId);
if (agentThinkingStatus === 'success' || agentThinkingStatus === 'failed' || agentThinkingStatus === 'done') {
  // 终态 agent 的 thinking 事件不更新 moment
}
```

这个递归搜索 agent 树的代码**在同一文件中出现了 4 次**（lines 143, 385, 524, 542, 601, 626, 767），且逻辑意图相同：检查 agent 是否已经是终态，防止过时事件覆盖正确状态。

**根本原因**：子进程的 thinking 事件可能在 agent 已经结束后才到达（IPC 延迟），但没有一个状态机在 agent 变为终态时忽略后续事件——而是让每个事件 handler 自己做防御。

---

## 问题二：同一状态变更分散在多个 handler 中

### 2.1 子 Agent 节点创建分散在 5 个位置

| 位置 | 文件 | 触发条件 |
|------|------|----------|
| `_handleAgentToolStart` L878-903 | messageStore.ts | 异步 task 的 tool-end 到达 |
| `_promoteSubAgent` L1198-1263 | messageStore.ts | 被6个地方调用 |
| `_handleTeamStart` L1312-1341 | messageStore.ts | team-start 事件 |
| `_handleTeamMemberStart` L1352-1499 | messageStore.ts | team-member-start 事件 |
| `agent:subagent-start` L316-361 | EventBridge.ts | subagent-start 事件 + 3秒超时兜底 |

每一个创建点都有略微不同的初始化参数和状态设置逻辑，比如 multiAgent 数据的设置有时在创建时、有时在 `_promoteSubAgent` 后通过 `updateAgentMultiAgent` 补设 (line 1331)。

### 2.2 Moment（状态栏气泡）更新分散在 8 个位置

在 `messageStore.ts` 和 `EventBridge.ts` 中，`setAgentMoment` 的调用分散在以下各处，每处有略微不同的图标、标签、状态逻辑：

- `_handleAgentThinking` → '思考中' / '待汇报' moment
- `_handleAgentToolStart` → tool-specific moment（file/bash/task/team）
- `_handleAgentToolEnd` → finishTimelineEvent
- `agent:thinking` handler → 子 agent thinking moment
- `agent:thinking-start` handler → 排队延迟的 thinking moment
- `agent:subagent-end` handler → '待汇报' / '执行失败' moment
- `agent:task-failed` handler → '已取消' / '执行失败' moment
- `_handleTeamEnd` → 批量设置团队成员 moment

每个 handler 都在独立决定 moment 的 icon、label、status、startTime，没有统一的 "agent 进入某状态时 moment 应该如何" 的规则。

### 2.3 BackgroundTaskStore 的状态转换与 Agent 生命周期耦合在 EventBridge 中

`EventBridge.ts` 每个 multi-agent 事件 handler 都同时操作 `backgroundTaskStore` 和 `messageStore`：

```typescript
// agent:team-member-start handler (EventBridge.ts:253-277)
messageBus.on('agent:team-member-start', (data) => {
  const bgStore = useBackgroundTaskStore.getState();  // 先操作 bgStore
  // 清理重复 task...
  // transitionTask...
  // transitionMember...
  useMessageStore.getState()._handleTeamMemberStart(data);  // 再操作 messageStore
});
```

`backgroundTaskStore` 的注释说它是 "三个 UI 维度的单一数据源"，但它的状态转换不是由自身驱动的——是被 EventBridge 中的每个 handler 手动触发的。正确做法是 `backgroundTaskStore` 自己监听 agent 生命周期事件（或者 messageStore 的状态变更），而不是让 EventBridge 来手动协调两个 store。

---

## 问题三：重复实现相同逻辑

### 3.1 `agent:thinking` 和 `agent:thinking-start` 几乎完全重复

两个 handler 都包含：
- `markTaskDisplayStart` 3秒缓冲逻辑
- `agentThinkingBuffer` 累加逻辑
- `setAgentMoment` thinking moment 设置
- `setAgentThought` 追加
- 终态 agent 检查（递归搜索树）

唯一区别是 `agent:thinking-start` 额外处理 `_autoSummarizeActive` 时的子 agent 清理。这两个应该合并为一个统一事件。

### 3.2 `findAgent` / `findAgentStatus` / `findAgentInTree` / `findParentId` — 同一棵树被4种方式搜索

| 函数 | 出现文件 | 出现次数 |
|------|----------|----------|
| `findAgent` (检查是否存在) | messageStore.ts | 3次 (L1205, L1369, L1437) |
| `findParentId` (找父节点) | messageStore.ts | 2次 (L1554, L1626) |
| `findAgentStatus` (获取状态) | EventBridge.ts | 2次 (L144, L767) |
| `findAgentInTree` (返回节点对象) | EventBridge.ts | 1次 (L385) |

这些函数都在 `activeAgentStore.mainAgent` 的 subAgents 树上做递归搜索，但以不同方式重复实现。应该统一为 `activeAgentStore` 上的方法。

### 3.3 3秒任务展示缓冲逻辑写了 3 遍

`agent:thinking` handler (L168-181)、`agent:thinking-start` handler (L742-756)、以及 `_handleAgentThinking` 中对子 agent 的缓冲区管理（L592-616 中的 early return），都实现了 "任务文本展示至少 3 秒，思考内容先缓冲" 的逻辑。这个逻辑应该封装成一个工具函数或集成到 `activeAgentStore` 中。

### 3.4 tool-end 后的状态同步逻辑写了 2 遍

`_handleAgentToolEnd` 中 `currentStreamingId` 存在和不存在时有两套完全不同的 `set()` 调用（L987-1009），逻辑相似但实现不同。`currentStreamingId` 为 null 时需要反向查找最后一条 assistant 消息，这是一个 hack——正确做法是确保 `currentStreamingId` 始终在 tool start 前创建好。

---

## 架构改进建议

### 1. 建立统一的 Agent 生命周期状态机

```
         ┌──────────┐
         │  pending  │  (subagent-start 到达)
         └────┬─────┘
              ▼
         ┌──────────┐
    ┌───▶│ thinking  │◀──┐ (thinking 事件、工具结束)
    │    └────┬─────┘   │
    │         ▼         │
    │    ┌──────────┐   │
    │    │ executing │───┘ (tool-start)
    │    └────┬─────┘
    │         ▼
    │    ┌──────────┐
    └────│ writing   │  (text 事件)
         └────┬─────┘
              ▼
         ┌──────────┐
         │ reporting │  (subagent-end，等待汇报)
         └────┬─────┘
              ▼
         ┌──────────┐
         │  cleared  │  (auto-summarize 清理)
         └──────────┘
```

每个 `AgentState.status` 变更时，**在 activeAgentStore 内部统一派发 moment、timeline、bgTask 等 UI 状态**，而不是让 EventBridge 的各个 handler 各自操作。

### 2. 合并 `agent:thinking` 和 `agent:thinking-start`

`agent:thinking-start` 应该被消除。子 agent 清理逻辑应该在 `agent:auto-summarize-start` handler 中独立完成，thinking 事件只负责更新思考和 moment。

### 3. 将树搜索统一到 activeAgentStore

```typescript
// activeAgentStore 应提供：
findAgentById(id: string): AgentState | null
findParentId(id: string): string | null
getAgentStatus(id: string): AgentStatus | null
isTeamMember(id: string): boolean
```

消除 messageStore.ts 和 EventBridge.ts 中散落的递归搜索函数。

### 4. EventBridge 应该只做事件→store 方法的薄转发

当前 EventBridge 的 handler 中包含了大量业务逻辑（判断是否是团队成员、计算 moment、管理 bgTask 生命周期）。这些应该下沉到对应的 store 中：

```typescript
// 当前（EventBridge 中有业务逻辑）:
messageBus.on('agent:subagent-end', (data) => {
  const isTeamMember = /* 递归搜索树判断 */;
  if (!isTeamMember) {
    bgStore.transitionTask(...);
    // 设置 moment...
  }
  messageStore._handleSubAgentEnd(data);
});

// 改进后（EventBridge 只转发）:
messageBus.on('agent:subagent-end', (data) => {
  messageStore._handleSubAgentEnd(data); // 内部处理所有逻辑
});
```

### 5. 消除 `_conversationState` 的手动维护

前端不应维护 `_conversationState` 的副本。`messageStore.status` 应该直接从后端 StateTracker 的状态推导，而不是在多个 handler 中分别 set。

---

## 总结优先级

| 优先级 | 问题 | 影响 |
|--------|------|------|
| **P0** | `_promoteSubAgent` 被6处调用，事件顺序不可控 | 子 agent 节点可能重复创建、状态覆盖 |
| **P0** | 同一逻辑3次重复（thinking 缓冲、树搜索） | 修改一处需要同步改多处，极易遗漏 |
| **P1** | 前端三重状态变量分散维护 | 状态不一致风险 |
| **P1** | EventBridge handler 中业务逻辑过重 | 违反单一职责，测试困难 |
| **P2** | Moment 更新分散在 8 个位置 | 图标/标签不一致 |

核心原则：**事件驱动架构中，事件的消费者应该只管自己的状态迁移，不应去猜测其他消费者的状态。** 当前代码的问题在于每个事件 handler 都在防御性地处理所有可能的状态组合，这恰恰说明缺少一个统一的状态机来保证事件到达时的系统状态是可预期的。
