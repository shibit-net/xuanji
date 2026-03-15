/**
 * PipelineTool — Agent 流水线工具
 *
 * 定义 Agent 流水线，自动顺序执行，上游输出传递给下游输入。
 * 适合数据处理流程（提取→清洗→分析→报告）。
 */

import type { JSONSchema, ToolResult, AgentConfig, IToolRegistry } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { HookRegistry } from '@/hooks/HookRegistry';
import type { ProviderManager } from '@/core/providers/ProviderManager';
import type { AgentRegistry } from '@/core/agent/AgentRegistry';
import { BaseTool } from './BaseTool';
import { SubAgentContext } from '@/core/agent/SubAgentContext';
import { runSubAgent, type SubAgentResult } from '@/core/agent/SubAgentLoop';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'PipelineTool' });

interface ChainStep {
  agent_id: string;
  task_template: string;
  description?: string;
  timeout?: number;
}

export class PipelineTool extends BaseTool {
  readonly name = 'pipeline';
  readonly description = [
    '顺序执行 Agent 链，上游输出自动传递给下游输入。',
    '',
    '🎯 适用场景:',
    '✓ 数据流水线（提取 → 清洗 → 分析 → 报告）',
    '✓ 多阶段处理（需要前一步的结果）',
    '✓ 简化工作流编排（避免多次手动协调）',
    '',
    '💡 使用方法:',
    '• 在 task_template 中使用 {{previous_output}} 引用上游结果',
    '• 链中至少 2 步（建议 2-4 步）',
    '• 每步可以使用不同的 agent_id (explore/plan/coder/等)',
    '',
    '📋 示例链:',
    '1. data-extractor (explore): 提取原始数据',
    '2. data-cleaner (coder): 清洗 {{previous_output}}',
    '3. data-analyzer (coder): 分析 {{previous_output}}',
    '4. report-generator (coder): 从 {{previous_output}} 生成报告',
    '',
    '✨ 优势:',
    '✓ 单次工具调用（无需多次迭代）',
    '✓ 自动传递上下文',
    '✓ 清晰的执行顺序',
    '✓ 内置错误处理',
    '',
    '❌ 不要使用:',
    '✗ 步骤之间不需要传递数据 → 用 agent_team (strategy=sequential)',
    '✗ 需要并行执行 → 用 agent_team (strategy=parallel)',
    '✗ 单个步骤就能完成 → 用 task 工具',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      chain: {
        type: 'array',
        description: 'Array of chain steps, executed in order (minimum 2 steps recommended)',
        items: {
          type: 'object',
          properties: {
            agent_id: {
              type: 'string',
              description: 'Agent ID to use for this step (e.g., "explore", "coder", "stock-analyst")',
            },
            task_template: {
              type: 'string',
              description: 'Task description. Use {{previous_output}} to insert the previous step\'s result.',
            },
            description: {
              type: 'string',
              description: 'Optional: Human-readable description of what this step does',
            },
            timeout: {
              type: 'number',
              description: 'Optional: Timeout for this step in milliseconds (default: 300000)',
            },
          },
          required: ['agent_id', 'task_template'],
        },
      },
      initial_input: {
        type: 'string',
        description: 'Initial input for the first agent in the chain (optional, defaults to first agent\'s task_template)',
      },
    },
    required: ['chain'],
  };

  readonly readonly = false; // Chain may involve write operations

  // 依赖注入
  private providerManager: ProviderManager | null = null;
  private agentRegistry: AgentRegistry | null = null;
  private registry: IToolRegistry | null = null;
  private agentConfig: AgentConfig | null = null;
  private hookRegistry: HookRegistry | null = null;
  private memoryStore: IMemoryStore | null = null;
  private currentDepth = 0;

  /**
   * 注入运行时依赖
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
    // 验证依赖
    if (!this.providerManager || !this.agentRegistry || !this.registry || !this.agentConfig) {
      return this.error('PipelineTool not initialized. Internal error: dependencies not injected.');
    }

    const chain = input.chain as ChainStep[];
    const initialInput = (input.initial_input as string) || null;

    if (!chain || chain.length < 2) {
      return this.error('Chain must have at least 2 steps');
    }

    const results: Array<{
      step: number;
      agent_id: string;
      description?: string;
      input: string;
      output: string;
      success: boolean;
      duration: number;
      error?: string;
    }> = [];

    let previousOutput = initialInput;

    log.info(`Starting agent chain with ${chain.length} steps`);

    for (let i = 0; i < chain.length; i++) {
      const step = chain[i];
      const stepNumber = i + 1;

      // 替换模板变量
      let taskDescription = step.task_template;
      if (previousOutput !== null) {
        taskDescription = taskDescription.replace(/\{\{previous_output\}\}/g, previousOutput);
      }

      log.info(`Chain step ${stepNumber}/${chain.length}: ${step.agent_id}`);

      const startTime = Date.now();

      try {
        // 从 AgentRegistry 获取 Agent 配置（如果可用）
        // TODO: 待 P1 SubAgent 和 AgentRegistry 合并后，传入 agentProfile
        const agentProfile = this.agentRegistry?.get(step.agent_id);

        // 创建 SubAgentContext
        const context = new SubAgentContext({
          task: taskDescription,
          timeout: step.timeout,
          depth: this.currentDepth + 1,
          role: step.agent_id as any, // 暂时使用 agent_id 作为 role
        });

        // 执行 SubAgent
        const result = await runSubAgent(
          this.providerManager,
          this.agentRegistry,
          this.registry,
          this.agentConfig,
          context,
          this.hookRegistry,
          this.memoryStore,
        );

        const duration = Date.now() - startTime;

        if (result.timedOut) {
          results.push({
            step: stepNumber,
            agent_id: step.agent_id,
            description: step.description,
            input: taskDescription,
            output: '',
            success: false,
            duration,
            error: 'Timeout',
          });

          return this.error(
            `Chain failed at step ${stepNumber} (${step.agent_id}): Timeout\n\n` +
            this.formatChainResults(results)
          );
        }

        // 记录结果
        results.push({
          step: stepNumber,
          agent_id: step.agent_id,
          description: step.description,
          input: taskDescription,
          output: result.result,
          success: true,
          duration,
        });

        // 传递给下一步
        previousOutput = result.result;

        log.info(`Chain step ${stepNumber} completed in ${duration}ms`);

      } catch (error) {
        const duration = Date.now() - startTime;
        const errMsg = error instanceof Error ? error.message : String(error);

        results.push({
          step: stepNumber,
          agent_id: step.agent_id,
          description: step.description,
          input: taskDescription,
          output: '',
          success: false,
          duration,
          error: errMsg,
        });

        return this.error(
          `Chain failed at step ${stepNumber} (${step.agent_id}): ${errMsg}\n\n` +
          this.formatChainResults(results)
        );
      }
    }

    // 所有步骤成功
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    const finalOutput = previousOutput!;

    return this.success(
      `[Agent Chain Completed]\n\n` +
      `Total steps: ${chain.length}\n` +
      `Total duration: ${(totalDuration / 1000).toFixed(1)}s\n\n` +
      `${this.formatChainResults(results)}\n\n` +
      `${'='.repeat(50)}\n\n` +
      `Final output:\n${finalOutput}`
    );
  }

  /**
   * 格式化链式执行结果
   */
  private formatChainResults(results: Array<{
    step: number;
    agent_id: string;
    description?: string;
    input: string;
    output: string;
    success: boolean;
    duration: number;
    error?: string;
  }>): string {
    return results
      .map(r => {
        const status = r.success ? '✓' : '✗';
        const title = r.description || r.agent_id;
        const duration = (r.duration / 1000).toFixed(1);

        return [
          `[Step ${r.step}] ${status} ${title} (${duration}s)`,
          `Agent: ${r.agent_id}`,
          r.error ? `Error: ${r.error}` : `Output: ${r.output.substring(0, 200)}${r.output.length > 200 ? '...' : ''}`,
        ].join('\n');
      })
      .join('\n\n---\n\n');
  }
}
