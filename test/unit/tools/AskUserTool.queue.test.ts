/**
 * AskUser 工具并发控制测试
 *
 * 测试场景：
 * 1. 多个 agent 同时提问
 * 2. 优先级排序
 * 3. 超时控制
 */

import { describe, test, beforeEach, expect, vi } from 'vitest';
import { AskUserTool } from '@/core/tools/AskUserTool';
import type { AskUserRequest, AskUserHandler } from '@/core/tools/AskUserTool';

describe('AskUserTool - 并发控制', () => {
  let tool: AskUserTool;
  let mockHandler: ReturnType<typeof vi.fn<Parameters<AskUserHandler>, ReturnType<AskUserHandler>>>;
  let handlerCallOrder: string[] = [];

  beforeEach(() => {
    tool = new AskUserTool();
    handlerCallOrder = [];

    // Mock handler：记录调用顺序
    mockHandler = vi.fn<Parameters<AskUserHandler>, ReturnType<AskUserHandler>>(async (request: AskUserRequest) => {
      handlerCallOrder.push(request.question);
      // 模拟用户回复延迟
      await new Promise(resolve => setTimeout(resolve, 100));
      return `回答: ${request.question}`;
    });

    tool.setHandler(mockHandler);
  });

  test('多个问题自动排队', async () => {
    // 同时发起 3 个问题
    const promises = [
      tool.execute({ question: '问题 1' }),
      tool.execute({ question: '问题 2' }),
      tool.execute({ question: '问题 3' }),
    ];

    // 等待所有问题完成
    const results = await Promise.all(promises);

    // 验证：所有问题都得到回复
    expect(results).toHaveLength(3);
    expect(results[0].content).toBe('回答: 问题 1');
    expect(results[1].content).toBe('回答: 问题 2');
    expect(results[2].content).toBe('回答: 问题 3');

    // 验证：handler 被串行调用（一次一个）
    expect(mockHandler).toHaveBeenCalledTimes(3);
    expect(handlerCallOrder).toEqual(['问题 1', '问题 2', '问题 3']);
  });

  test('优先级排序', async () => {
    // 发起不同优先级的问题
    const promises = [
      tool.execute({ question: '低优先级', priority: 3 }),
      tool.execute({ question: '高优先级', priority: 9 }),
      tool.execute({ question: '中优先级', priority: 5 }),
    ];

    await Promise.all(promises);

    // 验证：按优先级排序（高优先级先处理）
    expect(handlerCallOrder).toEqual([
      '低优先级',    // 第一个进入队列，立即处理
      '高优先级',    // 优先级最高，排在第二
      '中优先级',    // 优先级中等，排在最后
    ]);
  });

  test('优先级相同时按时间排序', async () => {
    // 发起相同优先级的问题
    const promises = [
      tool.execute({ question: '问题 A', priority: 5 }),
      tool.execute({ question: '问题 B', priority: 5 }),
      tool.execute({ question: '问题 C', priority: 5 }),
    ];

    await Promise.all(promises);

    // 验证：按提问时间排序（先到先得）
    expect(handlerCallOrder).toEqual(['问题 A', '问题 B', '问题 C']);
  });

  test('超时控制', async () => {
    // Mock handler：延迟 200ms 回复
    mockHandler.mockImplementation(async (request: AskUserRequest) => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return '回答';
    });

    // 设置 100ms 超时
    const result = await tool.execute({
      question: '超时问题',
      timeout: 100,
    });

    // 验证：超时返回错误
    expect(result.isError).toBe(true);
    expect(result.content).toContain('超时');
  });

  test('Agent 上下文注入', async () => {
    // 模拟 SubAgentFactory 注入的上下文
    const result = await tool.execute({
      question: '测试问题',
      _agentId: 'coder',
      _agentName: 'Coder Agent',
      priority: 7,
      timeout: 60000,
    });

    // 验证：handler 收到完整的上下文
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

  test('高优先级问题插队', async () => {
    // 第一个问题开始处理
    const promise1 = tool.execute({ question: '问题 1', priority: 5 });

    // 等待第一个问题开始处理
    await new Promise(resolve => setTimeout(resolve, 50));

    // 发起高优先级问题（应该插队）
    const promise2 = tool.execute({ question: '紧急问题', priority: 10 });
    const promise3 = tool.execute({ question: '问题 3', priority: 5 });

    await Promise.all([promise1, promise2, promise3]);

    // 验证：高优先级问题插队到第二位
    expect(handlerCallOrder).toEqual([
      '问题 1',      // 已经在处理，无法插队
      '紧急问题',    // 高优先级，插队到第二
      '问题 3',      // 普通优先级，排在最后
    ]);
  });

  test('队列为空时立即处理', async () => {
    const startTime = Date.now();

    const result = await tool.execute({ question: '单个问题' });

    const duration = Date.now() - startTime;

    // 验证：立即处理，不等待
    expect(duration).toBeLessThan(150);  // 100ms 延迟 + 50ms 容差
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
});

/**
 * 集成测试：模拟真实场景
 */
describe('AskUserTool - 集成测试', () => {
  test('并行 Agent 场景', async () => {
    const tool = new AskUserTool();
    const answers = new Map<string, string>([
      ['Agent A 的问题', '回答 A'],
      ['Agent B 的问题', '回答 B'],
      ['Agent C 的问题', '回答 C'],
    ]);

    tool.setHandler(async (request) => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return answers.get(request.question) || '默认回答';
    });

    // 模拟 3 个 agent 同时提问
    const results = await Promise.all([
      tool.execute({
        question: 'Agent A 的问题',
        _agentId: 'agent-a',
        _agentName: 'Agent A',
        priority: 5,
      }),
      tool.execute({
        question: 'Agent B 的问题',
        _agentId: 'agent-b',
        _agentName: 'Agent B',
        priority: 8,  // 高优先级
      }),
      tool.execute({
        question: 'Agent C 的问题',
        _agentId: 'agent-c',
        _agentName: 'Agent C',
        priority: 3,  // 低优先级
      }),
    ]);

    // 验证：所有 agent 都得到回复
    expect(results[0].content).toBe('回答 A');
    expect(results[1].content).toBe('回答 B');
    expect(results[2].content).toBe('回答 C');
  });
});
