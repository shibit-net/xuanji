/**
 * Executor 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Executor } from '@/core/executor/Executor';
import type { ILLMProvider, IToolRegistry } from '@/core/types';
import type { ExecutionPlan } from '@/core/routing/types';
import type { ExecutionResult, SubTaskResult } from '@/core/executor/types';
import type { AgentConfig } from '@/core/types/agent';

// Mock runSubAgent
vi.mock('@/core/agent/SubAgentLoop', () => ({
  runSubAgent: vi.fn(),
  SubAgentContext: class {
    constructor(options: any) {}
  },
}));

describe('Executor', () => {
  let mockProvider: ILLMProvider;
  let mockToolRegistry: IToolRegistry;
  let mockAgentConfig: AgentConfig;
  let executor: Executor;

  beforeEach(() => {
    vi.clearAllMocks(); // 清理所有 mock 调用记录

    mockProvider = {} as any;
    mockToolRegistry = {} as any;
    mockAgentConfig = {
      model: 'claude-3-5-sonnet-20241022',
      systemPrompt: 'Test prompt',
      maxIterations: 10,
    } as any;

    executor = new Executor(
      mockProvider,
      mockToolRegistry,
      mockAgentConfig,
      {
        maxConcurrent: 3,
        timeout: 300000,
        stopOnError: false,
      },
    );
  });

  describe('execute()', () => {
    it('应该顺序执行所有步骤', async () => {
      const { runSubAgent } = await import('@/core/agent/SubAgentLoop');

      // Mock 子任务执行成功
      (runSubAgent as any).mockResolvedValue({
        result: '执行成功',
        tokensUsed: { input: 100, output: 50 },
        duration: 1000,
        timedOut: false,
        iterations: 1,
      });

      const plan: ExecutionPlan = {
        taskId: 'task-123',
        taskDescription: '测试任务',
        steps: [
          { order: 1, description: '步骤 1' },
          { order: 2, description: '步骤 2', dependsOn: [1] },
        ],
        requiredAgents: [],
        estimatedTotalDuration: 120,
        createdAt: new Date().toISOString(),
      };

      const result = await executor.execute(plan);

      expect(result.status).toBe('success');
      expect(result.subTaskResults).toHaveLength(2);
      expect(result.subTaskResults[0].status).toBe('success');
      expect(result.subTaskResults[1].status).toBe('success');
      expect(runSubAgent).toHaveBeenCalledTimes(2);
    });

    it('应该处理子任务依赖关系', async () => {
      const { runSubAgent } = await import('@/core/agent/SubAgentLoop');
      const executionOrder: number[] = [];

      (runSubAgent as any).mockImplementation(async (provider: any, lightProvider: any, registry: any, config: any, context: any) => {
        executionOrder.push(parseInt(context.task.match(/\d+/)[0]));
        return {
          result: '成功',
          tokensUsed: { input: 100, output: 50 },
          duration: 100,
          timedOut: false,
          iterations: 1,
        };
      });

      const plan: ExecutionPlan = {
        taskId: 'task-456',
        taskDescription: '依赖测试',
        steps: [
          { order: 1, description: '步骤 1' },
          { order: 2, description: '步骤 2', dependsOn: [1] },
          { order: 3, description: '步骤 3', dependsOn: [2] },
        ],
        requiredAgents: [],
        estimatedTotalDuration: 180,
        createdAt: new Date().toISOString(),
      };

      await executor.execute(plan);

      // 验证执行顺序：1 -> 2 -> 3
      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it('应该跳过依赖未满足的步骤', async () => {
      const { runSubAgent } = await import('@/core/agent/SubAgentLoop');

      // 步骤 1 失败
      (runSubAgent as any).mockRejectedValueOnce(new Error('执行失败'));

      const plan: ExecutionPlan = {
        taskId: 'task-789',
        taskDescription: '失败测试',
        steps: [
          { order: 1, description: '步骤 1' },
          { order: 2, description: '步骤 2', dependsOn: [1] },
        ],
        requiredAgents: [],
        estimatedTotalDuration: 120,
        createdAt: new Date().toISOString(),
      };

      const result = await executor.execute(plan);

      expect(result.status).toBe('failed'); // 无成功步骤时状态应为 failed
      expect(result.subTaskResults[0].status).toBe('failed');
      expect(result.subTaskResults[1].status).toBe('skipped');
      expect(result.subTaskResults[1].error).toContain('依赖子任务执行失败');
    });

    it('stopOnError=true 时应该在错误后停止', async () => {
      const { runSubAgent } = await import('@/core/agent/SubAgentLoop');

      executor = new Executor(
        mockProvider,
        mockToolRegistry,
        mockAgentConfig,
        { stopOnError: true },
      );

      (runSubAgent as any)
        .mockRejectedValueOnce(new Error('步骤 1 失败'))
        .mockResolvedValueOnce({ result: '成功', tokensUsed: { input: 100, output: 50 }, duration: 100, timedOut: false, iterations: 1 });

      const plan: ExecutionPlan = {
        taskId: 'task-stop',
        taskDescription: '停止测试',
        steps: [
          { order: 1, description: '步骤 1' },
          { order: 2, description: '步骤 2' },
        ],
        requiredAgents: [],
        estimatedTotalDuration: 120,
        createdAt: new Date().toISOString(),
      };

      const result = await executor.execute(plan);

      expect(result.status).toBe('failed');
      expect(result.subTaskResults).toHaveLength(1); // 只执行了步骤 1
      expect(runSubAgent).toHaveBeenCalledTimes(1);
    });

    it('应该触发执行回调', async () => {
      const { runSubAgent } = await import('@/core/agent/SubAgentLoop');

      (runSubAgent as any).mockResolvedValue({
        result: '成功',
        tokensUsed: { input: 100, output: 50 },
        duration: 100,
        timedOut: false,
        iterations: 1,
      });

      const callbacks = {
        onSubTaskStart: vi.fn(),
        onSubTaskComplete: vi.fn(),
        onProgress: vi.fn(),
      };

      const plan: ExecutionPlan = {
        taskId: 'task-callback',
        taskDescription: '回调测试',
        steps: [
          { order: 1, description: '步骤 1' },
          { order: 2, description: '步骤 2' },
        ],
        requiredAgents: [],
        estimatedTotalDuration: 120,
        createdAt: new Date().toISOString(),
      };

      await executor.execute(plan, callbacks);

      expect(callbacks.onSubTaskStart).toHaveBeenCalledTimes(2);
      expect(callbacks.onSubTaskComplete).toHaveBeenCalledTimes(2);
      expect(callbacks.onProgress).toHaveBeenCalledTimes(2);
      expect(callbacks.onProgress).toHaveBeenLastCalledWith(2, 2);
    });

    it('应该生成执行汇总', async () => {
      const { runSubAgent } = await import('@/core/agent/SubAgentLoop');

      (runSubAgent as any)
        .mockResolvedValueOnce({ result: '步骤 1 完成', tokensUsed: { input: 100, output: 50 }, duration: 1000, timedOut: false, iterations: 1 })
        .mockResolvedValueOnce({ result: '步骤 2 完成', tokensUsed: { input: 100, output: 50 }, duration: 2000, timedOut: false, iterations: 1 });

      const plan: ExecutionPlan = {
        taskId: 'task-summary',
        taskDescription: '汇总测试',
        steps: [
          { order: 1, description: '步骤 1' },
          { order: 2, description: '步骤 2' },
        ],
        requiredAgents: [],
        estimatedTotalDuration: 120,
        createdAt: new Date().toISOString(),
      };

      const result = await executor.execute(plan);

      expect(result.summary).toBeDefined();
      expect(result.summary).toContain('汇总测试');
      expect(result.summary).toContain('✅ 步骤 1');
      expect(result.summary).toContain('✅ 步骤 2');
      expect(result.summary).toContain('总耗时');
    });
  });
});
