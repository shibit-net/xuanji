# Agent Team 任务拆分与协调改进方案

## 问题分析

### 当前实现的不足

1. **任务拆分缺失**
   - 用户传入完整 goal，所有成员看到相同描述
   - 没有引导如何拆分大任务为子任务
   - 成员职责不清晰，可能重复工作

2. **协调机制薄弱**
   - parallel: 成员独立工作，缺少职责划分
   - sequential: 简单串行，未充分利用前序输出
   - hierarchical: leader 应该分解任务，但没有明确指导

3. **Prompt 指导不完整**
   - 只有"何时使用"，缺少"如何使用"
   - 缺少任务拆分最佳实践
   - 缺少成员间通信模式

## 改进方案

### 方案 A：在 Goal 中明确子任务（推荐，无需改代码）

#### 核心思想
通过 Prompt 引导用户在 goal 中明确每个成员的子任务，而不是让所有成员看到相同的任务描述。

#### Prompt 指导模板

```markdown
## 🎯 Task Decomposition for agent_team

**CRITICAL**: Do NOT give all members the same goal.
Break down the task into specific sub-tasks for each member.

### Step 1: Analyze the Task
Identify distinct aspects that can be parallelized or sequenced.

Example: "Review codebase for quality, security, and performance"
→ 3 distinct aspects: quality, security, performance
→ 3 members needed

### Step 2: Define Member Responsibilities

**Pattern 1: Parallel Independent Analysis**
Each member analyzes the SAME input from a DIFFERENT perspective.

\`\`\`
goal: "Analyze /path/to/codebase from multiple perspectives. Each member has a specific focus area defined in their system_prompt."

members: [
  {
    id: "quality_reviewer",
    system_prompt: "You are a code quality expert. Analyze /path/to/codebase and provide 5-10 quality improvement suggestions. Focus on: code smells, maintainability, readability, best practices. Output format: numbered list with file:line references."
  },
  {
    id: "security_reviewer",
    system_prompt: "You are a security expert. Analyze /path/to/codebase and identify 5-10 security vulnerabilities. Focus on: injection risks, authentication flaws, data exposure. Output format: numbered list with severity (High/Medium/Low)."
  },
  {
    id: "performance_reviewer",
    system_prompt: "You are a performance expert. Analyze /path/to/codebase and suggest 5-10 performance optimizations. Focus on: algorithmic complexity, memory usage, I/O bottlenecks. Output format: numbered list with expected impact."
  }
]
\`\`\`

**Pattern 2: Sequential Pipeline**
Each member processes the output of the previous member.

\`\`\`
goal: "Extract data from /path/to/logs, clean it, analyze patterns, and generate report."

members: [
  {
    id: "extractor",
    system_prompt: "Extract error logs from /path/to/logs. Output: JSON array of {timestamp, level, message, stack_trace}. Only include ERROR and FATAL levels."
  },
  {
    id: "cleaner",
    system_prompt: "You will receive JSON error logs. Clean and deduplicate them. Group by error type. Output: JSON object {error_type: [occurrences]}."
  },
  {
    id: "analyzer",
    system_prompt: "You will receive grouped error data. Analyze patterns: frequency, time distribution, root causes. Output: Markdown report with insights and recommendations."
  }
]
\`\`\`

**Pattern 3: Hierarchical Coordination**
Leader decomposes task, workers execute sub-tasks.

\`\`\`
goal: "Implement user authentication feature with backend, frontend, and tests."

members: [
  {
    id: "tech_lead",
    priority: 10,  // Leader
    system_prompt: "You are the tech lead. Break down the authentication feature into 3 sub-tasks: (1) backend API, (2) frontend UI, (3) integration tests. For each sub-task, specify: files to create/modify, key requirements, acceptance criteria. Output: Markdown with 3 sections."
  },
  {
    id: "backend_dev",
    priority: 5,
    system_prompt: "You will receive backend sub-task from tech lead. Implement the backend API according to the spec. Create necessary files and write code."
  },
  {
    id: "frontend_dev",
    priority: 5,
    system_prompt: "You will receive frontend sub-task from tech lead. Implement the UI according to the spec. Create necessary components."
  },
  {
    id: "qa_engineer",
    priority: 5,
    system_prompt: "You will receive test sub-task from tech lead. Write integration tests according to the spec. Ensure all acceptance criteria are covered."
  }
]
\`\`\`

**Pattern 4: Debate Consensus**
Members discuss and refine a solution through multiple rounds.

\`\`\`
goal: "Design the architecture for a real-time notification system. Consider scalability, reliability, and cost."

members: [
  {
    id: "architect_a",
    system_prompt: "Propose an architecture for real-time notifications. Consider: WebSocket vs SSE, message queue, database, scaling strategy. Explain trade-offs."
  },
  {
    id: "architect_b",
    system_prompt: "Review other proposals and provide your own architecture. Critique weaknesses and suggest improvements. Focus on reliability and failure handling."
  },
  {
    id: "architect_c",
    system_prompt: "Review all proposals and provide cost analysis. Suggest the most cost-effective approach while meeting requirements. Consider: infrastructure cost, development time, maintenance."
  }
]
\`\`\`

### Step 3: Avoid Common Mistakes

❌ **Bad: Vague, identical goals**
\`\`\`
goal: "Analyze the code"
members: [
  { id: "m1", system_prompt: "Analyze the code" },
  { id: "m2", system_prompt: "Analyze the code" },
  { id: "m3", system_prompt: "Analyze the code" }
]
// Result: All 3 members do the same thing!
\`\`\`

✅ **Good: Specific, distinct responsibilities**
\`\`\`
goal: "Analyze /path/to/code from quality, security, and performance perspectives."
members: [
  { id: "m1", system_prompt: "Focus on code quality: smells, maintainability, readability" },
  { id: "m2", system_prompt: "Focus on security: vulnerabilities, injection risks, auth flaws" },
  { id: "m3", system_prompt: "Focus on performance: complexity, memory, I/O bottlenecks" }
]
// Result: Each member has clear, non-overlapping responsibility
\`\`\`

### Step 4: Leverage Strategy-Specific Features

**parallel**: Use when sub-tasks are independent
- Each member analyzes different aspect of same input
- Or each member processes different subset of data
- Results are merged at the end

**sequential**: Use when output of one feeds into next
- Member N uses Member N-1's output as input
- Build up complexity progressively
- Example: extract → clean → analyze → report

**hierarchical**: Use when coordination is needed
- Leader breaks down task into sub-tasks
- Workers execute sub-tasks in parallel
- Leader has access to all worker outputs

**debate**: Use when consensus is needed
- Multiple rounds of discussion
- Each member responds to previous opinions
- Converge to best solution

**pipeline**: Use for data transformation workflows
- Clear input → process → output chain
- Each stage transforms data for next stage
- Example: raw data → parsed → validated → stored
```

### 方案 B：增强 TeamManager 自动任务分解（需要改代码）

#### 核心思想
在 TeamManager 中添加自动任务分解逻辑，根据策略智能生成每个成员的具体任务。

#### 实现要点

```typescript
// TeamManager.ts

/**
 * 为成员生成具体的子任务描述
 */
private generateMemberTask(
  member: TeamMember,
  teamGoal: string,
  strategy: TeamStrategy,
  memberIndex: number,
  previousResults?: TaskExecutionResult[]
): string {
  switch (strategy) {
    case 'parallel':
      // 并行：每个成员关注不同方面
      return this.generateParallelTask(member, teamGoal);
      
    case 'sequential':
      // 串行：基于前序输出
      return this.generateSequentialTask(member, teamGoal, previousResults);
      
    case 'hierarchical':
      // 层级：leader 分解，worker 执行
      return this.generateHierarchicalTask(member, teamGoal, previousResults);
      
    case 'debate':
      // 辩论：基于前序观点
      return this.generateDebateTask(member, teamGoal, previousResults);
      
    case 'pipeline':
      // 流水线：处理前序输出
      return this.generatePipelineTask(member, teamGoal, previousResults);
  }
}

private generateParallelTask(member: TeamMember, teamGoal: string): string {
  return [
    `# Your Sub-Task`,
    ``,
    `Team Goal: ${teamGoal}`,
    ``,
    `Your Focus: ${member.capabilities.join(', ')}`,
    ``,
    `Instructions:`,
    `- Analyze the task from YOUR perspective (${member.capabilities[0]})`,
    `- Do NOT duplicate work of other team members`,
    `- Provide 5-10 specific, actionable findings`,
    `- Include file:line references where applicable`,
    ``,
    `Output Format:`,
    `1. [Finding 1]`,
    `2. [Finding 2]`,
    `...`,
  ].join('\n');
}

private generateSequentialTask(
  member: TeamMember,
  teamGoal: string,
  previousResults?: TaskExecutionResult[]
): string {
  const previousOutput = previousResults?.[previousResults.length - 1]?.result;
  
  if (!previousOutput) {
    // 第一个成员
    return [
      `# Your Sub-Task (Step 1)`,
      ``,
      `Team Goal: ${teamGoal}`,
      ``,
      `Your Role: ${member.capabilities.join(', ')}`,
      ``,
      `Instructions:`,
      `- You are the FIRST step in the pipeline`,
      `- Your output will be used by the next member`,
      `- Focus on: ${member.capabilities[0]}`,
    ].join('\n');
  } else {
    // 后续成员
    return [
      `# Your Sub-Task (Step ${(previousResults?.length ?? 0) + 1})`,
      ``,
      `Team Goal: ${teamGoal}`,
      ``,
      `Previous Step Output:`,
      `\`\`\``,
      previousOutput,
      `\`\`\``,
      ``,
      `Your Role: ${member.capabilities.join(', ')}`,
      ``,
      `Instructions:`,
      `- Build upon the previous step's output`,
      `- Focus on: ${member.capabilities[0]}`,
      `- Your output will be used by the next member (if any)`,
    ].join('\n');
  }
}

private generateHierarchicalTask(
  member: TeamMember,
  teamGoal: string,
  previousResults?: TaskExecutionResult[]
): string {
  const isLeader = member.priority && member.priority >= 8;
  
  if (isLeader) {
    return [
      `# Your Task (Team Leader)`,
      ``,
      `Team Goal: ${teamGoal}`,
      ``,
      `Your Responsibilities:`,
      `1. Break down the team goal into ${this.context!.config.members.length - 1} specific sub-tasks`,
      `2. For each sub-task, specify:`,
      `   - What needs to be done`,
      `   - Key requirements`,
      `   - Acceptance criteria`,
      `3. Assign sub-tasks to team members based on their capabilities`,
      ``,
      `Team Members:`,
      ...this.context!.config.members
        .filter(m => m.id !== member.id)
        .map(m => `- ${m.id}: ${m.capabilities.join(', ')}`),
      ``,
      `Output Format:`,
      `## Sub-Task 1: [Title]`,
      `Assigned to: [member_id]`,
      `Requirements: ...`,
      `Acceptance Criteria: ...`,
    ].join('\n');
  } else {
    // Worker
    const leaderOutput = previousResults?.[0]?.result;
    return [
      `# Your Sub-Task`,
      ``,
      `Team Goal: ${teamGoal}`,
      ``,
      `Leader's Task Breakdown:`,
      `\`\`\``,
      leaderOutput || '(Waiting for leader...)',
      `\`\`\``,
      ``,
      `Your Capabilities: ${member.capabilities.join(', ')}`,
      ``,
      `Instructions:`,
      `- Find YOUR assigned sub-task in the leader's breakdown`,
      `- Execute it according to the requirements`,
      `- Meet all acceptance criteria`,
    ].join('\n');
  }
}
```

## 推荐实施路径

### Phase 1: Prompt 增强（立即可做）
1. 更新 `l2-team-coordination.ts`，添加任务拆分指导
2. 提供 4 种策略的具体模式和示例
3. 强调"不要给所有成员相同的 goal"

### Phase 2: 代码增强（下一版本）
1. 在 TeamManager 中添加 `generateMemberTask()` 方法
2. 根据策略自动生成成员特定的任务描述
3. 保留用户自定义 system_prompt 的能力（优先级更高）

### Phase 3: 工具增强（未来）
1. 添加 `task_decomposition` 工具，帮助用户分解任务
2. 提供任务拆分模板库
3. 自动检测任务重叠，提示用户优化

## 效果对比

### 改进前
```typescript
agent_team({
  goal: "Analyze the codebase",
  members: [
    { id: "m1", capabilities: ["analysis"] },
    { id: "m2", capabilities: ["analysis"] },
    { id: "m3", capabilities: ["analysis"] }
  ]
})
// 结果：3 个成员做相同的事情，浪费资源
```

### 改进后
```typescript
agent_team({
  goal: "Analyze /path/to/codebase from quality, security, and performance perspectives.",
  members: [
    {
      id: "quality",
      capabilities: ["code quality"],
      system_prompt: "Focus on code quality: smells, maintainability, readability. Provide 5-10 specific improvements with file:line references."
    },
    {
      id: "security",
      capabilities: ["security"],
      system_prompt: "Focus on security: vulnerabilities, injection risks, auth flaws. Provide 5-10 findings with severity levels."
    },
    {
      id: "performance",
      capabilities: ["performance"],
      system_prompt: "Focus on performance: complexity, memory, I/O. Provide 5-10 optimizations with expected impact."
    }
  ]
})
// 结果：每个成员有明确职责，无重复工作，充分利用并行优势
```

## 相关文档
- [任务拆分最佳实践](./agent-team-task-decomposition-best-practices.md)
- [策略选择指南](./agent-team-strategy-guide.md)
- [成员协调模式](./agent-team-coordination-patterns.md)
