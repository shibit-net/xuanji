# 系统 LLM vs Agent LLM 配置详解

## 配置层级

### 全局配置（系统设置）
```typescript
// ~/.xuanji/config.json
AppConfig {
  provider: {
    adapter: 'anthropic',                    // 默认提供商
    model: 'claude-sonnet-4-5-20250929',    // 默认主模型
    lightModel: 'claude-haiku-4-5-20251001',// 默认轻量模型（用于快速任务）
    apiKey: 'sk-ant-api03-xxx',             // 默认 API Key
    baseURL: 'https://api.anthropic.com',   // 默认 API 端点
    maxTokens: 8096,                        // 默认最大 token
    temperature: 0.7,                       // 默认温度
    timeout: 60000,                         // 默认超时（60s）
  }
}
```

**作用域**：
- 🌍 所有未指定 `provider` 配置的 Agent
- 🌍 所有交互式对话（非 SubAgent）
- 🌍 所有工具调用的默认模型

**适用场景**：
- 个人使用（单一 API Key）
- 小团队（统一计费）
- 简单配置（开箱即用）

---

### Agent 配置（专用设置）
```typescript
// ~/.xuanji/agents/coder.json5
{
  id: 'coder',
  name: '代码助手',

  // ⬇️ Agent 专用 LLM 配置（覆盖全局设置）
  provider: {
    adapter: 'openai',                  // 使用 OpenAI 而非 Anthropic
    apiKey: 'sk-proj-xxx',              // 独立的 API Key
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o',                    // 主模型：GPT-4o
    fallbackModel: 'gpt-4o-mini',       // 降级模型
    maxTokens: 4096,                    // 更小的 token 限制
    temperature: 0.3,                   // 更低的温度（代码生成）
  },

  // ⬇️ 模型选择（向后兼容，优先级低于 provider.model）
  model: {
    primary: 'sonnet',   // 如果 provider.model 未设置，使用 Sonnet
    fallback: 'haiku',
  },

  systemPrompt: '你是一个专业的代码助手...',
  tools: {
    required: ['read', 'write', 'edit', 'bash'],
  }
}
```

**作用域**：
- 🎯 仅当前 Agent
- 🎯 该 Agent 创建的所有 SubAgent（继承配置）

**适用场景**：
- 多提供商混用（OpenAI + Anthropic）
- 不同任务类型（代码用 GPT-4o，写作用 Claude）
- 成本优化（快速任务用 Haiku，复杂任务用 Opus）
- 内网部署（某些 Agent 使用内网端点）

---

## 配置合并规则

### 字段级合并（Field-level Merge）
```typescript
class ProviderManager {
  mergeProviderConfig(agentConfig?: ConfigurableAgentConfig): MergedProviderConfig {
    const global = this.globalConfig.provider;
    const agent = agentConfig?.provider || {};

    return {
      // ⬇️ 逐字段合并（Agent 优先）
      adapter:     agent.adapter     || global.adapter,
      apiKey:      agent.apiKey      || global.apiKey,
      baseURL:     agent.baseURL     || global.baseURL,
      model:       agent.model       || agentConfig?.model?.primary || global.model,
      fallbackModel: agent.fallbackModel || agentConfig?.model?.fallback || global.lightModel,
      maxTokens:   agent.maxTokens   || global.maxTokens,
      temperature: agent.temperature || global.temperature,
      timeout:     agent.timeout     || global.timeout,
    };
  }
}
```

### 示例

**配置输入**：
```typescript
// 全局配置
AppConfig.provider = {
  adapter: 'anthropic',
  apiKey: 'sk-ant-xxx',
  model: 'claude-sonnet-4-5',
  maxTokens: 8096,
  temperature: 0.7,
}

// Agent 配置（部分覆盖）
AgentConfig.provider = {
  adapter: 'openai',
  apiKey: 'sk-openai-xxx',
  model: 'gpt-4o',
  // maxTokens 未设置，使用全局值
  // temperature 未设置，使用全局值
}
```

**合并结果**：
```typescript
MergedConfig = {
  adapter: 'openai',        // Agent 覆盖
  apiKey: 'sk-openai-xxx',  // Agent 覆盖
  model: 'gpt-4o',          // Agent 覆盖
  maxTokens: 8096,          // 全局默认
  temperature: 0.7,         // 全局默认
}
```

---

## 使用场景

### 场景 1: 单一提供商（推荐初学者）
```json
// config.json（系统设置）
{
  "provider": {
    "adapter": "anthropic",
    "apiKey": "sk-ant-xxx",
    "model": "claude-sonnet-4-5-20250929"
  }
}

// 所有 Agent 都不设置 provider，继承全局配置
```

**优点**：
- ✅ 简单配置
- ✅ 统一计费
- ✅ 易于管理

---

### 场景 2: 多提供商混用
```json
// config.json（默认使用 Anthropic）
{
  "provider": {
    "adapter": "anthropic",
    "apiKey": "sk-ant-xxx",
    "model": "claude-sonnet-4-5"
  }
}

// coder.json5（编码任务使用 OpenAI）
{
  "id": "coder",
  "provider": {
    "adapter": "openai",
    "apiKey": "sk-openai-xxx",
    "model": "gpt-4o"
  }
}

// writer.json5（写作任务使用 Claude Opus）
{
  "id": "writer",
  "provider": {
    "model": "claude-opus-4-20250514"  // 只覆盖模型
  }
}
```

**优点**：
- ✅ 各取所长（GPT-4o 代码强，Claude 写作强）
- ✅ 灵活配置

---

### 场景 3: 成本优化
```json
// config.json（默认使用便宜的 Haiku）
{
  "provider": {
    "adapter": "anthropic",
    "apiKey": "sk-ant-xxx",
    "model": "claude-haiku-4-5-20251001"  // 快速且便宜
  }
}

// plan.json5（规划任务使用高级模型）
{
  "id": "plan",
  "provider": {
    "model": "claude-opus-4-20250514"  // 复杂推理
  }
}

// explore.json5（探索任务也使用便宜模型）
{
  "id": "explore",
  // 不设置 provider，继承全局 Haiku
}
```

**优点**：
- ✅ 控制成本
- ✅ 快速任务不浪费

---

### 场景 4: 内网部署
```json
// config.json（默认使用公网 Anthropic）
{
  "provider": {
    "adapter": "anthropic",
    "apiKey": "sk-ant-xxx",
    "model": "claude-sonnet-4-5"
  }
}

// internal-coder.json5（敏感代码任务使用内网 LLM）
{
  "id": "internal-coder",
  "provider": {
    "adapter": "openai",  // 兼容 OpenAI API 的内网服务
    "baseURL": "https://internal-llm.company.com/v1",
    "apiKey": "internal-key-xxx",
    "model": "gpt-4-internal"
  }
}
```

**优点**：
- ✅ 敏感数据不出内网
- ✅ 灵活混用

---

## GUI 设置界面设计

### 系统设置页面
```
┌─ LLM 配置（全局默认）───────────────────────┐
│                                             │
│ Provider:  [Anthropic         ▼]           │
│ Model:     [Sonnet 4.5        ▼]           │
│ API Key:   [sk-ant-api03-xxx...] [👁️ 显示] │
│ Base URL:  [https://api.anthropic.com]     │
│                                             │
│ ────────────────────────────────────────    │
│ 高级选项                                     │
│ Max Tokens:    [8096        ]              │
│ Temperature:   [0.7         ]              │
│ Timeout:       [60s         ]              │
│                                             │
│ ℹ️ 此配置作为所有 Agent 的默认设置           │
│ ℹ️ Agent 可以在编辑器中覆盖这些设置          │
│                                             │
│               [保存] [重置]                  │
└─────────────────────────────────────────────┘
```

---

### Agent 编辑器
```
┌─ Coder Agent ───────────────────────────────┐
│                                             │
│ 基本信息                                     │
│ Name:     [代码助手              ]          │
│ ID:       [coder                 ]          │
│                                             │
│ ────────────────────────────────────────    │
│                                             │
│ ☑️ 使用自定义 LLM 配置                       │
│    （取消勾选则使用系统默认配置）             │
│                                             │
│ Provider:  [OpenAI            ▼]           │
│ Model:     [GPT-4o            ▼]           │
│ API Key:   [sk-proj-xxx...] [👁️ 显示]      │
│ Base URL:  [https://api.openai.com/v1]     │
│                                             │
│ ────────────────────────────────────────    │
│ 高级选项                                     │
│ Max Tokens:    [4096        ]              │
│ Temperature:   [0.3         ]  ← 代码生成用低温 │
│ Fallback Model:[GPT-4o-mini ▼]             │
│                                             │
│ ℹ️ 覆盖系统默认设置                          │
│ ℹ️ 仅对此 Agent 生效                         │
│                                             │
│               [保存] [重置]                  │
└─────────────────────────────────────────────┘
```

---

## 模型选择策略

### 按任务类型选择

| 任务类型 | 推荐模型 | 理由 |
|---------|---------|------|
| 代码生成 | GPT-4o | 代码补全、语法理解强 |
| 长文本写作 | Claude Opus | 上下文窗口大（200K） |
| 快速问答 | Claude Haiku | 速度快、成本低 |
| 复杂推理 | Claude Opus / GPT-o1 | 推理能力强 |
| 探索代码库 | Claude Haiku | 快速扫描，性价比高 |
| 规划任务 | Claude Sonnet | 平衡性能和成本 |

### 按成本选择

| 模型 | 价格（每百万 token） | 适用场景 |
|-----|---------------------|---------|
| Claude Haiku | $0.25 / $1.25 | 快速任务、探索 |
| Claude Sonnet | $3 / $15 | 日常对话、通用任务 |
| Claude Opus | $15 / $75 | 复杂任务、长文本 |
| GPT-4o | $2.5 / $10 | 代码生成 |
| GPT-4o-mini | $0.15 / $0.6 | 简单任务 |

*价格仅供参考，以官网为准*

---

## 降级策略

### 自动降级
```typescript
// ProviderManager 自动处理降级
getProvider(agentConfig) {
  try {
    // 1. 尝试主模型
    const primary = this.createProvider({
      model: agentConfig.provider.model
    });
    return primary;
  } catch (error) {
    // 2. 降级到 fallbackModel
    if (agentConfig.provider.fallbackModel) {
      const fallback = this.createProvider({
        model: agentConfig.provider.fallbackModel
      });
      return fallback;
    }

    // 3. 降级到全局默认
    const global = this.createProvider({
      model: this.globalConfig.provider.model
    });
    return global;
  }
}
```

### 降级场景

**1. API 配额用尽**：
```
GPT-4o (主) → GPT-4o-mini (降级) → Claude Sonnet (全局)
```

**2. 模型不可用**：
```
gpt-5-preview (主) → gpt-4o (降级) → Claude Sonnet (全局)
```

**3. 内网服务故障**：
```
internal-llm (主) → GPT-4o (降级) → Claude Sonnet (全局)
```

---

## 最佳实践

### ✅ 推荐做法

1. **全局使用性价比高的模型**：
   ```json
   {
     "provider": {
       "model": "claude-sonnet-4-5"  // 平衡性能和成本
     }
   }
   ```

2. **特定任务使用专用模型**：
   ```json
   {
     "id": "coder",
     "provider": { "model": "gpt-4o" }  // 代码用 GPT-4o
   }
   ```

3. **设置降级模型**：
   ```json
   {
     "provider": {
       "model": "claude-opus-4",
       "fallbackModel": "claude-sonnet-4-5"
     }
   }
   ```

4. **内网服务设置独立端点**：
   ```json
   {
     "id": "internal-agent",
     "provider": {
       "baseURL": "https://internal.company.com/v1"
     }
   }
   ```

### ❌ 避免做法

1. **所有 Agent 都设置专用配置**（管理复杂）
2. **忘记设置降级模型**（服务不稳定）
3. **混用不兼容的 adapter**（如 Anthropic API Key + OpenAI adapter）
4. **硬编码 API Key 在配置文件**（安全风险）

---

## 环境变量覆盖

```bash
# 全局配置可通过环境变量覆盖
export XUANJI_API_KEY="sk-ant-xxx"
export XUANJI_BASE_URL="https://custom-api.example.com"
export XUANJI_MODEL="claude-sonnet-4-5"

# Agent 配置不支持环境变量覆盖（必须在配置文件中设置）
```

---

## 总结

### 系统 LLM
- **作用域**: 全局默认
- **配置位置**: `~/.xuanji/config.json`
- **适用**: 所有未指定 provider 的 Agent
- **场景**: 个人使用、简单配置

### Agent LLM
- **作用域**: 特定 Agent
- **配置位置**: `~/.xuanji/agents/<agent-id>.json5`
- **适用**: 需要专用模型的 Agent
- **场景**: 多提供商、成本优化、内网部署

### 关键设计
- **字段级合并**: Agent 配置优先，全局配置兜底
- **灵活降级**: 主模型 → 降级模型 → 全局模型
- **Provider 单例**: 同一 adapter 类型共享 Provider 实例
- **配置隔离**: Agent 配置互不影响

### GUI 建议
- 系统设置页面：全局 LLM 配置（简单明了）
- Agent 编辑器：可选的专用 LLM 配置（高级用户）
- 配置继承可视化：显示"使用系统默认"或"自定义配置"
