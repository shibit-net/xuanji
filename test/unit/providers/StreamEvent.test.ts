import { describe, it, expect } from 'vitest';
import { isTextEvent, isThinkingEvent, isToolEvent, isEndEvent } from '@/core/providers/StreamEvent';
import type { StreamEvent } from '@/core/types';

describe('StreamEvent utils', () => {
  describe('isTextEvent()', () => {
    it('text_delta 事件应返回 true', () => {
      const event: StreamEvent = { type: 'text_delta', text: 'hello' };
      expect(isTextEvent(event)).toBe(true);
    });

    it('text_delta 无 text 应返回 false', () => {
      const event: StreamEvent = { type: 'text_delta' };
      expect(isTextEvent(event)).toBe(false);
    });

    it('非 text_delta 事件应返回 false', () => {
      const event: StreamEvent = { type: 'end' };
      expect(isTextEvent(event)).toBe(false);
    });
  });

  describe('isThinkingEvent()', () => {
    it('thinking_delta 事件应返回 true', () => {
      const event: StreamEvent = { type: 'thinking_delta', thinking: '思考中' };
      expect(isThinkingEvent(event)).toBe(true);
    });

    it('thinking_delta 无 thinking 应返回 false', () => {
      const event: StreamEvent = { type: 'thinking_delta' };
      expect(isThinkingEvent(event)).toBe(false);
    });

    it('非 thinking_delta 事件应返回 false', () => {
      const event: StreamEvent = { type: 'text_delta', text: 'hi' };
      expect(isThinkingEvent(event)).toBe(false);
    });
  });

  describe('isToolEvent()', () => {
    it('tool_use_start 应返回 true', () => {
      expect(isToolEvent({ type: 'tool_use_start' })).toBe(true);
    });

    it('tool_use_delta 应返回 true', () => {
      expect(isToolEvent({ type: 'tool_use_delta' })).toBe(true);
    });

    it('tool_use_end 应返回 true', () => {
      expect(isToolEvent({ type: 'tool_use_end' })).toBe(true);
    });

    it('非工具事件应返回 false', () => {
      expect(isToolEvent({ type: 'text_delta', text: 'hi' })).toBe(false);
      expect(isToolEvent({ type: 'end' })).toBe(false);
    });
  });

  describe('isEndEvent()', () => {
    it('end 事件应返回 true', () => {
      expect(isEndEvent({ type: 'end', stopReason: 'end_turn' })).toBe(true);
    });

    it('非 end 事件应返回 false', () => {
      expect(isEndEvent({ type: 'text_delta', text: 'hi' })).toBe(false);
    });
  });
});
