# Multi-Agent概念混乱分析与整合方案

**状态**: 设计中
**日期**: 2026-03-15
**目标**: 消除Multi-Agent工具的概念冗余，简化用户理解和使用

---

## 问题分析

### 1. 现状：4个Multi-Agent工具

| 工具 | 功能 | 使用场景 | 问题 |
|------|------|---------|------|
| **TaskTool** | 启动单个SubAgent | 独立任务 | ✓ 概念清晰 |
| **ChainTool** | 链式执行SubAgent | 流水线（上游→下游） | ⚠️ 与TeamTool的pipeline策略重复 |
| **TeamTool** | 团队协作（5种策略） | 复杂协作任务 | ⚠️ 策略过多，配置复杂 |
| **QuickTeamTool** | 使用模板创建团队 | 常见团队模式 | ⚠️ 只是TeamTool的模板封装 |

---

### 2. 概念重叠

#### ChainTool vs TeamTool.pipeline

**ChainTool**：
```typescript
{
  chain: [
    { agent_id: 'explore', task_template: 'Extract data' },
    { agent_id: 'coder', task_template: 'Clean {{previous_output}}' },
    { agent_id: 'coder', task_template: 'Analyze {{previous_output}}' },
  ]
}
```

**TeamTool.pipeline**：
```typescript
{
  strategy: 'pipeline',
  members: [
    { id: 'extractor', role: 'explore', capabilities: ['data extraction'] },
    { id: 'cleaner', role: 'coder', capabilities: ['data cleaning'] },
    { id: 'analyzer', role: 'coder', capabilities: ['data analysis'] },
  ]
}
```

**问题**：
- 功能完全相同：顺序执行，上游输出传递给下游
- ChainTool更简洁（直接指定agent_id）
- TeamTool更灵活（成员有capabilities, system_prompt等）
- 用户困惑：什么时候用ChainTool，什么时候用TeamTool.pipeline？

---

#### QuickTeamTool vs TeamTool

**QuickTeamTool**：
```typescript
{
  template: 'code-review',
  goal: 'Review auth.ts'
}
```

**内部实现**：
```typescript
// QuickTeamTool.execute() 内部
const teamConfig = getTeamTemplate(template);  // 获取模板
const manager = new TeamManager(...);
await manager.createTeam(teamConfig);
await manager.execute(goal);
```

**问题**：
- QuickTeamTool只是TeamTool的模板化包装
- 没有独立的概念价值
- 可以合并到TeamTool，增加template参数

---

### 3. TeamTool策略过多

**5种策略**：
1. **sequential** - 顺序执行（A → B → C）
2. **parallel** - 并行执行（A + B + C同时）
3. **hierarchical** - 分层执行（Leader分配任务）
4. **debate** - 辩论模式（多轮讨论）
5. **pipeline** - 流水线（A→B→C，输出传递）

**问题**：
- sequential vs pipeline：区别不明显，都是顺序执行
  - sequential: 各自独立执行，不传递输出
  - pipeline: 顺序执行，传递输出
  - 用户容易混淆
- hierarchical vs sequential：都是一个接一个执行
  - hierarchical: 有Leader分配任务（额外抽象）
  - sequential: 直接顺序执行
- 用户决策负担重：需要理解5种策略的细微差别

---

### 4. 配置复杂度

**TeamTool配置示例**（70行JSON）：
```typescript
{
  team_name: 'Code Review Team',
  goal: 'Review auth.ts',
  strategy: 'sequential',
  members: [
    {
      id: 'architect',
      role: 'plan',
      name: 'Architecture Reviewer',
      capabilities: ['architecture analysis', 'design patterns'],
      system_prompt: 'Focus on architecture and design patterns...',
    },
    {
      id: 'security',
      role: 'coder',
      name: 'Security Analyst',
      capabilities: ['security review', 'vulnerability detection'],
      system_prompt: 'Focus on security vulnerabilities...',
    },
    // ... 更多成员
  ],
  max_rounds: 1,
  timeout: 600000,
}
```

**问题**：
- 配置字段多：team_name, goal, strategy, members[], max_rounds, timeout
- 每个member配置复杂：id, role, name, capabilities[], system_prompt, priority
- LLM需要生成大量配置，容易出错
- 对比TaskTool（2行JSON）：
  ```typescript
  { description: 'Review auth.ts', subagent_type: 'coder' }
  ```

---

## 设计方案

### 核心原则

**简化原则**：
1. **概念最小化**：一个概念解决一类问题
2. **配置渐进**：从简单到复杂，支持渐进配置
3. **语义清晰**：工具名称和参数直观易懂

---

### 方案1：精简工具（推荐）

#### 工具划分

**保留2个核心工具**：

| 工具 | 功能 | 使用场景 | 配置复杂度 |
|------|------|---------|-----------|
| **agent_task** | 单个Agent | 独立任务 | 极简（2字段） |
| **agent_team** | 多Agent协作 | 协作任务 | 渐进（2-10字段） |

**删除工具**：
- ❌ **agent_chain** - 合并到agent_team（strategy=pipeline）
- ❌ **quick_team** - 合并到agent_team（template参数）

---

#### agent_task（保持不变）

```typescript
{
  name: 'agent_task',
  description: 'Launch a single agent to handle a specific task independently.',
  input_schema: {
    description: string,          // 任务描述
    subagent_type: 'explore' | 'plan' | 'coder' | 'general-purpose',
    timeout?: number,
    include_parent_context?: boolean,
    isolation?: 'none' | 'worktree',
  }
}
```

**使用示例**：
```typescript
{ description: 'Analyze auth.ts for security issues', subagent_type: 'coder' }
```

---

#### agent_team（重新设计）

**核心思想**：
- 支持模板（简单场景）
- 支持自定义（复杂场景）
- 配置渐进（template → 自定义members）

**Schema**：
```typescript
{
  name: 'agent_team',
  description: 'Create a team of agents to collaborate on complex tasks.',
  input_schema: {
    // === 模板模式（简单） ===
    template?: 'code-review' | 'research' | 'architecture-debate' | 'data-pipeline' | 'feature-development',

    // === 自定义模式（灵活） ===
    team_name?: string,
    strategy?: 'sequential' | 'parallel' | 'debate' | 'pipeline',
    members?: Array<{
      id: string,
      role: AgentRoleType,
      task?: string,  // 自定义任务（可选）
    }>,

    // === 共同参数 ===
    goal: string,           // 总目标
    max_rounds?: number,    // 默认3
    timeout?: number,       // 默认10分钟
  }
}
```

**使用示例1：模板模式**（简单）
```typescript
{
  template: 'code-review',
  goal: 'Review auth.ts for quality, security, and performance'
}
```

内部展开为：
```typescript
{
  strategy: 'sequential',
  members: [
    { id: 'architect', role: 'plan', task: 'Review architecture and design patterns' },
    { id: 'security', role: 'coder', task: 'Review security vulnerabilities' },
    { id: 'performance', role: 'coder', task: 'Review performance issues' },
  ]
}
```

**使用示例2：自定义模式**（灵活）
```typescript
{
  strategy: 'pipeline',
  members: [
    { id: 'extractor', role: 'explore', task: 'Extract all TODO comments' },
    { id: 'analyzer', role: 'coder', task: 'Analyze priority based on {{previous_output}}' },
    { id: 'reporter', role: 'coder', task: 'Generate Markdown report from {{previous_output}}' },
  ],
  goal: 'Generate TODO priority report'
}
```

**使用示例3：混合模式**（自定义基于模板）
```typescript
{
  template: 'code-review',
  goal: 'Review auth.ts',
  members: [
    // 覆盖模板的第一个成员，添加自定义任务
    { id: 'architect', role: 'plan', task: 'Focus on OAuth2 implementation patterns' },
  ]
}
```

---

#### 策略简化

**删除hierarchical策略**：
- 原因：与sequential功能重叠，区别不明显
- hierarchical的"Leader分配任务"概念过于复杂
- 用sequential + 手动配置members即可实现

**保留3种策略**：

| 策略 | 执行方式 | 输出传递 | 使用场景 |
|------|---------|---------|---------|
| **sequential** | 顺序执行 | ❌ 不传递 | 独立专家评审（A评审 + B评审 + C评审） |
| **parallel** | 并行执行 | ❌ 不传递 | 多源研究（文档 + 代码 + 社区，同时） |
| **pipeline** | 顺序执行 | ✓ 传递 | 数据流水线（提取→清洗→分析） |
| **debate** | 多轮讨论 | ✓ 传递 | 架构设计（3人辩论，3轮） |

**策略选择指南**：
```
是否需要辩论？
├─ 是 → debate（多轮讨论，达成共识）
└─ 否 → 是否需要传递输出？
    ├─ 是 → pipeline（流水线，上游→下游）
    └─ 否 → 是否需要并行？
        ├─ 是 → parallel（同时执行，独立结果）
        └─ 否 → sequential（顺序执行，独立结果）
```

---

### 方案2：统一到AgentRegistry（更激进）

**思路**：
- TaskTool/TeamTool都只是"Agent执行模式"的不同参数
- 可以统一到一个工具：**agent_execute**

**Schema**：
```typescript
{
  name: 'agent_execute',
  description: 'Execute one or more agents to accomplish a goal.',
  input_schema: {
    agents: Array<{
      id: string,                   // AgentRegistry中的ID
      task: string,                 // 任务描述
      depends_on?: string[],        // 依赖其他agent（pipeline）
    }>,
    execution: {
      mode: 'single' | 'sequential' | 'parallel' | 'pipeline' | 'debate',
      max_rounds?: number,
      timeout?: number,
    },
    goal: string,
  }
}
```

**使用示例**：
```typescript
// 单个Agent（替代TaskTool）
{
  agents: [{ id: 'coder', task: 'Fix the bug in auth.ts' }],
  execution: { mode: 'single' },
  goal: 'Fix bug'
}

// 团队协作（替代TeamTool）
{
  agents: [
    { id: 'explore', task: 'Extract data' },
    { id: 'coder', task: 'Clean data', depends_on: ['explore'] },
    { id: 'coder', task: 'Analyze data', depends_on: ['coder'] },
  ],
  execution: { mode: 'pipeline' },
  goal: 'Data pipeline'
}
```

**问题**：
- 配置更复杂，用户理解成本高
- 失去了TaskTool的简洁性
- 不推荐

---

## 实施步骤

### Phase 1: 重新设计agent_team ✅

**任务**：
- [x] 设计新Schema（template + 自定义members）
- [x] 删除hierarchical策略
- [x] 简化member配置（删除name, capabilities, system_prompt）
- [x] 保留4种策略（sequential, parallel, pipeline, debate）

**文件**：
- `src/core/tools/TeamTool.ts`
- `src/core/agent/team/types.ts`

---

### Phase 2: 合并ChainTool到agent_team

**任务**：
- [ ] agent_team增加pipeline策略支持`{{previous_output}}`
- [ ] 删除ChainTool
- [ ] 迁移测试用例

**文件**：
- `src/core/tools/ChainTool.ts` - 删除
- `src/core/tools/TeamTool.ts` - 添加pipeline支持

---

### Phase 3: 合并QuickTeamTool到agent_team

**任务**：
- [ ] agent_team增加template参数
- [ ] 移动templates.ts逻辑到TeamTool内部
- [ ] 删除QuickTeamTool

**文件**：
- `src/core/tools/QuickTeamTool.ts` - 删除
- `src/core/tools/TeamTool.ts` - 添加template支持
- `src/core/agent/team/templates.ts` - 保留（内部使用）

---

### Phase 4: 简化TeamManager

**任务**：
- [ ] 删除hierarchical策略实现
- [ ] 简化member配置（只保留id, role, task）
- [ ] 优化pipeline策略（支持{{previous_output}}）

**文件**：
- `src/core/agent/team/TeamManager.ts`
- `src/core/agent/team/types.ts`

---

### Phase 5: 更新文档和测试

**任务**：
- [ ] 更新工具描述和示例
- [ ] 更新单元测试
- [ ] 更新E2E测试
- [ ] 更新用户文档

---

## 预期效果

### 工具数量

**优化前**：
- 4个Multi-Agent工具（TaskTool, ChainTool, TeamTool, QuickTeamTool）
- 概念混乱，用户难以选择

**优化后**：
- 2个Multi-Agent工具（TaskTool, TeamTool）
- 概念清晰：单个 vs 多个

---

### 配置复杂度

**优化前**（TeamTool）：
```typescript
{
  team_name: 'Code Review Team',
  goal: '...',
  strategy: 'sequential',
  members: [
    {
      id: 'architect',
      role: 'plan',
      name: 'Architecture Reviewer',          // ❌ 冗余
      capabilities: ['architecture', '...'],  // ❌ 冗余
      system_prompt: '...',                   // ❌ 由AgentRegistry决定
      priority: 1,                            // ❌ hierarchical专用
    },
    // ...
  ],
  max_rounds: 1,
  timeout: 600000,
}
```

**优化后**（agent_team）：
```typescript
// 模板模式（极简）
{
  template: 'code-review',
  goal: 'Review auth.ts'
}

// 自定义模式（简洁）
{
  strategy: 'sequential',
  members: [
    { id: 'architect', role: 'plan', task: 'Review architecture' },
    { id: 'security', role: 'coder', task: 'Review security' },
  ],
  goal: 'Code review'
}
```

**对比**：
- 模板模式：2字段（-90%）
- 自定义模式：3-5字段/member（-60%）

---

### 用户理解成本

**优化前**：
- 用户需要理解4个工具的区别
- 用户需要理解5种策略的区别
- 用户需要理解hierarchical的Leader概念
- 用户需要理解member的5个配置字段

**优化后**：
- 用户只需理解2个工具：单个 vs 多个
- 用户只需理解4种策略（减少1个）
- 用户只需理解member的3个配置字段（减少2个）
- 模板模式降低入门门槛

---

## 兼容性

**破坏性变更**：
- 删除ChainTool（迁移到agent_team的pipeline策略）
- 删除QuickTeamTool（迁移到agent_team的template参数）
- 删除hierarchical策略（迁移到sequential）
- 删除member的name, capabilities, priority字段

**迁移指南**：

**ChainTool → agent_team**：
```typescript
// 旧代码（ChainTool）
{
  tool: 'agent_chain',
  input: {
    chain: [
      { agent_id: 'explore', task_template: 'Extract data' },
      { agent_id: 'coder', task_template: 'Clean {{previous_output}}' },
    ]
  }
}

// 新代码（agent_team）
{
  tool: 'agent_team',
  input: {
    strategy: 'pipeline',
    members: [
      { id: 'explore', role: 'explore', task: 'Extract data' },
      { id: 'coder', role: 'coder', task: 'Clean {{previous_output}}' },
    ],
    goal: 'Data pipeline'
  }
}
```

**QuickTeamTool → agent_team**：
```typescript
// 旧代码（QuickTeamTool）
{
  tool: 'quick_team',
  input: {
    template: 'code-review',
    goal: 'Review auth.ts'
  }
}

// 新代码（agent_team）
{
  tool: 'agent_team',
  input: {
    template: 'code-review',  // 相同
    goal: 'Review auth.ts'
  }
}
```

---

## 总结

### 核心理念

**多Agent工具应该简洁清晰**：
- 单个Agent → TaskTool
- 多个Agent → TeamTool（模板或自定义）

**配置应该渐进式**：
- 简单场景 → 模板（2字段）
- 复杂场景 → 自定义（3-5字段/member）

### 优势

1. **概念清晰**：2个工具，清晰边界
2. **配置简洁**：模板模式降低90%配置量
3. **灵活性保留**：自定义模式支持复杂场景
4. **可维护性**：减少工具数量，减少代码重复

---

**完成日期**: 待定
**负责人**: Kevin Shi
