/**
 * TeamTool — 团队协作工具
 *
 * 允许 LLM 创建和管理 agent 团队来协作完成复杂任务
 */

import type { JSONSchema, ToolResult, AgentConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import { BaseTool } from './BaseTool';
import { TeamManager } from '@/core/agent/team/TeamManager';
import type { TeamConfig, TeamMember, TeamStrategy } from '@/core/agent/team/types';
import type { AgentRoleType } from '@/core/agent/SubAgentContext';

export class TeamTool extends BaseTool {
  readonly name = 'agent_team';
  readonly description = [
    'Create a team of AI agents to collaborate on complex tasks.',
    '',
    '⚠️ CRITICAL REQUIREMENT - Agent Selection:',
    'You MUST follow this exact workflow BEFORE calling agent_team:',
    '',
    '1. For EACH team member, call match_agent or list_agents FIRST',
    '2. Review the available preset agents and their capabilities',
    '3. COPY the EXACT agentId from match_agent result (e.g., "coder", "explore")',
    '4. PASTE it as members[].agent_id parameter - DO NOT modify or translate it',
    '5. Only use custom names if match_agent returns score < 0.5 for ALL preset agents',
    '',
    '🚫 FORBIDDEN - Do NOT invent custom agent names:',
    '❌ "code-reviewer", "security-analyst", "结构扫描器", "核心模块分析师"',
    '✅ "coder", "explore", "plan", "test-writer" (exact IDs from match_agent)',
    '',
    '💡 WHY USE PRESET AGENTS:',
    '✓ Optimized prompts and tool configurations',
    '✓ Proven performance on common tasks',
    '✓ Faster execution (no need to design from scratch)',
    '✓ Better consistency across team members',
    '',
    '📋 AVAILABLE PRESET AGENTS:',
    '- coder: Code analysis, refactoring, implementation',
    '- explore: Fast read-only codebase exploration',
    '- test-writer: Writing unit/integration tests',
    '- doc-writer: Documentation and README generation',
    '- plan: High-level planning and task decomposition',
    '- general-purpose: Versatile agent for various tasks',
    '',
    '⚠️ CRITICAL REQUIREMENT - Members Parameter:',
    'The "members" parameter MUST be an array of objects, NOT a single object.',
    'Correct: members: [{ id: "m1", ... }, { id: "m2", ... }]',
    'Wrong: members: { id: "m1", ... }',
    '',
    '✅ CORRECT workflow example:',
    '  // Step 1: Find preset agent',
    '  match_agent({ task_description: "review code quality" })',
    '  → Returns: { agentId: "coder", score: 0.85 }',
    '',
    '  // Step 2: Use EXACT agentId',
    '  agent_team({',
    '    members: [',
    '      { ',
    '        id: "m1", ',
    '        agent_id: "coder",  // ✅ Copied exactly from match_agent',
    '        system_prompt: "Focus on code quality and maintainability."',
    '      }',
    '    ]',
    '  })',
    '',
    '❌ WRONG workflow example:',
    '  // Step 1: Find preset agent',
    '  match_agent({ task_description: "review code quality" })',
    '  → Returns: { agentId: "coder", score: 0.85 }',
    '',
    '  // Step 2: Inventing custom name - DO NOT DO THIS',
    '  agent_team({',
    '    members: [',
    '      { ',
    '        id: "m1", ',
    '        agent_id: "code-reviewer",  // ❌ Custom name - FORBIDDEN',
    '        system_prompt: "Focus on code quality and maintainability."',
    '      }',
    '    ]',
    '  })',
    '',
    '🎯 WHEN TO USE (instead of single task tool):',
    '✓ User explicitly requests "team mode" or "multiple agents"',
    '✓ Task needs 3+ distinct expert roles (e.g., architect + security + performance)',
    '✓ User wants debate/discussion (e.g., "evaluate from different perspectives")',
    '✓ Clear multi-stage pipeline (e.g., "extract → analyze → report")',
    '',
    '❌ DO NOT USE when:',
    '✗ Single straightforward task → use task tool instead',
    '✗ Simple analysis or code change → handle it yourself',
    '✗ Sequential steps you can coordinate → just use task multiple times',
    '',
    '📋 STRATEGY EXECUTION GUIDE:',
    '',
    '═══════════════════════════════════════════════════════════════',
    '1️⃣  PARALLEL (并行执行) — Independent Tasks',
    '═══════════════════════════════════════════════════════════════',
    '**Execution Flow:**',
    '  All members work simultaneously on different aspects',
    '  → Each member completes their assigned task independently',
    '  → Results are aggregated and returned to main agent',
    '',
    '**When to Use:**',
    '  ✓ Tasks are independent and can run concurrently',
    '  ✓ Need to gather information from multiple sources',
    '  ✓ Want to save time with parallel execution',
    '',
    '**Goal Structure (CRITICAL):**',
    '  You MUST explicitly assign tasks to each member in the goal:',
    '  ```',
    '  goal: "Research authentication best practices',
    '  ',
    '  **Task Assignments:**',
    '  - Member 1 (explore): Research OAuth 2.0 implementations and security considerations',
    '  - Member 2 (explore): Research JWT best practices and common vulnerabilities',
    '  - Member 3 (coder): Review our current auth code in src/auth/ for issues',
    '  ',
    '  **Context:** [shared context all members need]',
    '  **Expected Output:** Each member provides findings summary with recommendations"',
    '  ```',
    '',
    '**Example:**',
    '  strategy: "parallel"',
    '  members: [',
    '    { id: "m1", role: "explore", system_prompt: "Research OAuth 2.0 best practices" },',
    '    { id: "m2", role: "explore", system_prompt: "Research JWT token security" },',
    '    { id: "m3", role: "coder", system_prompt: "Review authentication code quality" }',
    '  ]',
    '',
    '═══════════════════════════════════════════════════════════════',
    '2️⃣  SEQUENTIAL (串行执行) — Build on Previous Results',
    '═══════════════════════════════════════════════════════════════',
    '**Execution Flow:**',
    '  Member 1 executes → passes result to Member 2',
    '  → Member 2 builds on it → passes to Member 3',
    '  → Final result aggregated and returned',
    '',
    '**When to Use:**',
    '  ✓ Each step depends on previous results',
    '  ✓ Need progressive refinement (rough → detailed)',
    '  ✓ Multi-stage review process',
    '',
    '**Goal Structure (CRITICAL):**',
    '  Describe the sequential workflow and each member\'s role:',
    '  ```',
    '  goal: "Code review workflow for PR #123',
    '  ',
    '  **Sequential Steps:**',
    '  1. Member 1 (coder): Review code structure and design patterns',
    '     - Focus on architecture and maintainability',
    '     - Identify major issues',
    '  ',
    '  2. Member 2 (explore): Based on Member 1\'s findings, analyze security',
    '     - Check for vulnerabilities in flagged areas',
    '     - Verify input validation and auth checks',
    '  ',
    '  3. Member 3 (test-writer): Based on previous findings, verify test coverage',
    '     - Ensure identified issues have tests',
    '     - Suggest additional test cases',
    '  ',
    '  **Context:** PR changes in src/api/UserController.ts',
    '  **Expected Output:** Comprehensive review report with prioritized issues"',
    '  ```',
    '',
    '**Example:**',
    '  strategy: "sequential"',
    '  members: [',
    '    { id: "m1", role: "coder", capabilities: ["architecture review"] },',
    '    { id: "m2", role: "explore", capabilities: ["security analysis"] },',
    '    { id: "m3", role: "test-writer", capabilities: ["test coverage"] }',
    '  ]',
    '',
    '═══════════════════════════════════════════════════════════════',
    '3️⃣  HIERARCHICAL (层级执行) — Leader + Workers',
    '═══════════════════════════════════════════════════════════════',
    '**Execution Flow:**',
    '  Leader (highest priority) plans and coordinates',
    '  → Workers execute sub-tasks in parallel based on leader\'s plan',
    '  → Results aggregated and returned',
    '',
    '**When to Use:**',
    '  ✓ Need planning/coordination before execution',
    '  ✓ Complex task requiring task breakdown',
    '  ✓ One expert leads, others execute',
    '',
    '**Goal Structure (CRITICAL):**',
    '  Describe leader\'s planning role and workers\' execution roles:',
    '  ```',
    '  goal: "Implement user profile feature',
    '  ',
    '  **Leader Role (Member 1 - highest priority):**',
    '  - Analyze requirements and create implementation plan',
    '  - Break down into: backend API, frontend UI, database schema, tests',
    '  - Define interfaces and data contracts',
    '  - Coordinate workers\' tasks',
    '  ',
    '  **Worker Roles:**',
    '  - Member 2: Implement backend API based on leader\'s plan',
    '  - Member 3: Implement frontend UI based on leader\'s plan',
    '  - Member 4: Write tests based on leader\'s plan',
    '  ',
    '  **Context:** User story in docs/features/user-profile.md',
    '  **Expected Output:** Complete implementation with all components"',
    '  ```',
    '',
    '**Example:**',
    '  strategy: "hierarchical"',
    '  members: [',
    '    { id: "leader", role: "plan", priority: 100, capabilities: ["planning", "coordination"] },',
    '    { id: "backend", role: "coder", priority: 50, capabilities: ["backend dev"] },',
    '    { id: "frontend", role: "coder", priority: 50, capabilities: ["frontend dev"] },',
    '    { id: "tester", role: "test-writer", priority: 50, capabilities: ["testing"] }',
    '  ]',
    '',
    '**Multi-Level Hierarchy:**',
    '  For complex projects, you can have multiple leaders:',
    '  ```',
    '  members: [',
    '    { id: "cto", role: "plan", priority: 100, capabilities: ["architecture"] },',
    '    { id: "backend-lead", role: "coder", priority: 80, capabilities: ["backend planning"] },',
    '    { id: "frontend-lead", role: "coder", priority: 80, capabilities: ["frontend planning"] },',
    '    { id: "backend-dev1", role: "coder", priority: 50, capabilities: ["API dev"] },',
    '    { id: "backend-dev2", role: "coder", priority: 50, capabilities: ["DB dev"] },',
    '    { id: "frontend-dev1", role: "coder", priority: 50, capabilities: ["UI dev"] },',
    '    { id: "frontend-dev2", role: "coder", priority: 50, capabilities: ["UX dev"] }',
    '  ]',
    '  ```',
    '  Higher priority members execute first, lower priority members see their results.',
    '',
    '═══════════════════════════════════════════════════════════════',
    '4️⃣  DEBATE (辩论模式) — Affirmative vs Negative + Judge',
    '═══════════════════════════════════════════════════════════════',
    '**Execution Flow:**',
    '  Round 1: Affirmative argues → Negative counters → Judge evaluates',
    '  Round 2: Affirmative responds → Negative responds → Judge evaluates',
    '  Round 3: Final arguments → Judge makes final decision',
    '',
    '**When to Use:**',
    '  ✓ Need to evaluate pros/cons of a decision',
    '  ✓ Want structured argumentation',
    '  ✓ Require objective judgment',
    '',
    '**Team Structure (REQUIRED):**',
    '  MUST have exactly 3 roles: affirmative (正方), negative (反方), judge (裁判)',
    '',
    '**Goal Structure (CRITICAL):**',
    '  State the debate topic clearly:',
    '  ```',
    '  goal: "Debate: Should we migrate from monolith to microservices?',
    '  ',
    '  **Context:**',
    '  - Current: Django monolith, 50K LOC, 5 developers',
    '  - Pain points: Slow deployment, tight coupling',
    '  - Concerns: Team experience, operational complexity',
    '  ',
    '  **Debate Format:**',
    '  - Affirmative: Argue FOR microservices migration',
    '  - Negative: Argue AGAINST microservices migration',
    '  - Judge: Evaluate arguments and make final recommendation',
    '  ',
    '  **Expected Output:** Judge\'s final decision with reasoning"',
    '  ```',
    '',
    '**Example:**',
    '  strategy: "debate"',
    '  max_rounds: 3',
    '  members: [',
    '    {',
    '      id: "pro",',
    '      role: "general-purpose",',
    '      name: "正方·架构师",',
    '      system_prompt: "[debate_role:affirmative] You are a senior architect with microservices expertise. Argue FOR the migration with concrete benefits and success stories.",',
    '      capabilities: ["architecture", "scalability"]',
    '    },',
    '    {',
    '      id: "con",',
    '      role: "general-purpose",',
    '      name: "反方·运维专家",',
    '      system_prompt: "[debate_role:negative] You are a DevOps expert. Argue AGAINST the migration with operational challenges and failure cases.",',
    '      capabilities: ["operations", "reliability"]',
    '    },',
    '    {',
    '      id: "judge",',
    '      role: "general-purpose",',
    '      name: "裁判·CTO",',
    '      system_prompt: "[debate_role:judge] You are the CTO. Listen to both sides objectively, weigh pros/cons, and make the final decision with clear reasoning.",',
    '      capabilities: ["decision making", "business strategy"]',
    '    }',
    '  ]',
    '',
    '**IMPORTANT:**',
    '  - The [debate_role:xxx] tag in system_prompt is parsed by UI to show role badges',
    '  - max_rounds=3 is recommended (allows thorough discussion)',
    '  - Judge should remain neutral and evaluate based on arguments',
    '',
    '═══════════════════════════════════════════════════════════════',
    '5️⃣  PIPELINE (流水线执行) — Data Flow Through Stages',
    '═══════════════════════════════════════════════════════════════',
    '**Execution Flow:**',
    '  Member 1 processes input → output becomes Member 2\'s input',
    '  → Member 2 processes → output becomes Member 3\'s input',
    '  → Final output returned',
    '',
    '**When to Use:**',
    '  ✓ Data transformation workflow',
    '  ✓ Each stage processes previous stage\'s output',
    '  ✓ Clear input/output contracts between stages',
    '',
    '**Goal Structure (CRITICAL):**',
    '  Define the pipeline stages and data flow:',
    '  ```',
    '  goal: "Process user feedback data',
    '  ',
    '  **Pipeline Stages:**',
    '  ',
    '  Stage 1 (Member 1 - explore): Extract feedback from sources',
    '  - Input: URLs to feedback sources (GitHub issues, support tickets)',
    '  - Task: Collect and extract raw feedback text',
    '  - Output: JSON array of feedback items with metadata',
    '  ',
    '  Stage 2 (Member 2 - explore): Categorize and analyze',
    '  - Input: Raw feedback JSON from Stage 1',
    '  - Task: Categorize by type (bug/feature/improvement), extract sentiment',
    '  - Output: Categorized feedback with sentiment scores',
    '  ',
    '  Stage 3 (Member 3 - coder): Generate action items',
    '  - Input: Categorized feedback from Stage 2',
    '  - Task: Create prioritized action items for development team',
    '  - Output: Action items with priority and effort estimates',
    '  ',
    '  **Context:** Feedback sources: github.com/org/repo/issues, support.example.com',
    '  **Expected Output:** Prioritized action items ready for sprint planning"',
    '  ```',
    '',
    '**Example:**',
    '  strategy: "pipeline"',
    '  members: [',
    '    { id: "extract", role: "explore", capabilities: ["data extraction"] },',
    '    { id: "analyze", role: "explore", capabilities: ["data analysis"] },',
    '    { id: "generate", role: "coder", capabilities: ["action planning"] }',
    '  ]',
    '',
    '**Key Principle:**',
    '  Each member\'s output becomes the next member\'s input.',
    '  Define clear data contracts between stages.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      team_name: {
        type: 'string',
        description: 'Name for this team (e.g., "Code Review Team", "Research Squad")',
      },
      goal: {
        type: 'string',
        description: [
          'The overall goal the team should accomplish.',
          'Team members have NO access to the parent conversation history.',
          'You MUST include all necessary context inline: relevant findings, constraints, file paths, decisions, and expected output format.',
          'Think of this as a self-contained brief — everything the team needs to succeed must be here.',
        ].join('\n'),
      },
      strategy: {
        type: 'string',
        enum: ['sequential', 'parallel', 'hierarchical', 'debate', 'pipeline'],
        description: 'Collaboration strategy. Choose based on task structure.',
      },
      members: {
        type: 'array',
        description: [
          '⚠️ CRITICAL: This MUST be an array of team member objects.',
          'Team members definition - each member represents one agent in the team.',
          '',
          'Example:',
          '  members: [',
          '    { id: "m1", role: "coder", capabilities: ["code review"] },',
          '    { id: "m2", role: "explore", capabilities: ["security analysis"] }',
          '  ]',
        ].join('\n'),
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique identifier (e.g., "analyst", "coder", "reviewer")',
            },
            agent_id: {
              type: 'string',
              description: [
                '⚠️ CRITICAL: This field MUST contain the EXACT agentId returned by match_agent.',
                '',
                '🚫 FORBIDDEN: Do NOT invent custom names like "code-reviewer", "security-analyst", "结构扫描器".',
                '✅ REQUIRED: Use the exact string from match_agent result: "coder", "explore", "plan", etc.',
                '',
                '⚡ MANDATORY WORKFLOW:',
                '1. Call match_agent({ task_description: "..." })',
                '2. Look at the result: { agentId: "coder", score: 0.85 }',
                '3. Copy "coder" EXACTLY to this field',
                '',
                'Example - CORRECT:',
                '  match_agent({ task_description: "review code quality" })',
                '  → Returns: { agentId: "coder", score: 0.85 }',
                '  → agent_id: "coder"  ✅ Copied exactly',
                '',
                'Example - WRONG:',
                '  match_agent({ task_description: "review code quality" })',
                '  → Returns: { agentId: "coder", score: 0.85 }',
                '  → agent_id: "code-reviewer"  ❌ Custom name - DO NOT DO THIS',
                '  → agent_id: "代码审查员"  ❌ Custom name - DO NOT DO THIS',
                '',
                'Valid preset agent IDs (use these EXACTLY):',
                '- "coder" — Code writing, refactoring, debugging',
                '- "explore" — Code exploration, analysis, research',
                '- "test-writer" — Test creation and validation',
                '- "doc-writer" — Documentation writing',
                '- "plan" — Planning and design',
                '- "general-purpose" — Default versatile agent',
                '',
                'Only use custom names if match_agent returns score < 0.5 for ALL preset agents.',
              ].join('\n'),
            },
            name: {
              type: 'string',
              description: 'Display name (optional, e.g., "Security Analyst")',
            },
            capabilities: {
              type: 'array',
              items: { type: 'string' },
              description: [
                'List of this member\'s capabilities (e.g., ["code analysis", "security review"]).',
                'Optional - if omitted, will be auto-derived from system_prompt or role.',
              ].join('\n'),
            },
            priority: {
              type: 'number',
              description: 'Priority level (higher = more important). Required for hierarchical strategy.',
            },
            system_prompt: {
              type: 'string',
              description: 'Custom system prompt for this member. Overrides preset agent config when provided.',
            },
            tools: {
              type: 'array',
              items: { type: 'string' },
              description: 'Custom tool list for this member. Overrides preset agent config tools when provided.',
            },
            timeout: {
              type: 'number',
              description: [
                'Per-member timeout in milliseconds (optional).',
                '',
                '⚠️ WARNING: Explicitly setting this value will OVERRIDE auto-calculated timeouts.',
                'The system automatically allocates timeout based on strategy:',
                '  - parallel: each member gets full team timeout',
                '  - sequential: members share with progressive allocation',
                '  - hierarchical: leader gets 50%, workers share remaining',
                '',
                '❌ Common mistake: Setting member.timeout = 60000 when team.timeout = 300000',
                '   → Member only gets 60s instead of auto-allocated 300s (parallel)',
                '',
                '✅ Best practice: DO NOT set this field unless you have a specific reason.',
                'Let the system auto-calculate based on strategy and team timeout.',
              ].join('\n'),
            },
          },
          required: ['id'],
        },
      },
      max_rounds: {
        type: 'number',
        description: 'Maximum number of collaboration rounds (default: 10)',
      },
      timeout: {
        type: 'number',
        description: [
          '🆕 Team total timeout in milliseconds (default: 1200000 = 20 minutes).',
          '',
          '⚡ This is a HARD LIMIT for the entire team execution.',
          'The system will automatically calculate member timeouts based on:',
          '  - Team total timeout',
          '  - Strategy (parallel/sequential/hierarchical/debate/pipeline)',
          '  - Number of members',
          '',
          '📊 Recommended timeouts by strategy and complexity:',
          '',
          'Simple tasks (2-3 members):',
          '  - parallel: 600000ms (10 min)',
          '  - sequential: 900000ms (15 min)',
          '',
          'Medium tasks (3-4 members):',
          '  - parallel: 1200000ms (20 min) — default',
          '  - sequential: 1800000ms (30 min)',
          '  - hierarchical: 1800000ms (30 min)',
          '',
          'Complex/Large analysis tasks (4-5 members):',
          '  - parallel: 2400000ms (40 min)',
          '  - sequential: 3600000ms (60 min)',
          '  - hierarchical: 3000000ms (50 min)',
          '  - debate (3 rounds): 2400000ms (40 min)',
          '',
          '⚠️ For large analysis tasks, use 40-60 minutes to ensure completion.',
          '',
          '💡 How it works:',
          '  - parallel: each member gets ~full timeout (concurrent)',
          '  - sequential: members share timeout progressively',
          '  - hierarchical: leader gets 50%, workers share remaining',
          '',
          '✅ Best practice: Set generous timeout, let strategy auto-allocate to members.',
        ].join('\n'),
      },
    },
    required: ['team_name', 'goal', 'strategy', 'members'],
  };

  readonly readonly = false; // 团队执行可能涉及写操作

  // 依赖注入
  private mainProvider: ILLMProvider | null = null;
  private registry: IToolRegistry | null = null;
  private agentConfig: AgentConfig | null = null;
  private hookRegistry: HookRegistry | null = null;
  private memoryStore: IMemoryStore | null = null;
  private currentDepth = 0;
  private agentRegistry: import('@/core/agent/AgentRegistry').AgentRegistry | null = null;
  private providerManager: import('@/core/providers/ProviderManager').ProviderManager | null = null;

  /**
   * 注入运行时依赖
   */
  setDependencies(deps: {
    provider: ILLMProvider;
    registry: IToolRegistry;
    agentConfig: AgentConfig;
    hookRegistry?: HookRegistry | null;
    memoryStore?: IMemoryStore | null;
    depth?: number;
    agentRegistry?: import('@/core/agent/AgentRegistry').AgentRegistry | null;
    providerManager?: import('@/core/providers/ProviderManager').ProviderManager | null;
  }): void {
    this.mainProvider = deps.provider;
    this.registry = deps.registry;
    this.agentConfig = deps.agentConfig;
    this.hookRegistry = deps.hookRegistry ?? null;
    this.memoryStore = deps.memoryStore ?? null;
    this.currentDepth = deps.depth ?? 0;
    this.agentRegistry = deps.agentRegistry ?? null;
    this.providerManager = deps.providerManager ?? null;
  }

  async execute(input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    // 验证依赖
    if (!this.mainProvider || !this.registry || !this.agentConfig) {
      return this.error('TeamTool not initialized. Internal error: dependencies not injected.');
    }

    // 验证 agentRegistry 和 providerManager（TeamManager 现在强制要求）
    if (!this.agentRegistry || !this.providerManager) {
      return this.error('TeamTool requires agentRegistry and providerManager to be initialized.');
    }

    // 解析参数
    const teamName = input.team_name as string;
    const goal = input.goal as string;
    const strategy = input.strategy as TeamStrategy;
    const membersInput = input.members as Array<{
      id: string;
      agent_id?: string;
      role?: AgentRoleType; // 向后兼容，已废弃
      name?: string;
      capabilities?: string[];
      priority?: number;
      system_prompt?: string;
      tools?: string[];
      timeout?: number;
    }>;
    const maxRounds = input.max_rounds as number | undefined;
    const timeout = input.timeout as number | undefined;

    // 验证输入
    if (!membersInput || membersInput.length === 0) {
      return this.error('Team must have at least one member');
    }

    if (membersInput.length > 10) {
      return this.error('Maximum team size is 10 members');
    }

    // 构建团队成员
    const members: TeamMember[] = membersInput.map(m => ({
      id: m.id,
      agentId: m.agent_id || m.role || 'general-purpose', // 优先使用 agent_id，向后兼容 role
      name: m.name,
      capabilities: m.capabilities ?? [],
      priority: m.priority,
      systemPrompt: m.system_prompt,
      tools: m.tools,
      timeout: m.timeout,
    }));

    // 🆕 计算超时配置
    const teamTotalTimeout = timeout ?? 1_200_000; // 默认 20 分钟（更充足，适合大型分析任务）
    let defaultMemberTimeout: number;

    // 根据策略和成员数量自动计算 defaultMemberTimeout
    switch (strategy) {
      case 'parallel':
        // 并行：每个成员可以用接近全部时间（留 10% 缓冲）
        defaultMemberTimeout = Math.floor(teamTotalTimeout * 0.9);
        break;
      case 'sequential':
        // 串行：平均分配，前面成员会得到更多（通过权重调整）
        defaultMemberTimeout = Math.floor(teamTotalTimeout / members.length);
        break;
      case 'hierarchical':
        // 层级：leader + workers，按 1.5:1 比例分配
        // 假设 1 个 leader + N 个 workers
        // total = leader * 1.5 + workers * 1.0 = 1.5 + (N-1) = N + 0.5
        // defaultMemberTimeout = total / (N + 0.5)
        defaultMemberTimeout = Math.floor(teamTotalTimeout / (members.length + 0.5));
        break;
      case 'debate':
        // 辩论：多轮，每轮所有成员发言
        const rounds = maxRounds ?? 10;
        // 首轮 1.0x，后续轮 0.6x，平均约 0.7x
        defaultMemberTimeout = Math.floor(teamTotalTimeout / (members.length * rounds * 0.7));
        break;
      case 'pipeline':
        // 流水线：串行，但各阶段权重不同（1.3x, 1.0x, 0.7x）
        // 平均约 1.0x
        defaultMemberTimeout = Math.floor(teamTotalTimeout / members.length);
        break;
      default:
        defaultMemberTimeout = Math.floor(teamTotalTimeout / members.length);
    }

    // 创建团队配置
    const teamConfig: TeamConfig = {
      name: teamName,
      members,
      strategy,
      goal,
      maxRounds,
      teamTotalTimeout,           // 🆕 团队总超时
      defaultMemberTimeout,       // 🆕 成员基准超时（会被策略权重调整）
      // memberTimeoutMs 不设置，让策略计算生效
    };

    try {
      // 创建团队管理器
      const teamManager = new TeamManager(
        this.mainProvider,
        this.registry,
        this.agentConfig,
        this.hookRegistry,
        this.memoryStore,
        this.currentDepth,
        this.agentRegistry,
        this.providerManager,
      );

      // 创建团队
      await teamManager.createTeam(teamConfig);

      // 执行团队任务
      const result = await teamManager.execute(goal, signal);

      // 格式化结果
      return this.formatResult(result, teamName, strategy);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return this.error(`Team execution failed: ${errMsg}`);
    }
  }

  /**
   * 格式化团队执行结果
   */
  private formatResult(
    result: import('@/core/agent/team/types').TeamExecutionResult,
    teamName: string,
    strategy: TeamStrategy,
  ): ToolResult {
    const meta = [
      `[Team "${teamName}" - Strategy: ${strategy}]`,
      `Duration: ${(result.duration / 1000).toFixed(1)}s`,
      `Rounds: ${result.rounds}`,
      `Members: ${result.memberResults.length}`,
      `Tokens: ${result.totalTokens.input} in / ${result.totalTokens.output} out`,
      result.timedOut ? '⚠️ Timed out' : '',
      result.success ? '✅ Success' : '❌ Failed',
    ].filter(Boolean).join(' | ');

    const memberSummary = result.memberResults
      .map(r => {
        const status = r.success ? '✅' : '❌';
        const duration = (r.duration / 1000).toFixed(1);
        return `${status} ${r.memberId}: ${duration}s, ${r.tokensUsed.input + r.tokensUsed.output} tokens`;
      })
      .join('\n');

    const content = [
      meta,
      '',
      '[Member Execution Summary]',
      memberSummary,
      '',
      '[Team Output]',
      result.output,
    ].join('\n');

    return this.success(content, {
      teamExecution: true,
      teamName,
      strategy,
      duration: result.duration,
      totalTokens: result.totalTokens,
      rounds: result.rounds,
      memberCount: result.memberResults.length,
      success: result.success,
      timedOut: result.timedOut,
    });
  }
}
