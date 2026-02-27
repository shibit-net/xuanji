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
import { runSubAgent, type SubAgentResult } from '@/core/agent/SubAgentLoop';

export class TaskTool extends BaseTool {
  readonly name = 'task';
  readonly description = [
    'Launch a sub-agent to handle a specific task independently.',
    'Use this tool to delegate complex sub-tasks, parallel research, or isolated operations.',
    'Each sub-agent has its own context and does not share conversation history with the parent.',
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
        description: 'A clear, specific task description for the sub-agent to execute.',
      },
      subagent_type: {
        type: 'string',
        enum: ['general-purpose', 'explore', 'plan', 'coder'],
        description: [
          'Type of sub-agent to use:',
          '- general-purpose: General tasks (default)',
          '- explore: Fast codebase exploration (read-only tools)',
          '- plan: Architecture design (read-only tools)',
          '- coder: Code writing and editing',
        ].join('\n'),
      },
      include_parent_context: {
        type: 'boolean',
        description: 'Whether to pass a summary of the current conversation to the sub-agent. Default: false.',
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
    },
    required: ['description'],
  };

  readonly readonly = true; // 可并行执行

  // 依赖注入
  private provider: ILLMProvider | null = null;
  private registry: IToolRegistry | null = null;
  private agentConfig: AgentConfig | null = null;
  private hookRegistry: HookRegistry | null = null;
  private memoryStore: IMemoryStore | null = null;
  private currentDepth = 0;

  /** 当前活跃的子代理数 */
  private activeCount = 0;

  /**
   * 注入运行时依赖（由 ChatSession 调用）
   */
  setDependencies(deps: {
    provider: ILLMProvider;
    registry: IToolRegistry;
    agentConfig: AgentConfig;
    hookRegistry?: HookRegistry | null;
    memoryStore?: IMemoryStore | null;
    depth?: number;
  }): void {
    this.provider = deps.provider;
    this.registry = deps.registry;
    this.agentConfig = deps.agentConfig;
    this.hookRegistry = deps.hookRegistry ?? null;
    this.memoryStore = deps.memoryStore ?? null;
    this.currentDepth = deps.depth ?? 0;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const description = input.description as string;
    const includeParentContext = (input.include_parent_context as boolean) ?? false;
    const timeout = input.timeout as number | undefined;
    const role = (input.subagent_type as AgentRoleType) ?? 'general-purpose';
    const isolation = (input.isolation as IsolationMode) ?? 'none';

    // 验证依赖已注入
    if (!this.provider || !this.registry || !this.agentConfig) {
      return this.error(
        'TaskTool not initialized. Internal error: dependencies not injected.',
      );
    }

    // 并发限制
    if (this.activeCount >= MAX_CONCURRENT_SUBAGENTS) {
      return this.error(
        `Maximum concurrent sub-agents (${MAX_CONCURRENT_SUBAGENTS}) reached. Wait for current tasks to complete.`,
      );
    }

    // 创建子代理上下文
    const context = new SubAgentContext({
      task: description,
      parentContext: includeParentContext ? this.getParentContextSummary() : undefined,
      timeout,
      depth: this.currentDepth + 1,
      role,
      isolation,
    });

    // 深度检查
    if (context.isDepthExceeded()) {
      return this.error(
        `Maximum nesting depth exceeded. Sub-agents cannot create further sub-agents.`,
      );
    }

    // 执行子代理
    this.activeCount++;
    try {
      const result = await runSubAgent(
        this.provider,
        this.registry,
        this.agentConfig,
        context,
        this.hookRegistry,
        this.memoryStore,
      );

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
   * 生成父代理上下文摘要（简化版，避免 token 膨胀）
   */
  private getParentContextSummary(): string {
    // 目前返回简单说明，后续可扩展为从 MessageManager 提取摘要
    return 'The parent agent is working on a complex task and has delegated this sub-task to you.';
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
