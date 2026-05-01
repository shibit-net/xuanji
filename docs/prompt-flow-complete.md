# 主应用 Prompt 传递完整流程

## 流程概览

```
用户输入
  ↓
主应用（ChatSession）
  ↓
主 Agent（MainAgent）
  ↓
任务规划（TaskPlanner）
  ↓
团队管理（TeamManager）
  ↓
子 Agent 工厂（SubAgentFactory）
  ↓
子 Agent 执行（AgentLoop）
```

---

## 详细流程

### 阶段 1: 用户输入 → 主应用

```
用户输入: "写一个用户登录接口"
  ↓
ChatSession.send(userInput)
  ↓
调用: mainAgent.execute(userInput)
```

**Prompt 状态**：
- 主应用（ChatSession）：使用主 Agent 的 prompt
- 主 Agent prompt = L0（身份）+ 调度相关指令
- **不包含**具体场景的 prompt（write_code / debug 等）

---

### 阶段 2: 主 Agent 分析和规划

```typescript
// MainAgent.execute(userInput)

// 步骤 1: 意图识别
const intents = await intentRouter.route(userInput);
// 返回: intent = null 或某个意图

// 步骤 2: 场景分析
const analysis = await intentAnalyzer.analyze(userInput);
// 返回: { scene: 'write_code', complexity: 'standard' }

// 步骤 3: 任务规划
const plan = await taskPlanner.plan(intent, 'write_code', 'standard', userInput);
// 返回: {
//   strategy: 'single',
//   tasks: [{
//     id: 'task-1',
//     agentId: 'coder',      // ← Agent 选择
//     scene: 'write_code',   // ← Scene 选择
//     description: "写一个用户登录接口"
//   }]
// }
```

**Prompt 状态**：
- 主 Agent 使用自己的 prompt（L0 + 调度指令）
- 识别出场景：`write_code`
- 选择 Agent：`coder`
- **还没有**构建子 Agent 的 prompt

---

### 阶段 3: 获取场景 Prompt

```typescript
// MainAgent.executeSingleTask(plan)

const task = plan.tasks[0];  // { agentId: 'coder', scene: 'write_code' }

// 🎯 获取场景专用 prompt（L1 层）
const sceneEnhancement = await promptStore.getSceneEnhancement('write_code', {
  userInput: plan.goal,
});

// PromptStore.getSceneEnhancement() 内部
async getSceneEnhancement(scene: 'write_code'): Promise<string> {
  const config = this.sceneConfigs.get('write_code');
  // 返回场景描述（L1 层）
  return config.description;
  // 返回: "编写代码、实现功能"
}
```

**Prompt 状态**：
- 获取到 L1 场景 prompt：`write_code` 的描述
- **只是描述**，不是完整的 prompt
- 完整的场景 prompt 在 `l1-coding-scenes.ts` 中定义

---

### 阶段 4: 创建团队配置

```typescript
// MainAgent.executeSingleTask() 继续

// 创建团队配置
const teamConfig: TeamConfig = {
  name: 'single-task',
  strategy: 'sequential',
  members: [{
    id: 'task-1',
    agentId: 'coder',                  // Agent ID
    scene: 'write_code',               // 场景类型
    scenePrompt: sceneEnhancement,     // L1 场景 prompt（描述）
    capabilities: ['write_code'],
  }],
};

// 调用 TeamManager
await teamManager.createTeam(teamConfig);
await teamManager.execute(plan.goal, signal);
```

**Prompt 状态**：
- 传递给 TeamManager：
  - `agentId`: 'coder'
  - `scene`: 'write_code'
  - `scenePrompt`: "编写代码、实现功能"（L1 描述）

---

### 阶段 5: TeamManager 执行成员任务

```typescript
// TeamManager.executeMember(member, task)

const member = {
  id: 'task-1',
  agentId: 'coder',
  scene: 'write_code',
  scenePrompt: "编写代码、实现功能",
};

// 调用 SubAgentFactory
const factoryResult = await subAgentFactory.createAndRun('coder', {
  task: "写一个用户登录接口",
  scene: 'write_code',                    // 传递场景类型
  scenePrompt: member.scenePrompt,        // 传递 L1 场景 prompt
  depth: 1,
  timeout: 120000,
}, signal);
```

**Prompt 状态**：
- 传递给 SubAgentFactory：
  - `agentId`: 'coder'
  - `scene`: 'write_code'
  - `scenePrompt`: "编写代码、实现功能"
- **还没有**构建完整的子 Agent prompt

---

### 阶段 6: SubAgentFactory 组合 Prompt

```typescript
// SubAgentFactory.createSubAgent('coder', options)

// 步骤 1: 查找 Agent 配置
const agentConfig = agentRegistry.get('coder');
// 返回: coder.json5 配置
// {
//   id: 'coder',
//   systemPrompt: "You are a professional coder...",
//   tools: [...],
//   ...
// }

// 步骤 2: 构建 L0 基础层
const buildResult = await promptBuilder.buildForSubAgent({
  agentId: 'coder',
  agentConfig,
  includeProjectContext: true,
});
let systemPrompt = buildResult.prompt;
// 返回: L0 基础层
// """
// # L0: 身份和安全底线
// [base-identity 组件]
// [base-memory-guide 组件]
// [base-task-execution 组件]
// """

// 步骤 3: 追加 Agent 自身的 systemPrompt
if (agentConfig.systemPrompt) {
  systemPrompt += `\n\n---\n# Agent 特性\n${agentConfig.systemPrompt}`;
}
// 现在 systemPrompt =
// """
// # L0: 身份和安全底线
// ...
//
// ---
// # Agent 特性
// You are a professional coder...
// """

// 步骤 4: 追加场景专用 prompt（L1）
if (options.scenePrompt) {
  systemPrompt += `\n\n---\n# 场景增强\n${options.scenePrompt}`;
}
// 现在 systemPrompt =
// """
// # L0: 身份和安全底线
// ...
//
// ---
// # Agent 特性
// You are a professional coder...
//
// ---
// # 场景增强
// 编写代码、实现功能
// """

// 步骤 5: 追加项目规则
const projectRules = loadProjectRules();
if (projectRules) {
  systemPrompt += `\n\n---\n# 项目规则\n${projectRules}`;
}

// 步骤 6: 追加 SubAgent 标记
systemPrompt += `\n\n---\n# SubAgent 模式\nDepth: 1, Role: coder`;

// 最终 systemPrompt =
// """
// # L0: 身份和安全底线
// 你是 Xuanji，专业的 AI 编程助手...
// [base-identity]
// [base-memory-guide]
// [base-task-execution]
//
// ---
// # Agent 特性
// You are a professional coder with expertise in multiple languages...
//
// ---
// # 场景增强
// 编写代码、实现功能
//
// ---
// # 项目规则
// [.xuanji/RULES.md 内容]
//
// ---
// # SubAgent 模式
// Depth: 1, Role: coder
// 不要提出澄清问题，不要启动新的子任务。
// """
```

**Prompt 状态**：
- 完整的子 Agent prompt 已构建
- 包含：L0 + Agent.systemPrompt + L1(scene) + 项目规则 + SubAgent 标记

---

### 阶段 7: 创建 AgentLoop 并执行

```typescript
// SubAgentFactory.createSubAgent() 继续

// 创建 AgentConfig
const finalAgentConfig: AgentConfig = {
  model: agentConfig.model.primary,
  systemPrompt: systemPrompt,  // ← 完整的组合 prompt
  apiKey: provider.apiKey,
  baseURL: provider.baseURL,
  maxTokens: agentConfig.model.maxTokens,
  temperature: agentConfig.model.temperature,
  thinking: agentConfig.model.thinking,
};

// 创建 AgentLoop
const agentLoop = new AgentLoop(
  provider,
  filteredRegistry,
  finalAgentConfig,
  hookRegistry,
  memoryStore,
);

// 执行任务
const result = await agentLoop.run("写一个用户登录接口", signal);
```

**Prompt 状态**：
- AgentLoop 使用完整的 systemPrompt
- 开始 ReAct 循环
- 调用 LLM API，传递 systemPrompt

---

## Prompt 传递链路图

```
┌─────────────────────────────────────────────────────────────┐
│ 用户输入: "写一个用户登录接口"                              │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ ChatSession                                                 │
│ - 主应用 Prompt: L0（身份）+ 调度指令                      │
│ - 不包含具体场景 prompt                                     │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ MainAgent.execute()                                         │
│ - 使用主 Agent 的 prompt                                    │
│ - 分析场景: scene = 'write_code'                           │
│ - 选择 Agent: agentId = 'coder'                            │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ PromptStore.getSceneEnhancement('write_code')              │
│ - 返回: L1 场景 prompt（描述）                             │
│ - "编写代码、实现功能"                                      │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ MainAgent.executeSingleTask()                               │
│ - 创建 TeamConfig:                                          │
│   {                                                         │
│     agentId: 'coder',                                       │
│     scene: 'write_code',                                    │
│     scenePrompt: "编写代码、实现功能"                       │
│   }                                                         │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ TeamManager.executeMember()                                 │
│ - 传递给 SubAgentFactory:                                   │
│   {                                                         │
│     agentId: 'coder',                                       │
│     scene: 'write_code',                                    │
│     scenePrompt: "编写代码、实现功能"                       │
│   }                                                         │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ SubAgentFactory.createSubAgent()                            │
│ - 组合 Prompt:                                              │
│   1. L0（身份）← LayeredPromptBuilder.buildForSubAgent()   │
│   2. Agent.systemPrompt ← coder.json5                      │
│   3. L1（场景）← scenePrompt                               │
│   4. 项目规则 ← .xuanji/RULES.md                           │
│   5. SubAgent 标记                                          │
│                                                             │
│ - 最终 Prompt:                                              │
│   """                                                       │
│   # L0: 身份和安全底线                                     │
│   你是 Xuanji，专业的 AI 编程助手...                       │
│                                                             │
│   ---                                                       │
│   # Agent 特性                                              │
│   You are a professional coder...                          │
│                                                             │
│   ---                                                       │
│   # 场景增强                                                │
│   编写代码、实现功能                                        │
│                                                             │
│   ---                                                       │
│   # 项目规则                                                │
│   [项目规则内容]                                            │
│                                                             │
│   ---                                                       │
│   # SubAgent 模式                                           │
│   Depth: 1, Role: coder                                    │
│   """                                                       │
└─────────────────────────────────────────────────────────────┘
  ↓
┌─────────────────────────────────────────────────────────────┐
│ AgentLoop.run()                                             │
│ - 使用完整的 systemPrompt                                   │
│ - 调用 LLM API                                              │
│ - 执行 ReAct 循环                                           │
│ - 返回结果                                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 关键数据传递

### 1. MainAgent → PromptStore

```typescript
// 传递
scene: 'write_code'
userInput: "写一个用户登录接口"

// 返回
scenePrompt: "编写代码、实现功能"  // L1 描述
```

### 2. MainAgent → TeamManager

```typescript
// 传递
teamConfig: {
  members: [{
    agentId: 'coder',
    scene: 'write_code',
    scenePrompt: "编写代码、实现功能",
  }]
}
```

### 3. TeamManager → SubAgentFactory

```typescript
// 传递
agentId: 'coder'
options: {
  task: "写一个用户登录接口",
  scene: 'write_code',
  scenePrompt: "编写代码、实现功能",
  depth: 1,
}
```

### 4. SubAgentFactory → AgentLoop

```typescript
// 传递
agentConfig: {
  systemPrompt: `
    # L0: 身份和安全底线
    ...
    
    ---
    # Agent 特性
    You are a professional coder...
    
    ---
    # 场景增强
    编写代码、实现功能
    
    ---
    # 项目规则
    ...
    
    ---
    # SubAgent 模式
    Depth: 1, Role: coder
  `
}
```

---

## Prompt 组合时机

| 阶段 | 组件 | Prompt 状态 |
|------|------|------------|
| 1 | ChatSession | 主 Agent prompt（L0 + 调度） |
| 2 | MainAgent | 使用主 Agent prompt，分析场景 |
| 3 | PromptStore | 返回 L1 场景 prompt（描述） |
| 4 | MainAgent | 传递 scene + scenePrompt |
| 5 | TeamManager | 转发 scene + scenePrompt |
| 6 | SubAgentFactory | **组合完整 prompt**（L0 + Agent + L1 + 规则） |
| 7 | AgentLoop | 使用完整 prompt 执行 |

**关键点**：
- Prompt 组合发生在 **SubAgentFactory**
- MainAgent 只负责传递 scene 和 scenePrompt
- SubAgentFactory 负责组合 L0 + Agent + L1 + 规则

---

## 不同场景的 Prompt 差异

### 场景 1: write_code

```
用户: "写一个登录接口"
  ↓
scene: 'write_code'
  ↓
scenePrompt: "编写代码、实现功能"
  ↓
最终 Prompt:
  L0（身份）
  + coder.systemPrompt
  + "编写代码、实现功能"  ← write_code 场景
  + 项目规则
```

### 场景 2: debug

```
用户: "修复这个 bug"
  ↓
scene: 'debug'
  ↓
scenePrompt: "排查问题、修复bug、调试代码"
  ↓
最终 Prompt:
  L0（身份）
  + coder.systemPrompt
  + "排查问题、修复bug、调试代码"  ← debug 场景
  + 项目规则
```

### 场景 3: explore

```
用户: "探索这个项目的架构"
  ↓
scene: 'explore'
agentId: 'explore'  ← 不同的 Agent
  ↓
scenePrompt: "探索代码库、理解架构、分析项目"
  ↓
最终 Prompt:
  L0（身份）
  + explore.systemPrompt  ← 不同的 Agent prompt
  + "探索代码库、理解架构、分析项目"  ← explore 场景
  + 项目规则
```

---

## 总结

**Prompt 传递链路**：
```
用户输入
  → MainAgent（分析场景）
  → PromptStore（获取 L1 场景 prompt）
  → TeamManager（转发）
  → SubAgentFactory（组合完整 prompt）
  → AgentLoop（执行）
```

**Prompt 组合公式**：
```
子 Agent Prompt = L0（LayeredPromptBuilder）
                + Agent.systemPrompt（agent 配置）
                + L1（scenePrompt）
                + 项目规则
                + SubAgent 标记
```

**关键设计**：
- 主 Agent：只加载必要的基础能力（L0 + 调度）
- 子 Agent：加载完整能力（L0 + Agent + L1 + 规则）
- Prompt 组合：在 SubAgentFactory 统一完成
- Agent 和 Scene：解耦，可以任意组合
