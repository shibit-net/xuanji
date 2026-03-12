# Light Model 配置指南

## 什么是 Light Model？

`lightModel` 是 Xuanji 支持的一个可选配置，允许你为**低复杂度任务**使用更便宜、更快速的模型，而主模型（`model`）则用于**核心推理**。

### 使用场景

| 任务类型 | 使用模型 | 示例 |
|---------|---------|------|
| 核心推理 | `model`（主模型） | Agent 循环、工具调用决策、复杂代码生成 |
| 上下文压缩 | `lightModel`（轻量模型） | 压缩对话历史、摘要生成 |
| 子代理任务 | `lightModel` | 简单分类、搜索、判断 |
| 记忆提取 | `lightModel` | 从对话中提取关键信息 |

### 成本优势

以 Anthropic Claude 为例：

| 模型 | 输入价格 | 输出价格 | 相对成本 |
|------|---------|---------|---------|
| claude-sonnet-4-5 (主模型) | $3 / 1M tokens | $15 / 1M tokens | 100% |
| claude-haiku-4-5 (轻量模型) | $1 / 1M tokens | $5 / 1M tokens | ~33% |

**节省约 67% 成本**用于低复杂度任务！

---

## 配置方式

### 1. 环境变量（推荐用于全局配置）

在 `.env` 文件中添加：

```bash
# 主模型（用于核心推理）
XUANJI_MODEL=[CC]claude-sonnet-4-5-20250929

# 轻量模型（用于压缩、子代理等）
XUANJI_LIGHT_MODEL=[CC]claude-haiku-4-5-20251001

# API 配置
XUANJI_API_KEY=your-api-key-here
XUANJI_BASE_URL=https://api.anthropic.com
```

### 2. 配置文件（项目级配置）

编辑 `.xuanji/config.json`：

```json
{
  "provider": {
    "model": "[CC]claude-sonnet-4-5-20250929",
    "lightModel": "[CC]claude-haiku-4-5-20251001",
    "adapter": "anthropic",
    "apiKey": "your-api-key",
    "baseURL": "https://api.anthropic.com",
    "maxTokens": 64000
  }
}
```

### 3. Settings UI（交互式配置）

```bash
# 启动 Xuanji
npm run dev

# 进入设置
/settings

# 选择 "LLM 配置"
# 按 2 或 ↓ 选择 "轻量模型"
# 按 Enter 编辑，输入模型名称
```

**UI 界面示例**:
```
╭─────────────────────────────────────╮
│ 🤖 LLM 配置                         │
│                                     │
│   1. 模型:     claude-sonnet-4-5   │
│ ▶ 2. 轻量模型: claude-haiku-4-5█   │
│   3. API Key:  sk-ant-api03-****   │
│   4. Adapter:  anthropic            │
│   5. Base URL: https://...          │
│                                     │
│ 输入新值 → Enter 保存 | Esc 取消    │
╰─────────────────────────────────────╯
```

---

## 推荐配置

### OpenAI

```bash
# 主模型
XUANJI_MODEL=gpt-4o

# 轻量模型
XUANJI_LIGHT_MODEL=gpt-4o-mini
```

### Anthropic Claude

```bash
# 主模型
XUANJI_MODEL=[CC]claude-sonnet-4-5-20250929

# 轻量模型
XUANJI_LIGHT_MODEL=[CC]claude-haiku-4-5-20251001
```

### Azure OpenAI

```bash
# 主模型
XUANJI_MODEL=gpt-4

# 轻量模型
XUANJI_LIGHT_MODEL=gpt-3.5-turbo

# Azure 配置
XUANJI_BASE_URL=https://your-resource.openai.azure.com
XUANJI_ADAPTER=openai
```

### 第三方代理（如 OpenRouter）

```bash
# 主模型
XUANJI_MODEL=anthropic/claude-sonnet-4-5

# 轻量模型
XUANJI_LIGHT_MODEL=anthropic/claude-haiku-4-5

# 代理配置
XUANJI_BASE_URL=https://openrouter.ai/api/v1
XUANJI_ADAPTER=openai
XUANJI_API_KEY=your-openrouter-key
```

---

## 工作原理

### 1. 初始化时

`ChatSession` 会检查配置中的 `lightModel`：

```typescript
// src/core/chat/ChatSession.ts
if (this.config!.provider.lightModel) {
  let lightProvider = providerFactory.getByModel(this.config!.provider.lightModel);
  if (!lightProvider) {
    log.warn(`lightModel "${this.config!.provider.lightModel}" not supported, fallback to main provider`);
    lightProvider = provider;
  }
  this.lightProvider = lightProvider;
} else {
  this.lightProvider = provider; // 未配置则使用主模型
}
```

### 2. 使用时

不同功能根据任务复杂度选择模型：

```typescript
// 上下文压缩（使用轻量模型）
const stream = this.provider!.stream(messages, [], {
  model: this.providerConfig!.lightModel ?? this.providerConfig!.model,
  apiKey: this.providerConfig!.apiKey,
  baseURL: this.providerConfig!.baseURL,
  maxTokens: 1500,
});

// Agent 主循环（使用主模型）
const stream = this.provider!.stream(messages, tools, {
  model: this.providerConfig!.model,
  apiKey: this.providerConfig!.apiKey,
  baseURL: this.providerConfig!.baseURL,
  maxTokens: this.providerConfig!.maxTokens,
});
```

### 3. 自动降级

如果 `lightModel` 不受支持，自动回退到主模型：

```typescript
if (!lightProvider) {
  log.warn(`lightModel "${lightModel}" not supported, fallback to main provider`);
  lightProvider = provider;
}
```

---

## 验证配置

### 方法 1: 使用 /doctor 命令

```bash
# 在 Xuanji CLI 中
/doctor
```

输出示例：
```
📡 模型配置
  模型:     claude-sonnet-4-5-20250929
  轻量模型: claude-haiku-4-5-20251001
  服务地址: https://api.anthropic.com
  适配器:   anthropic
  API Key:  sk-ant-api03-****
```

### 方法 2: 检查日志

启用 DEBUG 日志查看模型选择：

```bash
XUANJI_LOG_LEVEL=debug npm run dev
```

日志输出：
```
[ChatSession] lightModel configured: claude-haiku-4-5-20251001
[ContextCompressor] Using light model for compression: claude-haiku-4-5-20251001
```

---

## 常见问题

### Q1: 不配置 lightModel 会怎样？

**A**: Xuanji 会自动使用主模型（`model`）处理所有任务。功能完全正常，只是成本会稍高。

### Q2: 可以使用不同 Provider 的模型吗？

**A**: 可以，但需要配置不同的 `baseURL` 和 `adapter`。例如：
- 主模型用 Anthropic Claude
- 轻量模型用 OpenAI GPT-4o-mini

目前 Xuanji 的实现是共享同一个 Provider 配置，建议使用同一 Provider 的不同模型。

### Q3: lightModel 会影响输出质量吗？

**A**: 对于**低复杂度任务**（压缩、分类、摘要），轻量模型完全够用。对于**核心推理**（代码生成、复杂问答），仍然使用主模型，质量不受影响。

### Q4: 如何选择合适的 lightModel？

**原则**:
1. 选择同一 Provider 的轻量版本（如 Haiku vs Sonnet）
2. 确保轻量模型支持工具调用（如果需要）
3. 价格 < 主模型的 50%

**推荐**:
- OpenAI: `gpt-4o-mini` (主模型 `gpt-4o`)
- Anthropic: `claude-haiku-4-5` (主模型 `claude-sonnet-4-5`)
- Azure: `gpt-3.5-turbo` (主模型 `gpt-4`)

### Q5: 如何禁用 lightModel？

**方法 1**: 删除环境变量
```bash
# .env 文件中移除
# XUANJI_LIGHT_MODEL=...
```

**方法 2**: 在 Settings UI 中清空
```bash
/settings → LLM 配置 → 2. 轻量模型 → 删除内容 → Enter
```

**方法 3**: 编辑配置文件
```json
{
  "provider": {
    "model": "claude-sonnet-4-5",
    "lightModel": null  // 或删除此行
  }
}
```

---

## 成本分析示例

假设一次对话：
- 输入 10,000 tokens
- 输出 2,000 tokens
- 压缩任务占用 20% token

### 未使用 lightModel（全部用主模型）
```
输入: 10,000 * $3 / 1M = $0.030
输出: 2,000 * $15 / 1M = $0.030
总计: $0.060
```

### 使用 lightModel（20% 用轻量模型）
```
主模型:
  输入: 8,000 * $3 / 1M = $0.024
  输出: 1,600 * $15 / 1M = $0.024

轻量模型:
  输入: 2,000 * $1 / 1M = $0.002
  输出: 400 * $5 / 1M = $0.002

总计: $0.052
```

**节省**: $0.008 / 会话（约 13%）

---

## 更新日志

### v1.5.0 (2026-03-06)
- ✅ 支持通过 Settings UI 配置 lightModel
- ✅ 新增环境变量 `XUANJI_LIGHT_MODEL`
- ✅ 国际化支持（中英文）

### v0.2.0 (2026-02-26)
- ✅ 初始实现 lightModel 支持
- ✅ ContextCompressor 自动使用轻量模型
- ✅ 自动降级机制

---

**版本**: v1.5.0  
**日期**: 2026-03-06  
**维护**: Xuanji Team
