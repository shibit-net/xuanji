# Agent Team 功能文档

## 概述

Agent Team 是 Xuanji 的多 agent 协作功能，允许创建一个由多个专业化 agent 组成的团队来协同完成复杂任务。

## 核心概念

### 团队成员 (Team Member)

每个团队成员都有：
- **角色 (Role)**: `general-purpose` | `explore` | `plan` | `coder`
- **能力 (Capabilities)**: 该成员擅长的技能列表
- **优先级 (Priority)**: 在某些策略中决定执行顺序
- **工具限制**: 可选的工具白名单

### 协作策略 (Team Strategy)

支持 5 种协作模式：

1. **Sequential（串行）**
   - 成员按优先级顺序执行
   - 每个成员可以看到前面成员的结果
   - 适用于：流程化任务，如 代码审查 → 安全检查 → 性能测试

2. **Parallel（并行）**
   - 所有成员同时工作
   - 结果独立输出
   - 适用于：可并行的任务，如多源信息搜集

3. **Hierarchical（层级）**
   - 优先级最高的成员作为领导者
   - 领导者先分析任务，其他成员根据领导者的分析执行
   - 适用于：需要总体规划的复杂任务

4. **Debate（辩论）**
   - 成员轮流发表观点
   - 多轮讨论直到达成共识
   - 适用于：需要多角度评估的决策任务

5. **Pipeline（流水线）**
   - 前一个成员的输出作为下一个成员的输入
   - 数据逐步加工
   - 适用于：数据处理管道，如 数据提取 → 清洗 → 分析 → 可视化

## 使用方法

### 工具调用

使用 `agent_team` 工具创建和执行团队：

```json
{
  "team_name": "Code Review Team",
  "goal": "Review the authentication module for security issues",
  "strategy": "sequential",
  "members": [
    {
      "id": "architect",
      "role": "plan",
      "capabilities": ["architecture analysis", "design patterns"],
      "priority": 3,
      "system_prompt": "Focus on architectural soundness and maintainability"
    },
    {
      "id": "security",
      "role": "explore",
      "capabilities": ["security analysis", "vulnerability detection"],
      "priority": 2,
      "system_prompt": "Look for SQL injection, XSS, and authentication bypasses"
    },
    {
      "id": "tester",
      "role": "coder",
      "capabilities": ["test writing", "edge case analysis"],
      "priority": 1,
      "system_prompt": "Write comprehensive test cases based on findings"
    }
  ],
  "max_rounds": 5,
  "timeout": 600000
}
```

### 参数说明

#### 必需参数

- `team_name`: 团队名称（描述性）
- `goal`: 团队要完成的目标
- `strategy`: 协作策略（5选1）
- `members`: 成员列表（至少1个，最多10个）

#### 成员配置

每个成员必需：
- `id`: 唯一标识符
- `role`: 角色类型
- `capabilities`: 能力描述列表

可选：
- `name`: 显示名称
- `priority`: 优先级（数字，越大越高）
- `system_prompt`: 额外的系统提示

#### 可选参数

- `max_rounds`: 最大协作轮次（默认10）
- `timeout`: 超时时间毫秒（默认600000 = 10分钟）

## 使用场景示例

### 场景 1: 代码审查团队

```typescript
{
  "team_name": "Code Review Squad",
  "goal": "Review the new payment gateway integration",
  "strategy": "sequential",
  "members": [
    {
      "id": "architect",
      "role": "plan",
      "capabilities": ["system design", "API design"],
      "priority": 3
    },
    {
      "id": "security",
      "role": "explore",
      "capabilities": ["security audit", "PCI compliance"],
      "priority": 2
    },
    {
      "id": "performance",
      "role": "explore",
      "capabilities": ["performance analysis", "load testing"],
      "priority": 1
    }
  ]
}
```

### 场景 2: 研究团队（并行搜集信息）

```typescript
{
  "team_name": "Research Team",
  "goal": "Research best practices for microservices deployment",
  "strategy": "parallel",
  "members": [
    {
      "id": "docs-researcher",
      "role": "explore",
      "capabilities": ["documentation search", "best practices"]
    },
    {
      "id": "code-analyzer",
      "role": "explore",
      "capabilities": ["code examples", "open source projects"]
    },
    {
      "id": "blog-searcher",
      "role": "explore",
      "capabilities": ["blog posts", "case studies"]
    }
  ]
}
```

### 场景 3: 架构设计团队（辩论模式）

```typescript
{
  "team_name": "Architecture Design Team",
  "goal": "Design the data synchronization strategy for offline-first mobile app",
  "strategy": "debate",
  "members": [
    {
      "id": "scalability-expert",
      "role": "plan",
      "capabilities": ["scalability", "distributed systems"],
      "system_prompt": "Prioritize horizontal scalability and fault tolerance"
    },
    {
      "id": "simplicity-advocate",
      "role": "plan",
      "capabilities": ["simple solutions", "maintainability"],
      "system_prompt": "Advocate for the simplest solution that works"
    },
    {
      "id": "performance-optimizer",
      "role": "plan",
      "capabilities": ["performance", "latency optimization"],
      "system_prompt": "Focus on minimizing sync latency and bandwidth usage"
    }
  ],
  "max_rounds": 3
}
```

### 场景 4: 数据处理流水线

```typescript
{
  "team_name": "Data Pipeline",
  "goal": "Extract user feedback from GitHub issues and generate insights",
  "strategy": "pipeline",
  "members": [
    {
      "id": "extractor",
      "role": "explore",
      "capabilities": ["data extraction", "API calls"],
      "priority": 4
    },
    {
      "id": "cleaner",
      "role": "coder",
      "capabilities": ["data cleaning", "deduplication"],
      "priority": 3
    },
    {
      "id": "analyzer",
      "role": "general-purpose",
      "capabilities": ["sentiment analysis", "categorization"],
      "priority": 2
    },
    {
      "id": "summarizer",
      "role": "general-purpose",
      "capabilities": ["summarization", "insight generation"],
      "priority": 1
    }
  ]
}
```

## 输出格式

工具返回的结果包括：

```
[Team "xxx" - Strategy: yyy] | Duration: 15.3s | Rounds: 2 | Members: 3 | Tokens: 1500 in / 2000 out | ✅ Success

[Member Execution Summary]
✅ architect: 5.2s, 800 tokens
✅ security: 6.1s, 1000 tokens
✅ tester: 4.0s, 700 tokens

[Team Output]
<聚合的团队输出>
```

## 最佳实践

### 1. 选择合适的策略

- **简单任务**：不需要 team，直接用单个 subagent
- **可并行任务**：parallel 策略
- **流程化任务**：sequential 或 pipeline
- **需要讨论的决策**：debate 策略
- **复杂协调任务**：hierarchical 策略

### 2. 成员配置

- **角色选择**：
  - `explore`: 只读操作（搜索、分析）
  - `plan`: 设计和规划（只读）
  - `coder`: 需要写代码或修改文件
  - `general-purpose`: 通用任务

- **能力描述**：清晰描述每个成员的专长，帮助团队协作时相互理解

- **优先级**：
  - sequential/pipeline: 决定执行顺序
  - hierarchical: 最高优先级成员是领导者
  - parallel/debate: 优先级不影响执行

### 3. 性能优化

- 控制团队规模（3-5个成员最佳）
- 设置合理的 timeout（避免长时间等待）
- parallel 策略会消耗更多 token（所有成员同时工作）
- debate 策略可能需要多轮（设置 max_rounds）

### 4. 限制

- 最大成员数：10
- 团队嵌套深度：team 内的 subagent 不能再创建 team（防止无限递归）
- 并发限制：遵循 subagent 并发限制（默认3）

## Hook 事件

Team 执行会触发 4 个 Hook 事件：

- `TeamStart`: 团队开始执行
- `TeamEnd`: 团队执行完成
- `TeamMemberStart`: 成员开始执行
- `TeamMemberEnd`: 成员执行完成

可以通过 Hook 系统监听这些事件进行日志记录、性能分析等。

## 常见问题

### Q: Team 和 SubAgent 的区别？

- **SubAgent**: 单个独立的 agent 执行特定任务
- **Team**: 多个 subagent 协作完成复杂任务，有协作策略和上下文共享

### Q: 什么时候用 Team？

当任务满足以下条件之一：
- 需要多个专业角色（如 研究员 + 编码员 + 测试员）
- 可以并行处理多个子任务
- 需要多角度讨论和决策
- 有明确的流水线处理流程

### Q: Team 成员可以访问彼此的结果吗？

取决于策略：
- sequential/pipeline: 可以看到前面成员的结果
- hierarchical: worker 可以看到 leader 的分析
- debate: 每轮可以看到其他成员的观点
- parallel: 独立执行，不共享

### Q: Team 的 token 消耗如何？

Team 的 token 消耗 = 所有成员的 token 消耗总和。parallel 和 debate 策略通常消耗更多，因为多个成员同时或多轮工作。

### Q: Team 失败了怎么办？

如果某个成员失败：
- sequential: 停止后续成员执行
- parallel: 其他成员继续，最终结果标记为部分失败
- hierarchical: leader 失败则整个 team 失败
- debate/pipeline: 失败成员的轮次被跳过

## 技术实现

### 架构

```
TeamTool (工具入口)
    ↓
TeamManager (团队管理器)
    ↓
SubAgentLoop × N (成员执行)
    ↓
AgentLoop (每个成员的内部循环)
```

### 关键类

- `TeamManager`: 团队生命周期管理
- `TeamContext`: 团队运行时上下文
- `TeamTool`: LLM 可调用的工具接口

### 消息路由

目前是简化版本，未来可扩展：
- 成员间直接消息传递
- 共享知识库（键值对存储）
- 消息历史记录

## 未来扩展

- [ ] 动态成员管理（运行时添加/移除成员）
- [ ] 更复杂的消息路由（点对点通信）
- [ ] 持久化共享知识库
- [ ] Team 模板库（预定义常用团队配置）
- [ ] Team 性能分析和可视化
