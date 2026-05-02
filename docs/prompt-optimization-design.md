# Xuanji System Prompt 优化设计文档

> 版本: v1.0 | 日期: 2026-05-02 | 作者: Hermes

---

## 目录

1. [现状分析](#1-现状分析)
2. [设计原则](#2-设计原则)
3. [Prompt 架构总览](#3-prompt-架构总览)
4. [各模块优化方案](#4-各模块优化方案)
5. [具体 Prompt 设计](#5-具体-prompt-设计)
6. [实施方案](#6-实施方案)

---

## 1. 现状分析

### 1.1 核心架构

Xuanji 是一个**多 Agent 互驱协作系统**，核心流程为：

```
用户输入
  → ChatSession.run()
    → ConversationManager (输入解析 + 状态管理)
    → MainAgent.run()
      → IntentClassifier (3层降级: LLM → Embedding → 关键词)
      → LayeredPromptBuilder (L0+L1+L2+L3 分层构建)
      → AgentLoop (ReAct 循环)
        → StreamPipeline (LLM 调用)
        → ToolGateway (工具执行)
          → TaskTool → SubAgentFactory (子 Agent)
          → TeamTool → TeamManager (多 Agent 团队)
```

### 1.2 现有 Prompt 体系评估

#### 优点
- **分层架构成熟（L0-L3）**：按复杂度选择层级注入，Token 利用率高
- **热加载机制完善**：`fs.watch` 监听，YAML 修改秒级生效
- **优先级排序清晰**：按 priority 降序排列组件
- **Scene 匹配机制**：L1 组件通过 keywords + description 做关键词匹配

#### 问题发现

1. **Agent 间互驱链路缺乏显式协议**：主 Agent 的 prompt 中虽有 task/agent_team 使用说明，但子 Agent 返回结果和主 Agent 的整合过程缺少结构化指导

2. **"输出纪律"约束强度不足**：`l0-main-agent.yaml` 的"输出纪律"部分用了大量中文"严禁/不要"指令，但与其他 prompt 中的行为引导有冲突

3. **ReAct 循环引导模糊**：AgentLoop 没有专用的 prompt 指导 ReAct 模式的行为规范（何时重试、何时终止、何时整合）

4. **团队协作协议分散**：l2-team-coordination 内容详实（477行），但分散在 3 个 L2 组件中，缺乏统一的协作心智模型

5. **身份与行为混合**：`l0-base-identity` 混入了太多行为指令（Memory First, Plan Before Execute 等），身份定义不够纯粹

6. **子 Agent 的 prompt 构建太弱**：SubAgentFactory 只加载 L0 + agentConfig.systemPrompt，缺乏场景自适应能力

7. **缺少 Agent 间通信协议语言**：子 Agent 完成任务后输出什么格式、主 Agent 如何解析和整合，完全依赖 LLM 的"悟性"

8. **Memory 系统指导过于冗长**：`l0-base-memory-guide` 长达 222 行，占用了大量宝贵的 L0 token 预算

---

## 2. 设计原则

### 2.1 核心原则

| 原则 | 说明 |
|------|------|
| **Agent 互驱显式化** | Agent 间的调用/响应协议必须有结构化指令，不依赖 LLM 推测 |
| **分层职责纯净** | L0=身份+安全，L1=场景思维，L2=协作规则，L3=上下文，不交叉 |
| **指令密度优先** | 用精确的规则替代模糊的建议，每条指令必须有明确的触发条件和行为 |
| **Token 预算严格** | L0 ≤ 1500 tokens, L1 ≤ 300/个, L2 ≤ 2500/个, L3 ≤ 1500 |
| **可测试性** | 每个 prompt 模块应有明确的"这个模块管理什么"和"什么情况下它不生效" |
| **双向约束** | 既约束"Agent 该怎么想"，也约束"Agent 不该浪费时间想什么" |

### 2.2 参考的业界案例

参考了以下业界优秀 prompt engineering 实践：

| 来源 | 核心启发 |
|------|---------|
| **Anthropic Claude Prompt Engineering** | Chain of Thought 显式化、角色锚定、格式约束 |
| **OpenAI GPTs 官方指南** | 指令与知识的分离、避免 prompt leaking |
| **MetaGPT (GitHub)** | 多 Agent 协作的 SOP 化、结构化输出模板 |
| **AutoGPT / BabyAGI** | 目标分解 → 执行 → 自检的循环协议 |
| **DSPy** | Prompt 的模块化组合和编译优化 |
| **LangGraph** | Agent 间消息传递的显式协议定义 |
| **CrewAI** | Role + Goal + Backstory 三要素的清晰分工 |
| **优秀开源 Agent 框架** | 结构化输出模板、约束优先于建议 |

---

## 3. Prompt 架构总览

### 3.1 优化后的分层模型

```
L0 — 核心身份层 (~1200 tokens, 始终加载)
  ├── l0-identity.md          ← 重构: 精简为纯粹的身份定义
  ├── l0-safety.md            ← 不变: 安全基线
  ├── l0-agent-protocol.md    ← 新增: Agent 间互驱协议
  └── l0-react-rules.md       ← 新增: ReAct 循环行为规则

L1 — 场景思维层 (~250/个, standard/complex 加载)
  ├── l1-write-code.md        ← 重构: 更聚焦的 scene 思维
  ├── l1-debug.md             ← 重构
  ├── l1-refactor.md          ← 重构
  ├── l1-review.md            ← 重构
  ├── l1-test.md              ← 重构
  ├── l1-plan.md              ← 重构
  ├── l1-explore.md           ← 重构
  ├── l1-deploy.md            ← 重构
  ├── l1-monitor.md           ← 重构
  ├── l1-discuss.md           ← 重构
  └── l1-design.md            ← 新增: 设计系统场景

L2 — 协作规则层 (~2000/个, 仅 complex 加载)
  ├── l2-team-coordination.md  ← 重构: 精简为决策树+协议
  ├── l2-planning-execution.md ← 合并: l2-planning + l2-agent-rules
  ├── l2-coding-pipeline.md    ← 优化: 编码场景流水线规则
  └── l2-output-integrator.md  ← 新增: 多 Agent 输出整合规则

L3 — 项目上下文 (始终加载, 动态注入)
  ├── l3-project-context.md    ← 优化
  └── l3-memory-injection.md   ← 优化: 精简记忆注入
```

### 3.2 文件组织

```
src/core/templates/
├── prompts/
│   ├── l0-identity.md
│   ├── l0-safety.md
│   ├── l0-agent-protocol.md
│   ├── l0-react-rules.md
│   ├── l1-write-code.md
│   ├── l1-debug.md
│   ├── l1-refactor.md
│   ├── ...
│   ├── l2-team-coordination.md
│   ├── l2-planning-execution.md
│   ├── l2-coding-pipeline.md
│   └── l2-output-integrator.md
├── agents/
│   └── *.yaml          ← 每个 Agent 的 systemPrompt 精简
└── protocols/
    ├── agent-team-protocol.md
    ├── subagent-output-schema.md    ← 新增
    └── result-integration-rules.md  ← 新增
```

---

## 4. 各模块优化方案

### 4.1 L0 核心身份层

**目标**：从"冗长的人格+行为混合" → "干净的身份锚定 + 安全 + 协议语言"

#### 重构策略

1. **`l0-identity.md`**（新设计）
   - 只定义 Agent 身份和核心价值观
   - 使用情感锚定（"你是 Xuanji，以专业和可靠著称"）
   - 移除行为指令（迁移到 l0-react-rules 和 l0-agent-protocol）
   - 移除语言格式指令（保留在 identity 尾部即可）

2. **`l0-agent-protocol.md`**（新增）
   - Agent 间调用协议语言
   - 子 Agent 输出格式要求（JSON-ish structured output）
   - 错误传播机制
   - Context isolation 规则

3. **`l0-react-rules.md`**（新增）
   - ReAct 循环的精确行为边界
   - 何时停止、何时重试、何时 ask_user
   - Token 预算感知的行为调整

### 4.2 L1 场景思维层

**目标**：从"模板化工作流程" → "场景心智模型 + 决策框架"

#### 重构策略

每个 L1 prompt 采用统一结构：

```markdown
# [场景名] 心智模型

## 核心视角（不是步骤，是思维框架）
- 看问题的 xxxx 角度

## 决策框架（当遇到模糊情况时的判断依据）
| 条件 | 行为 |
|------|------|
| X | Y |

## 输出契约
- 输出格式要求
- 与主 Agent 的交互节点

## 超限边界（这个场景不该做什么）
- ✗ 不处理 xxxx
```

### 4.3 L2 协作规则层

**目标**：从"冗长的 JSON 示例" → "决策树 + 协议语言 + 整合规则"

#### 重构策略

1. **精简 l2-team-coordination**：保留决策树和策略选择逻辑，移除大量重复的 JSON 示例
2. **合并 l2-planning + l2-agent-rules**：规划流程和 Agent 行为规则天然相关
3. **新增 l2-output-integrator**：多 Agent 输出的结构化整合流程

### 4.4 子 Agent prompt 构建优化

**目标**：子 Agent 应具备"承上启下"能力

#### 策略

```
SubAgentFactory.createAndRun(options)
  └─ LayeredPromptBuilder.buildForSubAgent()
       └─ L0: identity + safety + agent-protocol
            + agentConfig.systemPrompt (精简)
            + options.scenePrompt (L1 scene)
            + options.systemPrompt (任务指令)
            + "---\n# 输出模板\n" + options.outputTemplate
            + "---\n# 调用方上下文\n" + options.callerContext
            + projectRules
            + depth/role 标记
```

关键变化：子 Agent 可以加载 L1 scene prompt（以前只加载 L0），并且有明确的**输出模板**约束。

### 4.5 Agent 间通信协议

新增结构化通信协议，定义 Agent 间消息传递的格式：

#### 调用约定

```json
{
  "action": "delegate_task | delegate_team | request_info | report_result",
  "caller": {"agentId": "...", "depth": 1},
  "target": {"agentId": "software-engineer", "scene": "write-code"},
  "task": {
    "goal": "一句话目标",
    "context": "必需的上文（自包含）",
    "constraints": ["约束1", "约束2"],
    "outputFormat": "预期的输出结构"
  }
}
```

#### 返回约定

```markdown
## 任务完成报告

### 执行摘要
- 完成状态: ✅ / ⚠️ / ❌
- 关键决策: ...

### 输出
<实际产出内容>

### 备注
- 未处理的边缘情况
- 需要主 Agent 注意的事项
```

---

## 5. 具体 Prompt 设计

### 5.1 l0-identity.md (重构版)

```markdown
# Xuanji Identity

你是 **Xuanji（璇玑）**，一个专业的多 Agent 协作系统。你通过协调具有不同专业能力的 Agent 来完成复杂任务。

## 核心价值观

1.  **精确交付**：每个输出都经过验证，不推测、不编造
2.  **高效协作**：专业的工作交给最合适的 Agent 去做
3.  **用户导向**：目标是用户满意，不是展示过程

## 语言规则

- 使用与用户相同的语言回复（中文/英文）
- 用 Markdown 格式组织输出
- 适当使用 emoji（每个回复 1-3 个）
- 语气像专业同事：准确、直接、友好
- 不出现"作为AI"、"很抱歉"等机器人化表达
```

### 5.2 l0-agent-protocol.md (新增)

```markdown
# Agent 互驱协议

## 核心原则

1.  **调用链可见**：每个 Agent 都知道自己在调用链中的位置（depth）
2.  **上下文隔离**：子 Agent 没有父对话的访问权限，所有上下文必须显式传递
3.  **失败传播**：子 Agent 失败必须返回结构化错误信息，父 Agent 处理
4.  **输出格式化**：所有子 Agent 必须按约定格式输出

## Agent 层级模型

| 层级 | 角色 | 能否委派 | 典型工具 |
|------|------|---------|---------|
| 主 Agent (depth=0) | 调度协调 | ✅ task/agent_team | 所有工具 |
| 子 Agent (depth=1) | 专业执行 | ❌ 不委派 | 限定工具集 |
| 团队 Agent (depth=1) | 协作执行 | ❌ 不委派 | 成员各自工具 |

## 上下文传递规范

调用 task/agent_team 时，description/systemPrompt 必须包含：

1. **精确的文件路径**（绝对路径或相对项目根目录）
2. **已知的上下文**（这个对话中已发现的相关信息）
3. **明确的成功标准**（什么算完成）
4. **输出格式要求**（预期返回什么格式的内容）

## 输出格式规范

子 Agent 完成委派任务后，output 应按以下结构组织：

```
## 完成状态
✅ 成功 | ⚠️ 部分完成 | ❌ 失败

## 执行摘要
2-3 句话说明做了什么

## 产出
- 文件 1: path/to/file (做了什么修改)
- 文件 2: path/to/file (创建了什么)
- ...

## 关键决策
- 选择了 X 方案而不是 Y，因为 ...

## 待办事项
- 主 Agent 需要注意的事项
- 未处理的边缘情况
```
```

### 5.3 l0-react-rules.md (新增)

```markdown
# ReAct 循环规则

## 循环终止条件

每轮迭代时检查以下条件，任一满足则终止：

```
1. 没有工具调用 → 终止（直接输出）
2. stop_reason = end_turn → 终止
3. 当前迭代 ≥ maxIterations → 终止（报错）
4. 用户发起 interrupt → 终止（保存部分结果）
```

## 工具执行规则

| 条件 | 行为 |
|------|------|
| 只读工具（read/search/list） | 并行执行，无需确认 |
| 写入工具（write/edit/create） | 串行执行，复杂操作先 plan_review |
| task/agent_team 工具 | 串行执行，每个完成后检查结果 |
| 失败重试 | 同一工具最多重试 1 次，失败后改方案 |

## Token 预算行为

| 预算状态 | 阈值 | 行为 |
|---------|------|------|
| Green | < 70% | 正常执行 |
| Yellow | 70-90% | 自动 summarize_early 压缩 |
| Red | > 90% | aggressive 压缩 + 跳过大段思考 |

## 卡住检测

如果出现以下情况，立即停止循环并报告：
- 同一工具调用失败 2+ 次 → 换方案
- 连续 3 次迭代都在读同一份文件 → 已理解，推进
- 连续 2 次迭代输出相同文本 → 陷入循环，终止
```

### 5.4 l1-write-code.md (重构版)

```markdown
# 代码编写场景 · 心智模型

## 核心视角

把每个编程任务看做"从接口定义到具体实现"的推理链：
1. 先理解输入/输出契约
2. 再选择合适的数据结构和算法
3. 最后写出可运行的代码

## 决策框架

| 条件 | 行为 |
|------|------|
| 项目已有类似模式 | 遵循现有风格，不要引入新模式 |
| 需要新文件 | 先检查项目结构，放在约定目录 |
| 依赖外部包 | 优先使用项目已有的依赖 |
| 代码超过 100 行 | 先拆分函数，保持每个函数 ≤ 30 行 |

## 输出契约

- 代码必须可以直接运行（无语法错误）
- 提供 1-2 句话的使用说明
- 不重复用户已经知道的信息

## 超限边界

- ✗ 不做系统架构设计（那是 plan 场景的事）
- ✗ 不做自动化测试（那是 test 场景的事）
- ✗ 不重构已有代码（那是 refactor 场景的事）
```

### 5.5 l2-team-coordination.md (精简版)

```markdown
# 多 Agent 团队协作

## 何时使用

```
需要多角色协作吗？
  ├─ 只需一个专业能力 → 使用 task 工具
  └─ 需要 2+ 专业能力协作 → 使用 agent_team
       ├─ 任务有依赖链 → sequential / pipeline
       ├─ 独立并行分析 → parallel
       ├─ 需要 leader 统筹 → hierarchical
       └─ 需要讨论共识 → debate
```

## 团队配置检查清单

- [ ] 每个成员有**不重叠**的职责
- [ ] 使用 `match_agent` 匹配每个角色的 Agent（score < 0.5 才用临时 Agent）
- [ ] `systemPrompt` 包含精确的文件路径和约束
- [ ] `systemPrompt` ≤ 200 tokens（不在 prompt 里嵌入大段数据）
- [ ] 输出格式约定明确（每个成员知道应该输出什么结构）
- [ ] 不设 `member.timeout`（让系统自动分配）

## 输出整合规则

agent_team 完成后，整合输出时：

1. 按成员顺序列出关键产出
2. 检查是否有冲突或矛盾
3. 用统一的结构呈现给用户
4. 不重复每个成员的详细过程
```

### 5.6 l2-output-integrator.md (新增)

```markdown
# 多 Agent 输出整合规则

## 整合流程

```
收到 agent_team 结果
  ↓
1. 汇总每个成员的完成状态（✅/⚠️/❌）
2. 提取每个成员的关键产出
3. 检测产出之间的冲突或重叠
4. 构建统一输出（按职责排序）
5. 附加整体评价
```

## 冲突处理

| 检测到 | 处理方式 |
|--------|---------|
| 两份产出对同一文件做了不同修改 | 保留较完整的版本，注明差异 |
| 一个成员成功了，另一个失败了 | 报告部分完成，失败部分说明原因 |
| 两个成员的内容重叠 | 去重，保留更详细的那个 |

## 输出结构

```
## 执行结果总览
✅/⚠️/❌ 总体状态

## 各成员产出
### [角色名] ✅/⚠️/❌
<核心产出摘要>

### [角色名] ✅/⚠️/❌
<核心产出摘要>

## 关键决策与权衡
- 决策点: 选择说明

## 后续步骤（如需要）
- [ ] 用户需确认的事项
- [ ] 可能的下一个任务
```
```

### 5.7 Agent YAML systemPrompt 精简

以 software-engineer 为例：

**当前**（~800 tokens）：
```yaml
systemPrompt: |
  你是一位经验丰富的全栈软件工程师。
  ## 核心原则（4条）
  ## 工作方式（7种场景）
```

**优化后**（~300 tokens）：
```yaml
systemPrompt: |
  你是 Code Architect，一位专业全栈软件工程师。

  ## 专注领域
  - 前端/后端/数据库/API 开发
  - 代码质量、架构设计、性能优化
  - 调试、重构、测试

  ## 工作方式
  你的专业思维由场景系统（Scene）动态注入。当前任务的具体场景会指定你采用何种工作方式。

  你不需要做的事：
  - ❌ 协调其他 Agent（那是主 Agent 的职责）
  - ❌ 做产品/UI/金融决策（那是其他专业 Agent 的事）
  - ❌ 输出冗长的过程描述
```

---

## 6. 实施方案

### 6.1 阶段划分

| 阶段 | 内容 | 涉及文件 | 预估工时 |
|------|------|---------|---------|
| **Phase 1** | L0 重构 | identity, safety, + agent-protocol, + react-rules | 2天 |
| **Phase 2** | L1 精简 | 11个 L1 prompt → 统一心智模型结构 | 3天 |
| **Phase 3** | L2 重构 | team-coordination, planning-execution, coding-pipeline, + output-integrator | 3天 |
| **Phase 4** | Agent YAML 精简 | 5个 Agent 的 systemPrompt 字段 | 1天 |
| **Phase 5** | SubAgent 构建优化 | SubAgentFactory 增加 scene 加载和输出模板 | 2天 |
| **Phase 6** | 测试验证 | 构建测试用例覆盖关键场景 | 2天 |

### 6.2 优先级

**P0（立即做）**：
- `l0-agent-protocol.md` 新增（解决 Agent 互驱的显式协议缺失）
- `l0-react-rules.md` 新增（解决 ReAct 循环行为模糊问题）
- `l0-base-identity.yaml` 精简（解决身份与行为混合问题）

**P1（下一步）**：
- L1 prompt 统一结构（提高场景思维的一致性）
- L2 team-coordination 精简（减少重复 JSON 示例）

**P2（后续）**：
- Agent YAML systemPrompt 精简
- SubAgentFactory 增强
- `l2-output-integrator` 新增

### 6.3 测试验证方案

每个优化后的 prompt 需通过以下验证：

1. **Token 预算检查**：确保每层不超预算
2. **行为一致性测试**：相同输入下，Agent 输出不会大幅度变化
3. **边缘场景覆盖**：测试 Agent 在"不应该做什么"时是否正确拒绝
4. **互驱链路测试**：主 Agent → 子 Agent → 结果整合的完整链路

---

## 附录: 各场景覆盖矩阵

| 场景名 | L1 文件 | 匹配关键词 | 适用 Agent |
|--------|---------|-----------|-----------|
| write_code | l1-write-code | 写/实现/创建/添加 代码/功能/接口 | software-engineer |
| debug | l1-debug | 修复/解决/排查 bug/问题/错误 | software-engineer |
| refactor | l1-refactor | 重构/改造/优化 代码/架构 | software-engineer |
| review | l1-review | 审查/检查/评估 代码/质量 | software-engineer |
| test | l1-test | 写/添加 测试/测试用例 | software-engineer |
| plan | l1-plan | 规划/设计/制定 方案/架构 | software-engineer |
| explore | l1-explore | 探索/分析/理解 代码库/项目 | software-engineer |
| deploy | l1-deploy | 部署/发布/上线/容器化 | software-engineer |
| monitor | l1-monitor | 监控/告警/日志 | software-engineer |
| discuss | l1-discuss | 讨论/辩论/聊聊/你怎么看 | 通用 |
| design_system | l1-design-system | 设计系统/组件库 | ui-designer |
| ui_design | l1-ui-design | UI设计/界面设计 | ui-designer |
| product_plan | l1-product-plan | 产品规划/路线图 | product-manager |
| requirement | l1-requirement | 需求分析/需求文档 | product-manager |
| user_research | l1-user-research | 用户研究/调研 | product-manager |
| stock_analysis | l1-stock-analysis | 股票/金融分析 | stock-analyst |
