# 正确的 Prompt 组合逻辑

## 核心原则

### 1. 主 Agent 的 Prompt
- **只加载必要的**基础能力
- L0（身份）+ 调度相关的指令
- **不需要**具体场景的 prompt

### 2. 子 Agent 的 Prompt
- **必要的**基础能力（L0）
- **Agent 自身的** systemPrompt（agent 特性）
- **具体任务的** prompt（L1 场景增强）

### 3. Prompt 组合公式

```
子 Agent 最终 Prompt = L0（身份） + Agent.systemPrompt（agent 特性） + L1（场景增强） + 项目规则 + SubAgent 标记
```

---

## 完整流程

### 步骤 1: MainAgent 分析场景

```typescript
// MainAgent.execute()
const analysis = await intentAnalyzer.analyze(userInput);
// 返回: { scene: 'write_code', complexity: 'standard' }
```

### 步骤 2: TaskPlanner 选择 Agent

```typescript
// TaskPlanner.plan()
const agentId = await selectAgentForScene('write_code', userInput);
// 返回: 'coder'

// 返回任务计划
{
  strategy: 'single',
  tasks: [{
    agentId: 'coder',        // Agent: 执行者
    scene: 'write_code',     // Scene: 场景
  }]
}
```

### 步骤 3: MainAgent 获取场景 Prompt

```typescript
// MainAgent.executeSingleTask()
const sceneEnhancement = await promptStore.getSceneEnhancement('write_code');
// 返回: L1 场景专用 prompt（不包含 L0）

// 创建团队配置
const teamConfig = {
  members: [{
    agentId: 'coder',
    scene: 'write_code',
    scenePrompt: sceneEnhancement,  // L1 场景 prompt
  }]
};
```

### 步骤 4: TeamManager 传递信息

```typescript
// TeamManager.executeMember()
await subAgentFactory.createAndRun('coder', {
  task: "写一个登录接口",
  scene: 'write_code',
  scenePrompt: sceneEnhancement,  // L1 场景 prompt
});
```

### 步骤 5: SubAgentFactory 组合 Prompt

```typescript
// SubAgentFactory.createSubAgent()

// 1. 构建 L0 基础层
const buildResult = await promptBuilder.buildForSubAgent({
  agentId: 'coder',
  agentConfig,
});
let systemPrompt = buildResult.prompt;  // L0

// 2. 追加 Agent 自身的 systemPrompt
if (agentConfig.systemPrompt) {
  systemPrompt += `\n\n---\n# Agent 特性\n${agentConfig.systemPrompt}`;
}

// 3. 追加场景专用 prompt（L1）
if (options.scenePrompt) {
  systemPrompt += `\n\n---\n# 场景增强\n${options.scenePrompt}`;
}

// 4. 追加项目规则
const projectRules = loadProjectRules();
if (projectRules) {
  systemPrompt += `\n\n---\n# 项目规则\n${projectRules}`;
}

// 5. 追加 SubAgent 标记
systemPrompt += `\n\n---\n# SubAgent 模式\nDepth: 1, Role: coder`;
```

---

## 最终 Prompt 结构

```
# L0: 身份和安全底线
你是 Xuanji，专业的 AI 编程助手...
[base-identity 组件内容]
[base-memory-guide 组件内容]
[base-task-execution 组件内容]

---
# Agent 特性
[coder.json5 中的 systemPrompt]
You are a professional coder...

---
# 场景增强
[write_code 场景的 L1 prompt]
你是专业编程工程师，严谨、简洁，输出代码可直接运行。
核心原则：
- 代码质量：可直接运行，无语法错误
- 简洁明了：附带1-2句核心解释
- 最佳实践：遵循语言规范和设计模式

---
# 项目规则
[.xuanji/RULES.md 内容]

---
# SubAgent 模式
Depth: 1, Role: coder
不要提出澄清问题，不要启动新的子任务。
```

---

## 不同场景的 Prompt 差异

### 场景 1: write_code

```
L0（身份）
  + Agent.systemPrompt（coder 的特性）
  + L1（write_code 场景）← 严谨、低温度、可直接运行
  + 项目规则
  + SubAgent 标记
```

### 场景 2: debug

```
L0（身份）
  + Agent.systemPrompt（coder 的特性）
  + L1（debug 场景）← 细致、步骤清晰、定位根因
  + 项目规则
  + SubAgent 标记
```

### 场景 3: explore

```
L0（身份）
  + Agent.systemPrompt（explore 的特性）← 快速定位、理解架构
  + L1（explore 场景）← 探索策略、代码地图
  + 项目规则
  + SubAgent 标记
```

---

## Agent 和 Scene 的组合

### 相同 Agent，不同 Scene

```
coder + write_code  → 严谨编程
coder + debug       → 细致调试
coder + review      → 批判性审查
```

### 不同 Agent，相同 Scene

```
coder + write_code   → 通用编程能力 + 严谨编程
explore + write_code → 探索能力 + 严谨编程（不常见）
```

### 不同 Agent，不同 Scene

```
coder + write_code   → 通用编程 + 严谨编程
explore + explore    → 探索能力 + 探索策略
plan + plan          → 设计能力 + 规划策略
```

---

## 代码修改总结

### 1. PromptStore.getSceneEnhancement()

**修改前**：
```typescript
// 返回完整 prompt（L0 + L1）
return buildResult.prompt;
```

**修改后**：
```typescript
// 只返回 L1 场景 prompt
const config = this.sceneConfigs.get(scene);
return config.description || '';
```

### 2. MainAgent.executeSingleTask()

**修改前**：
```typescript
members: [{
  agentId: 'coder',
  systemPrompt: sceneEnhancement,  // 完整 prompt
}]
```

**修改后**：
```typescript
members: [{
  agentId: 'coder',
  scene: 'write_code',              // 场景类型
  scenePrompt: sceneEnhancement,    // L1 场景 prompt
}]
```

### 3. TeamMember 类型

**新增字段**：
```typescript
export interface TeamMember {
  // ...
  scene?: string;         // 场景类型
  scenePrompt?: string;   // L1 场景 prompt
}
```

### 4. SubAgentFactoryOptions 类型

**新增字段**：
```typescript
export interface SubAgentFactoryOptions {
  // ...
  scene?: string;         // 场景类型
  scenePrompt?: string;   // L1 场景 prompt
}
```

### 5. SubAgentFactory.createSubAgent()

**新逻辑**：
```typescript
// 1. L0 基础层
const buildResult = await promptBuilder.buildForSubAgent({...});
let systemPrompt = buildResult.prompt;

// 2. Agent 特性
if (agentConfig.systemPrompt) {
  systemPrompt += `\n\n---\n# Agent 特性\n${agentConfig.systemPrompt}`;
}

// 3. 场景增强
if (options.scenePrompt) {
  systemPrompt += `\n\n---\n# 场景增强\n${options.scenePrompt}`;
}

// 4. 项目规则
// 5. SubAgent 标记
```

---

## 优势

### 1. 职责清晰

- **MainAgent**：只负责调度，不构建完整 prompt
- **PromptStore**：只提供场景 prompt（L1）
- **SubAgentFactory**：负责组合完整 prompt

### 2. 灵活组合

- Agent 和 Scene 可以任意组合
- Agent 的特性（systemPrompt）得到保留
- 场景增强（scenePrompt）动态添加

### 3. 易于扩展

- 新增 Agent：只需添加配置文件
- 新增 Scene：只需添加 L1 组件
- 两者独立扩展，互不影响

### 4. 向后兼容

- 如果不提供 `scenePrompt`，使用 agent 配置中的 prompt
- 如果不提供 `scene`，不添加场景增强
- 保持原有逻辑不变

---

## 测试验证

### 测试 1: 相同 Agent，不同 Scene

```typescript
// 场景 1
await mainAgent.execute("写一个登录接口");
// Agent: coder, Scene: write_code
// Prompt: L0 + coder.systemPrompt + write_code.prompt

// 场景 2
await mainAgent.execute("修复这个 bug");
// Agent: coder, Scene: debug
// Prompt: L0 + coder.systemPrompt + debug.prompt
```

**验证**：两次调用使用相同的 Agent，但 prompt 不同（场景部分不同）

### 测试 2: 不同 Agent，相同 Scene

```typescript
// Agent 1
await mainAgent.execute("写一个登录接口");
// Agent: coder, Scene: write_code
// Prompt: L0 + coder.systemPrompt + write_code.prompt

// Agent 2（假设 TaskPlanner 选择了 explore）
await mainAgent.execute("探索代码库并写一个接口");
// Agent: explore, Scene: write_code
// Prompt: L0 + explore.systemPrompt + write_code.prompt
```

**验证**：两次调用使用不同的 Agent，prompt 不同（agent 部分不同）

### 测试 3: Agent 配置中的 systemPrompt 被保留

```typescript
// coder.json5
{
  systemPrompt: "You are a professional coder with 10 years of experience..."
}

// 执行
await mainAgent.execute("写一个登录接口");

// 验证最终 prompt 包含
// 1. L0（身份）
// 2. coder.systemPrompt（agent 特性）✅
// 3. write_code.prompt（场景增强）
```

---

## 总结

**核心改进**：
- ✅ 主 Agent 只加载必要的基础能力
- ✅ 子 Agent 加载必要的 + 具体任务的 prompt
- ✅ Agent.systemPrompt 和动态 prompt 正确组合
- ✅ Agent 和 Scene 解耦，可以任意组合

**Prompt 组合公式**：
```
子 Agent Prompt = L0 + Agent.systemPrompt + L1(scene) + 项目规则 + SubAgent 标记
```

**职责分离**：
- MainAgent：调度，选择 Agent 和 Scene
- PromptStore：提供 L1 场景 prompt
- SubAgentFactory：组合完整 prompt
