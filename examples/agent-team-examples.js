#!/usr/bin/env node

/**
 * Agent Team 使用示例
 *
 * 展示如何使用 agent_team 工具创建协作团队
 */

// 示例 1: 代码审查团队（串行执行）
const codeReviewTeam = {
  team_name: 'Code Review Team',
  goal: 'Review the src/core/agent/team/TeamManager.ts file for code quality, security, and performance issues',
  strategy: 'sequential',
  members: [
    {
      id: 'architect',
      role: 'plan',
      capabilities: ['architecture analysis', 'design patterns', 'SOLID principles'],
      priority: 3,
      system_prompt: 'Evaluate the architecture and design. Check if the code follows best practices and design patterns. Identify potential architectural issues.',
    },
    {
      id: 'security-expert',
      role: 'explore',
      capabilities: ['security analysis', 'vulnerability detection', 'input validation'],
      priority: 2,
      system_prompt: 'Look for security vulnerabilities: injection risks, race conditions, improper error handling, or data leakage. Check input validation and sanitization.',
    },
    {
      id: 'performance-analyst',
      role: 'explore',
      capabilities: ['performance analysis', 'memory leaks', 'optimization'],
      priority: 1,
      system_prompt: 'Analyze performance implications: memory leaks, inefficient algorithms, unnecessary computations, or resource waste. Suggest optimizations.',
    },
  ],
  max_rounds: 5,
  timeout: 300000, // 5 minutes
};

// 示例 2: 研究团队（并行执行）
const researchTeam = {
  team_name: 'Technology Research Squad',
  goal: 'Research best practices and tools for implementing multi-agent systems in TypeScript',
  strategy: 'parallel',
  members: [
    {
      id: 'academic-researcher',
      role: 'explore',
      capabilities: ['academic papers', 'research publications', 'theory'],
      system_prompt: 'Search for academic papers and research about multi-agent systems. Focus on theoretical foundations and proven algorithms.',
    },
    {
      id: 'open-source-explorer',
      role: 'explore',
      capabilities: ['GitHub search', 'open source projects', 'code examples'],
      system_prompt: 'Find open source implementations of multi-agent systems. Look for TypeScript libraries, frameworks, and real-world examples.',
    },
    {
      id: 'industry-analyst',
      role: 'explore',
      capabilities: ['blog posts', 'case studies', 'best practices'],
      system_prompt: 'Search for industry blogs, case studies, and best practices. Focus on production experiences and lessons learned.',
    },
  ],
  timeout: 600000, // 10 minutes
};

// 示例 3: 架构设计团队（辩论模式）
const architectureDebateTeam = {
  team_name: 'Architecture Design Debate',
  goal: 'Design a scalable message routing system for agent teams. Consider trade-offs between simplicity, performance, and flexibility.',
  strategy: 'debate',
  members: [
    {
      id: 'simplicity-advocate',
      role: 'plan',
      capabilities: ['simple solutions', 'maintainability', 'YAGNI'],
      system_prompt: 'Advocate for the simplest solution that works. Challenge over-engineering. Prioritize maintainability and understandability.',
    },
    {
      id: 'scalability-expert',
      role: 'plan',
      capabilities: ['scalability', 'distributed systems', 'high availability'],
      system_prompt: 'Ensure the design can scale to hundreds of agents. Consider distributed scenarios, fault tolerance, and horizontal scaling.',
    },
    {
      id: 'performance-optimizer',
      role: 'plan',
      capabilities: ['performance', 'low latency', 'resource efficiency'],
      system_prompt: 'Optimize for low latency and minimal resource usage. Challenge designs that waste CPU, memory, or network bandwidth.',
    },
  ],
  max_rounds: 3,
  timeout: 600000,
};

// 示例 4: 数据处理流水线
const dataProcessingPipeline = {
  team_name: 'Data Processing Pipeline',
  goal: 'Extract all TODO comments from the codebase, categorize them by priority and module, then generate a prioritized action plan',
  strategy: 'pipeline',
  members: [
    {
      id: 'extractor',
      role: 'explore',
      capabilities: ['code search', 'pattern matching', 'data extraction'],
      priority: 4,
      system_prompt: 'Search the codebase for all TODO, FIXME, and HACK comments. Extract them with file path and line number.',
    },
    {
      id: 'categorizer',
      role: 'general-purpose',
      capabilities: ['classification', 'categorization', 'analysis'],
      priority: 3,
      system_prompt: 'Categorize the TODOs by: priority (P0/P1/P2), module/area, and type (bug/feature/refactor). Add your analysis.',
    },
    {
      id: 'prioritizer',
      role: 'plan',
      capabilities: ['prioritization', 'dependency analysis', 'planning'],
      priority: 2,
      system_prompt: 'Analyze dependencies between TODOs. Create a prioritized execution order considering impact and dependencies.',
    },
    {
      id: 'action-planner',
      role: 'plan',
      capabilities: ['action planning', 'task breakdown', 'estimation'],
      priority: 1,
      system_prompt: 'Generate a concrete action plan: break down each TODO into actionable steps, estimate effort, and suggest assignees.',
    },
  ],
  timeout: 600000,
};

// 示例 5: 层级协作团队
const hierarchicalTeam = {
  team_name: 'Feature Development Team',
  goal: 'Design and implement a new feature: "Team performance analytics and visualization"',
  strategy: 'hierarchical',
  members: [
    {
      id: 'tech-lead',
      role: 'plan',
      capabilities: ['system design', 'technical leadership', 'architecture'],
      priority: 10, // Highest priority = leader
      system_prompt: 'As tech lead, analyze the feature requirements, design the architecture, identify technical challenges, and provide guidance for the team.',
    },
    {
      id: 'backend-dev',
      role: 'coder',
      capabilities: ['backend development', 'API design', 'database'],
      priority: 5,
      system_prompt: 'Based on the tech lead\'s design, implement the backend logic: data collection, aggregation, and API endpoints.',
    },
    {
      id: 'frontend-dev',
      role: 'coder',
      capabilities: ['frontend development', 'visualization', 'UI/UX'],
      priority: 5,
      system_prompt: 'Based on the tech lead\'s design, implement the visualization layer: charts, dashboards, and user interactions.',
    },
    {
      id: 'qa-engineer',
      role: 'coder',
      capabilities: ['testing', 'test automation', 'quality assurance'],
      priority: 3,
      system_prompt: 'Design test strategy and write test cases based on the implementation. Ensure code coverage and edge case handling.',
    },
  ],
  timeout: 900000, // 15 minutes
};

// 使用说明
console.log(`
Agent Team 使用示例
===================

这些示例展示了如何在 Xuanji 中使用 agent_team 工具创建协作团队。

使用方法：
1. 启动 xuanji CLI
2. 向 AI 描述任务，并建议使用团队协作
3. AI 会调用 agent_team 工具，传入类似下面的配置

---

示例 1: 代码审查团队（串行执行）
${JSON.stringify(codeReviewTeam, null, 2)}

---

示例 2: 研究团队（并行执行）
${JSON.stringify(researchTeam, null, 2)}

---

示例 3: 架构设计团队（辩论模式）
${JSON.stringify(architectureDebateTeam, null, 2)}

---

示例 4: 数据处理流水线
${JSON.stringify(dataProcessingPipeline, null, 2)}

---

示例 5: 层级协作团队
${JSON.stringify(hierarchicalTeam, null, 2)}

---

提示：
- 选择合适的策略很重要（sequential/parallel/hierarchical/debate/pipeline）
- 每个成员的 capabilities 和 system_prompt 定义了其专长和行为
- priority 在 sequential/hierarchical/pipeline 中决定执行顺序
- max_rounds 限制 debate 模式的讨论轮次
- timeout 防止团队执行时间过长

查看完整文档：docs/agent-team.md
`);
