# Compressor Agent 架构迁移总结 - Phase 2

## 实施时间
2026-03-15

## 背景

继 Phase 1（IntentAnalyzer Agent）之后，Phase 2 将 ContextCompressor 从使用 `lightProvider` 迁移到调用独立的 **ContextCompressor Agent**，进一步推进架构升级。

## 实施内容

### 1. 创建 ContextCompressor Agent 配置

**文件**: `src/core/agent/builtin/context-compressor.json5`

**配置要点**:
```json5
{
  id: 'context-compressor',
  name: '上下文压缩器',

  model: {
    primary: '[CC]claude-haiku-4-5-20251001',  // 使用 Haiku（轻量、快速、低成本）
    maxTokens: 1500,  // 摘要输出中等长度
  },

  systemPrompt: `你是一个对话历史压缩专家...`,  // 内置 prompt

  execution: {
    maxIterations: 1,  // 单次调用即可
    timeout: 15000,    // 15 秒超时
  },

  metadata: {
    internal: true,  // 内部系统 Agent
  },
}
```

### 2. 修改 ContextCompressor 类

**文件**: `src/core/agent/ContextCompressor.ts`

**变更前**:
```typescript
export class ContextCompressor {
  private provider: ILLMProvider | null = null;
  private providerConfig: ProviderConfig | null = null;

  setProvider(provider: ILLMProvider, config: ProviderConfig): void {
    this.provider = provider;
    this.providerConfig = config;
  }

  private async buildSummaryWithLLM(...) {
    // 直接调用 provider.stream()
    const stream = this.provider!.stream(messages, [], {
      model: this.providerConfig!.lightModel ?? this.providerConfig!.model,
      ...
    });
  }
}
```

**变更后**:
```typescript
export class ContextCompressor {
  private static readonly AGENT_ID = 'context-compressor';

  private agentRegistry: AgentRegistry | null = null;
  private providerConfig: ProviderConfig | null = null;

  setAgentRegistry(agentRegistry: AgentRegistry, config: ProviderConfig): void {
    this.agentRegistry = agentRegistry;
    this.providerConfig = config;
  }

  private async buildSummaryWithLLM(...) {
    // 获取 ContextCompressor Agent 配置
    const agentConfig = this.agentRegistry!.get(AGENT_ID);

    // 使用 AgentExecutor 执行 Agent
    const result = await AgentExecutor.execute(agentConfig, {
      userMessage: prompt,
      apiKey: this.providerConfig!.apiKey,
      baseURL: this.providerConfig!.baseURL,
    });

    return result.content;
  }
}
```

**关键变化**:
- 移除 `provider` 字段，添加 `agentRegistry` 字段
- `setProvider()` 改为 `setAgentRegistry()`
- `buildSummaryWithLLM()` 改为调用 `AgentExecutor.execute()`
- 保持降级策略（Agent 不可用时降级到规则压缩）

### 3. 修改 AgentLoop

**文件**: `src/core/agent/AgentLoop.ts`

**添加 AgentRegistry 支持**:
```typescript
export class AgentLoop {
  private agentRegistry: AgentRegistry | null = null;

  constructor(...) {
    this.contextCompressor = new ContextCompressor(config.compressor);
    // 注意：ContextCompressor 的 LLM 压缩功能通过 setAgentRegistry() 启用
  }

  /**
   * 注入 AgentRegistry（启用 ContextCompressor Agent）
   */
  setAgentRegistry(agentRegistry: AgentRegistry): void {
    this.agentRegistry = agentRegistry;
    // 传递给 ContextCompressor 以启用 LLM 语义压缩
    this.contextCompressor.setAgentRegistry(agentRegistry, {
      model: this.config.model,
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
    });
  }
}
```

**关键变化**:
- 移除构造函数中的 `contextCompressor.setProvider()` 调用
- 添加 `setAgentRegistry()` 方法（类似 `setHookRegistry()`）
- 在方法内部调用 `contextCompressor.setAgentRegistry()`

### 4. 修改 SessionInitializer

**文件**: `src/core/chat/SessionInitializer.ts`

**添加 agentRegistry 参数**:
```typescript
createAgentLoop(
  provider: ILLMProvider,
  registry: IToolRegistry,
  config: AppConfig,
  systemPrompt: string | undefined,
  memoryManager: IMemoryStore | null,
  agentRegistry: AgentRegistry | null = null,  // 新增参数
): AgentLoop {
  const agentLoop = new AgentLoop(...);

  // 设置 AgentRegistry（启用 ContextCompressor Agent）
  if (agentRegistry) {
    agentLoop.setAgentRegistry(agentRegistry);
  }

  return agentLoop;
}
```

### 5. 修改 ChatSession

**文件**: `src/core/chat/ChatSession.ts`

**传递 agentRegistry**:
```typescript
// 创建 AgentLoop
this.agentLoop = initializer.createAgentLoop(
  this.provider!,
  this.registry!,
  this.config,
  systemPrompt,
  this.memoryManager,
  this.agentRegistry, // 传递 AgentRegistry 以启用 ContextCompressor Agent
);
```

## 架构对比

### 变更前（lightProvider 架构）

```
AgentLoop 构造函数
  ↓
创建 ContextCompressor
  ↓
调用 contextCompressor.setProvider(lightProvider, config)
  ↓
上下文压缩触发
  ↓
contextCompressor.buildSummaryWithLLM()
  ↓
lightProvider.stream(messages, [], config)
  ↓
Haiku 模型（全局统一配置）
  ↓
收集流式结果
  ↓
返回摘要文本
```

### 变更后（Agent 架构）

```
ChatSession.init()
  ↓
创建 AgentLoop
  ↓
调用 agentLoop.setAgentRegistry(agentRegistry)
  ↓
调用 contextCompressor.setAgentRegistry(agentRegistry, config)
  ↓
上下文压缩触发
  ↓
contextCompressor.buildSummaryWithLLM()
  ↓
获取 ContextCompressor Agent 配置
  ↓
AgentExecutor.execute(agentConfig, options)
  ↓
创建 Provider（根据 Agent 配置）
  ↓
创建 AgentLoop
  ↓
执行单次推理
  ↓
收集输出
  ↓
返回摘要文本
```

## 向后兼容

✅ **完全兼容**:
- 如果 AgentRegistry 未初始化 → 降级到规则压缩
- 如果 ContextCompressor Agent 未启用 → 降级到规则压缩
- 降级策略保持不变

## 类型安全

✅ **所有类型检查通过**:
- ContextCompressor.ts: ✅
- AgentLoop.ts: ✅
- SessionInitializer.ts: ✅
- ChatSession.ts: ✅

## lightProvider 使用场景统计

| 场景 | 状态 | 备注 |
|------|------|------|
| IntentRouter（意图分类） | ✅ 已迁移 | Phase 1: IntentAnalyzer Agent |
| ContextCompressor（上下文压缩） | ✅ 已迁移 | Phase 2: ContextCompressor Agent |
| SubAgent（子代理） | ✅ 无需迁移 | 已使用独立 Agent 配置 |
| Executor（任务执行器） | ✅ 无需迁移 | 已使用独立 Agent 配置 |
| ChainTool（多代理工具） | ✅ 无需迁移 | 已使用独立 Agent 配置 |

**结论**: 所有实际使用 lightProvider 的场景都已迁移完成！

## Phase 3: 移除 lightProvider（可选）

现在 lightProvider 只在代码中保留但未实际使用，可以考虑完全移除：

**待移除文件/代码**:
- `src/core/chat/SessionInitializer.ts` - `lightProvider` 字段和创建逻辑
- `src/core/chat/ChatSession.ts` - `lightProvider` 字段
- `src/core/config/defaults.ts` - `lightModel` 配置（可选保留）
- `src/core/config/config.schema.json` - `lightModel` 定义（可选保留）

**建议**: 保留 lightModel 配置作为向后兼容，移除 lightProvider 实例创建。

## 文件变更清单

### 新增文件
- ✅ `src/core/agent/builtin/context-compressor.json5` - ContextCompressor Agent 配置

### 修改文件
- ✅ `src/core/agent/ContextCompressor.ts` - 改为调用 Agent
- ✅ `src/core/agent/AgentLoop.ts` - 添加 setAgentRegistry 方法
- ✅ `src/core/chat/SessionInitializer.ts` - createAgentLoop 添加 agentRegistry 参数
- ✅ `src/core/chat/ChatSession.ts` - 传递 agentRegistry

## 总结

### Phase 2 成功完成
- ✅ ContextCompressor Agent 配置创建
- ✅ ContextCompressor 改造完成
- ✅ AgentLoop 改造完成
- ✅ SessionInitializer 改造完成
- ✅ ChatSession 集成完成
- ✅ 所有类型检查通过
- ✅ 向后兼容性保持

### 核心价值
1. **架构统一**: 所有 LLM 调用都通过 Agent 架构
2. **配置灵活**: 每个 Agent 独立配置模型和参数
3. **职责明确**: ContextCompressor 作为独立的专家 Agent
4. **易于维护**: 配置化而非硬编码

### lightProvider 迁移进度

| Phase | 状态 | 完成度 |
|-------|------|--------|
| Phase 1: IntentAnalyzer Agent | ✅ 完成 | 100% |
| Phase 2: ContextCompressor Agent | ✅ 完成 | 100% |
| Phase 3: 移除 lightProvider | 🔲 可选 | - |

**实际使用 lightProvider 的场景迁移进度**: **100%** ✅

---

**实施者**: Claude
**实施日期**: 2026-03-15
**状态**: ✅ Phase 2 完成，lightProvider 实际使用场景迁移完毕
