# Inspector Panel Tabs 使用说明和问题分析

## Tab 概览

右侧面板有 6 个Tab：

| Tab | 组件 | 数据源 | 状态 | 用途 |
|-----|------|--------|------|------|
| 工作区 | ExecutionWorkspace | executionStore | ✅ 已实现 | 实时显示Agent执行流程（拟人化头像） |
| Agent | AgentMonitor | runtimeStore.agentStatus | ⚠️ 缺少数据 | 显示Agent状态、当前思考、当前工具 |
| 工具 | ToolMonitor | executionStore.toolExecutions | ✅ 已实现 | 显示工具调用列表和详情 |
| 上下文 | ContextView | runtimeStore.contextInfo | ⚠️ 缺少数据 | 显示当前上下文信息（文件、目录） |
| 记忆 | MemoryView | historyStore.memoryEntries | ⚠️ 缺少数据 | 显示记忆条目（对话、决策、偏好） |
| 日志 | LogsView | runtimeStore.logs | ⚠️ 缺少数据 | 显示系统日志 |

## 问题分析

### 1. Agent Tab - 缺少 agentStatus 数据

**现状**：
- AgentMonitor 读取 `runtimeStore.agentStatus`
- chatStore 从未调用 `setAgentStatus()` 或 `updateAgentStatus()`
- 导致 agentStatus 一直是 null

**需要的数据结构**：
```typescript
interface AgentStatus {
  name: string;
  status: 'thinking' | 'executing' | 'waiting' | 'done' | 'error';
  currentThought?: string;
  currentTool?: {
    name: string;
    status: 'running' | 'success' | 'error';
    duration?: number;
  };
}
```

**修复方案**：
在 chatStore 的 IPC 事件处理器中添加：

```typescript
// _handleAgentStart
useRuntimeStore.getState().setAgentStatus({
  name: 'Xuanji Assistant',
  status: 'thinking',
});

// _handleAgentThinking
useRuntimeStore.getState().updateAgentStatus({
  status: 'thinking',
  currentThought: thinking,
});

// _handleAgentToolStart
useRuntimeStore.getState().updateAgentStatus({
  status: 'executing',
  currentTool: {
    name: data.name,
    status: 'running',
  },
});

// _handleAgentToolEnd
useRuntimeStore.getState().updateAgentStatus({
  currentTool: {
    ...state.currentTool,
    status: data.isError ? 'error' : 'success',
    duration: Date.now() - toolStartTime,
  },
});

// _handleAgentEnd
useRuntimeStore.getState().updateAgentStatus({
  status: 'done',
  currentThought: undefined,
  currentTool: undefined,
});
```

### 2. 上下文 Tab - 缺少 contextInfo 数据

**现状**：
- ContextView 读取 `runtimeStore.contextInfo`
- chatStore 从未调用 `setContextInfo()`
- 导致 contextInfo 一直是 null

**需要的数据结构**：
```typescript
interface ContextInfo {
  projectPath?: string;
  currentFile?: string;
  openFiles?: string[];
  relevantFiles?: string[];
  totalLines?: number;
  totalFiles?: number;
}
```

**修复方案**：
1. 添加后端 IPC 事件：`agent:context-update`
2. 在 chatStore 中监听并更新：
```typescript
window.electron.onContextUpdate((context) => {
  useRuntimeStore.getState().setContextInfo(context);
});
```

### 3. 记忆 Tab - 缺少 memoryEntries 数据

**现状**：
- MemoryView 读取 `historyStore.memoryEntries`
- historyStore 初始化时加载了 memoryEntries，但是：
  - 数据可能是空的（没有记忆文件）
  - 没有实时更新机制

**需要的数据结构**：
```typescript
interface MemoryEntry {
  content: string;
  type: 'conversation' | 'decision' | 'fact' | 'preference' | 'code' | 'task';
  tags?: string[];
  score?: number; // 相关性评分
  createdAt?: number;
}
```

**修复方案**：
1. 添加后端 IPC 事件：`memory:store`（记忆保存时触发）
2. 在 chatStore 中监听并更新：
```typescript
window.electron.onMemoryStore((memory) => {
  useHistoryStore.getState().addMemoryEntry(memory);
});
```

### 4. 日志 Tab - 缺少日志数据

**现状**：
- LogsView 读取 `runtimeStore.logs`
- chatStore 从未调用 `addLog()`
- 导致 logs 一直是空数组

**需要的数据结构**：
```typescript
interface LogEntry {
  id: string;
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  category: string;
  message: string;
  data?: any;
}
```

**修复方案**：
在关键位置添加日志：
```typescript
// 工具执行开始
useRuntimeStore.getState().addLog({
  level: 'info',
  category: 'tool',
  message: `开始执行工具: ${data.name}`,
  data: { toolId: data.id, input: data.input },
});

// 工具执行完成
useRuntimeStore.getState().addLog({
  level: data.isError ? 'error' : 'info',
  category: 'tool',
  message: `工具执行${data.isError ? '失败' : '完成'}: ${data.name}`,
  data: { toolId: data.id, result: data.result },
});

// Agent 思考
useRuntimeStore.getState().addLog({
  level: 'debug',
  category: 'agent',
  message: 'Agent 正在思考',
  data: { thinking },
});
```

## 工作区 Tab vs Agent Tab 的区别

### 工作区 Tab（ExecutionWorkspace）
- **用途**：宏观展示，看"谁在做什么"
- **显示内容**：
  - 用户输入
  - 所有运行中的 Agent（Main / SubAgent）
  - 每个 Agent 的工具气泡
  - 并行/串行关系
  - 模式标识（Plan / Team / SubAgent）
- **适合场景**：了解整体执行流程，看多个Agent协作

### Agent Tab（AgentMonitor）
- **用途**：微观监控，看"Agent当前状态"
- **显示内容**：
  - 当前Agent名称
  - 当前状态（思考中/执行中/等待中）
  - 当前思考内容（完整文本）
  - 当前工具调用详情
  - 执行轮次
- **适合场景**：深入了解Agent内部状态，调试思考过程

## 推荐使用方式

### 日常使用
- **工作区 Tab**（默认）：看整体执行流程
- **工具 Tab**：查看工具调用历史和详情

### 调试/开发时
- **Agent Tab**：查看思考过程，了解Agent决策逻辑
- **上下文 Tab**：查看当前项目上下文
- **记忆 Tab**：查看记忆系统存储的内容
- **日志 Tab**：查看详细的系统日志

## 修复优先级

### P0 - 立即修复（核心体验）
- ✅ 工作区 Tab（已完成）
- ✅ 工具 Tab（已完成）

### P1 - 短期修复（调试需求）
- ⚠️ Agent Tab - 添加 agentStatus 数据连接
- ⚠️ 日志 Tab - 添加关键位置的日志记录

### P2 - 中期完善（高级功能）
- ⚠️ 上下文 Tab - 需要后端支持 context-update 事件
- ⚠️ 记忆 Tab - 需要后端支持 memory-store 事件

## 总结

**当前状态**：
- ✅ 工作区Tab和工具Tab完全可用
- ⚠️ 其他4个Tab组件已实现，但缺少数据源连接

**原因**：
- chatStore 只更新了 executionStore（用于工作区和工具Tab）
- 没有更新 runtimeStore 和 historyStore（用于其他Tab）

**建议**：
1. 短期：使用工作区Tab（拟人化、直观）+ 工具Tab（详细历史）
2. 中期：修复Agent Tab和日志Tab，提升调试体验
3. 长期：完善上下文Tab和记忆Tab，打造完整的监控面板
