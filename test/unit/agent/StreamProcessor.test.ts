import { describe, it, expect, beforeEach } from 'vitest';
import { StreamProcessor } from '@/core/agent/StreamProcessor';
import type { StreamEvent, StopReason } from '@/core/types';

describe('StreamProcessor', () => {
  let processor: StreamProcessor;

  beforeEach(() => {
    processor = new StreamProcessor();
  });

  // 辅助函数: 创建异步可迭代流
  async function* createMockStream(events: StreamEvent[]): AsyncIterable<StreamEvent> {
    for (const event of events) {
      yield event;
    }
  }

  it('应处理纯文本流', async () => {
    const textChunks: string[] = [];
    processor.onTextDelta((text) => textChunks.push(text));

    const events: StreamEvent[] = [
      { type: 'text_delta', text: 'Hello ' },
      { type: 'text_delta', text: 'world' },
      { type: 'end', stopReason: 'end_turn', usage: { input: 100, output: 50 } },
    ];

    const result = await processor.consume(createMockStream(events));
    expect(textChunks).toEqual(['Hello ', 'world']);
    expect(result.stopReason).toBe('end_turn');
    expect(result.contentBlocks).toHaveLength(1);
    expect(result.contentBlocks[0].text).toBe('Hello world');
  });

  it('应处理 thinking 流', async () => {
    const thinkingChunks: string[] = [];
    processor.onThinkingDelta((text) => thinkingChunks.push(text));

    const events: StreamEvent[] = [
      { type: 'thinking_delta', thinking: '让我想想...' },
      { type: 'text_delta', text: '回复' },
      { type: 'end', stopReason: 'end_turn' },
    ];

    const result = await processor.consume(createMockStream(events));
    expect(thinkingChunks).toEqual(['让我想想...']);
    expect(result.contentBlocks).toHaveLength(2); // thinking + text
  });

  it('应处理工具调用流', async () => {
    const toolCalls: any[] = [];
    processor.onToolUse((tc) => toolCalls.push(tc));

    const events: StreamEvent[] = [
      { type: 'text_delta', text: '读取文件 ' },
      { type: 'tool_use_start', toolCall: { id: 'tc-1', name: 'read_file', input: {} } },
      { type: 'tool_use_delta', text: '{"path": "/tmp/test"}' },
      { type: 'tool_use_end', toolCall: { id: 'tc-1', name: 'read_file', input: { path: '/tmp/test' } } },
      { type: 'end', stopReason: 'tool_use' },
    ];

    const result = await processor.consume(createMockStream(events));
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('read_file');
    expect(result.toolCalls[0].input).toEqual({ path: '/tmp/test' });
    expect(result.stopReason).toBe('tool_use');
    expect(toolCalls).toHaveLength(1);
  });

  it('应处理 usage 事件', async () => {
    const usages: any[] = [];
    processor.onUsage((u) => usages.push(u));

    const events: StreamEvent[] = [
      { type: 'usage', usage: { input: 100, output: 0 } },
      { type: 'text_delta', text: 'test' },
      { type: 'end', stopReason: 'end_turn', usage: { input: 0, output: 50 } },
    ];

    const result = await processor.consume(createMockStream(events));
    expect(result.usage.input).toBe(100);
    expect(result.usage.output).toBe(50);
    expect(usages).toHaveLength(1); // usage handler only for 'usage' events
  });

  it('应在 error 事件时抛出异常', async () => {
    const events: StreamEvent[] = [
      { type: 'error', error: new Error('API 出错了') },
    ];

    await expect(processor.consume(createMockStream(events))).rejects.toThrow('API 出错了');
  });

  it('空流应返回默认结果', async () => {
    const result = await processor.consume(createMockStream([]));
    expect(result.stopReason).toBe('end_turn');
    expect(result.toolCalls).toEqual([]);
    expect(result.contentBlocks).toEqual([]);
  });
});
