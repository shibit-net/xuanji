/**
 * 执行计划生成器
 *
 * 为复杂任务生成详细的执行计划，供用户审核
 */

import type { ILLMProvider } from '@/core/types';
import type { ExecutionPlan, ExecutionStep, TaskComplexity } from '../routing/types';
import type { AgentRegistry } from './AgentRegistry';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'execution-planner' });

export class ExecutionPlanner {
  constructor(
    private provider: ILLMProvider,
    private agentRegistry: AgentRegistry,
  ) {}

  /**
   * 生成执行计划
   *
   * @param userTask 用户任务
   * @param complexity 任务复杂度分析结果
   * @returns 执行计划
   */
  async generatePlan(
    userTask: string,
    complexity?: TaskComplexity,
  ): Promise<ExecutionPlan> {
    log.info('Generating execution plan', { task: userTask.slice(0, 100) });

    const taskId = this.generateTaskId();

    try {
      // 1. 构建计划生成 prompt
      const prompt = this.buildPlanPrompt(userTask, complexity);

      // 2. 调用 LLM 生成计划
      const stream = this.provider.stream(
        [{ role: 'user', content: prompt }],
        [],
        {
          model: 'claude-3-5-sonnet-20241022', // 使用 Sonnet 保证计划质量
          maxTokens: 2000,
          temperature: 0.3,
        },
      );

      // 收集所有文本
      let response = '';
      for await (const event of stream) {
        if (event.type === 'text_delta' && event.text) {
          response += event.text;
        }
      }

      // 3. 解析计划
      const plan = this.parsePlan(response, taskId, userTask);

      log.info('Execution plan generated', {
        taskId,
        steps: plan.steps.length,
        agents: plan.requiredAgents.length,
      });

      return plan;
    } catch (error) {
      log.error('Failed to generate execution plan', error);

      // 降级：生成简单计划
      return this.generateFallbackPlan(taskId, userTask);
    }
  }

  /**
   * 构建计划生成 prompt
   */
  private buildPlanPrompt(
    userTask: string,
    complexity?: TaskComplexity,
  ): string {
    const enabledAgents = this.agentRegistry.getEnabled();
    const agentList = enabledAgents
      .map(
        (agent) => `- **${agent.id}** (${agent.name}): ${agent.description}
  能力: ${agent.capabilities.join(', ')}
  适用: ${agent.tags.join(', ')}`,
      )
      .join('\n');

    return `你是一个任务规划专家。请为以下用户任务生成详细的执行计划。

## 用户任务
${userTask}

${complexity ? `## 任务复杂度分析
- 复杂度: ${complexity.complexity}
- 预估步骤: ${complexity.estimatedSteps}
- 涉及领域: ${complexity.domains.join(', ')}
- 需要专家: ${complexity.requiresSpecialist ? '是' : '否'}
- 可并行: ${complexity.parallelizable ? '是' : '否'}
${complexity.reasoning ? `- 分析理由: ${complexity.reasoning}` : ''}
` : ''}

## 可用的 Agent
${agentList}

## 任务要求

请生成一个详细的执行计划，包含以下内容：

1. **任务分解**：将复杂任务拆解为多个清晰的步骤
2. **Agent 分配**：为每个步骤分配最合适的 Agent
3. **步骤顺序**：明确步骤的执行顺序和依赖关系
4. **并行优化**：识别可以并行执行的步骤
5. **时间预估**：预估每个步骤和总体耗时

## 输出格式

请严格按照以下 JSON 格式输出（不要包含其他文字）：

\`\`\`json
{
  "steps": [
    {
      "order": 1,
      "description": "步骤描述",
      "agentId": "agent-id 或 null（如果不需要 Agent）",
      "estimatedDuration": 30,
      "parallelWith": [],
      "dependsOn": []
    }
  ],
  "requiredAgents": [
    {
      "id": "agent-id",
      "name": "Agent 名称",
      "role": "在此任务中的角色"
    }
  ],
  "estimatedTotalDuration": 120
}
\`\`\`

## 计划原则

1. **步骤清晰**：每个步骤应该有明确的输入和输出
2. **Agent 匹配**：选择最匹配步骤需求的 Agent
3. **依赖明确**：明确步骤之间的依赖关系（dependsOn）
4. **并行优化**：识别可并行步骤（parallelWith）
5. **时间合理**：预估时间应该基于步骤复杂度

## 示例

任务："审查 src/auth.ts 的代码质量，并生成测试用例"

\`\`\`json
{
  "steps": [
    {
      "order": 1,
      "description": "读取 src/auth.ts 文件内容",
      "agentId": null,
      "estimatedDuration": 5,
      "parallelWith": [],
      "dependsOn": []
    },
    {
      "order": 2,
      "description": "分析代码质量、识别潜在问题和优化点",
      "agentId": "code-reviewer",
      "estimatedDuration": 60,
      "parallelWith": [],
      "dependsOn": [1]
    },
    {
      "order": 3,
      "description": "基于代码分析结果生成测试用例",
      "agentId": "test-generator",
      "estimatedDuration": 45,
      "parallelWith": [],
      "dependsOn": [1]
    },
    {
      "order": 4,
      "description": "汇总审查报告和测试用例",
      "agentId": null,
      "estimatedDuration": 10,
      "parallelWith": [],
      "dependsOn": [2, 3]
    }
  ],
  "requiredAgents": [
    {
      "id": "code-reviewer",
      "name": "代码审查专家",
      "role": "分析代码质量"
    },
    {
      "id": "test-generator",
      "name": "测试生成器",
      "role": "生成测试用例"
    }
  ],
  "estimatedTotalDuration": 120
}
\`\`\`

注意：步骤 2 和 3 可以并行，因为它们都依赖步骤 1，且互不依赖。

请立即开始规划：`;
  }

  /**
   * 解析计划
   */
  private parsePlan(
    response: string,
    taskId: string,
    taskDescription: string,
  ): ExecutionPlan {
    try {
      // 提取 JSON 块
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
                       response.match(/```\s*([\s\S]*?)\s*```/) ||
                       [null, response];

      const jsonStr = jsonMatch[1] || response;
      const parsed = JSON.parse(jsonStr.trim());

      // 验证必填字段
      if (!Array.isArray(parsed.steps) || !Array.isArray(parsed.requiredAgents)) {
        throw new Error('Invalid plan format');
      }

      // 构建完整计划
      const plan: ExecutionPlan = {
        taskId,
        taskDescription,
        steps: parsed.steps.map((step: any) => ({
          order: step.order,
          description: step.description,
          agentId: step.agentId || undefined,
          estimatedDuration: step.estimatedDuration || 30,
          parallelWith: Array.isArray(step.parallelWith) ? step.parallelWith : [],
          dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
        })),
        requiredAgents: parsed.requiredAgents.map((agent: any) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
        })),
        estimatedTotalDuration: parsed.estimatedTotalDuration || this.calculateTotalDuration(parsed.steps),
        createdAt: new Date().toISOString(),
      };

      return plan;
    } catch (error) {
      log.warn('Failed to parse plan response', error);
      throw error;
    }
  }

  /**
   * 计算总耗时（考虑并行）
   */
  private calculateTotalDuration(steps: ExecutionStep[]): number {
    // 简化实现：不考虑并行，直接累加
    // TODO: 实现并行路径分析
    return steps.reduce((sum, step) => sum + (step.estimatedDuration || 30), 0);
  }

  /**
   * 生成降级计划
   */
  private generateFallbackPlan(taskId: string, taskDescription: string): ExecutionPlan {
    return {
      taskId,
      taskDescription,
      steps: [
        {
          order: 1,
          description: taskDescription,
          estimatedDuration: 60,
          parallelWith: [],
          dependsOn: [],
        },
      ],
      requiredAgents: [],
      estimatedTotalDuration: 60,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * 生成任务 ID
   */
  private generateTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * 验证 Agent 是否存在
   */
  validatePlan(plan: ExecutionPlan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 验证所有 Agent 都已注册
    for (const agent of plan.requiredAgents) {
      if (!this.agentRegistry.get(agent.id)) {
        errors.push(`Agent 不存在: ${agent.id}`);
      }
    }

    // 验证步骤中的 Agent 都在 requiredAgents 中
    const requiredAgentIds = new Set(plan.requiredAgents.map(a => a.id));
    for (const step of plan.steps) {
      if (step.agentId && !requiredAgentIds.has(step.agentId)) {
        errors.push(`步骤 ${step.order} 引用了未声明的 Agent: ${step.agentId}`);
      }
    }

    // 验证依赖关系
    const stepOrders = new Set(plan.steps.map(s => s.order));
    for (const step of plan.steps) {
      for (const dep of step.dependsOn || []) {
        if (!stepOrders.has(dep)) {
          errors.push(`步骤 ${step.order} 依赖不存在的步骤: ${dep}`);
        }
        if (dep >= step.order) {
          errors.push(`步骤 ${step.order} 依赖后续步骤: ${dep}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
