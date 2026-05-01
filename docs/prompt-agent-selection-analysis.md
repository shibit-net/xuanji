# Prompt 和 Agent 选择流程分析

## 完整流程图

```
用户输入: "写一个登录接口"
  ↓
┌─────────────────────────────────────────────────────────────┐
│ MainAgent.execute(userInput)                                │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ 步骤 1: 意图识别 (IntentRouter)                             │
│ - 输入: "写一个登录接口"                                    │
│ - 输出: intent = null (或某个意图)                          │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ 步骤 2: 场景分析 (IntentAnalyzer)                           │
│ - 输入: "写一个登录接口"                                    │
│ - 输出: scene = 'write_code', complexity = 'standard'       │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ 步骤 3: 任务规划 (TaskPlanner)                              │
│ - 输入: scene='write_code', complexity='standard'           │
│ - 调用: selectAgentForScene('write_code', userInput)       │
│   ├─ 1. 规则匹配: sceneToAgentHints['write_code'] → 无     │
│   ├─ 2. 小模型分类: ModelClassifier.classify()             │
│   │     → { agent: 'coder', scene: 'write_code', conf: 0.9}│
│   └─ 3. 返回: agentId = 'coder'                            │
│ - 输出: TaskPlan {                                          │
│     strategy: 'single',                                     │
│     tasks: [{                                               │
│       id: 'task-1',                                         │
│       agentId: 'coder',      ← Agent 选择                   │
│       scene: 'write_code',   ← Scene 选择                   │
│       description: "写一个登录接口"                         │
│     }]                                                      │
│   }                                                         │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ 步骤 4: 执行任务 (MainAgent.executeSingleTask)              │
│ - 获取场景 Prompt:                                          │
│   sceneEnhancement = await promptStore.getSceneEnhancement(│
│     'write_code',                                           │
│     { userInput: "写一个登录接口" }                         │
│   )                                                         │
│   ↓                                                         │
│   PromptStore.getSceneEnhancement() 调用:                  │
│   ↓                                                         │
│   LayeredPromptBuilder.build({                             │
│     scene: 'write_code',                                   │
│     complexity: 'standard',                                │
│     userMessage: "写一个登录接口",                         │
│     language: 'zh-CN'                                      │
│   })                                                       │
│   ↓                                                         │
│   返回完整 Prompt:                                          │
│   """                                                       │
│   # L0: 身份和安全底线                                     │
│   你是 Xuanji，专业的 AI 编程助手...                       │
│                                                             │
│   # L1: write_code 场景                                    │
│   你是专业编程工程师，严谨、简洁，输出代码可直接运行。     │
│   核心原则：                                                │
│   - 代码质量：可直接运行，无语法错误                       │
│   - 简洁明了：附带1-2句核心解释                            │
│   - 最佳实践：遵循语言规范和设计模式                       │
│   """                                                       │
│                                                             │
│ - 创建团队配置:                                             │
│   teamConfig = {                                           │
│     name: 'single-task',                                   │
│     strategy: 'sequential',                                │
│     members: [{                                            │
│       id: 'task-1',                                        │
│       agentId: 'coder',                                    │
│       systemPrompt: sceneEnhancement  ← 完整的 L0+L1 Prompt│
│     }]                                                     │
│   }                                                        │
│                                                             │
│ - 调用: teamManager.createTeam(teamConfig)                 │
│ - 调用: teamManager.execute(goal, signal)                  │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ 步骤 5: TeamManager 执行成员任务                            │
│ - 调用: subAgentFactory.createAndRun(                      │
│     'coder',                                               │
│     {                                                      │
│       task: "写一个登录接口",                              │
│       systemPrompt: sceneEnhancement  ← 传递完整 Prompt    │
│     }                                                      │
│   )                                                        │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ 步骤 6: SubAgentFactory 创建子 Agent                        │
│ - 查找 Agent 配置: agentRegistry.get('coder')              │
│   返回: coder.json5 配置                                   │
│                                                             │
│ - 构建 System Prompt:                                      │
│   检查条件:                                                 │
│   if (promptBuilder && !isInternal && !options.systemPrompt)│
│   ↓                                                         │
│   条件不满足！因为 options.systemPrompt 存在               │
│   ↓                                                         │
│   进入 else 分支:                                           │
│   systemPrompt = options.systemPrompt                      │
│                = sceneEnhancement (完整的 L0+L1 Prompt)    │
│   ↓                                                         │
│   调用 buildSystemPrompt() 进行格式化:                     │
│   - 添加项目规则                                            │
│   - 添加 SubAgent 模式标记                                 │
│   - 返回最终 systemPrompt                                  │
│                                                             │
│ - 创建 AgentLoop 实例                                      │
│ - 执行: agentLoop.run(task)                                │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ 步骤 7: AgentLoop 执行 ReAct 循环                           │
│ - 使用最终的 systemPrompt                                  │
│ - 调用 LLM API                                             │
│ - 执行工具调用                                              │
│ - 返回结果                                                  │
└─────────────────────────────────────────────────────────────┘
```

## 关键决策点

### 1. Agent 选择（TaskPlanner.selectAgentForScene）

**三级决策**：
```typescript
private async selectAgentForScene(scene: SceneType, userInput: string): Promise<string> {
  // 1. 规则匹配
  if (this.config.sceneToAgentHints?.[scene]) {
    return this.config.sceneToAgentHints[scene];
  }

  // 2. 小模型分类
  if (this.modelClassifier && this.modelClassifier.isAvailable()) {
    const result = await this.modelClassifier.classify(userInput);
    if (result && result.confidence >= 0.7) {
      return result.agent;  // ← 使用本地模型分类结果
    }
  }

  // 3. 默认值
  return this.config.defaultAgent;  // 'coder'
}
```

**问题**：
- ✅ Agent 选择是动态的（规则 → 小模型 → 默认）
- ✅ 支持用户配置 `sceneToAgentHints`
- ✅ 使用本地模型（Qwen2.5-1.5B / ChatGLM3-6B）

### 2. Scene 选择（IntentAnalyzer）

**流程**：
```typescript
const analysis = await intentAnalyzer.analyze(userInput, true);
// 返回: { scene: 'write_code', complexity: 'standard' }
```

**问题**：
- ✅ Scene 选择是动态的（基于用户输入分析）
- ✅ 支持 8 种编程场景

### 3. Prompt 构建（PromptStore + LayeredPromptBuilder）

**流程**：
```typescript
// MainAgent 调用
const sceneEnhancement = await this.promptStore.getSceneEnhancement(task.scene, {
  userInput: plan.goal,
});

// PromptStore 内部
async getSceneEnhancement(scene: SceneType, context?: PromptContext): Promise<string> {
  const buildResult = await this.promptBuilder.build({
    scene,                          // ← 动态场景
    complexity: 'standard',
    userMessage: context?.userInput,
    language: 'zh-CN',
  });
  return buildResult.prompt;  // 返回 L0 + L1
}
```

**问题**：
- ✅ Prompt 构建是动态的（根据 scene 选择 L1 层）
- ✅ 使用 LayeredPromptBuilder（L0 + L1）
- ✅ 不同场景使用不同的 prompt

### 4. SubAgentFactory 处理 Prompt

**流程**：
```typescript
async createSubAgent(agentIdOrRole: string, options: SubAgentFactoryOptions) {
  // ...
  
  let systemPrompt: string;

  if (this.promptBuilder && !isInternalAgent && !options.systemPrompt) {
    // 情况 1: 没有提供 systemPrompt
    // 使用 LayeredPromptBuilder 构建
    const buildResult = await this.promptBuilder.buildForSubAgent({...});
    systemPrompt = buildResult.prompt;
  } else {
    // 情况 2: 已提供 systemPrompt（MainAgent 构建的）
    // 直接使用
    const baseSystemPrompt = options.systemPrompt ?? agentConfig.systemPrompt ?? '';
    systemPrompt = this.buildSystemPrompt(
      { ...agentConfig, systemPrompt: baseSystemPrompt },
      options,
    );
  }
  
  // ...
}
```

**问题**：
- ✅ 当 MainAgent 提供 systemPrompt 时，直接使用
- ✅ 当没有提供时，使用 LayeredPromptBuilder 构建
- ✅ 支持两种使用模式（MainAgent 调度 / 直接调用）

---

## 发现的问题

### 问题 1: Agent 配置中的 systemPrompt 被忽略

**现象**：
```typescript
// coder.json5
{
  id: 'coder',
  systemPrompt: "You are a professional coder..."  // ← 这个 prompt 被忽略了
}
```

**原因**：
- MainAgent 通过 `PromptStore.getSceneEnhancement()` 构建了完整的 prompt
- 这个 prompt 覆盖了 agent 配置中的 `systemPrompt`
- SubAgentFactory 直接使用 `options.systemPrompt`，不会读取 agent 配置中的 prompt

**是否是问题**：
- ❓ 这可能是设计意图：MainAgent 动态构建 prompt，覆盖静态配置
- ❓ 但如果用户自定义了 agent 配置，期望使用自己的 prompt，就会被覆盖

### 问题 2: Agent 和 Scene 的关系混乱

**现象**：
```typescript
// TaskPlanner 返回
{
  agentId: 'coder',        // Agent: 执行者
  scene: 'write_code',     // Scene: 场景
}

// 但是 Prompt 只根据 scene 构建，不考虑 agentId
const sceneEnhancement = await promptStore.getSceneEnhancement(task.scene);
```

**问题**：
- Agent 配置中有自己的 `systemPrompt`
- 但 MainAgent 只根据 `scene` 构建 prompt，忽略了 agent 的特性
- 例如：`coder` agent 和 `explore` agent 使用相同的 `write_code` scene，会得到相同的 prompt

**是否是问题**：
- ❓ 如果 Agent 只是"执行者"，Scene 决定"怎么做"，那么相同 scene 使用相同 prompt 是合理的
- ❓ 但如果不同 Agent 有不同的专长，应该在 prompt 中体现

### 问题 3: 两种 Prompt 构建路径

**路径 1: MainAgent 调度**
```
MainAgent
  → PromptStore.getSceneEnhancement(scene)
    → LayeredPromptBuilder.build({ scene })
      → 返回 L0 + L1 (scene)
  → TeamManager
    → SubAgentFactory({ systemPrompt: L0+L1 })
      → 直接使用
```

**路径 2: 直接调用 SubAgentFactory**
```
SubAgentFactory.createSubAgent('coder', { task: '...' })
  → 检查: options.systemPrompt 不存在
  → LayeredPromptBuilder.buildForSubAgent()
    → 返回 L0 + agent 配置中的 prompt
```

**问题**：
- 两种路径构建的 prompt 不一致
- 路径 1: L0 + L1 (scene)
- 路径 2: L0 + agent.systemPrompt
- 这可能导致行为不一致

### 问题 4: LayeredPromptBuilder.buildForSubAgent() 未被使用

**现象**：
```typescript
// SubAgentFactory.ts
if (this.promptBuilder && !isInternalAgent && !options.systemPrompt) {
  // 这个分支在 MainAgent 调度时永远不会执行
  // 因为 MainAgent 总是提供 options.systemPrompt
  const buildResult = await this.promptBuilder.buildForSubAgent({...});
}
```

**问题**：
- `buildForSubAgent()` 方法只在直接调用 SubAgentFactory 时使用
- MainAgent 调度时不会使用
- 这个方法可能没有被充分测试

---

## 建议的改进方案

### 方案 1: 统一 Prompt 构建（推荐）

**思路**：
- MainAgent 不再构建完整 prompt
- 只传递 `scene` 和 `agentId` 给 SubAgentFactory
- SubAgentFactory 统一使用 LayeredPromptBuilder 构建 prompt

**实现**：
```typescript
// MainAgent.executeSingleTask()
const teamConfig: TeamConfig = {
  members: [{
    agentId: task.agentId,
    scene: task.scene,  // ← 只传递 scene，不传递 systemPrompt
  }],
};

// SubAgentFactory.createSubAgent()
let systemPrompt: string;
if (this.promptBuilder && !isInternalAgent) {
  // 统一使用 LayeredPromptBuilder
  const buildResult = await this.promptBuilder.buildForSubAgent({
    agentId: agentConfig.id,
    scene: options.scene,  // ← 使用传递的 scene
    task: options.task,
  });
  systemPrompt = buildResult.prompt;
}
```

**优点**：
- 统一 prompt 构建逻辑
- 可以同时考虑 agent 和 scene
- 更容易维护和测试

### 方案 2: 增强 Prompt 构建（保持当前架构）

**思路**：
- 保持 MainAgent 构建 prompt 的架构
- 但在构建时同时考虑 agent 和 scene

**实现**：
```typescript
// PromptStore.getSceneEnhancement()
async getSceneEnhancement(
  scene: SceneType,
  agentId: string,  // ← 新增参数
  context?: PromptContext
): Promise<string> {
  const buildResult = await this.promptBuilder.build({
    scene,
    agentId,  // ← 传递 agentId
    complexity: 'standard',
    userMessage: context?.userInput,
  });
  return buildResult.prompt;
}

// LayeredPromptBuilder.build()
async build(options: LayeredPromptBuildOptions): Promise<PromptBuildResult> {
  // 1. L0: 身份和安全底线
  // 2. L1: 场景专用 prompt (scene)
  // 3. L1.5: Agent 专用增强 (agentId)  ← 新增层
  // 4. L2: Planning + 循环控制
  // 5. L3: 项目上下文
}
```

**优点**：
- 保持当前架构
- 增强 prompt 的表达能力
- 可以同时体现 scene 和 agent 的特性

### 方案 3: Agent 配置优先

**思路**：
- 如果 agent 配置中有 `systemPrompt`，优先使用
- 只有当 agent 没有配置时，才使用 scene prompt

**实现**：
```typescript
// SubAgentFactory.createSubAgent()
let systemPrompt: string;

// 1. 优先使用 agent 配置中的 prompt
if (agentConfig.systemPrompt && agentConfig.systemPrompt.trim()) {
  systemPrompt = agentConfig.systemPrompt;
}
// 2. 其次使用 MainAgent 提供的 prompt
else if (options.systemPrompt) {
  systemPrompt = options.systemPrompt;
}
// 3. 最后使用 LayeredPromptBuilder 构建
else if (this.promptBuilder) {
  const buildResult = await this.promptBuilder.buildForSubAgent({...});
  systemPrompt = buildResult.prompt;
}
```

**优点**：
- 尊重用户自定义配置
- 向后兼容
- 灵活性高

---

## 总结

**当前架构的优点**：
- ✅ Agent 选择是动态的（规则 → 小模型 → 默认）
- ✅ Scene 选择是动态的（基于用户输入分析）
- ✅ Prompt 构建是动态的（根据 scene 选择 L1 层）

**当前架构的问题**：
- ❌ Agent 配置中的 systemPrompt 被忽略
- ❌ Agent 和 Scene 的关系不清晰
- ❌ 两种 Prompt 构建路径不一致
- ❌ LayeredPromptBuilder.buildForSubAgent() 未被充分使用

**推荐方案**：
- **方案 1（统一构建）**：最彻底，但需要较大改动
- **方案 2（增强构建）**：折中方案，保持架构，增强功能
- **方案 3（配置优先）**：最小改动，向后兼容

你觉得哪个方案更合理？或者有其他想法？
