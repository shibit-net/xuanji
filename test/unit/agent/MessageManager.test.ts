import { describe, it, expect, beforeEach } from 'vitest';
import { MessageManager } from '@/agent/MessageManager';

describe('MessageManager', () => {
  let manager: MessageManager;

  beforeEach(() => {
    manager = new MessageManager();
  });

  // ---- build() ----

  it('build() 应返回 system + user 消息数组', () => {
    const messages = manager.build('你好');
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toBe('你好');
  });

  it('build() 应使用自定义 system prompt', () => {
    const custom = new MessageManager('自定义提示词');
    const messages = custom.build('测试');
    expect(messages[0].content).toBe('自定义提示词');
  });

  it('build() 应累积用户消息', () => {
    manager.build('第一条');
    const messages = manager.build('第二条');
    // system + 两条 user
    expect(messages.length).toBe(3);
    expect(messages[1].content).toBe('第一条');
    expect(messages[2].content).toBe('第二条');
  });

  it('默认 system prompt 应包含工具名称', () => {
    const messages = manager.build('test');
    const systemContent = messages[0].content as string;
    expect(systemContent).toContain('read_file');
    expect(systemContent).toContain('write_file');
    expect(systemContent).toContain('edit_file');
    expect(systemContent).toContain('bash');
  });

  // ---- addAssistantMessage() ----

  it('addAssistantMessage() 应添加 assistant 消息到历史', () => {
    manager.build('用户消息');
    manager.addAssistantMessage([{ type: 'text', text: '助手回复' }]);
    const history = manager.getHistory();
    expect(history.length).toBe(2);
    expect(history[1].role).toBe('assistant');
    const blocks = history[1].content;
    expect(Array.isArray(blocks)).toBe(true);
    expect((blocks as any)[0].text).toBe('助手回复');
  });

  // ---- addToolResult() ----

  it('addToolResult() 应添加 tool_result 消息到历史', () => {
    manager.build('请读取文件');
    manager.addToolResult('tool-123', {
      content: '文件内容...',
      isError: false,
    });
    const history = manager.getHistory();
    expect(history.length).toBe(2);
    expect(history[1].role).toBe('user');
    const blocks = history[1].content;
    expect(Array.isArray(blocks)).toBe(true);
    const block = (blocks as any)[0];
    expect(block.type).toBe('tool_result');
    expect(block.tool_use_id).toBe('tool-123');
    expect(block.content).toBe('文件内容...');
    expect(block.is_error).toBe(false);
  });

  it('addToolResult() 应正确标记 isError', () => {
    manager.build('请读取文件');
    manager.addToolResult('tool-456', {
      content: '文件不存在',
      isError: true,
    });
    const history = manager.getHistory();
    const block = (history[1].content as any)[0];
    expect(block.is_error).toBe(true);
  });

  // ---- getHistory() ----

  it('getHistory() 应返回历史副本', () => {
    manager.build('消息');
    const h1 = manager.getHistory();
    const h2 = manager.getHistory();
    expect(h1).toEqual(h2);
    expect(h1).not.toBe(h2);  // 不同引用
  });

  // ---- clear() ----

  it('clear() 应清空历史', () => {
    manager.build('消息1');
    manager.build('消息2');
    expect(manager.getHistory().length).toBe(2);
    manager.clear();
    expect(manager.getHistory().length).toBe(0);
  });

  // ---- setSystemPrompt() ----

  it('setSystemPrompt() 应更新 system prompt', () => {
    manager.setSystemPrompt('新的提示词');
    const messages = manager.build('测试');
    expect(messages[0].content).toBe('新的提示词');
  });
});
