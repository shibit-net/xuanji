# 补充输入 UI 改进方案

## 执行时间
2026-03-05 12:52

## 问题描述

用户反馈两个问题：
1. **补充内容输入的时候，流式输出内容仍然很割裂**
2. **对于补充内容的处理，没有明确的回复和执行中的展示**

## 当前实现分析

### 当前流程

```typescript
// 用户输入补充内容（如"使用英文"）
handleSubmit(input) {
  // 1. flush 流式文本
  streamTextUpdater.flush();
  archiveStreamText();  // 归档已输出的内容到 assistant 消息

  // 2. 添加到 pending 队列
  setPendingUserInputs([...prev, { content: input, timestamp }]);

  // 3. 100ms 后调用 interrupt
  setTimeout(() => {
    archiveStreamText();  // 再次归档

    // 添加 pending 队列消息到历史
    for (const pending of pendingUserInputs) {
      setMessages([...prev, { role: 'user', content: pending.content }]);
    }
    setPendingUserInputs([]);  // 清空队列

    // 调用 interrupt
    agentLoop.interrupt(finalInput);
  }, 100);
}
```

### UI 显示

```typescript
// L2316-2344：pending 队列提示
{pendingUserInputs.length > 0 && status !== 'idle' && (
  <Box>
    <Text>✓ 已收到 {pendingUserInputs.length} 条补充</Text>
    {status === 'thinking' && <Text>⏳ 中断流式输出中...</Text>}
  </Box>
)}
```

### 问题分析

**问题1：流式输出割裂**
- 归档后的内容和新的流式输出之间**没有明确的连接**
- 用户看到的是两段独立的 assistant 输出，不知道它们是连续的
- 缺少"补充输入"的视觉标记

**问题2：处理反馈不明确**
- pending 提示在 100ms 后立即消失（因为队列被清空）
- 用户不知道补充输入是否被处理
- interrupt 后到新响应前，没有任何反馈

## 改进方案

### 方案1：在归档内容后添加补充输入标记（推荐）

**思路**：在 interrupt 调用前，添加一条 system 消息显示补充输入。

**修改位置**：`src/adapters/cli/App.tsx:1848-1877`

```typescript
interruptDebounceTimerRef.current = setTimeout(() => {
  const finalInput = latestPendingInputRef.current;

  // 1. 归档流式文本
  archiveStreamText();

  // ★ 新增：添加补充输入到历史（明确显示） ★
  if (pendingUserInputs.length > 0) {
    const newMessages: ChatMessage[] = [];
    for (const pending of pendingUserInputs) {
      const uid = ++msgIdRef.current;
      // 添加用户消息（补充输入）
      newMessages.push({
        id: uid,
        role: 'user',
        content: `💬 ${pending.content}`,  // 添加表情符号标记
        timestamp: pending.timestamp,
      });
    }
    setMessages((prev) => [...prev, ...newMessages]);
    setPendingUserInputs([]);
  }

  // 2. 调用 interrupt
  agentLoop.interrupt(finalInput);
  interruptDebounceTimerRef.current = null;
  latestPendingInputRef.current = '';
}, 100);
```

**效果**：
- ✅ 归档内容和补充输入之间有明确的分隔
- ✅ 补充输入显示为独立的 user 消息
- ✅ 视觉上连贯：第一段输出 → 补充输入 → 第二段输出

### 方案2：改进 pending 提示的持久性

**思路**：添加一个新的状态，在 interrupt 后到新响应前显示"处理中"。

**修改位置**：
1. `src/adapters/cli/App.tsx:150`（添加状态）
2. `src/adapters/cli/App.tsx:1877`（设置状态）
3. `src/adapters/cli/App.tsx:936`（清除状态）
4. `src/adapters/cli/App.tsx:2316`（显示提示）

```typescript
// 1. 添加状态
const [processingAppend, setProcessingAppend] = useState<string | null>(null);

// 2. interrupt 后设置状态
interruptDebounceTimerRef.current = setTimeout(() => {
  // ... 现有逻辑

  // ★ 新增：设置处理中状态 ★
  setProcessingAppend(finalInput);

  agentLoop.interrupt(finalInput);
  // ... 清理
}, 100);

// 3. 新响应开始时清除状态
onThinking: () => {
  // ... 现有逻辑

  // ★ 新增：清除处理中状态 ★
  setProcessingAppend(null);
},

// 4. UI 显示
{processingAppend && (
  <Box marginTop={1}>
    <Text color="yellow">⏳ 正在处理补充输入：</Text>
    <Text color="#10B981">{processingAppend.slice(0, 60)}</Text>
  </Box>
)}
```

**效果**：
- ✅ interrupt 后立即显示"处理中"提示
- ✅ 提示持续到新的流式输出开始
- ✅ 用户知道补充输入正在被处理

### 方案3：在新流式输出前添加上下文标记（可选）

**思路**：在新的流式输出开始时，添加一个上下文标记。

**修改位置**：`src/adapters/cli/App.tsx:936`

```typescript
onThinking: () => {
  // ... 现有逻辑

  // ★ 新增：如果是 interrupt 触发的，添加上下文标记 ★
  if (processingAppend) {
    const id = ++msgIdRef.current;
    setMessages((prev) => [...prev, {
      id,
      role: 'system',
      content: `↪️ 基于补充输入的回复`,
      timestamp: Date.now(),
    }]);
    setProcessingAppend(null);
  }

  dispatchTool({ type: 'SET_THINKING' });
},
```

**效果**：
- ✅ 新输出前有明确的标记
- ✅ 用户知道这是基于补充输入的回复
- ✅ 上下文更连贯

## 推荐实施方案

**组合方案：方案1 + 方案2**

1. **方案1**（必须）：在 interrupt 前添加补充输入消息到历史
   - 视觉上清晰：第一段 → 补充 → 第二段
   - 历史记录完整

2. **方案2**（必须）：添加"处理中"状态提示
   - 反馈明确：用户知道补充输入正在被处理
   - 避免"卡住"感

3. **方案3**（可选）：新输出前添加上下文标记
   - 进一步增强连贯性
   - 但可能显得冗余

## 实施步骤

1. ✅ 修改 `handleSubmit` 中的 interrupt 逻辑（方案1）
2. ✅ 添加 `processingAppend` 状态（方案2）
3. ✅ 修改 `onThinking` 回调，清除处理中状态（方案2）
4. ✅ 添加"处理中"UI 提示（方案2）
5. ✅ 测试多次连续补充输入
6. ✅ 验证视觉连贯性

## 预期效果

**改进前**：
```
┌─ 第一段输出 ─┐
│ 这是测试... │
└──────────────┘
  ← 100ms 空白，用户不知道发生了什么
┌─ 第二段输出 ─┐
│ In English...│  ← 用户困惑：为什么突然变英文了？
└──────────────┘
```

**改进后**：
```
┌─ 第一段输出 ─┐
│ 这是测试... │
└──────────────┘
┌─ 补充输入 ───┐
│ 💬 使用英文  │  ← 明确显示
└──────────────┘
⏳ 正在处理补充输入：使用英文  ← 处理中反馈
┌─ 第二段输出 ─┐
│ In English...│  ← 用户明白：这是基于补充的回复
└──────────────┘
```

## 总结

✅ **解决流式输出割裂**：
- 补充输入作为独立消息显示
- 明确的视觉分隔和连接

✅ **解决处理反馈不明确**：
- "处理中"状态持续显示
- 用户知道补充输入正在被处理
- 避免"卡住"或"无响应"感

✅ **改善用户体验**：
- 视觉连贯性提升
- 反馈及时明确
- 符合直觉
