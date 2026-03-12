import { describe, it, expect, vi } from 'vitest';
import { ToolDispatcher } from '@/core/agent/ToolDispatcher';
import type { IToolRegistry, ToolCall, ToolResult } from '@/core/types';

function createMockRegistry(): IToolRegistry {
  return {
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn(),
    getAll: vi.fn(() => []),
    getSchemas: vi.fn(() => []),
    has: vi.fn(),
    execute: vi.fn(async (name: string, input: Record<string, unknown>): Promise<ToolResult> => ({
      content: `result from ${name}`,
      isError: false,
    })),
  };
}

describe('ToolDispatcher', () => {
  it('execute() 应调用 registry.execute', async () => {
    const registry = createMockRegistry();
    const dispatcher = new ToolDispatcher(registry);

    const toolCall: ToolCall = {
      id: 'tc-1',
      name: 'read_file',
      input: { path: '/tmp/test.txt' },
    };

    const result = await dispatcher.execute(toolCall);
    expect(result.content).toBe('result from read_file');
    expect(registry.execute).toHaveBeenCalledWith('read_file', { path: '/tmp/test.txt' }, expect.any(AbortSignal));
  });

  it('executeAll() 应顺序执行所有工具调用', async () => {
    const callOrder: string[] = [];
    const registry = createMockRegistry();
    vi.mocked(registry.execute).mockImplementation(async (name: string) => {
      callOrder.push(name);
      return { content: `result from ${name}`, isError: false };
    });

    const dispatcher = new ToolDispatcher(registry);

    const toolCalls: ToolCall[] = [
      { id: 'tc-1', name: 'read_file', input: { path: '/a' } },
      { id: 'tc-2', name: 'write_file', input: { path: '/b', content: 'x' } },
      { id: 'tc-3', name: 'bash', input: { command: 'ls' } },
    ];

    const results = await dispatcher.executeAll(toolCalls);

    expect(results.size).toBe(3);
    expect(callOrder).toEqual(['read_file', 'write_file', 'bash']);
    expect(results.get('tc-1')?.content).toBe('result from read_file');
    expect(results.get('tc-2')?.content).toBe('result from write_file');
    expect(results.get('tc-3')?.content).toBe('result from bash');
  });
});
