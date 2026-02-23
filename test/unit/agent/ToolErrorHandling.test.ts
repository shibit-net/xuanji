import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '@/core/agent/AgentLoop';
import type { ILLMProvider, StreamEvent, IToolRegistry, ToolResult, ToolSchema, AgentConfig } from '@/core/types';

/**
 * 创建 mock Provider - 模拟工具调用
 */
function createMockProviderWithToolCall(): ILLMProvider {
  let callCount = 0;
  return {
    name: 'mock',
    models: ['mock-model'],
    isSupported: (model: string) => model.includes('mock'),
    stream: vi.fn(async function* (): AsyncIterable<StreamEvent> {
      callCount++;

      if (callCount === 1) {
        yield { type: 'usage', usage: { input: 10, output: 0 } };
        yield {
          type: 'tool_use_end',
          toolCall: {
            id: 'read_file_1',
            name: 'read_file',
            input: { path: '/tmp/test.txt' }
          }
        };
        yield {
          type: 'end',
          stopReason: 'tool_use',
          usage: { input: 0, output: 20 }
        };
      } else {
        yield { type: 'usage', usage: { input: 10, output: 0 } };
        yield { type: 'text_delta', text: 'Done' };
        yield {
          type: 'end',
          stopReason: 'end_turn',
          usage: { input: 0, output: 20 }
        };
      }
    }),
  };
}

/**
 * 创建会出现异常的 mock ToolRegistry
 */
function createFailingRegistry(): IToolRegistry {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(),
    getAll: vi.fn(() => []),
    getSchemas: vi.fn(() => [{
      name: 'read_file',
      description: 'Read a file',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' }
        }
      }
    }]),
    has: vi.fn(() => true),
    execute: vi.fn(async (name: string, input: Record<string, unknown>) => {
      console.log(`[Mock Tool] Executing: ${name}`);
      throw new Error(`Tool execution failed for ${name}`);
    }),
  };
}

describe('Tool Execution Error Handling', () => {
  let provider: ILLMProvider;
  let config: AgentConfig;

  beforeEach(() => {
    provider = createMockProviderWithToolCall();
    config = {
      model: 'mock-model',
      maxTokens: 1024,
      systemPrompt: 'You are a helpful assistant',
      maxIterations: 10,
    };
  });

  it('当工具执行异常时，应该调用 onToolEnd 并设置 isError=true', async () => {
    const registry = createFailingRegistry();
    const agentLoop = new AgentLoop(provider, registry, config);

    let toolStartCalled = false;
    let toolEndCalled = false;
    let toolEndIsError = false;
    let endCalled = false;

    agentLoop.on({
      onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
        console.log(`[Test] onToolStart: ${name}`);
        toolStartCalled = true;
      },
      onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
        console.log(`[Test] onToolEnd: ${name}, isError=${isError}`);
        toolEndCalled = true;
        toolEndIsError = isError;
      },
      onEnd: (state) => {
        console.log(`[Test] onEnd`);
        endCalled = true;
      }
    });

    await agentLoop.run('test');

    console.log(`[Test Results]`);
    console.log(`  toolStartCalled: ${toolStartCalled}`);
    console.log(`  toolEndCalled: ${toolEndCalled}`);
    console.log(`  toolEndIsError: ${toolEndIsError}`);
    console.log(`  endCalled: ${endCalled}`);

    // 工具应该被启动
    expect(toolStartCalled).toBe(true);

    // 工具执行异常，onToolEnd 应该被调用且 isError=true
    expect(toolEndCalled).toBe(true);
    expect(toolEndIsError).toBe(true);
    expect(endCalled).toBe(true);
  });
});
