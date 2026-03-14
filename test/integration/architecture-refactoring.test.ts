/**
 * 架构重构集成测试
 *
 * 测试新架构的端到端流程：
 * 1. TaskRouter 路由流程（复杂度判断 → direct/decompose 模式）
 * 2. Planner + Executor 任务分解流程
 * 3. TemplateRepo 模板管理
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskRouter, DEFAULT_ROUTING_CONFIG } from '@/core/routing/TaskRouter';
import { Planner } from '@/core/planner/Planner';
import { Executor } from '@/core/executor/Executor';
import { TemplateRepo } from '@/core/template/TemplateRepo';
import type { ILLMProvider, StreamEvent } from '@/core/types';
import type { MCPManager } from '@/mcp/MCPManager';
import type { IMCPClient } from '@/mcp/types';
import type { ToolRegistry } from '@/core/tools/ToolRegistry';

// Mock SubAgentLoop
vi.mock('@/core/agent/SubAgentLoop', () => ({
  runSubAgent: vi.fn(),
  SubAgentContext: class {
    constructor(options: any) {}
  },
}));

/**
 * 创建 mock LLM Provider
 */
function createMockProvider(responses: StreamEvent[][]): ILLMProvider {
  let callIndex = 0;
  return {
    name: 'mock',
    models: ['mock-model'],
    isSupported: (model: string) => model.includes('mock'),
    stream: vi.fn(async function* (): AsyncIterable<StreamEvent> {
      const events = responses[callIndex] ?? [];
      callIndex++;
      for (const event of events) {
        yield event;
      }
    }),
  };
}

describe('架构重构集成测试', () => {
  describe('TaskRouter 路由流程', () => {
    let taskRouter: TaskRouter;
    let mockProvider: ILLMProvider;

    beforeEach(() => {
      vi.clearAllMocks();
      // TaskRouter 使用 haiku 模型做复杂度分析
      mockProvider = createMockProvider([]);
      taskRouter = new TaskRouter(DEFAULT_ROUTING_CONFIG, mockProvider);
    });

    it('简单任务应路由到 direct 模式', async () => {
      // Mock LLM 返回简单任务的复杂度
      const complexityResponse = `\`\`\`json
{
  "isMultiStep": false,
  "requiresSpecialist": false,
  "estimatedSteps": 1,
  "domains": ["general"],
  "parallelizable": false,
  "complexity": "simple"
}
\`\`\``;

      mockProvider = createMockProvider([
        [
          { type: 'usage', usage: { input: 100, output: 0 } },
          { type: 'text_delta', text: complexityResponse },
          { type: 'end', stopReason: 'end_turn', usage: { input: 0, output: 50 } },
        ],
      ]);

      taskRouter = new TaskRouter(DEFAULT_ROUTING_CONFIG, mockProvider);

      const result = await taskRouter.route('今天天气怎么样？', {
        sessionId: 'test-session',
        messageCount: 1,
        usedAgents: [],
      });

      expect(result.mode).toBe('direct');
      expect(result.reason).toBe('default'); // 简单任务返回 default
      expect(result.complexity?.complexity).toBe('simple');
    });

    it('复杂任务应路由到 decompose 模式', async () => {
      // Mock LLM 返回复杂任务的复杂度
      const complexityResponse = `\`\`\`json
{
  "isMultiStep": true,
  "requiresSpecialist": false,
  "estimatedSteps": 5,
  "domains": ["coding"],
  "parallelizable": true,
  "complexity": "complex"
}
\`\`\``;

      mockProvider = createMockProvider([
        [
          { type: 'usage', usage: { input: 100, output: 0 } },
          { type: 'text_delta', text: complexityResponse },
          { type: 'end', stopReason: 'end_turn', usage: { input: 0, output: 100 } },
        ],
      ]);

      taskRouter = new TaskRouter(DEFAULT_ROUTING_CONFIG, mockProvider);

      const result = await taskRouter.route('帮我实现一个 Todo 应用', {
        sessionId: 'test-session',
        messageCount: 1,
        usedAgents: [],
      });

      expect(result.mode).toBe('decompose');
      expect(result.reason).toBe('complexity');
      expect(result.complexity?.isMultiStep).toBe(true);
      expect(result.complexity?.estimatedSteps).toBe(5);
    });

    it('多轮对话应路由到 direct 模式', async () => {
      const result = await taskRouter.route('继续', {
        sessionId: 'test-session',
        messageCount: 5,
        usedAgents: [],
      });

      expect(result.mode).toBe('direct');
      expect(result.reason).toBe('default'); // 多轮对话也返回 default
    });
  });

  describe('Planner + Executor 任务分解流程', () => {
    let planner: Planner;
    let executor: Executor;
    let mockProvider: ILLMProvider;
    let mockLightProvider: ILLMProvider;
    let mockToolRegistry: ToolRegistry;

    beforeEach(() => {
      mockProvider = createMockProvider([]);
      mockLightProvider = createMockProvider([]);
      mockToolRegistry = {} as any;

      planner = new Planner(mockProvider, {
        model: 'claude-3-5-sonnet-20241022',
        maxSteps: 10,
        timeout: 30000,
        requireConfirmation: false,
      });

      executor = new Executor(
        mockProvider,
        mockLightProvider,
        mockToolRegistry,
        { model: 'mock-model', systemPrompt: '', maxIterations: 10 } as any,
        { maxConcurrent: 3, timeout: 300000, stopOnError: false },
      );
    });

    it('应生成执行计划并按依赖顺序执行', async () => {
      // Mock Planner LLM 响应
      const planResponse = `\`\`\`json
{
  "subTasks": [
    {
      "id": "step-1",
      "task": "分析需求",
      "dependencies": [],
      "parallel": false
    },
    {
      "id": "step-2",
      "task": "设计架构",
      "dependencies": ["step-1"],
      "parallel": false
    },
    {
      "id": "step-3",
      "task": "实现代码",
      "dependencies": ["step-2"],
      "parallel": false
    }
  ],
  "reasoning": "按照软件开发流程，先分析需求，再设计架构，最后实现代码"
}
\`\`\``;

      mockProvider = createMockProvider([
        [
          { type: 'usage', usage: { input: 200, output: 0 } },
          { type: 'text_delta', text: planResponse },
          { type: 'end', stopReason: 'end_turn', usage: { input: 0, output: 150 } },
        ],
      ]);

      planner = new Planner(mockProvider, {
        model: 'claude-3-5-sonnet-20241022',
        maxSteps: 10,
        timeout: 30000,
        requireConfirmation: false,
      });

      // 生成计划
      const plan = await planner.plan({
        userInput: '帮我实现一个 Todo 应用',
        complexity: {
          isMultiStep: true,
          requiresSpecialist: false,
          estimatedSteps: 3,
          domains: ['coding'],
          parallelizable: false,
          complexity: 'medium',
        },
      });

      expect(plan.steps).toHaveLength(3);
      expect(plan.steps[0].description).toBe('分析需求');
      expect(plan.steps[1].description).toBe('设计架构');
      expect(plan.steps[1].dependsOn).toEqual([1]); // 依赖步骤 1
      expect(plan.steps[2].description).toBe('实现代码');
      expect(plan.steps[2].dependsOn).toEqual([2]); // 依赖步骤 2

      // Mock SubAgentLoop 执行（Executor 内部使用）
      const { runSubAgent } = await import('@/core/agent/SubAgentLoop');
      (runSubAgent as any).mockResolvedValue({
        result: '执行成功',
        tokensUsed: { input: 100, output: 50 },
        duration: 1000,
        timedOut: false,
        iterations: 1,
      });

      // 执行计划
      const result = await executor.execute(plan);

      expect(result.status).toBe('success');
      expect(result.subTaskResults).toHaveLength(3);
      expect(result.subTaskResults[0].order).toBe(1);
      expect(result.subTaskResults[1].order).toBe(2);
      expect(result.subTaskResults[2].order).toBe(3);
      expect(runSubAgent).toHaveBeenCalledTimes(3);
    });

    it('应支持并行执行', async () => {
      const planResponse = `\`\`\`json
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

      mockProvider = createMockProvider([
        [
          { type: 'usage', usage: { input: 200, output: 0 } },
          { type: 'text_delta', text: planResponse },
          { type: 'end', stopReason: 'end_turn', usage: { input: 0, output: 150 } },
        ],
      ]);

      planner = new Planner(mockProvider, {
        model: 'claude-3-5-sonnet-20241022',
        maxSteps: 10,
        timeout: 30000,
        requireConfirmation: false,
      });

      const plan = await planner.plan({
        userInput: '实现完整应用',
        complexity: {
          isMultiStep: true,
          requiresSpecialist: false,
          estimatedSteps: 3,
          domains: ['coding'],
          parallelizable: true,
          complexity: 'complex',
        },
      });

      expect(plan.steps).toHaveLength(3);
      expect(plan.steps[1].parallelWith).toContain(3); // 步骤 2 和步骤 3 并行
      expect(plan.steps[2].parallelWith).toContain(2);
    });
  });

  describe('TemplateRepo 模板管理', () => {
    let templateRepo: TemplateRepo;
    let mockMCPManager: MCPManager;

    beforeEach(() => {
      mockMCPManager = {
        getAllPrompts: vi.fn(),
        getClient: vi.fn(),
      } as any;

      templateRepo = new TemplateRepo(mockMCPManager);
    });

    it('应列出所有 MCP Prompts 模板', async () => {
      (mockMCPManager.getAllPrompts as any).mockResolvedValue([
        {
          serverName: 'market',
          prompt: {
            name: 'analysis_report',
            description: '生成市场分析报告',
            arguments: [
              { name: 'symbol', description: '股票代码', required: true },
            ],
          },
        },
        {
          serverName: 'market',
          prompt: {
            name: 'trend_analysis',
            description: '趋势分析',
          },
        },
      ]);

      const templates = await templateRepo.list();

      expect(templates).toHaveLength(2);
      expect(templates[0].id).toBe('market:analysis_report');
      expect(templates[0].serverName).toBe('market');
      expect(templates[1].id).toBe('market:trend_analysis');
    });

    it('应获取并渲染模板', async () => {
      const mockClient: IMCPClient = {
        getPrompt: vi.fn().mockResolvedValue({
          description: '市场分析报告',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: '请分析 AAPL 的市场表现',
              },
            },
          ],
        }),
      } as any;

      (mockMCPManager.getAllPrompts as any).mockResolvedValue([
        {
          serverName: 'market',
          prompt: {
            name: 'analysis_report',
            description: '生成市场分析报告',
            arguments: [
              { name: 'symbol', description: '股票代码', required: true },
            ],
          },
        },
      ]);

      (mockMCPManager.getClient as any).mockReturnValue(mockClient);

      const rendered = await templateRepo.get('market:analysis_report', { symbol: 'AAPL' });

      expect(rendered.template.id).toBe('market:analysis_report');
      expect(rendered.messages).toHaveLength(1);
      expect(rendered.messages[0].content).toContain('AAPL');
      expect(mockClient.getPrompt).toHaveBeenCalledWith('analysis_report', { symbol: 'AAPL' });
    });

    it('应搜索模板', async () => {
      (mockMCPManager.getAllPrompts as any).mockResolvedValue([
        {
          serverName: 'market',
          prompt: {
            name: 'analysis_report',
            description: '市场分析报告',
          },
        },
        {
          serverName: 'market',
          prompt: {
            name: 'trend_analysis',
            description: '趋势分析',
          },
        },
        {
          serverName: 'other',
          prompt: {
            name: 'data_export',
            description: '数据导出',
          },
        },
      ]);

      const results = await templateRepo.search('分析');

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('market:analysis_report');
      expect(results[1].id).toBe('market:trend_analysis');
    });
  });
});
