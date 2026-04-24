# Xuanji 运行流程详解

## 概览

Xuanji 是一个基于 ReAct 循环的智能编程助手，采用**主调度器 + 多子 Agent** 的架构。核心特点：

- **零 LLM 优先**：规则引擎 + 缓存 + 本地模型，减少 LLM 调用
- **Agent 和 Scene 解耦**：Agent（执行者）和 Scene（场景增强）可任意组合
- **分层架构**：会话层 → 调度层 → 执行层 → 工具层

---

## 完整流程（5 步）

```
用户输入
  ↓
1. 会话初始化 (SessionFactory)
  ↓
2. 意图识别 (IntentRouter)
  ↓
3. 场景分析 (IntentAnalyzer)
  ↓
4. 任务规划 (TaskPlanner)
  ↓
5. 执行任务 (TeamManager + AgentLoop)
  ↓
6. 结果汇总 (ResultAggregator)
  ↓
返回用户
```

---

## 详细流程

### 1. 会话初始化 (SessionFactory)

**文件**: `src/core/chat/SessionFactory.ts`

**职责**: 创建会话，初始化所有核心组件

**流程**:

```typescript
// 1. 创建 LLM Provider
const provider = await providerManager.getProvider(config);

// 2. 创建 IntentRouter（意图识别）
const intentRouter = new IntentRouter(provider, vectorStore);

// 3. 创建 IntentAnalyzer（场景分析）
const intentAnalyzer = new IntentAnalyzer(provider);

// 4. 创建 ModelClassifier（本地模型分类）
const modelClassifier = new ModelClassifier({
  modelType: 'qwen2.5-1.5b-instruct', // 或 'chatglm3-6b'
  quantized: true,
});
await modelClassifier.init();

// 5. 创建 TaskPlanner（任务规划）
const taskPlanner = new TaskPlanner(provider, undefined, modelClassifier);

// 6. 创建 TeamManager（团队管理）
const teamManager = new TeamManager(provider, registry, agentConfig, ...);

// 7. 创建 PromptStore（提示词管理）
const promptStore = new PromptStore();

// 8. 创建 ResultAggregator（结果汇总）
const resultAggregator = new ResultAggregator(provider);

// 9. 创建 MainAgent（主调度器）
const mainAgent = new MainAgent(
  intentRouter,
  intentAnalyzer,
  teamManager,
  promptStore,
  taskPlanner,
  resultAggregator
);

// 10. 创建 ChatSession（会话）
const session = new ChatSession(provider, registry, agentConfig, mainAgent, ...);
```

**关键点**:
- ModelClassifier 使用本地 ONNX 模型（Qwen2.5-1.5B 或 ChatGLM3-6B）
- 所有组件在会话创建时一次性初始化
- MainAgent 是核心调度器，协调所有组件

---

### 2. 用户输入处理 (ChatSession)

**文件**: `src/core/chat/ChatSession.ts`

**职责**: 接收用户输入，调用 MainAgent 执行

**流程**:

```typescript
// 用户输入
const userInput = "帮我实现一个用户登录接口";

// 调用 MainAgent
const result = await mainAgent.execute(userInput, signal);

// 返回结果
return result;
```

---

### 3. 意图识别 (IntentRouter)

**文件**: `src/core/intent/IntentRouter.ts`

**职责**: 识别用户意图（编程场景分类）

**优化策略**:
1. **规则引擎**（0ms，覆盖 80% 常见场景）
2. **LRU 缓存**（<1ms，相似问题复用）
3. **轻量 LLM**（~200ms，复杂场景）

**流程**:

```typescript
// 1. 规则引擎快速匹配
const ruleMatch = this.matchByRules(userInput);
if (ruleMatch) {
  return ruleMatch; // 0ms
}

// 2. 缓存查找
const cached = this.cache.get(userInput);
if (cached) {
  return cached; // <1ms
}

// 3. LLM 识别（仅复杂场景）
const intent = await this.llmParse(userInput); // ~200ms
this.cache.set(userInput, intent);
return intent;
```

**意图类型**:
- `code_generation` - 写代码
- `debugging` - 调试
- `code_review` - 审查
- `testing` - 测试
- `refactoring` - 重构
- `explanation` - 讲解
- `exploration` - 探索
- `planning` - 规划

---

### 4. 场景分析 (IntentAnalyzer)

**文件**: `src/core/prompt/IntentAnalyzer.ts`

**职责**: 分析编程场景和任务复杂度

**流程**:

```typescript
const analysis = await intentAnalyzer.analyze(userInput, true);

// 返回结果
{
  scene: 'write_code',        // 场景类型
  complexity: 'standard',     // 复杂度：simple | standard | complex
  confidence: 0.9             // 置信度
}
```

**场景类型**:
- `write_code` - 写代码场景（严谨、低温度、可直接运行）
- `debug` - 调试场景（细致、步骤清晰、定位根因）
- `review` - 审查场景（批判性、关注质量和安全）
- `test` - 测试场景（全面、覆盖边界情况）
- `refactor` - 重构场景（改进结构、保持功能）
- `explain` - 讲解场景（通俗易懂、循序渐进）
- `explore` - 探索场景（快速定位、理解架构）
- `plan` - 规划场景（结构化、架构清晰）

---

### 5. 任务规划 (TaskPlanner)

**文件**: `src/core/agent/dispatch/TaskPlanner.ts`

**职责**: 将意图转换为可执行的任务计划

**流程**:

#### 5.1 简单任务（直接执行）

```typescript
// 输入
userInput = "写一个登录接口";
scene = "write_code";
complexity = "simple";

// 输出
{
  strategy: 'single',
  goal: "写一个登录接口",
  tasks: [{
    id: 'task-1',
    agentId: 'coder',        // Agent：执行者
    scene: 'write_code',     // Scene：场景增强
    description: "写一个登录接口",
    priority: 10
  }]
}
```

#### 5.2 复杂任务（智能拆分）

```typescript
// 输入
userInput = "实现用户系统，包括注册、登录、权限管理";
scene = "write_code";
complexity = "complex";

// 调用 LLM 拆分
const plan = await this.createComplexPlan(intent, scene, userInput);

// 输出
{
  strategy: 'sequential',
  goal: "实现用户系统",
  tasks: [
    {
      id: 'task-1',
      agentId: 'plan',
      scene: 'plan',
      description: "设计用户系统架构",
      priority: 10
    },
    {
      id: 'task-2',
      agentId: 'coder',
      scene: 'write_code',
      description: "实现用户注册接口",
      dependencies: ['task-1'],
      priority: 8
    },
    {
      id: 'task-3',
      agentId: 'coder',
      scene: 'write_code',
      description: "实现用户登录接口",
      dependencies: ['task-1'],
      priority: 8
    }
  ]
}
```

#### 5.3 Agent 选择策略（三级决策）

```typescript
// 1. 规则匹配（配置的 sceneToAgentHints）
if (this.config.sceneToAgentHints?.[scene]) {
  return this.config.sceneToAgentHints[scene];
}

// 2. 小模型分类（ModelClassifier）
if (this.modelClassifier && this.modelClassifier.isAvailable()) {
  const result = await this.modelClassifier.classify(userInput);
  if (result && result.confidence >= 0.7) {
    return result.agent; // Qwen2.5-1.5B 或 ChatGLM3-6B
  }
}

// 3. 默认值（defaultAgent）
return this.config.defaultAgent; // 'coder'
```

**可用 Agent**:
- `coder` - 通用编程 Agent（写代码、调试、审查、测试、重构）
- `explore` - 代码探索 Agent（快速定位文件、理解项目结构）
- `plan` - 方案设计 Agent（架构设计、技术选型）
- `general-purpose` - 通用 Agent（讲解、解释等非编程任务）

**执行策略**:
- `single` - 单任务直接执行
- `sequential` - 串行执行（任务有依赖）
- `parallel` - 并行执行（任务独立）
- `hierarchical` - 层级执行（planner 规划 + workers 执行）
- `pipeline` - 流水线（数据流式处理）

---

### 6. 执行任务 (TeamManager + AgentLoop)

**文件**: 
- `src/core/agent/team/TeamManager.ts`
- `src/core/agent/AgentLoop.ts`

**职责**: 
- TeamManager：管理团队成员、分配任务、路由消息
- AgentLoop：ReAct 推理循环、工具调用、结果处理

#### 6.1 单任务执行

```typescript
// MainAgent 调用
const result = await this.executeSingleTask(plan, signal);

// 内部流程
{
  // 1. 获取场景增强指令
  const sceneEnhancement = await promptStore.getSceneEnhancement('write_code');
  
  // 2. 创建单成员团队
  const teamConfig = {
    name: 'single-task',
    strategy: 'sequential',
    members: [{
      id: 'task-1',
      agentId: 'coder',
      systemPrompt: sceneEnhancement, // 追加到内置 agent 的 systemPrompt 后
      capabilities: ['write_code']
    }]
  };
  
  // 3. 执行任务
  await teamManager.createTeam(teamConfig);
  return teamManager.execute(plan.goal, signal);
}
```

#### 6.2 复杂任务执行（团队协作）

```typescript
// MainAgent 调用
const result = await this.executeTeamTasks(plan, signal);

// 内部流程
{
  // 1. 为每个任务获取场景增强指令
  const members = await Promise.all(
    plan.tasks.map(async (task) => {
      const sceneEnhancement = await promptStore.getSceneEnhancement(task.scene);
      return {
        id: task.id,
        agentId: task.agentId,
        systemPrompt: sceneEnhancement,
        capabilities: [task.scene],
        priority: task.priority
      };
    })
  );
  
  // 2. 创建团队
  const teamConfig = {
    name: 'complex-task',
    strategy: plan.strategy, // sequential | parallel | hierarchical
    members
  };
  
  // 3. 执行任务
  await teamManager.createTeam(teamConfig);
  return teamManager.execute(plan.goal, signal);
}
```

#### 6.3 AgentLoop（ReAct 循环）

```typescript
// ReAct 循环流程
while (true) {
  // 1. 构建消息数组
  const messages = messageManager.buildMessages();
  
  // 2. 调用 LLM API（流式）
  const stream = await provider.stream({ messages, tools, ... });
  
  // 3. 解析响应（文本/工具调用）
  const result = await streamProcessor.process(stream);
  
  // 4. 如果有工具调用 → 执行工具
  if (result.toolCalls.length > 0) {
    const toolResults = await toolDispatcher.execute(result.toolCalls);
    messageManager.addToolResults(toolResults);
    continue; // 回到步骤 1
  }
  
  // 5. 如果没有工具调用 → 结束
  break;
}
```

**关键特性**:
- **流式输出**：实时返回文本和工具调用
- **工具并行**：独立工具并行执行，提升效率
- **错误恢复**：工具失败自动重试
- **上下文压缩**：超过 token 限制自动压缩历史消息
- **成本追踪**：记录每次调用的 token 使用和费用

---

### 7. 结果汇总 (ResultAggregator)

**文件**: `src/core/agent/dispatch/ResultAggregator.ts`

**职责**: 整合多个子 Agent 的执行结果，统一口吻包装

**流程**:

```typescript
// 单任务：直接返回
if (result.memberResults.length === 1) {
  return result.output;
}

// 多任务：LLM 汇总
const aggregated = await this.aggregateMultipleResults(result, userInput);
return aggregated;
```

**汇总策略**:
- 统一口吻：温和、专业、连贯
- 格式清晰：代码高亮、结构化列表
- 避免冗余：不重复详细输出
- 突出重点：提炼关键信息和建议

---

## 本地模型分类 (ModelClassifier)

**文件**: `src/core/agent/dispatch/ModelClassifier.ts`

**职责**: 使用本地 ONNX 模型进行 Agent 和 Scene 分类

**支持模型**:
1. **Qwen2.5-1.5B-Instruct**（默认）
   - 模型大小：~3GB
   - 推理速度：~20ms
   - 准确率：90%+
   - 适用场景：快速分类

2. **ChatGLM3-6B**
   - 模型大小：~12GB
   - 推理速度：~50ms
   - 准确率：95%+
   - 适用场景：高精度分类

**流程**:

```typescript
// 1. 初始化模型
const modelClassifier = new ModelClassifier({
  modelType: 'qwen2.5-1.5b-instruct',
  quantized: true
});
await modelClassifier.init();

// 2. 分类
const result = await modelClassifier.classify(userInput);

// 3. 返回结果
{
  agent: 'coder',
  scene: 'write_code',
  confidence: 0.92
}

// 4. 切换模型（可选）
await modelClassifier.switchModel('chatglm3-6b');
```

**配置**:

```json5
// src/core/templates/agents/scene-classifier.json5
{
  id: "scene-classifier",
  model: {
    primary: "qwen2.5-1.5b-instruct",
    maxTokens: 256,
    temperature: 0.3
  },
  provider: {
    adapter: "local",
    model: "qwen2.5-1.5b-instruct"
  },
  metadata: {
    builtin: true,
    internal: true,
    purpose: "scene-classification"
  }
}
```

---

## 核心组件总结

| 组件 | 文件 | 职责 |
|------|------|------|
| SessionFactory | `src/core/chat/SessionFactory.ts` | 会话初始化 |
| ChatSession | `src/core/chat/ChatSession.ts` | 用户交互 |
| MainAgent | `src/core/agent/dispatch/MainAgent.ts` | 主调度器（5 步流程） |
| IntentRouter | `src/core/intent/IntentRouter.ts` | 意图识别 |
| IntentAnalyzer | `src/core/prompt/IntentAnalyzer.ts` | 场景分析 |
| TaskPlanner | `src/core/agent/dispatch/TaskPlanner.ts` | 任务规划 |
| ModelClassifier | `src/core/agent/dispatch/ModelClassifier.ts` | 本地模型分类 |
| TeamManager | `src/core/agent/team/TeamManager.ts` | 团队管理 |
| AgentLoop | `src/core/agent/AgentLoop.ts` | ReAct 循环 |
| ResultAggregator | `src/core/agent/dispatch/ResultAggregator.ts` | 结果汇总 |
| PromptStore | `src/core/agent/dispatch/PromptStore.ts` | 提示词管理 |

---

## 设计原则

1. **零 LLM 优先**
   - 规则引擎覆盖 80% 常见场景（0ms）
   - LRU 缓存复用相似问题（<1ms）
   - 本地模型分类（~20ms）
   - LLM 仅用于复杂场景（~200ms）

2. **Agent 和 Scene 解耦**
   - Agent：执行者（谁来做）
   - Scene：场景增强 Prompt（怎么做）
   - 两者可以任意组合

3. **分层架构**
   - 会话层：ChatSession
   - 调度层：MainAgent
   - 执行层：TeamManager + AgentLoop
   - 工具层：ToolDispatcher

4. **单一职责**
   - 每个组件职责明确
   - MainAgent 只做调度，不做专业输出
   - 子 Agent 专注于具体任务执行

5. **灵活扩展**
   - 支持自定义 Agent
   - 支持自定义 Scene
   - 支持自定义执行策略

---

## 示例：完整流程

### 输入

```
用户：帮我实现一个用户登录接口
```

### 流程

1. **意图识别**
   - 规则匹配：`/^(写|实现|创建).*(代码|功能|接口)/i`
   - 结果：`{ type: 'simple', intentType: 'code_generation', confidence: 0.9 }`

2. **场景分析**
   - 分析：编程场景，标准复杂度
   - 结果：`{ scene: 'write_code', complexity: 'standard' }`

3. **任务规划**
   - 简单任务，直接执行
   - Agent 选择：
     - 规则匹配：无
     - 小模型分类：`{ agent: 'coder', scene: 'write_code', confidence: 0.92 }`
   - 结果：
     ```json
     {
       "strategy": "single",
       "tasks": [{
         "id": "task-1",
         "agentId": "coder",
         "scene": "write_code",
         "description": "帮我实现一个用户登录接口"
       }]
     }
     ```

4. **执行任务**
   - 创建单成员团队
   - 获取场景增强：`write_code` 场景的 systemPrompt
   - 调用 AgentLoop：
     - 构建消息：`[{ role: 'user', content: '帮我实现一个用户登录接口' }]`
     - 调用 LLM：流式返回代码
     - 工具调用：`Write` 工具写入文件
     - 返回结果

5. **结果汇总**
   - 单任务，直接返回
   - 输出：
     ```
     已为你实现了用户登录接口：
     
     ```typescript
     // src/api/auth.ts
     export async function login(username: string, password: string) {
       // ...
     }
     ```
     
     代码已写入 `src/api/auth.ts`，可直接运行。
     ```

### 输出

```
已为你实现了用户登录接口：

```typescript
// src/api/auth.ts
export async function login(username: string, password: string) {
  // ...
}
```

代码已写入 `src/api/auth.ts`，可直接运行。
```

---

## 配置

### 启用/禁用功能

```typescript
// MainAgent 配置
const config: MainAgentConfig = {
  enableIntentRouter: true,        // 意图识别
  enableSceneAnalysis: true,       // 场景分析
  enableTaskDecomposition: true,   // 任务拆分
  enableResultAggregation: true    // 结果汇总
};
```

### 切换分类模型

```typescript
// 使用 Qwen2.5-1.5B（默认）
const modelClassifier = new ModelClassifier({
  modelType: 'qwen2.5-1.5b-instruct',
  quantized: true
});

// 切换到 ChatGLM3-6B
await modelClassifier.switchModel('chatglm3-6b');
```

### Agent 选择策略

```typescript
// TaskPlanner 配置
const config: AgentSelectionConfig = {
  defaultAgent: 'coder',
  sceneToAgentHints: {
    'explore': 'explore',
    'plan': 'plan',
    'explain': 'general-purpose'
  }
};
```

---

## 性能优化

1. **规则引擎**：0ms，覆盖 80% 常见场景
2. **LRU 缓存**：<1ms，相似问题复用
3. **本地模型**：~20ms（Qwen2.5-1.5B），~50ms（ChatGLM3-6B）
4. **工具并行**：独立工具并行执行
5. **上下文压缩**：自动压缩历史消息，节省 token

---

## 总结

Xuanji 的运行流程分为 **5 个核心步骤**：

1. **意图识别**：规则引擎 + 缓存 + LLM，快速识别用户意图
2. **场景分析**：分析编程场景和任务复杂度
3. **任务规划**：简单任务直接执行，复杂任务智能拆分
4. **执行任务**：TeamManager 协调，AgentLoop 执行 ReAct 循环
5. **结果汇总**：统一口吻包装，格式化输出

**核心优势**：
- **零 LLM 优先**：减少 LLM 调用，提升响应速度
- **Agent 和 Scene 解耦**：灵活组合，适应不同场景
- **本地模型分类**：Qwen2.5-1.5B / ChatGLM3-6B，快速准确
- **分层架构**：职责清晰，易于扩展
