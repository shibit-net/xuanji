# SubAgent 和 Agent Team 快速参考

## 一句话总结

- **SubAgent**: 单个独立的 agent，完全隔离的消息历史，适合单一明确的任务
- **Agent Team**: 多个 SubAgent 按策略协作，适合复杂的多角色任务

---

## SubAgent 核心要点

### 上下文处理

```typescript
// 完全隔离
✅ 独立的 MessageManager（空历史）
✅ 独立的 token 统计
✅ 过滤后的工具集（排除 task、agent_team）

// 部分共享
✅ 共享 MemoryStore（可读写长期记忆）
✅ 共享 HookRegistry（触发事件）
✅ 根据角色选择 Provider（explore用Haiku，其他用Sonnet）

// 可选传递
⚠️ parentContext（默认不传，需显式启用）
```

### System Prompt 构建

```
基础 System Prompt (来自父代理)
  +
角色特定提示
  - explore: "Fast exploration. Use Glob, Grep, Read. Be concise."
  - plan: "Software architect. Design plans."
  - coder: "Write, edit, test code."
  - general-purpose: "Execute task. Be concise."
  +
SubAgent Mode 说明
  - Depth: {depth}, Role: {role}
  - Do NOT ask questions. Do NOT start new tasks.
  +
Parent Context (如果有)
  - [Parent Context]\n{parentContext}
```

### 执行流程

```
Parent Agent
  ↓ TaskTool.execute(task, role, includeParentContext)
SubAgentContext
  ↓ runSubAgent()
独立的 AgentLoop
  ├─ 新建 MessageManager（空历史）
  ├─ FilteredToolRegistry（排除 task/agent_team）
  ├─ 选择 Provider（explore用轻量模型）
  └─ 独立的 LLM 循环
  ↓ 完成
SubAgentResult
  - result: string
  - tokensUsed: {input, output}
  - duration: number
  - timedOut: boolean
  - iterations: number
```

### 角色工具限制

| 角色 | 允许的工具 | 禁止的工具 |
|------|-----------|-----------|
| `explore` | read_file, glob, grep, web_fetch | write_file, edit_file, bash, task, agent_team |
| `plan` | read_file, glob, grep, plan_review | write_file, edit_file, bash, task, agent_team |
| `coder` | 所有工具（除了禁止的） | task, agent_team |
| `general-purpose` | 所有工具（除了禁止的） | task, agent_team |

---

## Agent Team 核心要点

### TeamContext 结构

```typescript
TeamContext {
  config: {
    name: string,
    members: TeamMember[],
    strategy: 'sequential' | 'parallel' | 'hierarchical' | 'debate' | 'pipeline',
    goal: string,
    maxRounds: number,
    timeout: number,
  },
  sharedKnowledge: Map<string, unknown>,      // 预留，未实际使用
  messageHistory: TeamMessage[],              // 记录但未用于通信
  memberStates: Map<string, AgentState>,
  currentRound: number,
  startTime: number,
}
```

### 成员任务增强

每个成员执行前，任务描述会被增强：

```typescript
原始任务
  +
成员能力说明
  "Your capabilities: {member.capabilities.join(', ')}"
  +
成员特定提示
  {member.systemPrompt}
  +
共享知识（如果启用）
  "Shared Knowledge:\n{sharedKnowledge}"
  +
前面成员的结果（根据策略）
  - Sequential: 所有前面的结果
  - Hierarchical: Leader 的分析
  - Debate: 本轮其他成员的观点
  - Pipeline: 前一个成员的输出
  - Parallel: 无
```

### 五种协作策略

#### 1. Sequential（串行）

```
Member1 → Member2 → Member3 → ...
  ↓       ↓         ↓
  R1 →    R2   →    R3 (可以看到 R1, R2)

结果：最后一个成员的输出
```

**特点**：
- 按优先级顺序执行
- 后面可以看到前面的结果
- 一个失败，后续停止

#### 2. Parallel（并行）

```
       ┌─ Member1 → R1
Goal ──├─ Member2 → R2
       └─ Member3 → R3

结果：所有成员的输出合并
```

**特点**：
- 同时执行，互不干扰
- 不共享彼此的结果
- 适合独立任务

#### 3. Hierarchical（层级）

```
Goal → Leader (分析)
         ↓
    ┌────┴────┬────┐
Worker1   Worker2  Worker3
 (基于 Leader 的分析)

结果：Leader 分析 + Workers 执行
```

**特点**：
- 优先级最高的是 Leader
- Leader 先分析，Workers 根据分析执行
- 适合需要总体规划的任务

#### 4. Debate（辩论）

```
Round 1: M1→R1, M2→R2, M3→R3
Round 2: M1→R4 (看到R1,R2,R3), M2→R5 (看到R1,R2,R3), M3→R6 (...)
Round 3: ...
直到达成共识或最大轮次

结果：最后一轮的所有观点
```

**特点**：
- 多轮讨论
- 每轮每个成员发言
- 可以看到其他成员的观点
- 达成共识或最大轮次结束

#### 5. Pipeline（流水线）

```
Goal → M1 → R1
       ↓
       M2 (输入=R1) → R2
       ↓
       M3 (输入=R2) → R3

结果：最后一个成员的输出
```

**特点**：
- 前一个的输出是下一个的输入
- 数据逐步加工
- 适合数据处理管道

---

## 对比速查

| 特性 | SubAgent | Agent Team |
|------|----------|------------|
| **用途** | 单一任务 | 复杂协作任务 |
| **成员数** | 1 个 | 1-10 个 |
| **消息历史** | 独立（空） | 成员间隔离，Team 有历史（未用） |
| **工具集** | 过滤后 | 成员间共享 |
| **上下文传递** | 可选 parentContext | enrichTaskForMember |
| **结果** | 单个 result | 聚合多个 results |
| **执行模式** | 单个执行 | 5 种策略 |
| **Token 消耗** | 单个任务 | 所有成员之和 |
| **实现关系** | 基础机制 | 基于 SubAgent 编排 |

---

## 使用场景速查

### SubAgent 适用场景

✅ **何时使用**：
- 单一、明确的任务
- 快速代码探索（explore 角色 + 轻量模型）
- 只读规划（plan 角色）
- 独立的代码编写（coder 角色）
- 父代理需要并发执行多个独立任务

❌ **不适合**：
- 需要多个角色协作
- 需要讨论和辩论
- 需要流水线处理

### Agent Team 适用场景

✅ **何时使用**：
- 需要多个专业角色（研究员+编码员+测试员）
- 复杂任务需要分解（代码审查、特性开发）
- 需要辩论和多角度评估（架构设计）
- 数据处理流水线（提取→清洗→分析→总结）
- 层级化的规划和执行

❌ **不适合**：
- 简单的单一任务（浪费资源）
- 成员能力重叠过多（缺乏分工）

---

## 配置参数速查

### SubAgent 配置

```typescript
TaskTool.execute({
  description: string,              // 任务描述（必需）
  subagent_type: 'general-purpose' | 'explore' | 'plan' | 'coder',  // 角色
  include_parent_context: boolean,  // 是否传递父上下文（默认 false）
  timeout: number,                  // 超时（默认 300000ms = 5分钟）
  isolation: 'none' | 'worktree',   // 隔离模式（默认 none）
})
```

### Agent Team 配置

```typescript
TeamTool.execute({
  team_name: string,                // 团队名称（必需）
  goal: string,                     // 团队目标（必需）
  strategy: 'sequential' | 'parallel' | 'hierarchical' | 'debate' | 'pipeline',  // 策略（必需）
  members: [                        // 成员列表（必需）
    {
      id: string,                   // 唯一标识
      role: AgentRoleType,          // 角色
      capabilities: string[],       // 能力列表
      priority?: number,            // 优先级（sequential/hierarchical/pipeline 用）
      name?: string,                // 显示名称
      system_prompt?: string,       // 成员特定提示
    }
  ],
  max_rounds: number,               // 最大轮次（默认 10，debate 用）
  timeout: number,                  // 超时（默认 600000ms = 10分钟）
})
```

---

## 安全限制速查

### SubAgent 限制

- **最大嵌套深度**: 3 层
- **并发数量**: 最多 3 个同时运行
- **超时**: 默认 5 分钟
- **工具过滤**: 始终排除 `task`，角色限制 `write_file`/`edit_file`/`bash`

### Agent Team 限制

- **最大成员数**: 10 个
- **嵌套深度**: Team 算 1 层，成员是 SubAgent 再 +1
- **超时**: 默认 10 分钟
- **团队嵌套**: Team 成员不能创建新的 Team

---

## 性能优化建议

### SubAgent 优化

1. **使用轻量模型**：explore 角色自动用 Haiku，节省 67% 成本
2. **不传递父上下文**：默认行为，减少 Token
3. **并发执行**：父代理可同时启动多个 SubAgent

### Agent Team 优化

1. **选择合适的策略**：
   - Parallel/Sequential 较省 Token
   - Debate 多轮最耗 Token
2. **控制成员数量**：3-5 个成员最佳
3. **设置合理的 max_rounds**：Debate 模式避免无限循环
4. **成员角色分工明确**：避免能力重叠

---

## 调试建议

### SubAgent 调试

```bash
# 查看 SubAgent 执行日志
export XUANJI_LOG_LEVEL=debug
xuanji

# 日志会显示：
# - [SubAgentLoop] Starting sub-agent (depth=1, timeout=300000ms)
# - [SubAgentLoop] Completed in 5.2s (3 iterations, ok)
```

### Agent Team 调试

```bash
# 查看 Team 执行日志
export XUANJI_LOG_LEVEL=debug
xuanji

# 日志会显示：
# - [TeamManager] Team "xxx" created with 3 members, strategy: sequential
# - [TeamManager] Team "xxx" executing goal: ...
# - Hook 事件：TeamStart, TeamMemberStart, TeamMemberEnd, TeamEnd
```

---

## 快速决策树

```
你的任务是什么？
  ├─ 单一、明确的任务
  │   └─ 使用 SubAgent
  │       ├─ 只读探索？ → role='explore'
  │       ├─ 只读规划？ → role='plan'
  │       ├─ 编写代码？ → role='coder'
  │       └─ 通用任务？ → role='general-purpose'
  │
  └─ 复杂、需要协作的任务
      └─ 使用 Agent Team
          ├─ 流程化（审查→检查→测试）？ → strategy='sequential'
          ├─ 可并行（多源搜索）？ → strategy='parallel'
          ├─ 需要规划（技术负责人+执行）？ → strategy='hierarchical'
          ├─ 需要讨论（架构设计）？ → strategy='debate'
          └─ 数据加工（提取→清洗→分析）？ → strategy='pipeline'
```

---

## 总结

**SubAgent**：
- 简单、独立、高效
- 完全隔离的上下文
- 角色特定优化

**Agent Team**：
- 复杂、协作、灵活
- 多种策略可选
- 基于 SubAgent 构建

两者互补，根据任务选择合适的机制！
