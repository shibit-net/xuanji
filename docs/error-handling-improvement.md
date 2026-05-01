# 主 Agent 错误处理机制改进

## 问题描述

主 agent 在调用 task 工具时，如果遇到错误（例如找不到指定的 agent），会直接终止执行，而不是根据错误信息调整参数后重试。

### 问题示例

```
用户：分析《出师表》这篇古文
主 agent：调用 task 工具，subagent_type="general-purpose"
SubAgentFactory：❌ Agent "general-purpose" not found in registry.
                 To create a temporary agent, you MUST provide:
                 1. system_prompt: Define the agent's role...
                 2. tools: Specify which tools...
主 agent：[直接终止，没有重试]
```

## 根本原因

1. **主 agent 的 prompt 缺少错误处理指导**：没有明确告诉 agent 在工具失败时应该如何处理
2. **LLM 的默认行为**：当遇到错误时，LLM 倾向于向用户报告错误，而不是自动重试
3. **错误信息虽然详细，但没有明确的"重试"指令**

## 解决方案

### 1. 在 xuanji.yaml 中添加错误处理指导

在 `systemPrompt` 中添加了以下内容：

#### 重要原则（第 5 条）
```yaml
5. **错误恢复**：当工具调用失败时，仔细阅读错误信息，根据提示调整参数后重试，不要直接放弃
```

#### 错误处理章节
```yaml
## 错误处理

当工具调用失败时，你应该：

1. **仔细阅读错误信息**：错误信息通常包含失败原因和解决方案
2. **分析失败原因**：理解为什么工具调用失败
3. **调整参数重试**：根据错误提示修正参数后重试
4. **最多重试 2 次**：如果 2 次重试都失败，向用户说明情况
```

#### 常见错误场景示例

提供了 3 个常见错误场景的处理方法：

**场景 1：task 工具找不到 agent**
- 错误：`Agent "general-purpose" not found in registry.`
- 解决：先调用 match_agent，或创建临时 agent 时提供必要参数

**场景 2：临时 agent 缺少参数**
- 错误：`创建临时 Agent 失败: 未提供 system_prompt 参数`
- 解决：提供 system_prompt 和 tools 参数

**场景 3：权限不足**
- 错误：`Permission denied`
- 解决：使用 ask_user 请求授权，或使用更安全的替代方案

## 预期效果

修改后，主 agent 在遇到工具错误时应该：

1. **第一次失败**：阅读错误信息，理解失败原因
2. **调整参数**：根据错误提示修正参数（例如添加 system_prompt 和 tools）
3. **重试**：使用修正后的参数再次调用工具
4. **最多 2 次重试**：如果 2 次重试都失败，向用户说明情况

### 改进后的执行流程

```
用户：分析《出师表》这篇古文
主 agent：调用 task 工具，subagent_type="general-purpose"
SubAgentFactory：❌ Agent "general-purpose" not found in registry.
                 To create a temporary agent, you MUST provide:
                 1. system_prompt: Define the agent's role...
                 2. tools: Specify which tools...
主 agent：[阅读错误信息] 我需要提供 system_prompt 和 tools 参数
主 agent：[重试] 调用 task 工具，添加必要参数：
          task({
            description: "分析《出师表》...",
            subagent_type: "general-purpose",
            system_prompt: "你是一个古文分析专家...",
            tools: ["read_file", "web_fetch"]
          })
SubAgentFactory：✅ 创建临时 agent 成功
主 agent：[完成] 向用户展示分析结果
```

## 测试建议

1. **测试场景 1**：使用不存在的 agent ID
   - 输入：`分析《出师表》这篇古文`
   - 预期：主 agent 应该自动重试，提供必要参数

2. **测试场景 2**：创建临时 agent 但缺少参数
   - 输入：`帮我分析这段代码的性能瓶颈`
   - 预期：主 agent 应该补充 system_prompt 和 tools 后重试

3. **测试场景 3**：多次失败后的处理
   - 模拟：连续 2 次重试都失败
   - 预期：主 agent 应该向用户说明情况，而不是继续重试

## 后续优化建议

1. **改进错误信息格式**：使用更结构化的格式（例如 JSON），让 LLM 更容易解析
2. **添加重试计数器**：在工具结果中包含重试次数，避免无限重试
3. **错误分类**：区分可重试错误和不可重试错误
4. **自动参数推断**：根据任务描述自动推断合适的 system_prompt 和 tools

## 相关文件

- `/Users/kevinshi/Documents/workspace/codebase/shibit/xuanji/src/core/templates/agents/xuanji.yaml` - 主 agent 配置
- `/Users/kevinshi/Documents/workspace/codebase/shibit/xuanji/src/core/tools/TaskTool.ts` - task 工具实现
- `/Users/kevinshi/Documents/workspace/codebase/shibit/xuanji/src/core/agent/SubAgentFactory.ts` - 子 agent 工厂

