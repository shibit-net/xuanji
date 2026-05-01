# 主 Agent Prompt 加载和组装流程

## 1. 整体架构

```
用户输入
  ↓
MainAgent.run()
  ↓
LayeredPromptBuilder.build()  ← 动态构建 system prompt
  ↓
IntentAnalyzer.analyze()      ← 意图分析（场景 + 复杂度）
  ↓
选择 Prompt 组件（L0/L1/L2/L3）
  ↓
渲染并组装最终 prompt
  ↓
AgentLoop.run()               ← 执行对话循环
```

## 2. 详细流程

### 2.1 SessionFactory 初始化

**文件**: `src/core/chat/SessionFactory.ts`

```typescript
async create(options: SessionOptions = {}): Promise<ChatSession> {
  // 1. 加载配置
  const config = await this.loadConfig({ ...options, userId, agentId });
  
  // 2. 创建 LayeredPromptBuilder
  this.container.register('layeredPromptBuilder', async () => {
    const builder = new LayeredPromptBuilder(
      undefined,
      userId,
      options.projectRoot,
      this.agentId,
      {
        defaultComplexity: config.prompt?.defaultComplexity,
        defaultScene: config.prompt?.defaultScene,
      }
    );
    await builder.init();  // 加载用户自定义组件
    return builder;
  });
  
  // 3. 创建 MainAgent
  const mainAgent = await this.createMainAgent(config);
  
  // 4. 注册高级工具（TaskTool, TeamTool, ListAgentsTool 等）
  await this.registerAdvancedTools(config, options);
}
```

### 2.2 MainAgent 执行流程

**文件**: `src/core/agent/dispatch/MainAgent.ts`

```typescript
async run(userMessage: string): Promise<void> {
  // 1. 触发意图分析开始 hook
  await this.hookRegistry.emit('IntentAnalysisStart', { ... });
  
  // 2. 使用 LayeredPromptBuilder 构建 system prompt
  if (this.promptBuilder) {
    const buildResult = await this.promptBuilder.build({
      userMessage,
      // 不传 scene 和 complexity，会触发 IntentAnalyzer 自动分析
    });
    
    // 3. 更新 MessageManager 的 system prompt
    const messageManager = this.agentLoop.getMessageManager();
    messageManager.systemPrompt = buildResult.prompt;
  }
  
  // 4. 可选：本地小模型意图分类（ModelClassifier）
  if (this.classifier.isAvailable()) {
    classification = await this.classifier.classify(userMessage);
    // 置信度 >= 0.7 时注入提示
    if (classification.confidence >= 0.7) {
      const hint = `[意图分析] agent=${classification.agent}, scene=${classification.scene}`;
      this.agentLoop.getMessageManager().setSystemPromptSuffix(hint, 'intent-hint');
    }
  }
  
  // 5. 执行对话循环
  await this.agentLoop.run(userMessage);
  
  // 6. 触发意图分析结束 hook
  await this.hookRegistry.emit('IntentAnalysisEnd', { ... });
}
```

### 2.3 LayeredPromptBuilder 构建流程

**文件**: `src/core/prompt/LayeredPromptBuilder.ts`

```typescript
async build(options: LayeredPromptBuildOptions = {}): Promise<PromptBuildResult> {
  // 1. 意图分析
  let scene: SceneType | null = null;
  let complexity: IntentComplexity = this.defaultComplexity;
  
  if (userMessage && (!scene || !options.complexity)) {
    // 转发 intentAnalyzer 的匹配过程事件
    this.intentAnalyzer.setEventCallback((evt) => {
      this.emitEvent({
        type: 'intent:match',
        data: evt,
      });
    });
    
    const analysis = await this.intentAnalyzer.analyze(
      userMessage,
      !this.currentScene, // isFirstTurn
    );
    
    scene = analysis.scene;
    complexity = analysis.complexity;
  }
  
  // 2. 选择组件（根据场景和复杂度）
  const selectedComponents = this.selectComponents(scene, complexity);
  
  // 3. 渲染组件
  const parts: string[] = [];
  for (const component of selectedComponents) {
    const rendered = await component.render(context);
    if (rendered) {
      parts.push(rendered);
    }
  }
  
  // 4. 组装最终 prompt
  const prompt = parts.join('\n\n');
  
  return {
    prompt,
    components: componentIds,
    scene,
    complexity,
    requiredTools,
    thinking,
    estimatedTokens,
  };
}
```

### 2.4 组件选择逻辑

**文件**: `src/core/prompt/LayeredPromptBuilder.ts:shouldInclude()`

```typescript
private shouldInclude(
  component: PromptComponent,
  scene: SceneType,
  complexity: IntentComplexity,
): boolean {
  const { layer } = component;
  
  // L0: 始终加载（核心身份）
  if (layer === 'L0') return true;
  
  // L1: standard/complex 加载，且场景匹配
  if (layer === 'L1') {
    if (complexity === 'simple') return false;
    if (component.scenes && !component.scenes.includes(scene)) return false;
    return true;
  }
  
  // L2: 仅 complex 加载（规划行为）
  if (layer === 'L2') {
    return complexity === 'complex';
  }
  
  // L3: 始终加载（项目上下文）
  // 但组件内部会判断是否真的是项目
  if (layer === 'L3') return true;
  
  return false;
}
```

## 3. Prompt 分层结构

### L0 - 核心层（始终加载）
- **base-identity**: 身份定义
- **base-memory-guide**: 记忆管理指南
- **base-task-execution**: 任务执行规范

### L1 - 能力层（standard/complex 加载，场景匹配）
- **l1-coding**: 编程场景
- **l1-life**: 生活场景
- 用户自定义场景组件（从 `.xuanji/users/{userId}/prompts/` 加载）

### L2 - 行为层（仅 complex 加载）
- **l2-planning**: 规划能力
- **l2-loop-control**: 循环控制

### L3 - 上下文层（始终加载）
- **l3-project**: 项目上下文
  - 文件索引（FileIndexer）
  - 依赖分析（DependencyAnalyzer）
  - 项目规则（XUANJI.md + rules.md）

## 4. 意图分析流程

**文件**: `src/core/prompt/IntentAnalyzer.ts`

```typescript
async analyze(userMessage: string, isFirstTurn: boolean): Promise<IntentAnalysis> {
  // 1. 关键词匹配（快速路径，<1ms）
  for (const [scene, config] of this.sceneConfigs) {
    if (config.keywords.test(userMessage)) {
      return {
        scene,
        complexity: this.estimateComplexity(userMessage),
        matchMethod: 'keyword',
        confidence: 0.9,
      };
    }
  }
  
  // 2. Embedding 匹配（精确路径，~50ms）
  if (this.embeddingMatcher) {
    const match = await this.embeddingMatcher.match(userMessage);
    if (match && match.confidence > 0.7) {
      return {
        scene: match.scene,
        complexity: this.estimateComplexity(userMessage),
        matchMethod: 'embedding',
        confidence: match.confidence,
      };
    }
  }
  
  // 3. 默认场景
  return {
    scene: 'coding',
    complexity: 'standard',
    matchMethod: 'default',
    confidence: 0.5,
  };
}
```

## 5. 工具和 Agent 的动态感知

### 5.1 工具注册流程

**文件**: `src/core/tools/ToolRegistry.ts`

```typescript
// 基础工具（自动注册）
export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(new ReadTool());
  registry.register(new WriteTool());
  registry.register(new EditTool());
  registry.register(new BashTool());
  registry.register(new GlobTool());
  registry.register(new GrepTool());
  // ... 更多基础工具
  return registry;
}

// 高级工具（动态注册，需要依赖注入）
// 在 SessionFactory.registerAdvancedTools() 中注册
async registerAdvancedTools(config, options) {
  registry.register(new TaskTool(subAgentFactory));
  registry.register(new TeamTool(...));
  registry.register(new MatchAgentTool(agentRegistry));
  registry.register(new ListAgentsTool());  // ← 列出所有可用 Agent
}
```

### 5.2 Agent 注册流程

**文件**: `src/core/agent/AgentRegistry.ts`

```typescript
async init(): Promise<void> {
  // 1. 初始化用户 Agent 目录
  await this.initializeUserAgentsDir();
  
  // 2. 扫描配置目录（.xuanji/users/{userId}/agents/*.yaml）
  for (const configPath of this.configPaths) {
    const files = await glob(configPath + '/**/*.{yaml,yml}');
    for (const file of files) {
      await this.loadAgentConfig(file);  // 加载 YAML 配置
    }
    this.watchDirectory(configPath);  // 监听文件变化
  }
  
  // 3. 如果用户目录为空，复制内置 Agent
  if (!hasConfigFiles) {
    await this.copyBuiltinAgentsToUserDir();
  }
}

// 获取所有可用 Agent
getAll(): ConfigurableAgentConfig[] {
  return Array.from(this.agents.values())
    .map(agent => this.configManager.getAgentWithOverride(agent));
}
```

### 5.3 主 Agent 如何感知工具和 Agent

#### 方式 1: 通过 `list_agents` 工具

**文件**: `src/core/tools/ListAgentsTool.ts`

```typescript
async execute(input: Record<string, unknown>): Promise<ToolResult> {
  // 获取所有 Agent
  let agents = this.agentRegistry.getAllIds()
    .map(id => this.agentRegistry!.get(id)!);
  
  // 过滤（启用状态、标签、关键词搜索）
  if (enabledOnly) {
    agents = agents.filter(a => a.enabled !== false);
  }
  
  // 格式化输出
  const output = this.formatAgentList(agents);
  return this.success(output);
}
```

**主 Agent 可以调用**:
```typescript
// 列出所有可用 Agent
list_agents({ filter: { enabled_only: true } })

// 搜索特定领域的 Agent
list_agents({ filter: { tags: ["coding"], search: "refactor" } })
```

#### 方式 2: 通过 `match_agent` 工具

**文件**: `src/core/tools/MatchAgentTool.ts`

```typescript
async execute(input: Record<string, unknown>): Promise<ToolResult> {
  const task = input.task as string;
  
  // 1. 获取所有启用的 Agent
  const agents = this.agentRegistry.getEnabled();
  
  // 2. 计算匹配分数
  const scored = agents.map(agent => ({
    agent,
    score: this.calculateScore(agent, task),
  }));
  
  // 3. 返回最佳匹配
  const best = scored.sort((a, b) => b.score - a.score)[0];
  return this.success(`推荐使用: ${best.agent.id}`);
}
```

#### 方式 3: 通过 ToolRegistry.getSchemas()

**主 Agent 在每次对话时自动获取所有工具的 schema**:

```typescript
// AgentLoop 会自动调用
const toolSchemas = this.registry.getSchemas();
// 传递给 LLM API
```

**工具 schema 包含**:
- `name`: 工具名称
- `description`: 工具描述（包含使用场景）
- `input_schema`: 参数定义

## 6. 当前的限制和改进方向

### 6.1 当前限制

1. **工具列表是静态的**: 主 Agent 在初始化时获取工具列表，运行时无法动态感知新增工具
2. **Agent 列表需要主动查询**: 主 Agent 需要调用 `list_agents` 工具才能知道有哪些 Agent
3. **L3 始终加载**: 即使主 Agent 只做任务分配，也会加载项目上下文（可能浪费 token）

### 6.2 改进方案

#### 方案 1: 在 System Prompt 中注入 Agent 列表

**修改**: `MainAgent.ts`

```typescript
async run(userMessage: string): Promise<void> {
  // 构建 system prompt 时注入 Agent 列表
  if (this.promptBuilder) {
    const buildResult = await this.promptBuilder.build({
      userMessage,
    });
    
    // 🆕 注入 Agent 列表
    const agentRegistry = this.container.resolve('agentRegistry');
    const agentList = agentRegistry.getAgentListForPrompt();
    
    const finalPrompt = buildResult.prompt + '\n\n' + 
      '## 可用 Agent\n\n' + agentList;
    
    messageManager.systemPrompt = finalPrompt;
  }
}
```

**优点**: 主 Agent 无需调用工具即可知道所有可用 Agent
**缺点**: 增加 system prompt 长度（~2000 tokens）

#### 方案 2: 为主 Agent 添加 `skipProjectContext` 选项

**修改**: `LayeredPromptBuilder.ts`

```typescript
interface LayeredPromptBuildOptions {
  skipProjectContext?: boolean;  // 🆕 跳过 L3 项目上下文
}

private shouldInclude(
  component: PromptComponent,
  scene: SceneType,
  complexity: IntentComplexity,
  options?: LayeredPromptBuildOptions,  // 🆕 传入选项
): boolean {
  // ...
  
  // L3: 可选加载
  if (layer === 'L3') {
    return !options?.skipProjectContext;  // 🆕 允许跳过
  }
}
```

**使用**:
```typescript
const buildResult = await this.promptBuilder.build({
  userMessage,
  skipProjectContext: true,  // 主 Agent 只做任务分配，不需要项目细节
});
```

#### 方案 3: 动态工具发现

**新增**: `DiscoverToolsTool.ts`

```typescript
class DiscoverToolsTool extends BaseTool {
  readonly name = 'discover_tools';
  readonly description = '动态发现当前可用的所有工具';
  
  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const registry = this.getRegistry();
    const tools = registry.getAll();
    
    const toolList = tools.map(t => ({
      name: t.name,
      description: t.description,
      readonly: t.readonly,
    }));
    
    return this.success(JSON.stringify(toolList, null, 2));
  }
}
```

## 7. 总结

### 主 Agent 的 Prompt 加载流程

1. **SessionFactory** 初始化 `LayeredPromptBuilder` 和 `AgentRegistry`
2. **MainAgent.run()** 触发 prompt 构建
3. **LayeredPromptBuilder.build()** 执行意图分析，选择组件，渲染并组装
4. **IntentAnalyzer** 通过关键词或 Embedding 匹配场景和复杂度
5. **组件选择**: L0 始终加载，L1 根据场景，L2 仅 complex，L3 始终加载
6. **最终 prompt** 更新到 `MessageManager`，传递给 LLM

### 工具和 Agent 的感知机制

- **工具**: 通过 `ToolRegistry.getSchemas()` 自动传递给 LLM
- **Agent**: 通过 `list_agents` 或 `match_agent` 工具主动查询
- **改进方向**: 在 system prompt 中注入 Agent 列表，或添加动态发现工具

### 是否需要 L3

- **当前**: L3 始终加载，但内部会判断是否真的是项目
- **建议**: 为主 Agent 添加 `skipProjectContext` 选项，纯任务分配时跳过 L3
