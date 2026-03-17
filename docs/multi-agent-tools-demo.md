# Multi-Agent 协作工具测试说明

## 概述

Xuanji 项目实现了三个强大的多 Agent 协作工具：

1. **delegate** - 单任务委托给专业 Agent
2. **orchestrate** - 自定义团队协作
3. **quick_team** - 使用预定义模板快速创建团队

---

## 1. delegate（任务委托）

### 功能
将单个独立任务委托给专业 Agent 在隔离环境中执行。

### 适用场景
✅ 需要特定专业能力（代码探索/架构设计/代码编写）
✅ 需要隔离执行的复杂子任务
✅ 需要并行处理的独立任务（最多 3 个）

❌ 简单任务自己就能完成
❌ 需要与用户交互的任务（sub-agent 无法对话）

### 可用的专业 Agent

- **explore** - 代码探索（快速搜索、分析结构，只读）
- **plan** - 架构设计（设计方案、评估选型，只读）
- **coder** - 代码编写（写代码、修复 bug、重构）
- **general-purpose** - 通用任务

### 使用示例

```typescript
// 示例 1: 探索项目架构
delegate({
  description: "探索 xuanji 项目的核心架构，分析 src/core 目录下的主要模块的职责和依赖关系",
  subagent_type: "explore",
  include_parent_context: true
})

// 示例 2: 架构设计
delegate({
  description: "设计一个支持多模型的 LLM Provider 架构，支持 OpenAI、Anthropic、本地模型",
  subagent_type: "plan"
})

// 示例 3: 代码修复
delegate({
  description: "修复 src/auth/login.ts 中的类型错误",
  subagent_type: "coder",
  timeout: 180000  // 3 分钟
})
```

### 特性

- **隔离执行**: Sub-agent 有独立的上下文
- **并发限制**: 最多 3 个并发 sub-agent
- **深度限制**: 最大嵌套 3 层，防止无限递归
- **超时保护**: 默认 5 分钟超时
- **性能跟踪**: 自动记录执行时间、迭代次数、Token 使用量

---

## 2. orchestrate（自定义团队协作）

### 功能
编排多个 Agent 协作完成复杂任务，支持多种协作策略。

### 协作策略

#### 1. **sequential**（顺序执行）
成员依次执行，各自独立工作。

**适用场景**:
- 代码审查：架构 → 安全 → 性能
- 多角度分析：不同专家独立评估

#### 2. **parallel**（并行执行）
成员同时执行，加速处理。

**适用场景**:
- 多源调研：文档 + 代码 + 社区，同时进行
- 独立子任务：可以并行处理的工作

#### 3. **hierarchical**（分层执行）
有主 Agent 协调其他 Agent（基于 priority）。

**适用场景**:
- 功能开发：技术负责人 → 后端/前端/QA
- 有明确层级的团队协作

#### 4. **debate**（辩论模式）
多方辩论，多轮讨论达成共识。

**适用场景**:
- 架构讨论：多种方案对比
- 技术选型：权衡利弊

#### 5. **pipeline**（流水线）
前一个 Agent 的输出是下一个的输入。

**适用场景**:
- 数据处理：提取 → 清洗 → 分析 → 报告
- 多阶段处理：有明确的数据流向

### 使用示例

```typescript
// 示例 1: 代码审查团队（sequential）
orchestrate({
  team_name: "Code Review Squad",
  goal: "Review src/auth/login.ts for quality, security, and performance",
  strategy: "sequential",
  members: [
    {
      id: "architect",
      role: "plan",
      name: "Architecture Reviewer",
      capabilities: ["architecture analysis", "design patterns", "SOLID principles"],
      system_prompt: "Evaluate architecture and design. Check best practices and suggest improvements."
    },
    {
      id: "security",
      role: "explore",
      name: "Security Analyst",
      capabilities: ["security analysis", "vulnerability detection"],
      system_prompt: "Analyze security vulnerabilities: SQL injection, XSS, CSRF, etc."
    },
    {
      id: "performance",
      role: "explore",
      name: "Performance Expert",
      capabilities: ["performance analysis", "optimization"],
      system_prompt: "Identify performance bottlenecks and suggest optimizations."
    }
  ]
})

// 示例 2: 研究团队（parallel）
orchestrate({
  team_name: "Research Team",
  goal: "Research React Server Components best practices",
  strategy: "parallel",
  members: [
    {
      id: "docs-researcher",
      role: "explore",
      capabilities: ["official docs", "API references"],
      system_prompt: "Search official documentation and technical specs."
    },
    {
      id: "code-researcher",
      role: "explore",
      capabilities: ["code examples", "GitHub exploration"],
      system_prompt: "Find real-world code examples and implementations."
    },
    {
      id: "community-researcher",
      role: "explore",
      capabilities: ["blog posts", "Stack Overflow"],
      system_prompt: "Search community discussions and case studies."
    }
  ]
})

// 示例 3: 架构辩论（debate）
orchestrate({
  team_name: "Architecture Debate",
  goal: "Design caching strategy for our API",
  strategy: "debate",
  max_rounds: 3,
  members: [
    {
      id: "simplicity",
      role: "plan",
      capabilities: ["simple solutions", "maintainability"],
      system_prompt: "Advocate for the simplest solution. Challenge over-engineering."
    },
    {
      id: "scalability",
      role: "plan",
      capabilities: ["scalability", "distributed systems"],
      system_prompt: "Ensure design can scale to high load."
    },
    {
      id: "pragmatist",
      role: "plan",
      capabilities: ["practical solutions", "trade-off analysis"],
      system_prompt: "Balance idealism with reality. Consider constraints."
    }
  ]
})
```

---

## 3. quick_team（快速团队模板）

### 功能
使用预定义模板快速创建常用团队，无需手动配置成员。

### 可用模板

#### 1. **code-review**（代码审查）
- **策略**: sequential
- **成员**: 架构审查员 → 安全分析师 → 性能专家
- **适用**: 审查代码变更、PR 分析、代码质量评估

```typescript
quick_team({
  template: "code-review",
  goal: "Review src/auth.ts for quality, security, and performance",
  target: "src/auth.ts"
})
```

#### 2. **research**（多源调研）
- **策略**: parallel
- **成员**: 文档研究员 + 代码示例研究员 + 社区研究员
- **适用**: 技术调研、收集多源信息、对比工具

```typescript
quick_team({
  template: "research",
  goal: "Research React 19 server components best practices"
})
```

#### 3. **architecture-debate**（架构辩论）
- **策略**: debate
- **成员**: 简洁派 vs 扩展派 vs 务实派
- **适用**: 架构设计、技术选型、方案评估

```typescript
quick_team({
  template: "architecture-debate",
  goal: "Design API caching strategy",
  max_rounds: 3
})
```

#### 4. **data-pipeline**（数据流水线）
- **策略**: pipeline
- **成员**: 提取器 → 清洗器 → 分析器 → 报告生成器
- **适用**: 日志处理、数据分析、报告生成

```typescript
quick_team({
  template: "data-pipeline",
  goal: "Process all TODO comments and generate priority report"
})
```

#### 5. **feature-development**（功能开发）
- **策略**: hierarchical
- **成员**: 技术负责人 → 后端开发 / 前端开发 / QA
- **适用**: 新功能开发、复杂功能实现、全栈开发

```typescript
quick_team({
  template: "feature-development",
  goal: "Implement OAuth2 authentication"
})
```

---

## 工具对比

| 特性 | delegate | orchestrate | quick_team |
|------|----------|-------------|------------|
| **复杂度** | 简单 | 复杂 | 简单 |
| **适用场景** | 单个子任务 | 自定义团队 | 常见团队模式 |
| **配置难度** | 低 | 高 | 低 |
| **灵活性** | 低 | 高 | 中 |
| **成员数量** | 1 | 1-10 | 预定义（3-4） |
| **协作策略** | 无 | 5 种可选 | 预定义 |
| **学习曲线** | 平缓 | 陡峭 | 平缓 |

---

## 选择指南

### 使用 delegate 当：
- ✅ 单个明确的子任务
- ✅ 需要特定专业能力（explore/plan/coder）
- ✅ 快速执行，不需要协作

### 使用 orchestrate 当：
- ✅ 需要 3+ 个不同角色
- ✅ 需要自定义成员配置
- ✅ 需要特殊的协作模式
- ✅ 已有明确的团队结构设计

### 使用 quick_team 当：
- ✅ 符合预定义模板的场景
- ✅ 想快速开始，不想手动配置
- ✅ 常见任务（代码审查、调研、架构讨论等）

---

## 实现细节

### 依赖注入
这三个工具都需要在 ChatSession 初始化时通过 `setDependencies` 注入运行时依赖：

```typescript
// ChatSession.initTaskTool() 中的初始化
const delegateTool = new DelegateTool();
this.baseRegistry.register(delegateTool);

const orchestrateTool = new OrchestrateTool();
this.baseRegistry.register(orchestrateTool);

const quickTeamTool = new QuickTeamTool();
this.baseRegistry.register(quickTeamTool);

// SessionInitializer.injectMultiAgentToolDeps() 中注入依赖
delegateTool.setDependencies({
  providerManager,
  agentRegistry,
  registry,
  agentConfig,
  hookRegistry,
  memoryStore,
  depth: currentDepth
});
```

### 安全机制

1. **防止无限递归**
   - DelegateTool 不在子代理中注册
   - 最大嵌套深度 3 层

2. **并发控制**
   - 最大并发子代理数：3
   - 超时自动终止：默认 5-10 分钟

3. **资源限制**
   - 团队成员数量：最多 10 人
   - 辩论轮次：默认 3 轮，最多 10 轮

### 性能优化

1. **并行执行**: parallel 策略下成员同时运行
2. **流式响应**: 所有 LLM 调用使用流式响应
3. **Token 跟踪**: 精确统计每个成员的 Token 使用
4. **执行监控**: 记录每个成员的执行时间和迭代次数

---

## 测试建议

由于这些工具需要完整的 ChatSession 环境，建议通过以下方式测试：

### 1. CLI 测试
```bash
npm run dev

# 然后在对话中：
"用 explore agent 分析 src/core 的架构"
"用 code-review team 审查 src/auth/login.ts"
"用 research team 调研 React Server Components"
```

### 2. 单元测试
查看 `src/core/agent/team/__tests__/` 目录下的测试文件。

### 3. 集成测试
测试完整的 multi-agent 协作流程，包括：
- Sub-agent 创建和执行
- 团队成员间的消息传递
- 不同协作策略的执行逻辑
- 结果聚合和格式化

---

## 扩展性

### 自定义 Agent
可以在 `~/.xuanji/agents/` 或 `.xuanji/agents/` 中定义自定义 Agent：

```yaml
# stock-analyst.agent.yaml
metadata:
  id: stock-analyst
  name: Stock Market Analyst
  isSubAgent: true
  
systemPrompt: |
  You are a professional stock market analyst...
  
tools:
  - web_search
  - read_file
```

然后在 delegate/orchestrate 中使用：
```typescript
delegate({
  description: "Analyze AAPL stock trends",
  subagent_type: "stock-analyst"
})
```

### 自定义团队模板
可以在 `src/core/agent/team/templates.ts` 中添加新模板：

```typescript
'security-audit': {
  id: 'security-audit',
  name: 'Security Audit Team',
  recommendedStrategy: 'sequential',
  members: () => [
    // ... member definitions
  ],
  useCases: [
    'Comprehensive security audit',
    'Vulnerability assessment'
  ]
}
```

---

## 最佳实践

1. **明确任务边界**: delegate 适合单一任务，团队适合复杂协作
2. **选择合适策略**: 根据任务性质选择 sequential/parallel/debate 等
3. **设置合理超时**: 避免长时间阻塞，设置适当的 timeout
4. **监控 Token 使用**: 团队协作会消耗较多 Token，注意成本
5. **渐进式使用**: 先用 quick_team，需要定制时再用 orchestrate
6. **善用模板**: 常见场景使用预定义模板，避免重复配置

---

## 故障排查

### 错误: "TaskTool not initialized"
**原因**: 依赖未注入
**解决**: 确保在 ChatSession 中正确初始化和注入依赖

### 错误: "Maximum concurrent sub-agents reached"
**原因**: 超过并发限制（3 个）
**解决**: 等待当前任务完成，或减少并发调用

### 错误: "Maximum nesting depth exceeded"
**原因**: Sub-agent 嵌套过深
**解决**: 避免在 sub-agent 中创建新的 sub-agent

### 超时问题
**原因**: 任务复杂度高，执行时间长
**解决**: 增加 timeout 参数或简化任务

---

## 总结

Xuanji 的多 Agent 协作系统提供了灵活而强大的工具链：

- **delegate**: 简单高效的单任务委托
- **orchestrate**: 灵活可定制的团队协作
- **quick_team**: 快速便捷的模板团队

根据任务的复杂度和定制需求，选择合适的工具，可以显著提升工作效率！
