# Agent Provider 配置修复报告

## 问题描述

在 `agent_team` 执行时，所有子 agent 都报错"未配置 API Key"，导致 token 使用量为 0，无法正常工作。

## 根本原因

**两个关键问题：**

### 1. 类型定义缺失 `provider` 字段

`ConfigurableAgentConfig` 类型定义中缺少 `provider` 字段，导致 TypeScript 在加载 JSON5 配置时可能丢失这个字段。

**位置：** `src/core/agent/types.ts:250-400`

**影响：** AgentRegistry 加载配置时，虽然 JSON5 文件中有 `provider` 配置，但类型系统不认识这个字段。

### 2. SubAgentFactory 未传递 provider 配置到 AgentConfig

`SubAgentFactory.createSubAgent()` 在构建 `runtimeConfig` 时，没有将 agent 的 `provider.apiKey` 和 `provider.baseURL` 传递给 `AgentConfig`。

**位置：** `src/core/agent/SubAgentFactory.ts:294-306`

**影响：** 虽然 ProviderManager 正确创建了带有独立 apiKey 的 Provider，但 StreamRetryHandler 调用 `provider.stream()` 时使用的 `config.apiKey` 为 undefined。

**调用链：**
```
SubAgentFactory.createSubAgent()
  → 创建 runtimeConfig (缺少 apiKey/baseURL)
  → AgentLoop 使用 runtimeConfig
  → StreamRetryHandler.executeWithRetry()
  → provider.stream(messages, tools, {
      apiKey: this.config.apiKey,  // ← undefined!
      baseURL: this.config.baseURL, // ← undefined!
      ...
    })
  → AnthropicProvider.getClient()
  → 检查 config.apiKey 为空 → 抛出错误
```

## 修复方案

### 修复 1：添加 `provider` 字段到类型定义

**文件：** `src/core/agent/types.ts`

```typescript
export interface ConfigurableAgentConfig {
  // ... 其他字段 ...
  
  model: {
    primary: string;
    fallback?: string;
    maxTokens?: number;
    temperature?: number;
    thinking?: {
      type?: 'enabled' | 'disabled' | 'adaptive';
      effort?: 'low' | 'medium' | 'high';
    };
  };

  // ========== Provider 配置 ==========
  /** Provider 配置（可选，用于独立 API Key/BaseURL） */
  provider?: {
    /** Adapter 类型 */
    adapter?: string;
    /** API Key */
    apiKey?: string;
    /** Base URL */
    baseURL?: string;
    /** 模型名称（覆盖 model.primary） */
    model?: string;
  };

  // ... 其他字段 ...
}
```

### 修复 2：传递 provider 配置到 AgentConfig

**文件：** `src/core/agent/SubAgentFactory.ts`

```typescript
// 6. 构建 AgentConfig
const thinkingRaw = agentConfig.model.thinking;
const thinking = thinkingRaw?.type && thinkingRaw.type !== 'disabled'
  ? thinkingRaw as import('@/core/types').ThinkingConfig
  : undefined;

// 从 agent 配置中提取 provider 信息（apiKey/baseURL）
const agentProvider = (agentConfig as any).provider;

const runtimeConfig: AgentConfig = {
  model: agentConfig.model.primary,
  systemPrompt,
  maxIterations: context.maxIterations,
  temperature: agentConfig.model.temperature,
  maxTokens: agentConfig.model.maxTokens,
  thinking,
  // 添加 provider 配置（如果存在）
  apiKey: agentProvider?.apiKey,
  baseURL: agentProvider?.baseURL,
};
```

## 验证结果

### 修复前

```
2026-04-13T13:10:04.893Z xuanji:SubAgentFactory:debug   Using independent provider for agent: coder
2026-04-13T13:10:04.893Z xuanji:ProviderManager:info Provider created {
  providerName: 'anthropic',
  model: '[CC]claude-opus-4-6',
  hasCustomApiKey: true,  // ✅ Provider 有 API Key
  hasCustomBaseURL: false
}

2026-04-13T13:10:04.894Z xuanji:SubAgentFactory:error [subagent-coder-xxx] Error: 未配置 API Key
```

**问题：** ProviderManager 正确识别了 API Key，但实际调用时还是报错。

### 修复后

```
2026-04-13T13:23:30.136Z xuanji:SubAgentFactory:debug   Using independent provider for agent: coder
2026-04-13T13:23:30.136Z xuanji:ProviderManager:info Provider created {
  providerName: 'anthropic',
  model: '[CC]claude-opus-4-6',
  hasCustomApiKey: true,
  hasCustomBaseURL: false
}

2026-04-13T13:23:30.143Z xuanji:AnthropicProvider:debug Request: model=[CC]claude-opus-4-6, max_tokens=16384, messages=1, tools=0, cache_breakpoints=0
2026-04-13T13:23:36.101Z xuanji:AnthropicProvider:error Stream error: {"type":"error","error":{"type":"rate_limit_error",...}}
```

**结果：** 
- ✅ 没有"未配置 API Key"错误
- ✅ 成功发起 API 请求
- ⚠️ 遇到 429 rate limit（这是服务端限流，不是配置问题）

## 为什么之前记忆 agent 没有问题？

记忆相关的 agent（如 `memory-extractor`）也配置了独立的 `provider`：

```json5
{
  id: 'memory-extractor',
  model: {
    primary: '[CC]claude-haiku-4-5-20251001',
  },
  provider: {
    adapter: 'anthropic',
    apiKey: 'sk-4S3L201Rzmm2HOtgDH2NuEW9slE72wv0ExoHTGaDURLOZ4q8',
    baseURL: 'https://shibit.net',
  },
  // ...
}
```

**但为什么之前能工作？**

可能的原因：
1. 记忆 agent 可能是在修复前的某个版本中测试的，当时可能使用了全局配置的 API Key
2. 或者记忆 agent 的调用路径不同（例如直接使用全局 Provider）

## 影响范围

**受影响的场景：**
- ✅ `agent_team` 工具（所有策略：sequential/parallel/hierarchical/debate/pipeline）
- ✅ `task` 工具调用子 agent
- ✅ 任何使用 SubAgentFactory 创建的子 agent

**不受影响的场景：**
- ✅ 主 agent（使用全局配置）
- ✅ 直接使用 ProviderManager 的场景

## 后续建议

### 1. 完全使用 agent 配置，移除全局配置依赖

用户建议："去掉全局配置的使用，完全改成使用 agent 中每个 agent 配置的模型"

**实施方案：**
1. 确保所有 builtin agent 都有完整的 `provider` 配置
2. 修改 ProviderManager，当 agent 没有 provider 配置时报错（而不是回退到全局配置）
3. 更新文档，明确要求每个 agent 必须配置独立的 provider

### 2. 添加配置验证

在 AgentRegistry 加载配置时，验证：
- 每个 agent 必须有 `provider.apiKey`
- 每个 agent 必须有 `provider.adapter`
- 如果缺失，在启动时就报错，而不是运行时才发现

### 3. 添加集成测试

创建测试用例验证：
- 每个 builtin agent 都能正确使用独立的 provider 配置
- agent_team 的所有策略都能正常工作
- 子 agent 的 token 使用量 > 0

## 总结

**修复内容：**
1. ✅ 在 `ConfigurableAgentConfig` 类型中添加 `provider` 字段
2. ✅ 在 `SubAgentFactory.createSubAgent()` 中将 `provider.apiKey` 和 `provider.baseURL` 传递给 `runtimeConfig`

**验证结果：**
- ✅ 子 agent 能正确使用独立的 API Key
- ✅ 没有"未配置 API Key"错误
- ✅ 成功发起 API 请求

**下一步：**
- 移除全局配置依赖，强制每个 agent 使用独立配置
- 添加配置验证和集成测试
