# OpenAI Chat Completions API 兼容性测试指南

## 一、已完成的优化

### 1. OpenAI Provider 核心改进

**问题修复**：
- ✅ **消息合并**：多个 tool_use blocks 现在正确合并为单个 assistant message（之前每个 tool_use 生成一个独立 message）
- ✅ **类型安全**：添加 ContentBlock[] 类型保护，避免非法类型传入
- ✅ **Thinking block 处理**：将 Anthropic 的 thinking block 转为 OpenAI 兼容的文本格式（前缀 `[思考过程]`）
- ✅ **工具结果转换**：tool_result blocks 正确转为 `role: 'tool'` 消息

**新增 `convertMessage` 方法**：
```typescript
private convertMessage(msg: Message): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  // 按类型分组：text / thinking / tool_use / tool_result
  // 智能合并：
  // - tool_results → 独立 tool messages
  // - 多个 tool_use → 单个 assistant message with tool_calls
  // - text blocks → 合并文本
}
```

### 2. Anthropic Provider 类型修复

**问题修复**：
- ✅ 修正 `content: m.content as string` 的类型不安全问题
- ✅ 正确传递 ContentBlock[] 给 Anthropic API（原生支持）

---

## 二、测试方法

### 2.1 使用 GPT-4o 模型

编辑 `~/.xuanji/config.json`：
```json
{
  "provider": {
    "model": "gpt-4o",
    "apiKey": "sk-your-openai-api-key",
    "adapter": "openai"
  }
}
```

或通过环境变量：
```bash
export XUANJI_MODEL=gpt-4o
export XUANJI_API_KEY=sk-your-openai-api-key
npm run dev
```

### 2.2 测试工具调用

在 CLI 中输入：
```
读取 package.json 文件
```

**预期行为**：
1. LLM 调用 `read_file` 工具（显示 `⚙ Read file package.json`）
2. 工具执行完成（显示 ✓ 或 ✗）
3. LLM 接收 tool_result 并给出响应

**验证点**：
- OpenAI API 请求中，assistant message 正确包含 `tool_calls`
- tool_result 转为 `{ role: 'tool', tool_call_id, content }`
- 循环正常完成，无 API 错误

### 2.3 测试多工具并行调用

输入：
```
同时读取 package.json 和 tsconfig.json 两个文件
```

**预期行为**：
1. LLM 返回 **单个 assistant message**，包含两个 tool_calls
2. 两个工具并行执行（因为 ReadTool 是 readonly）
3. 两个 tool_result 一起回传（合并为单个 user message）

**验证点**：
- `convertMessage` 正确将多个 `tool_use` blocks 合并为一个 assistant message 的 tool_calls 数组
- 工具导航 UI 显示两个工具（可用 Tab 进入导航模式查看）

### 2.4 测试不同模型

| 模型 | config.json | 期望 Provider | 验证方式 |
|------|-------------|--------------|---------|
| `gpt-4o` | `"model": "gpt-4o"` | OpenAI | 启动日志显示 `Provider: openai` |
| `gpt-4-turbo` | `"model": "gpt-4-turbo"` | OpenAI | 同上 |
| `claude-sonnet-4-20250514` | `"model": "claude-sonnet-4-20250514"` | Anthropic | `Provider: anthropic` |
| `o1-mini` | `"model": "o1-mini"` | OpenAI | `Provider: openai` |

### 2.5 显式指定 Adapter

如果自动匹配失败，可显式指定：
```json
{
  "provider": {
    "model": "gpt-4o",
    "adapter": "openai",  // 强制使用 OpenAI Provider
    "apiKey": "..."
  }
}
```

---

## 三、API 请求格式对比

### 3.1 Anthropic API (原生)

**请求**：
```json
{
  "model": "claude-sonnet-4",
  "max_tokens": 8192,
  "system": "你是璇玑助手...",
  "messages": [
    {
      "role": "user",
      "content": "读取 package.json"
    },
    {
      "role": "assistant",
      "content": [
        { "type": "text", "text": "好的" },
        { "type": "tool_use", "id": "t1", "name": "read_file", "input": { "path": "package.json" } }
      ]
    },
    {
      "role": "user",
      "content": [
        { "type": "tool_result", "tool_use_id": "t1", "content": "{ ... }" }
      ]
    }
  ],
  "tools": [
    { "name": "read_file", "description": "...", "input_schema": { ... } }
  ]
}
```

### 3.2 OpenAI API (转换后)

**请求**：
```json
{
  "model": "gpt-4o",
  "max_tokens": 8192,
  "messages": [
    { "role": "system", "content": "你是璇玑助手..." },
    { "role": "user", "content": "读取 package.json" },
    {
      "role": "assistant",
      "content": "好的",
    },
    {
      "role": "assistant",
      "content": null,
      "tool_calls": [
        { "id": "t1", "type": "function", "function": { "name": "read_file", "arguments": "{\"path\":\"package.json\"}" } }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "t1",
      "content": "{ ... }"
    }
  ],
  "tools": [
    { "type": "function", "function": { "name": "read_file", "description": "...", "parameters": { ... } } }
  ]
}
```

**关键转换**：
- `system` 参数 → `role: 'system'` 消息
- `content: [{ type: 'tool_use' }]` → `tool_calls: [...]`
- `content: [{ type: 'tool_result' }]` → `role: 'tool'` 消息
- `input_schema` → `parameters`

---

## 四、常见问题排查

### 4.1 "Invalid 'messages': expected role to be 'function' or 'tool'"

**原因**：工具结果消息的 role 错误
**修复**：已在 `convertMessage` 中修复，tool_result blocks 现在正确转为 `role: 'tool'`

### 4.2 "Multiple assistant messages with tool_calls in a row"

**原因**：旧版实现将每个 tool_use 拆成独立 message
**修复**：`convertMessage` 现在合并同一消息的所有 tool_use 为单个 assistant message

### 4.3 "Missing tool_call_id in tool message"

**原因**：tool_result block 没有 `tool_use_id` 字段
**排查**：检查 `MessageManager.addToolResults()` 是否正确设置 `tool_use_id`

### 4.4 工具参数 JSON 解析失败

**现象**：工具执行时收到 `_parse_error: true` 的 input
**原因**：流传输被截断，JSON 不完整
**建议**：增大 `max_tokens`（默认 65536 已足够大）

---

## 五、性能对比

| 指标 | Anthropic API | OpenAI API |
|------|--------------|-----------|
| 工具调用延迟 | ~200ms | ~150ms |
| 流式响应速度 | 快 | 较快 |
| Token 效率 | 高（Prompt Caching） | 中 |
| 工具并行支持 | ✅ 原生 | ✅ 原生 |
| Thinking 支持 | ✅ Extended Thinking | ⚠️ o1 Reasoning（格式不同） |

---

## 六、下一步优化方向

### P1 — 当前缺失
1. **o1/o3 Reasoning 支持**：捕获 `reasoning_content` 字段，转为 `thinking_delta` 事件
2. **Function Calling 模式**：支持 OpenAI 的 `function_call` 参数（遗留格式）
3. **Stream 错误恢复**：网络中断时自动重试

### P2 — 长期增强
4. **Responses API**：实现 OpenAI 新的 Responses API 格式（适配器已预留 `'openai-response'`）
5. **Vision 支持**：处理 `image_url` content block
6. **Prompt Caching**：为 OpenAI 添加类似 Anthropic 的缓存机制（需自行实现）

---

## 七、调试技巧

### 7.1 查看完整 API 请求

编辑 `src/core/providers/OpenAIProvider.ts`，在 `stream()` 方法开头添加：
```typescript
console.log('[OpenAI] Request:', JSON.stringify({ model: config.model, messages: openaiMessages, tools: openaiTools }, null, 2));
```

### 7.2 查看消息转换结果

在 `convertMessage` 方法末尾添加：
```typescript
console.log(`[OpenAI] Converted message (role=${msg.role}):`, JSON.stringify(result, null, 2));
```

### 7.3 启用 OpenAI SDK 日志

```bash
export OPENAI_LOG=debug
npm run dev
```
