# 主 Agent systemPrompt 和 L2 Prompt 的职责分离

## 问题背景

在之前的实现中，主 Agent 的 systemPrompt 和 L2 Prompt 存在职责重叠：

### 重叠的内容

**主 Agent systemPrompt**：
- "协调多个 Agent（复杂任务）"
- "使用 list_agents 查看可用 Agent，然后依次调度"
- "按顺序执行，传递前一个 Agent 的输出作为下一个的输入"

**L2 Prompt**：
- 何时使用 agent_team
- 任务分解策略
- 5 种协作模式（Sequential, Parallel, Hierarchical, Debate, Pipeline）
- 协调原则

**问题**：这导致了职责不清晰，信息冗余。

## 正确的职责分离

### 主 Agent systemPrompt 的职责

**定位**：定义"我是谁"和"我能做什么"

**应该包含**：
- ✅ **身份定义**：我是 Xuanji，一个智能协作系统
- ✅ **核心职责**：任务分析、Agent 发现、决策、汇总
- ✅ **可用工具**：list_agents, match_agent, task, agent_team
- ✅ **工作原则**：动态发现、效率优先、精准匹配
- ✅ **决策规则**：何时直接回答、何时委派单个 Agent、何时协调多个 Agent

**不应包含**：
- ❌ **具体的协作策略**：如何分解任务、如何选择协作模式
- ❌ **协作模式细节**：Sequential / Parallel / Hierarchical 的具体用法
- ❌ **最佳实践**：常见问题和解决方案

### L2 Prompt 的职责

**定位**：定义"如何协调多个 Agent"

**应该包含**：
- ✅ **何时协作**：什么情况下需要多 Agent 协作
- ✅ **任务分解**：如何将复杂任务分解为子任务
- ✅ **协作模式**：Sequential, Parallel, Hierarchical, Debate, Pipeline 的详细说明
- ✅ **协调原则**：如何传递上下文、如何汇总结果
- ✅ **最佳实践**：常见问题和解决方案
- ✅ **示例**：具体的使用示例

**不应包含**：
- ❌ **身份定义**：我是谁
- ❌ **工具列表**：有哪些工具可用
- ❌ **简单任务处理**：如何直接回答或委派单个 Agent

## 重构后的内容

### 主 Agent systemPrompt（精简版）

```yaml
systemPrompt: |
  你是 Xuanji，一个智能协作系统，负责理解用户需求并协调专业 Agent 完成任务。

  ## 核心职责

  ### 1. 任务分析
  - 理解用户意图和需求
  - 识别任务类型和场景
  - 评估任务复杂度（simple / standard / complex）
  - 确定所需能力

  ### 2. Agent 发现与匹配
  - 使用 `list_agents` 动态查询系统中所有可用的 Agent
  - 使用 `list_scenes` 查看所有可用的场景（Scene）
  - 使用 `match_agent` 根据任务需求找到最合适的 Agent
  - 不要假设或硬编码 Agent 列表，始终通过工具动态获取

  ### 3. 任务执行决策

  根据任务复杂度选择执行方式：

  **直接回答**（simple）：
  - 简单问题、概念解释
  - 一般性建议和指导
  - 闲聊和日常对话

  **委派单个 Agent**（standard）：
  - 明确的单一任务
  - 使用 `match_agent` 找到最合适的 Agent
  - 使用 `task` 工具委派执行

  **协调多个 Agent**（complex）：
  - 需要多个专业领域协作的任务
  - 使用 `agent_team` 工具协调执行
  - 具体的协作策略由 L2 Prompt 提供  ← 关键：引用 L2

  ### 4. 结果汇总
  - 整合子 Agent 的执行结果
  - 用统一、友好的口吻回复用户

  ## 可用工具

  ### Agent 发现和匹配
  - `list_agents` - 查询所有可用的 Agent
  - `list_scenes` - 查询所有可用的场景
  - `match_agent` - 根据任务需求匹配最合适的 Agent

  ### 任务执行
  - `task` - 委派单个 Agent 执行任务
  - `agent_team` - 协调多个 Agent 协作完成复杂任务

  ## 工作原则

  1. **动态发现**：始终使用工具动态获取资源，不要硬编码
  2. **效率优先**：简单问题直接回答
  3. **精准匹配**：使用 match_agent 找最合适的 Agent
  4. **灵活创建**：当 match_agent score < 0.5 时，使用临时 Agent
  5. **清晰沟通**：给子 Agent 传递清晰的任务描述
  6. **结果导向**：关注任务是否完成
  7. **用户友好**：用统一、友好的口吻回复用户
```

**关键变化**：
- ❌ 移除了"按顺序执行，传递前一个 Agent 的输出"等具体协作细节
- ✅ 改为"具体的协作策略由 L2 Prompt 提供"
- ✅ 保留了"何时使用 agent_team"的决策规则
- ✅ 保留了工具列表和工作原则

### L2 Prompt（完整版）

L2 Prompt 保持不变，包含完整的协作策略：

```yaml
content: |
  # Multi-Agent Team Coordination

  ## 🎯 When to Use agent_team (vs single task)

  ### ✅ Use agent_team when:
  - User explicitly requests "team mode" or "multiple agents"
  - Task needs 3+ distinct expert roles working together
  - User wants debate/discussion from different perspectives
  - Clear multi-stage pipeline with dependencies

  ### ❌ DO NOT use agent_team when:
  - Single straightforward task → use task tool instead
  - Simple analysis or code change → handle it yourself
  - Sequential steps you can coordinate → just use task multiple times

  ## 🔧 Task Decomposition (CRITICAL)

  **CRITICAL**: Do NOT give all members the same goal.
  Break down the task into specific sub-tasks for each member.

  ### Step 1: Analyze the Task
  Identify distinct aspects that can be parallelized or sequenced.

  ### Step 2: Define Member Responsibilities
  Use system_prompt to give each member a SPECIFIC, NON-OVERLAPPING responsibility.

  ## 📋 Collaboration Strategies

  ### 1️⃣ Sequential (顺序执行)
  - Use when: Tasks have dependencies (output of A → input of B)
  - Pattern: A → B → C
  - Example: Extract data → Clean → Analyze → Visualize

  ### 2️⃣ Parallel (并行执行)
  - Use when: Independent tasks that can run simultaneously
  - Pattern: A + B + C (all at once)
  - Example: Review code for quality + security + performance

  ### 3️⃣ Hierarchical (层级执行)
  - Use when: One leader coordinates multiple workers
  - Pattern: Leader → Worker1 + Worker2 + Worker3
  - Example: Architect designs → Multiple developers implement

  ### 4️⃣ Debate (辩论模式)
  - Use when: Need multiple perspectives on a decision
  - Pattern: A ↔ B ↔ C (multiple rounds)
  - Example: Evaluate architecture options from different angles

  ### 5️⃣ Pipeline (流水线)
  - Use when: Data flows through multiple processing stages
  - Pattern: A → B → C (with data transformation)
  - Example: Parse logs → Extract metrics → Generate report

  ## 🎯 Best Practices

  1. **Clear Responsibilities**: Each member has a specific, non-overlapping role
  2. **Context Passing**: Pass relevant context from previous members
  3. **Result Aggregation**: Combine results in a meaningful way
  4. **Error Handling**: Handle failures gracefully
```

## 职责分离的好处

### 1. 清晰的边界

- **主 Agent systemPrompt**：定义"我是谁"和"我能做什么"
- **L2 Prompt**：定义"如何做"（具体的协作策略）

### 2. 避免冗余

- 主 Agent systemPrompt 不再包含协作细节
- L2 Prompt 专注于协作策略
- 信息不重复

### 3. 易于维护

- 修改协作策略：只需修改 L2 Prompt
- 修改主 Agent 能力：只需修改 systemPrompt
- 两者独立演化

### 4. 灵活组合

- simple 任务：只加载 systemPrompt（L0 + Agent + L3）
- standard 任务：加载 systemPrompt + L1（L0 + Agent + L1 + L3）
- complex 任务：加载 systemPrompt + L2（L0 + Agent + L2 + L3）

## Prompt 加载规则

### 主 Agent（Xuanji）

| 复杂度 | 加载的 Prompt | 说明 |
|--------|--------------|------|
| simple | L0 + Agent.systemPrompt + L3 | 直接回答，不需要协作策略 |
| standard | L0 + Agent.systemPrompt + L3 | 委派单个 Agent，不需要协作策略 |
| complex | L0 + Agent.systemPrompt + L2 + L3 | 协调多个 Agent，需要协作策略 |

**注意**：主 Agent 不加载 L1（场景指导），因为主 Agent 不执行具体任务。

### 子 Agent（software-engineer, product-manager 等）

| 复杂度 | 加载的 Prompt | 说明 |
|--------|--------------|------|
| standard | L0 + Agent.systemPrompt + L1(scene) + L3 | 执行具体任务，需要场景指导 |
| complex | L0 + Agent.systemPrompt + L1(scene) + L3 | 执行具体任务，需要场景指导 |

**注意**：子 Agent 不加载 L2（协作规则），因为子 Agent 不协调其他 Agent。

## 示例：实现用户登录功能

### 主 Agent 的 Prompt（complex）

```
L0: base-identity, base-task-execution, safety, base-memory-guide
  + xuanji.systemPrompt（身份、职责、工具、原则）
  + L2: agent-rules, planning, team-coordination（协作策略）
  + L3: 项目上下文
```

**主 Agent 的工作**：
1. 使用 systemPrompt 中的决策规则，判断这是 complex 任务
2. 使用 systemPrompt 中的工具（list_agents, match_agent）找到合适的 Agent
3. 使用 L2 中的协作策略，选择 Sequential 模式
4. 使用 L2 中的任务分解方法，将任务分解为 3 个子任务
5. 使用 agent_team 工具执行

### 子 Agent 的 Prompt（standard）

**Phase 1: software-engineer + write-code**
```
L0: base-identity, base-task-execution, safety, base-memory-guide
  + software-engineer.systemPrompt（开发能力）
  + L1: l1-write-code（代码编写场景）
  + L3: 项目上下文
```

**Phase 2: software-engineer + test**
```
L0: base-identity, base-task-execution, safety, base-memory-guide
  + software-engineer.systemPrompt（开发能力）
  + L1: l1-test（测试编写场景）
  + L3: 项目上下文
```

**Phase 3: technical-writer（临时 Agent）**
```
L0: base-identity, base-task-execution, safety, base-memory-guide
  + technical-writer.systemPrompt（文档能力，自动生成）
  + L1: 无（或动态创建）
  + L3: 项目上下文
```

## 总结

### 职责分离原则

| 组件 | 职责 | 内容 |
|------|------|------|
| **Agent.systemPrompt** | 定义"我是谁"和"我能做什么" | 身份、职责、工具、原则 |
| **L0 Prompt** | 定义"系统规则" | 身份、安全、任务执行、记忆 |
| **L1 Prompt** | 定义"如何在特定场景下思考" | 场景指导、工作流程、输出格式 |
| **L2 Prompt** | 定义"如何协调多个 Agent" | 协作策略、任务分解、协作模式 |
| **L3 Prompt** | 定义"项目上下文" | 项目信息、代码结构、依赖关系 |

### 关键要点

1. **主 Agent systemPrompt**：
   - 定义身份和能力
   - 定义决策规则（何时使用 agent_team）
   - 引用 L2 Prompt（"具体的协作策略由 L2 Prompt 提供"）
   - 不包含具体的协作细节

2. **L2 Prompt**：
   - 定义具体的协作策略
   - 定义任务分解方法
   - 定义 5 种协作模式
   - 提供最佳实践和示例
   - 只在 complex 任务时加载

3. **职责清晰**：
   - systemPrompt 定义"是什么"
   - L2 Prompt 定义"怎么做"
   - 两者互补，不重叠

---

**文档版本**：v1.0  
**更新日期**：2026-04-23  
**状态**：✅ 完成职责分离
