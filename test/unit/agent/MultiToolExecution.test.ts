import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '@/core/agent/AgentLoop';
import type { ILLMProvider, StreamEvent, IToolRegistry, ToolResult, ToolSchema, AgentConfig } from '@/core/types';

/**
 * 创建 mock Provider - 模拟返回多个工具调用的情况
 */
function createMockProviderWithMultipleTools(): ILLMProvider {
  let callCount = 0;
  return {
    name: 'mock',
    models: ['mock-model'],
    isSupported: (model: string) => model.includes('mock'),
    stream: vi.fn(async function* (): AsyncIterable<StreamEvent> {
      callCount++;
      console.log(`\n[Mock Provider] Call #${callCount}`);

      if (callCount === 1) {
        // 第一次调用：返回两个工具调用（并发）
        yield { type: 'usage', usage: { input: 10, output: 0 } };

        yield {
          type: 'tool_use_end',
          toolCall: {
            id: 'read_file_1',
            name: 'read_file',
            input: { path: '/tmp/file1.txt' }
          }
        };

        yield {
          type: 'tool_use_end',
          toolCall: {
            id: 'read_file_2',
            name: 'read_file',
            input: { path: '/tmp/file2.txt' }
          }
        };

        yield {
          type: 'end',
          stopReason: 'tool_use',
          usage: { input: 0, output: 30 }
        };
      } else {
        // 第二次调用：返回最终答案
        yield { type: 'usage', usage: { input: 10, output: 0 } };
        yield {
          type: 'text_delta',
          text: 'Both files have been read.'
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
      console.log(`[Mock Tool] Executing: ${name} with path=${input.path}`);
      // 模拟工具执行延迟
      await new Promise(resolve => setTimeout(resolve, 50));
      console.log(`[Mock Tool] Completed: ${name}`);
      return {
        content: `File content from ${(input.path as string) || 'unknown'}`,
        isError: false
      };
    }),
  };
}

describe('Multiple Tool Execution', () => {
  let provider: ILLMProvider;
  let registry: IToolRegistry;
  let config: AgentConfig;

  beforeEach(() => {
    provider = createMockProviderWithMultipleTools();
    registry = createMockRegistry();
    config = {
      model: 'mock-model',
      maxTokens: 1024,
      systemPrompt: 'You are a helpful assistant',
      maxIterations: 10,
    };
  });

  it('应该正确处理多个并发工具调用', async () => {
    const agentLoop = new AgentLoop(provider, registry, config);

    const toolStarts: Array<{id: string, name: string}> = [];
    const toolEnds: Array<{id: string, name: string}> = [];
    let toolsInProgress = 0;
    let maxConcurrent = 0;

    agentLoop.on({
      onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
        console.log(`[Callback] onToolStart: ${name} (id=${id})`);
        toolStarts.push({ id, name });
        toolsInProgress++;
        maxConcurrent = Math.max(maxConcurrent, toolsInProgress);
      },
      onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
        console.log(`[Callback] onToolEnd: ${name} (id=${id}), toolsInProgress after this=${toolsInProgress - 1}`);
        toolEnds.push({ id, name });
        toolsInProgress--;
      },
      onEnd: (state) => {
        console.log(`[Callback] onEnd: messages=${state.messages.length}, toolsInProgress=${toolsInProgress}`);
      }
    });

    await agentLoop.run('read files');

    // 验证两个工具都被启动
    expect(toolStarts).toHaveLength(2);
    expect(toolStarts).toContainEqual({ id: 'read_file_1', name: 'read_file' });
    expect(toolStarts).toContainEqual({ id: 'read_file_2', name: 'read_file' });

    // 验证两个工具都被结束
    expect(toolEnds).toHaveLength(2);
    expect(toolEnds).toContainEqual({ id: 'read_file_1', name: 'read_file' });
    expect(toolEnds).toContainEqual({ id: 'read_file_2', name: 'read_file' });

    // 验证最后没有工具在进行中
    expect(toolsInProgress).toBe(0);

    // 验证有并发
    expect(maxConcurrent).toBe(2);
  });
});
