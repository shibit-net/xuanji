/**
 * Planner 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Planner } from '@/core/planner/Planner';
import type { ILLMProvider } from '@/core/types';
import type { PlanningContext, SubTask } from '@/core/planner/types';
import type { ExecutionPlan } from '@/core/routing/types';

describe('Planner', () => {
  let mockProvider: ILLMProvider;
  let planner: Planner;

  beforeEach(() => {
    // Mock LLM Provider
    mockProvider = {
      stream: vi.fn(),
    } as any;

    planner = new Planner(mockProvider, {
      model: 'claude-3-5-sonnet-20241022',
      maxSteps: 10,
      timeout: 30000,
      requireConfirmation: true,
    });
  });

  describe('plan()', () => {
    it('应该生成执行计划', async () => {
      // Mock LLM 响应
      const mockResponse = `\`\`\`json
{
  "subTasks": [
    {
      "id": "step-1",
      "task": "设计数据模型",
      "dependencies": [],
      "parallel": false
    },
    {
      "id": "step-2",
      "task": "实现后端 API",
      "dependencies": ["step-1"],
      "parallel": false
    }
  ],
  "reasoning": "先设计数据模型，然后实现 API"
}
\`\`\``;

      // Mock stream 返回
      (mockProvider.stream as any).mockReturnValue((async function* () {
        yield { type: 'text_delta', text: mockResponse };
      })());

      const context: PlanningContext = {
        userInput: '帮我实现一个 Todo API',
        complexity: {
          isMultiStep: true,
          requiresSpecialist: false,
          estimatedSteps: 2,
          domains: ['coding'],
          parallelizable: false,
          complexity: 'medium',
        },
      };

      const plan = await planner.plan(context);

      expect(plan.taskId).toMatch(/^task-\d+$/);
      expect(plan.taskDescription).toBe('帮我实现一个 Todo API');
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0].description).toBe('设计数据模型');
      expect(plan.steps[1].description).toBe('实现后端 API');
      expect(plan.steps[1].dependsOn).toEqual([1]); // 依赖步骤 1
    });

    it('应该支持并行任务', async () => {
      const mockResponse = `\`\`\`json
{
  "subTasks": [
    {
      "id": "step-1",
      "task": "设计架构",
      "dependencies": [],
      "parallel": false
    },
    {
      "id": "step-2",
      "task": "实现前端",
      "dependencies": ["step-1"],
      "parallel": true
    },
    {
      "id": "step-3",
      "task": "实现后端",
      "dependencies": ["step-1"],
      "parallel": true
    }
  ],
  "reasoning": "架构设计完成后，前后端可以并行开发"
}
\`\`\``;

      (mockProvider.stream as any).mockReturnValue((async function* () {
        yield { type: 'text_delta', text: mockResponse };
      })());

      const context: PlanningContext = {
        userInput: '实现完整应用',
        complexity: {
          isMultiStep: true,
          requiresSpecialist: false,
          estimatedSteps: 3,
          domains: ['coding'],
          parallelizable: true,
          complexity: 'complex',
        },
      };

      const plan = await planner.plan(context);

      expect(plan.steps).toHaveLength(3);
      expect(plan.steps[1].parallelWith).toContain(3); // 步骤 2 和步骤 3 并行
      expect(plan.steps[2].parallelWith).toContain(2);
    });

    it('应该支持 Agent Profile 分配', async () => {
      const mockResponse = `\`\`\`json
{
  "subTasks": [
    {
      "id": "step-1",
      "task": "设计架构",
      "agentProfile": "architect",
      "dependencies": [],
      "parallel": false
    },
    {
      "id": "step-2",
      "task": "实现代码",
      "agentProfile": "coder",
      "dependencies": ["step-1"],
      "parallel": false
    }
  ],
  "reasoning": "架构师设计，编码员实现"
}
\`\`\``;

      (mockProvider.stream as any).mockReturnValue((async function* () {
        yield { type: 'text_delta', text: mockResponse };
      })());

      const context: PlanningContext = {
        userInput: '实现新功能',
        complexity: {
          isMultiStep: true,
          requiresSpecialist: true,
          estimatedSteps: 2,
          domains: ['coding'],
          parallelizable: false,
          complexity: 'medium',
        },
        availableAgents: ['architect', 'coder'],
      };

      const plan = await planner.plan(context);

      expect(plan.requiredAgents).toHaveLength(2);
      expect(plan.requiredAgents[0].id).toBe('architect');
      expect(plan.requiredAgents[1].id).toBe('coder');
      expect(plan.steps[0].agentId).toBe('architect');
      expect(plan.steps[1].agentId).toBe('coder');
    });

    it('应该处理 LLM 错误响应', async () => {
      // Mock 无效的 JSON 响应
      (mockProvider.stream as any).mockReturnValue((async function* () {
        yield { type: 'text_delta', text: '这不是 JSON' };
      })());

      const context: PlanningContext = {
        userInput: '测试错误',
        complexity: {
          isMultiStep: false,
          requiresSpecialist: false,
          estimatedSteps: 1,
          domains: [],
          parallelizable: false,
          complexity: 'simple',
        },
      };

      await expect(planner.plan(context)).rejects.toThrow('规划响应解析失败');
    });

    it('应该调用 LLM 时使用正确的参数', async () => {
      const mockResponse = `\`\`\`json
{
  "subTasks": [
    {"id": "step-1", "task": "任务", "dependencies": [], "parallel": false}
  ],
  "reasoning": "简单任务"
}
\`\`\``;

      (mockProvider.stream as any).mockReturnValue((async function* () {
        yield { type: 'text_delta', text: mockResponse };
      })());

      const context: PlanningContext = {
        userInput: '测试',
        complexity: {
          isMultiStep: false,
          requiresSpecialist: false,
          estimatedSteps: 1,
          domains: [],
          parallelizable: false,
          complexity: 'simple',
        },
      };

      await planner.plan(context);

      expect(mockProvider.stream).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('测试'),
          }),
        ]),
        [],
        expect.objectContaining({
          model: 'claude-3-5-sonnet-20241022',
          maxTokens: 2000,
          temperature: 0.3,
        }),
      );
    });
  });
});
