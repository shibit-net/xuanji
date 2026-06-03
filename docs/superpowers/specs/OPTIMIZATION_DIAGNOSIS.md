# xuanji 1.0 优化诊断报告

> 日期: 2026-06-03 | 工具: wc + grep + 手动分析

## 1. 代码复杂度

### renderer 层 Top 10 热点 (>500 行)

| # | 文件 | 行数 | 严重度 |
|---|------|------|--------|
| 1 | renderer/pages/MemoryPage.tsx | 1909 | 🔴 极高 |
| 2 | renderer/components/AgentEditor.tsx | 1865 | 🔴 极高 |
| 3 | renderer/components/SystemPromptManager.tsx | 1208 | 🔴 高 |
| 4 | renderer/pages/SettingsPage.tsx | 1152 | 🔴 高 |
| 5 | renderer/services/EventAdapter.ts | 1074 | 🔴 高 |
| 6 | renderer/pages/SkillsMCPPage.tsx | 1059 | 🔴 高 |
| 7 | renderer/components/InputArea.tsx | 1049 | 🔴 高 |
| 8 | renderer/components/ExecutionFlow.tsx | 960 | 🟡 中 |
| 9 | renderer/components/MessageBubble.tsx | 959 | 🟡 中 |
| 10 | renderer/stores/AgentStateMachine.ts | 787 | 🟡 中 |

### src/core 层 Top 10 热点 (>700 行)

| # | 文件 | 行数 |
|---|------|------|
| 1 | core/memory/MemoryManager.ts | 3255 |
| 2 | core/i18n/messages.ts | 2761 |
| 3 | core/agent/team/TeamManager.ts | 2612 |
| 4 | core/agent/factory/AgentFactory.ts | 1321 |
| 5 | core/telemetry/AgentLoopLogger.ts | 1007 |
| 6 | mcp/market/TiangongMarket.ts | 910 |
| 7 | core/chat/ChatSession.ts | 872 |
| 8 | platform/adapters/WechatAdapter.ts | 857 |
| 9 | core/chat/SessionFactory.ts | 844 |
| 10 | permission/PermissionController.ts | 834 |

## 2. Store 依赖分析

### Store 列表 (18 个文件)

chatStore(别名→messageStore), messageStore, conversationStore, conversationHub, executionStore, unifiedLogStore, sessionStore, SessionInitStore, configStore, runtimeStore, authStore, historyStore, platformStore, workspaceStore, intentRoutingStore, citationStore, agentStateMachine, asyncTaskStore

### 跨 Store 引用

| 文件 | 引用了 | 类型 |
|------|--------|------|
| messageStore | executionStore | import |
| conversationHub | messageStore | import (类型) |
| configStore | authStore | getState() |
| authStore | (自身) | getState() |
| SessionInitStore | configStore | getState() |

### 应合并的 Store 对

| 对 | 理由 |
|----|------|
| chatStore + messageStore + conversationStore | chatStore 已经是 messageStore 的别名；两者完全重叠 |
| conversationHub → 删除 | 仅有类型引用，可并入 messageStore |
| sessionStore + SessionInitStore | 生命周期高度绑定 |
| executionStore + unifiedLogStore | 执行状态与日志流绑定 |

## 3. 跨 Store getState() 调用

- `configStore.ts:102` → `useAuthStore.getState().user?.userId`
- `SessionInitStore.ts:70` → `useConfigStore.getState().updateModelConfig()`
- `authStore.ts:167` → `useAuthStore.getState().loadSavedAccounts()` (自身调用)

## 4. 结论

- **组件拆分优先级**: MemoryPage > AgentEditor > SystemPromptManager > SettingsPage > SkillsMCPPage
- **Store 精简优先级**: chat/message/conversation 合并 → conversationHub 删除 → session 对合并
- **性能风险点**: 大列表无虚拟滚动 (MemoryList, ChatArea messages, AgentManager cards)
- **CSS**: 570 行自定义 CSS 需 audit
- **src/core 暂不拆分**: 改动风险高，先完成 renderer 层优化
