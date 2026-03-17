# 意图分析器 Agent 设计方案

## 背景

当前意图识别系统使用 `lightProvider` 来调用轻量模型（Haiku）进行 LLM 分类。但现在已经是多 Agent 架构，应该将意图识别抽象为独立的 Agent，每个 Agent 配置自己的 LLM，从而：

1. **架构更清晰**：意图识别作为独立的 Specialist Agent
2. **配置更灵活**：每个 Agent 独立配置模型，不需要全局 `lightProvider` 概念
3. **职责更明确**：符合多 Agent 设计理念（单一职责）
4. **可扩展性更好**：未来可以为不同任务创建不同的 Agent

## 现有架构分析

### 当前 Agent 系统

- **AgentRegistry**：扫描并加载 Agent 配置（JSON5/YAML/JSON）
- **Agent 配置格式**：
  ```json5
  {
    id: 'agent-id',
    name: 'Agent 名称',
    role: 'specialist',  // router | specialist | coordinator
    description: '...',
    model: {
      primary: '[CC]claude-haiku-4-5-20251001',
      fallback: '[CC]claude-sonnet-4-5-20250929',
      maxTokens: 32000,
    },
    systemPrompt: '...',
    tools: [...],
    enabled: true,
  }
  ```

- **Agent 类型**：
  - `router`：路由 Agent，分析意图并推荐 Specialist
  - `specialist`：专家 Agent，执行特定领域任务
  - `coordinator`：协调 Agent，管理多个 Agent 协作

### 当前意图识别流程

```
用户输入
  ↓
IntentRouter.route()
  ↓
1. 向量匹配（VectorIntentMatcher，30ms）
  ↓ 未命中
2. LLM 分类（LLMIntentClassifier，调用 lightProvider，~1s）
  ↓
3. 自动学习（IntentLearner，异步生成向量）
  ↓
返回 Intent[]
```

## 设计方案

### 1. 创建 IntentAnalyzer Agent

**类型**：`specialist`（专门做意图分析的专家）

**职责**：
- 接收用户输入和可用模块列表
- 使用 LLM 分析用户意图
- 返回匹配的模块列表（按置信度排序）

**配置文件**：`src/core/agent/builtin/intent-analyzer.json5`

```json5
{
  // ============================================================
  // Intent Analyzer Agent - 意图分析专家
  // ============================================================

  id: 'intent-analyzer',
  name: '意图分析器',
  description: '分析用户输入，识别意图并匹配合适的模块（Skill/MCP/Agent）',

  role: 'specialist',
  avatar: '🎯',
  color: 'from-blue-500 to-purple-600',

  model: {
    // 使用 Haiku 而非 Sonnet（意图分类是简单任务）
    primary: '[CC]claude-haiku-4-5-20251001',
    fallback: '[CC]claude-haiku-4-5-20251001',
    maxTokens: 1000,  // 意图分类输出很短
  },

  systemPrompt: `你是一个智能助手的意图识别系统。根据用户输入，选择最合适的模块来处理。

## 任务

分析用户输入的意图，选择 1-3 个最合适的模块来处理（按优先级排序）。

## 输出格式

返回 JSON 数组，格式如下：
\`\`\`json
[
  {
    "moduleId": "模块的 ID",
    "confidence": 0.95,
    "reason": "选择原因（简短，一句话）"
  }
]
\`\`\`

## 要求

1. confidence 范围 0-1，表示匹配置信度
2. 只返回真正相关的模块，不确定的不要返回
3. 如果没有合适的模块，返回空数组 []
4. reason 用中文简短说明选择理由
5. 只返回 JSON，不要其他文字`,

  tools: [],  // 意图分析不需要工具

  execution: {
    mode: 'react',
    maxIterations: 1,  // 单次调用即可
    timeout: 10000,    // 10 秒超时
    streaming: false,   // 不需要流式输出
    parallelTools: false,
  },

  permissions: {
    fileRead: 'never',
    fileWrite: 'never',
    bashExec: 'never',
    network: 'never',
  },

  skills: {
    builtin: [],
    custom: [],
  },

  capabilities: [
    '意图识别',
    '模块匹配',
    'Skill 路由',
    'MCP 工具路由',
  ],

  tags: ['system', 'intent', 'router'],
  enabled: true,

  metadata: {
    builtin: true,
    isSystemAgent: true,
    usageScenario: 'intent-classification',
  },
}
```

### 2. 修改 IntentRouter

将 `LLMIntentClassifier` 替换为 `IntentAnalyzer` Agent。

**修改前**（使用 lightProvider）：
```typescript
export class IntentRouter {
  constructor(
    private llmProvider: ILLMProvider,
    private providerConfig: ProviderConfig
  ) {
    this.llmClassifier = new LLMIntentClassifier(llmProvider, providerConfig);
  }

  async route() {
    // 向量未命中时，调用 LLM 分类器
    const llmIntents = await this.llmClassifier.classify(userInput, availableModules);
  }
}
```

**修改后**（使用 Agent）：
```typescript
export class IntentRouter {
  constructor(
    private agentRegistry: AgentRegistry | null
  ) {
    this.llmClassifier = new LLMIntentClassifier(agentRegistry);
  }

  async route() {
    // 向量未命中时，调用 IntentAnalyzer Agent
    const llmIntents = await this.llmClassifier.classify(userInput, availableModules);
  }
}
```

### 3. 修改 LLMIntentClassifier

将直接调用 LLM 改为调用 Agent。

**核心变化**：
```typescript
export class LLMIntentClassifier {
  constructor(private agentRegistry: AgentRegistry | null) {}

  async classify(
    userInput: string,
    availableModules: AvailableModule[]
  ): Promise<Intent[]> {
    // 如果没有 AgentRegistry，降级到旧版本（兼容性）
    if (!this.agentRegistry) {
      console.warn('⚠️  AgentRegistry 未初始化，意图分类已禁用');
      return [];
    }

    // 获取 IntentAnalyzer Agent
    const agentConfig = this.agentRegistry.get('intent-analyzer');
    if (!agentConfig?.enabled) {
      console.warn('⚠️  IntentAnalyzer Agent 未启用');
      return [];
    }

    console.log('⏳ LLM 意图分析中（使用 IntentAnalyzer Agent）...');

    try {
      // 构建 Agent 输入
      const agentInput: AgentInput = {
        userMessage: this.buildClassificationPrompt(userInput, availableModules),
        context: {
          metadata: {
            availableModules,
          },
        },
      };

      // 执行 Agent（通过 ChainTool 或直接创建 Agent 实例）
      // TODO: 这里需要实现 Agent 执行逻辑
      const agentOutput = await this.executeAgent(agentConfig, agentInput);

      // 解析 Agent 输出
      const intents = this.parseAgentOutput(agentOutput.content, availableModules);

      if (intents.length > 0) {
        console.log(
          `✓ IntentAnalyzer 识别: ${intents[0].params?.moduleId} (置信度: ${intents[0].confidence})`
        );
      }

      return intents;
    } catch (err) {
      console.error('IntentAnalyzer 执行失败:', err);
      return [];
    }
  }

  private async executeAgent(
    agentConfig: ConfigurableAgentConfig,
    input: AgentInput
  ): Promise<AgentOutput> {
    // TODO: 实现 Agent 执行逻辑
    // 方案 1: 通过 ChainTool 调用
    // 方案 2: 直接创建 AgentLoop 实例
    // 方案 3: 通过 AgentFactory 创建
  }
}
```

### 4. 修改 ChatSession 初始化

**修改前**：
```typescript
this.intentRouter = new IntentRouter(this.lightProvider!, this.config.provider);
```

**修改后**：
```typescript
this.intentRouter = new IntentRouter(this.agentRegistry);
```

### 5. 移除 lightProvider（可选）

如果所有使用 `lightProvider` 的场景都改为 Agent，可以完全移除 `lightProvider` 的概念：

**当前使用 lightProvider 的场景**：
1. ✅ 意图分类（IntentRouter）→ 改为 IntentAnalyzer Agent
2. 🔲 上下文压缩（ContextCompressor）→ 改为 Compressor Agent
3. 🔲 子代理（SubAgent）→ 已经有独立配置
4. 🔲 任务执行器（Executor）→ 已经有独立配置
5. 🔲 多代理工具（ChainTool）→ 已经有独立配置

**渐进式迁移**：
- Phase 1：实现 IntentAnalyzer Agent（本次）
- Phase 2：实现 Compressor Agent（可选）
- Phase 3：完全移除 lightProvider（可选）

## 优势对比

| 维度 | 旧方案（lightProvider） | 新方案（Agent） |
|------|----------------------|----------------|
| 架构清晰度 | ❌ 全局配置，职责不明 | ✅ 独立 Agent，职责明确 |
| 配置灵活性 | ❌ 全局统一 lightModel | ✅ 每个 Agent 独立配置 |
| 可扩展性 | ❌ 新场景需要修改代码 | ✅ 新增 Agent 配置即可 |
| 可观测性 | ❌ 难以追踪 lightProvider 调用 | ✅ Agent 执行日志清晰 |
| 多模型支持 | ❌ 只能有一个 lightModel | ✅ 不同 Agent 可以用不同模型 |
| 成本优化 | ✅ 统一使用 Haiku | ✅ 可以针对性优化 |
| 符合设计理念 | ❌ 不符合多 Agent 架构 | ✅ 完全符合 |

## 实现计划

### Phase 1: 实现 IntentAnalyzer Agent

**任务清单**：
1. ✅ 设计 Agent 配置文件
2. 🔲 创建 `intent-analyzer.json5`
3. 🔲 实现 Agent 执行逻辑（AgentExecutor）
4. 🔲 修改 `LLMIntentClassifier` 调用 Agent
5. 🔲 修改 `IntentRouter` 构造函数
6. 🔲 修改 `ChatSession` 初始化
7. 🔲 测试验证

**技术难点**：
- 如何在 `LLMIntentClassifier` 中执行 Agent？
  - 方案 1：通过 ChainTool 调用（需要 ToolRegistry）
  - 方案 2：直接创建 AgentLoop 实例（需要 Provider）
  - 方案 3：通过 AgentFactory 创建（需要实现 AgentFactory）

**推荐方案**：直接创建 AgentLoop 实例（最轻量）

```typescript
private async executeAgent(
  agentConfig: ConfigurableAgentConfig,
  input: AgentInput
): Promise<AgentOutput> {
  // 1. 根据 agentConfig.model 创建 Provider
  const providerFactory = new ProviderFactory();
  const provider = providerFactory.getByModel(agentConfig.model.primary);

  // 2. 创建 AgentLoop
  const agentLoop = new AgentLoop(
    provider,
    new ToolRegistry(),  // 空工具注册表
    {
      model: agentConfig.model.primary,
      apiKey: this.config.provider.apiKey,
      baseURL: this.config.provider.baseURL,
      maxTokens: agentConfig.model.maxTokens,
      temperature: agentConfig.execution.temperature,
      systemPrompt: agentConfig.systemPrompt,
    }
  );

  // 3. 执行单次推理
  const messages: Message[] = [
    { role: 'user', content: input.userMessage }
  ];
  agentLoop.setMessages(messages);

  const stream = agentLoop.start();
  let content = '';
  for await (const event of stream) {
    if (event.type === 'text_delta' && event.text) {
      content += event.text;
    }
  }

  return {
    success: true,
    content,
  };
}
```

### Phase 2: 测试与验证

**测试用例**：
1. 首次使用：向量未命中，调用 IntentAnalyzer Agent
2. 后续使用：向量命中，跳过 Agent 调用
3. Agent 未启用：降级处理
4. Agent 执行失败：错误处理
5. 多模块匹配：按置信度排序

**性能验证**：
- Agent 执行时间：< 1.5s（Haiku）
- 向量匹配时间：< 50ms
- 总体响应时间：无明显增加

### Phase 3: 文档与示例

**需要更新的文档**：
1. `README.md`：更新意图识别说明
2. `auto-learning-intent.md`：更新架构图
3. `intent-router-optimization.md`：更新为 Agent 方案
4. Agent 配置示例：添加 IntentAnalyzer

## 待解决问题

1. **Agent 执行方式**：
   - 当前没有统一的 AgentFactory
   - 需要实现 AgentExecutor 或直接创建 AgentLoop？

2. **配置传递**：
   - Agent 需要访问全局 API Key 等配置
   - 如何在 AgentLoop 中传递这些配置？

3. **降级策略**：
   - 如果 AgentRegistry 未初始化，如何处理？
   - 保留旧的 LLM 直接调用作为降级方案？

4. **性能优化**：
   - Agent 每次执行都创建新的 Provider 和 AgentLoop？
   - 是否需要缓存 Agent 实例？

## 总结

将意图识别抽象为 **IntentAnalyzer Agent** 是更符合多 Agent 架构的设计：

1. **职责明确**：意图识别作为独立的 Specialist Agent
2. **配置灵活**：每个 Agent 独立配置模型，无需全局 lightProvider
3. **易于扩展**：新增功能只需添加 Agent 配置
4. **可观测性好**：Agent 执行日志统一管理
5. **符合设计理念**：完全符合多 Agent 协作架构

**建议优先级**：
- ✅ **高优先级**：实现 IntentAnalyzer Agent（替代 lightProvider in IntentRouter）
- 🔲 **中优先级**：实现 Compressor Agent（替代 lightProvider in ContextCompressor）
- 🔲 **低优先级**：完全移除 lightProvider 概念（如果所有场景都迁移完成）
