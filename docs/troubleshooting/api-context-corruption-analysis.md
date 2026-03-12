# Xuanji API 上下文破坏问题排查报告

> 生成时间：2026-03-10

## 问题描述

调用工具后，如果 API 返回 429（频率超限）或其他错误，会导致消息上下文异常：
- 连续两条 user 消息（tool_result + 新用户输入）
- API 代理（shibit-llm）可能因上下文结构异常返回错误
- 用户重试时触发更多 API 错误，形成恶性循环

---

## 根本原因

### 1. 异常发生位置

**AgentLoop.ts:307**
```typescript
if (!streamResult.result) {
  if (streamResult.interrupted) {
    this.log.debug('No result due to interrupt, continuing to process append message');
    continue;
  }
  throw streamResult.lastError ?? new Error('API call failed after retries');  // ← 抛出异常
}
```

**触发条件**：
- LLM API 调用失败（429、500、502、503 等）
- 重试策略失败（RetryPolicy.ts:89 - 429 不重试）
- StreamRetryHandler 返回 `result: null`

### 2. 消息历史状态异常

**异常时刻的消息历史**：
```
messages = [
  {role: 'user', content: '第一条用户消息'},
  {role: 'assistant', content: [{type: 'tool_use', ...}]},  // ← 已添加（324 行）
  {role: 'user', content: [{type: 'tool_result', ...}]},    // ← 已添加（424 行）
]
```

**AgentLoop 抛出异常 → App.tsx catch（2157 行）→ 循环结束**

### 3. 用户重试时的问题

**第二轮对话**（用户重新发送输入）：
```typescript
// MessageManager.build(userMessage)  ← 第 46 行
this.messages.push({
  role: 'user',
  content: userMessage,
});
```

**此时消息历史变成**：
```
messages = [
  {role: 'user', content: '第一条用户消息'},
  {role: 'assistant', content: [{type: 'tool_use', ...}]},
  {role: 'user', content: [{type: 'tool_result', ...}]},
  {role: 'user', content: '用户重试消息'},  // ← 连续两条 user 消息！
]
```

---

## 影响范围

### 1. Anthropic API（官方）

✅ **无影响** - Anthropic API 允许连续 user 消息

### 2. OpenAI API（官方）

✅ **无影响** - OpenAI API 允许连续 user 消息

### 3. shibit-llm（API 代理）

❌ **有影响** - shibit-llm 的适配器可能对消息结构有更严格的校验：
- 不允许连续 user 消息
- tool_result 必须紧跟 tool_use 的 assistant 消息
- 消息结构不符合预期时返回 400/422 错误

### 4. 其他自定义 API 代理

⚠️ **可能影响** - 取决于代理的消息结构校验逻辑

---

## 错误链路追踪

```
1. Agent 调用 LLM（含 tool_use）
   ↓
2. Agent 执行工具
   ↓
3. Agent 添加 tool_result 到历史
   ↓
4. Agent 重建 messages
   ↓
5. Agent 调用 LLM（下一轮）
   ↓
6. API 返回 429（频率超限）
   ↓
7. StreamRetryHandler 重试 3 次失败
   ↓
8. StreamRetryHandler 返回 null
   ↓
9. AgentLoop 抛出异常
   ↓
10. App.tsx catch，循环结束
   ↓
11. 用户重试，添加新消息
   ↓
12. MessageManager.build() → 连续两条 user 消息
   ↓
13. API 代理（shibit-llm）校验失败 → 返回 400/422
   ↓
14. 用户再次重试 → 继续触发错误 → 恶性循环
```

---

## 关键代码位置

| 文件 | 行号 | 问题 |
|------|------|------|
| `AgentLoop.ts` | 324 | addAssistantMessage (tool_use 已记录) |
| `AgentLoop.ts` | 424 | addToolResults (tool_result 已记录) |
| `AgentLoop.ts` | 440 | getMessages() (重建完整消息) |
| `AgentLoop.ts` | 286 | LLM API 调用（可能失败） |
| `AgentLoop.ts` | 307 | 抛出异常（上下文未回滚） |
| `AgentLoop.ts` | 468 | catch 块（无回滚逻辑） |
| `App.tsx` | 2157 | catch 块（仅清理 UI 状态） |
| `MessageManager.ts` | 46 | build() push 新用户消息 |
| `RetryPolicy.ts` | 89-91 | 429 错误不重试（直接失败） |

---

## 解决方案

### 方案 1：消息历史回滚（推荐）

**原理**：在 AgentLoop 抛出异常前，回滚到工具执行前的状态。

**实现**：
```typescript
// AgentLoop.ts

// 1. 在工具执行前保存快照
const messageSnapshot = this.messageManager.getHistory();

try {
  // 2. 执行工具
  const execResult = await this.toolExecutionCoordinator.executeTools(...);

  // 3. 添加工具结果
  this.messageManager.addToolResults(resultsMap);

  // 4. 重建消息
  messages = this.messageManager.getMessages();

  // 5. 调用 LLM（可能失败）
  const streamResult = await this.streamRetryHandler.executeWithRetry(...);

  if (!streamResult.result) {
    // ★ 回滚到快照状态 ★
    this.messageManager.replaceMessages(messageSnapshot);
    throw streamResult.lastError ?? new Error('API call failed after retries');
  }
} catch (error) {
  // 错误处理
  throw error;
}
```

**优点**：
- ✅ 彻底解决上下文破坏问题
- ✅ 用户重试时状态一致
- ✅ 对所有 API 提供商有效

**缺点**：
- ⚠️ 需要保存/恢复消息历史（内存开销小）

---

### 方案 2：智能合并连续 user 消息

**原理**：在 MessageManager.build() 中检测连续 user 消息，自动合并。

**实现**：
```typescript
// MessageManager.ts

build(userMessage: string): Message[] {
  // 检查最后一条消息是否为 user
  const lastMsg = this.messages[this.messages.length - 1];

  if (lastMsg && lastMsg.role === 'user') {
    // 合并到最后一条 user 消息
    if (Array.isArray(lastMsg.content)) {
      // 已有 ContentBlock[]（tool_result），追加 text 块
      lastMsg.content.push({ type: 'text', text: userMessage });
    } else {
      // 纯文本，转换为 ContentBlock[] 并追加
      lastMsg.content = [
        { type: 'text', text: lastMsg.content as string },
        { type: 'text', text: userMessage },
      ];
    }
  } else {
    // 正常添加新 user 消息
    this.messages.push({
      role: 'user',
      content: userMessage,
    });
  }

  return [
    { role: 'system', content: this.getSystemPromptBlocks() },
    ...this.messages,
  ];
}
```

**优点**：
- ✅ 自动修复连续 user 消息问题
- ✅ 符合 API 规范（Anthropic 支持 user 消息混合 tool_result + text）
- ✅ 无需回滚逻辑

**缺点**：
- ⚠️ 改变了原有的消息结构语义（两条独立消息 → 一条合并消息）
- ⚠️ 可能影响上下文理解（LLM 可能认为是同一轮输入）

---

### 方案 3：改进 429 错误处理

**原理**：429 错误后不抛出异常，而是进入冷却期，等待后重试。

**实现**：
```typescript
// StreamRetryHandler.ts

if (!result) {
  if (interrupted && lastStreamError && isRateLimitError(lastStreamError)) {
    const cooldown = 60_000;  // 60 秒冷却
    log.warn(`Rate limit detected, cooling down for ${cooldown}ms`);
    callbacks?.onInfo?.(`⏸️ API 请求频率超限，等待 ${cooldown / 1000} 秒后自动重试...`);
    await sleep(cooldown);

    // ★ 重试（递归调用） ★
    return this.executeWithRetry(messages, toolSchemas, iteration, originalTextHandler, callbacks, interruptChecker);
  }

  return {
    result: null,
    lastError: lastStreamError,
    interrupted,
  };
}
```

**优点**：
- ✅ 自动处理 429 错误，无需用户手动重试
- ✅ 避免上下文破坏

**缺点**：
- ⚠️ 长时间冷却可能影响用户体验
- ⚠️ 递归调用可能导致栈溢出（需限制递归深度）

---

## 推荐方案

**组合方案：方案 1 + 方案 3**

1. **方案 3**：改进 429 错误处理，自动冷却并重试（限制 1 次递归）
2. **方案 1**：如果最终仍失败，回滚消息历史后抛出异常

**实现步骤**：
1. 修改 StreamRetryHandler，429 错误后冷却 60 秒并重试 1 次
2. 修改 AgentLoop，在抛出异常前回滚消息历史
3. 修改 MessageManager，添加 `saveSnapshot()` 和 `restoreSnapshot()` 方法

---

## 测试计划

### 1. 单元测试

- [ ] MessageManager.saveSnapshot / restoreSnapshot
- [ ] MessageManager.build 连续 user 消息合并
- [ ] StreamRetryHandler 429 错误冷却重试

### 2. 集成测试

- [ ] 工具执行后 API 429 错误，验证消息历史回滚
- [ ] 用户重试后消息结构正确
- [ ] shibit-llm 代理下的异常处理

### 3. 手动测试

- [ ] 配置 shibit-llm 代理
- [ ] 触发 429 错误
- [ ] 验证自动冷却和重试
- [ ] 验证用户手动重试后无错误

---

## 相关文件

- `src/core/agent/AgentLoop.ts` - 主循环逻辑
- `src/core/agent/MessageManager.ts` - 消息历史管理
- `src/core/agent/StreamRetryHandler.ts` - 重试逻辑
- `src/core/providers/RetryPolicy.ts` - 重试策略
- `src/adapters/cli/App.tsx` - UI 层错误处理
- `shibit-llm` - API 代理（外部项目）

---

## 后续行动

1. **立即**：实现方案 1 + 方案 3
2. **短期**：添加单元测试和集成测试
3. **中期**：与 shibit-llm 团队沟通，优化消息结构校验逻辑
4. **长期**：添加详细的 API 错误日志，便于诊断代理层问题
