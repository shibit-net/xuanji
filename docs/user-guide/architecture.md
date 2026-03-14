# 架构指南

本指南介绍璇玑 (Xuanji) 重构后的核心架构，帮助你理解系统的工作原理。

> **版本**: v1.0.0（重构后）
> **更新日期**: 2026-03-14

---

## 目录

1. [核心概念](#核心概念)
2. [Agent 类型](#agent-类型)
3. [执行模式](#执行模式)
4. [任务路由](#任务路由)
5. [任务分解](#任务分解)
6. [Agent Profile](#agent-profile)
7. [模板系统](#模板系统)

---

## 核心概念

璇玑采用**简单、清晰**的架构设计，核心概念从 20+ 个精简到 **10 个**：

| 概念 | 说明 | 位置 |
|------|------|------|
| **Main Agent** | 主代理，负责直接执行和任务分解 | `src/core/agent/AgentLoop.ts` |
| **Worker Agent** | 工作代理，执行子任务 | `src/core/agent/SubAgentLoop.ts` |
| **TaskRouter** | 任务路由器，判断执行模式 | `src/core/routing/TaskRouter.ts` |
| **Planner** | 任务规划器，分解复杂任务 | `src/core/planner/Planner.ts` |
| **Executor** | 任务执行器，管理子任务执行 | `src/core/executor/Executor.ts` |
| **Skill** | 技能，定义特定场景的行为 | `~/.xuanji/skills/` |
| **Tool** | 工具，执行具体操作 | `src/core/tools/` |
| **AgentRegistry** | Agent 配置注册中心 | `src/core/agent/AgentRegistry.ts` |
| **TemplateRepo** | MCP Prompts 模板仓库 | `src/core/template/TemplateRepo.ts` |
| **Memory** | 记忆系统，存储和检索信息 | `src/memory/` |

---

## Agent 类型

璇玑只有 **2 种** Agent 类型（从原来的 7 种精简）：

### 1. Main Agent（主代理）

**职责**：
- 接收用户输入
- 判断任务复杂度（通过 TaskRouter）
- **简单任务**：直接执行（ReAct 循环）
- **复杂任务**：任务分解（Planner + Executor）

**技术栈**：
- LLM：Claude 3.5 Sonnet（默认）
- 循环：ReAct（Reasoning + Acting）
- 工具：完整工具集（Read/Write/Edit/Bash/等）

**配置**：
```json5
// ~/.xuanji/agents/main.json5
{
  id: 'main',
  name: 'Main Agent',
  model: 'claude-3-5-sonnet-20241022',
  systemPrompt: '...',
  skills: ['code-assistant', 'life-secretary'],
  tools: ['read', 'write', 'edit', 'bash', 'grep', 'glob'],
  maxTokens: 8192,
  maxIterations: 15,
}
```

---

### 2. Worker Agent（工作代理）

**职责**：
- 执行 Main Agent 分解的子任务
- 隔离工具权限（不能创建子任务）
- 汇报执行结果

**技术栈**：
- LLM：Claude 3.5 Sonnet（默认，可配置）
- 循环：SubAgentLoop（简化版 ReAct）
- 工具：受限工具集（不包含 TaskTool）

**创建方式**：
- 动态创建，无需配置
- 由 Executor 自动管理

**示例**：
```typescript
// Executor 内部自动创建 Worker Agent
const context = new SubAgentContext({ task: '实现登录功能' });
const result = await runSubAgent(
  provider, lightProvider, toolRegistry,
  agentConfig, context
);
```

---

## 执行模式

璇玑支持 **2 种** 执行模式（语义更准确）：

### 1. Direct 模式（直接执行）

**适用场景**：
- ✅ 简单问答（"今天天气怎么样？"）
- ✅ 单步操作（"读取 README.md"）
- ✅ 多轮对话（连续对话）

**执行流程**：
```
用户输入 → Main Agent (ReAct 循环) → 输出结果
```

**特点**：
- 单 Agent 执行
- 快速响应
- 适合大多数任务

---

### 2. Decompose 模式（任务分解）

**适用场景**：
- ✅ 复杂任务（"实现一个 Todo 应用"）
- ✅ 多步骤任务（估计步骤 ≥ 5）
- ✅ 并行任务（前后端可并行开发）

**执行流程**：
```
用户输入 → TaskRouter (复杂度判断)
         → Planner (分解任务)
         → Executor (并行执行 Worker Agents)
         → 汇总结果
```

**特点**：
- 多 Agent 协作
- 支持依赖关系
- 支持并行执行

---

## 任务路由

TaskRouter 负责判断任务的执行模式：

### 路由决策流程

```
1. 检查配置强制模式
   ├─ config.mode = 'never' → direct
   └─ config.mode = 'always' → decompose

2. 检测显式触发词
   └─ "分解任务" / "制定计划" → decompose

3. LLM 复杂度评估
   ├─ complexity = 'complex' → decompose
   ├─ estimatedSteps ≥ 5 → decompose
   └─ complexity = 'simple' → direct

4. 默认
   └─ direct
```

### 复杂度判断标准

TaskRouter 使用 **Haiku 模型** 快速评估任务复杂度：

| 维度 | 说明 | decompose 条件 |
|------|------|----------------|
| **步骤数** | 估计需要多少步骤 | ≥ 5 步 |
| **复杂度** | simple / medium / complex | complex |
| **专业性** | 是否需要专业知识 | 可选 |
| **并行性** | 是否可并行执行 | 可选 |

### 配置

```json5
// ~/.xuanji/config.json5
{
  routing: {
    mode: 'auto', // 'auto' | 'always' | 'never'
    complexity: {
      minStepsForMultiAgent: 5,
      useAnalyzer: true,
      analyzerModel: 'claude-haiku-4-5-20251001',
    }
  }
}
```

---

## 任务分解

当 TaskRouter 决定使用 decompose 模式时，Planner 和 Executor 协作完成任务：

### Planner（任务规划器）

**职责**：
- 分解任务为子任务
- 确定依赖关系
- 分配 Agent Profile（可选）

**输入**：
```typescript
{
  userInput: '实现一个 Todo 应用',
  complexity: {
    isMultiStep: true,
    estimatedSteps: 5,
    complexity: 'complex',
  }
}
```

**输出**（ExecutionPlan）：
```typescript
{
  taskId: 'task-1234567890',
  taskDescription: '实现一个 Todo 应用',
  steps: [
    { order: 1, description: '分析需求', dependsOn: [] },
    { order: 2, description: '设计架构', dependsOn: [1] },
    { order: 3, description: '实现前端', dependsOn: [2], parallelWith: [4] },
    { order: 4, description: '实现后端', dependsOn: [2], parallelWith: [3] },
    { order: 5, description: '集成测试', dependsOn: [3, 4] },
  ]
}
```

---

### Executor（任务执行器）

**职责**：
- 按依赖顺序执行子任务
- 为每个子任务创建 Worker Agent
- 管理并行执行
- 汇总执行结果

**配置**：
```json5
{
  executor: {
    maxConcurrent: 3,      // 最大并行数
    timeout: 300000,       // 超时（5分钟）
    stopOnError: false,    // 遇错是否停止
  }
}
```

**执行结果**：
```typescript
{
  status: 'success' | 'partial' | 'failed',
  subTaskResults: [
    { order: 1, description: '分析需求', status: 'success', duration: 1000 },
    { order: 2, description: '设计架构', status: 'success', duration: 2000 },
    // ...
  ],
  summary: '任务执行汇总...',
}
```

---

## Agent Profile

Agent Profile 是 **Agent 配置的单一真相来源**，优先级：

```
Project > Global > Builtin
```

### 配置位置

| 类型 | 位置 | 优先级 | 说明 |
|------|------|--------|------|
| **Project** | `.xuanji/agents/*.json5` | 🥇 最高 | 项目级配置 |
| **Global** | `~/.xuanji/agents/*.json5` | 🥈 中等 | 全局配置 |
| **Builtin** | `src/core/agent/builtin/*.json5` | 🥉 最低 | 内置配置 |

### 配置格式

```json5
// ~/.xuanji/agents/my-agent.json5
{
  id: 'my-agent',
  name: 'My Custom Agent',
  model: 'claude-3-5-sonnet-20241022',
  systemPrompt: '你是一个专业的代码助手...',
  skills: ['code-assistant'],
  tools: ['read', 'write', 'edit', 'bash'],
  maxTokens: 8192,
  maxIterations: 15,
}
```

### AgentRegistry

AgentRegistry 管理所有 Agent Profile：

```typescript
// 自动初始化，加载所有配置
const registry = new AgentRegistry();
await registry.init();

// 获取 Agent Profile
const profile = registry.get('my-agent');

// 列出所有 Profile
const profiles = registry.listAll();
```

---

## 模板系统

TemplateRepo 管理 **MCP Prompts**，不再将其转换为 Skill。

### 模板列表

```bash
# 通过 TemplateRepo API
const templates = await templateRepo.list();
```

**输出**：
```typescript
[
  {
    id: 'market:analysis_report',
    name: 'analysis_report',
    serverName: 'market',
    description: '生成市场分析报告',
    arguments: [
      { name: 'symbol', description: '股票代码', required: true }
    ]
  }
]
```

### 使用模板

```bash
# 通过 TemplateRepo API
const rendered = await templateRepo.get('market:analysis_report', {
  symbol: 'AAPL'
});
```

**输出**：
```typescript
{
  template: { id: 'market:analysis_report', ... },
  messages: [
    { role: 'user', content: '请分析 AAPL 的市场表现...' }
  ],
  description: '市场分析报告'
}
```

### 搜索模板

```typescript
// 按关键词搜索
const results = await templateRepo.search('分析');

// 按服务器过滤
const marketTemplates = await templateRepo.listByServer('market');
```

---

## 架构图

```
┌─────────────────────────────────────────────────────────┐
│                       ChatSession                       │
│  (会话管理、意图匹配、Skill 路由、命令分发)            │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
          ┌───────────────────────┐
          │     TaskRouter        │
          │  (复杂度判断、路由)   │
          └─────┬─────────────┬───┘
                │             │
      ┌─────────┘             └──────────┐
      │                                  │
      ▼                                  ▼
┌──────────────┐                ┌────────────────┐
│ Direct 模式  │                │ Decompose 模式 │
│              │                │                │
│ Main Agent   │                │ Planner        │
│ (AgentLoop)  │                │ (分解任务)     │
│              │                │      ↓         │
│ ReAct 循环   │                │ Executor       │
│ 工具调用     │                │ (执行计划)     │
│              │                │      ↓         │
│              │                │ Worker Agents  │
│              │                │ (SubAgentLoop) │
└──────────────┘                └────────────────┘
```

---

## 相关文档

- [快速开始](./getting-started.md)
- [配置指南](./configuration.md)
- [Skill 系统](./skills-guide.md)
- [工具参考](./tools-reference.md)
- [MCP 集成](./mcp-integration.md)
- [架构重构方案](../../doc/tad/xuanji/05-architecture-refactoring-proposal.md)

---

**璇玑目标**: 让 AI 助手**简单、清晰、易于理解** 🎯
