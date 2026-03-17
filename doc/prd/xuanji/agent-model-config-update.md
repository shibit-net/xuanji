# Agent 模型配置更新报告

**更新日期**：2026-03-15
**更新内容**：所有 Agent 模型配置使用 shibit.net 的模型

---

## 🎯 更新策略

根据任务复杂度选择合适的模型：

| 复杂度 | 模型 | 适用场景 |
|--------|------|----------|
| **高** | `[CC]claude-opus-4-6` | 复杂推理、深度思考 |
| **中** | `[CC]claude-sonnet-4-5-20250929` | 一般任务、平衡性能 |
| **低** | `[CC]claude-haiku-4-5-20251001` | 简单任务、快速响应 |

---

## 📋 Agent 配置清单

### 1. **coder**（编程助手）✅

**复杂度**：高
**模型配置**：
```json5
{
  primary: '[CC]claude-opus-4-6',  // 编程需要复杂推理
  fallback: '[CC]claude-sonnet-4-5-20250929',
  maxTokens: 32000
}
```

**理由**：编程需要深度代码理解、复杂逻辑推理、精确的代码生成

---

### 2. **plan**（架构师）✅

**复杂度**：高
**模型配置**：
```json5
{
  primary: '[CC]claude-opus-4-6',  // 架构设计需要复杂推理
  fallback: '[CC]claude-sonnet-4-5-20250929',
  maxTokens: 32000
}
```

**理由**：架构设计需要全局思考、权衡取舍、复杂的系统设计能力

---

### 3. **xuanji**（主 Agent）✅

**复杂度**：中
**模型配置**：
```json5
{
  primary: '[CC]claude-sonnet-4-5-20250929',
  fallback: '[CC]claude-haiku-4-5-20251001',
  maxTokens: 64000
}
```

**理由**：通用主 Agent，需要平衡能力和性能

---

### 4. **general-purpose**（通用助手）✅

**复杂度**：中
**模型配置**：
```json5
{
  primary: '[CC]claude-sonnet-4-5-20250929',
  fallback: '[CC]claude-haiku-4-5-20251001',
  maxTokens: 32000
}
```

**理由**：通用任务，Sonnet 能力足够

---

### 5. **intent-analyzer**（意图分析器）✅

**复杂度**：低
**模型配置**：
```json5
{
  primary: '[CC]claude-haiku-4-5-20251001',
  fallback: '[CC]claude-haiku-4-5-20251001',
  maxTokens: 1000
}
```

**理由**：简单的意图分类任务，Haiku 速度快、成本低

---

### 6. **context-compressor**（上下文压缩器）✅

**复杂度**：低
**模型配置**：
```json5
{
  primary: '[CC]claude-haiku-4-5-20251001',
  fallback: '[CC]claude-haiku-4-5-20251001',
  maxTokens: 1500
}
```

**理由**：简单的摘要任务，Haiku 速度快、成本低

---

### 7. **explore**（探索助手）✅

**复杂度**：低
**模型配置**：
```json5
{
  primary: '[CC]claude-haiku-4-5-20251001',
  fallback: '[CC]claude-haiku-4-5-20251001',
  maxTokens: 16000
}
```

**理由**：快速代码探索，无需复杂推理，Haiku 速度快

---

## 🌐 全局配置

**配置文件**：`~/.xuanji/config.json`

```json
{
  "version": "1.0",
  "config": {
    "provider": {
      "apiKey": "sk-4S3L201Rzmm2HOtgDH2NuEW9slE72wv0ExoHTGaDURLOZ4q8",
      "baseURL": "https://shibit.net",
      "model": "[CC]claude-sonnet-4-5-20250929",
      "lightModel": "[CC]claude-haiku-4-5-20251001",
      "adapter": "anthropic",
      "maxTokens": 64000,
      "timeout": 120000
    }
  }
}
```

### 配置说明

- **apiKey**：shibit.net 的 API Key
- **baseURL**：使用 shibit.net 作为 API 端点
- **model**：默认模型（Sonnet）
- **lightModel**：轻量模型（Haiku）
- **adapter**：使用 anthropic 适配器
- **maxTokens**：最大 token 数
- **timeout**：请求超时时间（120 秒）

---

## 🔧 环境变量（可选）

如果需要通过环境变量配置（优先级最高）：

```bash
export XUANJI_API_KEY="sk-4S3L201Rzmm2HOtgDH2NuEW9slE72wv0ExoHTGaDURLOZ4q8"
export XUANJI_BASE_URL="https://shibit.net"
export XUANJI_MODEL="[CC]claude-sonnet-4-5-20250929"
export XUANJI_LIGHT_MODEL="[CC]claude-haiku-4-5-20251001"
```

---

## 📊 模型使用分布

| 模型 | Agent 数量 | 占比 |
|------|-----------|------|
| Opus | 2 | 29% |
| Sonnet | 2 | 29% |
| Haiku | 3 | 42% |

**成本优化**：
- 42% 的 Agent 使用 Haiku（低成本）
- 29% 的 Agent 使用 Sonnet（平衡）
- 29% 的 Agent 使用 Opus（高能力）

---

## ✅ 验证清单

- [x] coder 使用 Opus（复杂推理）
- [x] plan 使用 Opus（复杂推理）
- [x] xuanji 使用 Sonnet（通用）
- [x] general-purpose 使用 Sonnet（通用）
- [x] intent-analyzer 使用 Haiku（简单）
- [x] context-compressor 使用 Haiku（简单）
- [x] explore 使用 Haiku（快速）
- [x] 全局 API Key 已配置
- [x] 全局 baseURL 已配置为 shibit.net
- [x] 所有模型名称使用 [CC] 前缀

---

## 🚀 部署就绪

**状态**：✅ 已完成

**下一步**：
1. 启动应用：`npm run dev`
2. 验证 Agent 正常工作
3. 观察日志，确认使用正确的模型

**验证命令**：
```bash
# 检查全局配置
cat ~/.xuanji/config.json | jq .config.provider

# 验证 Agent 配置
grep -r "primary:" src/core/agent/builtin/

# 启动应用
npm run dev
```

---

**配置完成时间**：2026-03-15
**状态**：✅ 所有 Agent 模型配置已更新
