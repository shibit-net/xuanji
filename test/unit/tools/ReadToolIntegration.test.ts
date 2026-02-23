import { describe, it, expect, beforeEach } from 'vitest';
import { ChatSession } from '@/core/chat/ChatSession';
import type { ILLMProvider, StreamEvent, IToolRegistry, ToolSchema, AppConfig } from '@/core/types';
import { ReadTool } from '@/core/tools/ReadTool';

/**
 * 创建 mock Provider - 模拟调用 read_file 工具
 */
function createMockProviderWithReadFile(): ILLMProvider {
  let callCount = 0;
  return {
    name: 'mock',
    models: ['mock-model'],
    isSupported: (model: string) => model.includes('mock'),
    stream: async function* (): AsyncIterable<StreamEvent> {
      callCount++;

      if (callCount === 1) {
        // 第一次调用：返回 read_file 工具调用
        yield { type: 'usage', usage: { input: 10, output: 0 } };

        // 工具调用开始
        yield {
          type: 'tool_use_start',
          toolCall: {
            id: 'read_file_1',
            name: 'read_file',
            input: {}
          }
        };

        // 工具调用结束（带完整的 input）
        yield {
          type: 'tool_use_end',
          toolCall: {
            id: 'read_file_1',
            name: 'read_file',
            input: {
              path: 'src/core/providers/ProviderFactory.ts',
              limit: 50
            }
          }
        };

        yield {
          type: 'end',
          stopReason: 'tool_use',
          usage: { input: 0, output: 20 }
        };
      } else {
        // 第二次调用：返回最终答案
        yield { type: 'usage', usage: { input: 10, output: 0 } };
        yield { type: 'text_delta', text: 'File read successfully.' };
        yield {
          type: 'end',
          stopReason: 'end_turn',
          usage: { input: 0, output: 20 }
        };
      }
    },
  };
}

describe('ReadTool Integration', () => {
  let provider: ILLMProvider;
  let config: AppConfig;

  beforeEach(() => {
    provider = createMockProviderWithReadFile();
    config = {
      provider: {
        model: 'mock-model',
        adapter: 'mock',
        apiKey: 'test-key',
        baseURL: 'http://test',
      },
      ui: {
        theme: 'auto',
        language: 'en',
        showTokenUsage: true,
        showCost: true,
        showThinking: false,
      },
      tools: {
        enabled: ['read_file'],
        permissions: {
          fileRead: 'always',
          fileWrite: 'ask',
          bashExec: 'ask',
        },
      },
      retry: {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2,
        retryableStatusCodes: [429, 500, 502, 503, 529],
      },
    };
  });

  it('read_file 工具应该正确执行并调用 onToolEnd', async () => {
    const session = new ChatSession({ provider, config });
    await session.init();
    const agentLoop = session.getAgentLoop();

    const toolLifecycle: Array<{ event: string; name?: string }> = [];

    agentLoop.on({
      onToolStart: (id: string, name: string, input: Record<string, unknown>) => {
        console.log(`[Test] onToolStart: ${name} (id=${id})`);
        toolLifecycle.push({ event: 'start', name });
      },
      onToolEnd: (id: string, name: string, result: string, isError: boolean) => {
        console.log(`[Test] onToolEnd: ${name} (id=${id}), isError=${isError}, resultLen=${result.length}`);
        toolLifecycle.push({ event: 'end', name });
      },
      onError: (error: Error) => {
        console.log(`[Test] onError: ${error.message}`);
        toolLifecycle.push({ event: 'error' });
      },
      onEnd: (state) => {
        console.log(`[Test] onEnd: messages=${state.messages.length}`);
      }
    });

    await agentLoop.run('read the ProviderFactory.ts file');

    console.log('[Test] Tool lifecycle:', toolLifecycle);

    // 验证工具执行流程
    expect(toolLifecycle).toContainEqual({ event: 'start', name: 'read_file' });
    expect(toolLifecycle).toContainEqual({ event: 'end', name: 'read_file' });

    // 验证 start 在 end 之前
    const startIdx = toolLifecycle.findIndex(x => x.event === 'start');
    const endIdx = toolLifecycle.findIndex(x => x.event === 'end');
    expect(startIdx).toBeLessThan(endIdx);
  });
});
