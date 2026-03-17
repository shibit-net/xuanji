# GUI执行面板重新设计

## 实施日期
2026-03-15

## 设计理念

**双区域布局**：
- **左侧**：仅展示输入和最终输出的结果（对话气泡式界面）
- **右侧**：展示运行中的状态（执行过程面板）

```
┌────────────────────────────────────────────────────────┐
│                   Xuanji Desktop                       │
├──────────────────────┬─────────────────────────────────┤
│                      │                                 │
│   左侧：对话展示       │   右侧：执行过程展示             │
│                      │                                 │
│   ┌──────────────┐   │   ┌───────────────────────┐    │
│   │ 用户输入      │   │   │ Tab: 执行树 | 工具 |  │    │
│   └──────────────┘   │   │      TODO | 权限 | 系统│    │
│                      │   └───────────────────────┘    │
│   ┌──────────────┐   │                                 │
│   │ 最终输出结果  │   │   ┌───────────────────────┐    │
│   │              │   │   │ Agent执行树            │    │
│   │ (Markdown)   │   │   │ ├─ Main Agent (运行中)│    │
│   │              │   │   │ └─ Sub Agent (完成)   │    │
│   └──────────────┘   │   └───────────────────────┘    │
│                      │                                 │
│   ┌──────────────┐   │   ┌───────────────────────┐    │
│   │ 用户输入      │   │   │ 工具调用详情           │    │
│   └──────────────┘   │   │ - 输入参数            │    │
│                      │   │ - 输出结果            │    │
│   ┌──────────────┐   │   │ - 执行时长            │    │
│   │ 最终输出结果  │   │   └───────────────────────┘    │
│   └──────────────┘   │                                 │
│                      │   ┌───────────────────────┐    │
└──────────────────────┴───│ Token统计 | 成本      │────┘
                           └───────────────────────┘
```

## 架构设计

### Store 分工

#### chatStore（左侧）
- **职责**：管理对话消息，展示最终输出
- **数据**：
  - messages: Message[] - 对话消息列表
  - status: 'idle' | 'thinking' | 'executing' - 当前状态
  - permissionRequest/planReviewRequest/askUserRequest - 权限交互弹窗数据
- **特点**：
  - 仅保留完整的用户输入和助手响应
  - 气泡式展示，Markdown渲染
  - 不展示中间执行过程

#### executionStore（右侧）
- **职责**：管理执行过程，展示实时状态
- **数据**：
  - rootAgent: AgentExecutionNode - Agent执行树
  - toolExecutions: ToolExecution[] - 工具调用记录
  - todos: TodoItem[] - TODO列表
  - permissionInteractions: PermissionInteraction[] - 权限交互历史
  - systemStatus: SystemStatus - 系统状态（Token/成本/MCP）
- **特点**：
  - 完整记录所有执行过程
  - 按分类/状态分组展示
  - 支持展开查看详细信息

### ExecutionPanel 组件（右侧面板）

#### 5个Tab页

**1. 执行树 (Agent Tree)**
- 递归展示Agent层级（Main Agent → Team Agent → Sub Agent）
- 每个节点显示：
  - 状态图标（运行中/完成/失败）
  - Agent名称和类型标签
  - 当前执行任务（currentTask）
  - 执行时长
- 支持展开/折叠子节点

**2. 工具 (Tools)**
- 按工具分类分组展示（7个分类）：
  - 📄 文件操作 (Read/Write/Edit/Glob/Grep/LS/NotebookEdit)
  - 💻 Shell命令 (Bash/TaskOutput)
  - 🧠 记忆管理 (MemoryStore/MemorySearch)
  - 📂 会话管理 (ExitPlanMode/EnterPlanMode/Worktree)
  - 🛡️ 权限交互 (AskUser/PlanReview)
  - 👥 Agent管理 (QuickTeam/Orchestrate/Pipeline/Delegate/MatchAgent/ListAgents/TodoList/TodoUpdate/TodoStorage)
  - ❓ 其他工具
- 每个工具调用显示：
  - 状态图标（运行中/成功/失败）
  - 工具名称
  - 执行时长
  - 展开查看：输入参数、输出结果、Agent名称
- 顶部统计：执行中/成功/失败数量

**3. TODO**
- 按状态分组展示（4个状态）：
  - 🔄 进行中
  - ⏳ 待处理
  - ✅ 已完成
  - ❌ 失败
- 顶部进度条：完成数/总数 (百分比)
- 每个TODO项显示：
  - 状态图标
  - subject（标题）
  - activeForm（正在做什么，仅进行中时显示）
  - 执行时长
  - 展开查看：description（详细描述）

**4. 权限 (Permissions)**
- 展示所有权限交互历史
- 按时间倒序排列
- 类型：
  - 🛡️ 文件/命令权限 (permission)
  - 📋 Plan审查 (plan-review)
  - 💬 用户问答 (ask-user)
- 每条记录显示：
  - 状态图标（待审批/已批准/已拒绝）
  - 类型标签
  - 请求时间
  - 响应时长
  - 展开查看：请求数据详情（JSON格式）
- 顶部统计：待审批/已批准/已拒绝数量

**5. 系统 (System)**
- Token使用统计（3列布局）：
  - 输入Token
  - 输出Token
  - 缓存Token
- 成本统计：$X.XXXX
- 当前迭代次数
- MCP服务器状态（如果有）：
  - 服务器名称
  - 连接状态（已连接/已断开）
  - 工具数量

## 事件连接

### 从chatStore到executionStore的同步

所有Agent流式事件在chatStore处理后，同时更新executionStore：

```typescript
// 工具开始
onAgentToolStart → {
  chatStore: 更新activeToolCalls, status='executing'
  runtimeStore: addToolCall()
  executionStore: addToolExecution() // 🆕
}

// 工具结束
onAgentToolEnd → {
  chatStore: 更新toolCall状态, 记录日志
  runtimeStore: updateToolCall()
  executionStore: updateToolExecution() // 🆕
}

// Token使用
onAgentUsage → {
  runtimeStore: updateTokenUsage()
  executionStore: updateTokenUsage() // 🆕
}

// Agent结束
onAgentEnd → {
  chatStore: status='idle', 清空流式状态
  runtimeStore: updateTokenUsage(), setCost(), setProcessing(false)
  executionStore: updateCost(), incrementIteration() // 🆕
}

// 权限请求
onPermissionRequest → {
  chatStore: setPermissionRequest()
  executionStore: addPermissionRequest(type='permission') // 🆕
}

onPlanReviewRequest → {
  chatStore: setPlanReviewRequest()
  executionStore: addPermissionRequest(type='plan-review') // 🆕
}

onAskUserRequest → {
  chatStore: setAskUserRequest()
  executionStore: addPermissionRequest(type='ask-user') // 🆕
}
```

## 工具分类推断

基于工具名称自动推断分类（`inferToolCategory`函数）：

```typescript
function inferToolCategory(toolName: string): ToolExecution['category'] {
  // 文件操作
  if (/^(Read|Write|Edit|MultiEdit|Glob|Grep|LS|NotebookEdit)$/i.test(toolName)) {
    return 'file';
  }

  // Bash命令
  if (/^(Bash|TaskOutput)$/i.test(toolName)) {
    return 'bash';
  }

  // 记忆管理
  if (/^(MemoryStore|MemorySearch)$/i.test(toolName)) {
    return 'memory';
  }

  // 会话管理
  if (/^(ExitPlanMode|EnterPlanMode|Worktree)$/i.test(toolName)) {
    return 'session';
  }

  // 权限交互
  if (/^(AskUser|PlanReview)$/i.test(toolName)) {
    return 'permission';
  }

  // Agent管理
  if (/^(QuickTeam|Orchestrate|Pipeline|Delegate|MatchAgent|ListAgents|TodoList|TodoUpdate|TodoStorage)$/i.test(toolName)) {
    return 'agent';
  }

  // 其他
  return 'other';
}
```

## 数据结构

### ToolExecution（扩展）

```typescript
export interface ToolExecution {
  id: string;
  name: string;
  agentId: string;
  agentName: string;
  status: 'pending' | 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  duration?: number;
  input?: Record<string, unknown>;  // 🆕 输入参数
  result?: string;                  // 🆕 输出结果
  isError?: boolean;
  category?: 'file' | 'bash' | 'memory' | 'session' | 'permission' | 'agent' | 'other'; // 🆕
}
```

### PermissionInteraction（新增）

```typescript
export interface PermissionInteraction {
  id: string;
  type: 'permission' | 'plan-review' | 'ask-user';
  status: 'pending' | 'approved' | 'rejected';
  requestTime: number;
  respondTime?: number;
  data: any; // 原始请求数据
  response?: any; // 用户响应
}
```

### SystemStatus（新增）

```typescript
export interface SystemStatus {
  tokenUsage: {
    input: number;
    output: number;
    cached: number;
  };
  cost: number;
  mcpServers: Array<{
    name: string;
    status: 'connected' | 'disconnected';
    toolsCount: number;
  }>;
  currentIteration: number;
}
```

## 实现文件

| 文件 | 变更 |
|------|------|
| `desktop/renderer/stores/executionStore.ts` | ✅ 扩展接口、添加权限交互和系统状态管理 |
| `desktop/renderer/components/ExecutionPanel.tsx` | ✅ 完全重写，5个Tab页 |
| `desktop/renderer/stores/chatStore.ts` | ✅ 导入executionStore，同步事件 |

## 总结

### 设计亮点

1. **清晰的职责分离**：
   - 左侧专注最终结果展示（用户友好）
   - 右侧专注执行过程展示（调试友好）

2. **完整的执行过程可视化**：
   - Agent层级（执行树）
   - 工具调用（按分类分组）
   - TODO进度
   - 权限交互历史
   - 系统状态统计

3. **细粒度的信息展示**：
   - 工具输入/输出参数完整展示
   - 所有时长统计精确到毫秒
   - 状态图标实时更新
   - 支持展开/折叠，按需查看详情

4. **分类分组**：
   - 工具按7个类别自动分组
   - TODO按4个状态分组
   - 权限按3个类型展示
   - 便于快速定位关注的信息

5. **统计概览**：
   - 每个Tab顶部都有统计信息
   - Token使用、成本、迭代次数一目了然
   - 进度条直观展示TODO完成度

### 用户体验提升

- **左侧**：对话式交互，聚焦最终结果，不被中间过程干扰
- **右侧**：完整执行日志，调试时可查看任何细节
- **双向同步**：所有事件实时更新，无延迟
- **可折叠设计**：支持按需展开详情，避免信息过载

### 后续优化建议

1. **SubAgent事件**（需要后端支持）：
   - `agent:sub-agent-start` - SubAgent开始
   - `agent:sub-agent-end` - SubAgent结束
   - 当前通过工具名称推断（QuickTeam/Orchestrate等）

2. **TODO事件**（需要后端支持）：
   - `agent:todo-create` - TODO创建
   - `agent:todo-update` - TODO更新
   - 当前通过TodoListTool/TodoUpdateTool推断

3. **MCP连接状态**（需要后端支持）：
   - `mcp:server-connect` - MCP服务器连接
   - `mcp:server-disconnect` - MCP服务器断开
   - 当前systemStatus.mcpServers为空数组

4. **搜索和过滤**：
   - 工具Tab支持按名称搜索
   - 权限Tab支持按状态/类型过滤
   - TODO Tab支持快速跳转到进行中项

5. **导出功能**：
   - 导出工具调用日志（CSV/JSON）
   - 导出权限交互记录
   - 导出TODO列表

6. **实时性能优化**：
   - 大量工具调用时虚拟滚动
   - 历史记录分页加载
   - 自动清理过期数据（保留最近1000条）
