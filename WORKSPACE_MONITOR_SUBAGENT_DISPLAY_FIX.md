# WorkspaceMonitor 子 Agent 展示修复

## 问题描述

WorkspaceMonitor 无法正确展示子 agent 协调工作的场景：
1. 所有子 agent 都没有显示
2. 普通工具调用（read、write、bash）也被创建为节点
3. 子 agent 创建后立即消失

## 根本原因

### 问题 1：过滤逻辑错误
```typescript
// ❌ 旧逻辑：只显示 running 状态的工具
.filter((toolCall) => toolCall.status === 'running')
```

**问题：**
- `agent_team` 工具调用完成后，状态变为 `success`
- 但子 agent 还在运行中
- 导致子 agent 节点立即从拓扑图消失

### 问题 2：普通工具创建节点
```typescript
// ❌ 旧逻辑：所有工具都创建节点
return [{
  id: subId,
  name: toolCall.name,
  type: 'tool',
  // ...
}];
```

**问题：**
- read、write、bash 等普通工具也被创建为独立节点
- 应该只显示为主 agent 的动作标签

### 问题 3：ID 不匹配
- WorkspaceMonitor 使用复合 ID：`${toolCallId}-${memberId}`
- 事件处理器使用原始 ID：`memberId`
- 导致 activity 数据无法关联

## 当前工具分类

### 创建子 Agent 的工具（显示为节点）
1. **`task`** - 创建单个子 agent
2. **`agent_team`** - 创建多个子 agent 团队

### 普通工具（只显示为动作标签）
- `read`, `write`, `edit`, `multi_edit` - 文件操作
- `bash` - 命令执行
- `glob`, `grep` - 搜索
- `memory_search`, `memory_store` - 记忆操作
- `web_search`, `web_fetch` - 网络操作
- 等等...

## 修复方案

### 1. 智能过滤逻辑（WorkspaceMonitor/index.tsx）

```typescript
.filter((toolCall) => {
  // agent_team: 只要有成员还在运行就显示
  if (toolCall.name === 'agent_team') {
    const { members } = toolCall.multiAgent || {};
    if (members && members.length > 0) {
      const hasActiveMembers = members.some((m: any) =>
        m.status === 'idle' || m.status === 'running'
      );
      return hasActiveMembers;
    }
  }

  // task: 只在 running 时显示
  if (toolCall.name === 'task') {
    return toolCall.status === 'running';
  }

  // 其他工具不创建节点
  return false;
})
```

### 2. 只为子 Agent 创建节点（WorkspaceMonitor/index.tsx）

```typescript
.flatMap((toolCall): SubAgentData[] => {
  // agent_team: 创建多个子 agent 节点
  if (toolCall.name === 'agent_team' && toolCall.multiAgent) {
    const { members } = toolCall.multiAgent;
    return members.map((member: any): SubAgentData => ({
      id: `${toolCall.id}-${member.id}`,
      name: member.name,
      type: 'agent',
      // ...
      parentAgentId: 'main',
    }));
  }

  // task: 创建单个子 agent 节点
  if (toolCall.name === 'task') {
    return [{
      id: toolCall.id,
      name: `Task: ${description}`,
      type: 'agent',
      // ...
      parentAgentId: 'main',
    }];
  }

  // 其他工具不创建节点
  return [];
})
```

### 3. 统一 ID 策略（chatStore.ts）

```typescript
_handleTeamMemberStart: (data) => {
  const toolCallId = get()._teamIdMap[data.teamId];
  
  // 构建与 WorkspaceMonitor 一致的复合 ID
  const subAgentId = `${toolCallId}-${data.memberId}`;

  // 使用复合 ID 添加子 agent
  activeAgentStore.addSubAgent(mainAgent.id, {
    id: subAgentId,  // ✅ 复合 ID
    // ...
  });

  // 切换到子 agent
  activeAgentStore.setCurrentActiveAgent(subAgentId);

  // 初始化 activity（使用复合 ID）
  runtimeStore.setAgentMoment(subAgentId, { ... });
}
```

### 4. 动态路由工具事件（chatStore.ts）

```typescript
_handleAgentToolStart: (data) => {
  // 获取当前活跃的 agent ID（可能是主 agent 或子 agent）
  const currentAgentId = activeAgentStore.currentActiveAgentId || 'main';

  // 使用当前 agent ID 设置 activity
  actStore.setAgentMoment(currentAgentId, { ... });
  actStore.addTimelineEvent(currentAgentId, { ... });
}
```

### 5. 清理废弃工具类型（chatStore.ts）

移除了以下已废弃的工具：
- `orchestrate`
- `pipeline`
- `quick_team`
- `delegate`

## 修复效果

### agent_team 工具
```
用户：使用 agent_team 创建 3 个成员的团队分析代码
```

**预期结果：**
- ✅ 显示主 agent 节点
- ✅ 显示 3 个子 agent 节点
- ✅ 每个子 agent 显示实时工具调用动作（🗂 read、⚡ bash 等）
- ✅ 子 agent 完成后节点消失
- ✅ 时间条显示各个子 agent 的执行历史

### task 工具
```
用户：使用 task 工具分析这个文件
```

**预期结果：**
- ✅ 显示主 agent 节点
- ✅ 显示 1 个子 agent 节点（Task: 分析这个文件）
- ✅ 子 agent 显示实时工具调用动作
- ✅ 子 agent 完成后节点消失

### 普通工具
```
用户：读取 package.json 文件
```

**预期结果：**
- ✅ 只显示主 agent 节点
- ✅ 主 agent 显示 "🗂 read" 动作标签
- ❌ 不创建 read 工具的子节点

## 数据流

```
agent_team 工具调用
  ↓
toolCall.status = 'running'
  ↓
创建 3 个子 agent 节点（显示在拓扑图）
  ↓
agent_team 工具完成
  ↓
toolCall.status = 'success'
  ↓
检查 members[].status
  ↓
members 还在运行 → 继续显示节点 ✅
  ↓
子 agent 执行工具（read、bash 等）
  ↓
工具事件路由到子 agent ID
  ↓
子 agent 显示动作标签和时间条 ✅
  ↓
所有 members 完成 → 移除节点
```

## 修复文件

1. `xuanji/desktop/renderer/components/WorkspaceMonitor/index.tsx`
   - 智能过滤逻辑
   - 只为子 agent 创建节点

2. `xuanji/desktop/renderer/components/WorkspaceMonitor/types.ts`
   - 添加 `parentAgentId` 字段
   - 添加 `subAgents` 字段（为未来层级展示做准备）

3. `xuanji/desktop/renderer/stores/chatStore.ts`
   - 统一 ID 策略（使用复合 ID）
   - 动态路由工具事件
   - 清理废弃工具类型
   - 更新工具状态提示

## 测试验证

```bash
cd xuanji
npm run dev:gui
```

测试命令：
1. `请使用 agent_team 创建一个包含 3 个成员的团队来分析代码质量`
2. `使用 task 工具读取并分析 package.json`
3. `直接读取 README.md 文件`

## 后续优化

1. **多层级展示**：支持子 agent 创建更深层的子 agent（孙 agent）
2. **创建关系可视化**：显示 agent 之间的创建关系（不只是任务关系）
3. **性能优化**：大量子 agent 时的渲染优化
4. **状态持久化**：子 agent 完成后保留一段时间再消失
