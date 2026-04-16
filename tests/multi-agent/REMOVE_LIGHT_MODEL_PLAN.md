# 移除 Light Model 配置 - 实施方案

## 目标

移除 light model 配置功能，每个 agent 只配置一个模型。如果需要不同模型，用户可以手动修改 agent 配置。

## 当前问题

### Light Model 的使用场景

1. **意图分类**（IntentClassifier）- 使用轻量模型快速分类
2. **上下文压缩**（ContextCompressor）- 使用轻量模型压缩历史消息
3. **SubAgent 回退**（SubAgentLoop）- 某些场景使用轻量模型
4. **全局配置**（GlobalConfig）- 提供 lightModel 配置项

### 为什么要移除？

1. **配置复杂**：用户需要配置两个模型（model + lightModel）
2. **选择困难**：用户不知道什么场景该用哪个模型
3. **维护成本**：代码中需要维护两套 Provider
4. **实际需求**：大多数用户只想配置一个模型，需要优化时再手动调整

## 实施步骤

### Step 1: 移除全局配置中的 lightModel

**文件：** `src/core/types/config.ts`

```typescript
export interface ProviderConfig {
  adapter: string;
  model: string;
  // ❌ 移除 lightModel: string;
  apiKey?: string;
  baseURL?: string;
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
  thinking?: ThinkingConfig;
}
```

**文件：** `src/core/config/defaults.ts`

```typescript
export const DEFAULT_CONFIG: AppConfig = {
  provider: {
    adapter: 'anthropic',
    model: '[CC]claude-sonnet-4-5-20250929',
    // ❌ 移除 lightModel: '[CC]claude-haiku-4-5-20251001',
    maxTokens: 32000,
    timeout: 600000,
  },
  // ...
};
```

### Step 2: 移除 ProviderManager 中的 getLightProvider

**文件：** `src/core/providers/ProviderManager.ts`

```typescript
export class ProviderManager {
  // ❌ 移除整个方法
  // getLightProvider(): ILLMProvider {
  //   const lightModel = this.globalConfig.provider.lightModel || this.globalConfig.provider.model;
  //   return this.getProvider({
  //     id: '__light__',
  //     provider: { model: lightModel },
  //   } as unknown as ConfigurableAgentConfig);
  // }
}
```

### Step 3: 更新 ChatSession - 移除 lightProvider

**文件：** `src/core/chat/ChatSession.ts`

```typescript
export class ChatSession {
  private provider!: ILLMProvider;
  // ❌ 移除 private lightProvider!: ILLMProvider;

  async init() {
    // 创建 Provider
    this.provider = this.providerManager.getProvider();
    // ❌ 移除 this.lightProvider = this.providerManager.getLightProvider();

    // 初始化 SubAgentFactory（不再传递 lightProvider）
    this.subAgentFactory = new SubAgentFactory(
      this.agentRegistry,
      this.providerManager,
      this.baseRegistry!,
      this.hookRegistry,
      this.memoryManager,
      this.provider,  // 只传递一个 provider
    );
  }
}
```

### Step 4: 更新 SubAgentFactory - 移除 parentProvider

**文件：** `src/core/agent/SubAgentFactory.ts`

```typescript
export class SubAgentFactory {
  constructor(
    private agentRegistry: AgentRegistry,
    private providerManager: ProviderManager,
    private toolRegistry: IToolRegistry,
    private hookRegistry: HookRegistry | null,
    private memoryStore: IMemoryStore | null,
    // ❌ 移除 private parentProvider?: ILLMProvider,
  ) {}

  private async createSubAgent(agentIdOrRole: string, context: SubAgentContext) {
    // ...
    
    // ❌ 移除回退逻辑
    // if (hasIndependentProvider) {
    //   provider = this.providerManager.getProvider(agentConfig);
    // } else if (this.parentProvider) {
    //   provider = this.parentProvider;
    // } else {
    //   provider = this.providerManager.getProvider(agentConfig);
    // }

    // ✅ 简化：总是使用 agent 自己的配置
    provider = this.providerManager.getProvider(agentConfig);
  }
}
```

### Step 5: 为需要轻量模型的场景创建专用 Agent

**方案 A：创建 intent-analyzer agent（已存在）**

```json5
{
  id: 'intent-analyzer',
  name: '意图分析器',
  model: {
    primary: '[CC]claude-haiku-4-5-20251001',  // 使用轻量模型
  },
  provider: {
    adapter: 'anthropic',
    apiKey: 'sk-xxx',
    baseURL: 'https://shibit.net',
  },
}
```

**方案 B：创建 context-compressor agent（已存在）**

```json5
{
  id: 'context-compressor',
  name: '上下文压缩器',
  model: {
    primary: '[CC]claude-haiku-4-5-20251001',  // 使用轻量模型
  },
  provider: {
    adapter: 'anthropic',
    apiKey: 'sk-xxx',
    baseURL: 'https://shibit.net',
  },
}
```

### Step 6: 更新使用 lightProvider 的代码

**IntentClassifier**

```typescript
// 修改前
constructor(lightProvider: ILLMProvider) {
  this.provider = lightProvider;
}

// 修改后：使用 SubAgentFactory 调用 intent-analyzer
async classify(userMessage: string): Promise<IntentResult> {
  const result = await this.subAgentFactory.createAndRun('intent-analyzer', {
    task: `分析用户意图：${userMessage}`,
    timeout: 5000,
  });
  return this.parseResult(result.result);
}
```

**ContextCompressor**

```typescript
// 修改前
constructor(lightProvider: ILLMProvider) {
  this.provider = lightProvider;
}

// 修改后：使用 SubAgentFactory 调用 context-compressor
async compress(messages: Message[]): Promise<Message[]> {
  const result = await this.subAgentFactory.createAndRun('context-compressor', {
    task: `压缩以下对话历史：\n${JSON.stringify(messages)}`,
    timeout: 10000,
  });
  return this.parseResult(result.result);
}
```

### Step 7: 移除配置文件中的 lightModel

**文件：** `src/core/config/config.schema.json`

```json
{
  "properties": {
    "provider": {
      "properties": {
        "model": { "type": "string" }
        // ❌ 移除 "lightModel": { "type": "string" }
      }
    }
  }
}
```

### Step 8: 更新环境变量配置

**文件：** `src/core/config/EnvConfig.ts`

```typescript
export const ENV_KEYS = {
  API_KEY: 'XUANJI_API_KEY',
  BASE_URL: 'XUANJI_BASE_URL',
  MODEL: 'XUANJI_MODEL',
  // ❌ 移除 LIGHT_MODEL: 'XUANJI_LIGHT_MODEL',
  ADAPTER: 'XUANJI_ADAPTER',
};
```

### Step 9: 更新 UI 设置

**文件：** `src/adapters/cli/settings/LlmSettings.tsx`

移除 lightModel 的输入框和相关逻辑。

### Step 10: 更新文档和迁移指南

**迁移指南：**

```markdown
## 从 lightModel 迁移

### 旧配置
```json
{
  "provider": {
    "model": "[CC]claude-sonnet-4-5-20250929",
    "lightModel": "[CC]claude-haiku-4-5-20251001"
  }
}
```

### 新配置
```json
{
  "provider": {
    "model": "[CC]claude-sonnet-4-5-20250929"
  }
}
```

### 如果需要轻量模型

为特定 agent 配置轻量模型：

```json5
// .xuanji/agents/my-fast-agent.json5
{
  id: 'my-fast-agent',
  model: {
    primary: '[CC]claude-haiku-4-5-20251001',
  },
  provider: {
    adapter: 'anthropic',
    apiKey: 'sk-xxx',
  },
}
```
```

## 优势

1. **配置简化**：用户只需配置一个模型
2. **更灵活**：每个 agent 可以独立配置最适合的模型
3. **代码简化**：移除 lightProvider 相关代码
4. **易于理解**：不需要理解 model vs lightModel 的区别

## 影响范围

**需要修改的文件：**
- src/core/types/config.ts
- src/core/config/defaults.ts
- src/core/providers/ProviderManager.ts
- src/core/chat/ChatSession.ts
- src/core/agent/SubAgentFactory.ts
- src/core/intent/LLMIntentClassifier.ts
- src/core/agent/ContextCompressor.ts
- src/core/config/EnvConfig.ts
- src/core/config/config.schema.json
- src/adapters/cli/settings/LlmSettings.tsx

**需要更新的 agent 配置：**
- intent-analyzer.json5（确保配置了轻量模型）
- context-compressor.json5（确保配置了轻量模型）

## 向后兼容

**配置加载时的处理：**

```typescript
// 如果用户配置中仍有 lightModel，忽略它并给出警告
if (config.provider.lightModel) {
  log.warn('lightModel 配置已废弃，将被忽略。请为需要轻量模型的 agent 单独配置。');
  delete config.provider.lightModel;
}
```

## 测试计划

1. ✅ 移除 lightModel 配置后，主 agent 仍能正常工作
2. ✅ intent-analyzer 使用自己配置的轻量模型
3. ✅ context-compressor 使用自己配置的轻量模型
4. ✅ SubAgentFactory 不再依赖 parentProvider
5. ✅ 所有测试通过
