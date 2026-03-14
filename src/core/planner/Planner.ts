/**
 * 任务规划器 - Planner
 *
 * 职责：
 * 1. 分解复杂任务为子任务
 * 2. 确定子任务依赖关系
 * 3. 为每个子任务分配 Worker Agent Profile
 *
 * 实现：内置在 Main Agent 中，使用 LLM 生成执行计划
 */

import type { ILLMProvider } from '@/core/types';
import type { ExecutionPlan, TaskComplexity } from '@/core/routing/types';
import type { PlannerConfig, PlanningContext, SubTask } from './types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'planner' });

export class Planner {
  private config: Required<PlannerConfig>;

  constructor(
    private provider: ILLMProvider,
    config?: PlannerConfig,
  ) {
    this.config = {
      model: config?.model || 'claude-3-5-sonnet-20241022',
      maxSteps: config?.maxSteps || 10,
      timeout: config?.timeout || 30000,
      requireConfirmation: config?.requireConfirmation ?? true,
    };
  }

  /**
   * 生成执行计划
   *
   * @param context 规划上下文
   * @returns 执行计划
   */
  async plan(context: PlanningContext): Promise<ExecutionPlan> {
    log.info('Generating execution plan...', {
      complexity: context.complexity.complexity,
      steps: context.complexity.estimatedSteps,
    });

    // 构建规划 prompt
    const prompt = this.buildPlanningPrompt(context);

    try {
      // 调用 LLM 生成计划
      const stream = this.provider.stream(
        [{ role: 'user', content: prompt }],
        [],
        {
          model: this.config.model,
          maxTokens: 2000,
          temperature: 0.3, // 更确定性的输出
        },
      );

      // 收集所有文本
      let response = '';
      for await (const event of stream) {
        if (event.type === 'text_delta' && event.text) {
          response += event.text;
        }
      }

      // 解析响应
      const subTasks = this.parseResponse(response);

      // 构建 ExecutionPlan
      const plan = this.buildExecutionPlan(context, subTasks);

      log.info('Execution plan generated', {
        taskId: plan.taskId,
        steps: plan.steps.length,
      });

      return plan;
    } catch (error) {
      log.error('Failed to generate execution plan', error);
      throw new Error(`规划失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 构建规划 prompt
   */
  private buildPlanningPrompt(context: PlanningContext): string {
    const { userInput, complexity, availableAgents } = context;

    return `你是一个任务规划专家。请将以下复杂任务分解为可执行的子任务。

## 用户任务
${userInput}

## 任务复杂度分析
- 复杂度等级: ${complexity.complexity}
- 预估步骤数: ${complexity.estimatedSteps}
- 涉及领域: ${complexity.domains.join(', ')}
- 是否可并行: ${complexity.parallelizable ? '是' : '否'}
- 分析理由: ${complexity.reasoning || '无'}

${availableAgents && availableAgents.length > 0 ? `## 可用的 Agent Profile\n${availableAgents.map((id, i) => `${i + 1}. ${id}`).join('\n')}\n` : ''}

## 规划要求

1. **子任务分解**：
   - 将任务拆分为 2-${this.config.maxSteps} 个子任务
   - 每个子任务应该清晰、独立、可执行
   - 子任务之间可以有依赖关系

2. **依赖关系**：
   - 明确哪些子任务必须按顺序执行
   - 标识可以并行执行的子任务

3. **Agent 分配**（可选）：
   - 如果提供了可用 Agent Profile，为每个子任务分配合适的 Agent
   - 如果没有提供，可以省略 agentProfile 字段

## 输出格式

请严格按照以下 JSON 格式输出（不要包含其他文字）：

\`\`\`json
{
  "subTasks": [
    {
      "id": "step-1",
      "task": "子任务描述",
      "agentProfile": "agent-id（可选）",
      "dependencies": [],
      "parallel": false
    },
    {
      "id": "step-2",
      "task": "子任务描述",
      "agentProfile": "agent-id（可选）",
      "dependencies": ["step-1"],
      "parallel": false
    }
  ],
  "reasoning": "简短说明分解思路"
}
\`\`\`

## 示例

### 示例 1: 实现 Todo 应用
\`\`\`json
{
  "subTasks": [
    {
      "id": "step-1",
      "task": "设计数据模型和 API 接口",
      "dependencies": [],
      "parallel": false
    },
    {
      "id": "step-2",
      "task": "实现后端 CRUD 接口",
      "dependencies": ["step-1"],
      "parallel": false
    },
    {
      "id": "step-3",
      "task": "实现前端界面和交互",
      "dependencies": ["step-1"],
      "parallel": true
    },
    {
      "id": "step-4",
      "task": "编写测试用例",
      "dependencies": ["step-2", "step-3"],
      "parallel": false
    }
  ],
  "reasoning": "先设计架构，然后并行开发前后端，最后集成测试"
}
\`\`\`

请立即开始规划：`;
  }

  /**
   * 解析 LLM 响应
   */
  private parseResponse(response: string): SubTask[] {
    try {
      // 提取 JSON 块（支持带 ``` 包裹的格式）
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/) ||
                       response.match(/```\s*([\s\S]*?)\s*```/) ||
                       [null, response];

      const jsonStr = jsonMatch[1] || response;
      const parsed = JSON.parse(jsonStr.trim());

      // 验证必填字段
      if (!Array.isArray(parsed.subTasks)) {
        throw new Error('Invalid response format: missing subTasks array');
      }

      // 验证每个子任务
      for (const task of parsed.subTasks) {
        if (!task.id || !task.task) {
          throw new Error(`Invalid subtask: missing id or task`);
        }
      }

      return parsed.subTasks as SubTask[];
    } catch (error) {
      log.warn('Failed to parse planning response', error);
      throw new Error('规划响应解析失败，请重试');
    }
  }

  /**
   * 构建 ExecutionPlan
   */
  private buildExecutionPlan(
    context: PlanningContext,
    subTasks: SubTask[],
  ): ExecutionPlan {
    const taskId = `task-${Date.now()}`;

    // 转换 SubTask → ExecutionStep
    const steps = subTasks.map((subTask, index) => ({
      order: index + 1,
      description: subTask.task,
      agentId: subTask.agentProfile,
      dependsOn: subTask.dependencies?.map(depId => {
        const depIndex = subTasks.findIndex(t => t.id === depId);
        return depIndex !== -1 ? depIndex + 1 : undefined;
      }).filter((order): order is number => order !== undefined),
      parallelWith: subTask.parallel
        ? subTasks
            .map((t, i) => ({ task: t, index: i }))
            .filter(({ task }) => task.parallel && task.id !== subTask.id)
            .map(({ index }) => index + 1)
        : undefined,
    }));

    // 统计需要的 Agent
    const requiredAgents = Array.from(
      new Set(subTasks.map(t => t.agentProfile).filter(Boolean))
    ).map(id => ({
      id: id!,
      name: id!,
      role: 'worker',
    }));

    // 预估总耗时（简单估算：每个步骤 60 秒）
    const estimatedTotalDuration = subTasks.length * 60;

    return {
      taskId,
      taskDescription: context.userInput,
      steps,
      requiredAgents,
      estimatedTotalDuration,
      createdAt: new Date().toISOString(),
    };
  }
}
