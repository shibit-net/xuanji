/**
 * DelegateTool — 委托专业 Agent 执行独立任务
 *
 * 将任务委托给专业 Agent（explore/plan/coder/自定义）在隔离环境中执行。
 *
 * 安全机制:
 * - DelegateTool 不在子代理中注册（防止无限递归）
 * - 最大嵌套深度 3 层
 * - 并发子代理数限制（默认 3）
 * - 超时自动终止（默认 5 分钟）
 */

import type { JSONSchema, ToolResult, AgentConfig, IToolRegistry } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import type { ProviderManager } from '@/core/providers/ProviderManager';
import type { AgentRegistry } from '@/core/agent/AgentRegistry';
import { BaseTool } from './BaseTool';
import { SubAgentContext, MAX_CONCURRENT_SUBAGENTS, type AgentRoleType, type IsolationMode } from '@/core/agent/SubAgentContext';
import { runSubAgent, type SubAgentResult } from '@/core/agent/SubAgentLoop';

export class DelegateTool extends BaseTool {
  readonly name = 'delegate';
  readonly description = [
    '委托给专业 Agent 执行独立任务。',
    '',
    '🎯 用户明确请求时优先使用:',
    '✓ "用 explore agent 分析代码结构"',
    '✓ "让 coder agent 修复这个 bug"',
    '✓ "用 plan agent 设计架构"',
    '',
    '🤖 系统自动判断时使用:',
    '✓ 需要特定专业能力（代码探索/架构设计/代码编写）',
    '✓ 需要隔离执行的复杂子任务（独立上下文）',
    '✓ 需要并行处理的独立任务（最多 3 个）',
    '',
    '📋 可用的专业 Agent:',
    '• explore - 代码探索（快速搜索、分析结构，只读）',
    '• plan - 架构设计（设计方案、评估选型，只读）',
    '• coder - 代码编写（写代码、修复 bug、重构）',
    '• general-purpose - 通用任务（其他需要隔离的任务）',
    '',
    '❌ 不要使用:',
    '✗ 简单任务自己就能完成',
    '✗ 需要与用户交互的任务（sub-agent 无法对话）',
    '✗ 已经在 sub-agent 内部（防止递归）',
    '',
    '⚙️ 限制:',
    '- Sub-agent 不能创建新的 sub-agent（最大嵌套 3 层）',
    '- 最多 3 个并发 sub-agent',
    '- 默认超时 5 分钟',
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
        description: [
          'Agent ID to use (supports custom agents from AgentRegistry):',
          '',
          '内置 Agent:',
          '• general-purpose - 通用任务（默认）',
          '• explore - 代码探索（快速搜索、分析结构，只读）',
          '• plan - 架构设计（设计方案、评估选型，只读）',
          '• coder - 代码编写（写代码、修复 bug、重构）',
          '',
          '自定义 Agent:',
          '• 任意在 ~/.xuanji/agents/ 或 .xuanji/agents/ 中定义的 Agent ID',
          '• 要求：metadata.isSubAgent = true',
          '',
          '示例:',
          '• "explore" - 使用内置探索 Agent',
          '• "stock-analyst" - 使用自定义股票分析 Agent',
          '• "doc-generator" - 使用自定义文档生成 Agent',
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
  private providerManager: ProviderManager | null = null;
  private agentRegistry: AgentRegistry | null = null;
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
    providerManager: ProviderManager;
    agentRegistry: AgentRegistry;
    registry: IToolRegistry;
    agentConfig: AgentConfig;
    hookRegistry?: HookRegistry | null;
    memoryStore?: IMemoryStore | null;
    depth?: number;
  }): void {
    this.providerManager = deps.providerManager;
    this.agentRegistry = deps.agentRegistry;
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
    if (!this.providerManager || !this.agentRegistry || !this.registry || !this.agentConfig) {
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
        this.providerManager,
        this.agentRegistry,
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
