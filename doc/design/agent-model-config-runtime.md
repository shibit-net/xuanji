# Agent 独立模型配置 - 运行时生效设计方案（阶段 2）

## 设计目标

让每个 Agent 在运行时使用其配置文件中指定的模型，而不是共享全局 Provider。

## 核心挑战

### 1. Provider 创建成本高
- 每次创建新 Provider 需要初始化 HTTP 客户端、认证等
- 频繁创建会影响性能
- **解决方案**：Provider 池 + 缓存复用

### 2. API Key 管理
- 不同模型可能需要不同的 API Key（Anthropic vs OpenAI）
- 安全性：不能在 Agent 配置中明文存储 API Key
- **解决方案**：集中管理 API Key，Agent 配置只引用

### 3. 配置优先级
- Agent 配置 vs 全局配置
- 子代理继承 vs 覆盖
- **解决方案**：三级配置合并（Agent > 环境变量 > 全局配置）

### 4. 向后兼容
- 现有代码大量使用 mainProvider/lightProvider
- **解决方案**：渐进式迁移，保留降级路径

---

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      ChatSession                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           ProviderManager (新增)                      │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │  Provider Pool (按模型缓存 Provider)            │  │   │
│  │  │  - claude-sonnet-xxx → AnthropicProvider#1     │  │   │
│  │  │  - claude-haiku-xxx  → AnthropicProvider#2     │  │   │
│  │  │  - gpt-4o           → OpenAIProvider#1        │  │   │
│  │  └────────────────────────────────────────────────┘  │   │
│  │                                                        │   │
│  │  getOrCreateProvider(modelConfig) → ILLMProvider     │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           AgentRegistry                               │   │
│  │  get(agentId) → AgentProfile (包含 model 配置)        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                    SubAgentLoop                              │
│  1. 查询 AgentRegistry 获取 agent 配置                        │
│  2. 调用 ProviderManager.getOrCreateProvider(agent.model)   │
│  3. 创建 AgentLoop(provider, ...)                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心组件设计

### 1. ProviderManager（Provider 工厂 + 缓存池）

**位置**：`src/core/providers/ProviderManager.ts`

**职责**：
- 根据模型配置创建 Provider
- 缓存和复用 Provider 实例
- 管理 API Key（从全局配置读取）
- 模型别名解析（`[CC]` 前缀、模型映射）

**接口设计**：

```typescript
// src/core/providers/ProviderManager.ts

import type { ILLMProvider } from '@/core/types';
import { AnthropicProvider } from '@/core/providers/AnthropicProvider';
import { OpenAIProvider } from '@/core/providers/OpenAIProvider';

/**
 * 模型配置（从 Agent 配置中提取）
 */
export interface ModelConfig {
  primary: string;        // 主模型
  fallback?: string;      // 备用模型
  temperature?: number;   // 温度
  maxTokens?: number;     // 最大 tokens
  thinking?: {            // Extended Thinking（仅 Claude）
    type?: 'enabled' | 'disabled' | 'adaptive';
    effort?: 'low' | 'medium' | 'high';
  };
}

/**
 * Provider 配置（全局 API Key）
 */
export interface ProviderCredentials {
  anthropicKey?: string;
  openaiKey?: string;
  ollamaBaseURL?: string;
}

/**
 * Provider 缓存键
 */
interface ProviderCacheKey {
  adapter: 'anthropic' | 'openai' | 'ollama';
  model: string;
  temperature: number;
  maxTokens: number;
}

/**
 * Provider 管理器
 *
 * 职责：
 * - 根据模型配置创建 Provider
 * - 缓存和复用 Provider 实例
 * - 管理 API Key
 */
export class ProviderManager {
  private providerCache = new Map<string, ILLMProvider>();
  private credentials: ProviderCredentials;

  constructor(credentials: ProviderCredentials) {
    this.credentials = credentials;
  }

  /**
   * 获取或创建 Provider（核心方法）
   *
   * @param modelConfig - 模型配置
   * @param fallbackProvider - 降级 Provider（如果配置无效）
   * @returns Provider 实例
   */
  getOrCreateProvider(
    modelConfig: ModelConfig,
    fallbackProvider?: ILLMProvider
  ): ILLMProvider {
    try {
      // 1. 解析模型名称（处理别名和前缀）
      const modelName = this.resolveModelName(modelConfig.primary);

      // 2. 检测 Adapter 类型
      const adapter = this.detectAdapter(modelName);

      // 3. 构建缓存键
      const cacheKey = this.buildCacheKey({
        adapter,
        model: modelName,
        temperature: modelConfig.temperature ?? 1.0,
        maxTokens: modelConfig.maxTokens ?? 8000,
      });

      // 4. 检查缓存
      const cached = this.providerCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      // 5. 创建新 Provider
      const provider = this.createProvider(adapter, modelName, modelConfig);

      // 6. 缓存
      this.providerCache.set(cacheKey, provider);

      return provider;
    } catch (error) {
      console.error('Failed to create provider:', error);

      // 降级到 fallbackProvider
      if (fallbackProvider) {
        console.warn('Using fallback provider');
        return fallbackProvider;
      }

      throw error;
    }
  }

  /**
   * 清空缓存（用于测试或重新加载配置）
   */
  clearCache(): void {
    this.providerCache.clear();
  }

  /**
   * 更新凭证
   */
  updateCredentials(credentials: ProviderCredentials): void {
    this.credentials = credentials;
    // 凭证变更时清空缓存，强制重新创建 Provider
    this.clearCache();
  }

  // =============== 私有方法 ===============

  /**
   * 解析模型名称（处理别名）
   *
   * @example
   * '[CC]claude-sonnet-4-5' → 'claude-sonnet-4-5-20250929'
   * 'gpt-4o' → 'gpt-4o'
   */
  private resolveModelName(modelName: string): string {
    // 移除 [CC] 前缀（Claude Code 别名）
    let resolved = modelName.replace(/^\[CC\]/, '');

    // 模型别名映射（可选）
    const aliases: Record<string, string> = {
      'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
      'sonnet-4': 'claude-sonnet-4-5-20250929',
      'haiku-4': 'claude-haiku-4-5-20251001',
      // 可扩展更多别名
    };

    return aliases[resolved] || resolved;
  }

  /**
   * 检测 Adapter 类型
   */
  private detectAdapter(modelName: string): 'anthropic' | 'openai' | 'ollama' {
    if (modelName.includes('claude')) return 'anthropic';
    if (modelName.includes('gpt')) return 'openai';
    if (modelName.includes('o1')) return 'openai';
    if (modelName.includes('ollama') || modelName.includes('llama')) return 'ollama';

    // 默认 Anthropic（可配置）
    return 'anthropic';
  }

  /**
   * 构建缓存键
   */
  private buildCacheKey(key: ProviderCacheKey): string {
    return `${key.adapter}:${key.model}:${key.temperature}:${key.maxTokens}`;
  }

  /**
   * 创建 Provider 实例
   */
  private createProvider(
    adapter: 'anthropic' | 'openai' | 'ollama',
    modelName: string,
    modelConfig: ModelConfig
  ): ILLMProvider {
    const temperature = modelConfig.temperature ?? 1.0;
    const maxTokens = modelConfig.maxTokens ?? 8000;

    switch (adapter) {
      case 'anthropic': {
        if (!this.credentials.anthropicKey) {
          throw new Error('Anthropic API Key not configured');
        }

        return new AnthropicProvider({
          apiKey: this.credentials.anthropicKey,
          model: modelName,
          temperature,
          maxTokens,
          thinking: modelConfig.thinking,
        });
      }

      case 'openai': {
        if (!this.credentials.openaiKey) {
          throw new Error('OpenAI API Key not configured');
        }

        return new OpenAIProvider({
          apiKey: this.credentials.openaiKey,
          model: modelName,
          temperature,
          maxTokens,
        });
      }

      case 'ollama': {
        const OllamaProvider = require('@/core/providers/OllamaProvider').OllamaProvider;
        return new OllamaProvider({
          baseURL: this.credentials.ollamaBaseURL || 'http://localhost:11434',
          model: modelName,
          temperature,
          maxTokens,
        });
      }

      default:
        throw new Error(`Unsupported adapter: ${adapter}`);
    }
  }
}
```

---

### 2. ChatSession 集成

**修改位置**：`src/core/chat/ChatSession.ts`

**变更内容**：

```typescript
import { ProviderManager } from '@/core/providers/ProviderManager';

export class ChatSession {
  // 新增字段
  private providerManager: ProviderManager | null = null;

  async init(config?: AppConfig): Promise<void> {
    // ... 现有初始化代码

    // 🆕 初始化 ProviderManager
    this.providerManager = new ProviderManager({
      anthropicKey: this.config.provider.apiKey,
      openaiKey: process.env.OPENAI_API_KEY,
      ollamaBaseURL: process.env.OLLAMA_BASE_URL,
    });

    // ... 其余初始化
  }

  /**
   * 获取 ProviderManager（供 SubAgentLoop 使用）
   */
  getProviderManager(): ProviderManager | null {
    return this.providerManager;
  }
}
```

---

### 3. SubAgentLoop 集成

**修改位置**：`src/core/agent/SubAgentLoop.ts`

**变更内容**：

```typescript
export async function runSubAgent(
  mainProvider: ILLMProvider,
  lightProvider: ILLMProvider,
  registry: IToolRegistry,
  parentConfig: AgentConfig,
  context: SubAgentContext,
  hookRegistry?: HookRegistry | null,
  memoryStore?: IMemoryStore | null,
  agentRegistry?: AgentRegistry | null,        // 🆕 新增参数
  providerManager?: ProviderManager | null,    // 🆕 新增参数
): Promise<SubAgentResult> {
  // ... 现有代码

  // 🆕 优先使用 Agent 配置的模型
  let provider: ILLMProvider;

  if (agentRegistry && providerManager) {
    try {
      // 1. 从 AgentRegistry 获取 agent 配置
      const agentConfig = agentRegistry.get(context.role);

      if (agentConfig?.model?.primary) {
        // 2. 使用 ProviderManager 创建专属 Provider
        provider = providerManager.getOrCreateProvider(
          agentConfig.model,
          context.useLightModel ? lightProvider : mainProvider  // 降级 Provider
        );

        console.log(`✅ Using dedicated provider for agent "${context.role}": ${agentConfig.model.primary}`);
      } else {
        // Agent 没有配置模型，使用默认逻辑
        provider = context.useLightModel ? lightProvider : mainProvider;
      }
    } catch (error) {
      console.error('Failed to create provider from agent config:', error);
      // 降级到默认逻辑
      provider = context.useLightModel ? lightProvider : mainProvider;
    }
  } else {
    // 没有 AgentRegistry 或 ProviderManager，使用默认逻辑
    provider = context.useLightModel ? lightProvider : mainProvider;
  }

  // 4. 创建子代理 AgentLoop
  const agentLoop = new AgentLoop(
    provider,  // 🔄 使用动态选择的 provider
    filteredRegistry,
    agentConfig,
    memoryStore ?? undefined,
  );

  // ... 其余代码
}
```

---

### 4. TaskTool 集成

**修改位置**：`src/core/tools/TaskTool.ts`

**变更内容**：

```typescript
export class TaskTool implements ITool {
  // 新增字段
  private agentRegistry: AgentRegistry | null = null;
  private providerManager: ProviderManager | null = null;

  setDependencies(deps: {
    provider: ILLMProvider;
    lightProvider: ILLMProvider;
    registry: IToolRegistry;
    agentConfig: AgentConfig;
    hookRegistry?: HookRegistry | null;
    memoryStore?: IMemoryStore | null;
    depth?: number;
    agentRegistry?: AgentRegistry | null;       // 🆕 新增
    providerManager?: ProviderManager | null;   // 🆕 新增
  }): void {
    this.provider = deps.provider;
    this.lightProvider = deps.lightProvider;
    this.registry = deps.registry;
    this.agentConfig = deps.agentConfig;
    this.hookRegistry = deps.hookRegistry ?? null;
    this.memoryStore = deps.memoryStore ?? null;
    this.currentDepth = deps.depth ?? 0;
    this.agentRegistry = deps.agentRegistry ?? null;         // 🆕
    this.providerManager = deps.providerManager ?? null;     // 🆕
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    // ... 现有代码

    // 执行子代理
    const result = await runSubAgent(
      this.provider,
      this.lightProvider,
      this.registry,
      this.agentConfig,
      context,
      this.hookRegistry,
      this.memoryStore,
      this.agentRegistry,       // 🆕 传递
      this.providerManager,     // 🆕 传递
    );

    // ...
  }
}
```

---

## 配置格式扩展

### Agent 配置示例（JSON5）

```json5
// ~/.xuanji/agents/my-coder.json5
{
  id: 'my-coder',
  name: '我的编程助手',
  description: '专注于 Python 编程的助手',

  // 🆕 独立模型配置
  model: {
    primary: 'claude-sonnet-4-5-20250929',      // 主模型
    fallback: 'claude-haiku-4-5-20251001',      // 备用模型（暂不支持）
    temperature: 0.8,                            // 创意度
    maxTokens: 100000,                           // 长上下文
    thinking: {
      type: 'adaptive',                          // Extended Thinking
      effort: 'high',
    }
  },

  // 系统提示词
  systemPrompt: `你是一个 Python 专家...`,

  // 工具列表
  tools: [
    { name: 'read_file', required: true },
    { name: 'write_file', required: true },
    // ...
  ],

  // 其他配置...
}
```

### 全局配置（API Key）

```yaml
# ~/.xuanji/config.yaml

provider:
  # Anthropic 配置
  adapter: anthropic
  apiKey: sk-ant-xxx  # 主 API Key
  model: claude-3-5-sonnet-20241022  # 默认模型（作为降级）

  # 🆕 多 Provider 支持
  credentials:
    anthropic:
      apiKey: sk-ant-xxx
    openai:
      apiKey: sk-xxx
    ollama:
      baseURL: http://localhost:11434
```

---

## 优先级和降级策略

### 配置优先级（从高到低）

1. **Agent 配置** - `~/.xuanji/agents/xxx.json5` 中的 `model` 字段
2. **环境变量** - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
3. **全局配置** - `~/.xuanji/config.yaml` 中的 `provider` 字段

### 降级策略

```typescript
// 伪代码
try {
  // 1. 尝试使用 Agent 配置
  provider = providerManager.getOrCreateProvider(agentConfig.model);
} catch (error1) {
  try {
    // 2. 降级到 useLightModel 逻辑
    provider = useLightModel ? lightProvider : mainProvider;
  } catch (error2) {
    // 3. 最终降级到主 Provider
    provider = mainProvider;
  }
}
```

---

## 性能优化

### 1. Provider 缓存

**缓存键**：`${adapter}:${model}:${temperature}:${maxTokens}`

**示例**：
- `anthropic:claude-sonnet-4-5-20250929:0.8:100000`
- `openai:gpt-4o:0.7:8000`

**缓存命中率**：
- 相同配置的 Agent 共享 Provider 实例
- 避免重复创建 HTTP 客户端

### 2. 懒加载

- Provider 只在第一次使用时创建
- 不使用的模型不会创建 Provider

### 3. 内存管理

- 缓存池大小限制（可选）
- LRU 淘汰策略（可选）

---

## 实施步骤

### 阶段 2.1：基础实现（核心功能）

**预计时间**：4-6 小时

1. ✅ 创建 `ProviderManager.ts`（核心逻辑）
2. ✅ 修改 `ChatSession.ts`（初始化 ProviderManager）
3. ✅ 修改 `SubAgentLoop.ts`（使用 Agent 配置）
4. ✅ 修改 `TaskTool.ts`（传递依赖）
5. ✅ 测试：创建自定义 Agent → 验证使用了正确的模型

### 阶段 2.2：错误处理和降级（健壮性）

**预计时间**：2-3 小时

1. ✅ 添加详细错误日志
2. ✅ 实现降级策略（Agent 配置失败 → 使用默认 Provider）
3. ✅ 处理 API Key 缺失的情况
4. ✅ 测试：各种错误场景

### 阶段 2.3：多 Provider 支持（可选）

**预计时间**：2-3 小时

1. ✅ 全局配置扩展（支持多个 API Key）
2. ✅ ProviderManager 支持多凭证
3. ✅ 测试：同一会话中使用 Claude + GPT-4

### 阶段 2.4：优化和监控（可选）

**预计时间**：2-3 小时

1. ✅ 缓存命中率监控
2. ✅ Provider 使用统计
3. ✅ GUI 显示实际使用的模型（运行时）

---

## 向后兼容性

### 1. 现有 Agent 无配置

- ✅ 降级到 `useLightModel` 逻辑
- ✅ 行为与之前完全一致

### 2. 内置 Agent

- ✅ 可以在配置文件中指定模型（如 `xuanji.json5`）
- ✅ 也可以不配置，使用默认 Provider

### 3. 全局配置

- ✅ 仍然作为降级选项
- ✅ 不影响现有配置文件

---

## 安全性考虑

### 1. API Key 管理

**问题**：Agent 配置中不应存储 API Key

**方案**：
- ✅ API Key 只存储在全局配置（`~/.xuanji/config.yaml`）
- ✅ Agent 配置只引用模型名称
- ✅ ProviderManager 从全局配置读取凭证

### 2. 模型切换攻击

**问题**：恶意 Agent 配置可能指定高成本模型

**方案**：
- ✅ 模型白名单（可选）
- ✅ 成本限制（可选）
- ✅ 审计日志（记录每次模型切换）

---

## 测试计划

### 单元测试

```typescript
// tests/ProviderManager.test.ts

describe('ProviderManager', () => {
  it('should create Anthropic provider for Claude models', () => {
    const manager = new ProviderManager({ anthropicKey: 'sk-xxx' });
    const provider = manager.getOrCreateProvider({
      primary: 'claude-sonnet-4-5-20250929',
      temperature: 0.8,
      maxTokens: 100000,
    });
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it('should cache providers with same config', () => {
    const manager = new ProviderManager({ anthropicKey: 'sk-xxx' });
    const config = { primary: 'claude-sonnet-4-5-20250929' };
    const p1 = manager.getOrCreateProvider(config);
    const p2 = manager.getOrCreateProvider(config);
    expect(p1).toBe(p2);  // 同一实例
  });

  it('should fallback to default provider on error', () => {
    const manager = new ProviderManager({});  // 无 API Key
    const fallback = new MockProvider();
    const provider = manager.getOrCreateProvider(
      { primary: 'claude-xxx' },
      fallback
    );
    expect(provider).toBe(fallback);
  });
});
```

### 集成测试

```typescript
// tests/integration/AgentModelConfig.test.ts

describe('Agent Model Config Integration', () => {
  it('should use agent-specific model', async () => {
    // 1. 创建自定义 Agent 配置
    const agentConfig = {
      id: 'test-agent',
      model: { primary: 'claude-haiku-4-5-20251001' },
      // ...
    };
    await agentRegistry.saveToFile(agentConfig, 'global');

    // 2. 调用 SubAgent
    const result = await runSubAgent(/* ... */, {
      role: 'test-agent',
      // ...
    });

    // 3. 验证使用了正确的模型
    expect(result.modelUsed).toBe('claude-haiku-4-5-20251001');
  });
});
```

---

## 总结

### 核心改动点（5 个文件）

1. **新增** `src/core/providers/ProviderManager.ts` - Provider 工厂 + 缓存池
2. **修改** `src/core/chat/ChatSession.ts` - 初始化 ProviderManager
3. **修改** `src/core/agent/SubAgentLoop.ts` - 使用 Agent 配置创建 Provider
4. **修改** `src/core/tools/TaskTool.ts` - 传递 AgentRegistry 和 ProviderManager
5. **扩展** 全局配置格式（支持多 API Key）

### 关键设计原则

✅ **缓存优先** - 相同配置的 Agent 共享 Provider 实例
✅ **降级策略** - 配置失败时自动降级到默认 Provider
✅ **向后兼容** - 不影响现有代码和配置
✅ **安全第一** - API Key 集中管理，不存储在 Agent 配置中
✅ **渐进式** - 可以分阶段实施，每个阶段独立可测

### 预计开发时间

- **阶段 2.1**（核心功能）：4-6 小时
- **阶段 2.2**（错误处理）：2-3 小时
- **阶段 2.3**（多 Provider）：2-3 小时
- **阶段 2.4**（优化监控）：2-3 小时
- **总计**：10-15 小时

---

**需要我现在开始实施阶段 2.1 吗？**
