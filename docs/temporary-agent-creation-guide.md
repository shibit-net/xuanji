# 临时 Agent 创建指南

## 概述

当预设 Agent 无法满足任务需求时，主 agent 可以动态创建临时 Agent。本文档说明何时以及如何创建临时 Agent。

## 何时创建临时 Agent

### 判断标准

1. **使用 match_agent 评估**
   ```javascript
   match_agent({ task_description: "分析哲学问题" })
   ```
   - 如果 score >= 0.5：使用推荐的预设 Agent
   - 如果 score < 0.5：考虑创建临时 Agent

2. **任务特征**
   - 需要非常专业的领域知识（哲学、法律、医学、金融等）
   - 预设 Agent 都不适合
   - 需要特定的行为模式或输出格式

### 常见场景

| 场景 | 是否需要临时 Agent | 原因 |
|------|-------------------|------|
| 编写代码 | ❌ 否 | 使用预设的 `coder` agent |
| 调试问题 | ❌ 否 | 使用预设的 `explore` agent |
| 哲学分析 | ✅ 是 | 需要专业的哲学知识 |
| 法律咨询 | ✅ 是 | 需要专业的法律知识 |
| 医学诊断 | ✅ 是 | 需要专业的医学知识 |
| 数据分析 | ⚠️ 视情况 | 简单分析用 `general-purpose`，复杂分析创建临时 Agent |

## 如何创建临时 Agent

### 必需参数

创建临时 Agent 时，必须提供以下参数：

1. **subagent_type**：自定义的 agent ID
2. **system_prompt**：定义 agent 的角色和行为
3. **tools**：指定 agent 可以使用的工具

### system_prompt 编写指南

**结构**：
```
你是一个 [角色定位]，擅长 [核心能力]。

你的职责：
1. [职责1]
2. [职责2]
3. [职责3]

工作方式：
- [工作流程或方法]
- [输出格式要求]
```

**要点**：
- ✅ 明确角色定位
- ✅ 列出核心能力和职责
- ✅ 说明工作方式和输出格式
- ✅ 保持简洁（200-300字）
- ❌ 不要太泛泛
- ❌ 不要包含技术实现细节

**示例**：

```javascript
// 好的 system_prompt
"你是一位哲学分析专家，擅长从多个角度深入分析复杂的哲学和伦理问题。你的分析应该：1. 逻辑严密，论证充分 2. 考虑多个视角和观点 3. 提供深刻的洞察 4. 结构清晰，易于理解"

// 不好的 system_prompt（太泛泛）
"你是一个助手，帮助用户完成任务"

// 不好的 system_prompt（太长，包含技术细节）
"你是一个哲学专家。你需要使用 read_file 工具读取文件，然后使用 grep 工具搜索关键词..."
```

### tools 选择指南

**原则**：只分配必要的工具，避免安全风险

**常见组合**：

| 任务类型 | 推荐工具 | 说明 |
|---------|---------|------|
| 只读分析 | `["read_file", "grep", "glob"]` | 只能读取和搜索文件 |
| 数据处理 | `["read_file", "bash"]` | 可以执行脚本处理数据 |
| 内容生成 | `["read_file", "write_file"]` | 可以读取参考资料并生成新文件 |
| 代码编辑 | `["read_file", "write_file", "edit_file"]` | 可以修改现有代码 |
| 综合任务 | 根据需要组合 | 按需分配 |

**工具说明**：

- **read_file**：读取文件内容
- **write_file**：创建新文件
- **edit_file**：修改现有文件
- **grep**：搜索文件内容
- **glob**：查找文件
- **bash**：执行命令（⚠️ 谨慎使用）

### 完整示例

#### 示例1：哲学分析师

```javascript
task({
  description: "分析'AI是否会取代人类'这个问题，从技术、伦理、社会等角度深入探讨",
  subagent_type: "philosophy-analyst",
  system_prompt: "你是一位哲学分析专家，擅长从多个角度深入分析复杂的哲学和伦理问题。你的分析应该：1. 逻辑严密，论证充分 2. 考虑多个视角和观点 3. 提供深刻的洞察 4. 结构清晰，易于理解",
  tools: ["read_file", "grep"],
  scene: "general",
  stream_to_user: true  // 直接输出给用户
})
```

#### 示例2：法律顾问

```javascript
task({
  description: "分析劳动合同中的风险条款，识别潜在法律问题",
  subagent_type: "legal-advisor",
  system_prompt: "你是一位专业的法律顾问，专注于劳动法领域。你的职责是：1. 识别合同中的风险条款 2. 解释法律含义 3. 提供修改建议 4. 评估法律风险等级",
  tools: ["read_file", "grep", "glob"],
  scene: "analyze"
})
```

#### 示例3：数据分析师

```javascript
task({
  description: "分析用户行为数据，生成可视化报告",
  subagent_type: "data-analyst",
  system_prompt: "你是一位数据分析师，擅长数据处理和可视化。你的工作流程：1. 读取和清洗数据 2. 进行统计分析 3. 生成图表 4. 撰写分析报告",
  tools: ["read_file", "write_file", "bash"],
  scene: "analyze"
})
```

#### 示例4：技术文档作者

```javascript
task({
  description: "为新功能编写技术文档",
  subagent_type: "tech-writer",
  system_prompt: "你是一位技术文档作者，擅长将复杂的技术概念转化为清晰易懂的文档。你的文档应该：1. 结构清晰，层次分明 2. 包含代码示例 3. 提供使用场景 4. 注重用户体验",
  tools: ["read_file", "write_file", "grep"],
  scene: "write-doc"
})
```

## 错误处理

### 常见错误

#### 错误1：忘记提供 system_prompt

```javascript
// ❌ 错误
task({
  description: "分析哲学问题",
  subagent_type: "philosophy-analyst"  // 不存在的 agent，但没有提供 system_prompt
})
```

**错误消息**：
```
❌ Agent "philosophy-analyst" not found in registry.

To create a temporary agent, you MUST provide these parameters:
1. system_prompt: Define the agent's role, behavior, and capabilities
2. tools: Specify which tools the agent can use

Example:
task({
  description: "Your task description",
  subagent_type: "philosophy-analyst",
  system_prompt: "You are a philosophy-analyst. Your role is to...",
  tools: ["read_file", "grep", "glob"]
})

💡 TIP: Before creating a temporary agent, try calling match_agent to find a preset agent.
```

**解决方案**：
```javascript
// ✅ 正确
task({
  description: "分析哲学问题",
  subagent_type: "philosophy-analyst",
  system_prompt: "你是一位哲学分析专家...",
  tools: ["read_file", "grep"]
})
```

#### 错误2：忘记提供 tools

```javascript
// ❌ 错误
task({
  description: "分析哲学问题",
  subagent_type: "philosophy-analyst",
  system_prompt: "你是一位哲学分析专家..."
  // 缺少 tools 参数
})
```

**后果**：临时 agent 没有任何工具可用，无法完成任务

**解决方案**：
```javascript
// ✅ 正确
task({
  description: "分析哲学问题",
  subagent_type: "philosophy-analyst",
  system_prompt: "你是一位哲学分析专家...",
  tools: ["read_file", "grep"]  // 明确指定工具
})
```

#### 错误3：system_prompt 太泛泛

```javascript
// ❌ 不好
system_prompt: "你是一个助手"

// ✅ 好
system_prompt: "你是一位哲学分析专家，擅长从多个角度深入分析复杂的哲学和伦理问题..."
```

## 最佳实践

### 1. 优先使用预设 Agent

```javascript
// 步骤1：先尝试匹配预设 agent
const match = match_agent({ task_description: "分析代码质量" })

// 步骤2：根据匹配结果决策
if (match.score >= 0.5) {
  // 使用预设 agent
  task({
    description: "分析代码质量",
    subagent_type: match.agent_id
  })
} else {
  // 创建临时 agent
  task({
    description: "分析代码质量",
    subagent_type: "code-quality-analyst",
    system_prompt: "...",
    tools: ["read_file", "grep"]
  })
}
```

### 2. system_prompt 要具体

```javascript
// ❌ 太泛泛
"你是一个分析师"

// ✅ 具体明确
"你是一位代码质量分析师，专注于识别代码异味、性能问题和安全漏洞。你的分析应该：1. 使用业界标准（如 SOLID 原则）2. 提供具体的改进建议 3. 评估问题的严重程度"
```

### 3. 只分配必要的工具

```javascript
// ❌ 分配过多工具（安全风险）
tools: ["read_file", "write_file", "edit_file", "bash", "grep", "glob"]

// ✅ 只分配必要的工具
tools: ["read_file", "grep"]  // 只读分析任务只需要这两个
```

### 4. 选择合适的 scene

```javascript
// 分析任务
scene: "analyze"

// 编写任务
scene: "write-code"

// 调试任务
scene: "debug"

// 通用任务
scene: "general"
```

### 5. 考虑是否需要 stream_to_user

```javascript
// 独立任务，直接输出给用户
task({
  description: "解读《出师表》",
  subagent_type: "literature-analyst",
  system_prompt: "...",
  tools: ["read_file"],
  stream_to_user: true  // 直接输出
})

// 需要后续处理的任务
task({
  description: "分析代码结构",
  subagent_type: "code-analyst",
  system_prompt: "...",
  tools: ["read_file", "grep"]
  // stream_to_user: false（默认），结果返回给主 agent
})
```

## 总结

创建临时 Agent 的关键：

1. ✅ 先用 `match_agent` 尝试找预设 agent
2. ✅ 必须提供 `system_prompt` 和 `tools`
3. ✅ system_prompt 要具体明确
4. ✅ 只分配必要的工具
5. ✅ 选择合适的 scene
6. ✅ 考虑是否需要 stream_to_user

遵循这些原则，可以确保临时 Agent 创建成功并高效完成任务。
