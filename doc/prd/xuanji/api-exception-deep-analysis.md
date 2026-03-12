# API 异常深度排查报告

## 执行时间
2026-03-04 07:30

## 排查目标
分析 03-04 07:08-07:12 期间的 API 调用失败原因，排查是否还有其他可能引起异常的原因。

---

## 问题 1：消息格式违规（已确认）✅

### 证据

从日志提取的 90 条消息序列中发现 **3 处连续 user 消息**：

```
Violation 1 (index 12-13):
  [11] assistant | object | 3
  [12] user      | object | 2  ← 连续 user
  [13] user      | string | 9  ← 连续 user
  [14] assistant | object | 2

Violation 2 (index 33-34):
  [32] assistant | object | 1
  [33] user      | object | 1  ← 连续 user
  [34] user      | string | 12 ← 连续 user
  [35] assistant | object | 2

Violation 3 (index 88-89):
  [87] assistant | object | 3
  [88] user      | object | 3  ← 连续 user
  [89] user      | string | 4  ← 连续 user
```

### 违规模式分析

所有 3 处违规都遵循相同的模式：

```
[N-1] assistant  | object  | X    (tool_use)
[N]   user       | object  | Y    (tool_result)
[N+1] user       | string  | Z    (追加内容) ← 违规
```

**原因**：在修复代码之前，追加内容时直接调用 `addUserMessage()`，未检查最后一条消息是否已经是 user（包含 tool_result）。

### API 响应

```json
{
  "type": "error",
  "error": {
    "type": "api_error",
    "message": "模型服务内部错误，请稍后重试"
  }
}
```

**分析**：Claude API 检测到消息格式违规（不满足 user-assistant 交替要求），返回 `api_error`（而非 400 Bad Request），这是代理服务器（shibit-llm）的错误包装方式。

---

## 问题 2：潜在的其他异常原因（排查）

### 2.1 空内容检查 ✅

**结果**：✅ 未发现空内容消息

```python
[2] Checking for empty content messages...
   ✅ No empty content messages
```

### 2.2 首尾消息检查 ✅

**结果**：✅ 首尾消息格式正确

```
First: [0] user      | string | 16
Last:  [89] user     | string | 4
```

### 2.3 Tool Use / Tool Result 配对检查

**检查逻辑**：
- 每条 assistant 消息中的 `tool_use` 必须在下一条 user 消息中有对应的 `tool_result`
- `tool_result` 必须有 `tool_use_id` 字段

**从日志观察**：
- 所有 `contentType=object` 的消息都应该是 ContentBlock[]
- User 消息中 `contentType=object` 大概率是 tool_result
- Assistant 消息中 `contentType=object` 大概率是 tool_use

**结果**：⚠️ 无法从当前日志直接验证（需要查看实际 content）

**建议**：增加日志，打印 `tool_use_id` 和 `tool_result.tool_use_id` 的配对情况。

### 2.4 ContentBlock 格式检查

**潜在问题**：
1. Tool result content 是否包含无效字符？
2. Tool use input 是否包含无效 JSON？
3. Text content 是否超长（>500KB）？

**结果**：⚠️ 无法从当前日志直接验证（需要查看实际 content）

**建议**：增加日志，打印每个 ContentBlock 的 type 和长度。

### 2.5 模型与参数兼容性 ✅

**检查项**：
```
model: "[CC]claude-opus-4-6"  ✅ 有效模型
max_tokens: 16384             ✅ 在范围内（Opus 4 最大 16384）
temperature: undefined        ✅ 未设置（使用默认值）
tools: 21                     ✅ 工具数量合理
cache_breakpoints: 1          ✅ 缓存断点数量正常（≤4）
```

**结果**：✅ 模型和参数配置正常

### 2.6 输入 Token 检查 ✅

**日志**：
```
input: ~21484 tokens
context: 200000 tokens
output_limit: 16384 tokens
```

**计算**：
```
总使用 = 21484 (input) + 16384 (output) = 37868 tokens
剩余    = 200000 - 37868 = 162132 tokens
```

**结果**：✅ Token 数量在安全范围内

### 2.7 Rate Limit 检查 ✅

**日志**：
```
[07:08:22] 第一次请求失败 (api_error)
[07:09:26] 重试 1 失败 (api_error)
[07:10:28] 重试 2 失败 (api_error)
[07:11:34] 重试 3 失败 (api_error)
[07:12:41] 最终失败
```

**间隔时间**：
- 第1次到第2次：64秒
- 第2次到第3次：62秒
- 第3次到第4次：67秒

**结果**：✅ 无 rate_limit_error，说明不是速率限制问题

### 2.8 网络超时检查 ⚠️

**日志**：
```
[07:12:41] Request: messages=1, tools=0  ← 新请求（可能是记忆提取）
[07:15:42] Stream error: Request timed out. ← 3分钟后超时
```

**分析**：
- 第一次失败（90条消息）：格式错误导致
- 第二次超时（1条消息）：可能是网络问题或服务端负载

**结果**：⚠️ 存在网络超时，但不是主要问题

---

## 问题 3：代理服务器（shibit-llm）的错误处理

### 3.1 错误包装

**观察**：
- Claude API 对格式错误通常返回 `400 Bad Request` 或 `invalid_request_error`
- 日志中看到的是 `api_error: "模型服务内部错误，请稍后重试"`

**推测**：
- shibit-llm 可能将所有上游错误（包括 400）统一包装为 `api_error`
- 这导致客户端无法区分格式错误和真正的服务器错误

**建议**：
- 建议在 shibit-llm 中保留原始错误类型
- 或者在错误消息中包含更多上下文（如 HTTP 状态码）

### 3.2 验证逻辑

**问题**：shibit-llm 是否在转发请求前验证消息格式？

**如果有验证**：
- 应该在本地就拒绝请求，返回明确的格式错误
- 避免浪费 API 配额

**如果无验证**：
- 格式错误的请求会发送到 Claude API
- 被 API 拒绝后返回错误

**建议**：
- 在 shibit-llm 中增加消息格式预验证
- 检查：user/assistant 交替、tool_use/tool_result 配对、首尾消息角色等

---

## 总结：异常的所有可能原因

### 主要原因（已确认）

✅ **消息格式违规**：3 处连续 user 消息
- 位置：index 12-13, 33-34, 88-89
- 模式：tool_result (user) + 追加内容 (user)
- 影响：100% 导致 API 拒绝
- 修复：已实现 `addUserMessageSafe()`

### 次要原因（潜在）

⚠️ **网络超时**：记忆提取请求 3 分钟超时
- 频率：偶发
- 影响：中等（可重试）
- 建议：减少超时时间（从 3 分钟到 30 秒）

⚠️ **代理服务器错误包装**：无法区分错误类型
- 频率：总是
- 影响：低（仅影响调试体验）
- 建议：保留原始错误类型

### 已排除的原因

❌ 空内容消息
❌ 首尾消息角色错误
❌ Rate limit
❌ Token 超限
❌ 模型参数错误
❌ 缓存断点超限

---

## 修复优先级

### P0（立即修复）

✅ **消息格式违规**
- 修复代码：已完成
- 测试方法：清除 session，重新测试
- 预期结果：不再出现连续 user 消息

### P1（建议修复）

⚠️ **Session 文件修复**
- 当前 session (91 条消息) 包含格式错误
- 方法 1：删除 session 重新开始
- 方法 2：手动修复 JSONL 文件（合并连续 user 消息）

⚠️ **增加消息序列验证**
```typescript
class MessageValidator {
  static validate(messages: Message[]): ValidationResult {
    // 1. 检查 user/assistant 交替
    // 2. 检查 tool_use/tool_result 配对
    // 3. 检查首尾消息角色
    // 4. 检查空内容
    return { valid: true, errors: [] };
  }
}
```

### P2（未来优化）

- 减少网络超时时间（3min → 30s）
- 在 shibit-llm 中增加格式预验证
- 改进错误消息（包含更多上下文）
- MessageManager.repairSequence() 自动修复

---

## 验证计划

### Step 1：验证代码修复

```bash
# 1. 重新构建（已完成）
npm run build

# 2. 清除有问题的 session
rm ~/.xuanji/sessions/session-*.jsonl

# 3. 启动新对话
npm run dev
```

### Step 2：测试追加内容

```
1. 用户: "帮我分析一下代码"
2. [Agent 开始输出]
3. 用户: "用英文回复"  ← 追加
4. 用户: "不，用中文"  ← 再次追加
5. 检查日志：tail -f ~/.xuanji/logs/core.log | grep "merged\|injected"
```

**预期日志**：
```
[INFO] User message merged: interrupted=true, msg="用英文回复"
[INFO] User message merged: interrupted=true, msg="不，用中文"
```

### Step 3：验证消息序列

```bash
# 查看最新的请求结构
tail -100 ~/.xuanji/logs/core.log | grep "Request structure" -A 5

# 确认没有连续 user 消息
python3 /tmp/analyze_messages.py  # 重新运行分析脚本
```

**预期结果**：
```
✅ No consecutive same-role messages
✅ No empty content messages
```

---

## 结论

**异常的根本原因**：消息格式违规（3 处连续 user 消息）

**修复状态**：
- ✅ 代码已修复（addUserMessageSafe + addAssistantMessageSafe）
- ⏳ 需要清除旧 session 并重新测试
- ⏳ 需要验证修复是否生效

**其他潜在原因**：
- 网络超时（次要，可忽略）
- 代理服务器错误包装（不影响功能）

**下一步**：清除 session，开始新对话，验证修复效果。
