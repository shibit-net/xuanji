# 消息格式问题排查与解决方案

## 问题表现

**时间**：2026-03-04 07:08-07:12

**现象**：追加内容后，调用 LLM API 返回 `api_error: "模型服务内部错误，请稍后重试"`

**日志证据**：

```
[2026-03-04T07:08:22.236Z] Request: messages=90
messages: [
  ...
  {"role":"user","contentType":"object","contentLength":3},  // ← 倒数第二条 user（tool_result）
  {"role":"user","contentType":"string","contentLength":4}   // ← 最后一条 user（追加内容）
]
```

**根本原因**：消息序列中出现**连续的两条 user 消息**，违反了 Claude API 的格式要求。

---

## 已实施的修复方案

### 1. MessageManager 新增安全方法

**文件**：`src/core/agent/MessageManager.ts`

#### 1.1 addUserMessageSafe()

```typescript
/**
 * 安全添加 user 消息（避免连续 user 消息）
 *
 * 如果最后一条消息是 user，则追加到该消息；否则创建新的 user 消息
 */
addUserMessageSafe(content: string): boolean {
  if (this.messages.length === 0) {
    this.addUserMessage(content);
    return false;
  }

  const lastMsg = this.messages[this.messages.length - 1];
  if (lastMsg.role === 'user') {
    // 最后一条是 user → 追加
    this.appendTextToLastMessage(`\n\n${content}`);
    return true;
  } else {
    // 最后一条不是 user → 新增
    this.addUserMessage(content);
    return false;
  }
}
```

#### 1.2 addAssistantMessageSafe()

```typescript
/**
 * 安全添加 assistant 消息（避免连续 assistant 消息）
 *
 * 如果最后一条消息是 assistant，记录警告并跳过
 */
addAssistantMessageSafe(content: ContentBlock[]): boolean {
  if (this.messages.length === 0) {
    this.addAssistantMessage(content);
    return true;
  }

  const lastMsg = this.messages[this.messages.length - 1];
  if (lastMsg.role === 'assistant') {
    // 最后一条已经是 assistant → 警告并跳过
    log.warn('Attempted to add consecutive assistant message, skipping');
    return false;
  } else {
    // 最后一条不是 assistant → 正常添加
    this.addAssistantMessage(content);
    return true;
  }
}
```

### 2. AgentLoop 使用安全方法

**文件**：`src/core/agent/AgentLoop.ts`

#### 2.1 循环顶部追加消息（L209）

```typescript
// 关键修复：使用 addUserMessageSafe 避免连续 user 消息
const merged = this.messageManager.addUserMessageSafe(appendMsg);
this.log.info(`User message ${merged ? 'merged' : 'injected'}: interrupted=${wasInterrupted}, msg="${appendMsg.slice(0, 80)}"`);
```

#### 2.2 Placeholder assistant 插入（L180-197）

```typescript
if (wasInterrupted) {
  const history = this.messageManager.getHistory();
  const lastMsg = history[history.length - 1];
  if (lastMsg && lastMsg.role === 'user') {
    this.log.debug('Interrupt: last message is user, inserting placeholder assistant message');
    const added = this.messageManager.addAssistantMessageSafe([{
      type: 'text',
      text: '[Interrupted] 用户中断了当前执行并提交了新的指令。',
    }]);
    if (!added) {
      this.log.warn('Interrupt: placeholder assistant not added (last message already assistant)');
    }
  } else if (lastMsg && lastMsg.role === 'assistant') {
    this.log.debug('Interrupt: last message is already assistant, skipping placeholder');
  }
}
```

#### 2.3 Max tokens 系统提示（L387）

```typescript
// ★ 使用 addUserMessageSafe 避免连续 user 消息
const merged = this.messageManager.addUserMessageSafe(systemHint);
this.log.debug(`Max tokens system hint ${merged ? 'merged' : 'added'}`);
```

---

## 历史问题分析

### 问题来源

从日志时间线分析：

1. **03-02 至 03-03**：在修复之前，某次追加操作产生了连续 user 消息
2. **03-04 05:59**：session 保存时包含了这个错误的消息序列（91 条消息）
3. **03-04 07:08**：恢复 session 后，错误的消息序列被继续使用
4. **API 拒绝**：Claude API 检测到格式违规，返回 `api_error`

### 为什么会产生连续 user 消息？

**修复前的代码逻辑**（已废弃）：

```typescript
// ❌ 旧代码（总是新增，不检查最后一条消息）
this.messageManager.addUserMessage(appendMsg);
```

**问题场景**：

1. `ensureToolResultPairing()` 添加了一条 user 消息（包含 placeholder tool_result）
2. `addUserMessage(appendMsg)` 又添加了一条 user 消息（追加内容）
3. **结果**：连续两条 user 消息 → API 格式错误

---

## 解决方案

### 方案 1：清除当前 session（推荐）

```bash
# 1. 退出当前对话
Ctrl+C

# 2. 清除有问题的 session 文件
rm ~/.xuanji/sessions/session-*.jsonl  # 或者只删除对应的 session

# 3. 重新启动 xuanji
npm run dev

# 4. 开始新的对话
```

**优点**：
- 简单直接，一次性解决
- 不需要手动修复消息序列
- 适合快速验证修复是否生效

**缺点**：
- 会丢失当前 session 的历史记录

### 方案 2：手动修复 session 文件

如果需要保留当前 session 的历史，可以手动修复 JSONL 文件：

```bash
# 1. 找到对应的 session 文件
ls -lt ~/.xuanji/sessions/

# 2. 备份
cp ~/.xuanji/sessions/session-XXX.jsonl ~/.xuanji/sessions/session-XXX.jsonl.bak

# 3. 编辑 JSONL 文件，找到连续的 user 消息，合并为一条
# 将第二条 user 消息的内容追加到第一条的 content 字段

# 4. 重新启动 xuanji 并恢复 session
/resume session-XXX
```

**优点**：
- 保留历史记录
- 可以学习修复过程

**缺点**：
- 需要手动编辑 JSONL
- 容易出错

### 方案 3：验证修复（推荐用于测试）

```bash
# 1. 确保代码已重新构建
npm run build

# 2. 启动新的对话
npm run dev

# 3. 测试追加内容功能
用户: 帮我分析一下代码
[等待 Agent 开始输出]
用户: 用英文回复  # ← 追加内容
[等待 Agent 响应]
用户: 不，用中文  # ← 再次追加
[等待 Agent 响应]

# 4. 检查日志，验证是否有 "merged" 日志
tail -f ~/.xuanji/logs/core.log | grep "merged\|injected"

# 5. 检查消息序列，验证是否还有连续 user 消息
tail -100 ~/.xuanji/logs/core.log | grep "Request structure" -A 2
```

**预期结果**：

```
[INFO] User message merged: interrupted=true, msg="用英文回复"
[INFO] User message merged: interrupted=true, msg="不，用中文"
```

**消息序列**（正确）：

```json
{
  "messages": [
    {"role":"user","content":"帮我分析一下代码"},
    {"role":"assistant","content":"[Interrupted]"},
    {"role":"user","content":"用英文回复\n\n不，用中文"}  // ← 合并
  ]
}
```

---

## 预防机制

### 1. 消息序列验证（已实施）

所有可能产生消息的地方，统一使用 `addUserMessageSafe()` 和 `addAssistantMessageSafe()`。

### 2. 日志监控

新增的日志关键词：
- `"merged"` — 追加到现有消息
- `"injected"` — 新增消息
- `"skipping"` — 跳过（避免连续 assistant）

### 3. 未来优化（可选）

**P1**：消息序列验证器

```typescript
class MessageValidator {
  validate(messages: Message[]): ValidationResult {
    // 检查是否有连续相同角色消息
    // 检查 tool_use/tool_result 配对
    // 检查 user/assistant 交替
  }
}
```

**P2**：自动修复

```typescript
MessageManager.repairSequence(): number {
  // 自动合并连续相同角色消息
  // 返回修复的消息数
}
```

---

## 总结

**修复状态**：✅ 代码已修复，等待验证

**下一步**：
1. 清除当前 session（或开始新对话）
2. 测试追加内容功能
3. 验证日志中是否有 "merged" 关键词
4. 确认消息序列格式正确

**预期效果**：
- ✅ 不再出现连续 user 消息
- ✅ 不再出现连续 assistant 消息
- ✅ API 调用成功
- ✅ 追加内容功能正常工作
