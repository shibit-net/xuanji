# WorkspaceMonitor 启动回忆状态展示修复

## 问题描述

用户希望在 Xuanji GUI 启动时：
1. 主 Agent 先执行回忆（memory recall）
2. 基于回忆内容生成引导语句
3. 在这个过程中，WorkspaceMonitor 能够实时展示主 Agent 的状态（"正在回忆..."）
4. **不在聊天框中插入"回忆中"消息**
5. **回忆完成后，WorkspaceMonitor 中的"回忆中"状态应该隐藏**

**原有问题：**
- `onBootThinking()` 回调在 `ChatSession.runSingleAgent()` 中触发
- 但此时回忆还没有开始（回忆发生在 `PromptOrchestrator.buildAndApply()` 中）
- 导致 WorkspaceMonitor 显示"回忆中"状态时，实际上还没有开始回忆
- 在聊天框中插入了不必要的"回忆中"占位消息
- **回忆完成后，"回忆往事"标签没有消失**（duration 计算错误导致 `finishTimelineEvent` 失败）

## 解决方案

### 1. 修改 `PromptOrchestrator` 构造函数

接收 `onBootThinking` 回调参数：

```typescript
constructor(
  private readonly config: AppConfig,
  private readonly agentLoop: AgentLoop,
  private readonly registry: IToolRegistry,
  private readonly reminderContext: () => string | null,
  private readonly onBootThinking?: () => void,  // 新增
) {}
```

### 2. 在真正开始回忆前触发回调

在 `PromptOrchestrator.buildAndApply()` 中，检测到启动场景时：

```typescript
// 启动场景：先触发 onBootThinking 回调（展示"回忆中"状态），再执行回忆
const isStartup = userMessage === '__startup__';
if (isStartup && this.onBootThinking) {
  log.info('🚀 Startup detected, triggering onBootThinking callback before memory recall');
  this.onBootThinking();
}

// 注入 DecisionContext（核心规则 + 用户画像 + 相关经验 + 待处理事项）
if (this.memoryManager) {
  // ... 执行回忆逻辑
}
```

### 3. 更新 `ChatSession` 传递回调

```typescript
this.promptOrchestrator = new PromptOrchestrator(
  this.config!,
  this.agentLoop,
  this.registry,
  () => this.reminderContext,
  this.sessionCallbacks?.onBootThinking,  // 传递回调
);
```

### 4. 移除原有的错误位置调用

从 `ChatSession.runSingleAgent()` 中移除了原来的 `onBootThinking()` 调用。

### 5. 前端只更新 WorkspaceMonitor 状态

在 `chatStore.ts` 中：
- **移除**：不再在聊天框中插入"🧠 回忆往事中..."占位消息
- **保留**：只设置 WorkspaceMonitor 的状态（`setAgentStatus`, `setAgentMoment`, `addTimelineEvent`）
- **新增**：保存 `bootThinkingStartTime` 用于计算 duration

### 6. 回忆完成后正确清除状态

在 `session:boot-guide` 事件处理中：
- **移除**：不再添加引导消息（因为引导语已经通过正常的流式事件 `agent:text` 添加到对话框了）
- 调用 `setAgentStatus(null)` 清除主 Agent 状态
- 调用 `finishAgentMoment()` 完成动作
- **修复**：使用保存的 `bootThinkingStartTime` 正确计算 duration，确保 `finishTimelineEvent()` 能够找到并删除对应的事件

```typescript
// 不需要添加消息，因为引导语已经通过正常的流式事件（agent:text）添加到对话框了
// 这里只需要清除 WorkspaceMonitor 的"回忆中"状态

// 使用保存的开始时间计算 duration
const duration = bootThinkingStartTime > 0 ? Date.now() - bootThinkingStartTime : 0;
runtimeStore.finishTimelineEvent('main', 'boot-thinking', duration, 'success');
```

## 执行流程

修复后的完整流程：

```
1. GUI 启动 → 发送 __startup__ 消息
2. ChatSession.run('__startup__')
3. ChatSession.runSingleAgent('__startup__')
4. PromptOrchestrator.buildAndApply('__startup__')
   ├─ 检测到启动场景
   ├─ 触发 onBootThinking() 回调 ✅ 【新位置】
   │  └─ WorkspaceMonitor 显示主 Agent "回忆往事" 状态
   │  └─ 聊天框中不插入任何消息 ✅
   │  └─ 保存 bootThinkingStartTime ✅
   ├─ 执行 memoryManager.formatDecisionContext() 【真正的回忆】
   └─ 构建 system prompt（包含回忆内容）
5. AgentLoop.run() → LLM 生成引导语
6. 触发 onBootGuide() 回调
   └─ 聊天框中添加引导消息
   └─ 使用 bootThinkingStartTime 计算正确的 duration ✅
   └─ finishTimelineEvent 成功删除 'boot-thinking' 事件 ✅
   └─ WorkspaceMonitor 清除"回忆中"状态 ✅
```

## 影响范围

- ✅ 修改文件：
  - `src/core/chat/PromptOrchestrator.ts`
  - `src/core/chat/ChatSession.ts`
  - `desktop/renderer/stores/chatStore.ts`
- ✅ 类型检查通过
- ✅ 不影响其他功能

## 关键修复点

**问题根源 1**：`finishTimelineEvent` 的实现是通过 `eventId` 从数组中删除事件。如果 duration 计算错误或者 eventId 不匹配，事件就不会被删除，导致"回忆往事"标签一直显示。

**解决方案 1**：在 `boot-thinking` 事件触发时保存 `bootThinkingStartTime`，在 `boot-guide` 事件中使用这个时间戳计算正确的 duration，确保 `finishTimelineEvent('main', 'boot-thinking', duration, 'success')` 能够成功找到并删除事件。

**问题根源 2**：`onBootGuide` 回调从来没有被调用！虽然在 `ChatSession` 中定义了这个回调，并且在 `agent-bridge.ts` 中注册了，但是在 LLM 生成引导语后，没有任何地方调用这个回调。

**解决方案 2**：在 `ChatSession.runSingleAgent()` 中，`agentLoop.run()` 执行完成后，检查是否是启动场景（`__startup__`），如果是，则从消息历史中提取最后一条 assistant 消息（即 LLM 生成的引导语），并调用 `onBootGuide` 回调。

```typescript
// 如果是启动场景，触发 onBootGuide 回调（传递 LLM 生成的引导语）
if (isStartup && this.sessionCallbacks?.onBootGuide) {
  const messages = this.agentLoop!.getMessageHistory();
  const lastMessage = messages[messages.length - 1];
  if (lastMessage && lastMessage.role === 'assistant') {
    // 提取文本内容
    let guideText = '';
    if (Array.isArray(lastMessage.content)) {
      for (const block of lastMessage.content) {
        if (block.type === 'text') {
          guideText += block.text;
        }
      }
    } else if (typeof lastMessage.content === 'string') {
      guideText = lastMessage.content;
    }

    if (guideText) {
      log.info('🎉 Startup guide generated, triggering onBootGuide callback');
      this.sessionCallbacks.onBootGuide(guideText);
    }
  }
}
```

## 测试建议

1. 启动 Xuanji GUI
2. 观察 WorkspaceMonitor 中主 Agent 的状态变化
3. 确认聊天框中**没有**"回忆往事中..."占位消息 ✅
4. 确认 WorkspaceMonitor 显示"回忆往事"标签在真正执行回忆时出现 ✅
5. **确认引导语生成后，"回忆往事"标签立即消失** ✅
6. 确认引导语基于回忆内容生成 ✅

## 日期

2026-04-16
