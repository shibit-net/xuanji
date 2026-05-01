# 工具错误处理改进总结

## 改进内容

### 1. 主 Agent 错误处理指导

**文件**: `src/core/templates/agents/xuanji.yaml`

**改进**:
- 在"重要原则"中添加了第 5 条：错误恢复原则
- 新增"错误处理"章节，明确指导 agent 如何处理工具错误
- 提供了 3 个常见错误场景的处理示例

**预期效果**:
主 agent 在遇到工具错误时，会：
1. 仔细阅读错误信息
2. 分析失败原因
3. 根据提示调整参数后重试
4. 最多重试 2 次，如果仍然失败才向用户报告

### 2. 结构化错误信息格式

**文件**: `src/core/tools/BaseTool.ts`

**改进**:
- 新增 `formatError()` 辅助方法
- 提供统一的错误信息格式：
  - ❌ 错误类型和简短描述
  - 原因：详细说明
  - 解决方案：1-3 个可行方案
  - 示例：正确的调用代码
  - 💡 提示：额外建议

**使用示例**:
```typescript
return this.formatError({
  type: '参数错误',
  message: '缺少必需参数 system_prompt',
  reason: '创建临时 agent 时必须提供 system_prompt 和 tools 参数。',
  solutions: [
    '先调用 match_agent 查找合适的预置 agent（推荐）',
    '提供 system_prompt 和 tools 参数创建临时 agent',
  ],
  example: 'task({ ... })',
  tip: '临时 agent 只应在没有合适的预置 agent 时使用。',
});
```

### 3. SubAgentFactory 错误信息改进

**文件**: `src/core/agent/SubAgentFactory.ts`

**改进**:
- 使用新的结构化错误格式
- 提供更清晰的错误原因说明
- 给出具体的解决方案和示例代码
- 添加预置 agent 列表提示

**改进前**:
```
❌ Agent "general-purpose" not found in registry.

To create a temporary agent, you MUST provide these parameters:
1. system_prompt: Define the agent's role...
2. tools: Specify which tools...
```

**改进后**:
```
❌ 参数错误: 缺少必需参数 'system_prompt'

原因：
创建临时 agent "general-purpose" 失败，因为该 agent 不在预置列表中。
创建临时 agent 时必须提供 system_prompt 和 tools 参数。

解决方案：
1. 先调用 match_agent 查找合适的预置 agent（推荐）
2. 如果没有合适的预置 agent（匹配分数 < 0.5），提供 system_prompt 和 tools 参数创建临时 agent

示例：
task({
  description: "分析代码质量",
  subagent_type: "general-purpose",
  system_prompt: "你是一个代码质量分析专家，负责检查代码规范、性能和安全问题。",
  tools: ["read_file", "grep", "glob"]  // 只分配必要的工具
})

💡 提示：
临时 agent 只应在没有合适的预置 agent 时使用（match_agent 分数 < 0.5）。
预置 agent 列表：coder, explore, plan, test-writer, doc-writer 等。
```

### 4. MatchAgentTool 错误信息改进

**文件**: `src/core/tools/MatchAgentTool.ts`

**改进**:
- 为 3 种错误场景添加结构化错误信息：
  1. AgentRegistry 未初始化（系统错误）
  2. 缺少 task_description 参数（参数错误）
  3. 没有可用的 agent（资源错误）

## 错误信息设计原则

1. **结构化**：使用统一的格式，让 LLM 更容易解析
2. **具体**：明确说明是哪个参数、为什么错误
3. **可操作**：提供 1-3 个具体的解决方案
4. **有示例**：包含可以直接使用的代码示例
5. **有提示**：提供额外的建议或最佳实践

## 错误类型分类

- **参数错误**：缺少必需参数、参数类型错误、参数值无效
- **权限错误**：文件读写权限不足、命令执行权限不足
- **资源错误**：文件不存在、Agent 不存在
- **状态错误**：超过最大嵌套深度、超过并发限制、超时
- **系统错误**：依赖服务未初始化、配置错误

## 测试建议

### 测试场景 1：使用不存在的 agent ID
```
输入：分析《出师表》这篇古文
预期：主 agent 应该：
1. 调用 task，使用不存在的 agent ID
2. 收到错误信息
3. 阅读错误信息，理解需要提供 system_prompt 和 tools
4. 重试，添加必要参数
5. 成功创建临时 agent
```

### 测试场景 2：match_agent 缺少参数
```
输入：match_agent({})
预期：返回结构化错误信息，说明缺少 task_description 参数
```

### 测试场景 3：多次失败后的处理
```
模拟：连续 2 次重试都失败
预期：主 agent 应该向用户说明情况，而不是继续重试
```

## 后续优化建议

1. **改进其他常用工具的错误信息**：
   - ReadFileTool - 文件不存在时的错误信息
   - WriteFileTool - 权限不足时的错误信息
   - BashTool - 命令执行失败时的错误信息

2. **添加重试计数器**：
   - 在工具结果中包含重试次数
   - 避免无限重试

3. **错误分类**：
   - 区分可重试错误和不可重试错误
   - 对于不可重试错误，直接向用户报告

4. **自动参数推断**：
   - 根据任务描述自动推断合适的 system_prompt
   - 根据任务类型自动推断需要的 tools

5. **错误统计和分析**：
   - 记录常见错误类型
   - 分析错误原因，改进工具设计

## 相关文档

- [错误处理改进说明](./error-handling-improvement.md)
- [工具错误信息规范](./tool-error-message-standard.md)

## 相关文件

- `/Users/kevinshi/Documents/workspace/codebase/shibit/xuanji/src/core/templates/agents/xuanji.yaml` - 主 agent 配置
- `/Users/kevinshi/Documents/workspace/codebase/shibit/xuanji/src/core/tools/BaseTool.ts` - 基础工具类
- `/Users/kevinshi/Documents/workspace/codebase/shibit/xuanji/src/core/tools/TaskTool.ts` - task 工具
- `/Users/kevinshi/Documents/workspace/codebase/shibit/xuanji/src/core/tools/MatchAgentTool.ts` - match_agent 工具
- `/Users/kevinshi/Documents/workspace/codebase/shibit/xuanji/src/core/agent/SubAgentFactory.ts` - 子 agent 工厂

## 总结

这次改进主要解决了主 agent 在遇到工具错误时直接终止的问题。通过：

1. **在主 agent 的 prompt 中添加错误处理指导**，让 agent 知道应该重试
2. **提供结构化的错误信息**，让 agent 更容易理解错误原因和解决方案
3. **包含具体的示例代码**，让 agent 可以直接使用

预期主 agent 在遇到工具错误时，能够根据错误信息自动调整参数并重试，而不是直接向用户报告错误。这将大大提高系统的鲁棒性和用户体验。
