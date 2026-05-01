# 临时 Agent 创建功能改进总结

## 改进概述

本次改进主要解决了主 agent 创建临时 agent 时的错误处理和指导问题，使其能够更好地理解如何正确创建临时 agent。

## 改进内容

### 1. 优化错误消息（SubAgentFactory.ts）

**位置**：`src/core/agent/SubAgentFactory.ts` 第 477-493 行

**改进前**：
```typescript
throw new Error(
  `Agent "${agentIdOrRole}" not found in registry. ` +
  `To create a temporary agent, you must provide a "system_prompt" parameter.`
);
```

**改进后**：
```typescript
throw new Error(
  `❌ Agent "${agentIdOrRole}" not found in registry.\n\n` +
  `To create a temporary agent, you MUST provide these parameters:\n` +
  `1. system_prompt: Define the agent's role, behavior, and capabilities\n` +
  `2. tools: Specify which tools the agent can use (e.g., ["read_file", "grep", "bash"])\n\n` +
  `Example:\n` +
  `task({\n` +
  `  description: "Your task description",\n` +
  `  subagent_type: "${agentIdOrRole}",\n` +
  `  system_prompt: "You are a ${agentIdOrRole}. Your role is to...",\n` +
  `  tools: ["read_file", "grep", "glob"]\n` +
  `})\n\n` +
  `💡 TIP: Before creating a temporary agent, try calling match_agent to find a preset agent.`
);
```

**改进点**：
- ✅ 清晰列出必需参数（system_prompt 和 tools）
- ✅ 提供完整的代码示例
- ✅ 使用用户提供的 agent ID 生成示例
- ✅ 提示先尝试 match_agent
- ✅ 使用表情符号增强可读性

### 2. 优化主 Agent Prompt（MainAgent.ts）

**位置**：`src/core/agent/dispatch/MainAgent.ts` 第 138-230 行

**改进内容**：

#### 2.1 重写"创建临时 Agent"章节

**改进前**：
```markdown
### 8. 补充缺失能力

如果某个能力没有合适的 Agent：
- 使用 `general-purpose` 作为基础
- 通过 `systemPrompt` 定义临时 Agent 的行为
- 为临时 Agent 分配合适的 scene

**示例**：
{
  id: "temp-analyst",
  agentId: "general-purpose",
  scene: "analyze",
  systemPrompt: "你是数据分析师..."
}
```

**改进后**：
```markdown
### 8. 创建临时 Agent（当没有合适的预设 Agent 时）

**何时创建临时 Agent**：
- `match_agent` 返回的 score < 0.5
- 任务需要非常专业的领域知识（如哲学、法律、医学等）
- 预设 Agent 都不适合当前任务

**如何创建临时 Agent**：

使用 `task` 工具时，必须提供以下参数：

1. **subagent_type**：自定义的 agent ID（如 "philosophy-analyst"）
2. **system_prompt**：定义 agent 的角色、能力和行为
3. **tools**：指定 agent 可以使用的工具列表

**system_prompt 编写要点**：
- 明确角色定位："你是一个 XXX 专家"
- 列出核心能力和职责
- 说明工作方式和输出格式
- 保持简洁，200-300 字即可

**tools 选择原则**：
- 只读任务：`["read_file", "grep", "glob"]`
- 分析任务：`["read_file", "grep", "bash"]`
- 编写任务：`["read_file", "write_file", "edit_file"]`
- 综合任务：根据需要组合

**完整示例**：

// 示例1：哲学分析师
task({
  description: "分析'AI是否会取代人类'这个问题...",
  subagent_type: "philosophy-analyst",
  system_prompt: "你是一位哲学分析专家，擅长从多个角度深入分析...",
  tools: ["read_file", "grep"],
  scene: "general"
})

// 示例2：法律顾问
task({
  description: "分析劳动合同中的风险条款",
  subagent_type: "legal-advisor",
  system_prompt: "你是一位专业的法律顾问，专注于劳动法领域...",
  tools: ["read_file", "grep", "glob"],
  scene: "analyze"
})

// 示例3：数据分析师
task({
  description: "分析用户行为数据，生成可视化报告",
  subagent_type: "data-analyst",
  system_prompt: "你是一位数据分析师，擅长数据处理和可视化...",
  tools: ["read_file", "write_file", "bash"],
  scene: "analyze"
})

**注意事项**：
- ❌ 不要使用不存在的 agent ID 而不提供 system_prompt
- ❌ 不要忘记指定 tools 参数
- ✅ system_prompt 要具体明确，不要太泛泛
- ✅ tools 只分配必要的工具，避免安全风险
```

**改进点**：
- ✅ 明确何时创建临时 agent
- ✅ 详细说明必需参数
- ✅ 提供 system_prompt 编写指南
- ✅ 提供 tools 选择原则
- ✅ 提供 3 个完整的实际示例
- ✅ 列出注意事项

### 3. 创建详细文档

**文件**：`docs/temporary-agent-creation-guide.md`

**内容**：
- 何时创建临时 Agent（判断标准、常见场景）
- 如何创建临时 Agent（必需参数、编写指南）
- system_prompt 编写指南（结构、要点、示例）
- tools 选择指南（原则、常见组合、工具说明）
- 完整示例（4 个不同领域的示例）
- 错误处理（常见错误、错误消息、解决方案）
- 最佳实践（5 个关键实践）

## 改进效果

### 改进前的问题

```
[GUI] 📝 [Agent] [TaskTool] execute() called
[GUI] 🚨 [Agent Error] 创建临时 Agent 失败: agent_id="philosophy-analyst" 不存在，且未提供 system_prompt 参数
[GUI] 🚨 [Agent Error] Agent "philosophy-analyst" not found in registry. To create a temporary agent, you must provide a "system_prompt" parameter.
```

主 agent 收到错误后：
- ❌ 不知道还需要提供 tools 参数
- ❌ 不知道如何编写 system_prompt
- ❌ 没有示例参考
- ❌ 可能继续犯同样的错误

### 改进后的效果

```
[GUI] 🚨 [Agent Error] ❌ Agent "philosophy-analyst" not found in registry.

To create a temporary agent, you MUST provide these parameters:
1. system_prompt: Define the agent's role, behavior, and capabilities
2. tools: Specify which tools the agent can use (e.g., ["read_file", "grep", "bash"])

Example:
task({
  description: "Your task description",
  subagent_type: "philosophy-analyst",
  system_prompt: "You are a philosophy-analyst. Your role is to...",
  tools: ["read_file", "grep", "glob"]
})

💡 TIP: Before creating a temporary agent, try calling match_agent to find a preset agent.
```

主 agent 收到错误后：
- ✅ 清楚知道需要提供 system_prompt 和 tools
- ✅ 有完整的代码示例可以参考
- ✅ 知道应该先尝试 match_agent
- ✅ 可以根据示例正确修正参数

## 测试场景

### 场景1：哲学问题分析

**用户输入**：
```
分析"AI是否会取代人类"这个问题
```

**预期流程**：

1. 主 agent 分析任务，发现需要哲学分析能力
2. 调用 `match_agent` 查找合适的 agent
3. 发现没有合适的预设 agent（score < 0.5）
4. 创建临时 agent：
   ```javascript
   task({
     description: "分析'AI是否会取代人类'这个问题，从技术、伦理、社会等角度深入探讨",
     subagent_type: "philosophy-analyst",
     system_prompt: "你是一位哲学分析专家，擅长从多个角度深入分析复杂的哲学和伦理问题。你的分析应该：1. 逻辑严密，论证充分 2. 考虑多个视角和观点 3. 提供深刻的洞察 4. 结构清晰，易于理解",
     tools: ["read_file", "grep"],
     scene: "general",
     stream_to_user: true
   })
   ```
5. 临时 agent 成功创建并执行任务
6. 输出分析结果给用户

### 场景2：法律咨询

**用户输入**：
```
帮我分析这份劳动合同的风险条款
```

**预期流程**：

1. 主 agent 分析任务，发现需要法律专业知识
2. 调用 `match_agent` 查找合适的 agent
3. 发现没有合适的预设 agent
4. 创建临时 agent：
   ```javascript
   task({
     description: "分析劳动合同中的风险条款，识别潜在法律问题",
     subagent_type: "legal-advisor",
     system_prompt: "你是一位专业的法律顾问，专注于劳动法领域。你的职责是：1. 识别合同中的风险条款 2. 解释法律含义 3. 提供修改建议 4. 评估法律风险等级",
     tools: ["read_file", "grep", "glob"],
     scene: "analyze"
   })
   ```
5. 临时 agent 分析合同并返回结果
6. 主 agent 整理并输出给用户

## 相关文件

### 修改的文件

1. `src/core/agent/SubAgentFactory.ts`
   - 优化临时 agent 创建失败的错误消息

2. `src/core/agent/dispatch/MainAgent.ts`
   - 重写"创建临时 Agent"章节
   - 添加详细的编写指南和示例
   - 添加注意事项

### 新增的文件

1. `docs/temporary-agent-creation-guide.md`
   - 完整的临时 agent 创建指南
   - 包含判断标准、编写指南、示例、错误处理、最佳实践

## 总结

通过这次改进：

1. ✅ **错误消息更清晰**：主 agent 能够理解错误原因和解决方法
2. ✅ **Prompt 更详细**：提供了完整的创建指南和示例
3. ✅ **文档更完善**：创建了详细的参考文档
4. ✅ **用户体验更好**：主 agent 能够正确创建临时 agent，减少失败率

现在主 agent 可以更智能地处理需要专业领域知识的任务，通过动态创建临时 agent 来扩展自己的能力范围。
