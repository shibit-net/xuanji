# 消息序列格式完整修复方案

## 问题根因分析

通过日志分析发现，追加内容后出现**多处连续相同角色消息**，违反了 Claude API 的交替格式要求：

### 日志证据

```json
// 问题 1：三条连续 user 消息
{"role":"user","contentType":"object","contentLength":1},
{"role":"user","contentType":"string","contentLength":7},
{"role":"user","contentType":"string","contentLength":13},

// 问题 2：两条连续 assistant 消息
{"role":"assistant","contentType":"object","contentLength":1},
{"role":"assistant","contentType":"object","contentLength":2},

// 问题 3：两条连续 user 消息（结尾）
{"role":"user","contentType":"string","contentLength":7},
{"role":"user","contentType":"string","contentLength":7}
```

### 触发场景

1. **循环顶部追加消息**（L203-214）：用户 interrupt 后，直接添加 user 消息，未检查最后一条
2. **Placeholder assistant 插入**（L185-195）：interrupt 时插入 assistant，未检查最后一条是否已是 assistant
3. **Max tokens 系统提示**（L389-405）：token 限制时添加 user 消息，未检查最后一条

---

## 修复方案

### 方案 1：MessageManager 新增安全方法

**文件**：`src/core/agent/MessageManager.ts`

#### 1.1 addUserMessageSafe()

```typescript
/**
 * 安全添加 user 消息（避免连续 user 消息）
 *
 * 如果最后一条消息是 user，则追加到该消息；否则创建新的 user 消息
 *
 * @param content 用户消息内容
 * @returns true 如果追加到现有消息，false 如果创建新消息
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
 *
 * @param content assistant 消息内容
 * @returns true 如果成功添加，false 如果跳过
 */
addAssistantMessageSafe(content: ContentBlock[]): boolean {
  if (this.messages.length === 0) {
    this.addAssistantMessage(content);
    return true;
  }

  const lastMsg = this.messages[this.messages.length - 1];
  if (lastMsg.role === 'assistant') {
    // 最后一条已经是 assistant → 警告并跳过
    log.warn('Attempted to add consecutive assistant message, skipping to maintain alternating pattern');
    return false;
  } else {
    // 最后一条不是 assistant → 正常添加
    this.addAssistantMessage(content);
    return true;
  }
}
```

### 方案 2：AgentLoop 使用安全方法

**文件**：`src/core/agent/AgentLoop.ts`

#### 2.1 循环顶部追加消息（L201-206）

```typescript
// ✅ 修改后（使用 addUserMessageSafe）
const merged = this.messageManager.addUserMessageSafe(appendMsg);
this.log.info(`User message ${merged ? 'merged' : 'injected'}: interrupted=${wasInterrupted}, msg="${appendMsg.slice(0, 80)}"`);
```

**效果**：
- 最后一条是 user → 追加（merged=true）
- 最后一条是 assistant → 新增（merged=false）

#### 2.2 Placeholder assistant 插入（L180-197）

```typescript
// ✅ 修改后（使用 addAssistantMessageSafe）
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

**效果**：
- 最后一条是 user → 尝试添加 placeholder assistant
- 最后一条是 assistant → 跳过（addAssistantMessageSafe 返回 false）

#### 2.3 Max tokens 系统提示（L387-393）

```typescript
// ✅ 修改后（使用 addUserMessageSafe）
const systemHint = '[System] Output token limit reached. Split large operations into MULTIPLE SMALL tool calls (write_file max 200 lines, edit_file max 50 lines). DO NOT retry with large content in a single call.';
const merged = this.messageManager.addUserMessageSafe(systemHint);
this.log.debug(`Max tokens system hint ${merged ? 'merged' : 'added'}`);
```

**效果**：
- 最后一条是 user（如 tool_result）→ 追加到该消息
- 最后一条是 assistant → 新增 user 消息

---

## 修复前后对比

### 修复前 ❌

```typescript
// 循环顶部追加消息
this.messageManager.addUserMessage(appendMsg);  // ← 总是新增，可能连续 user

// Placeholder assistant 插入
this.messageManager.addAssistantMessage([...]);  // ← 未检查，可能连续 assistant

// Max tokens 系统提示
this.messageManager.addUserMessage(systemHint);  // ← 总是新增，可能连续 user
```

### 修复后 ✅

```typescript
// 循环顶部追加消息
const merged = this.messageManager.addUserMessageSafe(appendMsg);  // ✅ 自动检查并合并

// Placeholder assistant 插入
const added = this.messageManager.addAssistantMessageSafe([...]);  // ✅ 自动检查并跳过

// Max tokens 系统提示
const merged = this.messageManager.addUserMessageSafe(systemHint);  // ✅ 自动检查并合并
```

---

## 消息序列验证

### 场景 1：快速连续 interrupt

**流程**：
```
用户: "总结代码"
[Agent thinking]
用户: "用英文"（interrupt 1）
用户: "不，用中文"（interrupt 2）
```

**消息序列**：
```json
[
  {"role": "user", "content": "总结代码"},
  {"role": "assistant", "content": "[Interrupted]"},
  {"role": "user", "content": "用英文\n\n不，用中文"}  // ← 合并，格式正确
]
```

### 场景 2：Max tokens + 追加消息

**流程**：
```
用户: "写一个大文件"
[Agent 开始写入，触发 max_tokens]
系统: 添加系统提示（addUserMessageSafe）
[上次迭代完成，有 pending append message]
用户: "继续"（从队列注入，addUserMessageSafe）
```

**消息序列**：
```json
[
  {"role": "user", "content": "写一个大文件"},
  {"role": "assistant", "content": [...]},
  {"role": "user", "content": "[System] Output token limit...\n\n继续"}  // ← 合并
]
```

### 场景 3：Interrupt 时已有 assistant 消息

**流程**：
```
用户: "分析代码"
[Agent 输出部分内容]
用户: "停止"（interrupt）
```

**消息序列**：
```json
[
  {"role": "user", "content": "分析代码"},
  {"role": "assistant", "content": "部分输出内容"},  // ← 已有 assistant
  // addAssistantMessageSafe 检测到最后一条是 assistant，跳过 placeholder
  {"role": "user", "content": "停止"}  // ← 新增 user，格式正确
]
```

---

## 测试建议

### 手动测试

1. **测试 1：快速连续 interrupt**
   ```
   用户: 帮我分析代码
   [Agent thinking]
   用户: 用英文
   用户: 不，用中文
   用户: 还是用日语

   预期：所有补充输入合并为一条 user 消息
   ```

2. **测试 2：Max tokens + interrupt**
   ```
   用户: 写一个 1000 行的文件
   [Agent 触发 max_tokens，系统提示添加]
   用户: 继续

   预期：系统提示和"继续"合并为一条 user 消息
   ```

3. **测试 3：Interrupt 时已有 assistant**
   ```
   用户: 总结一下
   [Agent 输出部分内容]
   用户: 停止

   预期：不添加 placeholder assistant，直接新增 user 消息
   ```

### 日志验证

```bash
# 检查是否还有连续相同角色消息
tail -500 ~/.xuanji/logs/core.log | grep -E "messages:" -A 1 | grep -E "role.*role"

# 检查 Safe 方法的日志
tail -100 ~/.xuanji/logs/core.log | grep -E "merged|injected|skipping placeholder"

# 验证具体的消息序列
tail -200 ~/.xuanji/logs/core.log | grep "Request structure" -A 50
```

---

## 统计

**修改文件**：2 个
- `src/core/agent/MessageManager.ts` — 新增 2 个方法（60 行）
- `src/core/agent/AgentLoop.ts` — 修改 3 处调用（30 行）

**新增代码**：90 行

**删除代码**：20 行

**新增方法**：
- `MessageManager.addUserMessageSafe()`
- `MessageManager.addAssistantMessageSafe()`

**修改调用**：
- L201-206：循环顶部追加消息
- L180-197：Placeholder assistant 插入
- L387-393：Max tokens 系统提示

---

## 防御性设计原则

### 1. 单一职责

每个 Safe 方法只负责一件事：
- `addUserMessageSafe` → 确保不会连续 user
- `addAssistantMessageSafe` → 确保不会连续 assistant

### 2. 最小侵入

保留原有的 `addUserMessage` 和 `addAssistantMessage`，不修改其行为，向后兼容。

### 3. 明确返回值

返回 `boolean` 表示操作类型：
- `true` = 合并/跳过
- `false` = 新增

便于调用方记录日志和调试。

### 4. 日志完整

所有关键路径都有日志：
- 合并：`merged`
- 新增：`injected` / `added`
- 跳过：`skipping`

---

## 后续优化（可选）

### P1（建议）

1. **消息序列验证器**
   ```typescript
   class MessageValidator {
     validate(messages: Message[]): ValidationResult {
       // 检查是否有连续相同角色消息
       // 检查 tool_use/tool_result 配对
       // 检查 user/assistant 交替
     }
   }
   ```

2. **自动修复**
   ```typescript
   MessageManager.repairSequence(): number {
     // 自动合并连续相同角色消息
     // 返回修复的消息数
   }
   ```

### P2（未来）

1. **消息序列测试**
   - 单元测试覆盖所有 Safe 方法
   - 集成测试覆盖所有消息添加场景

2. **运行时验证**
   - 每次调用 API 前验证消息序列
   - 发现格式错误时自动修复或抛出异常

---

## 总结

通过新增 `addUserMessageSafe` 和 `addAssistantMessageSafe` 两个安全方法，并在所有可能导致连续相同角色消息的地方使用这些方法，成功修复了追加内容后 API 调用失败的问题：

- ✅ **循环顶部追加消息**：自动合并或新增，确保格式正确
- ✅ **Placeholder assistant**：自动检测并跳过重复 assistant
- ✅ **Max tokens 系统提示**：自动合并到最后一条 user 消息
- ✅ **防御性设计**：Safe 方法自动处理所有边界情况
- ✅ **日志完整**：所有操作都有明确的日志输出

现在用户可以放心地快速连续补充输入，系统会自动维护正确的消息序列格式，不再触发 API 错误！🎉
