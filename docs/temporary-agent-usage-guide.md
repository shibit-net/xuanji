# 临时 Agent 使用指南

## 概述

临时 Agent 是 Xuanji 系统的一个强大功能，允许在运行时动态创建具有特定能力的 Agent，无需预先配置。

## 何时使用临时 Agent

### ✅ 适用场景

1. **所有预置 Agent 匹配分数都低于 0.5**
   ```
   match_agent({ task_description: "编写API文档" })
   → 返回: { agent_id: "software-engineer", score: 0.35 }  // 太低
   ```

2. **需要特定专业能力，但系统中没有对应的 Agent**
   - 技术文档编写
   - 数据分析
   - UI原型设计
   - 市场调研
   - 法律咨询
   - 等等...

3. **一次性任务，不值得创建永久 Agent**
   - 临时的数据处理
   - 特定格式的文档转换
   - 一次性的分析报告

### ❌ 不适用场景

1. **已有合适的预置 Agent（score >= 0.5）**
   - 优先使用预置 Agent，性能更好
   - 预置 Agent 有优化的 prompt 和工具配置

2. **简单任务，主 Agent 可以直接完成**
   - 不需要创建 Agent

## 使用方法

### 方法 1：使用 agent_team（推荐）

适用于需要多个 Agent 协作的复杂任务。

#### 基本语法

```json
{
  "name": "team-name",
  "strategy": "sequential",
  "members": [
    {
      "id": "member-1",
      "agentId": "custom-role-name",  // 🆕 自定义角色名
      "capabilities": ["能力1", "能力2"],
      "systemPrompt": "具体的任务描述"
    }
  ]
}
```

#### 示例 1：创建文档编写 Agent

```json
{
  "name": "document-team",
  "strategy": "sequential",
  "members": [
    {
      "id": "engineer",
      "agentId": "software-engineer",  // 预置 Agent
      "capabilities": ["代码编写"],
      "systemPrompt": "实现用户登录功能"
    },
    {
      "id": "doc-writer",
      "agentId": "technical-writer",  // 🆕 临时 Agent
      "capabilities": ["技术文档编写", "API文档"],
      "systemPrompt": "编写用户登录功能的API文档，包括接口说明、参数说明、返回值说明和使用示例"
    }
  ]
}
```

#### 示例 2：创建数据分析 Agent

```json
{
  "name": "analysis-team",
  "strategy": "sequential",
  "members": [
    {
      "id": "data-collector",
      "agentId": "software-engineer",  // 预置 Agent
      "capabilities": ["数据采集"],
      "systemPrompt": "从日志文件中提取用户行为数据"
    },
    {
      "id": "analyst",
      "agentId": "data-analyst",  // 🆕 临时 Agent
      "capabilities": ["数据分析", "统计分析", "报告生成"],
      "systemPrompt": "分析用户行为数据，生成包含趋势、异常和建议的分析报告"
    }
  ]
}
```

### 方法 2：使用 task

适用于单一任务。

#### 基本语法

```json
{
  "subagent_type": "custom-role-name",  // 🆕 自定义角色名
  "description": "具体的任务描述"
}
```

#### 示例 1：创建 UI 设计师

```json
{
  "subagent_type": "ui-designer",  // 🆕 临时 Agent
  "description": "设计用户登录页面的UI原型，包括布局、颜色方案和交互流程"
}
```

#### 示例 2：创建市场分析师

```json
{
  "subagent_type": "market-analyst",  // 🆕 临时 Agent
  "description": "分析竞品的定价策略，生成对比报告"
}
```

## 临时 Agent 命名规范

### 推荐的命名格式

使用 `kebab-case`（短横线分隔），系统会自动转换为标题格式：

| 输入（agentId） | 自动转换（Agent 名称） |
|----------------|---------------------|
| `technical-writer` | Technical Writer |
| `data-analyst` | Data Analyst |
| `ui-designer` | UI Designer |
| `market-analyst` | Market Analyst |
| `legal-advisor` | Legal Advisor |

### 命名建议

1. **描述性**：清楚地表达角色的职责
   - ✅ `technical-writer`（技术文档编写）
   - ❌ `writer`（太宽泛）

2. **专业性**：使用专业术语
   - ✅ `data-analyst`（数据分析师）
   - ❌ `data-person`（不专业）

3. **简洁性**：不要太长
   - ✅ `ui-designer`
   - ❌ `user-interface-and-experience-designer`

## 临时 Agent 的特点

### 1. 自动创建

- 无需显式调用创建工具
- 系统自动检测并创建
- 创建过程对用户透明

### 2. 通用配置

临时 Agent 使用标准配置：

```yaml
model:
  primary: "claude-sonnet-4-6"
  maxTokens: 64000

tools:
  - read_file
  - write_file
  - edit_file
  - bash
  - glob
  - grep
  - ask_user

execution:
  mode: "react"
  maxIterations: 20
  timeout: 600000
```

### 3. 继承父 Provider

- 临时 Agent 没有独立的 API Key
- 使用父 Agent（主 Agent）的 Provider
- 无需额外配置

### 4. 会话内复用

- 在同一会话中，临时 Agent 可以被多次使用
- 第二次使用时不需要重新创建
- 提高效率

### 5. 自动清理

- 会话结束后自动清理
- 不保存到配置文件
- 不占用永久存储空间

## 完整工作流程示例

### 场景：实现用户登录功能（包括代码、测试和文档）

#### 步骤 1：主 Agent 分析任务

```
用户输入: "帮我实现一个用户登录功能，包括代码、测试和文档"

主 Agent 分析:
- 这是一个复杂任务
- 需要 3 个专业领域：开发、测试、文档
- 需要使用 agent_team 协调
```

#### 步骤 2：查询可用 Agent

```
list_agents()

返回:
- software-engineer (Code Architect)
- product-manager (Product Strategist)
- ui-designer (Design Wizard)
```

#### 步骤 3：匹配 Agent

```
match_agent({ task_description: "代码实现" })
→ { agent_id: "software-engineer", score: 0.92 } ✅

match_agent({ task_description: "测试编写" })
→ { agent_id: "software-engineer", score: 0.78 } ✅

match_agent({ task_description: "文档编写" })
→ { agent_id: "software-engineer", score: 0.35 } ❌
```

#### 步骤 4：创建 Agent Team

```json
{
  "name": "login-feature-team",
  "strategy": "sequential",
  "members": [
    {
      "id": "developer",
      "agentId": "software-engineer",
      "capabilities": ["代码编写", "API设计"],
      "systemPrompt": "实现用户登录功能，包括后端API和前端页面",
      "scene": "write-code"
    },
    {
      "id": "tester",
      "agentId": "software-engineer",
      "capabilities": ["测试编写"],
      "systemPrompt": "为用户登录功能编写单元测试和集成测试",
      "scene": "test"
    },
    {
      "id": "doc-writer",
      "agentId": "technical-writer",  // 🆕 临时 Agent
      "capabilities": ["技术文档编写", "API文档"],
      "systemPrompt": "编写用户登录功能的API文档，包括接口说明、参数说明、返回值说明和使用示例"
    }
  ]
}
```

#### 步骤 5：系统自动处理

```
Phase 1: software-engineer (write-code)
  → 实现用户登录功能
  → 输出：代码文件

Phase 2: software-engineer (test)
  → 编写测试
  → 输出：测试文件

Phase 3: technical-writer (临时 Agent)
  → AgentRegistry 找不到 "technical-writer"
  → TemporaryAgentFactory 自动创建临时 Agent
  → 临时 Agent 编写文档
  → 输出：API文档
```

#### 步骤 6：主 Agent 汇总结果

```
主 Agent 回复用户:
"已完成用户登录功能的实现，包括：
1. 后端API和前端页面（已实现）
2. 单元测试和集成测试（已编写）
3. API文档（已生成）

所有文件已保存到项目目录。"
```

## 最佳实践

### 1. 优先使用预置 Agent

```
❌ 错误做法：
直接使用临时 Agent，不检查预置 Agent

✅ 正确做法：
1. 先使用 match_agent 查找预置 Agent
2. 如果 score >= 0.5，使用预置 Agent
3. 如果 score < 0.5，使用临时 Agent
```

### 2. 提供清晰的 systemPrompt

```
❌ 错误做法：
systemPrompt: "写文档"

✅ 正确做法：
systemPrompt: "编写用户登录功能的API文档，包括：
1. 接口说明（URL、方法、描述）
2. 参数说明（名称、类型、必填、说明）
3. 返回值说明（状态码、数据结构）
4. 使用示例（请求示例、响应示例）"
```

### 3. 指定合适的 capabilities

```
❌ 错误做法：
capabilities: ["写东西"]

✅ 正确做法：
capabilities: ["技术文档编写", "API文档", "用户指南"]
```

### 4. 使用描述性的角色名

```
❌ 错误做法：
agentId: "agent1"

✅ 正确做法：
agentId: "technical-writer"
```

## 常见问题

### Q1: 临时 Agent 和预置 Agent 有什么区别？

**A**: 主要区别：

| 方面 | 预置 Agent | 临时 Agent |
|------|-----------|-----------|
| 配置 | 预先配置，保存在文件中 | 运行时创建，不保存 |
| Prompt | 优化的 systemPrompt | 通用的 systemPrompt 模板 |
| 性能 | 更好（优化过） | 标准（通用配置） |
| 生命周期 | 永久 | 会话内 |
| API Key | 独立配置 | 继承父 Agent |

### Q2: 临时 Agent 会保存到配置文件吗？

**A**: 不会。临时 Agent 只存在于当前会话的内存中，会话结束后自动清理。

### Q3: 临时 Agent 可以使用所有工具吗？

**A**: 是的。临时 Agent 使用标准的工具集，包括：
- read_file, write_file, edit_file
- bash, glob, grep
- ask_user

### Q4: 临时 Agent 的性能如何？

**A**: 临时 Agent 使用通用的 systemPrompt 模板，性能略低于优化过的预置 Agent，但对于大多数任务来说足够好。

### Q5: 可以创建多少个临时 Agent？

**A**: 没有硬性限制，但建议：
- 单个任务：1-2 个临时 Agent
- 复杂任务：3-5 个临时 Agent
- 过多的临时 Agent 会影响性能

### Q6: 临时 Agent 可以调用其他 Agent 吗？

**A**: 可以，但不推荐。临时 Agent 应该专注于执行具体任务，而不是协调其他 Agent。

### Q7: 如何查看创建了哪些临时 Agent？

**A**: 临时 Agent 的创建和使用对用户是透明的。如果需要调试，可以查看日志：

```
[SubAgentFactory] Agent 配置不存在: technical-writer，尝试创建临时 Agent
[TemporaryAgentFactory] 创建临时 Agent: temp-technical-writer-1234567890 (Technical Writer)
```

## 总结

临时 Agent 是 Xuanji 系统的一个强大功能，它：

- ✅ **自动化**：无需显式创建，系统自动处理
- ✅ **灵活**：支持任意自定义角色
- ✅ **简单**：使用 agent_team 或 task 工具即可
- ✅ **高效**：会话内复用，自动清理
- ✅ **无缝**：与预置 Agent 使用相同的执行流程

当预置 Agent 无法满足需求时（match_agent score < 0.5），临时 Agent 是最佳选择！

---

**文档版本**：v1.0  
**更新日期**：2026-04-23  
**状态**：✅ 完整
