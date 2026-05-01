# 工具错误信息规范

## 目标

所有工具在发生异常时，都应该提供清晰、结构化的错误信息，帮助调用它的 agent 理解问题并修正调用。

## 错误信息格式

### 基本结构

```
❌ [错误类型]: [简短描述]

原因：
[详细说明为什么会发生这个错误]

解决方案：
1. [第一个解决方案]
2. [第二个解决方案]（如果有）

示例：
[正确的调用示例代码]

💡 提示：
[额外的建议或最佳实践]
```

### 示例 1：参数缺失

```
❌ 参数错误: 缺少必需参数 'system_prompt'

原因：
创建临时 agent "general-purpose" 失败，因为该 agent 不在预置列表中。
创建临时 agent 时必须提供 system_prompt 和 tools 参数。

解决方案：
1. 先调用 match_agent 查找合适的预置 agent（推荐）
2. 如果没有合适的预置 agent，提供 system_prompt 和 tools 参数创建临时 agent

示例：
task({
  description: "分析代码质量",
  subagent_type: "code-analyzer",
  system_prompt: "你是一个代码质量分析专家，负责检查代码规范、性能和安全问题。",
  tools: ["read_file", "grep", "glob"]
})

💡 提示：
临时 agent 只应在没有合适的预置 agent 时使用（match_agent 分数 < 0.5）。
```

### 示例 2：权限不足

```
❌ 权限错误: 无法写入文件 '/path/to/file.ts'

原因：
当前 agent 没有文件写入权限，或者文件被其他进程锁定。

解决方案：
1. 使用 ask_user 工具请求用户授权
2. 检查文件是否被其他进程占用
3. 使用只读工具（read_file, grep）替代

示例：
ask_user({
  question: "我需要修改文件 '/path/to/file.ts'，是否允许？",
  options: ["允许", "拒绝"]
})

💡 提示：
对于敏感操作，始终先请求用户确认。
```

### 示例 3：资源不存在

```
❌ 文件不存在: '/path/to/missing-file.ts'

原因：
指定的文件路径不存在，可能是路径错误或文件已被删除。

解决方案：
1. 使用 glob 工具搜索类似的文件名
2. 使用 grep 工具在项目中搜索相关代码
3. 检查文件路径是否正确（注意大小写）

示例：
glob({
  pattern: "**/*missing-file*"
})

💡 提示：
使用 glob 时，** 表示递归搜索所有子目录。
```

## 实现指南

### 1. 在 BaseTool 中添加辅助方法

```typescript
protected formatError(options: {
  type: string;
  message: string;
  reason: string;
  solutions: string[];
  example?: string;
  tip?: string;
}): ToolResult {
  const { type, message, reason, solutions, example, tip } = options;
  
  const content = [
    `❌ ${type}: ${message}`,
    '',
    '原因：',
    reason,
    '',
    '解决方案：',
    ...solutions.map((s, i) => `${i + 1}. ${s}`),
  ];
  
  if (example) {
    content.push('', '示例：', example);
  }
  
  if (tip) {
    content.push('', '💡 提示：', tip);
  }
  
  return this.error(content.join('\n'));
}
```

### 2. 在具体工具中使用

```typescript
// TaskTool.ts
if (!systemPrompt) {
  return this.formatError({
    type: '参数错误',
    message: '缺少必需参数 system_prompt',
    reason: `创建临时 agent "${agentId}" 失败，因为该 agent 不在预置列表中。\n创建临时 agent 时必须提供 system_prompt 和 tools 参数。`,
    solutions: [
      '先调用 match_agent 查找合适的预置 agent（推荐）',
      '如果没有合适的预置 agent，提供 system_prompt 和 tools 参数创建临时 agent',
    ],
    example: `task({
  description: "分析代码质量",
  subagent_type: "${agentId}",
  system_prompt: "你是一个代码质量分析专家，负责检查代码规范、性能和安全问题。",
  tools: ["read_file", "grep", "glob"]
})`,
    tip: '临时 agent 只应在没有合适的预置 agent 时使用（match_agent 分数 < 0.5）。',
  });
}
```

## 错误类型分类

### 1. 参数错误
- 缺少必需参数
- 参数类型错误
- 参数值无效

### 2. 权限错误
- 文件读写权限不足
- 命令执行权限不足
- 网络访问权限不足

### 3. 资源错误
- 文件不存在
- 目录不存在
- Agent 不存在

### 4. 状态错误
- 超过最大嵌套深度
- 超过并发限制
- 超时

### 5. 执行错误
- 命令执行失败
- 网络请求失败
- 解析错误

## 最佳实践

1. **错误信息要具体**：不要只说"参数错误"，要说明是哪个参数、为什么错误
2. **提供多个解决方案**：给 agent 多个选择，让它根据上下文选择最合适的
3. **包含示例代码**：示例代码应该是可以直接使用的，只需要替换具体的值
4. **添加提示信息**：提供额外的建议或最佳实践，帮助 agent 避免类似错误
5. **使用表情符号**：❌ 表示错误，💡 表示提示，✅ 表示成功，让信息更易读

## 需要改进的工具列表

### 高优先级（常用且容易出错）
- [x] TaskTool - SubAgentFactory 错误信息已改进
- [x] MatchAgentTool - 已添加结构化错误信息
- [x] BaseTool - 已添加 formatError 辅助方法
- [ ] ReadFileTool - 文件不存在时的错误信息
- [ ] WriteFileTool - 权限不足时的错误信息
- [ ] BashTool - 命令执行失败时的错误信息

### 中优先级
- [ ] GrepTool - 搜索失败时的建议
- [ ] GlobTool - 模式匹配失败时的建议
- [ ] AskUserTool - 参数错误时的建议

### 低优先级
- [ ] 其他工具 - 根据实际使用情况决定

## 测试计划

1. **单元测试**：为每个工具的错误场景编写测试
2. **集成测试**：测试 agent 是否能根据错误信息正确重试
3. **用户测试**：收集用户反馈，改进错误信息的清晰度

## 相关文件

- `/Users/kevinshi/Documents/workspace/codebase/shibit/xuanji/src/core/tools/BaseTool.ts` - 基础工具类
- `/Users/kevinshi/Documents/workspace/codebase/shibit/xuanji/src/core/tools/TaskTool.ts` - task 工具
- `/Users/kevinshi/Documents/workspace/codebase/shibit/xuanji/src/core/tools/MatchAgentTool.ts` - match_agent 工具
