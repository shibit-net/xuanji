/**
 * AskUser 工具并发控制测试
 *
 * 测试场景：
 * 1. 多个 agent 同时提问 — 通过 PermissionController.serialize() 排队
 * 2. 超时控制
 */

import { describe, test, beforeEach, expect, vi } from 'vitest';
import { AskUserTool } from '@/core/tools/AskUserTool';
import type { AskUserRequest, AskUserHandler } from '@/core/tools/AskUserTool';
import type { IPermissionController } from '@/permission/types';

/** 创建一个带真实 Promise 链串行化的 mock PermissionController */
function createMockController(): IPermissionController {
  let queue: Promise<void> = Promise.resolve();

  return {
    check: vi.fn(),
    setConfirmationHandler: vi.fn(),
    updateConfig: vi.fn(),
    getConfig: vi.fn().mockReturnValue({}),
    setPlanReviewHandler: vi.fn(),
    reviewPlan: vi.fn(),
    setIgnoreFilter: vi.fn(),
    setCurrentUserIntent: vi.fn(),
    listDecisions: vi.fn().mockReturnValue([]),
    deleteDecision: vi.fn().mockResolvedValue(undefined),
    clearDecisions: vi.fn().mockResolvedValue(undefined),
    recordDeniedOperation: vi.fn(),
    isDeniedOperation: vi.fn().mockReturnValue(false),
    listDeniedOperations: vi.fn().mockReturnValue([]),
    deleteDeniedOperation: vi.fn().mockResolvedValue(undefined),
    clearDeniedOperations: vi.fn().mockResolvedValue(undefined),
    serialize: vi.fn().mockImplementation(<T>(fn: () => Promise<T>): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        queue = queue.then(async () => {
          try {
            resolve(await fn());
          } catch (err) {
            reject(err);
          }
        });
      });
    }),
  };
}

describe('AskUserTool - 并发控制', () => {
  let tool: AskUserTool;
  let mockHandler: ReturnType<typeof vi.fn<Parameters<AskUserHandler>, ReturnType<AskUserHandler>>>;
  let handlerCallOrder: string[] = [];

  beforeEach(() => {
    tool = new AskUserTool();
    handlerCallOrder = [];

    mockHandler = vi.fn<Parameters<AskUserHandler>, ReturnType<AskUserHandler>>(async (request: AskUserRequest) => {
      handlerCallOrder.push(request.question);
      await new Promise(resolve => setTimeout(resolve, 100));
      return `回答: ${request.question}`;
    });

    tool.setHandler(mockHandler);
  });

  test('多个问题通过 PermissionController 自动排队', async () => {
    const controller = createMockController();
    tool.setPermissionController(controller);

    const promises = [
      tool.execute({ question: '问题 1' }),
      tool.execute({ question: '问题 2' }),
      tool.execute({ question: '问题 3' }),
    ];

    const results = await Promise.all(promises);

    expect(results).toHaveLength(3);
    expect(results[0].content).toBe('回答: 问题 1');
    expect(results[1].content).toBe('回答: 问题 2');
    expect(results[2].content).toBe('回答: 问题 3');

    expect(mockHandler).toHaveBeenCalledTimes(3);
    // 通过统一队列串行化，按 FIFO 顺序处理
    expect(handlerCallOrder).toEqual(['问题 1', '问题 2', '问题 3']);
  });

  test('超时控制', async () => {
    const controller = createMockController();
    tool.setPermissionController(controller);

    mockHandler.mockImplementation(async (request: AskUserRequest) => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return '回答';
    });

    const result = await tool.execute({
      question: '超时问题',
      timeout: 100,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('超时');
  });

  test('Agent 上下文注入', async () => {
    const controller = createMockController();
    tool.setPermissionController(controller);

    const result = await tool.execute({
      question: '测试问题',
      _agentId: 'coder',
      _agentName: 'Coder Agent',
      priority: 7,
      timeout: 60000,
    });

    expect(mockHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        question: '测试问题',
        context: expect.objectContaining({
          agentId: 'coder',
          agentName: 'Coder Agent',
          priority: 7,
          timeout: 60000,
        }),
      })
    );
  });

  test('队列为空时立即处理', async () => {
    const controller = createMockController();
    tool.setPermissionController(controller);

    const startTime = Date.now();
    const result = await tool.execute({ question: '单个问题' });
    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(150);
    expect(result.content).toBe('回答: 单个问题');
  });

  test('handler 未设置时返回错误', async () => {
    const toolWithoutHandler = new AskUserTool();

    const result = await toolWithoutHandler.execute({ question: '测试' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('用户交互不可用');
  });

  test('空问题返回错误', async () => {
    const result = await tool.execute({ question: '' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('问题不能为空');
  });

  test('无 PermissionController 时直接执行（不排队）', async () => {
    const results = await Promise.all([
      tool.execute({ question: 'A' }),
      tool.execute({ question: 'B' }),
    ]);

    expect(results[0].content).toBe('回答: A');
    expect(results[1].content).toBe('回答: B');
    // 无队列时可能并发执行
    expect(mockHandler).toHaveBeenCalledTimes(2);
  });
});

/**
 * 集成测试：模拟真实场景
 */
describe('AskUserTool - 集成测试', () => {
  test('并行 Agent 场景（通过统一队列串行处理）', async () => {
    const tool = new AskUserTool();
    const controller = createMockController();
    tool.setPermissionController(controller);

    const answers = new Map<string, string>([
      ['Agent A 的问题', '回答 A'],
      ['Agent B 的问题', '回答 B'],
      ['Agent C 的问题', '回答 C'],
    ]);

    tool.setHandler(async (request) => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return answers.get(request.question) || '默认回答';
    });

    const results = await Promise.all([
      tool.execute({ question: 'Agent A 的问题', _agentId: 'agent-a', _agentName: 'Agent A' }),
      tool.execute({ question: 'Agent B 的问题', _agentId: 'agent-b', _agentName: 'Agent B' }),
      tool.execute({ question: 'Agent C 的问题', _agentId: 'agent-c', _agentName: 'Agent C' }),
    ]);

    expect(results[0].content).toBe('回答 A');
    expect(results[1].content).toBe('回答 B');
    expect(results[2].content).toBe('回答 C');
  });
});
