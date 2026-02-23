import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '@/core/agent/AgentLoop';
import type { ILLMProvider, StreamEvent, IToolRegistry, ToolResult, ToolSchema, AgentConfig } from '@/core/types';

/**
 * 创建 mock Provider - 模拟返回 read_file 工具调用，然后是最终答案
 */
function createMockProviderWithReadFile(): ILLMProvider {
  let callCount = 0;
  return {
    name: 'mock',
    models: ['mock-model'],
    isSupported: (model: string) => model.includes('mock'),
    stream: vi.fn(async function* (): AsyncIterable<StreamEvent> {
      callCount++;
      console.log(`\n[Mock Provider] Call #${callCount}`);

      if (callCount === 1) {
        // 第一次调用：返回工具调用
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
        // 第二次调用：返回最终答案，不再有工具调用
        yield { type: 'usage', usage: { input: 10, output: 0 } };
        yield {
          type: 'text_delta',
          text: 'Here is the content of the file.'
        };
        yield {
          type: 'end',
          stopReason: 'end_turn',
          usage: { input: 0, output: 30 }
        };
      }
    }),
  };
}

/**
 * 创建 mock ToolRegistry
 */
function createMockRegistry(): IToolRegistry {
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
      console.log(`[Mock Tool] Executing: ${name} with input:`, input);
      // 模拟工具执行延迟
      await new Promise(resolve => setTimeout(resolve, 100));
      return {
        content: `File content: test data from ${(input.path as string) || 'unknown'}`,
        isError: false
      };
    }),
  };
}

describe('Tool Execution with Callbacks', () => {
  let provider: ILLMProvider;
  let registry: IToolRegistry;
  let config: AgentConfig;

  beforeEach(() => {
    provider = createMockProviderWithReadFile();
    registry = createMockRegistry();
    config = {
      model: 'mock-model',
      maxTokens: 1024,
      systemPrompt: 'You are a helpful assistant',
      maxIterations: 10,
    };
  });

  it('应该正确调用 onToolStart 和 onToolEnd 回调', async () => {
    const agentLoop = new AgentLoop(provider, registry, config);

    const callLog: string[] = [];

    agentLoop.on({
      onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
        const msg = `[Test] onToolStart: ${name} (id=${id})`;
        console.log(msg);
        callLog.push(msg);
      },
      onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
        const msg = `[Test] onToolEnd: ${name} (id=${id}), isError=${isError}`;
        console.log(msg);
        callLog.push(msg);
      },
      onEnd: (state) => {
        console.log(`[Test] onEnd: messages=${state.messages.length}`);
      }
    });

    await agentLoop.run('read the file');

    // 验证回调被调用
    expect(callLog).toContain('[Test] onToolStart: read_file (id=read_file_1)');
    expect(callLog).toContain('[Test] onToolEnd: read_file (id=read_file_1), isError=false');

    // 验证顺序：onToolStart 应该在 onToolEnd 之前
    const startIndex = callLog.findIndex(m => m.includes('onToolStart'));
    const endIndex = callLog.findIndex(m => m.includes('onToolEnd'));
    expect(startIndex).toBeLessThan(endIndex);
  });
});
