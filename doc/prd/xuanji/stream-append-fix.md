# 流式输出补充输入问题分析与修复方案

## 执行时间
2026-03-04 19:17

## 问题描述

用户在流式输出期间输入补充内容"使用日语描述测试结果汇总"时，出现两个问题：

1. **流式输出上下文隔断**：补充输入将流式输出的上下文隔断了
2. **补充输入未被正确处理**：xuanji 没有正确处理补充输入的内容

## 问题根本原因

### 问题1：上下文隔断

**原因**：当用户在 `thinking` 状态（流式输出中）补充输入时，`App.tsx` 会调用 `agentLoop.interrupt(input)`，但**在调用 interrupt 之前没有先归档已经输出的流式文本**。

**代码位置**：`src/adapters/cli/App.tsx:1826-1848`

```typescript
if (status === 'thinking') {
  // thinking 中追加 → 硬中断（立即响应用户）
  // 🆕 Debounce 优化：500ms 后调用 interrupt
  interruptDebounceTimerRef.current = setTimeout(() => {
    const finalInput = latestPendingInputRef.current;
    agentLoop.interrupt(finalInput);  // ← 问题：没有先归档流式文本！
    interruptDebounceTimerRef.current = null;
    latestPendingInputRef.current = '';
  }, 500);
}
```

**后果**：
- 流式输出的内容没有被归档到 Static 区域
- AgentLoop 重新开始时，已输出的内容丢失
- 导致上下文不连续

### 问题2：补充输入未被正确处理

**原因1**：debounce 延迟（500ms）导致用户感知延迟

**原因2**：interrupt 后，`pendingUserInputs` 队列中的消息会在 `onEnd` 时才被添加到历史（`App.tsx:1116-1128`），但 interrupt 触发的是新一轮请求，不会触发 onEnd。

**代码位置**：`src/adapters/cli/App.tsx:1116-1128`

```typescript
// 处理 pending 用户输入队列：流式输出完成后批量添加到历史
if (pendingUserInputs.length > 0) {
  const newMessages: ChatMessage[] = [];
  for (const input of pendingUserInputs) {
    const uid = ++msgIdRef.current;
    const sysId = ++msgIdRef.current;
    newMessages.push(
      { id: uid, role: 'user', content: input.content, timestamp: input.timestamp },
      { id: sysId, role: 'system', content: `💬 ${t('chat.interrupted_append')}`, timestamp: Date.now() },
    );
  }
  setMessages((prev) => [...prev, ...newMessages]);
  setPendingUserInputs([]);
}
```

**问题**：这段代码只在 `onEnd` 回调中执行，但 interrupt 不会触发 onEnd（因为流被中止了）。

## 修复方案

### 方案1：interrupt 前归档流式文本（推荐）

**思路**：在调用 `agentLoop.interrupt()` 之前，先将已输出的流式文本归档到 Static 区域。

**修改位置**：`src/adapters/cli/App.tsx:1826-1848`

**修改后的代码**：

```typescript
if (status === 'thinking') {
  // thinking 中追加 → 硬中断（立即响应用户）

  // 更新最新的输入内容
  latestPendingInputRef.current = input;

  // 取消之前的定时器
  if (interruptDebounceTimerRef.current) {
    clearTimeout(interruptDebounceTimerRef.current);
  }

  // 设置新的定时器：500ms 后调用 interrupt
  interruptDebounceTimerRef.current = setTimeout(() => {
    const finalInput = latestPendingInputRef.current;

    // ★ 修复1：interrupt 前先归档流式文本 ★
    archiveStreamText();

    // ★ 修复2：将 pending 队列中的消息添加到历史 ★
    if (pendingUserInputs.length > 0) {
      const newMessages: ChatMessage[] = [];
      for (const pending of pendingUserInputs) {
        const uid = ++msgIdRef.current;
        newMessages.push({
          id: uid,
          role: 'user',
          content: pending.content,
          timestamp: pending.timestamp,
        });
      }
      setMessages((prev) => [...prev, ...newMessages]);
      setPendingUserInputs([]);
    }

    // 调用 interrupt
    agentLoop.interrupt(finalInput);
    interruptDebounceTimerRef.current = null;
    latestPendingInputRef.current = '';
  }, 500);
}
```

### 方案2：减少 debounce 延迟

**思路**：将 500ms 延迟减少到 100ms，减少用户感知延迟。

**修改位置**：`src/adapters/cli/App.tsx:1842`

```typescript
// 设置新的定时器：100ms 后调用 interrupt（减少延迟）
interruptDebounceTimerRef.current = setTimeout(() => {
  // ...
}, 100);  // 从 500ms 改为 100ms
```

### 方案3：改进 UI 反馈

**思路**：在 debounce 期间显示更明确的 UI 反馈，让用户知道补充输入已被接收。

**修改位置**：`src/adapters/cli/App.tsx:2279-2298`

**修改后的代码**：

```typescript
{pendingUserInputs.length > 0 && status !== 'idle' && !hasInteractiveUI && (
  <Box flexDirection="column" marginTop={1} paddingX={2}>
    <Box>
      <Text color="gray">┌─</Text>
      <Text color="#10B981" bold> ✓ </Text>
      <Text>
        已收到 <Text color="#10B981" bold>{pendingUserInputs.length}</Text> 条补充
        {pendingUserInputs.length > 1 && <Text color="gray" dimColor>（按顺序处理）</Text>}
        {/* ★ 新增：显示处理状态 ★ */}
        {status === 'thinking' && <Text color="yellow" dimColor> ⏳ 中断流式输出中...</Text>}
      </Text>
    </Box>
    <Box>
      <Text color="gray">│ </Text>
      <Text color="gray" dimColor>
        {pendingUserInputs[pendingUserInputs.length - 1].content.slice(0, 60)}
        {pendingUserInputs[pendingUserInputs.length - 1].content.length > 60 ? '...' : ''}
      </Text>
    </Box>
    {pendingUserInputs.length > 1 && (
      <Box>
        <Text color="gray">└─ </Text>
        <Text color="gray" dimColor>
          其余 {pendingUserInputs.length - 1} 条将依次追加
        </Text>
      </Box>
    )}
  </Box>
)}
```

## 实施优先级

### P0（必须修复）
- ✅ **修复1**：interrupt 前归档流式文本（解决上下文隔断）
- ✅ **修复2**：interrupt 前处理 pending 队列（解决补充输入未处理）

### P1（建议修复）
- ⚠️ **减少 debounce 延迟**：500ms → 100ms（减少用户感知延迟）
- ⚠️ **改进 UI 反馈**：显示"中断流式输出中..."（提高用户体验）

### P2（可选优化）
- 考虑添加日志，记录 interrupt 的详细信息（便于调试）
- 考虑添加测试，验证 interrupt 的正确性

## 测试计划

### 测试场景1：流式输出期间补充输入

1. 启动 xuanji
2. 输入："测试你的所有功能"
3. 等待 Agent 开始流式输出
4. 在输出期间输入："使用日语描述"
5. **预期结果**：
   - 流式输出立即停止
   - 已输出的内容被保留（不丢失）
   - 补充输入"使用日语描述"被正确处理
   - Agent 基于前面的内容 + 补充输入生成日语描述

### 测试场景2：工具执行期间补充输入

1. 启动 xuanji
2. 输入："读取 package.json 文件"
3. 等待工具开始执行
4. 在工具执行期间输入："只显示 dependencies"
5. **预期结果**：
   - 工具执行不被中断（继续完成）
   - 补充输入在工具完成后被处理
   - Agent 基于工具结果 + 补充输入回复

### 测试场景3：连续快速补充

1. 启动 xuanji
2. 输入："测试你的所有功能"
3. 等待 Agent 开始流式输出
4. 快速连续输入（间隔 < 100ms）：
   - "使用英文"
   - "不，用中文"
   - "不，用日文"
5. **预期结果**：
   - Debounce 机制生效，只触发一次 interrupt
   - 三条输入被合并（通过 QUEUE_MERGE_WINDOW_MS）
   - Agent 基于最后的指令（日文）回复

## 总结

**根本原因**：
1. interrupt 调用时机不当（未先归档流式文本）
2. pending 队列处理逻辑不完整（只在 onEnd 时处理）

**修复方案**：
1. interrupt 前先归档流式文本（archiveStreamText）
2. interrupt 前处理 pending 队列（添加到历史消息）
3. 减少 debounce 延迟（500ms → 100ms）
4. 改进 UI 反馈（显示处理状态）

**预期效果**：
- ✅ 流式输出上下文不再隔断
- ✅ 补充输入被正确处理
- ✅ 用户体验更流畅
- ✅ 符合 Claude Code 的行为
