/**
 * ============================================================
 * Multi-Agent System - OrchestratorAgent
 * ============================================================
 * 管家 Agent，负责分析用户意图并委派给合适的 Worker Agent
 */

import type { AgentRegistry } from './AgentRegistry';
import type { ConfigurableAgentConfig, AgentDelegation, AgentContext } from './types';
import { ConfigurableWorkerAgent } from './ConfigurableWorkerAgent';
import { ExecutionPlanner } from './ExecutionPlanner';
import type { ILLMProvider } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { SkillRegistry } from '@/core/skills/registry';
import type { IToolRegistry } from '@/core/types';
import type { ExecutionPlan, TaskComplexity } from '@/core/routing/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'orchestrator-agent' });

/**
 * Orchestrator Agent（管家 Agent）
 *
 * 职责：
 * 1. 接收用户意图
 * 2. 从全局记忆库检索上下文
 * 3. 调用 LLM 分析意图，选择合适的 Worker Agent
 * 4. 生成执行计划（复杂任务）
 * 5. 委派任务并传递上下文
 * 6. 汇总结果返回用户
 */
export class OrchestratorAgent {
  // Worker Agent 缓存
  private workerAgents = new Map<string, ConfigurableWorkerAgent>();

  // 执行计划生成器
  private planner: ExecutionPlanner;

  constructor(
    private provider: ILLMProvider,
    private agentRegistry: AgentRegistry,
    private memoryManager: IMemoryStore,
    private globalSkillRegistry: SkillRegistry,
    private globalToolRegistry: IToolRegistry,
  ) {
    this.planner = new ExecutionPlanner(provider, agentRegistry);
  }

  /**
   * 分析用户意图并选择 Agent
   */
  async analyze(userMessage: string): Promise<AgentDelegation> {
    log.info(`🧐 分析用户意图: "${userMessage.slice(0, 100)}..."`);

    // 1. 获取所有启用的 Agent
    const enabledAgents = this.agentRegistry.getEnabled();

    if (enabledAgents.length === 0) {
      throw new Error('没有可用的 Worker Agent');
    }

    // 2. 检索全局记忆（获取上下文信息）
    const memories = await this.memoryManager.retrieve(userMessage, {
      types: ['user_preference', 'project_fact', 'user_fact', 'relationship'],
      maxResults: 5,
      minConfidence: 0.6,
    });

    log.debug(`  📚 检索到 ${memories.length} 条记忆`);

    // 3. 构建系统提示词
    const systemPrompt = this.buildAnalysisPrompt(enabledAgents, memories);

    // 4. 调用 LLM 分析
    const messages: import('@/core/types').Message[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: userMessage,
      },
    ];

    try {
      const stream = this.provider.stream(messages, [], {
        model: this.provider.name,
        maxTokens: 2000,
      });

      // 收集所有文本
      let text = '';
      for await (const event of stream) {
        if (event.type === 'text_delta' && event.text) {
          text += event.text;
        }
      }

      // 5. 解析委派决策
      const delegation = this.parseDelegation(text);

      // 6. 验证 Agent 是否存在
      if (!this.agentRegistry.get(delegation.agentId)) {
        throw new Error(`Agent 不存在: ${delegation.agentId}`);
      }

      log.info(`  ✅ 选择 Agent: ${delegation.agentId}`);
      log.debug(`  理由: ${delegation.reasoning}`);

      return delegation;
    } catch (error) {
      log.error('❌ 意图分析失败:', error);

      // 降级：选择第一个可用的 Agent
      const fallbackAgent = enabledAgents[0];
      log.warn(`  ⚠️  降级到默认 Agent: ${fallbackAgent.id}`);

      return {
        reasoning: '意图分析失败，使用默认 Agent',
        agentId: fallbackAgent.id,
        context: {
          task: userMessage,
        },
        collaborative: false,
      };
    }
  }

  /**
   * 委派任务给 Worker Agent
   */
  async delegate(delegation: AgentDelegation): Promise<string> {
    const { agentId, context } = delegation;

    log.info(`📤 委派任务给 Agent: ${agentId}`);

    // 1. 获取或创建 Worker Agent
    let workerAgent = this.workerAgents.get(agentId);

    if (!workerAgent) {
      const agentConfig = this.agentRegistry.get(agentId);
      if (!agentConfig) {
        throw new Error(`Agent 配置不存在: ${agentId}`);
      }

      workerAgent = new ConfigurableWorkerAgent(
        agentConfig,
        this.globalSkillRegistry,
        this.globalToolRegistry,
        this.provider,
      );

      await workerAgent.init();

      // 缓存 Worker Agent
      this.workerAgents.set(agentId, workerAgent);
    }

    // 2. 执行任务
    const result = await workerAgent.run(context);

    log.info(`✅ 任务完成`);

    return result;
  }

  /**
   * 生成执行计划
   *
   * @param userTask 用户任务
   * @param complexity 任务复杂度（可选）
   * @returns 执行计划
   */
  async generatePlan(
    userTask: string,
    complexity?: TaskComplexity,
  ): Promise<ExecutionPlan> {
    log.info(`📋 生成执行计划: "${userTask.slice(0, 100)}..."`);

    const plan = await this.planner.generatePlan(userTask, complexity);

    // 验证计划
    const validation = this.planner.validatePlan(plan);
    if (!validation.valid) {
      log.warn('⚠️  执行计划验证失败', validation.errors);
      throw new Error(`执行计划无效: ${validation.errors.join(', ')}`);
    }

    log.info(`✅ 执行计划生成完成: ${plan.steps.length} 个步骤`);

    return plan;
  }

  /**
   * 执行计划
   *
   * @param plan 执行计划
   * @param onStepComplete 步骤完成回调（可选）
   * @returns 执行结果
   */
  async executePlan(
    plan: ExecutionPlan,
    onStepComplete?: (step: number, result: string) => void,
  ): Promise<string> {
    log.info(`▶️  开始执行计划: ${plan.taskId}`);

    const results: { [step: number]: string } = {};

    try {
      // 按顺序执行步骤
      for (const step of plan.steps) {
        log.info(`  步骤 ${step.order}: ${step.description}`);

        // 检查依赖是否完成
        if (step.dependsOn && step.dependsOn.length > 0) {
          for (const dep of step.dependsOn) {
            if (!results[dep]) {
              throw new Error(`步骤 ${step.order} 依赖的步骤 ${dep} 未完成`);
            }
          }
        }

        // 执行步骤
        let result: string;

        if (step.agentId) {
          // 使用 Agent 执行
          const delegation: AgentDelegation = {
            reasoning: `执行计划步骤 ${step.order}`,
            agentId: step.agentId,
            context: {
              task: step.description,
              // 注入前置步骤的结果
              previousResults: step.dependsOn?.map(dep => ({
                step: dep,
                result: results[dep],
              })),
            },
            collaborative: false,
          };

          result = await this.delegate(delegation);
        } else {
          // 无需 Agent，直接标记为完成
          result = `步骤完成: ${step.description}`;
        }

        // 保存结果
        results[step.order] = result;

        log.info(`  ✅ 步骤 ${step.order} 完成`);

        // 调用回调
        if (onStepComplete) {
          onStepComplete(step.order, result);
        }
      }

      log.info(`✅ 计划执行完成: ${plan.taskId}`);

      // 汇总所有结果
      return this.summarizeResults(plan, results);
    } catch (error) {
      log.error(`❌ 计划执行失败: ${plan.taskId}`, error);
      throw error;
    }
  }

  /**
   * 汇总执行结果
   */
  private summarizeResults(
    plan: ExecutionPlan,
    results: { [step: number]: string },
  ): string {
    const summary: string[] = [
      `# 执行计划完成`,
      ``,
      `**任务**: ${plan.taskDescription}`,
      `**步骤数**: ${plan.steps.length}`,
      ``,
      `## 执行结果`,
      ``,
    ];

    for (const step of plan.steps) {
      const result = results[step.order];
      summary.push(`### 步骤 ${step.order}: ${step.description}`);
      summary.push(`${result || '（无结果）'}`);
      summary.push(``);
    }

    return summary.join('\n');
  }

  /**
   * 构建意图分析的系统提示词
   */
  private buildAnalysisPrompt(
    agents: ConfigurableAgentConfig[],
    memories: any[],
  ): string {
    const agentList = this.agentRegistry.getAgentListForPrompt();
    const memoriesText = this.formatMemories(memories);

    return `
你是 Xuanji 的管家 Agent，负责分析用户意图并委派给最合适的专业 Agent。

# 可用的 Worker Agent

${agentList}

${memoriesText ? `# 记忆库上下文\n\n${memoriesText}\n` : ''}

# 任务

分析用户请求，返回 JSON 格式的委派决策：

\`\`\`json
{
  "reasoning": "分析过程（为什么选择这个 Agent）",
  "agentId": "选择的 Agent ID",
  "context": {
    "task": "提取的核心任务",
    "constraints": ["约束条件1", "约束条件2"],
    "preferences": {"key": "value"}
  },
  "collaborative": false
}
\`\`\`

**原则**:
1. 优先匹配 Agent 的 capabilities 和 tags
2. 考虑 Agent 的可用工具是否满足需求
3. 提取记忆中的关键信息注入 context.preferences
4. 如果单个 Agent 无法完成，设置 collaborative: true（暂不支持）

**重要**: 必须返回有效的 JSON，不要添加任何其他文本。
`.trim();
  }

  /**
   * 格式化记忆为文本
   */
  private formatMemories(memories: any[]): string {
    if (memories.length === 0) {
      return '';
    }

    return memories
      .map((m, i) => {
        return `${i + 1}. **${this.getTypeLabel(m.type)}**: ${m.content}`;
      })
      .join('\n');
  }

  /**
   * 获取记忆类型标签
   */
  private getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      user_preference: '用户偏好',
      project_fact: '项目知识',
      user_fact: '用户信息',
      relationship: '关系信息',
      important_date: '重要日期',
      decision: '决策记录',
    };
    return labels[type] || type;
  }

  /**
   * 解析委派决策（从 LLM 返回的文本中提取 JSON）
   */
  private parseDelegation(text: string): AgentDelegation {
    try {
      // 尝试提取 JSON 代码块
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const delegation = JSON.parse(jsonMatch[1]);
        return this.validateDelegation(delegation);
      }

      // 尝试提取 { ... } 对象
      const objectMatch = text.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        const delegation = JSON.parse(objectMatch[0]);
        return this.validateDelegation(delegation);
      }

      throw new Error('未找到 JSON 对象');
    } catch (error) {
      log.error('❌ 解析委派决策失败:', error);
      log.debug('LLM 返回内容:', text);
      throw new Error(`无法解析委派决策: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 验证委派决策格式
   */
  private validateDelegation(delegation: any): AgentDelegation {
    if (!delegation.agentId) {
      throw new Error('缺少字段: agentId');
    }

    if (!delegation.context || !delegation.context.task) {
      throw new Error('缺少字段: context.task');
    }

    return {
      reasoning: delegation.reasoning || '',
      agentId: delegation.agentId,
      context: {
        task: delegation.context.task,
        constraints: delegation.context.constraints || [],
        preferences: delegation.context.preferences || {},
      },
      collaborative: delegation.collaborative || false,
      agentIds: delegation.agentIds,
    };
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.workerAgents.clear();
  }
}
