# WorkspaceMonitor 子 Agent 协调展示修复

## 问题描述

WorkspaceMonitor 无法正确展示 agent_team 中各个子 agent 协调工作的场景。虽然 Hook 事件正确触发，但子 agent 的活动数据（currentMoment、momentHistory、timelineEvents）没有正确关联。

## 根本原因

**ID 不一致问题：**

1. **WorkspaceMonitor 构建子 agent 时**：
   - 使用复合 ID：`${toolCallId}-${memberId}`
   - 例如：`tool-123-architect`

2. **chatStore 事件处理时**：
   - `_handleTeamMemberStart` 使用原始 `memberId` 设置 activeAgent
   - 后续工具调用使用 `currentActiveAgentId`（原始 memberId）设置 activity
   - 例如：只用 `architect`

3. **结果**：
   - WorkspaceMonitor 查找 `tool-123-architect` 的 activity 数据
   - 但 activity 数据存储在 `architect` 下
   - 导致子 agent 显示为空白，没有动作标签、时间条等

## 修复方案

### 1. 统一使用复合 ID

**修改文件：** `xuanji/desktop/renderer/stores/chatStore.ts`

#### 修改 `_handleTeamMemberStart`：
```typescript
// 构建与 WorkspaceMonitor 一致的子 agent ID（复合 ID）
const subAgentId = `${toolCallId}-${data.memberId}`;

// 使用复合 ID 添加子 agent
activeAgentStore.addSubAgent(mainAgent.id, {
  id: subAgentId,  // ✅ 使用复合 ID
  name: data.role || data.memberId,
  status: 'thinking',
  // ...
});

// 切换到子 agent（使用复合 ID）
activeAgentStore.setCurrentActiveAgent(subAgentId);

// 为子 agent 初始化 WorkspaceMonitor activity（使用复合 ID）
runtimeStore.setAgentMoment(subAgentId, {
  type: 'thinking',
  icon: '💭',
  label: 'Starting',
  durationMs: 0,
  status: 'running',
});
```

#### 修改 `_handleTeamMemberEnd`：
```typescript
// 构建与 WorkspaceMonitor 一致的子 agent ID（复合 ID）
const subAgentId = `${toolCallId}-${data.memberId}`;

// 使用复合 ID 标记完成
activeAgentStore.setAgentStatus(subAgentId, 'done');

// 完成子 agent 的 WorkspaceMonitor activity（使用复合 ID）
runtimeStore.finishAgentMoment(subAgentId, status);
```

### 2. 动态路由工具调用事件

#### 修改 `_handleAgentToolStart`：
```typescript
// 获取当前活跃的 agent ID（可能是主 agent 或子 agent）
const currentAgentId = activeAgentStore.currentActiveAgentId || 'main';
const currentAgent = activeAgentStore.agents.get(currentAgentId);
const agentName = currentAgent?.name || 'Xuanji';

// 使用当前 agent ID 设置 activity
actStore.setAgentMoment(currentAgentId, { /* ... */ });
actStore.addTimelineEvent(currentAgentId, { /* ... */ });
```

#### 修改 `_handleAgentToolEnd`：
```typescript
// 获取当前活跃的 agent ID
const currentAgentId = activeAgentStore.currentActiveAgentId || 'main';

// 使用当前 agent ID 完成 activity
actStore.finishAgentMoment(currentAgentId, status);
actStore.finishTimelineEvent(currentAgentId, data.id, toolCallDuration ?? 0, status);
```

## 修复效果

修复后，WorkspaceMonitor 将能够：

1. ✅ **显示子 agent 节点**：每个 team member 显示为独立的圆形节点
2. ✅ **显示实时动作标签**：子 agent 执行工具时显示对应的图标和标签（🗂 read、⚡ bash 等）
3. ✅ **显示时间条事件**：子 agent 的工具调用历史显示在时间条上
4. ✅ **显示历史点阵**：子 agent 的动作历史以点阵形式展示
5. ✅ **显示状态变化**：子 agent 从 idle → running → success/error 的状态转换

## 数据流

```
TeamMemberStart Hook
  ↓
agent-bridge.ts (监听 Hook)
  ↓
IPC: agent:team-member-start
  ↓
main/index.ts (转发)
  ↓
renderer: chatStore._handleTeamMemberStart
  ↓
1. 构建复合 ID: `${toolCallId}-${memberId}`
2. activeAgentStore.addSubAgent(复合 ID)
3. activeAgentStore.setCurrentActiveAgent(复合 ID)
4. runtimeStore.setAgentMoment(复合 ID, ...)
  ↓
子 agent 工具调用
  ↓
chatStore._handleAgentToolStart
  ↓
使用 currentActiveAgentId (复合 ID) 设置 activity
  ↓
WorkspaceMonitor 读取
  ↓
agentActivity.currentMoments[复合 ID] ✅ 匹配成功
```

## 测试验证

运行以下命令测试：

```bash
cd xuanji
npm run dev:gui
```

在 GUI 中执行：
```
请使用 agent_team 工具，创建一个包含 3 个成员的团队来分析代码质量
```

预期看到：
- 主 agent 节点 + 3 个子 agent 节点
- 每个子 agent 显示实时工具调用动作
- 时间条显示各个子 agent 的执行历史
- 左下角事件流显示团队协作过程

## 相关文件

- `xuanji/desktop/renderer/stores/chatStore.ts` - 事件处理和路由
- `xuanji/desktop/renderer/stores/runtimeStore.ts` - Activity 状态管理
- `xuanji/desktop/renderer/components/WorkspaceMonitor/index.tsx` - 可视化渲染
- `xuanji/src/core/agent/team/TeamManager.ts` - Hook 事件触发
- `xuanji/desktop/main/agent-bridge.ts` - Hook 监听和 IPC 转发
