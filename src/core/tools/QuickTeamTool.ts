/**
 * QuickTeamTool — 快捷团队工具
 * 
 * 使用预定义模板快速创建常用团队，无需手动配置成员
 */

import type { JSONSchema, ToolResult, AgentConfig, ILLMProvider, IToolRegistry } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import { BaseTool } from './BaseTool';
import { TeamManager } from '@/core/agent/team/TeamManager';
import { getTeamTemplate, getAvailableTemplates, recommendTemplate } from '@/core/agent/team/templates';
import type { TeamConfig } from '@/core/agent/team/types';

export class QuickTeamTool extends BaseTool {
  readonly name = 'quick_team';
  readonly description = [
    '🚀 Quickly create a team using predefined templates (simpler than agent_team).',
    '',
    'Use this when you need a common team pattern:',
    '',
    'Available templates:',
    '• code-review: Sequential review (architecture→security→performance)',
    '  Example: "Review src/auth.ts for code quality"',
    '',
    '• research: Parallel search from docs, code examples, and community',
    '  Example: "Research React Server Components best practices"',
    '',
    '• architecture-debate: Debate design with 3 perspectives (simplicity vs scalability vs pragmatic)',
    '  Example: "Design a caching strategy for our API"',
    '',
    '• data-pipeline: Extract→Clean→Analyze→Report workflow',
    '  Example: "Process all TODO comments and generate priority report"',
    '',
    '• feature-development: Hierarchical (tech lead→backend/frontend/qa)',
    '  Example: "Implement user authentication feature"',
    '',
    '💡 This is MUCH simpler than agent_team - just pick a template and provide the goal!',
    'For custom teams with specific members, use agent_team instead.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      template: {
        type: 'string',
        enum: ['code-review', 'research', 'architecture-debate', 'data-pipeline', 'feature-development'],
        description: 'Which predefined team template to use',
      },
      goal: {
        type: 'string',
        description: 'What the team should accomplish (e.g., "Review auth.ts", "Research GraphQL best practices")',
      },
      target: {
        type: 'string',
        description: 'Optional: specific file, module, or topic to focus on',
      },
      max_rounds: {
        type: 'number',
        description: 'Maximum rounds for debate strategy (default: 3)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 600000 = 10 minutes)',
      },
    },
    required: ['template', 'goal'],
  };

  readonly readonly = false;

  // 依赖注入
  private mainProvider: ILLMProvider | null = null;
  private lightProvider: ILLMProvider | null = null;
  private registry: IToolRegistry | null = null;
  private agentConfig: AgentConfig | null = null;
  private hookRegistry: HookRegistry | null = null;
  private memoryStore: IMemoryStore | null = null;
  private currentDepth = 0;

  setDependencies(deps: {
    provider: ILLMProvider;
    lightProvider: ILLMProvider;
    registry: IToolRegistry;
    agentConfig: AgentConfig;
    hookRegistry?: HookRegistry | null;
    memoryStore?: IMemoryStore | null;
    depth?: number;
  }): void {
    this.mainProvider = deps.provider;
    this.lightProvider = deps.lightProvider;
    this.registry = deps.registry;
    this.agentConfig = deps.agentConfig;
    this.hookRegistry = deps.hookRegistry ?? null;
    this.memoryStore = deps.memoryStore ?? null;
    this.currentDepth = deps.depth ?? 0;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    // 验证依赖
    if (!this.mainProvider || !this.lightProvider || !this.registry || !this.agentConfig) {
      return this.error('QuickTeamTool not initialized. Internal error: dependencies not injected.');
    }

    const templateId = input.template as string;
    const goal = input.goal as string;
    const target = input.target as string | undefined;
    const maxRounds = input.max_rounds as number | undefined;
    const timeout = input.timeout as number | undefined;

    // 获取模板
    const template = getTeamTemplate(templateId);
    if (!template) {
      const available = getAvailableTemplates().join(', ');
      return this.error(`Unknown template: ${templateId}. Available templates: ${available}`);
    }

    // 构建团队配置
    const members = template.members({ target });
    const teamConfig: TeamConfig = {
      name: template.name,
      members,
      strategy: template.recommendedStrategy,
      goal,
      maxRounds: maxRounds ?? (template.recommendedStrategy === 'debate' ? 3 : 10),
      timeout,
    };

    try {
      // 创建团队管理器
      const teamManager = new TeamManager(
        this.mainProvider,
        this.lightProvider,
        this.registry,
        this.agentConfig,
        this.hookRegistry,
        this.memoryStore,
        this.currentDepth,
      );

      // 创建团队
      await teamManager.createTeam(teamConfig);

      // 执行任务
      const result = await teamManager.execute(goal);

      // 格式化结果
      return this.formatResult(result, template);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return this.error(`Team execution failed: ${errMsg}`);
    }
  }

  private formatResult(
    result: import('@/core/agent/team/types').TeamExecutionResult,
    template: import('@/core/agent/team/templates').TeamTemplate,
  ): ToolResult {
    const meta = [
      `[Quick Team: ${template.name}]`,
      `Strategy: ${template.recommendedStrategy}`,
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
      quickTeam: true,
      template: template.id,
      strategy: template.recommendedStrategy,
      duration: result.duration,
      totalTokens: result.totalTokens,
      rounds: result.rounds,
      memberCount: result.memberResults.length,
      success: result.success,
      timedOut: result.timedOut,
    });
  }
}
