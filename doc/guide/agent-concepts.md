# Agent 概念指南

本文档帮助你理解璇玑的 Agent 架构，以及如何控制不同 Agent 的使用。

---

## 核心概念

### 1. 主 Agent（璇玑）

**你直接对话的对象**，负责：
- 理解你的需求
- 使用工具完成任务
- 必要时委托给专业 Agent

**类比**：项目经理，可以自己干活，也可以派遣专家

---

### 2. 专业 Agent（SubAgent）

**璇玑可以委托的专家**，包括：

| Agent | 专长 | 何时使用 |
|-------|------|---------|
| **explore** | 代码探索 | 快速搜索文件、分析代码结构 |
| **plan** | 架构设计 | 设计实现方案、评估技术选型 |
| **coder** | 代码编写 | 写代码、修复bug、重构 |
| **general-purpose** | 通用任务 | 其他需要隔离执行的任务 |

**类比**：公司的专家团队，各有专长

---

### 3. Agent 配置（AgentRegistry）

**存储 Agent 配置的地方**：
- `explore.json5` - 探索型 Agent 的"简历"（用什么模型、有哪些工具）
- `plan.json5` - 规划型 Agent 的"简历"
- `coder.json5` - 编程型 Agent 的"简历"

**重要**：这些**不是**可执行的实体，而是**配置文件**

**类比**：人才库的简历，不是实际工作的人

---

## 触发机制

### 单个专业 Agent（TaskTool）

**璇玑什么时候会委托给单个专业 Agent？**

#### 方式1：你明确要求 ✅ **推荐**

```
✓ "用 explore agent 分析这个项目的代码结构"
✓ "让 coder agent 修复 auth.ts 的 bug"
✓ "用 plan agent 设计用户认证的架构"
```

**关键词**：
- "用 X agent"
- "让 X agent"
- "X agent 帮我"

#### 方式2：璇玑自动判断

璇玑的 LLM 看到以下情况会自动调用 TaskTool：

**explore agent**：
```
✓ "分析这个项目的结构"
✓ "找到所有的 API 端点"
✓ "这个函数在哪里被调用"
```

**plan agent**：
```
✓ "如何实现用户权限系统"
✓ "设计缓存策略"
✓ "评估这两种方案的优劣"
```

**coder agent**：
```
✓ "修复这个 bug"
✓ "重构这段代码"
✓ "实现这个功能"
```

---

### 多 Agent 协作（TeamTool）

**璇玑什么时候会创建 Agent 团队？**

#### 方式1：你明确要求 ✅ **推荐**

```
✓ "用 code-review team 审查 auth.ts"
✓ "创建 research team 调研 React Server Components"
✓ "用 architecture-debate team 讨论缓存方案"
```

**关键词**：
- "用 X team"
- "创建 X team"
- "X team 帮我"

#### 方式2：璇玑自动判断

璇玑的 LLM 看到以下情况会自动调用 TeamTool：

**需要多个专家视角**：
```
✓ "从架构、安全、性能三个角度审查代码"
✓ "评估这个方案的优缺点"（可能启动 debate）
```

**需要流水线处理**：
```
✓ "提取所有 TODO → 分析优先级 → 生成报告"
```

**需要并行研究**：
```
✓ "从文档、代码、社区三个渠道调研最佳实践"
```

---

## 可用的 Team 模板

使用模板快速创建常见团队（通过 QuickTeamTool）：

| 模板 | 成员 | 策略 | 使用场景 |
|------|------|------|---------|
| **code-review** | 架构师 + 安全 + 性能 | sequential | 代码质量审查 |
| **research** | 文档 + 代码 + 社区 | parallel | 多源调研 |
| **architecture-debate** | 简洁派 + 扩展派 + 务实派 | debate | 架构设计讨论 |
| **data-pipeline** | 提取 + 清洗 + 分析 + 报告 | pipeline | 数据处理流程 |
| **feature-development** | 技术负责人 + 后端 + 前端 + QA | hierarchical | 功能开发 |

**使用示例**：
```
✓ "用 code-review team 审查 auth.ts"
✓ "用 research team 调研 GraphQL 最佳实践"
✓ "用 data-pipeline team 处理所有 TODO 注释"
```

---

## 如何控制？

### 强控制：明确指令

**最可靠**的方式，璇玑会优先响应：

```bash
# 单个 Agent
"用 explore agent 分析代码结构"
"让 coder agent 修复这个 bug"

# Team
"用 code-review team 审查这段代码"
"创建 research team 调研最佳实践"
```

---

### 弱控制：暗示意图

璇玑根据任务复杂度自动判断：

```bash
# 可能触发 explore agent
"这个项目的结构是怎样的？"

# 可能触发 coder agent
"修复 auth.ts 的 bug"

# 可能触发 code-review team
"这段代码有什么问题？"
```

**注意**：不保证一定触发，由璇玑的 LLM 黑盒决策

---

### 无控制：完全自动

你只提需求，璇玑自己决定：

```bash
"帮我实现用户登录功能"
```

璇玑可能：
1. 自己完成（简单任务）
2. 委托给 coder agent（复杂编程）
3. 先用 plan agent 设计，再用 coder agent 实现
4. 创建 feature-development team 协作完成

---

## 架构图

```
你的请求
  ↓
璇玑（主 Agent）
  ↓ 判断是否需要委托
  ├─ 自己完成（简单任务）
  │
  ├─ TaskTool → SubAgent
  │   ├─ explore agent（代码探索）
  │   ├─ plan agent（架构设计）
  │   ├─ coder agent（代码编写）
  │   └─ general-purpose agent（通用）
  │
  └─ TeamTool → 多 Agent 协作
      ├─ code-review team（代码审查）
      ├─ research team（多源调研）
      ├─ architecture-debate team（架构讨论）
      └─ 自定义 team
```

---

## 配置层次

```
AgentProfile（配置）
  ↓ 存储在
AgentRegistry（配置库）
  ↓ 被使用于
SubAgent/Team（执行实例）
  ↓ 通过
TaskTool/TeamTool（璇玑的工具）
  ↓ 由
璇玑的 LLM（决策者）
  ↓ 根据
你的请求 + 工具 description
```

---

## 常见问题

### Q1: 如何知道璇玑调用了哪个 Agent？

**A**: 璇玑会告诉你，例如：
```
[调用 explore agent 分析代码结构...]
[创建 code-review team: 架构师 + 安全专家 + 性能专家...]
```

### Q2: 能否禁止璇玑自动调用某个 Agent？

**A**: 暂不支持。最佳实践是通过明确指令控制行为。

### Q3: SubAgent 和主 Agent 有什么区别？

| 维度 | 主 Agent（璇玑） | SubAgent |
|------|----------------|---------|
| **交互** | 与你对话 | 不与你对话 |
| **上下文** | 完整对话历史 | 仅接收任务描述 |
| **工具** | 所有工具 | 受限工具集 |
| **超时** | 无限制 | 默认 5 分钟 |
| **递归** | 可创建 SubAgent | 不可创建 SubAgent |

### Q4: Team 中的 Agent 会互相对话吗？

**A**: 取决于策略：
- **sequential/parallel/pipeline**: 不对话，独立执行
- **debate**: 多轮对话，互相辩论

### Q5: 如何自定义 Agent 配置？

**A**: 创建配置文件：

```bash
# 全局配置
~/.xuanji/agents/my-agent.json5

# 项目配置
.xuanji/agents/my-agent.json5
```

参考内置配置：
- `src/core/agent/builtin/explore.json5`
- `src/core/agent/builtin/plan.json5`
- `src/core/agent/builtin/coder.json5`

---

## 总结

### 关键点

1. **Agent ≠ 可执行实体**，AgentRegistry 中的是**配置**
2. **SubAgent = 使用配置创建的执行实例**
3. **Team = 多个 SubAgent 协作**
4. **触发机制**：明确指令（强控制）或 LLM 自动判断（弱控制）

### 最佳实践

✅ **推荐**：明确指令，可预测性高
```
"用 explore agent 分析代码"
"用 code-review team 审查代码"
```

⚠️ **可用**：暗示意图，依赖 LLM 判断
```
"分析代码结构"（可能触发 explore agent）
"审查代码质量"（可能触发 code-review team）
```

❌ **不推荐**：完全自动，黑盒决策
```
"帮我做这个"（无法预测行为）
```

---

**更新日期**: 2026-03-15
**版本**: v1.0
