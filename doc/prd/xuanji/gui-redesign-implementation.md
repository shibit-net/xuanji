# Xuanji Desktop GUI 重构 - 实施计划

## 📋 总览

本文档详细说明 GUI 重构的实施步骤、技术细节和注意事项。

---

## 🎯 重构目标回顾

1. **职责分离**：配置模型、运行时模型、历史模型三层分离
2. **清晰导航**：每个功能唯一入口，避免重复和混淆
3. **模块化设计**：高内聚低耦合，易于扩展和维护
4. **优秀体验**：流畅的工作流，减少用户认知负担

---

## 📦 Phase 1: 数据模型重构

### 目标
将现有的单一 `chatStore` 拆分为三个独立的 Store：
- `configStore` - 配置模型
- `runtimeStore` - 运行时状态
- `historyStore` - 历史记录

### 步骤

#### 1.1 创建 TypeScript 类型定义

**文件**: `desktop/renderer/types/models.ts`

```typescript
// ============================================================
// 配置模型
// ============================================================

export interface UserSettings {
  language: 'zh-CN' | 'en-US';
  theme: 'light' | 'dark' | 'auto';
  fontSize: number;
  model: ModelConfig;
  api: APIConfig;
  permissions: PermissionConfig;
}

export interface ModelConfig {
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  streaming: boolean;
}

export interface APIConfig {
  anthropicKey?: string;
  openaiKey?: string;
}

export interface PermissionConfig {
  autoAllowRead: boolean;
  autoAllowWrite: boolean;
  autoAllowBash: boolean;
}

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  color?: string;
  enabled: boolean;
  tags: string[];
  capabilities: string[];
  systemPrompt: string;
  tools: Array<{ name: string; required: boolean }>;
  model: {
    primary: string;
    fallback?: string;
  };
  metadata: {
    source: 'builtin' | 'global' | 'project';
    filePath?: string;
    builtin?: boolean;
    isSubAgent?: boolean;
    createdAt: string;
    updatedAt: string;
  };
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  type: 'prompt' | 'agent' | 'workflow';
  category: 'core' | 'scene';
  enabled: boolean;
  requiredTools?: string[];
  triggers?: string[];
  tags: string[];
  content?: string;
  priority?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'core' | 'search' | 'meta' | 'task' | 'memory' | 'reminder' | 'network' | 'mcp' | 'special';
  required: boolean;
  readonly: boolean;
  inputSchema?: any;
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

// ============================================================
// 运行时状态模型
// ============================================================

export interface AgentStatus {
  id: string;
  name: string;
  status: 'idle' | 'thinking' | 'executing' | 'waiting' | 'done' | 'error';
  currentThought?: string;
  currentTool?: {
    name: string;
    status: 'running' | 'success' | 'error';
    duration?: number;
  };
}

export interface ToolCallState {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  duration?: number;
}

export interface MessageStreamState {
  text: string;
  thinking: string;
  toolCalls: ToolCallState[];
  finished: boolean;
}

export interface TokenUsage {
  input: number;
  output: number;
  cached?: number;
}

export interface RuntimeState {
  agentStatus: AgentStatus | null;
  messageStream: MessageStreamState | null;
  tokenUsage: TokenUsage;
  cost: number;
  currentIteration: number;
  isProcessing: boolean;
}

// ============================================================
// 历史记录模型
// ============================================================

export interface SessionInfo {
  id: string;
  shortLabel?: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  workingDirectory?: string;
  preview?: string;
}

export interface CheckpointInfo {
  id: string;
  label?: string;
  createdAt: string;
  messageIndex: number;
  messageCount: number;
}

export interface MemoryEntry {
  type: string;
  content: string;
  tags?: string[];
  createdAt?: string;
  score?: number;
}

export interface ToolCallLog {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: string;
  status: 'success' | 'error';
  timestamp: number;
  duration: number;
}
```

#### 1.2 创建 Config Store

**文件**: `desktop/renderer/stores/configStore.ts`

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserSettings, AgentProfile, SkillDefinition, ToolDefinition, MCPServerConfig } from '../types/models';

interface ConfigState {
  // 数据
  settings: UserSettings;
  agents: AgentProfile[];
  skills: SkillDefinition[];
  tools: ToolDefinition[];
  mcpServers: MCPServerConfig[];

  // 加载状态
  loaded: boolean;
  loading: boolean;
  error: string | null;

  // 操作
  loadSettings: () => Promise<void>;
  updateSettings: (settings: Partial<UserSettings>) => Promise<void>;

  loadAgents: () => Promise<void>;
  createAgent: (agent: Partial<AgentProfile>) => Promise<void>;
  updateAgent: (id: string, agent: Partial<AgentProfile>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;

  loadSkills: () => Promise<void>;
  loadTools: () => Promise<void>;
  loadMCPServers: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      // 初始状态
      settings: {
        language: 'zh-CN',
        theme: 'dark',
        fontSize: 14,
        model: {
          defaultModel: 'claude-3-5-haiku-20241022',
          temperature: 1.0,
          maxTokens: 8000,
          streaming: true,
        },
        api: {},
        permissions: {
          autoAllowRead: true,
          autoAllowWrite: false,
          autoAllowBash: false,
        },
      },
      agents: [],
      skills: [],
      tools: [],
      mcpServers: [],
      loaded: false,
      loading: false,
      error: null,

      // 实现操作
      loadSettings: async () => {
        set({ loading: true, error: null });
        try {
          const result = await window.electron.settingsGetConfig();
          if (result.success && result.config) {
            set({ settings: result.config, loaded: true });
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        } finally {
          set({ loading: false });
        }
      },

      updateSettings: async (settings) => {
        try {
          const newSettings = { ...get().settings, ...settings };
          const result = await window.electron.settingsUpdateConfig(newSettings);
          if (result.success) {
            set({ settings: newSettings });
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        }
      },

      loadAgents: async () => {
        set({ loading: true, error: null });
        try {
          const result = await window.electron.agentList();
          if (result.success && result.agents) {
            set({ agents: result.agents });
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        } finally {
          set({ loading: false });
        }
      },

      createAgent: async (agent) => {
        try {
          const result = await window.electron.agentCreate({ config: agent });
          if (result.success) {
            await get().loadAgents(); // 重新加载列表
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        }
      },

      updateAgent: async (id, agent) => {
        try {
          const result = await window.electron.agentUpdate({ agentId: id, config: agent });
          if (result.success) {
            await get().loadAgents(); // 重新加载列表
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        }
      },

      deleteAgent: async (id) => {
        try {
          const result = await window.electron.agentDelete({ agentId: id });
          if (result.success) {
            await get().loadAgents(); // 重新加载列表
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        }
      },

      loadSkills: async () => {
        try {
          const result = await window.electron.skillsList();
          if (result.success && result.skills) {
            set({ skills: result.skills });
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        }
      },

      loadTools: async () => {
        try {
          const result = await window.electron.toolsList();
          if (result.success && result.tools) {
            set({ tools: result.tools });
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        }
      },

      loadMCPServers: async () => {
        try {
          const result = await window.electron.mcpList();
          if (result.success && result.servers) {
            set({ mcpServers: result.servers });
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : String(err) });
        }
      },
    }),
    {
      name: 'xuanji-config-storage',
      partialize: (state) => ({ settings: state.settings }), // 仅持久化 settings
    }
  )
);
```

#### 1.3 创建 Runtime Store

**文件**: `desktop/renderer/stores/runtimeStore.ts`

```typescript
import { create } from 'zustand';
import type { AgentStatus, MessageStreamState, TokenUsage, RuntimeState } from '../types/models';

interface RuntimeStoreState extends RuntimeState {
  // 操作
  setAgentStatus: (status: AgentStatus | null) => void;
  updateMessageStream: (stream: Partial<MessageStreamState>) => void;
  resetMessageStream: () => void;
  updateTokenUsage: (usage: Partial<TokenUsage>) => void;
  setCost: (cost: number) => void;
  setProcessing: (isProcessing: boolean) => void;
  reset: () => void;
}

const initialState: RuntimeState = {
  agentStatus: null,
  messageStream: null,
  tokenUsage: { input: 0, output: 0 },
  cost: 0,
  currentIteration: 0,
  isProcessing: false,
};

export const useRuntimeStore = create<RuntimeStoreState>()((set) => ({
  ...initialState,

  setAgentStatus: (status) => set({ agentStatus: status }),

  updateMessageStream: (stream) =>
    set((state) => ({
      messageStream: state.messageStream
        ? { ...state.messageStream, ...stream }
        : { text: '', thinking: '', toolCalls: [], finished: false, ...stream },
    })),

  resetMessageStream: () => set({ messageStream: null }),

  updateTokenUsage: (usage) =>
    set((state) => ({
      tokenUsage: { ...state.tokenUsage, ...usage },
    })),

  setCost: (cost) => set({ cost }),

  setProcessing: (isProcessing) => set({ isProcessing }),

  reset: () => set(initialState),
}));
```

#### 1.4 创建 History Store

**文件**: `desktop/renderer/stores/historyStore.ts`

```typescript
import { create } from 'zustand';
import type { SessionInfo, CheckpointInfo, MemoryEntry, ToolCallLog } from '../types/models';

interface HistoryState {
  // 数据
  sessions: SessionInfo[];
  checkpoints: CheckpointInfo[];
  memoryEntries: MemoryEntry[];
  toolCallLogs: ToolCallLog[];

  // 加载状态
  loading: boolean;
  error: string | null;

  // 操作
  loadSessions: () => Promise<void>;
  loadCheckpoints: () => Promise<void>;
  loadMemoryEntries: (query?: string) => Promise<void>;
  loadToolCallLogs: () => Promise<void>;

  addToolCallLog: (log: ToolCallLog) => void;
  clearToolCallLogs: () => void;
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  sessions: [],
  checkpoints: [],
  memoryEntries: [],
  toolCallLogs: [],
  loading: false,
  error: null,

  loadSessions: async () => {
    set({ loading: true, error: null });
    try {
      const result = await window.electron.sessionList();
      if (result.success && result.sessions) {
        set({ sessions: result.sessions });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ loading: false });
    }
  },

  loadCheckpoints: async () => {
    set({ loading: true, error: null });
    try {
      const result = await window.electron.checkpointList();
      if (result.success && result.checkpoints) {
        set({ checkpoints: result.checkpoints });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ loading: false });
    }
  },

  loadMemoryEntries: async (query?: string) => {
    set({ loading: true, error: null });
    try {
      const result = await window.electron.memoryRetrieve({ query: query || '' });
      if (result.success && result.entries) {
        set({ memoryEntries: result.entries });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ loading: false });
    }
  },

  loadToolCallLogs: async () => {
    // Tool call logs 从消息历史中提取，暂时不需要单独的 IPC 调用
    // 或者可以添加专门的 IPC 接口
  },

  addToolCallLog: (log) =>
    set((state) => ({
      toolCallLogs: [...state.toolCallLogs, log],
    })),

  clearToolCallLogs: () => set({ toolCallLogs: [] }),
}));
```

#### 1.5 迁移现有 chatStore

保留 `chatStore` 用于对话消息和 UI 状态，但移除配置和历史相关的状态：

**文件**: `desktop/renderer/stores/chatStore.ts`

```typescript
import { create } from 'zustand';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status: 'running' | 'success' | 'error';
}

interface ChatState {
  // 消息历史
  messages: Message[];

  // UI 状态
  streaming: boolean;
  pendingUserInputs: Array<{ content: string; timestamp: number }>;

  // 权限交互
  permissionRequest: any | null;
  planReviewRequest: any | null;
  askUserRequest: any | null;

  // 操作
  addMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  addPendingInput: (content: string) => void;
  clearPendingInputs: () => void;
  setStreaming: (streaming: boolean) => void;
  setPermissionRequest: (request: any | null) => void;
  setPlanReviewRequest: (request: any | null) => void;
  setAskUserRequest: (request: any | null) => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>()((set) => ({
  messages: [],
  streaming: false,
  pendingUserInputs: [],
  permissionRequest: null,
  planReviewRequest: null,
  askUserRequest: null,

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  setMessages: (messages) => set({ messages }),

  addPendingInput: (content) =>
    set((state) => ({
      pendingUserInputs: [...state.pendingUserInputs, { content, timestamp: Date.now() }],
    })),

  clearPendingInputs: () => set({ pendingUserInputs: [] }),

  setStreaming: (streaming) => set({ streaming }),

  setPermissionRequest: (request) => set({ permissionRequest: request }),
  setPlanReviewRequest: (request) => set({ planReviewRequest: request }),
  setAskUserRequest: (request) => set({ askUserRequest: request }),

  reset: () =>
    set({
      messages: [],
      streaming: false,
      pendingUserInputs: [],
      permissionRequest: null,
      planReviewRequest: null,
      askUserRequest: null,
    }),
}));
```

### 测试

创建测试文件验证每个 Store 的功能：

```bash
cd desktop/renderer/stores
touch __tests__/configStore.test.ts
touch __tests__/runtimeStore.test.ts
touch __tests__/historyStore.test.ts
```

---

## 📦 Phase 2: 布局重构

### 目标
重新组织布局组件，建立清晰的三栏结构。

### 步骤

#### 2.1 创建新的 Sidebar

**文件**: `desktop/renderer/layout/Sidebar.tsx`

```typescript
// 三级导航结构：对话、配置、监控、工具
```

**要点**：
- 分组清晰：💬 对话、⚙️ 配置、📊 监控、🔧 工具
- 每个分组下有子项
- 使用 react-router 或状态管理切换视图

#### 2.2 创建 Workspace 容器

**文件**: `desktop/renderer/layout/Workspace.tsx`

```typescript
// 视图容器，根据当前路由/状态渲染不同的 View
```

**要点**：
- 接收 `currentView` prop
- 渲染对应的 View 组件
- 支持视图切换动画

#### 2.3 创建 InspectorPanel

**文件**: `desktop/renderer/layout/InspectorPanel.tsx`

```typescript
// Tab 容器，包含多个监控视图
```

**要点**：
- Tab 导航：Agent | Tool | Context | Memory | Logs
- 可折叠
- 始终在右侧

#### 2.4 重写 App.tsx

```typescript
import Sidebar from './layout/Sidebar';
import Workspace from './layout/Workspace';
import InspectorPanel from './layout/InspectorPanel';

export default function App() {
  const [currentView, setCurrentView] = useState('chat');
  const [inspectorVisible, setInspectorVisible] = useState(true);

  return (
    <div className="flex h-screen">
      <Sidebar onNavigate={setCurrentView} />
      <Workspace view={currentView} />
      {inspectorVisible && <InspectorPanel />}
    </div>
  );
}
```

---

## 📦 Phase 3: 视图重构

按优先级依次创建/重构各个视图。

### 3.1 ChatView（优先级 P0）

保留现有对话功能，迁移到新结构。

### 3.2 AgentLibrary（优先级 P1）

合并现有 AgentManager + SkillsAndTools 的 Agents 标签。

### 3.3 SkillLibrary（优先级 P1）

从 SkillsAndTools 拆分出 Skills 标签。

### 3.4 ToolRegistry（优先级 P1）

从 SkillsAndTools 拆分出 Tools 标签。

### 3.5 SettingsView（优先级 P2）

保留现有设置界面。

---

## 📦 Phase 4: 监控重构

创建监控组件，替换旧的 RightPanel、ContextPanel、AgentPanel。

### 4.1 AgentMonitor
### 4.2 ToolMonitor
### 4.3 ContextView
### 4.4 MemoryView
### 4.5 LogsView

---

## 🗺️ 迁移路径

### 阶段 1：并行开发（不影响现有功能）
- 创建新的 Store
- 创建新的布局组件
- 创建新的视图组件

### 阶段 2：逐步切换
- 先切换不常用的视图（Settings、AgentLibrary）
- 验证功能正常

### 阶段 3：全面切换
- 切换 ChatView
- 切换监控面板
- 删除旧组件

---

## ⚠️ 注意事项

1. **向后兼容**：确保 IPC 接口不变
2. **数据迁移**：旧 Store 的数据需要迁移到新 Store
3. **测试覆盖**：每个 Store 和主要组件都需要测试
4. **性能优化**：避免不必要的重渲染
5. **错误处理**：所有 IPC 调用都需要错误处理

---

## 📊 进度追踪

建议使用 Task 工具追踪每个 Phase 的进度。

---

**文档版本**: v1.0
**创建时间**: 2026-03-14
