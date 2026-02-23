import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLoop } from '@/core/agent/AgentLoop';
import type { ILLMProvider, StreamEvent, IToolRegistry, ToolSchema, AgentConfig } from '@/core/types';

/**
 * 创建 mock Provider - 模拟两个并行的 read_file 工具调用
 * 这重现用户的场景：
 * read_file path=src/core/chat/ChatSession.ts, limit=100
 * read_file path=src/core/agent/AgentLoop.ts, limit=60
 */
function createMockProviderWithParallelReadFiles(): ILLMProvider {
  let callCount = 0;
  return {
    name: 'mock',
    models: ['mock-model'],
    isSupported: (model: string) => model.includes('mock'),
    stream: vi.fn(async function* (): AsyncIterable<StreamEvent> {
      callCount++;
      console.log(`\n[Mock Provider] Call #${callCount}`);

      if (callCount === 1) {
        // 第一次调用：返回两个并行的工具调用
        yield { type: 'usage', usage: { input: 10, output: 0 } };

        // 工具 1 开始
        yield {
          type: 'tool_use_start',
          toolCall: {
            id: 'read_file_chatSession',
            name: 'read_file',
            input: {}
          }
        };

        // 工具 1 结束（带完整的 input）
        yield {
          type: 'tool_use_end',
          toolCall: {
            id: 'read_file_chatSession',
            name: 'read_file',
            input: { path: 'src/core/chat/ChatSession.ts', limit: 100 }
          }
        };

        // 工具 2 开始
        yield {
          type: 'tool_use_start',
          toolCall: {
            id: 'read_file_agentLoop',
            name: 'read_file',
            input: {}
          }
        };

        // 工具 2 结束（带完整的 input）
        yield {
          type: 'tool_use_end',
          toolCall: {
            id: 'read_file_agentLoop',
            name: 'read_file',
            input: { path: 'src/core/agent/AgentLoop.ts', limit: 60 }
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
        yield { type: 'text_delta', text: 'Both files have been read successfully.' };
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
          path: { type: 'string' },
          limit: { type: 'number' }
        }
      }
    }]),
    has: vi.fn(() => true),
    execute: vi.fn(async (name: string, input: Record<string, unknown>) => {
      console.log(`[Mock Tool] Executing: ${name} with path=${input.path}, limit=${input.limit}`);
      // 模拟工具执行延迟
      await new Promise(resolve => setTimeout(resolve, 100));
      console.log(`[Mock Tool] Completed: ${name}`);
      return {
        content: `File content from ${(input.path as string) || 'unknown'} (lines)`,
        isError: false
      };
    }),
  };
}

describe('Parallel Tool Execution (User Issue)', () => {
  let provider: ILLMProvider;
  let registry: IToolRegistry;
  let config: AgentConfig;

  beforeEach(() => {
    provider = createMockProviderWithParallelReadFiles();
    registry = createMockRegistry();
    config = {
      model: 'mock-model',
      maxTokens: 1024,
      systemPrompt: 'You are a helpful assistant',
      maxIterations: 10,
    };
  });

  it('多个并行 read_file 应该都正确完成而不是一直显示"执行中"', async () => {
    const agentLoop = new AgentLoop(provider, registry, config);

    const toolStarts: string[] = [];
    const toolEnds: string[] = [];
    let toolsStillRunning = 0;

    agentLoop.on({
      onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
        console.log(`[Test] onToolStart: ${name} (id=${id}), input=${JSON.stringify(input)}`);
        toolStarts.push(id);
        toolsStillRunning++;
      },
      onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
        console.log(`[Test] onToolEnd: ${name} (id=${id}), isError=${isError}, toolsStillRunning=${toolsStillRunning - 1}`);
        toolEnds.push(id);
        toolsStillRunning--;
      },
      onEnd: (state) => {
        console.log(`[Test] onEnd: messages=${state.messages.length}, toolsStillRunning=${toolsStillRunning}`);
      }
    });

    await agentLoop.run('read both files');

    console.log('[Test Results]');
    console.log('  toolStarts:', toolStarts);
    console.log('  toolEnds:', toolEnds);
    console.log('  toolsStillRunning:', toolsStillRunning);

    // 验证两个工具都被启动
    expect(toolStarts).toHaveLength(2);
    expect(toolStarts).toContain('read_file_chatSession');
    expect(toolStarts).toContain('read_file_agentLoop');

    // 验证两个工具都完成了（关键：不是"一直显示执行中"）
    expect(toolEnds).toHaveLength(2);
    expect(toolEnds).toContain('read_file_chatSession');
    expect(toolEnds).toContain('read_file_agentLoop');

    // 验证最后没有工具仍在运行
    expect(toolsStillRunning).toBe(0);

    // 验证所有 start 都有对应的 end
    for (const id of toolStarts) {
      expect(toolEnds).toContain(id);
    }
  });
});
