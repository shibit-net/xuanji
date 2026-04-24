# L2 Prompt 加载机制说明

## L2 Prompt 的加载条件

根据 `LayeredPromptBuilder.ts` 的实现，L2 Prompt 的加载逻辑如下：

### 加载条件

```typescript
// L2: 仅 complex 加载
if (layer === 'L2') {
  return complexity === 'complex';
}
```

**结论**：L2 Prompt **只在任务复杂度为 `complex` 时加载**，与场景（Scene）无关。

## Prompt 层级加载规则

| 层级 | 加载条件 | 说明 |
|------|---------|------|
| **L0** | 始终加载 | 系统基础规则（身份、安全、任务执行） |
| **L1** | `complexity` 为 `standard` 或 `complex`，且场景匹配 | 场景指导（write-code, debug, test 等） |
| **L2** | `complexity` 为 `complex` | 协作规则（agent-rules, planning, team-coordination） |
| **L3** | 始终加载 | 项目上下文（动态生成） |

## 复杂度（Complexity）的定义

### simple（简单）
- 简单问题、概念解释
- 一般性建议和指导
- 闲聊和日常对话
- **加载**：L0 + L3

### standard（标准）
- 明确的单一任务
- 单个 Agent 可以完成
- 不需要多 Agent 协作
- **加载**：L0 + L1 (scene) + L3

### complex（复杂）
- 需要多个专业领域协作
- 需要任务分解和规划
- 需要多个 Agent 协调
- **加载**：L0 + L1 (scene) + L2 + L3

## L2 Prompt 的内容

L2 层包含 3 个文件，都是关于多 Agent 协作的：

1. **l2-agent-rules.yaml** - Agent 协作规则
   - 何时委派子 Agent
   - 如何使用 match_agent
   - Agent 层级关系

2. **l2-planning.yaml** - 任务规划策略
   - 如何分解复杂任务
   - 如何制定执行计划

3. **l2-team-coordination.yaml** - 团队协调机制
   - 5 种协作模式（Sequential, Parallel, Hierarchical, Debate, Pipeline）
   - 协调原则
   - 动态发现和匹配

## 为什么 L2 不需要场景？

### L2 的职责

L2 层的职责是**定义多 Agent 如何协作**，而不是定义"在特定场景下如何思考"。

- **L1（场景指导层）**：定义"在 write-code 场景下如何思考"、"在 debug 场景下如何思考"
- **L2（协作规则层）**：定义"如何协调多个 Agent"、"如何分解任务"、"如何汇总结果"

### L2 是通用的协作规则

L2 的内容是**通用的**，适用于所有需要多 Agent 协作的复杂任务，无论是什么场景：

- 开发新功能（需求分析 + UI设计 + 代码实现）
- 重构代码（探索 + 规划 + 重构 + 测试）
- 数据分析（采集 + 清洗 + 分析 + 可视化）

这些任务的**协作模式**是相同的（Sequential, Parallel 等），但**具体场景**不同（write-code, refactor, data-analysis）。

### 示例：开发新功能

```
复杂度：complex
场景：无（主 Agent 自己决策）

加载的 Prompt：
- L0: 系统基础规则
- L2: 协作规则（如何协调多个 Agent）
- L3: 项目上下文

主 Agent 的工作：
1. 使用 L2 的协作规则，分解任务
2. 使用 list_agents 和 match_agent 找到合适的 Agent
3. 为每个 Agent 指定场景（scene）
4. 使用 agent_team 协调执行

子 Agent 的 Prompt：
- L0: 系统基础规则
- Agent.systemPrompt: Agent 特性
- L1: 场景指导（write-code, test, ui-design 等）
- L3: 项目上下文
```

## 主 Agent 和子 Agent 的 Prompt 差异

### 主 Agent（Xuanji）

**任务复杂度为 complex 时**：
```
L0（系统基础规则）
  + Agent.systemPrompt（主 Agent 的协调能力）
  + L2（协作规则）← 如何协调多个 Agent
  + L3（项目上下文）
```

**不加载 L1**：因为主 Agent 不执行具体任务，只负责协调。

### 子 Agent（software-engineer, product-manager 等）

**执行具体任务时**：
```
L0（系统基础规则）
  + Agent.systemPrompt（子 Agent 的专业能力）
  + L1（场景指导）← 如何在特定场景下思考
  + L3（项目上下文）
```

**不加载 L2**：因为子 Agent 不协调其他 Agent，只执行具体任务。

## 完整示例：实现用户登录功能

### 用户输入
```
"帮我实现一个用户登录功能，包括需求、UI、代码、测试和文档"
```

### 主 Agent 的 Prompt

**复杂度分析**：complex（需要多个专业领域协作）

**加载的 Prompt**：
```
L0: base-identity, base-task-execution, safety, base-memory-guide
  + xuanji.systemPrompt（协调能力）
  + L2: agent-rules, planning, team-coordination
  + L3: 项目上下文
```

**主 Agent 的决策**：
1. 使用 L2 的协作规则，识别需要 5 个专业领域
2. 使用 list_agents 查询可用 Agent
3. 使用 match_agent 为每个领域匹配 Agent
4. 使用 agent_team 协调执行

### 子 Agent 的 Prompt

**Phase 1: product-manager + requirement**
```
L0: base-identity, base-task-execution, safety, base-memory-guide
  + product-manager.systemPrompt（产品能力）
  + L1: l1-requirement（需求分析场景）
  + L3: 项目上下文
```

**Phase 2: ui-designer + ui-design**
```
L0: base-identity, base-task-execution, safety, base-memory-guide
  + ui-designer.systemPrompt（设计能力）
  + L1: l1-ui-design（UI设计场景）
  + L3: 项目上下文
```

**Phase 3: software-engineer + write-code**
```
L0: base-identity, base-task-execution, safety, base-memory-guide
  + software-engineer.systemPrompt（开发能力）
  + L1: l1-write-code（代码编写场景）
  + L3: 项目上下文
```

**Phase 4: software-engineer + test**
```
L0: base-identity, base-task-execution, safety, base-memory-guide
  + software-engineer.systemPrompt（开发能力）
  + L1: l1-test（测试编写场景）
  + L3: 项目上下文
```

**Phase 5: technical-writer（临时 Agent）**
```
L0: base-identity, base-task-execution, safety, base-memory-guide
  + technical-writer.systemPrompt（文档能力，自动生成）
  + L1: 无（或者动态创建临时 Scene）
  + L3: 项目上下文
```

## 总结

### L2 Prompt 的加载时机

- ✅ **何时加载**：任务复杂度为 `complex` 时
- ✅ **加载给谁**：主 Agent（负责协调）
- ✅ **不加载给谁**：子 Agent（执行具体任务）

### L2 不需要场景的原因

- L2 是**通用的协作规则**，适用于所有复杂任务
- L2 定义"如何协调"，而不是"如何执行"
- 场景（Scene）是 L1 的职责，定义"在特定场景下如何思考"

### Prompt 组合公式

**主 Agent（complex 任务）**：
```
L0 + Agent.systemPrompt + L2 + L3
```

**子 Agent（执行任务）**：
```
L0 + Agent.systemPrompt + L1(scene) + L3
```

---

**文档版本**：v1.0  
**更新日期**：2026-04-23  
**状态**：✅ 完整
