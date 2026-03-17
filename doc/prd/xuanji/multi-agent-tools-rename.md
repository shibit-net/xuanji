# Multi-Agent 工具重命名方案

**日期**: 2026-03-15
**问题**: TaskTool/TeamTool/ChainTool 命名不清晰，无法体现核心特性

---

## 现有命名问题

### TaskTool
**问题**：
- "Task" 太通用，所有工具都是执行任务
- 无法体现"委托给单个专业Agent"的特性
- 容易与任务管理工具（TaskCreate/TaskUpdate）混淆

**核心特性**：
- 委托给**单个**专业Agent
- 隔离执行（独立上下文）
- 不与用户交互

---

### TeamTool
**问题**：
- "Team" 暗示是"团队"，但实际是执行策略
- 策略才是核心（sequential/parallel/debate/pipeline）
- 名字没体现"协调多个Agent"的本质

**核心特性**：
- **多个**Agent协作
- **策略**驱动（4-5种协作模式）
- 协调/编排角色

---

### ChainTool
**问题**：
- "Chain" 只描述了顺序执行
- 核心是**输出传递**，而非简单的顺序
- 与TeamTool的pipeline策略功能重复

**核心特性**：
- **数据流**（上游→下游）
- **输出传递**（{{previous_output}}）
- 流水线处理

---

## 重命名方案

### 方案1：基于执行模式（推荐）

| 旧名称 | 新名称 | 核心特性 | 关键词 |
|-------|--------|---------|--------|
| TaskTool | **delegate** | 委托给单个Agent | 委托、代理 |
| TeamTool | **orchestrate** | 编排多个Agent协作 | 编排、协调 |
| ChainTool | **pipeline** | 流水线数据处理 | 流水线、数据流 |

**命名理由**：

**delegate**（委托）：
- 动词形式，直观
- 委托给专业Agent执行
- 软件设计中的委托模式（Delegation Pattern）
- 例："delegate this task to the coder agent"

**orchestrate**（编排）：
- 音乐术语：指挥家编排乐队演奏
- 软件术语：协调多个服务/组件工作
- 完美贴合"协调多个Agent协作"
- 例："orchestrate a team of agents to review code"

**pipeline**（流水线）：
- 工业术语：流水线生产
- 软件术语：数据管道（data pipeline）
- 直观体现"数据流"特性
- 例："pipeline data through multiple agents"

**使用示例**：
```typescript
// 旧：{ tool: 'task', input: {...} }
// 新：{ tool: 'delegate', input: {...} }

// 旧：{ tool: 'agent_team', input: {...} }
// 新：{ tool: 'orchestrate', input: {...} }

// 旧：{ tool: 'agent_chain', input: {...} }
// 新：{ tool: 'pipeline', input: {...} }
```

**优点**：
- ✅ 动词形式，表达执行动作
- ✅ 词义精准，体现核心特性
- ✅ 软件行业通用术语
- ✅ 简洁（单个单词）

**缺点**：
- ⚠️ orchestrate 较长（11字母）
- ⚠️ 非母语用户可能不熟悉

---

### 方案2：基于Agent数量 + 模式

| 旧名称 | 新名称 | 说明 |
|-------|--------|------|
| TaskTool | **agent_solo** | 单个Agent执行 |
| TeamTool | **agent_multi** | 多个Agent协作 |
| ChainTool | **agent_flow** | Agent数据流 |

**优点**：
- ✅ 清晰体现数量（solo/multi）
- ✅ agent_ 前缀统一

**缺点**：
- ❌ multi 太通用，不体现协作策略
- ❌ 较长（agent_xxx）

---

### 方案3：基于用户意图

| 旧名称 | 新名称 | 说明 |
|-------|--------|------|
| TaskTool | **run_agent** | 运行单个Agent |
| TeamTool | **team_up** | 组队协作 |
| ChainTool | **data_flow** | 数据流处理 |

**优点**：
- ✅ 口语化，易理解

**缺点**：
- ❌ 不够专业（team_up太口语）
- ❌ run_agent 太通用

---

### 方案4：基于设计模式

| 旧名称 | 新名称 | 设计模式 |
|-------|--------|---------|
| TaskTool | **delegate** | 委托模式 |
| TeamTool | **composite** | 组合模式 |
| ChainTool | **pipeline** | 管道模式 |

**优点**：
- ✅ 软件工程术语
- ✅ 精准

**缺点**：
- ❌ composite 不够直观（组合？复合？）
- ❌ 需要软件背景才能理解

---

### 方案5：中英文混合（针对中文用户）

| 旧名称 | 新名称 | 中文 | 英文 |
|-------|--------|------|------|
| TaskTool | **委托** / delegate | 委托 | delegate |
| TeamTool | **编排** / orchestrate | 编排 | orchestrate |
| ChainTool | **流水线** / pipeline | 流水线 | pipeline |

**优点**：
- ✅ 中文用户更直观

**缺点**：
- ❌ 工具名通常用英文
- ❌ 国际化支持复杂

---

## 推荐：方案1（delegate/orchestrate/pipeline）

### 完整对比

| 维度 | TaskTool | delegate | 提升 |
|------|---------|----------|------|
| 语义清晰度 | ⭐⭐ | ⭐⭐⭐⭐⭐ | +150% |
| 体现核心特性 | ❌ | ✅ | - |
| 专业性 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | +66% |
| 简洁性 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | +25% |

| 维度 | TeamTool | orchestrate | 提升 |
|------|---------|-------------|------|
| 语义清晰度 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | +66% |
| 体现核心特性 | ⭐⭐ | ⭐⭐⭐⭐⭐ | +150% |
| 专业性 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | +66% |
| 简洁性 | ⭐⭐⭐⭐ | ⭐⭐⭐ | -25% |

| 维度 | ChainTool | pipeline | 提升 |
|------|---------|----------|------|
| 语义清晰度 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | +66% |
| 体现核心特性 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | +66% |
| 专业性 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | +25% |
| 简洁性 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 0% |

---

## 用户视角对比

### 旧命名（混乱）

```
用户："我想分析代码"
璇玑：[可能调用 task 工具]

用户："我想多个专家审查代码"
璇玑：[可能调用 agent_team 工具]

用户："我想流水线处理数据"
璇玑：[可能调用 agent_chain？还是 agent_team pipeline策略？]
```

**问题**：
- task 太通用
- agent_team 只暗示"团队"，不体现"策略"
- agent_chain vs agent_team pipeline 功能重复

---

### 新命名（清晰）

```
用户："我想分析代码"
璇玑：[调用 delegate 工具，委托给 explore agent]

用户："我想多个专家审查代码"
璇玑：[调用 orchestrate 工具，编排 plan/coder/security agents]

用户："我想流水线处理数据"
璇玑：[调用 pipeline 工具，数据流经 extract→clean→analyze agents]
```

**优势**：
- delegate → 明确是"委托"
- orchestrate → 明确是"编排协作"
- pipeline → 明确是"流水线"

---

## 工具Description对比

### 旧Description

**TaskTool**:
```
委托给专业 Agent 执行独立任务。
```
→ 工具名 "task" 无法体现 "委托" 特性

**TeamTool**:
```
创建 Agent 团队协作完成复杂任务。
```
→ 工具名 "team" 只暗示团队，不体现"策略编排"

**ChainTool**:
```
顺序执行 Agent 链，上游输出自动传递给下游输入。
```
→ 工具名 "chain" 只暗示顺序，不体现"数据流"

---

### 新Description

**delegate**:
```
委托给专业 Agent 执行独立任务。
```
→ 工具名 "delegate" ✅ 完美匹配描述

**orchestrate**:
```
编排多个 Agent 协作完成复杂任务。
```
→ 工具名 "orchestrate" ✅ 完美匹配描述

**pipeline**:
```
流水线处理数据，上游输出自动传递给下游 Agent。
```
→ 工具名 "pipeline" ✅ 完美匹配描述

---

## 实施方案

### Phase 1: 重命名工具类

```typescript
// src/core/tools/
TaskTool.ts      → DelegateTool.ts
TeamTool.ts      → OrchestrateTool.ts
ChainTool.ts     → PipelineTool.ts
QuickTeamTool.ts → QuickOrchestrateTool.ts（或删除）
```

```typescript
// 工具名称
class DelegateTool extends BaseTool {
  readonly name = 'delegate';
}

class OrchestrateTool extends BaseTool {
  readonly name = 'orchestrate';
}

class PipelineTool extends BaseTool {
  readonly name = 'pipeline';
}
```

---

### Phase 2: 更新工具注册

```typescript
// src/core/tools/ToolRegistry.ts
registry.register(new DelegateTool());      // 旧：TaskTool
registry.register(new OrchestrateTool());   // 旧：TeamTool
registry.register(new PipelineTool());      // 旧：ChainTool
```

---

### Phase 3: 更新Agent配置

```typescript
// src/core/agent/builtin/xuanji.json5
tools: [
  { name: 'delegate', required: false },      // 旧：task
  { name: 'orchestrate', required: false },   // 旧: team
  { name: 'pipeline', required: false },      // 旧: agent_chain
]
```

---

### Phase 4: 更新文档

- `doc/guide/agent-concepts.md`
- `doc/guide/custom-subagent-guide.md`
- `doc/prd/xuanji/*.md`

---

### Phase 5: 向后兼容（可选）

**方式1：别名支持**

```typescript
class DelegateTool extends BaseTool {
  readonly name = 'delegate';
  readonly aliases = ['task'];  // 向后兼容
}
```

**方式2：废弃警告**

```typescript
class TaskTool extends BaseTool {
  readonly name = 'task';
  readonly deprecated = true;
  readonly deprecationMessage = 'Use "delegate" tool instead';

  async execute(input) {
    console.warn('⚠️  "task" tool is deprecated, use "delegate" instead');
    // 转发到 DelegateTool
  }
}
```

---

## 其他备选方案（供参考）

### 选项A：更口语化

| 旧名称 | 新名称 | 说明 |
|-------|--------|------|
| TaskTool | **assign** | 分配给Agent |
| TeamTool | **collaborate** | 协作 |
| ChainTool | **flow** | 数据流 |

**评价**：assign 较弱，collaborate 较好，flow 太短

---

### 选项B：更技术化

| 旧名称 | 新名称 | 说明 |
|-------|--------|------|
| TaskTool | **dispatch** | 调度 |
| TeamTool | **coordinate** | 协调 |
| ChainTool | **stream** | 数据流 |

**评价**：dispatch 偏技术，coordinate 不够有力

---

### 选项C：参考CI/CD术语

| 旧名称 | 新名称 | CI/CD对应 |
|-------|--------|-----------|
| TaskTool | **run** | run job |
| TeamTool | **stage** | pipeline stages |
| ChainTool | **pipeline** | pipeline |

**评价**：run 太通用，stage 不直观

---

## 总结

### 推荐命名

| 旧名称 | 新名称 | 核心特性 |
|-------|--------|---------|
| TaskTool | **delegate** | 委托单个Agent |
| TeamTool | **orchestrate** | 编排多Agent协作 |
| ChainTool | **pipeline** | 流水线数据处理 |

### 核心优势

1. **语义精准**：每个名字都精确体现核心特性
2. **专业术语**：软件工程通用概念
3. **动词形式**：表达执行动作
4. **简洁明了**：单个单词（orchestrate稍长但准确）

### 用户体验提升

**旧**：工具名模糊，LLM难以选择，用户困惑
**新**：工具名清晰，LLM准确选择，用户理解

---

**完成日期**: 待定
**负责人**: Kevin Shi
