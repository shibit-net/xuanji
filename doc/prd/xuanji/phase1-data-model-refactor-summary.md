# Phase 1: 数据模型重构 - 完成总结

## ✅ 已完成

### 1. 类型定义 (`types/models.ts`)
- ✅ Configuration Model（配置模型）
  - UserSettings, ModelConfig, APIConfig, PermissionConfig
  - AgentProfile, SkillDefinition, ToolDefinition, MCPServerConfig
- ✅ Runtime State Model（运行时状态模型）
  - AgentStatus, ToolCallState, MessageStreamState
  - TokenUsage, RuntimeState
- ✅ History Model（历史记录模型）
  - SessionInfo, CheckpointInfo, MemoryEntry, ToolCallLog

### 2. Store 分离
- ✅ **ConfigStore** (`stores/configStore.ts`)
  - 管理所有静态配置
  - 支持 Settings、Agents、Skills、Tools、MCP 的 CRUD 操作
  - 持久化用户设置（使用 zustand persist）

- ✅ **RuntimeStore** (`stores/runtimeStore.ts`)
  - 管理 Agent 运行时状态
  - 管理消息流状态
  - 管理 Token 使用和成本
  - 所有数据易失，不持久化

- ✅ **HistoryStore** (`stores/historyStore.ts`)
  - 管理会话历史
  - 管理 Checkpoint
  - 管理记忆库
  - 管理工具调用日志

- ✅ **ChatStore** (`stores/chatStore.ts`) - 重构
  - 移除配置相关状态（迁移到 ConfigStore）
  - 移除历史相关状态（迁移到 HistoryStore）
  - 移除 stats.tokenUsage/cost（迁移到 RuntimeStore）
  - 保留消息列表、UI 状态、权限交互、日志

### 3. 统一导出 (`stores/index.ts`)
- ✅ 导出所有 Store
- ✅ 导出常用类型

---

## 📊 架构对比

### 重构前
```
chatStore (单一 Store)
├── messages
├── status
├── stats { model, tokenUsage, cost }  ← 混在一起
├── permissionRequest
├── logs
└── ... (所有状态混在一起)
```

### 重构后
```
📦 configStore (配置域)
├── settings
├── agents
├── skills
├── tools
└── mcpServers

📦 runtimeStore (运行时域)
├── agentStatus
├── messageStream
├── tokenUsage
├── cost
└── isProcessing

📦 historyStore (历史域)
├── sessions
├── checkpoints
├── memoryEntries
└── toolCallLogs

📦 chatStore (对话域)
├── messages
├── status
├── permissionRequest
└── logs
```

---

## 🎯 职责分离

| Store | 数据类型 | 持久化 | 主要职责 |
|-------|---------|--------|---------|
| **ConfigStore** | 静态配置 | ✅ 是（settings） | 管理所有配置项 |
| **RuntimeStore** | 运行时状态 | ❌ 否 | 反映当前执行状态 |
| **HistoryStore** | 历史记录 | ✅ 是（后端） | 管理过去的数据 |
| **ChatStore** | UI 状态 | ❌ 否 | 管理对话界面状态 |

---

## 💡 使用示例

### 1. 加载配置数据

```typescript
import { useConfigStore } from '@/stores';

function AgentLibrary() {
  const { agents, loading, loadAgents } = useConfigStore();

  useEffect(() => {
    loadAgents();
  }, []);

  if (loading) return <div>加载中...</div>;

  return (
    <div>
      {agents.map(agent => (
        <AgentCard key={agent.id} agent={agent} />
      ))}
    </div>
  );
}
```

### 2. 监控运行时状态

```typescript
import { useRuntimeStore } from '@/stores';

function AgentMonitor() {
  const { agentStatus, tokenUsage, cost } = useRuntimeStore();

  return (
    <div>
      <div>状态: {agentStatus?.status}</div>
      <div>Token: ↑{tokenUsage.input} ↓{tokenUsage.output}</div>
      <div>成本: ${cost.toFixed(4)}</div>
    </div>
  );
}
```

### 3. 查看历史记录

```typescript
import { useHistoryStore } from '@/stores';

function SessionList() {
  const { sessions, loadSessions } = useHistoryStore();

  useEffect(() => {
    loadSessions();
  }, []);

  return (
    <div>
      {sessions.map(session => (
        <SessionCard key={session.id} session={session} />
      ))}
    </div>
  );
}
```

### 4. 对话界面

```typescript
import { useChatStore } from '@/stores';

function ChatView() {
  const { messages, status, sendMessage } = useChatStore();

  const handleSend = (content: string) => {
    sendMessage(content);
  };

  return (
    <div>
      <MessageList messages={messages} />
      <InputBox onSend={handleSend} disabled={status !== 'idle'} />
    </div>
  );
}
```

### 5. 跨 Store 数据访问

```typescript
import { useConfigStore, useRuntimeStore } from '@/stores';

function StatusBar() {
  const model = useConfigStore(state => state.settings.model.defaultModel);
  const { tokenUsage, cost } = useRuntimeStore();

  return (
    <div>
      {model} | ↑{tokenUsage.input} ↓{tokenUsage.output} | ${cost.toFixed(4)}
    </div>
  );
}
```

---

## 🔄 数据流

### 配置变更流程
```
用户修改配置 (UI)
    ↓
configStore.updateSettings()
    ↓
IPC: settingsUpdateConfig
    ↓
Agent Bridge 保存到文件
    ↓
触发重载事件
    ↓
configStore.loadSettings()
    ↓
UI 自动刷新
```

### 运行时状态流程
```
Agent 开始执行
    ↓
IPC: agent:text / agent:tool-start
    ↓
chatStore._handleAgentText()
    ↓
runtimeStore.appendStreamText()
    ↓
UI 自动刷新（流式输出）
```

### 历史记录流程
```
用户保存会话
    ↓
IPC: sessionSave
    ↓
Agent Bridge 保存到 JSONL
    ↓
historyStore.loadSessions()
    ↓
UI 显示会话列表
```

---

## 📝 迁移检查清单

### 需要更新的组件

- [ ] **StatusBar**: 从 configStore 读取 model，从 runtimeStore 读取 tokenUsage/cost
- [ ] **SettingsPanel**: 使用 configStore 的 settings 和 updateSettings
- [ ] **AgentManager**: 使用 configStore 的 agents 和 CRUD 方法
- [ ] **SkillsAndTools**: 使用 configStore 的 skills/tools/mcpServers
- [ ] **RightPanel**: 使用 historyStore 的 checkpoints/memoryEntries
- [ ] **Sidebar**: 使用 historyStore 的 sessions

### 需要删除的代码

- [ ] chatStore 中已删除的 stats 字段的引用
- [ ] 任何直接从 chatStore 读取配置的代码

---

## ⚠️ 注意事项

1. **初始化顺序**
   - App 组件挂载时，应先调用 `configStore.loadAll()` 加载配置
   - 然后调用 `historyStore.loadAll()` 加载历史
   - runtimeStore 不需要初始化，由事件驱动更新

2. **状态持久化**
   - configStore 的 settings 自动持久化到 localStorage
   - 其他所有数据从后端 IPC 加载
   - 不要在组件中手动保存到 localStorage

3. **错误处理**
   - 所有 Store 的异步方法都会捕获错误并设置 error 状态
   - UI 组件应该监听 error 状态并显示错误提示

4. **性能优化**
   - 使用 zustand 的 selector 避免不必要的重渲染
   ```typescript
   // ❌ 不好：整个 store 变化都会重渲染
   const agents = useConfigStore(state => state.agents);

   // ✅ 好：只在 agents 变化时重渲染
   const agents = useConfigStore(state => state.agents);
   ```

---

## 🚀 下一步：Phase 2

Phase 1 完成后，可以开始 Phase 2：布局重构

1. 创建新的 Sidebar（三级导航）
2. 创建 Workspace 容器
3. 创建 InspectorPanel
4. 重写 App.tsx

---

**完成时间**: 2026-03-14
**文件数量**: 6 个（1 类型定义 + 4 Store + 1 导出）
**代码行数**: ~800 行
