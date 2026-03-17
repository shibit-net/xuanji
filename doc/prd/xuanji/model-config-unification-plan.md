# 模型配置统一管理方案

**创建日期**：2026-03-15
**问题**：运行时模型选择配置分散，难以管理
**目标**：统一所有模型配置，简化架构

---

## 当前问题分析

### 配置分散度统计

**关键字统计**：
- `mainProvider/lightProvider` 在 **34 个文件**中出现 **269 次**
- 涉及配置层、工具层、Agent 层、SubAgent 层

### 配置分布

#### 1. 全局配置（`~/.xuanji/config.json`）

```json
{
  "config": {
    "provider": {
      "model": "[CC]claude-sonnet-4-5-20250929",      // 主模型
      "lightModel": "[CC]claude-haiku-4-5-20251001"   // 轻量模型
    }
  }
}
```

**用途**：
- 创建 mainProvider 和 lightProvider 实例
- 作为默认模型配置

---

#### 2. AgentRegistry 配置（`builtin/*.json5`）

```json5
// coder.json5
{
  id: 'coder',
  model: {
    primary: '[CC]claude-opus-4-6',        // 编程需要复杂推理
    fallback: '[CC]claude-sonnet-4-5-20250929',
    maxTokens: 32000,
  }
}

// explore.json5
{
  id: 'explore',
  model: {
    primary: '[CC]claude-haiku-4-5-20251001',  // 快速探索
    fallback: '[CC]claude-haiku-4-5-20251001',
    maxTokens: 16000,
  }
}
```

**用途**：
- 每个 Agent 配置自己的模型
- **问题**：这些配置**当前未被使用**（除了 intent-analyzer 和 context-compressor）

---

#### 3. SubAgent 运行时选择（`SubAgentContext.ts`）

```typescript
class SubAgentContext {
  readonly useLightModel: boolean;

  constructor(options: SubAgentOptions) {
    // 根据 role 推断使用轻量模型还是主模型
    this.useLightModel = options.useLightModel
      ?? SubAgentContext.inferUseLightModel(this.role);
  }

  private static inferUseLightModel(role: AgentRoleType): boolean {
    return role === 'explore';  // 只有 explore 用 lightModel
  }
}
```

```typescript
// SubAgentLoop.ts
export async function runSubAgent(
  mainProvider: ILLMProvider,
  lightProvider: ILLMProvider,
  // ...
) {
  // 运行时选择 provider
  const provider = context.useLightModel ? lightProvider : mainProvider;

  const agentLoop = new AgentLoop(
    provider,  // 动态选择的 provider
    // ...
  );
}
```

**用途**：
- SubAgent 根据 role 动态选择使用哪个 provider
- explore → lightProvider (Haiku)
- 其他 → mainProvider (Sonnet)

**问题**：
- 硬编码逻辑（只有 explore 用 lightModel）
- 与 AgentRegistry 配置重复

---

#### 4. Provider 创建（`SessionInitializer.ts`）

```typescript
private initProvider(config: AppConfig): {
  provider: ILLMProvider;
  lightProvider: ILLMProvider;
} {
  const providerFactory = new ProviderFactory();

  // 创建主 provider
  const provider = providerFactory.getByModel(config.provider.model);

  // 创建轻量 provider
  let lightProvider: ILLMProvider;
  if (config.provider.lightModel) {
    lightProvider = providerFactory.getByModel(config.provider.lightModel);
  } else {
    lightProvider = provider;  // 降级到主 provider
  }

  return { provider, lightProvider };
}
```

**问题**：
- 只创建两个 provider 实例（mainProvider, lightProvider）
- 无法根据 Agent 配置创建特定 provider

---

### 配置流转关系

```
全局配置 (config.json)
    ↓
SessionInitializer.initProvider()
    ↓
创建 mainProvider (Sonnet)
创建 lightProvider (Haiku)
    ↓
传递给所有工具和 Agent
    ↓
SubAgent 运行时选择
    useLightModel ? lightProvider : mainProvider
```

**问题**：
- AgentRegistry 的 model 配置被忽略
- 只有两个 provider 实例，无法满足多样化需求
- coder 想用 Opus，但只能用 mainProvider (Sonnet)

---

## 核心问题

### 1. 配置层次混乱

| 配置层 | 当前状态 | 问题 |
|--------|---------|------|
| **全局配置** | model + lightModel | 只支持两个固定模型 |
| **Agent 配置** | 每个 Agent 有 model | **未被使用** |
| **运行时选择** | useLightModel | 硬编码逻辑 |

### 2. AgentRegistry 配置被浪费

```json5
// coder.json5 配置了 Opus
{
  model: {
    primary: '[CC]claude-opus-4-6',
  }
}

// 但实际运行时
runSubAgent(
  mainProvider,  // Sonnet（从全局配置）
  lightProvider, // Haiku（从全局配置）
  // ❌ 完全没有用到 coder.json5 的 Opus 配置
)
```

### 3. 扩展性差

**场景**：想添加一个新 Agent 使用 GPT-4
- ❌ 无法配置：只能用 mainProvider 或 lightProvider
- ❌ 必须改代码：添加第三个 provider？
- ❌ 配置分散：需要修改多处

---

## 统一管理方案

### 核心思路

**配置优先级**（从高到低）：
```
运行时参数 > Agent 配置 > 全局默认配置
```

**Provider 创建策略**：
```
按需创建 Provider（根据 Agent 配置）
而不是预先创建 mainProvider/lightProvider
```

---

### 方案设计

#### Phase 1：AgentRegistry 作为模型配置中心

**核心改动**：
1. 移除 `mainProvider/lightProvider` 概念
2. 所有 Agent 从 AgentRegistry 获取 model 配置
3. 运行时按需创建 Provider

**配置流转**：
```
全局配置 (config.json)
    ↓
默认模型：[CC]claude-sonnet-4-5-20250929
默认轻量模型：[CC]claude-haiku-4-5-20251001
    ↓
AgentRegistry (builtin/*.json5)
    ├── coder: primary=[CC]claude-opus-4-6
    ├── explore: primary=[CC]claude-haiku-4-5-20251001
    ├── plan: primary=[CC]claude-opus-4-6
    └── general-purpose: primary=[CC]claude-sonnet-4-5-20250929
    ↓
运行时 ProviderManager
    ├── 读取 Agent 配置的 model.primary
    ├── 降级到 model.fallback
    ├── 降级到全局默认 model
    ├── 按需创建 Provider（带缓存）
    └── 返回 Provider 实例
```

---

#### 实现细节

##### 1. 新增 ProviderManager

**文件**：`src/core/providers/ProviderManager.ts`

```typescript
/**
 * Provider 管理器
 *
 * 职责：
 * 1. 根据 Agent 配置按需创建 Provider
 * 2. 缓存 Provider 实例（避免重复创建）
 * 3. 处理降级策略
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
   * 优先级：
   * 1. agentConfig.model.primary
   * 2. agentConfig.model.fallback
   * 3. globalConfig.provider.model（默认）
   */
  getProvider(agentConfig?: ConfigurableAgentConfig): ILLMProvider {
    const modelName = this.resolveModelName(agentConfig);

    // 从缓存获取
    if (this.providerCache.has(modelName)) {
      return this.providerCache.get(modelName)!;
    }

    // 创建新 provider
    const provider = this.providerFactory.getByModel(modelName);
    if (!provider) {
      throw new Error(`Unsupported model: ${modelName}`);
    }

    // 缓存
    this.providerCache.set(modelName, provider);
    return provider;
  }

  /**
   * 解析模型名称（带降级）
   */
  private resolveModelName(agentConfig?: ConfigurableAgentConfig): string {
    // 1. Agent 配置的 primary
    if (agentConfig?.model?.primary) {
      return agentConfig.model.primary;
    }

    // 2. Agent 配置的 fallback
    if (agentConfig?.model?.fallback) {
      return agentConfig.model.fallback;
    }

    // 3. 全局默认 model
    return this.globalConfig.provider.model;
  }

  /**
   * 获取轻量模型 Provider
   *
   * 用于向后兼容（逐步迁移期间）
   */
  getLightProvider(): ILLMProvider {
    const lightModel = this.globalConfig.provider.lightModel
      || this.globalConfig.provider.model;

    if (this.providerCache.has(lightModel)) {
      return this.providerCache.get(lightModel)!;
    }

    const provider = this.providerFactory.getByModel(lightModel);
    if (!provider) {
      throw new Error(`Unsupported light model: ${lightModel}`);
    }

    this.providerCache.set(lightModel, provider);
    return provider;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.providerCache.clear();
  }
}
```

---

##### 2. 修改 SubAgentLoop

**文件**：`src/core/agent/SubAgentLoop.ts`

```typescript
/**
 * 启动子代理并等待结果
 *
 * ✅ 优化：使用 AgentRegistry 配置 + ProviderManager
 */
export async function runSubAgent(
  providerManager: ProviderManager,  // ← 改为 ProviderManager
  agentRegistry: AgentRegistry,      // ← 新增 AgentRegistry
  registry: IToolRegistry,
  parentConfig: AgentConfig,
  context: SubAgentContext,
  hookRegistry?: HookRegistry | null,
  memoryStore?: IMemoryStore | null,
): Promise<SubAgentResult> {
  // ...

  // 1. 从 AgentRegistry 获取 Agent 配置
  const agentProfile = agentRegistry.get(context.role);
  if (!agentProfile || !agentProfile.metadata?.isSubAgent) {
    throw new Error(`Invalid SubAgent role: ${context.role}`);
  }

  // 2. 构建 Agent 配置（使用 AgentRegistry 配置）
  const agentConfig = {
    systemPrompt: agentProfile.systemPrompt,
    maxIterations: agentProfile.execution.maxIterations,
    // ... 其他配置
  };

  // 3. 创建过滤后的工具注册表（使用 AgentRegistry 的工具列表）
  const allowedTools = agentProfile.tools.map(t => t.name);
  const filteredRegistry = new ToolRegistrySubset(registry, allowedTools);

  // 4. 根据 Agent 配置获取 Provider（自动处理降级）
  const provider = providerManager.getProvider(agentProfile);

  // 5. 创建子代理 AgentLoop
  const agentLoop = new AgentLoop(
    provider,  // ← 根据 Agent 配置动态选择
    filteredRegistry,
    agentConfig,
    memoryStore,
  );

  // ...
}
```

**关键改动**：
- ❌ 移除 `mainProvider` 和 `lightProvider` 参数
- ✅ 新增 `providerManager` 和 `agentRegistry` 参数
- ✅ 从 AgentRegistry 获取完整配置（systemPrompt, tools, model）
- ✅ 使用 ProviderManager 根据 model 配置创建 Provider

---

##### 3. 修改工具的 setDependencies

**所有 Multi-Agent 工具**：ChainTool, TeamTool, TaskTool, QuickTeamTool

```typescript
export class TaskTool extends BaseTool {
  // ❌ 移除
  // private provider: ILLMProvider | null = null;
  // private lightProvider: ILLMProvider | null = null;

  // ✅ 新增
  private providerManager: ProviderManager | null = null;
  private agentRegistry: AgentRegistry | null = null;
  private registry: IToolRegistry | null = null;
  private agentConfig: AgentConfig | null = null;
  private hookRegistry: HookRegistry | null = null;
  private memoryStore: IMemoryStore | null = null;

  setDependencies(deps: {
    providerManager: ProviderManager;   // ← 改为 ProviderManager
    agentRegistry: AgentRegistry;       // ← 新增
    registry: IToolRegistry;
    agentConfig: AgentConfig;
    hookRegistry?: HookRegistry | null;
    memoryStore?: IMemoryStore | null;
  }): void {
    this.providerManager = deps.providerManager;
    this.agentRegistry = deps.agentRegistry;
    this.registry = deps.registry;
    this.agentConfig = deps.agentConfig;
    this.hookRegistry = deps.hookRegistry ?? null;
    this.memoryStore = deps.memoryStore ?? null;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    // 验证依赖
    if (!this.providerManager || !this.agentRegistry || !this.registry) {
      return this.error('TaskTool not initialized.');
    }

    // 执行子代理
    const result = await runSubAgent(
      this.providerManager,  // ← 传递 ProviderManager
      this.agentRegistry,    // ← 传递 AgentRegistry
      this.registry,
      this.agentConfig,
      context,
      this.hookRegistry,
      this.memoryStore,
    );

    return this.formatResult(result);
  }
}
```

**同样的改动应用到**：
- ChainTool
- TeamTool
- QuickTeamTool
- TeamManager
- Executor

---

##### 4. 修改 SessionInitializer

**文件**：`src/core/chat/SessionInitializer.ts`

```typescript
export interface InitResult {
  config: AppConfig;
  providerManager: ProviderManager;  // ← 替换 provider, lightProvider
  baseRegistry: ToolRegistry;
  registry: IToolRegistry;
  // ...
}

export class SessionInitializer {
  async initialize(): Promise<InitResult> {
    // 1. 加载配置
    const config = await this.initConfig();

    // 2. 初始化 ProviderManager（替换 initProvider）
    const providerManager = new ProviderManager(config);

    // 3. 初始化工具注册表
    const { baseRegistry, registry, permissionController, ignoreFilterPromise } =
      this.initToolRegistry(config);

    // ...

    return {
      config,
      providerManager,  // ← 返回 ProviderManager
      baseRegistry,
      registry,
      // ...
    };
  }

  // ❌ 移除 initProvider() 方法
  // private initProvider(config: AppConfig): { provider, lightProvider } { ... }
}
```

---

##### 5. 修改 ChatSession

**文件**：`src/core/chat/ChatSession.ts`

```typescript
export class ChatSession {
  private providerManager: ProviderManager;  // ← 替换 provider, lightProvider
  private agentRegistry: AgentRegistry;

  async init(options: ChatSessionInitOptions = {}): Promise<void> {
    // ...
    const initResult = await initializer.initialize();

    this.providerManager = initResult.providerManager;
    this.agentRegistry = this.getAgentRegistry();

    // 初始化 AgentLoop（使用主 Agent 配置）
    const mainAgentProfile = this.agentRegistry.get('xuanji');
    const mainProvider = this.providerManager.getProvider(mainAgentProfile);

    this.agentLoop = new AgentLoop(
      mainProvider,  // ← 从 ProviderManager 获取
      initResult.registry,
      this.config,
      initResult.memoryManager ?? undefined,
    );

    // 注入 Multi-Agent 工具依赖
    this.taskTool.setDependencies({
      providerManager: this.providerManager,  // ← 传递 ProviderManager
      agentRegistry: this.agentRegistry,      // ← 传递 AgentRegistry
      registry: initResult.registry,
      agentConfig: this.config,
      hookRegistry: this.hookRegistry,
      memoryStore: this.memoryManager,
    });

    // 同样更新 teamTool, chainTool, quickTeamTool
    // ...
  }
}
```

---

### 配置层次清晰化

#### 统一后的配置流转

```
1. 全局配置（默认值）
   ~/.xuanji/config.json
   ├── provider.model: "[CC]claude-sonnet-4-5-20250929"
   └── provider.lightModel: "[CC]claude-haiku-4-5-20251001"

2. Agent 配置（专业化）
   builtin/*.json5
   ├── xuanji.model.primary: Sonnet
   ├── coder.model.primary: Opus
   ├── explore.model.primary: Haiku
   ├── plan.model.primary: Opus
   └── general-purpose.model.primary: Sonnet

3. 运行时解析
   ProviderManager.getProvider(agentConfig)
   ├── agentConfig.model.primary → Provider
   ├── agentConfig.model.fallback → Provider（降级 1）
   └── globalConfig.provider.model → Provider（降级 2）
```

#### 示例流程

**场景 1**：coder SubAgent 执行编程任务

```typescript
// 1. TaskTool 被调用
{
  "name": "task",
  "input": {
    "description": "Implement user authentication",
    "subagent_type": "coder"
  }
}

// 2. 创建 SubAgentContext
const context = new SubAgentContext({
  task: "Implement user authentication",
  role: 'coder',
});

// 3. runSubAgent 获取配置
const agentProfile = agentRegistry.get('coder');
// agentProfile.model.primary = '[CC]claude-opus-4-6'

// 4. ProviderManager 创建 Provider
const provider = providerManager.getProvider(agentProfile);
// provider = AnthropicProvider('[CC]claude-opus-4-6')

// 5. AgentLoop 使用 Opus 模型
const agentLoop = new AgentLoop(provider, ...);

// ✅ 结果：coder 使用 Opus（符合配置）
```

**场景 2**：explore SubAgent 快速探索

```typescript
// 1. TaskTool 被调用
{
  "name": "task",
  "input": {
    "description": "List all TypeScript files",
    "subagent_type": "explore"
  }
}

// 2. SubAgentContext
const context = new SubAgentContext({
  task: "List all TypeScript files",
  role: 'explore',
});

// 3. 获取配置
const agentProfile = agentRegistry.get('explore');
// agentProfile.model.primary = '[CC]claude-haiku-4-5-20251001'

// 4. 创建 Provider
const provider = providerManager.getProvider(agentProfile);
// provider = AnthropicProvider('[CC]claude-haiku-4-5-20251001')

// ✅ 结果：explore 使用 Haiku（符合配置）
```

---

## 优势对比

### 优化前（当前）

```typescript
// 配置分散
config.json: { model: "Sonnet", lightModel: "Haiku" }
coder.json5: { model: { primary: "Opus" } }  ← 未使用
explore.json5: { model: { primary: "Haiku" } }  ← 未使用

// Provider 创建
SessionInitializer:
  mainProvider = Sonnet
  lightProvider = Haiku

// SubAgent 选择
runSubAgent(mainProvider, lightProvider):
  provider = useLightModel ? lightProvider : mainProvider
  // ❌ coder 想用 Opus，实际用 mainProvider (Sonnet)
```

**问题**：
- ❌ AgentRegistry 配置被浪费
- ❌ 只有两个固定 provider
- ❌ 无法按 Agent 配置选择模型

---

### 优化后

```typescript
// 配置统一
config.json: { model: "Sonnet", lightModel: "Haiku" }  ← 默认值
coder.json5: { model: { primary: "Opus" } }  ← 使用！
explore.json5: { model: { primary: "Haiku" } }  ← 使用！

// ProviderManager 按需创建
ProviderManager:
  providerCache = {
    "Opus": OpusProvider,
    "Sonnet": SonnetProvider,
    "Haiku": HaikuProvider,
  }

// SubAgent 从配置获取
runSubAgent(providerManager, agentRegistry):
  agentProfile = agentRegistry.get(context.role)
  provider = providerManager.getProvider(agentProfile)
  // ✅ coder 用 Opus，explore 用 Haiku
```

**优势**：
- ✅ 配置统一管理（AgentRegistry 作为单一配置源）
- ✅ 按需创建 Provider（支持任意数量模型）
- ✅ 自动降级策略（primary → fallback → global）
- ✅ Provider 缓存（避免重复创建）

---

## 向后兼容性

### 迁移期间

**保留 getLightProvider() 方法**：

```typescript
class ProviderManager {
  /**
   * 获取轻量模型 Provider（向后兼容）
   *
   * 用于迁移期间，逐步替换 lightProvider
   */
  getLightProvider(): ILLMProvider {
    const lightModel = this.globalConfig.provider.lightModel
      || this.globalConfig.provider.model;
    return this.getProviderByModel(lightModel);
  }
}
```

**IntentAnalyzer 和 ContextCompressor**：
- 继续使用 AgentExecutor（已经迁移）
- 不受影响

---

## 实施计划

### Phase 1：创建 ProviderManager ✅

**文件**：
- `src/core/providers/ProviderManager.ts`（新增）

**测试**：
- `test/unit/providers/ProviderManager.test.ts`（新增）

**验证**：
- Provider 按需创建
- 缓存机制正常
- 降级策略正确

---

### Phase 2：集成 ProviderManager 到 SubAgentLoop ✅

**修改文件**：
- `src/core/agent/SubAgentLoop.ts`
  - 修改 `runSubAgent()` 签名
  - 使用 AgentRegistry 配置
  - 使用 ProviderManager 创建 Provider

**修改文件**：
- `src/core/tools/TaskTool.ts`
- `src/core/tools/ChainTool.ts`
- `src/core/tools/TeamTool.ts`
- `src/core/tools/QuickTeamTool.ts`
- `src/core/agent/team/TeamManager.ts`
- `src/core/executor/Executor.ts`

**测试**：
- SubAgent 使用正确的模型
- coder → Opus
- explore → Haiku
- general-purpose → Sonnet

---

### Phase 3：更新 SessionInitializer 和 ChatSession ✅

**修改文件**：
- `src/core/chat/SessionInitializer.ts`
  - 移除 `initProvider()`
  - 新增 ProviderManager 初始化

- `src/core/chat/ChatSession.ts`
  - 替换 `provider/lightProvider` 为 `providerManager`
  - 更新所有工具的 `setDependencies()` 调用

**测试**：
- 主 Agent 正常运行
- 所有 Multi-Agent 工具正常
- 降级策略正确

---

### Phase 4：清理遗留代码 ✅

**删除**：
- `mainProvider` 和 `lightProvider` 字段（34 个文件）
- `useLightModel` 相关逻辑（SubAgentContext）

**保留**：
- `config.provider.lightModel`（向后兼容）
- `ProviderManager.getLightProvider()`（迁移期间）

---

## 文档更新

### 需要更新的文档

1. **架构文档**
   - `docs/user-guide/architecture.md`
   - `docs/subagent-and-team-architecture.md`
   - `doc/tad/xuanji/01-p0-architecture.md`

2. **配置指南**
   - `docs/LIGHT_MODEL_GUIDE.md`
   - 新增：`docs/PROVIDER_MANAGER_GUIDE.md`

3. **PRD 文档**
   - 更新所有提到 mainProvider/lightProvider 的文档

---

## 总结

### 核心改进

| 维度 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| **配置统一性** | 分散（3 处） | 统一（AgentRegistry） | ⬆️⬆️⬆️ |
| **配置利用率** | 50%（2/4 Agent 配置被使用） | 100%（所有配置被使用） | ⬆️⬆️⬆️ |
| **模型灵活性** | 固定 2 个 | 任意数量 | ⬆️⬆️⬆️ |
| **可维护性** | 低（改配置需改多处） | 高（改 JSON5 即可） | ⬆️⬆️⬆️ |
| **可扩展性** | 低（新模型需改代码） | 高（配置即可） | ⬆️⬆️⬆️ |

### 关键价值

✅ **配置统一**：所有模型配置在 AgentRegistry 中管理
✅ **按需创建**：Provider 根据 Agent 配置动态创建
✅ **自动降级**：primary → fallback → global
✅ **缓存优化**：避免重复创建 Provider
✅ **向后兼容**：渐进式迁移，保留降级路径

---

**创建日期**：2026-03-15
**状态**：✅ 设计完成，待实施
**下一步**：实施 Phase 1 - 创建 ProviderManager
