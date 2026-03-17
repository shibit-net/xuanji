# Xuanji 委托功能测试指南

## 📋 功能概述

委托系统允许主 Agent 将任务分派给专业的子 Agent 在隔离环境中执行。

### 可用的子 Agent 类型

| Agent ID | 名称 | 功能 | 权限 | 最佳用途 |
|----------|------|------|------|----------|
| `explore` | 探索助手 🔍 | 代码搜索、文件查找 | 只读 | 快速分析代码结构 |
| `plan` | 架构师 🏗️ | 架构设计、方案规划 | 只读 | 技术选型、设计评估 |
| `coder` | 编程助手 💻 | 代码编写、bug修复 | 可写 | 功能实现、代码重构 |
| `general-purpose` | 通用助手 | 其他需要隔离的任务 | 完整 | 默认选项 |

---

## 🧪 测试场景

### 1. 基础委托测试 - Explore Agent

**用户输入**:
```
用 explore agent 分析 src/core/tools 目录的结构
```

**预期行为**:
- 调用 `delegate` 工具
- `subagent_type: "explore"`
- 子 Agent 使用 `glob`、`grep`、`read_file` 等只读工具
- 返回结构化的分析报告

**验证点**:
- ✅ 子 Agent 能成功执行
- ✅ 只使用只读工具（不调用 bash/write_file）
- ✅ 结果包含元数据（duration, iterations, tokens）
- ✅ 嵌套深度限制生效

---

### 2. 架构设计委托 - Plan Agent

**用户输入**:
```
让 plan agent 设计一个新的 MCP server 管理功能的架构
```

**预期行为**:
- 调用 `delegate` 工具
- `subagent_type: "plan"`
- 子 Agent 分析现有代码，设计方案（只读）
- 返回架构设计文档

**验证点**:
- ✅ 子 Agent 不能执行写操作
- ✅ 方案包含具体的模块划分和接口设计
- ✅ 超时控制正常（默认 5 分钟）

---

### 3. 代码编写委托 - Coder Agent

**用户输入**:
```
用 coder agent 实现一个简单的 CSV 解析工具函数
```

**预期行为**:
- 调用 `delegate` 工具
- `subagent_type: "coder"`
- 子 Agent 有写权限，可以创建/修改文件
- 返回实现代码和测试

**验证点**:
- ✅ 子 Agent 能创建新文件
- ✅ 代码符合项目规范
- ✅ 并发限制生效（最多 3 个子 Agent）

---

### 4. 并行委托测试

**用户输入**:
```
同时用三个 explore agent 分别分析 src/core、src/adapters、src/mcp 目录
```

**预期行为**:
- 并行调用 3 个 `delegate` 工具
- 每个子 Agent 分析不同的目录
- 第 4 个委托请求应该被拒绝（超过并发限制）

**验证点**:
- ✅ 3 个子 Agent 并行执行
- ✅ 第 4 个请求返回 "Maximum concurrent sub-agents (3) reached"
- ✅ 所有子 Agent 完成后，可以再次委托

---

### 5. 上下文传递测试

**用户输入**:
```
我正在重构工具系统。用 explore agent 找出所有继承自 BaseTool 的类，并传递当前上下文。
```

**预期行为**:
- 调用 `delegate` 工具
- `include_parent_context: true`
- 子 Agent 收到父 Agent 的上下文摘要

**验证点**:
- ✅ 子 Agent 能理解父任务的背景
- ✅ 搜索结果更有针对性

---

### 6. 隔离模式测试 - Worktree

**用户输入**:
```
在 worktree 隔离环境中，用 coder agent 尝试重构 DelegateTool 的错误处理逻辑
```

**预期行为**:
- 调用 `delegate` 工具
- `isolation: "worktree"`
- 创建临时 git worktree
- 子 Agent 在隔离环境中修改代码
- 完成后清理 worktree

**验证点**:
- ✅ Worktree 创建成功
- ✅ 子 Agent 在隔离环境中工作
- ✅ 主分支不受影响
- ✅ 清理完整（无残留 worktree）

---

### 7. 递归限制测试

**用户输入** (在子 Agent 内部):
```
用 explore agent 再创建一个子 Agent 分析代码
```

**预期行为**:
- 第 1 层嵌套：✅ 允许
- 第 2 层嵌套：✅ 允许
- 第 3 层嵌套：✅ 允许
- 第 4 层嵌套：❌ 拒绝 "Maximum nesting depth exceeded"

**验证点**:
- ✅ 最大嵌套深度为 3 层
- ✅ 超过限制时友好报错

---

### 8. 超时测试

**用户输入**:
```
用 explore agent 搜索整个 node_modules 目录（故意设置较短超时）
```

**调用参数**:
```typescript
{
  description: "搜索 node_modules 中的所有 TypeScript 类型定义",
  subagent_type: "explore",
  timeout: 10000  // 10 秒
}
```

**预期行为**:
- 10 秒后自动中止
- 返回 `timedOut: true`
- 提示超时信息

**验证点**:
- ✅ 超时控制生效
- ✅ 不会无限执行
- ✅ 部分结果仍然返回

---

## 🔍 调试检查清单

### 工具注册检查
```bash
# 在 CLI 中测试
xuanji chat
> 列出所有可用工具

# 预期包含:
# - delegate
# - orchestrate
# - quick_team
```

### 依赖注入检查
```typescript
// 检查 ChatSession.initTaskTool() 是否被调用
// 检查 DelegateTool.setDependencies() 是否成功注入:
// - providerManager ✅
// - agentRegistry ✅
// - registry ✅
// - agentConfig ✅
// - hookRegistry ✅
// - memoryStore ✅
```

### Agent 加载检查
```bash
# 检查内置 Agent 是否加载
ls -la src/core/agent/builtin/

# 预期文件:
# - explore.json5
# - plan.json5
# - coder.json5
# - general-purpose.json5
```

---

## 📊 预期输出格式

### 成功执行
```
[Sub-agent completed] Duration: 12.3s | Iterations: 8 | Tokens: 1234 in / 567 out

<子 Agent 的执行结果>
```

### 并发超限
```
[Error] Maximum concurrent sub-agents (3) reached. Wait for current tasks to complete.
```

### 嵌套超限
```
[Error] Maximum nesting depth exceeded. Sub-agents cannot create further sub-agents.
```

### 超时
```
[Sub-agent completed] Duration: 300.0s | Iterations: 50 | Tokens: 5000 in / 2000 out | ⚠️ Timed out

<部分结果>
```

---

## 🐛 常见问题

### Q1: "Tool 'delegate' is not available"
**原因**: 工具未注册或依赖未注入  
**解决**: 确保在实际 ChatSession 中测试，而不是直接调用工具

### Q2: 子 Agent 卡住不动
**原因**: 可能遇到无限循环或等待用户输入  
**解决**: 检查超时设置，确保子 Agent 不调用 `ask_user`

### Q3: Worktree 隔离失败
**原因**: Git 仓库状态异常或权限问题  
**解决**: 检查 `.git/worktrees/` 是否可写，确保没有未提交的更改

---

## ✅ 测试通过标准

- [ ] 所有 4 种内置 Agent 都能成功执行
- [ ] 并发限制（3 个）正确生效
- [ ] 嵌套深度限制（3 层）正确生效
- [ ] 超时控制按预期工作
- [ ] 只读 Agent 无法执行写操作
- [ ] Coder Agent 可以正常创建/修改文件
- [ ] Worktree 隔离模式正常工作且清理完整
- [ ] 上下文传递功能正常
- [ ] 错误处理友好且信息明确
- [ ] 返回的元数据（duration, tokens, iterations）准确

---

## 🚀 下一步

测试完成后，可以进一步验证：
1. 团队协作功能（OrchestrateTool + QuickTeamTool）
2. 自定义 Agent 加载（从 ~/.xuanji/agents/）
3. Hook 集成（在子 Agent 执行时触发）
4. 学习系统集成（记录子 Agent 的执行经验）
