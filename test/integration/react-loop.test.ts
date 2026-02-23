import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '@/core/agent/AgentLoop';
import { ToolRegistry } from '@/core/tools/ToolRegistry';
import type {
  ILLMProvider,
  StreamEvent,
  AgentConfig,
  ProviderConfig,
  Message,
  ToolSchema,
  AgentState,
} from '@/core/types';

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

/**
 * 创建 mock 工具注册表（带自定义工具）
 */
function createMockRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // 添加一个简单的 mock 工具
  registry.register({
    name: 'mock_tool',
    description: 'A mock tool for testing',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
    execute: vi.fn(async (input: Record<string, unknown>) => ({
      content: `result for: ${input.query}`,
      isError: false,
    })),
  });

  return registry;
}

const defaultAgentConfig: AgentConfig = {
  model: 'mock-model',
  maxTokens: 4096,
  maxIterations: 10,
};

describe('ReAct 循环集成测试', () => {
  it('应完成一个无工具调用的简单对话', async () => {
    // LLM 直接返回文本，无工具调用
    const provider = createMockProvider([
      [
        { type: 'usage', usage: { input: 50, output: 0 } },
        { type: 'text_delta', text: '你好！' },
        { type: 'text_delta', text: '有什么' },
        { type: 'text_delta', text: '需要帮助的？' },
        { type: 'end', stopReason: 'end_turn', usage: { input: 0, output: 30 } },
      ],
    ]);

    const registry = createMockRegistry();
    const agent = new AgentLoop(provider, registry, defaultAgentConfig);

    const texts: string[] = [];
    let finalState: AgentState | undefined;

    agent.on({
      onText: (text) => texts.push(text),
      onEnd: (state) => { finalState = state; },
    });

    await agent.run('你好');

    expect(texts.join('')).toBe('你好！有什么需要帮助的？');
    expect(finalState).toBeDefined();
    expect(finalState!.status).toBe('idle');
    expect(provider.stream).toHaveBeenCalledTimes(1);
  });

  it('应完成一轮 ReAct 循环（文本 → 工具 → 文本）', async () => {
    const registry = createMockRegistry();

    // 第一轮: LLM 调用工具
    // 第二轮: LLM 返回最终文本
    const provider = createMockProvider([
      // 第一轮: 调用 mock_tool
      [
        { type: 'usage', usage: { input: 100, output: 0 } },
        { type: 'text_delta', text: '让我查一下...' },
        { type: 'tool_use_start', toolCall: { id: 'tc-1', name: 'mock_tool', input: {} } },
        { type: 'tool_use_delta', text: '{"query":"test"}' },
        { type: 'tool_use_end', toolCall: { id: 'tc-1', name: 'mock_tool', input: { query: 'test' } } },
        { type: 'end', stopReason: 'tool_use', usage: { input: 0, output: 80 } },
      ],
      // 第二轮: 工具结果后，LLM 给出最终回复
      [
        { type: 'usage', usage: { input: 200, output: 0 } },
        { type: 'text_delta', text: '查到了结果。' },
        { type: 'end', stopReason: 'end_turn', usage: { input: 0, output: 20 } },
      ],
    ]);

    const agent = new AgentLoop(provider, registry, defaultAgentConfig);

    const toolStarts: string[] = [];
    const toolEnds: Array<{ name: string; result: string; isError: boolean }> = [];

    agent.on({
      onToolStart: (name) => toolStarts.push(name),
      onToolEnd: (name, result, isError) => toolEnds.push({ name, result, isError }),
    });

    await agent.run('请帮我查询 test');

    // 工具被调用
    expect(toolStarts).toEqual(['mock_tool']);
    expect(toolEnds).toHaveLength(1);
    expect(toolEnds[0].name).toBe('mock_tool');
    expect(toolEnds[0].result).toContain('result for: test');
    expect(toolEnds[0].isError).toBe(false);

    // LLM 被调用了 2 次
    expect(provider.stream).toHaveBeenCalledTimes(2);
  });

  it('应在错误时调用 onError 回调', async () => {
    const provider = createMockProvider([
      [
        { type: 'error', error: new Error('API 连接失败') },
      ],
    ]);

    const registry = createMockRegistry();
    const agent = new AgentLoop(provider, registry, defaultAgentConfig);

    const errors: Error[] = [];
    agent.on({
      onError: (err) => errors.push(err),
    });

    await agent.run('测试错误处理');

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('API 连接失败');
  });

  it('stop() 应中断循环', async () => {
    // 模拟一个会无限循环调用工具的场景
    let callCount = 0;
    const provider: ILLMProvider = {
      name: 'mock',
      models: ['mock-model'],
      isSupported: () => true,
      stream: vi.fn(async function* (): AsyncIterable<StreamEvent> {
        callCount++;
        yield { type: 'usage', usage: { input: 10, output: 0 } };
        yield { type: 'text_delta', text: `round ${callCount}` };
        yield { type: 'tool_use_start', toolCall: { id: `tc-${callCount}`, name: 'mock_tool', input: {} } };
        yield { type: 'tool_use_end', toolCall: { id: `tc-${callCount}`, name: 'mock_tool', input: { query: 'stop' } } };
        yield { type: 'end', stopReason: 'tool_use', usage: { input: 0, output: 10 } };
      }),
    };

    const registry = createMockRegistry();
    const agent = new AgentLoop(provider, registry, { ...defaultAgentConfig, maxIterations: 100 });

    // 在第二次工具调用后停止
    agent.on({
      onToolEnd: () => {
        if (callCount >= 2) {
          agent.stop();
        }
      },
    });

    await agent.run('无限循环测试');
    expect(callCount).toBe(2);
  });

  it('reset() 应清空会话状态', async () => {
    const provider = createMockProvider([
      [
        { type: 'usage', usage: { input: 50, output: 0 } },
        { type: 'text_delta', text: '第一轮' },
        { type: 'end', stopReason: 'end_turn', usage: { input: 0, output: 10 } },
      ],
    ]);

    const registry = createMockRegistry();
    const agent = new AgentLoop(provider, registry, defaultAgentConfig);
    await agent.run('你好');

    let state = agent.getState();
    expect(state.messages.length).toBeGreaterThan(0);

    agent.reset();
    state = agent.getState();
    expect(state.messages.length).toBe(0);
    expect(state.currentIteration).toBe(0);
  });

  it('getState() 应返回正确的状态', async () => {
    const provider = createMockProvider([
      [
        { type: 'usage', usage: { input: 100, output: 0 } },
        { type: 'text_delta', text: '回复' },
        { type: 'end', stopReason: 'end_turn', usage: { input: 0, output: 50 } },
      ],
    ]);

    const registry = createMockRegistry();
    const agent = new AgentLoop(provider, registry, defaultAgentConfig);

    // 运行前状态
    let state = agent.getState();
    expect(state.status).toBe('idle');
    expect(state.currentIteration).toBe(0);

    await agent.run('测试状态');

    // 运行后状态
    state = agent.getState();
    expect(state.status).toBe('idle');
    expect(state.currentIteration).toBe(1);
    expect(state.tokenUsage.input).toBe(100);
    // 注: end 事件的 usage 仅在 StreamProcessor result 中累计,
    // 不经过 onUsage 回调, 因此 TokenManager 不记录 end 事件的 output tokens
    expect(state.tokenUsage.input).toBeGreaterThanOrEqual(0);
    expect(state.cost).toBeGreaterThanOrEqual(0);
  });
});
