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
    expect(usages).toHaveLength(2); // usage 事件 + end 事件中的 usage 都会触发 handler
    expect(usages[0]).toEqual({ input: 100, output: 0 });
    expect(usages[1]).toEqual({ input: 0, output: 50 });
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

  // ============================================================
  // 🆕 新增测试：验证内容追加优化
  // ============================================================

  describe('flush() 方法', () => {
    it('应返回当前累积的所有内容（完整消费流后）', async () => {
      processor.onTextDelta(() => {}); // 注册 handler 触发累积
      
      const events: StreamEvent[] = [
        { type: 'text_delta', text: 'Hello ' },
        { type: 'text_delta', text: 'world' },
        { type: 'thinking_delta', thinking: '思考中...' },
        // 不添加 end 事件，模拟中断场景
      ];

      // 完整消费流（不触发 end 事件）
      await processor.consume(createMockStream(events));

      // 调用 flush() 获取累积内容
      const flushed = processor.flush();
      
      expect(flushed.text).toBe('Hello world');
      expect(flushed.thinking).toBe('思考中...');
      expect(flushed.toolInput).toBe('');
    });

    it('flush 后应清空 buffer（可重复读取但清空内部状态）', async () => {
      processor.onTextDelta(() => {});

      const events: StreamEvent[] = [
        { type: 'text_delta', text: 'test' },
      ];

      await processor.consume(createMockStream(events));

      const flushed1 = processor.flush();
      expect(flushed1.text).toBe('test');

      // 再次 flush，内容应已清空
      const flushed2 = processor.flush();
      expect(flushed2.text).toBe('');
    });
  });

  describe('reset() 方法', () => {
    it('应清空所有累积 buffer', async () => {
      processor.onTextDelta(() => {});
      processor.onThinkingDelta(() => {});
      
      const events: StreamEvent[] = [
        { type: 'text_delta', text: 'Hello' },
        { type: 'thinking_delta', thinking: '思考' },
      ];

      await processor.consume(createMockStream(events));

      // 确认内容已累积
      let flushed = processor.flush();
      expect(flushed.text).toBe('Hello');
      expect(flushed.thinking).toBe('思考');

      // 重置
      processor.reset();

      // 确认已清空
      flushed = processor.flush();
      expect(flushed.text).toBe('');
      expect(flushed.thinking).toBe('');
      expect(flushed.toolInput).toBe('');
    });
  });

  describe('tool input JSON 累积与解析', () => {
    it('应通过 tool_use_delta 累积 JSON 片段', async () => {
      const events: StreamEvent[] = [
        { type: 'tool_use_start', toolCall: { id: 'tc-1', name: 'write_file', input: {} } },
        { type: 'tool_use_delta', text: '{"path":' },
        { type: 'tool_use_delta', text: '"/tmp/test",' },
        { type: 'tool_use_delta', text: '"content":"Hello"}' },
        { type: 'tool_use_end', toolCall: { id: 'tc-1', name: 'write_file', input: undefined } }, // Provider 未提供 input
        { type: 'end', stopReason: 'tool_use' },
      ];

      const result = await processor.consume(createMockStream(events));
      
      // 验证 StreamProcessor 自己解析了 JSON
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].input).toEqual({
        path: '/tmp/test',
        content: 'Hello',
      });
    });

    it('应优先使用 Provider 提供的 input（向后兼容）', async () => {
      const events: StreamEvent[] = [
        { type: 'tool_use_start', toolCall: { id: 'tc-1', name: 'read_file', input: {} } },
        { type: 'tool_use_delta', text: '{"invalid json' }, // 无效 JSON
        { type: 'tool_use_end', toolCall: { 
          id: 'tc-1', 
          name: 'read_file', 
          input: { path: '/correct/path' } // Provider 提供了正确的 input
        }},
        { type: 'end', stopReason: 'tool_use' },
      ];

      const result = await processor.consume(createMockStream(events));
      
      // 验证优先使用 Provider 的 input
      expect(result.toolCalls[0].input).toEqual({ path: '/correct/path' });
    });

    it('JSON 解析失败时应返回 _parse_error 标记', async () => {
      const events: StreamEvent[] = [
        { type: 'tool_use_start', toolCall: { id: 'tc-1', name: 'bash', input: {} } },
        { type: 'tool_use_delta', text: '{invalid json}' },
        { type: 'tool_use_end', toolCall: { id: 'tc-1', name: 'bash', input: undefined } },
        { type: 'end', stopReason: 'tool_use' },
      ];

      const result = await processor.consume(createMockStream(events));
      
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].input).toHaveProperty('_parse_error', true);
      expect(result.toolCalls[0].input).toHaveProperty('_raw');
      expect(result.toolCalls[0].input).toHaveProperty('_error_message');
    });

    it('应在 tool_use_end 后清空 tool input buffer', async () => {
      const events: StreamEvent[] = [
        { type: 'tool_use_start', toolCall: { id: 'tc-1', name: 'read_file', input: {} } },
        { type: 'tool_use_delta', text: '{"path":"/tmp/test"}' },
        { type: 'tool_use_end', toolCall: { id: 'tc-1', name: 'read_file', input: undefined } },
        { type: 'tool_use_start', toolCall: { id: 'tc-2', name: 'write_file', input: {} } },
        { type: 'tool_use_delta', text: '{"path":"/tmp/output"}' },
        { type: 'tool_use_end', toolCall: { id: 'tc-2', name: 'write_file', input: undefined } },
        { type: 'end', stopReason: 'tool_use' },
      ];

      const result = await processor.consume(createMockStream(events));
      
      // 验证两个工具的 input 没有混淆
      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls[0].input).toEqual({ path: '/tmp/test' });
      expect(result.toolCalls[1].input).toEqual({ path: '/tmp/output' });
    });
  });

  describe('中断检查', () => {
    it('应在检测到中断标志时停止消费流', async () => {
      let interrupted = false;
      processor.setInterruptChecker(() => interrupted);

      const textChunks: string[] = [];
      processor.onTextDelta((text) => textChunks.push(text));

      const events: StreamEvent[] = [
        { type: 'text_delta', text: 'Hello ' },
        { type: 'text_delta', text: 'world ' },
        { type: 'text_delta', text: 'interrupted' },
        { type: 'end', stopReason: 'end_turn' },
      ];

      // 创建流
      const streamGen = createMockStream(events);
      
      // 模拟在第 2 个 delta 后设置中断标志
      let count = 0;
      const originalOnTextDelta = processor.onTextDelta.bind(processor);
      processor.onTextDelta((text) => {
        textChunks.push(text);
        count++;
        if (count === 2) {
          interrupted = true; // 第 2 个 delta 后中断
        }
      });

      const result = await processor.consume(streamGen);
      
      // 验证只消费了前 2 个 delta，第 3 个被跳过
      expect(textChunks.length).toBeLessThanOrEqual(2);
    });
  });
});

