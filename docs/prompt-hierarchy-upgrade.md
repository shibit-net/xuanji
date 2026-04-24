# Prompt 层级完整升级方案

## 设计原则

1. **职责单一**：每个层级只负责自己的职责，不越界
2. **高度复用**：各层独立，可以自由组合
3. **动态发现**：不硬编码任何 Agent、Scene、Tool 名称
4. **清晰边界**：明确定义各层的输入输出

## 完整的 Prompt 层次结构

```
最终 System Prompt = Agent + L0 + L1 + L2 + L3
```

## 各层职责详解

### Agent System Prompt（角色身份层）

**职责**：定义"我是谁"

**包含内容**：
- ✅ 角色身份（我是一位软件工程师 / 产品经理 / 设计师）
- ✅ 核心原则（代码质量优先 / 用户体验优先）
- ✅ 工作方式（我会根据不同场景采用不同思维方式）
- ✅ 能力声明（我擅长...）

**不包含内容**：
- ❌ 具体的场景指导（如何编写代码、如何调试）
- ❌ 工具使用说明（如何使用 read_file、write_file）
- ❌ 协作规则（如何与其他 Agent 协作）
- ❌ 项目信息（当前项目的结构、依赖）

**示例**（software-engineer.yaml）：
```yaml
systemPrompt: |
  你是一位经验丰富的全栈软件工程师。
  
  ## 核心原则
  - 代码质量优先：输出的代码必须可以直接运行，无语法错误
  - 简洁清晰：代码结构清晰，命名规范，适当注释
  - 最佳实践：遵循语言规范和设计模式
  - 安全意识：避免常见安全漏洞
  - 性能考虑：注意算法复杂度和资源使用
  
  ## 工作方式
  你会根据不同的任务场景，采用不同的思维方式和工作流程。
  具体的场景指导会通过 Scene 动态加载。
  
  ## 能力范围
  你擅长代码开发、测试、部署、运维等全栈工作。
  你会使用合适的工具完成任务，并遵循最佳实践。
```

**复用范围**：该 Agent 的所有任务

---

### L0 Prompt（全局基础层）

**职责**：定义"系统的基础规则"

**包含内容**：
- ✅ 系统身份（你是 Xuanji 智能协作系统）
- ✅ 任务执行规范（如何理解任务、如何输出结果）
- ✅ 安全规则（禁止的操作、需要确认的操作）
- ✅ 记忆管理指南（如何使用记忆系统）
- ✅ 工具使用原则（何时使用工具、如何使用工具）

**不包含内容**：
- ❌ 角色身份（我是工程师 / 产品经理）
- ❌ 场景指导（如何编写代码、如何调试）
- ❌ 协作规则（如何与其他 Agent 协作）
- ❌ 项目信息（当前项目的结构）

**文件列表**：
1. `l0-base-identity.yaml` - 系统身份
2. `l0-base-task-execution.yaml` - 任务执行规范
3. `l0-safety.yaml` - 安全规则
4. `l0-base-memory-guide.yaml` - 记忆管理

**示例**（l0-base-task-execution.yaml）：
```yaml
content: |
  # 任务执行规范
  
  ## 理解任务
  1. 仔细阅读用户需求，识别关键信息和约束条件
  2. 如有不清楚的地方，使用 ask_user 工具主动询问
  3. 确认任务目标和预期输出
  
  ## 执行任务
  1. 制定清晰的执行计划
  2. 按步骤执行，确保每步正确
  3. 遇到问题及时调整策略
  4. 使用合适的工具完成任务
  
  ## 输出结果
  1. 结果必须完整、准确
  2. 提供必要的说明和示例
  3. 如有限制或注意事项，明确说明
  
  ## 工具使用原则
  1. 优先使用专用工具（read_file, write_file, edit_file）
  2. 避免过度使用工具（简单问题直接回答）
  3. 工具调用失败时，分析原因并调整策略
  4. 使用 list_agents 和 match_agent 动态发现资源
```

**复用范围**：所有 Agent 的所有任务

---

### L1 Prompt（场景指导层）

**职责**：定义"在特定场景下如何思考和工作"

**包含内容**：
- ✅ 场景化的思维框架
- ✅ 具体的工作流程
- ✅ 输出格式规范
- ✅ 常见问题和解决方案
- ✅ 场景特定的最佳实践

**不包含内容**：
- ❌ 角色身份（我是工程师）
- ❌ 系统规则（安全规则、任务执行规范）
- ❌ 协作规则（如何与其他 Agent 协作）
- ❌ 项目信息（当前项目的结构）
- ❌ 硬编码的 Agent 名称、工具名称

**文件列表**（15个场景）：

**软件工程场景（9个）**：
1. `l1-explore.yaml` - 代码探索
2. `l1-plan.yaml` - 架构设计
3. `l1-write-code.yaml` - 代码编写
4. `l1-debug.yaml` - 代码调试
5. `l1-test.yaml` - 测试编写
6. `l1-refactor.yaml` - 代码重构
7. `l1-review.yaml` - 代码审查
8. `l1-deploy.yaml` - 部署配置
9. `l1-monitor.yaml` - 监控运维

**产品管理场景（3个）**：
10. `l1-requirement.yaml` - 需求分析
11. `l1-user-research.yaml` - 用户研究
12. `l1-product-plan.yaml` - 产品规划

**UI设计场景（3个）**：
13. `l1-interaction.yaml` - 交互设计
14. `l1-ui-design.yaml` - UI设计
15. `l1-design-system.yaml` - 设计系统

**示例**（l1-write-code.yaml）：
```yaml
content: |
  # 代码编写场景
  
  ## 思维框架
  理解需求 → 设计接口 → 编写实现 → 添加注释 → 提供示例
  
  ## 核心原则
  - 代码质量：可直接运行，无语法错误
  - 简洁明了：不闲聊、不抒情，直接输出代码
  - 最佳实践：遵循语言规范
  - 类型安全：使用类型注解（TypeScript/Python）
  - 错误处理：合理处理异常情况
  
  ## 工作流程
  
  ### 1. 分析需求
  - 理解要实现的功能
  - 识别输入输出
  - 确认约束条件
  
  ### 2. 设计接口
  - 定义函数签名
  - 确定参数类型和返回值
  - 考虑扩展性
  
  ### 3. 编写实现
  - 实现核心逻辑
  - 处理边界情况
  - 添加必要的验证
  
  ### 4. 添加注释
  - 关键逻辑添加注释
  - 复杂算法说明思路
  - 避免过度注释
  
  ### 5. 提供示例
  - 展示如何使用
  - 包含常见用例
  - 说明注意事项
  
  ## 输出格式
  
  ```language
  // 代码实现
  ```
  
  **使用说明**：
  - 如何调用
  - 参数说明
  - 返回值说明
  - 注意事项
  
  ## 常见问题
  
  **Q: 如何处理异步操作？**
  A: 使用 async/await 或 Promise，确保错误处理

  **Q: 如何命名变量和函数？**
  A: 使用有意义的名称，遵循语言规范（camelCase/snake_case）
  
  **Q: 如何组织代码结构？**
  A: 单一职责原则，函数保持简短，逻辑清晰
```

**复用范围**：该场景的所有任务（不限于特定 Agent）

---

### L2 Prompt（复杂任务层）

**职责**：定义"多 Agent 如何协作"

**包含内容**：
- ✅ Agent 协作规则
- ✅ 任务分解策略
- ✅ 团队协调机制
- ✅ 结果汇总方法
- ✅ 动态发现和匹配指导

**不包含内容**：
- ❌ 角色身份（我是工程师）
- ❌ 场景指导（如何编写代码）
- ❌ 系统规则（安全规则）
- ❌ 项目信息（当前项目的结构）
- ❌ 硬编码的 Agent 名称

**文件列表**（3个）：
1. `l2-agent-rules.yaml` - Agent 协作规则
2. `l2-planning.yaml` - 任务规划策略
3. `l2-team-coordination.yaml` - 团队协调机制

**示例**（l2-team-coordination.yaml）：
```yaml
content: |
  # 多 Agent 协作指南
  
  ## 协作模式
  
  ### Sequential（顺序执行）
  - 适用场景：任务有明确的先后依赖关系
  - 工作方式：前一个 Agent 完成后，将结果传递给下一个
  - 示例：需求分析 → 代码实现 → 测试 → 文档
  
  ### Parallel（并行执行）
  - 适用场景：多个独立的子任务
  - 工作方式：多个 Agent 同时执行，最后汇总结果
  - 示例：代码质量审查 + 安全审查 + 性能审查
  
  ### Hierarchical（层级协调）
  - 适用场景：复杂任务需要主 Agent 协调
  - 工作方式：主 Agent 分配任务，子 Agent 执行，主 Agent 汇总
  - 示例：主 Agent 协调多个专业 Agent 完成大型项目
  
  ### Debate（讨论评估）
  - 适用场景：需要多个视角评估方案
  - 工作方式：多个 Agent 提出不同观点，讨论后达成共识
  - 示例：架构设计评审
  
  ### Pipeline（流水线）
  - 适用场景：数据需要多步处理
  - 工作方式：数据在 Agent 间流转，每个 Agent 处理一步
  - 示例：数据采集 → 清洗 → 分析 → 可视化
  
  ## 协调原则
  
  ### 1. 明确分工
  - 每个 Agent 职责清晰
  - 避免职责重叠
  - 使用 match_agent 找到最合适的 Agent
  
  ### 2. 清晰接口
  - 定义输入输出格式
  - 明确数据传递方式
  - 确保上下文完整
  
  ### 3. 上下文传递
  - 前一个 Agent 的输出作为下一个的输入
  - 传递必要的上下文信息
  - 避免信息丢失
  
  ### 4. 结果汇总
  - 最后统一整合所有结果
  - 提供完整的任务报告
  - 说明每个 Agent 的贡献
  
  ## 动态发现和匹配
  
  ### 使用 list_agents 查询可用 Agent
  ```typescript
  const agents = await list_agents();
  // 返回所有可用的 Agent 及其 capabilities
  ```
  
  ### 使用 match_agent 找到最合适的 Agent
  ```typescript
  const result = await match_agent({
    task_description: "分析用户需求并输出需求文档",
    required_capabilities: ["需求分析", "用户研究"]
  });
  
  if (result.score >= 0.5) {
    // 使用匹配到的 Agent
    await task({
      subagent_type: result.agent_id,
      description: "..."
    });
  } else {
    // 创建临时 Agent
    await createTemporaryAgent({...});
  }
  ```
  
  ## 示例：Sequential 模式
  
  ```typescript
  // 1. 查询可用 Agent
  const agents = await list_agents();
  
  // 2. 为每个阶段匹配 Agent
  const pmAgent = await match_agent({ task_description: "需求分析" });
  const engineerAgent = await match_agent({ task_description: "代码实现" });
  const testerAgent = await match_agent({ task_description: "测试编写" });
  
  // 3. 顺序执行
  const requirements = await task({
    subagent_type: pmAgent.agent_id,
    description: "分析用户登录功能的需求"
  });
  
  const code = await task({
    subagent_type: engineerAgent.agent_id,
    description: "根据需求实现用户登录功能",
    context: requirements
  });
  
  const tests = await task({
    subagent_type: testerAgent.agent_id,
    description: "为用户登录功能编写测试",
    context: code
  });
  
  // 4. 汇总结果
  return {
    requirements,
    code,
    tests
  };
  ```
```

**复用范围**：所有复杂任务（需要多 Agent 协作）

---

### L3 Prompt（项目上下文层）

**职责**：定义"当前项目的具体信息"

**包含内容**：
- ✅ 项目元数据（类型、路径、git 信息）
- ✅ 项目规则（CLAUDE.md / XUANJI.md）
- ✅ 代码结构（文件索引、符号索引）
- ✅ 依赖关系（package.json / requirements.txt）

**不包含内容**：
- ❌ 角色身份（我是工程师）
- ❌ 场景指导（如何编写代码）
- ❌ 协作规则（如何与其他 Agent 协作）
- ❌ 系统规则（安全规则）

**生成方式**：动态扫描，每次构建时更新

**示例**：
```markdown
# Project Context

## Project Metadata
- Type: typescript
- Root: /path/to/project
- Git: Yes
- Branch: main
- Last Commit: abc1234 (2026-04-23)

## Project Rules (from XUANJI.md)
- 使用 TypeScript 严格模式
- 遵循 ESLint 规则
- 所有函数必须有类型注解
- 使用 Vitest 进行测试
- 提交前运行 npm run lint

## Code Structure
**Total Files**: 150
**Total Symbols**: 450

**Top 20 Files**:
- `src/core/agent/AgentLoop.ts` — AgentLoop, AgentConfig, AgentState
- `src/core/tools/ToolRegistry.ts` — ToolRegistry, createDefaultRegistry
- `src/core/prompt/LayeredPromptBuilder.ts` — LayeredPromptBuilder
- ...

## Dependencies
**Runtime** (25 packages):
- react: ^18.2.0
- typescript: ^5.0.0
- yaml: ^2.3.0
- ...

**Dev** (15 packages):
- vite: ^5.0.0
- vitest: ^1.0.0
- eslint: ^8.50.0
- ...

## Recent Changes
- 2026-04-23: 重构 Agent 架构，实现动态发现机制
- 2026-04-22: 添加 ListScenesTool
- 2026-04-21: 优化 Prompt 组合机制
```

**复用范围**：该项目的所有任务

---

## Prompt 组合示例

### 示例 1：软件工程师 - 代码编写

**任务**：实现用户登录功能

**Prompt 组合**：
```
software-engineer.systemPrompt (角色身份)
+ l0-base-identity.yaml (系统身份)
+ l0-base-task-execution.yaml (任务执行规范)
+ l0-safety.yaml (安全规则)
+ l1-write-code.yaml (代码编写场景)
+ l3-project (项目上下文)
```

**组合后的效果**：
```
你是一位经验丰富的全栈软件工程师。[Agent]
核心原则：代码质量优先、简洁清晰...

你是 Xuanji 智能协作系统。[L0]
任务执行规范：理解任务、执行任务、输出结果...
安全规则：禁止的操作、需要确认的操作...

# 代码编写场景 [L1]
## 思维框架
理解需求 → 设计接口 → 编写实现 → 添加注释 → 提供示例

## 核心原则
- 代码质量：可直接运行，无语法错误
- 简洁明了：不闲聊、不抒情
...

# Project Context [L3]
- Type: typescript
- 项目规则：使用 TypeScript 严格模式...
- 代码结构：...
```

### 示例 2：产品经理 - 需求分析

**任务**：分析用户登录功能的需求

**Prompt 组合**：
```
product-manager.systemPrompt (角色身份)
+ l0-base-identity.yaml (系统身份)
+ l0-base-task-execution.yaml (任务执行规范)
+ l0-safety.yaml (安全规则)
+ l1-requirement.yaml (需求分析场景)
+ l3-project (项目上下文)
```

### 示例 3：主 Agent - 复杂任务协调

**任务**：设计并实现用户登录功能（需要多个 Agent 协作）

**Prompt 组合**：
```
xuanji.systemPrompt (主 Agent 身份)
+ l0-base-identity.yaml (系统身份)
+ l0-base-task-execution.yaml (任务执行规范)
+ l0-safety.yaml (安全规则)
+ l2-agent-rules.yaml (Agent 协作规则)
+ l2-team-coordination.yaml (团队协调机制)
+ l3-project (项目上下文)
```

**主 Agent 的工作流程**：
1. 使用 list_agents 查询可用 Agent
2. 使用 match_agent 为每个阶段匹配 Agent
3. 使用 agent_team 协调多个 Agent 顺序执行
4. 汇总结果并回复用户

### 示例 4：临时 Agent - 文档编写

**任务**：编写 API 文档（没有合适的 Agent）

**Prompt 组合**：
```
tempAgent.systemPrompt (临时创建的角色身份)
+ l0-base-identity.yaml (系统身份)
+ l0-base-task-execution.yaml (任务执行规范)
+ l0-safety.yaml (安全规则)
+ l1-write-doc.yaml (文档编写场景，可能也是临时创建)
+ l3-project (项目上下文)
```

**临时 Agent 的 systemPrompt**：
```yaml
systemPrompt: |
  你是一位技术文档编写专家。
  
  ## 核心职责
  - 编写清晰、准确的技术文档
  - 提供API使用示例
  - 编写用户指南
  
  ## 工作原则
  - 简洁明了
  - 结构清晰
  - 示例丰富
  
  ## 工作方式
  你会根据任务需求，采用合适的方法完成文档编写工作。
  具体的场景指导会通过 Scene 动态加载。
```

---

## 复用性分析

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

---

## 动态发现机制

### 1. 不硬编码 Agent 名称

**❌ 错误示例**：
```yaml
# 硬编码 Agent 名称
content: |
  如果需要编写代码，使用 'coder' Agent
  如果需要测试，使用 'test-writer' Agent
```

**✅ 正确示例**：
```yaml
# 动态发现
content: |
  如果需要编写代码，使用 list_agents 和 match_agent 找到合适的 Agent
  如果需要测试，使用 match_agent 找到具有测试能力的 Agent
```

### 2. 不硬编码 Scene 名称

**❌ 错误示例**：
```yaml
# 硬编码 Scene 名称
systemPrompt: |
  你会使用以下场景：
  - write-code: 代码编写
  - debug: 代码调试
  - test: 测试编写
```

**✅ 正确示例**：
```yaml
# 动态加载
systemPrompt: |
  你会根据不同的任务场景，采用不同的思维方式和工作流程。
  具体的场景指导会通过 Scene 动态加载。
```

### 3. 使用工具动态查询

```typescript
// 1. 查询所有可用的 Agent
const agents = await list_agents();

// 2. 查询所有可用的 Scene
const scenes = await list_scenes();

// 3. 匹配最合适的 Agent
const result = await match_agent({
  task_description: "实现用户登录功能",
  required_capabilities: ["代码编写", "API设计"]
});

// 4. 使用匹配到的 Agent
if (result.score >= 0.5) {
  await task({
    subagent_type: result.agent_id,
    description: "..."
  });
} else {
  // 创建临时 Agent
  await createTemporaryAgent({...});
}
```

---

## 总结

### 核心设计原则

1. **职责单一**：每个层级只负责自己的职责
   - Agent: 角色身份
   - L0: 系统规则
   - L1: 场景指导
   - L2: 协作规则
   - L3: 项目上下文

2. **高度复用**：各层独立，可以自由组合
   - Agent 可以使用任何 L1 场景
   - L1 场景可以被任何 Agent 使用
   - L0 和 L2 被所有 Agent 共享

3. **动态发现**：不硬编码任何资源
   - 使用 list_agents 查询可用 Agent
   - 使用 list_scenes 查询可用 Scene
   - 使用 match_agent 动态匹配

4. **清晰边界**：明确定义各层的输入输出
   - 每层只关注自己的职责
   - 不越界处理其他层的内容

### 实现效果

- ✅ **灵活性**：支持任何领域的任务
- ✅ **可扩展性**：新增 Agent 或 Scene 无需修改代码
- ✅ **可复用性**：各层独立，最大化复用
- ✅ **智能性**：自动匹配、自动创建临时 Agent
- ✅ **上下文感知**：自动加载项目信息

---

**创建日期**：2026-04-23  
**版本**：v3.0  
**状态**：完整升级方案
