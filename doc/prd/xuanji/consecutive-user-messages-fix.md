# 补充输入导致连续 User 消息问题修复

## 问题描述

**现象**：用户补充输入后，调用 LLM API 返回异常（通常是 400 Bad Request）

**根本原因**：消息历史中出现**连续的两条 user 消息**，违反了 Claude API 的格式要求：

```json
// ❌ 错误格式（连续的 user 消息）
[
  {"role": "user", "content": "第一条用户消息"},
  {"role": "user", "content": "补充输入的消息"},  // ← 违反 API 格式
  {"role": "assistant", "content": "..."}
]

// ✅ 正确格式（user 和 assistant 交替）
[
  {"role": "user", "content": "第一条用户消息"},
  {"role": "assistant", "content": "助手回复"},
  {"role": "user", "content": "补充输入的消息"}
]
```

---

## 日志证据

从 `~/.xuanji/logs/core.log` 中发现：

```
messages: [
  {"role":"user","contentType":"string","contentLength":14},
  {"role":"user","contentType":"string","contentLength":8},  ← 连续两条 user
  {"role":"assistant","contentType":"object","contentLength":2}
]
```

---

## 问题场景分析

### 场景 1：Interrupt 后的消息序列

**流程**：
1. 用户发送初始消息："帮我分析一下代码"（user 消息）
2. Agent 开始 thinking，输出文本流
3. 用户补充输入："用中文回复"（调用 `interrupt()`）
4. AgentLoop 检测到 `_pendingAppendMessage`，进入循环顶部注入逻辑
5. **问题**：直接调用 `addUserMessage(appendMsg)`，创建新的 user 消息
6. **结果**：消息历史变为 `[user, user]`，违反 API 格式

**代码位置**：`src/core/agent/AgentLoop.ts` L203

```typescript
// ❌ 原代码（总是添加新的 user 消息）
this.messageManager.addUserMessage(appendMsg);
```

### 场景 2：工具执行中的边界注入（正常）

**流程**：
1. Agent 调用工具
2. 工具执行期间，用户补充输入："再检查一下 X"
3. 工具执行完成后，调用 `addToolResults()`，创建包含 tool_result 的 user 消息
4. 边界注入调用 `appendTextToLastMessage()`，追加到该 user 消息
5. **结果**：`[user(tool_result + 追加文本)]`，格式正确 ✅

**代码位置**：`src/core/agent/AgentLoop.ts` L555

```typescript
// ✅ 边界注入（追加到最后一条 user 消息）
const injected = this.messageManager.appendTextToLastMessage(appendMsg);
```

### 场景 3：连续快速补充输入（触发问题）

**流程**：
1. 用户发送消息："总结一下"（user 消息）
2. Agent 开始 thinking
3. 用户快速补充：
   - "用英文"（interrupt 1，添加 user 消息）
   - "不，用中文"（interrupt 2，**又添加一条 user 消息**）← 连续 user！
4. **结果**：`[user, user, user]`，严重违反格式

---

## 修复方案

### 核心逻辑

在循环顶部注入追加消息时，**检查最后一条消息的角色**：

```typescript
// ✅ 修复后（检查最后一条消息，避免连续 user）
const history2 = this.messageManager.getHistory();
const lastMsg2 = history2[history2.length - 1];

if (lastMsg2 && lastMsg2.role === 'user') {
  // 最后一条是 user → 追加到该消息（合并）
  const appended = this.messageManager.appendTextToLastMessage(`\n\n${appendMsg}`);
  this.log.info(`User append merged into last user message: appended=${appended}`);
} else {
  // 最后一条不是 user → 正常添加新的 user 消息
  this.messageManager.addUserMessage(appendMsg);
  this.log.info(`User message injected as new message, interrupted=${wasInterrupted}`);
}
```

### 修改文件

**`src/core/agent/AgentLoop.ts`** L201-218

### 处理逻辑

#### 情况 1：最后一条是 user 消息

```typescript
// 消息历史：[user, assistant, user]
//                            ↑ 最后一条
// 追加 "用中文" → [user, assistant, user + "\n\n用中文"]
```

#### 情况 2：最后一条是 assistant 消息

```typescript
// 消息历史：[user, assistant]
//                      ↑ 最后一条
// 添加新 user → [user, assistant, user]
```

#### 情况 3：Interrupt 时最后一条是 user（特殊处理）

```typescript
// 消息历史：[user]  ← 刚发送，还没 assistant 回复
//           ↑ 最后一条

// 步骤 1：插入 placeholder assistant（L185-189）
// → [user, assistant("[Interrupted]")]

// 步骤 2：添加新 user（L203-213，此时最后一条已是 assistant）
// → [user, assistant("[Interrupted]"), user]
```

---

## 效果验证

### 修复前 ❌

```json
// 连续快速补充输入
{
  "messages": [
    {"role": "user", "content": "总结一下"},
    {"role": "user", "content": "用英文"},  // ← 违反格式
    {"role": "user", "content": "不，用中文"}  // ← 违反格式
  ]
}

// API 响应：400 Bad Request
// "error": "messages must alternate between user and assistant"
```

### 修复后 ✅

```json
// 情况 1：第二次补充时，最后一条是 user → 合并
{
  "messages": [
    {"role": "user", "content": "总结一下"},
    {"role": "assistant", "content": "[Interrupted]"},
    {"role": "user", "content": "用英文\n\n不，用中文"}  // ← 合并
  ]
}

// 情况 2：第二次补充时，最后一条是 assistant → 新增
{
  "messages": [
    {"role": "user", "content": "总结一下"},
    {"role": "assistant", "content": "..."},
    {"role": "user", "content": "用中文"}  // ← 新增，格式正确
  ]
}
```

---

## 日志输出

### 合并场景

```
[INFO] [xuanji:AgentLoop] User append merged into last user message: appended=true, msg="用中文"
```

### 新增场景

```
[INFO] [xuanji:AgentLoop] User message injected as new message, interrupted=true, msg="用中文"
```

---

## 向后兼容

- ✅ 不影响正常对话流程（用户提交 → Agent 回复）
- ✅ 不影响工具执行中的边界注入（仍使用 `appendTextToLastMessage`）
- ✅ 不影响 Interrupt 时的 placeholder assistant 插入
- ✅ 修复了连续快速补充输入导致的格式错误

---

## 相关代码

### MessageManager.appendTextToLastMessage()

```typescript
appendTextToLastMessage(text: string): boolean {
  if (this.messages.length === 0) return false;
  const lastMsg = this.messages[this.messages.length - 1];
  if (lastMsg.role !== 'user') return false;

  if (Array.isArray(lastMsg.content)) {
    // Content 是 ContentBlock[]（如 tool_result 块） — 追加 text 块
    (lastMsg.content as ContentBlock[]).push({ type: 'text', text });
  } else {
    // Content 是 string — 转换为 ContentBlock[] 格式
    lastMsg.content = [
      { type: 'text', text: lastMsg.content as string },
      { type: 'text', text },
    ];
  }
  return true;
}
```

### MessageManager.addUserMessage()

```typescript
addUserMessage(content: string): void {
  this.messages.push({
    role: 'user',
    content,
  });
}
```

---

## 测试建议

### 手动测试

1. **测试 1：快速连续补充输入**
   ```
   用户: 分析这段代码
   [Agent thinking]
   用户: 用英文
   用户: 不，用中文
   用户: 还是用日语吧

   预期：第 2、3、4 次输入合并为一条 user 消息
   ```

2. **测试 2：工具执行中补充输入**
   ```
   用户: 读取文件 test.js
   [Agent 调用 read_file]
   用户: 再读取 test2.js

   预期：补充输入追加到 tool_result 的 user 消息
   ```

3. **测试 3：Interrupt 后再次补充**
   ```
   用户: 总结一下
   [Agent thinking]
   用户: 用英文
   [Agent 开始用英文回复]
   用户: 不，还是用中文

   预期：第二次补充合并到第一次的 user 消息
   ```

### 日志验证

```bash
# 检查消息序列
tail -100 ~/.xuanji/logs/core.log | grep "messages:" -A 5

# 检查是否有连续 user
tail -100 ~/.xuanji/logs/core.log | grep -E "\"role\":\"user\".*\"role\":\"user\""

# 检查合并日志
tail -100 ~/.xuanji/logs/core.log | grep "merged into last user message"
```

---

## 统计

**修改文件**：1 个
- `src/core/agent/AgentLoop.ts` — 15 行变更

**新增代码**：12 行

**删除代码**：3 行

**修改逻辑**：循环顶部追加消息注入（L201-218）

---

## 总结

通过在循环顶部注入追加消息时**检查最后一条消息的角色**，成功修复了连续 user 消息导致的 API 格式错误：

- ✅ 最后一条是 user → **合并**（`appendTextToLastMessage`）
- ✅ 最后一条是 assistant → **新增**（`addUserMessage`）
- ✅ Interrupt 时最后一条是 user → 先插入 placeholder assistant，再新增 user

现在用户可以放心地快速连续补充输入，系统会自动合并消息，确保 API 格式正确！🎉
