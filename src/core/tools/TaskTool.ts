/**
 * TaskTool — 启动子代理执行独立任务
 *
 * LLM 可通过此工具将复杂任务分解为独立子任务，
 * 每个子任务在隔离的 SubAgentLoop 中执行。
 *
 * 安全机制:
 * - TaskTool 不在子代理中注册（防止无限递归）
 * - 最大嵌套深度 3 层
 * - 并发子代理数限制（默认 3）
 * - 超时自动终止（默认 5 分钟）
 */

import type { JSONSchema, ToolResult, AgentConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import { BaseTool } from './BaseTool';
import { SubAgentContext, MAX_CONCURRENT_SUBAGENTS, type AgentRoleType, type IsolationMode } from '@/core/agent/SubAgentContext';
import type { SubAgentResult } from '@/core/agent/SubAgentLoop';
import { SubAgentFactory } from '@/core/agent/SubAgentFactory';

export class TaskTool extends BaseTool {
  readonly name = 'task';
  readonly description = [
    'Launch a sub-agent to handle a specific task independently.',
    'Use this tool to delegate complex sub-tasks, parallel research, or isolated operations.',
    'Each sub-agent has its own isolated context — it does NOT share conversation history with the parent.',
    '',
    '⚡ BEST PRACTICE - Choose the Right Agent:',
    '1. BEFORE calling task, call match_agent to find the best preset agent for this task',
    '2. Use the matched agent ID as subagent_type parameter',
    '3. This ensures you use specialized agents (coder, explore, etc.) instead of generic ones',
    '',
    'Example workflow:',
    '  match_agent({ task_description: "analyze code quality" })',
    '  → Found: coder (85% match)',
    '  task({ description: "...", subagent_type: "coder" })',
    '',
    'IMPORTANT: The sub-agent only knows what you put in "description".',
    'You must distill all necessary context into the description yourself:',
    '- Relevant findings from the current conversation',
    '- Constraints, file paths, or decisions already made',
    '- Expected output format',
    'Do NOT assume the sub-agent has any background knowledge from the parent session.',
    '',
    'When to use:',
    '- Breaking down complex tasks into independent subtasks',
    '- Performing multiple searches or analyses in parallel',
    '- Isolating potentially risky operations',
    '',
    'Limitations:',
    '- Sub-agents cannot create further sub-agents (no recursion)',
    '- Maximum 3 concurrent sub-agents',
    '- Default timeout: 5 minutes per sub-agent',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: [
          'The complete task description for the sub-agent.',
          'The sub-agent has NO access to the parent conversation history.',
          'You MUST include all necessary context inline: relevant findings, constraints, file paths, decisions, and expected output format.',
          'Think of this as writing a self-contained brief — everything the sub-agent needs to succeed must be here.',
        ].join('\n'),
      },
      subagent_type: {
        type: 'string',
        description: [
          'Agent ID to use for this task.',
          'RECOMMENDED WORKFLOW: Before setting this, call match_agent or list_agents to find the best preset agent.',
          '- If match_agent returns a good match (score >= 0.5): set subagent_type to that agent\'s ID',
          '- If no good match: omit subagent_type and use system_prompt + tools instead',
          'Common preset agents: general-purpose, explore, plan, coder, test-writer, doc-writer',
        ].join('\n'),
      },
      isolation: {
        type: 'string',
        enum: ['none', 'worktree'],
        description: 'Isolation mode. "worktree" creates a temporary git worktree for isolated work. Default: "none".',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds. Default: 300000 (5 minutes).',
      },
      system_prompt: {
        type: 'string',
        description: [
          'Custom system prompt for the sub-agent.',
          'Overrides the preset agent config systemPrompt when provided.',
          'Use this when no preset config matches and you want to define the agent\'s behavior dynamically.',
        ].join('\n'),
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: [
          'List of tool names the sub-agent is allowed to use.',
          'Overrides the preset agent config tools when provided.',
          'Available tools: read_file, write_file, edit_file, bash, grep, glob, task (sub-agents cannot use task).',
          'Use this when no preset config matches and you want to restrict or expand the agent\'s tool access.',
        ].join('\n'),
      },
    },
    required: ['description'],
  };

  readonly readonly = true; // 可并行执行

  // 依赖注入
  private providerManager: import('@/core/providers/ProviderManager').ProviderManager | null = null;
  private agentRegistry: import('@/core/agent/AgentRegistry').AgentRegistry | null = null;
  private registry: IToolRegistry | null = null;
  private agentConfig: AgentConfig | null = null;
  private hookRegistry: HookRegistry | null = null;
  private memoryStore: IMemoryStore | null = null;
  private currentDepth = 0;
  private parentProvider: ILLMProvider | null = null; // 父 Provider
  private currentAgentId: string = 'main'; // 🔧 当前 Agent ID

  /** SubAgentFactory 实例 */
  private subAgentFactory: SubAgentFactory | null = null;

  /** 当前活跃的子代理数 */
  private activeCount = 0;

  /**
   * 注入运行时依赖（由 ChatSession 调用）
   */
  setDependencies(deps: {
    providerManager: import('@/core/providers/ProviderManager').ProviderManager;
    agentRegistry: import('@/core/agent/AgentRegistry').AgentRegistry;
    registry: IToolRegistry;
    agentConfig: AgentConfig;
    parentProvider?: ILLMProvider; // 可选：父 Provider（用于继承）
    hookRegistry?: HookRegistry | null;
    memoryStore?: IMemoryStore | null;
    depth?: number;
    agentId?: string; // 🔧 当前 Agent ID
  }): void {
    this.providerManager = deps.providerManager;
    this.agentRegistry = deps.agentRegistry;
    this.registry = deps.registry;
    this.agentConfig = deps.agentConfig;
    this.parentProvider = deps.parentProvider ?? null; // 保存父 Provider
    this.hookRegistry = deps.hookRegistry ?? null;
    this.memoryStore = deps.memoryStore ?? null;
    this.currentDepth = deps.depth ?? 0;
    this.currentAgentId = deps.agentId ?? 'main'; // 🔧 保存当前 Agent ID

    // 创建 SubAgentFactory 实例
    this.subAgentFactory = new SubAgentFactory(
      this.agentRegistry,
      this.providerManager,
      this.registry,
      this.hookRegistry,
      this.memoryStore,
      this.parentProvider,  // 传递父 provider
    );
  }

  async execute(input: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    const description = input.description as string;
    const timeout = input.timeout as number | undefined;
    let role = (input.subagent_type as AgentRoleType) ?? null;
    const isolation = (input.isolation as IsolationMode) ?? 'none';
    const systemPrompt = input.system_prompt as string | undefined;
    const tools = input.tools as string[] | undefined;

    // 验证依赖已注入
    if (!this.subAgentFactory) {
      console.error('[TaskTool] subAgentFactory is null/undefined');
      return this.error(
        'TaskTool not initialized. Internal error: subAgentFactory not injected.',
      );
    }

    if (!this.agentConfig) {
      console.error('[TaskTool] agentConfig is null/undefined');
      return this.error(
        'TaskTool not initialized. Internal error: agentConfig not injected.',
      );
    }

    console.log('[TaskTool] execute() called, subAgentFactory:', !!this.subAgentFactory, 'agentConfig:', !!this.agentConfig);

    // ✅ 智能匹配：如果没有指定 subagent_type，尝试自动匹配最佳内置 Agent
    if (!role && this.agentRegistry) {
      role = await this.autoMatchAgent(description);
      if (role && role !== 'general-purpose') {
        console.log(`[TaskTool] Auto-matched agent: ${role} for task: ${description.substring(0, 100)}`);
      }
    }

    // 如果仍然没有匹配到，使用默认的 general-purpose
    if (!role) {
      role = 'general-purpose';
    }

    // 深度检查（在调用 SubAgentFactory 之前，避免 agentRegistry 查找失败掩盖深度错误）
    const depthCtx = new SubAgentContext({ task: description, depth: this.currentDepth + 1 });
    if (depthCtx.isDepthExceeded()) {
      return this.error(
        `Maximum nesting depth exceeded (depth=${this.currentDepth + 1}). Sub-agents cannot create further sub-agents beyond the limit.`,
      );
    }

    // 并发限制
    if (this.activeCount >= MAX_CONCURRENT_SUBAGENTS) {
      return this.error(
        `Maximum concurrent sub-agents (${MAX_CONCURRENT_SUBAGENTS}) reached. Wait for current tasks to complete.`,
      );
    }

    // 执行子代理（使用统一架构）
    this.activeCount++;
    try {
      const result = await this.subAgentFactory.createAndRun(role, {
        task: description,
        timeout,
        depth: this.currentDepth + 1,
        isolation,
        parentConfig: this.agentConfig,
        systemPrompt,
        tools,
        parentAgentId: this.currentAgentId, // 🔧 传递父 Agent ID
      }, signal); // 🔧 传递 AbortSignal

      return this.formatResult(result);
    } finally {
      this.activeCount--;
    }
  }

  /**
   * 获取当前活跃子代理数
   */
  getActiveCount(): number {
    return this.activeCount;
  }

  // ─── 私有方法 ─────────────────────────────────────────

  /**
   * 自动匹配最佳 Agent
   * 根据任务描述，使用简单的关键词匹配来选择最合适的内置 Agent
   */
  private async autoMatchAgent(taskDescription: string): Promise<AgentRoleType> {
    if (!this.agentRegistry) {
      return 'general-purpose';
    }

    const lowerTask = taskDescription.toLowerCase();
    console.log('[TaskTool] autoMatchAgent - 任务描述:', taskDescription);
    console.log('[TaskTool] autoMatchAgent - 小写任务描述:', lowerTask);

    // 定义关键词映射（优先级从高到低）
    const agentKeywords: Array<{ agent: AgentRoleType; keywords: string[]; priority: number }> = [
      {
        agent: 'coder',
        keywords: ['代码', 'code', '编程', 'program', '实现', 'implement', '修复', 'fix', '重构', 'refactor', '函数', 'function', '类', 'class', '方法', 'method', 'bug', '优化', 'optimize'],
        priority: 10,
      },
      {
        agent: 'test-writer',
        keywords: ['测试', 'test', '单元测试', 'unit test', '集成测试', 'integration test', 'jest', 'vitest', 'pytest'],
        priority: 9,
      },
      {
        agent: 'explore',
        keywords: ['探索', 'explore', '查找', 'find', '搜索', 'search', '分析', 'analyze', '理解', 'understand', '调研', 'research'],
        priority: 8,
      },
      {
        agent: 'doc-writer',
        keywords: ['文档', 'document', 'doc', '注释', 'comment', '说明', 'readme', 'api文档', 'api doc'],
        priority: 7,
      },
      {
        agent: 'plan',
        keywords: ['计划', 'plan', '设计', 'design', '架构', 'architecture', '方案', 'solution', '策略', 'strategy'],
        priority: 6,
      },
    ];

    // 计算每个 Agent 的匹配分数
    let bestMatch: { agent: AgentRoleType; score: number } | null = null;

    for (const { agent, keywords, priority } of agentKeywords) {
      // 检查 Agent 是否存在且启用
      const agentConfig = this.agentRegistry.get(agent);
      if (!agentConfig || agentConfig.enabled === false) {
        console.log(`[TaskTool] autoMatchAgent - Agent ${agent} 不存在或未启用`);
        continue;
      }

      // 计算关键词匹配数
      let matchCount = 0;
      const matchedKeywords: string[] = [];
      for (const keyword of keywords) {
        if (lowerTask.includes(keyword)) {
          matchCount++;
          matchedKeywords.push(keyword);
        }
      }

      if (matchCount > 0) {
        // 分数 = 匹配数 * 优先级
        const score = matchCount * priority;
        console.log(`[TaskTool] autoMatchAgent - Agent ${agent}: 匹配 ${matchCount} 个关键词 [${matchedKeywords.join(', ')}], 分数 ${score}`);
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { agent, score };
        }
      }
    }

    // 如果找到匹配且分数足够高（至少匹配1个关键词），返回该 Agent
    if (bestMatch && bestMatch.score >= 5) {
      console.log(`[TaskTool] autoMatchAgent - 最佳匹配: ${bestMatch.agent} (分数: ${bestMatch.score})`);
      return bestMatch.agent;
    }

    // 否则返回 general-purpose
    console.log('[TaskTool] autoMatchAgent - 没有找到合适的匹配，使用 general-purpose');
    return 'general-purpose';
  }

  /**
   * 格式化子代理执行结果
   */
  private formatResult(result: SubAgentResult): ToolResult {
    const meta = [
      `[Sub-agent completed]`,
      `Duration: ${(result.duration / 1000).toFixed(1)}s`,
      `Iterations: ${result.iterations}`,
      `Tokens: ${result.tokensUsed.input} in / ${result.tokensUsed.output} out`,
      result.timedOut ? '⚠️ Timed out' : '',
    ].filter(Boolean).join(' | ');

    const content = `${meta}\n\n${result.result}`;

    return this.success(content, {
      subAgent: true,
      duration: result.duration,
      tokensUsed: result.tokensUsed,
      timedOut: result.timedOut,
      iterations: result.iterations,
    });
  }
}
