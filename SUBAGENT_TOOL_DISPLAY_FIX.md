# 子 Agent 工具调用展示修复

## 问题描述

在 WorkspaceMonitor 中，子 Agent 调用的工具没有在 Agent 图标右侧展示。

## 问题根源

子 Agent 的工具调用事件（`agent:tool-start` 和 `agent:tool-end`）没有包含 `agentId` 参数，导致前端无法知道是哪个 Agent 在调用工具。

具体原因：
1. **主 Agent** 的工具调用通过 `ChatSession.on()` 注册的回调发送，这些回调没有 `agentId` 参数
2. **子 Agent** 的 `AgentLoop` 在 `SubAgentLoop.ts` 中创建，但只注册了 `onText` 和 `onThinking` 回调，没有注册 `onToolStart` 和 `onToolEnd` 回调
3. 前端的 `_handleAgentToolStart` 依赖 `activeAgentStore.currentActiveAgentId` 来判断是哪个 Agent，但子 Agent 的工具调用事件根本没有触发这个处理函数

## 解决方案

### 1. 后端：为子 Agent 注册工具调用回调

在 `SubAgentLoop.ts` 的 `runSubAgent` 函数中，为子 Agent 的 `agentLoop.on()` 添加 `onToolStart` 和 `onToolEnd` 回调，并通过 HookRegistry 发送事件：

```typescript
agentLoop.on({
  onText: (text) => { ... },
  onThinking: (thinking) => { ... },
  onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
    if (hookRegistry) {
      hookRegistry.emit('ToolStart', {
        subAgentId,
        toolId: id,
        toolName: name,
        toolInput: input,
      });
    }
  },
  onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
    if (hookRegistry) {
      hookRegistry.emit('ToolEnd', {
        subAgentId,
        toolId: id,
        toolName: name,
        toolResult: result,
        toolIsError: isError,
      });
    }
  },
});
```

### 2. 后端：添加 Hook 事件类型

在 `hooks/types.ts` 中添加 `ToolStart` 和 `ToolEnd` 事件类型：

```typescript
export type HookEvent =
  | ...
  | 'ToolStart'        // 工具调用开始（子 Agent）
  | 'ToolEnd';         // 工具调用结束（子 Agent）
```

并在 `HookEventContext` 中添加 `toolId` 字段：

```typescript
export interface HookEventContext {
  ...
  /** 工具 ID（ToolStart/ToolEnd） */
  toolId?: string;
  ...
}
```

### 3. 桌面端：监听 Hook 事件并转发

在 `agent-bridge.ts` 中添加对 `ToolStart` 和 `ToolEnd` Hook 的监听：

```typescript
hookRegistry.addListener('ToolStart', async (ctx: any) => {
  safeSend({
    type: 'agent:tool-start',
    data: {
      id: ctx.toolId,
      name: ctx.toolName,
      input: ctx.toolInput,
      agentId: ctx.subAgentId || 'main',
    },
  });
  return { success: true };
});

hookRegistry.addListener('ToolEnd', async (ctx: any) => {
  safeSend({
    type: 'agent:tool-end',
    data: {
      id: ctx.toolId,
      name: ctx.toolName,
      result: ctx.toolResult,
      isError: ctx.toolIsError,
      agentId: ctx.subAgentId || 'main',
    },
  });
  return { success: true };
});
```

### 4. 前端：处理带有 agentId 的事件

修改 `chatStore.ts` 中的 `_handleAgentToolStart` 和 `_handleAgentToolEnd`，让它们能够处理带有 `agentId` 的事件：

```typescript
_handleAgentToolStart: (data: { id: string; name: string; input: Record<string, unknown>; agentId?: string }) => {
  ...
  // 优先使用事件中的 agentId，如果没有则从 activeAgentStore 获取
  let currentAgentId: string;
  if (data.agentId) {
    // 事件中有 agentId（来自子 Agent 的 Hook）
    currentAgentId = data.agentId === 'main' ? 'main' : data.agentId;
  } else {
    // 事件中没有 agentId（来自主 Agent 的回调）
    const rawAgentId = activeAgentStore.currentActiveAgentId;
    const isMainAgent = !rawAgentId || rawAgentId === activeAgentStore.mainAgent?.id;
    currentAgentId = isMainAgent ? 'main' : rawAgentId;
  }
  
  // 使用 currentAgentId 添加 timeline 事件
  actStore.addTimelineEvent(currentAgentId, { ... });
}
```

## 修改的文件

**后端：**
- `src/core/agent/SubAgentLoop.ts` - 添加 `onToolStart` 和 `onToolEnd` 回调
- `src/hooks/types.ts` - 添加 `ToolStart` 和 `ToolEnd` 事件类型，添加 `toolId` 字段

**桌面端：**
- `desktop/main/agent-bridge.ts` - 监听 `ToolStart` 和 `ToolEnd` Hook 并转发
- `desktop/renderer/stores/chatStore.ts` - 修改 `_handleAgentToolStart` 和 `_handleAgentToolEnd` 处理带有 `agentId` 的事件

## 测试验证

启动 GUI 并让主 Agent 调用子 Agent（例如使用 `task` 工具），观察：
1. 子 Agent 的图标出现在 WorkspaceMonitor 中
2. 子 Agent 调用工具时，工具图标出现在子 Agent 图标的右侧
3. 浏览器控制台日志显示 `data.agentId` 为子 Agent 的 ID（例如 `subagent-xxx`）

## 技术要点

1. **事件传递链**：SubAgentLoop → HookRegistry → agent-bridge → IPC → chatStore → runtimeStore
2. **agentId 的优先级**：事件中的 `agentId` > `activeAgentStore.currentActiveAgentId`
3. **主 Agent vs 子 Agent**：主 Agent 使用回调，子 Agent 使用 Hook 事件
4. **类型安全**：所有新增字段都添加到了 TypeScript 类型定义中
