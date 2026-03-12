// ============================================================
// MessageManager Snapshot 测试
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageManager } from '@/core/agent/MessageManager';
import type { ContentBlock, ToolResult } from '@/core/types';

describe('MessageManager - Snapshot功能', () => {
  let manager: MessageManager;

  beforeEach(() => {
    manager = new MessageManager('Test system prompt');
  });

  it('应该保存和恢复消息历史快照', () => {
    // 添加几条消息
    manager.build('First user message');
    manager.addAssistantMessage([{ type: 'text', text: 'First response' }]);

    // 保存快照
    const snapshot = manager.saveSnapshot();

    // 继续添加消息
    manager.addUserMessage('Second user message');
    manager.addAssistantMessage([{ type: 'text', text: 'Second response' }]);

    // 验证历史已变化
    expect(manager.getHistory()).toHaveLength(4);

    // 恢复快照
    manager.restoreSnapshot(snapshot);

    // 验证历史已恢复
    const restored = manager.getHistory();
    expect(restored).toHaveLength(2);
    expect(restored[0].role).toBe('user');
    expect(restored[0].content).toBe('First user message');
    expect(restored[1].role).toBe('assistant');
  });

  it('应该保存包含 tool_use 的消息快照', () => {
    manager.build('Use a tool');
    const toolUseContent: ContentBlock[] = [
      { type: 'text', text: 'I will use a tool' },
      {
        type: 'tool_use',
        id: 'toolu_123',
        name: 'read',
        input: { path: 'test.txt' },
      },
    ];
    manager.addAssistantMessage(toolUseContent);

    const snapshot = manager.saveSnapshot();

    // 添加 tool_result
    const resultsMap = new Map<string, ToolResult>();
    resultsMap.set('toolu_123', {
      content: 'File content',
      isError: false,
    });
    manager.addToolResults(resultsMap);

    // 验证历史已变化（3 条消息）
    expect(manager.getHistory()).toHaveLength(3);

    // 恢复快照
    manager.restoreSnapshot(snapshot);

    // 验证历史已恢复（2 条消息，无 tool_result）
    const restored = manager.getHistory();
    expect(restored).toHaveLength(2);
    expect(restored[1].role).toBe('assistant');
    expect(Array.isArray(restored[1].content)).toBe(true);
    const content = restored[1].content as ContentBlock[];
    expect(content.some(b => b.type === 'tool_use')).toBe(true);
    expect(content.some(b => b.type === 'tool_result')).toBe(false);
  });

  it('快照应该深拷贝，避免引用共享', () => {
    const toolUseContent: ContentBlock[] = [
      {
        type: 'tool_use',
        id: 'toolu_123',
        name: 'read',
        input: { path: 'test.txt' },
      },
    ];
    manager.build('Test message');
    manager.addAssistantMessage(toolUseContent);

    const snapshot = manager.saveSnapshot();

    // 修改原始历史中的 ContentBlock
    const history = manager.getHistory();
    const assistantMsg = history[1];
    if (Array.isArray(assistantMsg.content)) {
      (assistantMsg.content as ContentBlock[])[0].input = { path: 'modified.txt' };
    }

    // 恢复快照
    manager.restoreSnapshot(snapshot);

    // 验证快照未被修改（仍是原始值）
    const restored = manager.getHistory();
    const restoredMsg = restored[1];
    if (Array.isArray(restoredMsg.content)) {
      const block = (restoredMsg.content as ContentBlock[])[0];
      expect(block.input).toEqual({ path: 'test.txt' });
    }
  });

  it('应该在空历史时保存和恢复', () => {
    const snapshot = manager.saveSnapshot();
    expect(snapshot).toHaveLength(0);

    manager.build('New message');
    expect(manager.getHistory()).toHaveLength(1);

    manager.restoreSnapshot(snapshot);
    expect(manager.getHistory()).toHaveLength(0);
  });

  it('模拟工具执行失败回滚场景', () => {
    // 初始状态
    manager.build('Execute a tool');

    // 添加 assistant 消息（包含 tool_use）
    manager.addAssistantMessage([
      {
        type: 'tool_use',
        id: 'toolu_123',
        name: 'write',
        input: { path: 'file.txt', content: 'test' },
      },
    ]);

    // ★ 保存快照（工具执行前） ★
    const snapshot = manager.saveSnapshot();

    // 工具执行并添加 tool_result
    const resultsMap = new Map<string, ToolResult>();
    resultsMap.set('toolu_123', {
      content: 'File written successfully',
      isError: false,
    });
    manager.addToolResults(resultsMap);

    // 验证历史包含 tool_result
    let history = manager.getHistory();
    expect(history).toHaveLength(3);
    expect(history[2].role).toBe('user');
    expect(Array.isArray(history[2].content)).toBe(true);

    // ★ 模拟 API 调用失败，回滚到工具执行前 ★
    manager.restoreSnapshot(snapshot);

    // 验证历史已回滚（无 tool_result）
    history = manager.getHistory();
    expect(history).toHaveLength(2);
    expect(history[1].role).toBe('assistant');
    // 没有 tool_result
    const hasToolResult = history.some(
      msg => msg.role === 'user' && Array.isArray(msg.content) &&
        (msg.content as ContentBlock[]).some(b => b.type === 'tool_result')
    );
    expect(hasToolResult).toBe(false);
  });
});
