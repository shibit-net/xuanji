# Agent 独立 Provider 配置设计

**扩展需求**：每个 Agent 可以配置属于自己的 model、apiKey、baseURL 和 provider

**场景**：
- coder Agent 使用 OpenAI GPT-4（需要 OpenAI API Key）
- explore Agent 使用 shibit.net Haiku（需要 shibit.net API Key）
- stock-analyst Agent 使用 Kimi（需要 Kimi API Key + baseURL）

---

## 配置层次设计

### 1. 全局默认配置（`~/.xuanji/config.json`）

```json
{
  "version": "1.0",
  "config": {
    "provider": {
      "apiKey": "sk-default-key",
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

**用途**：作为所有 Agent 的默认值（降级目标）

---

### 2. Agent 独立配置（`builtin/*.json5`）

**完整配置示例**（`coder.json5`）：

```json5
{
  id: 'coder',
  name: '编程助手',
  description: '专注于代码编写、测试和调试',

  avatar: '💻',
  color: 'from-green-500 to-teal-600',

  // ✅ Agent 独立 Provider 配置
  provider: {
    apiKey: 'sk-openai-xxx',           // Agent 专用 API Key
    baseURL: 'https://api.openai.com/v1',  // Agent 专用 baseURL
    adapter: 'openai',                 // Agent 专用 adapter
    model: 'gpt-4',                    // Agent 主模型
    fallbackModel: 'gpt-3.5-turbo',   // Agent 降级模型
    maxTokens: 32000,
    timeout: 300000,
    temperature: 0.7,                  // Agent 专用参数
  },

  // ⚠️ 向后兼容（废弃，优先使用 provider.model）
  model: {
    primary: 'gpt-4',
    fallback: 'gpt-3.5-turbo',
    maxTokens: 32000,
  },

  systemPrompt: "You are a coding agent...",

  tools: [
    { name: 'read_file', required: true },
    { name: 'write_file', required: true },
    // ...
  ],

  execution: {
    mode: 'react',
    maxIterations: 40,
    timeout: 600000,
    streaming: true,
  },

  permissions: {
    fileRead: 'always',
    fileWrite: 'ask',
    bashExec: 'ask',
    network: 'deny',
  },

  tags: ['subagent', 'coding', 'development'],
  enabled: true,

  metadata: {
    builtin: true,
    isSubAgent: true,
  },
}
```

**精简配置示例**（`explore.json5`）：

```json5
{
  id: 'explore',
  name: '探索助手',

  // ✅ 只配置必要字段，其他继承全局配置
  provider: {
    model: '[CC]claude-haiku-4-5-20251001',  // 只覆盖 model
    // apiKey, baseURL, adapter 继承全局配置
  },

  systemPrompt: "You are a fast exploration agent...",

  tools: [
    { name: 'read_file', required: true },
    { name: 'glob', required: true },
    { name: 'grep', required: true },
  ],

  // ...
}
```

**多 Provider 示例**（`stock-analyst.json5`）：

```json5
{
  id: 'stock-analyst',
  name: '股票分析师',

  // ✅ 使用 Kimi 大模型
  provider: {
    apiKey: 'sk-kimi-xxx',
    baseURL: 'https://api.moonshot.cn/v1',
    adapter: 'openai',  // Kimi 兼容 OpenAI API
    model: 'moonshot-v1-128k',
    maxTokens: 128000,
  },

  systemPrompt: "You are a stock analyst...",

  // ...
}
```

---

## 配置合并策略

### 优先级（从高到低）

```
运行时参数 > Agent.provider 配置 > 全局 config.provider 配置
```

### 字段级合并

```typescript
// 伪代码
function mergeProviderConfig(
  agentConfig: AgentConfig,
  globalConfig: AppConfig
): ProviderConfig {
  return {
    apiKey: agentConfig.provider?.apiKey ?? globalConfig.provider.apiKey,
    baseURL: agentConfig.provider?.baseURL ?? globalConfig.provider.baseURL,
    adapter: agentConfig.provider?.adapter ?? globalConfig.provider.adapter,
    model: agentConfig.provider?.model ?? globalConfig.provider.model,
    fallbackModel: agentConfig.provider?.fallbackModel ?? globalConfig.provider.lightModel,
    maxTokens: agentConfig.provider?.maxTokens ?? globalConfig.provider.maxTokens,
    timeout: agentConfig.provider?.timeout ?? globalConfig.provider.timeout,
    temperature: agentConfig.provider?.temperature ?? 1.0,
  };
}
```

---

## ProviderManager 增强设计

### 完整实现

```typescript
/**
 * Provider 配置（字段级）
 */
export interface ProviderConfig {
  apiKey?: string;
  baseURL?: string;
  adapter?: string;
  model?: string;
  fallbackModel?: string;
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
  [key: string]: any;
}

/**
 * Provider 管理器
 *
 * 职责：
 * 1. 根据 Agent 配置按需创建 Provider
 * 2. 支持每个 Agent 独立的 apiKey、baseURL、adapter
 * 3. 字段级配置合并（Agent 配置 > 全局配置）
 * 4. Provider 缓存（按配置哈希）
 * 5. 处理降级策略
 */
export class ProviderManager {
  private providerFactory: ProviderFactory;
  private providerCache: Map<string, ILLMProvider>;
  private globalConfig: AppConfig;

  constructor(globalConfig: AppConfig) {
    this.providerFactory = new ProviderFactory();
    this.providerCache = new Map();
    this.globalConfig = globalConfig;
  }

  /**
   * 根据 Agent 配置获取 Provider
   *
   * @param agentConfig Agent 配置（可选）
   * @returns Provider 实例
   */
  getProvider(agentConfig?: ConfigurableAgentConfig): ILLMProvider {
    // 1. 合并配置（Agent 配置 > 全局配置）
    const mergedConfig = this.mergeProviderConfig(agentConfig);

    // 2. 生成缓存 key（基于配置哈希）
    const cacheKey = this.generateCacheKey(mergedConfig);

    // 3. 从缓存获取
    if (this.providerCache.has(cacheKey)) {
      return this.providerCache.get(cacheKey)!;
    }

    // 4. 创建新 provider
    const provider = this.createProvider(mergedConfig);

    // 5. 缓存
    this.providerCache.set(cacheKey, provider);

    return provider;
  }

  /**
   * 合并 Provider 配置（字段级）
   *
   * 优先级：Agent 配置 > 全局配置
   */
  private mergeProviderConfig(agentConfig?: ConfigurableAgentConfig): ProviderConfig {
    const agentProvider = agentConfig?.provider;
    const globalProvider = this.globalConfig.provider;

    // 向后兼容：支持旧的 agentConfig.model 字段
    const legacyModel = agentConfig?.model?.primary;
    const legacyFallback = agentConfig?.model?.fallback;

    return {
      // 认证信息
      apiKey: agentProvider?.apiKey ?? globalProvider.apiKey,
      baseURL: agentProvider?.baseURL ?? globalProvider.baseURL,

      // Provider 类型
      adapter: agentProvider?.adapter ?? globalProvider.adapter,

      // 模型配置
      model: agentProvider?.model ?? legacyModel ?? globalProvider.model,
      fallbackModel: agentProvider?.fallbackModel ?? legacyFallback ?? globalProvider.lightModel,

      // 调用参数
      maxTokens: agentProvider?.maxTokens ?? agentConfig?.model?.maxTokens ?? globalProvider.maxTokens,
      timeout: agentProvider?.timeout ?? globalProvider.timeout,
      temperature: agentProvider?.temperature ?? 1.0,

      // 其他自定义参数
      ...(agentProvider ?? {}),
    };
  }

  /**
   * 创建 Provider 实例
   *
   * @param config 合并后的配置
   */
  private createProvider(config: ProviderConfig): ILLMProvider {
    // 1. 选择 adapter
    let provider: ILLMProvider | undefined;

    if (config.adapter) {
      provider = this.providerFactory.getByAdapter(config.adapter);
    }

    if (!provider && config.model) {
      provider = this.providerFactory.getByModel(config.model);
    }

    if (!provider) {
      throw new Error(
        `Unsupported provider: adapter=${config.adapter}, model=${config.model}`
      );
    }

    // 2. 设置 Provider 配置
    provider.configure({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      model: config.model,
      maxTokens: config.maxTokens,
      timeout: config.timeout,
      temperature: config.temperature,
    });

    return provider;
  }

  /**
   * 生成缓存 key（基于配置哈希）
   *
   * 相同配置使用同一个 Provider 实例
   */
  private generateCacheKey(config: ProviderConfig): string {
    const keyParts = [
      config.adapter || 'auto',
      config.baseURL || 'default',
      config.model || 'default',
      config.apiKey?.substring(0, 8) || 'none',  // 只取前 8 位避免泄漏
    ];
    return keyParts.join('::');
  }

  /**
   * 获取轻量模型 Provider（向后兼容）
   */
  getLightProvider(): ILLMProvider {
    return this.getProvider({
      provider: {
        model: this.globalConfig.provider.lightModel || this.globalConfig.provider.model,
      },
    } as ConfigurableAgentConfig);
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.providerCache.clear();
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.providerCache.size,
      keys: Array.from(this.providerCache.keys()),
    };
  }
}
```

---

## 使用示例

### 场景 1：coder 使用 GPT-4

**配置**（`builtin/coder.json5`）：

```json5
{
  id: 'coder',
  provider: {
    apiKey: 'sk-openai-xxx',
    baseURL: 'https://api.openai.com/v1',
    adapter: 'openai',
    model: 'gpt-4',
    fallbackModel: 'gpt-3.5-turbo',
  },
  // ...
}
```

**运行时**：

```typescript
// 1. 用户调用 coder
{
  "name": "task",
  "input": {
    "description": "Implement user authentication",
    "subagent_type": "coder"
  }
}

// 2. ProviderManager 合并配置
const agentProfile = agentRegistry.get('coder');
const mergedConfig = {
  apiKey: 'sk-openai-xxx',         // 来自 coder.json5
  baseURL: 'https://api.openai.com/v1',  // 来自 coder.json5
  adapter: 'openai',               // 来自 coder.json5
  model: 'gpt-4',                  // 来自 coder.json5
  fallbackModel: 'gpt-3.5-turbo', // 来自 coder.json5
  maxTokens: 32000,                // 来自 coder.json5
  timeout: 120000,                 // 继承全局配置
};

// 3. 创建 OpenAI Provider
const provider = providerManager.getProvider(agentProfile);
// provider = OpenAIProvider({
//   apiKey: 'sk-openai-xxx',
//   baseURL: 'https://api.openai.com/v1',
//   model: 'gpt-4',
// })

// ✅ coder 使用 OpenAI GPT-4
```

---

### 场景 2：explore 使用 shibit.net Haiku

**配置**（`builtin/explore.json5`）：

```json5
{
  id: 'explore',
  provider: {
    model: '[CC]claude-haiku-4-5-20251001',
    // 其他字段继承全局配置
  },
  // ...
}
```

**运行时**：

```typescript
// 1. 用户调用 explore
{
  "name": "task",
  "input": {
    "description": "List all TypeScript files",
    "subagent_type": "explore"
  }
}

// 2. ProviderManager 合并配置
const agentProfile = agentRegistry.get('explore');
const mergedConfig = {
  apiKey: 'sk-4S3L201Rzmm2HOtgDH2NuEW9slE72wv0ExoHTGaDURLOZ4q8',  // 继承全局
  baseURL: 'https://shibit.net',    // 继承全局
  adapter: 'anthropic',              // 继承全局
  model: '[CC]claude-haiku-4-5-20251001',  // 来自 explore.json5
  maxTokens: 16000,                  // 来自 explore.json5
  timeout: 120000,                   // 继承全局
};

// 3. 创建 Anthropic Provider
const provider = providerManager.getProvider(agentProfile);
// provider = AnthropicProvider({
//   apiKey: 'sk-4S3L201R...',
//   baseURL: 'https://shibit.net',
//   model: '[CC]claude-haiku-4-5-20251001',
// })

// ✅ explore 使用 shibit.net Haiku
```

---

### 场景 3：stock-analyst 使用 Kimi

**配置**（`builtin/stock-analyst.json5`）：

```json5
{
  id: 'stock-analyst',
  provider: {
    apiKey: 'sk-kimi-xxx',
    baseURL: 'https://api.moonshot.cn/v1',
    adapter: 'openai',  // Kimi 兼容 OpenAI API
    model: 'moonshot-v1-128k',
    maxTokens: 128000,
  },
  // ...
}
```

**运行时**：

```typescript
// ProviderManager 合并配置
const mergedConfig = {
  apiKey: 'sk-kimi-xxx',            // 来自 stock-analyst.json5
  baseURL: 'https://api.moonshot.cn/v1',  // 来自 stock-analyst.json5
  adapter: 'openai',                // 来自 stock-analyst.json5
  model: 'moonshot-v1-128k',        // 来自 stock-analyst.json5
  maxTokens: 128000,                // 来自 stock-analyst.json5
};

// 创建 OpenAI Provider（兼容 Kimi）
const provider = providerManager.getProvider(agentProfile);
// ✅ stock-analyst 使用 Kimi moonshot-v1-128k
```

---

## 配置哈希缓存

### 缓存机制

```typescript
// 相同配置 → 使用同一个 Provider 实例
const cacheKey = generateCacheKey({
  adapter: 'openai',
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-4',
  apiKey: 'sk-openai-xxx',
});

// cacheKey = "openai::https://api.openai.com/v1::gpt-4::sk-openai"

if (providerCache.has(cacheKey)) {
  return providerCache.get(cacheKey);  // 复用实例
}
```

**优势**：
- 多个 Agent 使用相同配置 → 共享 Provider 实例
- 减少内存占用
- 减少初始化开销

---

## 降级策略

### 模型降级

```typescript
// Agent 配置
{
  provider: {
    model: 'gpt-4',
    fallbackModel: 'gpt-3.5-turbo',
  }
}

// 调用流程
try {
  const result = await provider.stream(messages, [], {
    model: config.model,  // 尝试 gpt-4
  });
} catch (error) {
  if (isRateLimitError(error) || isModelUnavailableError(error)) {
    // 降级到 fallbackModel
    const result = await provider.stream(messages, [], {
      model: config.fallbackModel,  // gpt-3.5-turbo
    });
  }
}
```

### API Key 降级

```typescript
// Agent 配置
{
  provider: {
    apiKey: 'sk-agent-key',  // Agent 专用 Key
  }
}

// 全局配置
{
  provider: {
    apiKey: 'sk-global-key',  // 全局 Key
  }
}

// 合并策略
const mergedConfig = {
  apiKey: agentConfig.provider?.apiKey ?? globalConfig.provider.apiKey,
  // Agent Key 失败 → 自动降级到全局 Key（如果未配置）
};
```

---

## 安全性考虑

### API Key 隔离

```json5
// ✅ 推荐：每个 Agent 使用独立 API Key
{
  id: 'public-agent',
  provider: {
    apiKey: 'sk-limited-key',  // 有速率限制的公共 Key
  }
}

{
  id: 'premium-agent',
  provider: {
    apiKey: 'sk-premium-key',  // 高速率限制的付费 Key
  }
}
```

### API Key 加密存储

```typescript
// config.json
{
  "provider": {
    "apiKey": "ENC(encrypted_key_here)",  // 加密存储
  }
}

// ProviderManager
private decryptApiKey(apiKey: string): string {
  if (apiKey.startsWith('ENC(')) {
    return decrypt(apiKey);
  }
  return apiKey;
}
```

---

## 向后兼容

### 支持旧配置格式

```json5
// 旧格式（仍然支持）
{
  id: 'coder',
  model: {
    primary: '[CC]claude-opus-4-6',
    fallback: '[CC]claude-sonnet-4-5-20250929',
    maxTokens: 32000,
  }
}

// 新格式（推荐）
{
  id: 'coder',
  provider: {
    model: '[CC]claude-opus-4-6',
    fallbackModel: '[CC]claude-sonnet-4-5-20250929',
    maxTokens: 32000,
  }
}

// 合并逻辑
const mergedConfig = {
  model: agentConfig.provider?.model
    ?? agentConfig.model?.primary  // ← 向后兼容
    ?? globalConfig.provider.model,
};
```

---

## 总结

### 核心特性

✅ **Agent 独立配置**：每个 Agent 可配置专属 apiKey、baseURL、adapter、model
✅ **字段级合并**：Agent 配置覆盖全局配置（字段级，不是整体替换）
✅ **按需创建**：根据配置哈希创建 Provider，相同配置复用实例
✅ **自动降级**：model → fallbackModel → global model
✅ **向后兼容**：支持旧的 `model.primary/fallback` 配置
✅ **安全隔离**：每个 Agent 使用独立 API Key，互不影响

### 使用场景

| 场景 | 配置示例 | 效果 |
|------|---------|------|
| **使用不同 LLM** | coder 用 GPT-4<br>explore 用 Claude | 按需选择最适合的模型 |
| **使用不同服务商** | Agent A 用 OpenAI<br>Agent B 用 shibit.net | 混合多个 LLM 服务 |
| **API Key 隔离** | 公共 Agent 用限速 Key<br>高级 Agent 用付费 Key | 成本控制 + 性能保证 |
| **多账号管理** | 每个 Agent 用独立账号 | 账号隔离，风险分散 |

---

**设计完成日期**：2026-03-15
**状态**：✅ 设计完成，待实施
