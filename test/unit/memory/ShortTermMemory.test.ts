// ============================================================
// ShortTermMemory 单元测试
// ============================================================

import { describe, it, expect } from 'vitest';
import { ShortTermMemory } from '@/memory/ShortTermMemory';

describe('ShortTermMemory', () => {
  it('should record user messages', () => {
    const stm = new ShortTermMemory('test-session', 'claude-sonnet-4');
    stm.addUserMessage('Hello');
    stm.addUserMessage('Write a function');

    const session = stm.getSessionMemory();
    expect(session.userMessages).toHaveLength(2);
    expect(session.userMessages[0]).toBe('Hello');
  });

  it('should limit assistant highlights to 5', () => {
    const stm = new ShortTermMemory('test-session', 'claude-sonnet-4');
    for (let i = 0; i < 10; i++) {
      stm.addAssistantHighlight(`Highlight ${i}`);
    }

    const session = stm.getSessionMemory();
    expect(session.assistantHighlights).toHaveLength(5);
  });

  it('should truncate long assistant highlights', () => {
    const stm = new ShortTermMemory('test-session', 'claude-sonnet-4', { maxEntryLength: 10 });
    stm.addAssistantHighlight('This is a very long highlight that should be truncated');

    const session = stm.getSessionMemory();
    expect(session.assistantHighlights[0]?.length).toBeLessThanOrEqual(13); // 10 + "..."
  });

  it('should record tool calls', () => {
    const stm = new ShortTermMemory('test-session', 'claude-sonnet-4');
    stm.addToolCall({
      name: 'read_file',
      input: { path: 'test.ts' },
      isError: false,
      resultSummary: 'File content...',
    });

    const session = stm.getSessionMemory();
    expect(session.toolCalls).toHaveLength(1);
    expect(session.toolCalls[0]?.name).toBe('read_file');
  });

  it('should generate correct SessionMemory', () => {
    const stm = new ShortTermMemory('sess-123', 'claude-sonnet-4');
    stm.addUserMessage('Hello');

    const session = stm.getSessionMemory();
    expect(session.sessionId).toBe('sess-123');
    expect(session.model).toBe('claude-sonnet-4');
    expect(session.startTime).toBeTruthy();
    expect(session.endTime).toBeTruthy();
    expect(session.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should extract keywords from messages', () => {
    const stm = new ShortTermMemory('test-session', 'claude-sonnet-4');
    stm.addUserMessage('Fix the bug in src/memory/MemoryManager.ts');
    stm.addToolCall({
      name: 'read_file',
      input: { path: 'test.ts' },
      isError: false,
      resultSummary: 'ok',
    });

    const keywords = stm.extractKeywords();
    expect(keywords).toContain('read_file');
    expect(keywords.some((k) => k.includes('memory'))).toBe(true);
  });

  it('should filter stop words', () => {
    const stm = new ShortTermMemory('test-session', 'claude-sonnet-4');
    stm.addUserMessage('the is a an for');

    const keywords = stm.extractKeywords();
    expect(keywords).not.toContain('the');
    expect(keywords).not.toContain('is');
  });

  it('should return counts', () => {
    const stm = new ShortTermMemory('test-session', 'claude-sonnet-4');
    stm.addUserMessage('msg1');
    stm.addUserMessage('msg2');
    stm.addToolCall({ name: 'test', input: {}, isError: false, resultSummary: '' });

    expect(stm.getUserMessageCount()).toBe(2);
    expect(stm.getToolCallCount()).toBe(1);
  });
});
