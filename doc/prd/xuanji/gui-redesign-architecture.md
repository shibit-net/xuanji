# Xuanji Desktop GUI 重构架构设计

## 📋 目标

1. **职责分离**：功能模型、配置模型、展示模型、交互模型各司其职
2. **清晰导航**：每个功能唯一入口，无重复无混淆
3. **模块化**：高内聚低耦合，易于扩展和维护
4. **用户体验**：减少认知负担，流畅的工作流

---

## 🏗️ 架构分层

### 1️⃣ 数据模型层（Model Layer）

```
┌─────────────────────────────────────────┐
│       Configuration Model               │  配置模型（静态、持久化）
│  - User Settings (用户设置)             │
│  - Agent Profiles (Agent 配置)          │
│  - Skill Definitions (Skill 定义)       │
│  - Tool Registry (工具注册表)            │
│  - MCP Server Config (MCP 服务器)       │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│       Runtime State Model               │  运行时状态（动态、易失）
│  - Current Agent Status                  │
│  - Tool Execution State                  │
│  - Message Stream                        │
│  - Token Usage / Cost                    │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│       History Model                     │  历史记录（持久化、可查询）
│  - Session List                          │
│  - Checkpoint Timeline                   │
│  - Memory Entries                        │
│  - Tool Call Logs                        │
└─────────────────────────────────────────┘
```

**职责分离原则**：
- **Configuration** 不直接影响 Runtime，通过重启/重载生效
- **Runtime** 不直接修改 Configuration，只读取
- **History** 只追加，不修改过去的记录

---

### 2️⃣ UI 模块层（View Layer）

```
┌──────────────────────────────────────────────────────────┐
│                    Main Window                           │
├──────────────────────────────────────────────────────────┤
│  TitleBar (窗口控制 + 全局导航)                           │
├─────────┬────────────────────────────┬───────────────────┤
│ Sidebar │      Workspace Area        │  Inspector Panel  │
│ (导航)   │      (主工作区)              │  (监控/详情)       │
│         │                            │                   │
│ - 会话   │  - Chat View (对话视图)     │  - Agent Monitor  │
│ - 配置   │  - Settings View (设置)    │  - Tool Monitor   │
│ - 工具   │  - Agent Library (Agents)  │  - Context View   │
│         │  - Skill Library (Skills)  │  - Memory View    │
│         │                            │  - Logs View      │
└─────────┴────────────────────────────┴───────────────────┘
│                    StatusBar                             │
└──────────────────────────────────────────────────────────┘
```

---

## 🎯 功能域划分

### Domain 1: Conversation（对话域）

**职责**：用户与 AI 的主要交互

**组件**：
- `ChatView` - 对话主视图
  - `MessageList` - 消息列表（展示）
  - `InputBox` - 输入框（交互）
  - `StreamingIndicator` - 流式输出指示器

**数据源**：
- Runtime State: `messages`, `streaming`, `currentAgent`
- History: `sessionList`, `checkpoints`

**入口**：Sidebar → 会话列表

---

### Domain 2: Configuration（配置域）

**职责**：管理所有静态配置

**组件**：
- `SettingsView` - 系统设置
  - `GeneralSettings` - 通用设置
  - `ModelSettings` - 模型配置
  - `APISettings` - API 密钥

- `AgentLibrary` - Agent 库（只读浏览）
  - `AgentCard` - Agent 卡片（展示）
  - `AgentEditor` - Agent 编辑器（交互）

- `SkillLibrary` - Skill 库（只读浏览）
  - `SkillCard` - Skill 卡片（展示）

- `ToolRegistry` - 工具注册表（只读）
  - `ToolList` - 工具列表（展示）

**数据源**：
- Configuration Model: `settings`, `agents`, `skills`, `tools`, `mcpServers`

**入口**：Sidebar → 配置管理

---

### Domain 3: Monitor（监控域）

**职责**：实时展示运行状态，不可编辑

**组件**：
- `AgentMonitor` - Agent 运行监控
  - `AgentStatusCard` - 当前 Agent 状态卡片
  - `ThinkingBubble` - 思考气泡
  - `ToolCallTimeline` - 工具调用时间线

- `ToolMonitor` - 工具调用监控
  - `ToolStats` - 工具统计
  - `RecentCalls` - 最近调用

- `ContextView` - 上下文视图
  - `CurrentFocus` - 当前关注文件/目录
  - `RelevantFiles` - 相关文件

- `MemoryView` - 记忆视图
  - `MemorySearch` - 记忆搜索
  - `MemoryList` - 记忆列表

**数据源**：
- Runtime State: `agentStatus`, `toolCalls`, `contextFiles`
- History: `memoryEntries`, `toolLogs`

**入口**：Inspector Panel（右侧）

---

### Domain 4: Utility（工具域）

**职责**：辅助功能和系统操作

**组件**：
- `CheckpointManager` - Checkpoint 管理
- `CompactDialog` - 压缩上下文对话框
- `StatsDialog` - 使用统计对话框
- `DiagnosticsDialog` - 系统诊断对话框

**入口**：TitleBar 菜单 / 快捷键

---

## 🗺️ 导航结构

### Sidebar（左侧导航栏）

```
┌─────────────────┐
│  Xuanji         │  Logo
├─────────────────┤
│                 │
│ 💬 对话         │  → Chat View
│   • 会话列表     │
│   • 新建会话     │
│   • Checkpoint  │
│                 │
│ ⚙️  配置         │  → Configuration Views
│   • 系统设置     │  → SettingsView
│   • Agents      │  → AgentLibrary
│   • Skills      │  → SkillLibrary
│   • Tools       │  → ToolRegistry
│                 │
│ 📊 监控         │  → Inspector Panel Tabs
│   • Agent 状态  │
│   • 工具调用     │
│   • 上下文       │
│   • 记忆库       │
│                 │
│ 🔧 实用工具     │  → Dialogs
│   • 压缩上下文   │
│   • 使用统计     │
│   • 系统诊断     │
│                 │
└─────────────────┘
│ 👤 用户         │  底部
│ ⚙️  偏好设置    │
└─────────────────┘
```

### Workspace Area（中间工作区）

- **默认**：ChatView（对话视图）
- **切换视图**：
  - SettingsView（系统设置）
  - AgentLibrary（Agent 库）
  - SkillLibrary（Skill 库）
  - ToolRegistry（工具注册表）

### Inspector Panel（右侧监控面板）

```
┌─────────────────────────┐
│ Tabs: Agent│Tools│...   │
├─────────────────────────┤
│                         │
│  [动态内容区域]          │
│                         │
│  - Agent Monitor        │
│  - Tool Monitor         │
│  - Context View         │
│  - Memory View          │
│  - Logs                 │
│                         │
└─────────────────────────┘
```

**特点**：
- 始终可见（可折叠）
- 只读展示，不可编辑
- 实时更新

---

## 📐 职责矩阵

| 模块 | 数据模型 | 读/写 | 视图类型 | 用户操作 |
|------|---------|-------|---------|---------|
| **ChatView** | Runtime State | 读写 | 交互视图 | 发送消息、中断、补充输入 |
| **SettingsView** | Configuration | 读写 | 配置视图 | 修改设置、保存 |
| **AgentLibrary** | Configuration | 读写 | 配置视图 | 查看、编辑、创建、删除 |
| **SkillLibrary** | Configuration | 只读 | 展示视图 | 浏览、搜索、查看详情 |
| **ToolRegistry** | Configuration | 只读 | 展示视图 | 浏览、搜索、查看详情 |
| **AgentMonitor** | Runtime State | 只读 | 监控视图 | 无（被动展示） |
| **ToolMonitor** | Runtime State + History | 只读 | 监控视图 | 无（被动展示） |
| **ContextView** | Runtime State | 只读 | 监控视图 | 无（被动展示） |
| **MemoryView** | History | 只读 | 监控视图 | 搜索 |
| **CheckpointManager** | History | 读写 | 工具视图 | 创建、回滚、删除 |

---

## 🎨 视觉设计原则

### 配置视图（Configuration Views）
- **颜色**：紫色主题（primary color）
- **图标**：⚙️ Settings, 🤖 Agents, ✨ Skills, 🔧 Tools
- **操作**：编辑按钮、保存按钮、删除确认
- **状态**：启用/禁用开关

### 监控视图（Monitor Views）
- **颜色**：蓝色/绿色主题（info/success）
- **图标**：📊 Stats, 🔍 Monitor, 👁️ Watch
- **操作**：无（只读）
- **动画**：流式更新、脉冲效果

### 交互视图（Interactive Views）
- **颜色**：橙色/黄色主题（warning/active）
- **图标**：💬 Chat, ✏️ Edit, 🚀 Send
- **操作**：输入框、按钮、快捷键
- **反馈**：Loading 状态、成功/失败提示

---

## 🔄 数据流设计

### Configuration → Runtime

```
用户修改配置 (SettingsView)
    ↓
保存到配置文件 (config.json5)
    ↓
触发重载事件 (IPC: config-updated)
    ↓
Agent Bridge 重新初始化
    ↓
Runtime State 更新
    ↓
UI 自动刷新
```

### Runtime → History

```
工具调用完成 (AgentLoop)
    ↓
追加到历史记录 (tool-logs.jsonl)
    ↓
发送事件 (IPC: tool-call-logged)
    ↓
ToolMonitor 更新
    ↓
MemoryView 可检索
```

### User Action → Runtime

```
用户发送消息 (ChatView)
    ↓
IPC 调用 (agent:send-message)
    ↓
Agent Bridge 执行
    ↓
流式返回事件 (agent:text, agent:tool-start, ...)
    ↓
ChatView 实时渲染
    ↓
AgentMonitor 同步更新
```

---

## 📦 组件目录结构

```
desktop/renderer/
├── views/                    # 主视图（占据 Workspace Area）
│   ├── ChatView.tsx         # 对话视图
│   ├── SettingsView.tsx     # 系统设置
│   ├── AgentLibrary.tsx     # Agent 库
│   ├── SkillLibrary.tsx     # Skill 库
│   └── ToolRegistry.tsx     # 工具注册表
│
├── monitors/                 # 监控组件（Inspector Panel）
│   ├── AgentMonitor.tsx     # Agent 监控
│   ├── ToolMonitor.tsx      # 工具监控
│   ├── ContextView.tsx      # 上下文视图
│   ├── MemoryView.tsx       # 记忆视图
│   └── LogsView.tsx         # 日志视图
│
├── dialogs/                  # 对话框（临时交互）
│   ├── CompactDialog.tsx
│   ├── StatsDialog.tsx
│   ├── DiagnosticsDialog.tsx
│   ├── PermissionDialog.tsx
│   ├── PlanReviewDialog.tsx
│   └── AskUserDialog.tsx
│
├── layout/                   # 布局组件
│   ├── TitleBar.tsx
│   ├── Sidebar.tsx
│   ├── Workspace.tsx
│   ├── InspectorPanel.tsx
│   └── StatusBar.tsx
│
├── shared/                   # 共享组件
│   ├── AgentCard.tsx        # Agent 卡片（展示）
│   ├── AgentEditor.tsx      # Agent 编辑器（交互）
│   ├── SkillCard.tsx        # Skill 卡片（展示）
│   ├── ToolCard.tsx         # Tool 卡片（展示）
│   ├── MessageBubble.tsx    # 消息气泡
│   ├── ThinkingBubble.tsx   # 思考气泡
│   └── StatusIndicator.tsx  # 状态指示器
│
└── App.tsx                   # 根组件
```

---

## 🚀 实施计划

### Phase 1: 数据模型重构
- [ ] 定义 Configuration Model TypeScript 接口
- [ ] 定义 Runtime State Model TypeScript 接口
- [ ] 定义 History Model TypeScript 接口
- [ ] 创建 Store 分离（useConfigStore, useRuntimeStore, useHistoryStore）

### Phase 2: 布局重构
- [ ] 重写 Sidebar（三级导航）
- [ ] 重写 Workspace（视图容器）
- [ ] 重写 InspectorPanel（Tab 容器）
- [ ] 删除旧的 RightPanel、ContextPanel、AgentPanel

### Phase 3: 视图重构
- [ ] 重写 ChatView（保留原有功能）
- [ ] 创建 AgentLibrary（合并 AgentManager + SkillsAndTools Agents）
- [ ] 创建 SkillLibrary（从 SkillsAndTools 拆分）
- [ ] 创建 ToolRegistry（从 SkillsAndTools 拆分）

### Phase 4: 监控重构
- [ ] 创建 AgentMonitor（合并 AgentPanel 功能）
- [ ] 创建 ToolMonitor（合并 RightPanel Tools 标签）
- [ ] 创建 ContextView（重构 ContextPanel）
- [ ] 创建 MemoryView（合并 RightPanel Memory 标签）
- [ ] 创建 LogsView（合并 RightPanel Logs 标签）

### Phase 5: 工具重构
- [ ] 移动 Checkpoint 到独立的 Dialog
- [ ] 保留现有 Dialogs（Compact、Stats、Diagnostics）

---

## 📊 对比：重构前 vs 重构后

| 维度 | 重构前 | 重构后 |
|-----|--------|--------|
| **主要视图数量** | 4 个（Chat, Settings, AgentManager, SkillsAndTools） | 5 个（Chat, Settings, AgentLibrary, SkillLibrary, ToolRegistry） |
| **右侧面板数量** | 3 个（RightPanel, ContextPanel, AgentPanel） | 1 个（InspectorPanel，5 个 Tab） |
| **Agent 相关入口** | 2 个（Sidebar "Agent 配置", TitleBar "Agent 状态"） | 2 个（Sidebar "Agents 库", Inspector "Agent 监控"） |
| **工具相关入口** | 3 个（SkillsAndTools Tools, RightPanel Tools, AgentPanel Tools） | 2 个（Sidebar "Tools 注册表", Inspector "工具监控"） |
| **配置 vs 监控** | 混在一起 | 完全分离 |
| **数据模型** | 单一 Store | 3 个独立 Store（Config/Runtime/History） |
| **职责清晰度** | ⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## 🎯 核心改进

### ✅ 职责分离
- **配置域**（AgentLibrary、SkillLibrary、ToolRegistry）：管理静态配置
- **监控域**（AgentMonitor、ToolMonitor）：展示运行状态
- **交互域**（ChatView）：用户与 AI 对话

### ✅ 唯一入口
- 每个功能只有一个入口
- 命名清晰：库（Library）= 配置管理，监控（Monitor）= 运行状态

### ✅ 数据流清晰
- Configuration → Runtime：单向流动
- Runtime → History：只追加
- UI → Model：通过 IPC 明确调用

### ✅ 可扩展性
- 新增 Agent：只需在 AgentLibrary 添加
- 新增监控维度：在 InspectorPanel 添加 Tab
- 新增工具：自动出现在 ToolRegistry

---

## 📝 命名规范

### 视图（Views）
- 后缀 `View`
- 用途：主要工作区，占据大面积
- 例：`ChatView`, `SettingsView`, `AgentLibrary`

### 监控（Monitors）
- 后缀 `Monitor` 或 `View`
- 用途：只读展示，实时更新
- 例：`AgentMonitor`, `ToolMonitor`, `MemoryView`

### 对话框（Dialogs）
- 后缀 `Dialog`
- 用途：临时交互，模态或非模态
- 例：`CompactDialog`, `StatsDialog`

### 卡片（Cards）
- 后缀 `Card`
- 用途：展示单个实体（只读）
- 例：`AgentCard`, `SkillCard`, `ToolCard`

### 编辑器（Editors）
- 后缀 `Editor`
- 用途：编辑单个实体（可写）
- 例：`AgentEditor`, `SettingsEditor`

---

**文档版本**: v1.0
**创建时间**: 2026-03-14
**作者**: Claude (Haiku 4.5)
