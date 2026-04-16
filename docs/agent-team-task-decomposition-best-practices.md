# Agent Team 任务拆分最佳实践

## 核心原则

### 1. 每个成员必须有明确、不重叠的职责
❌ 错误：所有成员做相同的事
✅ 正确：每个成员专注于不同方面

### 2. 使用 system_prompt 定义具体职责
system_prompt 是定义成员职责的关键，必须包含：
- 具体的关注点（focus on...）
- 明确的输出格式（output format...）
- 与其他成员的区别（do NOT duplicate...）

### 3. Goal 要自包含但不重复
- goal 包含整体任务描述和上下文
- system_prompt 包含成员特定的职责
- 避免在 goal 中重复所有细节

## 策略特定的拆分模式

### Parallel 策略

**适用场景**：多个独立的分析维度

**拆分原则**：
- 每个成员分析相同输入的不同方面
- 成员之间完全独立，无依赖关系
- 结果在最后合并

**示例 1：代码审查**
```typescript
agent_team({
  team_name: 'code-review-team',
  goal: 'Review /src/auth/ directory for quality, security, and performance issues.',
  strategy: 'parallel',
  timeout: 1800000,  // 30 min
  
  members: [
    {
      id: 'quality_reviewer',
      role: 'coder',
      capabilities: ['code quality', 'best practices'],
      system_prompt: [
        'You are a code quality expert.',
        'Focus ONLY on code quality aspects:',
        '- Code smells (long methods, god classes, etc.)',
        '- Maintainability issues',
        '- Readability problems',
        '- Violation of SOLID principles',
        '',
        'Do NOT analyze security or performance.',
        '',
        'Output format:',
        '1. [Issue]: [Description] (file:line)',
        '2. ...',
        '',
        'Provide 5-10 specific findings.'
      ].join('\n')
    },
    {
      id: 'security_reviewer',
      role: 'explore',
      capabilities: ['security analysis', 'vulnerability detection'],
      system_prompt: [
        'You are a security expert.',
        'Focus ONLY on security aspects:',
        '- SQL injection risks',
        '- XSS vulnerabilities',
        '- Authentication/authorization flaws',
        '- Sensitive data exposure',
        '',
        'Do NOT analyze code quality or performance.',
        '',
        'Output format:',
        '1. [Severity: High/Medium/Low] [Vulnerability]: [Description] (file:line)',
        '2. ...',
        '',
        'Provide 5-10 security findings.'
      ].join('\n')
    },
    {
      id: 'performance_reviewer',
      role: 'general-purpose',
      capabilities: ['performance optimization'],
      system_prompt: [
        'You are a performance expert.',
        'Focus ONLY on performance aspects:',
        '- Algorithmic complexity (O(n²) loops, etc.)',
        '- Memory leaks',
        '- Inefficient database queries',
        '- I/O bottlenecks',
        '',
        'Do NOT analyze code quality or security.',
        '',
        'Output format:',
        '1. [Impact: High/Medium/Low] [Optimization]: [Description] (file:line)',
        '2. ...',
        '',
        'Provide 5-10 performance optimizations.'
      ].join('\n')
    }
  ]
})
```

**示例 2：多源研究**
```typescript
agent_team({
  team_name: 'research-team',
  goal: 'Research best practices for implementing WebSocket in Node.js. Consider official docs, community blogs, and existing codebases.',
  strategy: 'parallel',
  timeout: 1200000,  // 20 min
  
  members: [
    {
      id: 'docs_researcher',
      capabilities: ['documentation research'],
      system_prompt: 'Search official Node.js and WebSocket library documentation. Extract 5-7 key best practices with references.'
    },
    {
      id: 'blog_researcher',
      capabilities: ['community research'],
      system_prompt: 'Search community blogs and articles about WebSocket implementation. Extract 5-7 practical tips and common pitfalls.'
    },
    {
      id: 'code_researcher',
      capabilities: ['code analysis'],
      system_prompt: 'Analyze popular open-source projects using WebSocket. Extract 5-7 implementation patterns and anti-patterns.'
    }
  ]
})
```

### Sequential 策略

**适用场景**：任务有明确的先后依赖关系

**拆分原则**：
- 每个成员的输出是下一个成员的输入
- 后续成员在 system_prompt 中明确"接收前序输出"
- 逐步构建复杂度

**示例 1：数据处理流水线**
```typescript
agent_team({
  team_name: 'log-analysis-pipeline',
  goal: 'Analyze error logs in /var/logs/app.log: extract → clean → analyze → report.',
  strategy: 'sequential',
  timeout: 2400000,  // 40 min
  
  members: [
    {
      id: 'extractor',
      capabilities: ['data extraction'],
      system_prompt: [
        'Step 1: Extract error logs from /var/logs/app.log',
        '',
        'Tasks:',
        '- Read the log file',
        '- Filter only ERROR and FATAL level entries',
        '- Parse timestamp, level, message, stack trace',
        '',
        'Output format: JSON array',
        '[',
        '  {"timestamp": "2026-04-16T10:30:00", "level": "ERROR", "message": "...", "stack": "..."},',
        '  ...',
        ']',
        '',
        'Your output will be used by the next member for cleaning.'
      ].join('\n')
    },
    {
      id: 'cleaner',
      capabilities: ['data cleaning'],
      system_prompt: [
        'Step 2: Clean and deduplicate error logs',
        '',
        'You will receive JSON array of error logs from the previous step.',
        '',
        'Tasks:',
        '- Remove duplicate errors (same message)',
        '- Group by error type',
        '- Count occurrences',
        '',
        'Output format: JSON object',
        '{',
        '  "DatabaseConnectionError": [',
        '    {"timestamp": "...", "count": 5, "first_seen": "...", "last_seen": "..."},',
        '    ...',
        '  ],',
        '  "AuthenticationError": [...],',
        '  ...',
        '}',
        '',
        'Your output will be used by the next member for analysis.'
      ].join('\n')
    },
    {
      id: 'analyzer',
      capabilities: ['pattern analysis'],
      system_prompt: [
        'Step 3: Analyze error patterns',
        '',
        'You will receive grouped error data from the previous step.',
        '',
        'Tasks:',
        '- Identify most frequent errors',
        '- Analyze time distribution (peak hours)',
        '- Infer root causes',
        '- Suggest fixes',
        '',
        'Output format: Markdown report',
        '## Error Analysis Report',
        '',
        '### Top 5 Errors',
        '1. [Error Type]: [Count] occurrences',
        '   - Root cause: ...',
        '   - Suggested fix: ...',
        '',
        '### Time Distribution',
        '- Peak error time: ...',
        '- Pattern: ...',
        '',
        '### Recommendations',
        '1. ...',
        '2. ...'
      ].join('\n')
    }
  ]
})
```

**示例 2：渐进式代码重构**
```typescript
agent_team({
  team_name: 'refactor-pipeline',
  goal: 'Refactor /src/legacy/UserService.ts: analyze → plan → implement → test.',
  strategy: 'sequential',
  timeout: 3600000,  // 60 min
  
  members: [
    {
      id: 'analyzer',
      role: 'explore',
      capabilities: ['code analysis'],
      system_prompt: 'Analyze UserService.ts. Identify: code smells, coupling issues, testability problems. Output: numbered list of issues with severity.'
    },
    {
      id: 'planner',
      role: 'plan',
      capabilities: ['refactoring planning'],
      system_prompt: 'Receive analysis from previous step. Create refactoring plan: what to extract, what to rename, what to simplify. Output: step-by-step plan.'
    },
    {
      id: 'implementer',
      role: 'coder',
      capabilities: ['code implementation'],
      system_prompt: 'Receive refactoring plan from previous step. Implement the refactoring. Create new files if needed. Ensure backward compatibility.'
    },
    {
      id: 'tester',
      role: 'test-writer',
      capabilities: ['test writing'],
      system_prompt: 'Receive refactored code from previous step. Write unit tests to verify correctness. Ensure all original functionality is preserved.'
    }
  ]
})
```

### Hierarchical 策略

**适用场景**：需要协调和任务分解的复杂项目

**拆分原则**：
- Leader（priority >= 8）负责任务分解
- Workers 执行 leader 分配的子任务
- Leader 的 system_prompt 要求输出结构化的任务分配

**示例：功能开发**
```typescript
agent_team({
  team_name: 'feature-dev-team',
  goal: 'Implement user profile editing feature with backend API, frontend UI, and tests.',
  strategy: 'hierarchical',
  timeout: 3600000,  // 60 min
  
  members: [
    {
      id: 'tech_lead',
      role: 'plan',
      priority: 10,  // Leader
      capabilities: ['architecture', 'task decomposition'],
      system_prompt: [
        'You are the tech lead. Break down the user profile editing feature into sub-tasks.',
        '',
        'Team members:',
        '- backend_dev: Backend API development',
        '- frontend_dev: Frontend UI development',
        '- qa_engineer: Testing',
        '',
        'For each sub-task, specify:',
        '1. What needs to be done',
        '2. Files to create/modify',
        '3. Key requirements',
        '4. Acceptance criteria',
        '',
        'Output format:',
        '## Sub-Task 1: Backend API',
        'Assigned to: backend_dev',
        'Files: src/api/ProfileController.ts, src/services/ProfileService.ts',
        'Requirements:',
        '- PUT /api/profile endpoint',
        '- Validate input (email format, name length)',
        '- Update database',
        '- Return updated profile',
        'Acceptance Criteria:',
        '- [ ] Endpoint responds with 200 on success',
        '- [ ] Validation errors return 400',
        '- [ ] Database is updated correctly',
        '',
        '## Sub-Task 2: Frontend UI',
        '...',
        '',
        '## Sub-Task 3: Tests',
        '...'
      ].join('\n')
    },
    {
      id: 'backend_dev',
      role: 'coder',
      priority: 5,  // Worker
      capabilities: ['backend development'],
      system_prompt: [
        'You will receive a backend sub-task from the tech lead.',
        '',
        'Tasks:',
        '- Find YOUR assigned sub-task in the leader\'s breakdown',
        '- Implement according to the requirements',
        '- Create/modify the specified files',
        '- Meet all acceptance criteria',
        '',
        'Output: Confirmation that all acceptance criteria are met, with file paths.'
      ].join('\n')
    },
    {
      id: 'frontend_dev',
      role: 'coder',
      priority: 5,  // Worker
      capabilities: ['frontend development'],
      system_prompt: [
        'You will receive a frontend sub-task from the tech lead.',
        '',
        'Tasks:',
        '- Find YOUR assigned sub-task in the leader\'s breakdown',
        '- Implement according to the requirements',
        '- Create/modify the specified files',
        '- Meet all acceptance criteria',
        '',
        'Output: Confirmation that all acceptance criteria are met, with file paths.'
      ].join('\n')
    },
    {
      id: 'qa_engineer',
      role: 'test-writer',
      priority: 5,  // Worker
      capabilities: ['testing'],
      system_prompt: [
        'You will receive a testing sub-task from the tech lead.',
        '',
        'Tasks:',
        '- Find YOUR assigned sub-task in the leader\'s breakdown',
        '- Write tests according to the requirements',
        '- Cover all acceptance criteria',
        '',
        'Output: Confirmation that all tests are written and passing.'
      ].join('\n')
    }
  ]
})
```

### Debate 策略

**适用场景**：需要多角度评估和达成共识

**拆分原则**：
- 每个成员代表不同的视角或利益相关方
- 多轮讨论，每轮成员回应前序观点
- 最终收敛到最佳方案

**示例：架构设计**
```typescript
agent_team({
  team_name: 'architecture-debate',
  goal: 'Design the architecture for a real-time notification system. Consider scalability, reliability, and cost.',
  strategy: 'debate',
  max_rounds: 3,
  timeout: 2400000,  // 40 min
  
  members: [
    {
      id: 'scalability_advocate',
      capabilities: ['scalability', 'performance'],
      system_prompt: [
        'You advocate for SCALABILITY.',
        '',
        'Round 1: Propose an architecture that scales to millions of users.',
        'Consider: WebSocket vs SSE, message queue, horizontal scaling.',
        '',
        'Later rounds: Review other proposals. Critique scalability weaknesses.',
        'Suggest improvements to handle high load.',
        '',
        'Output format:',
        '## My Proposal',
        '[Your architecture]',
        '',
        '## Critique of Other Proposals',
        '- Proposal A: [Scalability issue]',
        '- Proposal B: [Scalability issue]',
        '',
        '## Improvements',
        '[Suggestions]'
      ].join('\n')
    },
    {
      id: 'reliability_advocate',
      capabilities: ['reliability', 'fault tolerance'],
      system_prompt: [
        'You advocate for RELIABILITY.',
        '',
        'Round 1: Propose an architecture that handles failures gracefully.',
        'Consider: redundancy, failover, message persistence, retry logic.',
        '',
        'Later rounds: Review other proposals. Critique reliability weaknesses.',
        'Suggest improvements for fault tolerance.',
        '',
        'Output format:',
        '## My Proposal',
        '[Your architecture]',
        '',
        '## Critique of Other Proposals',
        '- Proposal A: [Reliability issue]',
        '- Proposal B: [Reliability issue]',
        '',
        '## Improvements',
        '[Suggestions]'
      ].join('\n')
    },
    {
      id: 'cost_advocate',
      capabilities: ['cost optimization'],
      system_prompt: [
        'You advocate for COST EFFICIENCY.',
        '',
        'Round 1: Propose an architecture that minimizes cost.',
        'Consider: infrastructure cost, development time, maintenance overhead.',
        '',
        'Later rounds: Review other proposals. Provide cost analysis.',
        'Suggest the most cost-effective approach.',
        '',
        'Output format:',
        '## My Proposal',
        '[Your architecture]',
        '',
        '## Cost Analysis of Other Proposals',
        '- Proposal A: Estimated cost $X/month, dev time Y weeks',
        '- Proposal B: Estimated cost $X/month, dev time Y weeks',
        '',
        '## Recommendation',
        '[Most cost-effective approach]'
      ].join('\n')
    }
  ]
})
```

### Pipeline 策略

**适用场景**：数据转换流水线

**拆分原则**：
- 每个阶段有明确的输入和输出格式
- 前一个阶段的输出直接成为下一个阶段的输入
- 类似 sequential，但更强调数据流

**示例：数据 ETL**
```typescript
agent_team({
  team_name: 'etl-pipeline',
  goal: 'ETL process: extract CSV → transform → validate → load to database.',
  strategy: 'pipeline',
  timeout: 2400000,  // 40 min
  
  members: [
    {
      id: 'extractor',
      capabilities: ['data extraction'],
      system_prompt: 'Extract data from /data/users.csv. Output: JSON array of raw records.'
    },
    {
      id: 'transformer',
      capabilities: ['data transformation'],
      system_prompt: 'Receive JSON from previous stage. Transform: normalize names, parse dates, calculate age. Output: JSON array of transformed records.'
    },
    {
      id: 'validator',
      capabilities: ['data validation'],
      system_prompt: 'Receive JSON from previous stage. Validate: email format, age range, required fields. Output: JSON array of valid records + error report.'
    },
    {
      id: 'loader',
      capabilities: ['data loading'],
      system_prompt: 'Receive validated JSON from previous stage. Generate SQL INSERT statements. Output: SQL script ready to execute.'
    }
  ]
})
```

## 通用最佳实践

### 1. 明确输出格式
每个成员的 system_prompt 应该指定输出格式：
- 列表：`Output: numbered list 1. 2. 3.`
- JSON：`Output: JSON object {key: value}`
- Markdown：`Output: Markdown report with ## headers`
- 代码：`Output: Code with file paths`

### 2. 限制输出长度
避免成员输出过长：
- `Provide 5-10 findings` (不是"所有发现")
- `Top 5 errors` (不是"所有错误")
- `3-5 key recommendations` (不是"详尽建议")

### 3. 包含文件引用
对于代码分析任务，要求包含文件位置：
- `Include file:line references`
- `Specify which files to create/modify`
- `Provide exact line numbers`

### 4. 避免重复工作
在 system_prompt 中明确说明：
- `Do NOT analyze security` (如果其他成员负责)
- `Focus ONLY on performance` (不要越界)
- `Do NOT duplicate work of other members`

### 5. 设置合理超时
根据任务复杂度和成员数量：
- 简单分析（2-3 成员）：10-20 分钟
- 中等任务（3-4 成员）：20-40 分钟
- 复杂项目（4-5 成员）：40-60 分钟

## 反模式（要避免）

### ❌ 反模式 1：所有成员相同职责
```typescript
members: [
  { id: "m1", system_prompt: "Analyze the code" },
  { id: "m2", system_prompt: "Analyze the code" },
  { id: "m3", system_prompt: "Analyze the code" }
]
// 结果：3 个成员做相同的事，浪费资源
```

### ❌ 反模式 2：职责模糊
```typescript
members: [
  { id: "m1", system_prompt: "Review the code" },
  { id: "m2", system_prompt: "Check the code" },
  { id: "m3", system_prompt: "Look at the code" }
]
// 结果：职责不清，可能重复或遗漏
```

### ❌ 反模式 3：缺少输出格式
```typescript
system_prompt: "Analyze security issues"
// 结果：输出格式不统一，难以整合
```

### ❌ 反模式 4：超时过短
```typescript
timeout: 300000,  // 5 min for 5 members doing complex analysis
// 结果：成员来不及完成，频繁超时
```

## 总结

**核心要点**：
1. ✅ 每个成员有明确、不重叠的职责
2. ✅ 使用 system_prompt 定义具体任务
3. ✅ 指定输出格式和长度限制
4. ✅ 根据策略选择合适的拆分模式
5. ✅ 设置充足的超时时间

**记住**：agent_team 的价值在于**分工协作**，而不是简单的并行执行。
