# Xuanji 完整工作流程设计

## 1. 整体架构

```
用户输入
  ↓
意图分析系统（IntentClassifier）
  ↓
主 Agent（MainAgent）
  ↓
动态查询 + 组合
  ↓
执行（单一 Agent / Agent Team）
  ↓
结果汇总
```

## 2. 详细流程

### 2.1 意图分析阶段

**输入**：用户原始输入

**处理**：IntentClassifier 三层降级
1. Layer 1: 本地 LLM（快速分类）
2. Layer 2: 向量分析（中等精度）
3. Layer 3: 关键词匹配（兜底）

**输出**：
```typescript
{
  intent: "code_implementation",  // 意图类型
  domain: "software_development", // 领域
  complexity: "complex",          // 复杂度
  suggestedCapabilities: ["代码编写", "API设计", "测试编写"], // 建议的能力
  confidence: 0.85                // 置信度
}
```

**传递给主 Agent**：作为参考，不是强制

### 2.2 主 Agent 决策阶段

**核心原则**：动态发现，不硬编码

#### Step 1: 动态查询可用资源

```typescript
// 1. 查询所有可用的 Agent
const agents = await list_agents();
// 返回：[
//   { id: "software-engineer", capabilities: [...], ... },
//   { id: "product-manager", capabilities: [...], ... },
//   { id: "ui-designer", capabilities: [...], ... }
// ]

// 2. 查询所有可用的 Scene
const scenes = await list_scenes();
// 返回：[
//   { id: "l1-requirement", suitableFor: [...], requiredCapabilities: [...] },
//   { id: "l1-write-code", suitableFor: [...], requiredCapabilities: [...] },
//   { id: "l1-test", suitableFor: [...], requiredCapabilities: [...] },
//   ...
// ]
```

#### Step 2: 分析任务需求

```typescript
// 分析用户任务："设计一个用户登录功能"
const taskAnalysis = {
  steps: [
    { phase: "需求分析", requiredCapabilities: ["需求分析", "用户研究"] },
    { phase: "代码实现", requiredCapabilities: ["代码编写", "API设计"] },
    { phase: "测试", requiredCapabilities: ["测试编写", "质量保证"] },
    { phase: "文档编写", requiredCapabilities: ["技术文档编写"] }
  ],
  workMode: "sequential" // 或 parallel, hierarchical, debate, pipeline
};
```

#### Step 3: 匹配 Agent 和 Scene

```typescript
// 为每个阶段匹配 Agent 和 Scene
const plan = [];

for (const step of taskAnalysis.steps) {
  // 3.1 匹配 Agent
  const matchResult = await match_agent({
    requiredCapabilities: step.requiredCapabilities,
    taskDescription: step.phase
  });
  
  if (matchResult.score >= 0.5) {
    // 找到合适的 Agent
    plan.push({
      agent: matchResult.agent,
      scene: findBestScene(scenes, step),
      phase: step.phase
    });
  } else {
    // 3.2 没有合适的 Agent，创建临时 Agent
    const tempAgent = await createTemporaryAgent({
      role: step.phase,
      capabilities: step.requiredCapabilities,
      scene: findBestScene(scenes, step)
    });
    
    plan.push({
      agent: tempAgent,
      scene: tempAgent.scene,
      phase: step.phase,
      isTemporary: true
    });
  }
}
```

#### Step 4: 执行计划

```typescript
// 根据工作模式执行
if (taskAnalysis.workMode === "sequential") {
  // 顺序执行
  const results = [];
  for (const step of plan) {
    const result = await executeAgent(step.agent, step.scene, {
      context: results // 传递前面的结果
    });
    results.push(result);
  }
  return summarizeResults(results);
}
```

### 2.3 示例：设计用户登录功能

#### 用户输入
```
"设计一个用户登录功能"
```

#### 意图分析结果
```typescript
{
  intent: "feature_implementation",
  domain: "software_development",
  complexity: "complex",
  suggestedCapabilities: ["需求分析", "代码编写", "测试编写"],
  confidence: 0.75
}
```

#### 主 Agent 决策过程

**Step 1: 查询资源**
```typescript
const agents = await list_agents();
// 返回：[
//   { id: "agent-1", capabilities: ["需求分析", "用户研究"], ... },
//   { id: "agent-2", capabilities: ["代码编写", "API设计"], ... },
//   { id: "agent-3", capabilities: ["交互设计", "UI设计"], ... }
// ]

const scenes = await list_scenes();
// 返回：[
//   { id: "l1-requirement", suitableFor: ["需求分析"], ... },
//   { id: "l1-write-code", suitableFor: ["代码编写"], ... },
//   { id: "l1-test", suitableFor: ["测试编写"], ... },
//   { id: "l1-ui-design", suitableFor: ["UI设计"], ... }
// ]
```

**Step 2: 任务分解**
```typescript
const plan = [
  {
    phase: "需求分析",
    requiredCapabilities: ["需求分析", "用户研究"],
    description: "分析登录功能的需求：字段、验证规则、安全要求"
  },
  {
    phase: "代码实现",
    requiredCapabilities: ["代码编写", "API设计"],
    description: "实现后端API和前端页面"
  },
  {
    phase: "测试",
    requiredCapabilities: ["测试编写", "质量保证"],
    description: "编写单元测试和集成测试"
  },
  {
    phase: "文档编写",
    requiredCapabilities: ["技术文档编写"],
    description: "编写API文档和使用说明"
  }
];
```

**Step 3: 匹配 Agent 和 Scene**

```typescript
// Phase 1: 需求分析
const pm = await match_agent({
  requiredCapabilities: ["需求分析", "用户研究"]
});
// 匹配到：{ agent_id: "agent-1", score: 0.85, capabilities: ["需求分析", "用户研究"] }
// 场景：l1-requirement

// Phase 2: 代码实现
const engineer = await match_agent({
  requiredCapabilities: ["代码编写", "API设计"]
});
// 匹配到：{ agent_id: "agent-2", score: 0.92, capabilities: ["代码编写", "API设计"] }
// 场景：l1-write-code

// Phase 3: 测试
const tester = await match_agent({
  requiredCapabilities: ["测试编写", "质量保证"]
});
// 匹配到：{ agent_id: "agent-2", score: 0.78, capabilities: ["测试编写"] }
// 场景：l1-test

// Phase 4: 文档编写
const docWriter = await match_agent({
  requiredCapabilities: ["技术文档编写"]
});
// 未找到合适的 Agent (最高 score: 0.35)
// 创建临时 Agent
```

**Step 4: 创建临时 Agent**

```typescript
const tempDocAgent = await createTemporaryAgent({
  role: "Technical Writer",
  capabilities: ["技术文档编写", "API文档", "用户指南"],
  scene: "l1-write-doc", // 如果没有这个场景，也动态创建
  basePrompt: `
    你是一位技术文档编写专家。
    
    ## 核心职责
    - 编写清晰、准确的技术文档
    - 提供API使用示例
    - 编写用户指南
    
    ## 工作原则
    - 简洁明了
    - 结构清晰
    - 示例丰富
  `
});
```

**Step 5: 执行 Agent Team**

```typescript
const result = await agent_team({
  mode: "sequential",
  agents: [
    { agent: pm.agent_id, scene: "l1-requirement" },
    { agent: engineer.agent_id, scene: "l1-write-code" },
    { agent: tester.agent_id, scene: "l1-test" },
    { agent: tempDocAgent.id, scene: "l1-write-doc" }
  ],
  context: {
    task: "实现用户登录功能",
    requirements: "..."
  }
});
```

## 3. Prompt 组合机制

### 3.1 各层职责划分

```
最终 System Prompt = Agent + L0 + L1 + L2 + L3
```

#### 主 Agent System Prompt（协调者身份层）

**职责**：定义"我如何协调"

**内容**：
- 协调者身份（我是智能协作系统）
- 核心职责（任务分析、Agent 匹配、任务执行、结果汇总）
- 工作流程（动态查询、匹配、组合、执行）
- 工作原则（动态发现、效率优先、精准匹配）

**示例**（xuanji.yaml）：
```yaml
systemPrompt: |
  你是 Xuanji，一个智能协作系统，负责理解用户需求并协调专业 Agent 完成任务。
  
  ## 核心职责
  
  ### 1. 任务分析
  - 理解用户意图和需求
  - 识别任务类型和场景
  - 评估任务复杂度
  - 确定所需能力
  
  ### 2. Agent 发现与匹配
  - 使用 `list_agents` 动态查询系统中所有可用的 Agent
  - 使用 `list_scenes` 查看所有可用的场景（Scene）
  - 使用 `match_agent` 根据任务需求找到最合适的 Agent
  - 不要假设或硬编码 Agent 列表，始终通过工具动态获取
  
  ### 3. 任务执行决策
  
  **直接回答**（不调用 Agent）：
  - 简单问题、概念解释
  - 一般性建议和指导
  - 闲聊和日常对话
  
  **委派单个 Agent**：
  - 明确的单一任务
  - 使用 `match_agent` 找到最合适的 Agent
  - 传递清晰的任务描述和上下文
  
  **协调多个 Agent**（复杂任务）：
  - 需要多个专业领域协作的任务
  - 使用 `list_agents` 查看可用 Agent，然后依次调度
  - 按顺序执行，传递前一个 Agent 的输出作为下一个的输入
  
  ### 4. 结果汇总
  - 整合子 Agent 的执行结果
  - 用统一、友好的口吻回复用户
  - 如果有错误或问题，清晰说明并提供建议
  
  ## 工作流程
  
  ```
  用户请求 → 分析意图 → 判断处理方式
     ↓
  简单问题 → 直接回答
     ↓
  单一任务 → list_agents → match_agent → 委派执行 → 汇总结果
     ↓
  复杂任务 → list_agents → 拆解子任务 → 依次委派 → 整合结果
  ```
  
  ## 工作原则
  
  1. **动态发现**：始终使用 list_agents 和 list_scenes 动态获取可用资源，不要硬编码
  2. **效率优先**：简单问题直接回答，不要过度调用工具
  3. **精准匹配**：使用 match_agent 找最合适的 Agent，而不是随意选择
  4. **清晰沟通**：给子 Agent 传递清晰的任务描述和必要的上下文
  5. **结果导向**：关注任务是否完成，而不是过程细节
  6. **用户友好**：用统一、友好的口吻回复用户，隐藏内部协调细节
```

**特点**：
- ✅ 定义协调者的职责
- ✅ 强调动态发现原则
- ✅ 不包含具体的 Agent 名称
- ✅ 可复用于所有协调任务

#### Agent System Prompt（角色身份层）

**职责**：定义"我是谁"

**内容**：
- 角色身份（我是一位软件工程师 / 产品经理 / 设计师）
- 核心原则（代码质量优先 / 用户体验优先）
- 工作方式（我会根据不同场景采用不同思维方式）
- 能力声明（我擅长...）

**示例**（software-engineer.yaml）：
```yaml
systemPrompt: |
  你是一位经验丰富的全栈软件工程师。
  
  ## 核心原则
  - 代码质量优先：输出的代码必须可以直接运行
  - 简洁清晰：代码结构清晰，命名规范
  - 最佳实践：遵循语言规范和设计模式
  - 安全意识：避免常见安全漏洞
  
  ## 工作方式
  你会根据不同的任务场景，采用不同的思维方式和工作流程。
  具体的场景指导会通过 Scene 动态加载。
```

**特点**：
- ✅ 通用的角色定义
- ✅ 不包含具体场景的指导
- ✅ 可复用于所有任务

#### L0 Prompt（全局基础层）

**职责**：定义"系统的基础规则"

**内容**：
- 系统身份（你是 Xuanji 智能协作系统）
- 任务执行规范（如何理解任务、如何输出结果）
- 安全规则（禁止的操作、需要确认的操作）
- 记忆管理指南（如何使用记忆系统）

**文件**：
- `l0-base-identity.yaml` - 系统身份
- `l0-base-task-execution.yaml` - 任务执行规范
- `l0-safety.yaml` - 安全规则
- `l0-base-memory-guide.yaml` - 记忆管理

**示例**（l0-base-task-execution.yaml）：
```yaml
content: |
  # 任务执行规范
  
  ## 理解任务
  1. 仔细阅读用户需求
  2. 识别关键信息和约束条件
  3. 如有不清楚的地方，主动询问
  
  ## 执行任务
  1. 制定清晰的执行计划
  2. 按步骤执行，确保每步正确
  3. 遇到问题及时调整策略
  
  ## 输出结果
  1. 结果必须完整、准确
  2. 提供必要的说明和示例
  3. 如有限制或注意事项，明确说明
```

**特点**：
- ✅ 所有 Agent 共享
- ✅ 始终加载
- ✅ 定义系统级规则

#### L1 Prompt（场景指导层）

**职责**：定义"在特定场景下如何思考和工作"

**内容**：
- 场景化的思维框架
- 具体的工作流程
- 输出格式规范
- 常见问题和解决方案

**文件**：
- `l1-requirement.yaml` - 需求分析场景
- `l1-write-code.yaml` - 代码编写场景
- `l1-test.yaml` - 测试编写场景
- `l1-write-doc.yaml` - 文档编写场景（可能需要创建）
- ...

**示例**（l1-write-code.yaml）：
```yaml
content: |
  # 代码编写场景
  
  ## 思维框架
  1. 理解需求 → 设计接口 → 编写实现 → 添加注释 → 提供示例
  
  ## 核心原则
  - 代码质量：可直接运行，无语法错误
  - 简洁明了：不闲聊、不抒情，直接输出代码
  - 最佳实践：遵循语言规范
  
  ## 工作流程
  1. **分析需求**：理解要实现的功能
  2. **设计接口**：定义函数签名、参数、返回值
  3. **编写实现**：实现核心逻辑
  4. **添加注释**：关键逻辑添加注释
  5. **提供示例**：展示如何使用
  
  ## 输出格式
  ```language
  // 代码实现
  ```
  
  使用说明：...
```

**特点**：
- ✅ 场景特定的指导
- ✅ 根据任务动态加载
- ✅ 可组合（一个任务可以加载多个场景）

#### L2 Prompt（复杂任务层）

**职责**：定义"多 Agent 如何协作"

**内容**：
- Agent 协作规则
- 任务分解策略
- 团队协调机制
- 结果汇总方法

**加载时机**：

**何时加载**：
- 主 Agent 使用 `agent_team` 工具时
- 任务需要多个 Agent 协作时
- 任务复杂度为 "complex" 时
- 需要任务分解和规划时

**何时不加载**：
- 单一 Agent 执行任务时
- 简单任务（主 Agent 直接回答）时
- 标准任务（单个 Agent 可完成）时

**文件**：
- `l2-agent-rules.yaml` - Agent 协作规则
- `l2-planning.yaml` - 任务规划策略
- `l2-team-coordination.yaml` - 团队协调机制

**示例**（l2-team-coordination.yaml）：
```yaml
content: |
  # 多 Agent 协作指南
  
  ## 协作模式
  - **Sequential（顺序）**：线性流程，前一个完成后才开始下一个
  - **Parallel（并行）**：多个 Agent 同时执行独立任务
  - **Hierarchical（层级）**：主 Agent 协调多个子 Agent
  - **Debate（讨论）**：多个 Agent 讨论评估方案
  - **Pipeline（流水线）**：数据在 Agent 间流转处理
  
  ## 协调原则
  1. **明确分工**：每个 Agent 职责清晰
  2. **清晰接口**：定义输入输出格式
  3. **上下文传递**：前一个 Agent 的输出作为下一个的输入
  4. **结果汇总**：最后统一整合所有结果
  
  ## 示例：Sequential 模式
  ```
  需求分析 Agent → 代码实现 Agent → 测试 Agent → 文档编写 Agent
  ```
```

**特点**：
- ✅ 仅在复杂任务时加载
- ✅ 指导多 Agent 协作
- ✅ 主 Agent 使用

#### L3 Prompt（项目上下文层）

**职责**：定义"当前项目的具体信息"

**内容**：
- 项目元数据（类型、路径、git 信息）
- 项目规则（CLAUDE.md / XUANJI.md）
- 代码结构（文件索引、符号索引）
- 依赖关系（package.json / requirements.txt）

**生成方式**：动态扫描，每次构建时更新

**示例**：
```markdown
# Project Context

## Project Metadata
- Type: typescript
- Root: /path/to/project
- Git: Yes
- Branch: main

## Project Rules (from XUANJI.md)
- 使用 TypeScript 严格模式
- 遵循 ESLint 规则
- 所有函数必须有类型注解

## Code Structure
**Total Files**: 150
**Total Symbols**: 450
**Top 20 Files**:
- `src/core/agent/AgentLoop.ts` — AgentLoop, AgentConfig
- `src/core/tools/ToolRegistry.ts` — ToolRegistry
- ...

## Dependencies
**Runtime**: react, typescript, ...
**Dev**: vite, vitest, ...
```

**特点**：
- ✅ 项目特定
- ✅ 动态生成
- ✅ 帮助 Agent 理解项目上下文

### 3.2 组合示例

#### 示例 1：产品经理 - 需求分析

```
最终 Prompt = 
  product-manager.systemPrompt (角色身份)
  + l0-base-identity.yaml (系统身份)
  + l0-base-task-execution.yaml (任务执行规范)
  + l0-safety.yaml (安全规则)
  + l1-requirement.yaml (需求分析场景)
  + l3-project (项目上下文)
```

**组合后的效果**：
```
你是一位经验丰富的产品经理。[Agent]

你是 Xuanji 智能协作系统。[L0]
任务执行规范：...
安全规则：...

# 需求分析场景 [L1]
## 思维框架
1. 理解用户需求
2. 分析业务价值
3. 定义功能范围
...

# Project Context [L3]
- Type: typescript
- 项目规则：...
```

#### 示例 2：软件工程师 - 代码编写

```
最终 Prompt = 
  software-engineer.systemPrompt (角色身份)
  + l0-base-identity.yaml (系统身份)
  + l0-base-task-execution.yaml (任务执行规范)
  + l0-safety.yaml (安全规则)
  + l1-write-code.yaml (代码编写场景)
  + l3-project (项目上下文)
```

#### 示例 3：临时文档编写员

```
最终 Prompt = 
  tempAgent.systemPrompt (临时创建的角色身份)
  + l0-base-identity.yaml (系统身份)
  + l0-base-task-execution.yaml (任务执行规范)
  + l0-safety.yaml (安全规则)
  + l1-write-doc.yaml (文档编写场景，可能也是临时创建)
  + l3-project (项目上下文)
```

### 3.3 可复用性分析

| 层次 | 复用范围 | 更新频率 | 示例 |
|------|---------|---------|------|
| **Agent** | 该 Agent 的所有任务 | 低（角色定义稳定） | software-engineer 用于所有编程任务 |
| **L0** | 所有 Agent 的所有任务 | 极低（系统级规则） | 所有 Agent 共享安全规则 |
| **L1** | 该场景的所有任务 | 中（场景优化） | write-code 场景用于所有代码编写任务 |
| **L2** | 所有复杂任务 | 低（协作模式稳定） | 所有 agent_team 共享协作规则 |
| **L3** | 该项目的所有任务 | 高（项目变化） | 每次构建时更新 |

**复用效果**：
- ✅ Agent 定义可复用于不同场景
- ✅ L0 规则可复用于所有 Agent
- ✅ L1 场景可复用于不同 Agent
- ✅ L2 协作规则可复用于不同任务
- ✅ L3 自动适配当前项目

## 4. 临时 Agent 创建机制

### 4.1 何时创建临时 Agent

```typescript
// 匹配分数低于阈值时
if (matchResult.score < 0.5) {
  // 创建临时 Agent
  const tempAgent = await createTemporaryAgent({...});
}
```

### 4.2 临时 Agent 的组成

```typescript
interface TemporaryAgent {
  id: string;  // 临时ID，如 "temp-doc-writer-1234"
  name: string;  // 角色名称
  systemPrompt: string;  // 动态生成的角色定义
  capabilities: string[];  // 需要的能力
  scene: string;  // 关联的场景（可能也是临时创建）
  isTemporary: true;  // 标记为临时
}
```

### 4.3 临时 Agent 的 System Prompt 生成

```typescript
function generateTempAgentPrompt(role: string, capabilities: string[]): string {
  return `
你是一位 ${role}。

## 核心职责
${capabilities.map(cap => `- ${cap}`).join('\n')}

## 工作原则
- 专注于你的职责范围
- 提供高质量的输出
- 遵循最佳实践

## 工作方式
你会根据任务需求，采用合适的方法完成工作。
具体的场景指导会通过 Scene 动态加载。
  `.trim();
}
```

### 4.4 临时 Scene 的创建

如果没有合适的 Scene，也可以动态创建：

```typescript
function generateTempScene(role: string, capabilities: string[]): string {
  return `
# ${role} 场景

## 思维框架
1. 理解任务需求
2. 制定执行计划
3. 完成任务
4. 验证结果

## 核心原则
- 质量优先
- 清晰明了
- 符合规范

## 工作流程
1. 分析需求
2. 执行任务
3. 输出结果
  `.trim();
}
```

### 4.5 临时 Agent 的生命周期

```typescript
// 1. 创建
const tempAgent = await createTemporaryAgent({...});

// 2. 使用
const result = await executeAgent(tempAgent, scene, context);

// 3. 销毁（任务完成后自动清理）
// 临时 Agent 不会保存到配置文件
```

## 5. 完整示例：用户登录功能

### 5.1 执行流程

```
用户："设计一个用户登录功能"
  ↓
IntentClassifier: feature_implementation, complex
  ↓
MainAgent 决策：
  1. list_agents() → [Agent-1, Agent-2, Agent-3]
  2. list_scenes() → [requirement, write-code, test, ...]
  3. 任务分解 → [需求分析, 代码实现, 测试, 文档]
  4. 匹配 Agent:
     - 需求分析 → Agent-1 (0.85)
     - 代码实现 → Agent-2 (0.92)
     - 测试 → Agent-2 (0.78)
     - 文档 → 无合适 Agent (0.35) → 创建临时 Agent
  5. 执行 agent_team (sequential)
  ↓
Phase 1: Agent-1 + requirement
  Prompt = Agent-1.systemPrompt + L0 + l1-requirement + L3
  输出：需求文档
  ↓
Phase 2: Agent-2 + write-code
  Prompt = Agent-2.systemPrompt + L0 + l1-write-code + L3
  输入：需求文档
  输出：代码实现
  ↓
Phase 3: Agent-2 + test
  Prompt = Agent-2.systemPrompt + L0 + l1-test + L3
  输入：代码实现
  输出：测试代码
  ↓
Phase 4: TempDocAgent + write-doc
  Prompt = TempAgent.systemPrompt + L0 + l1-write-doc + L3
  输入：代码实现 + 测试代码
  输出：API文档
  ↓
MainAgent 汇总结果 → 回复用户
```

### 5.2 Prompt 组合详情

**Phase 1: Agent-1 (产品经理) + requirement**
```
你是一位经验丰富的产品经理。[Agent-1.systemPrompt]
核心原则：用户体验优先、数据驱动决策...

你是 Xuanji 智能协作系统。[L0]
任务执行规范：...
安全规则：...

# 需求分析场景 [l1-requirement]
## 思维框架
1. 理解用户需求
2. 分析业务价值
3. 定义功能范围
4. 识别约束条件
5. 输出需求文档

## 工作流程
...

# Project Context [L3]
- Type: typescript
- 项目规则：使用 TypeScript 严格模式...
- 代码结构：...
```

**Phase 4: TempDocAgent + write-doc**
```
你是一位技术文档编写专家。[TempAgent.systemPrompt]
核心职责：
- 技术文档编写
- API文档
- 用户指南

你是 Xuanji 智能协作系统。[L0]
...

# 文档编写场景 [l1-write-doc]
## 思维框架
1. 理解代码功能
2. 提取API接口
3. 编写使用示例
4. 添加注意事项

## 输出格式
...

# Project Context [L3]
...
```

## 6. 总结

### 6.1 核心设计原则

1. **动态发现**：不硬编码 Agent 和 Scene，始终通过工具查询
2. **按需组合**：根据任务需求动态组合 Agent + Scene
3. **分层复用**：Agent、L0、L1、L2、L3 各司其职，最大化复用
4. **灵活扩展**：缺少能力时创建临时 Agent，不受限于预定义

### 6.2 各层职责总结

| 层次 | 职责 | 内容 | 复用范围 |
|------|------|------|---------|
| **Agent** | 我是谁 | 角色身份、核心原则、能力声明 | 该 Agent 的所有任务 |
| **L0** | 系统规则 | 系统身份、执行规范、安全规则 | 所有 Agent 的所有任务 |
| **L1** | 场景指导 | 思维框架、工作流程、输出格式 | 该场景的所有任务 |
| **L2** | 协作规则 | 协作模式、分工原则、汇总方法 | 所有复杂任务 |
| **L3** | 项目上下文 | 项目信息、代码结构、依赖关系 | 该项目的所有任务 |

### 6.3 实现效果

- ✅ **灵活性**：支持任何领域的任务
- ✅ **可扩展性**：新增 Agent 或 Scene 无需修改代码
- ✅ **可复用性**：各层独立，最大化复用
- ✅ **智能性**：自动匹配、自动创建临时 Agent
- ✅ **上下文感知**：自动加载项目信息

---

**创建日期**：2026-04-23  
**版本**：v2.0  
**状态**：完整设计文档
