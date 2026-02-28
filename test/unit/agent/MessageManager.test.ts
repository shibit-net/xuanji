import { describe, it, expect, beforeEach } from 'vitest';
import { MessageManager } from '@/core/agent/MessageManager';
import type { ContentBlock } from '@/core/types';

/**
 * 从 system message 的 content (ContentBlock[]) 中提取纯文本
 */
function extractSystemText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return (content as ContentBlock[])
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n\n');
}

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
    // system content 现在是 ContentBlock[]（结构化 system prompt blocks）
    const text = extractSystemText(messages[0].content);
    expect(text).toBe('自定义提示词');
  });

  it('build() 应累积用户消息', () => {
    manager.build('第一条');
    const messages = manager.build('第二条');
    // system + 两条 user
    expect(messages.length).toBe(3);
    expect(messages[1].content).toBe('第一条');
    expect(messages[2].content).toBe('第二条');
  });

  it('默认 system prompt 应包含基本角色描述', () => {
    const messages = manager.build('test');
    const systemText = extractSystemText(messages[0].content);
    // 默认 fallback prompt 包含角色名和工具使用提示
    // 正式的详细 prompt（含工具名称）由 Skill 系统注入
    expect(systemText).toContain('Xuanji');
    expect(systemText).toContain('tool');
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

  // ---- system prompt blocks (Prompt Caching 结构化输出) ----

  it('system content 应输出为 ContentBlock[] 格式', () => {
    const messages = manager.build('test');
    const systemContent = messages[0].content;
    expect(Array.isArray(systemContent)).toBe(true);
    const blocks = systemContent as ContentBlock[];
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    expect(blocks[0].type).toBe('text');
    expect(blocks[0].text).toBeTruthy();
  });

  it('setSystemPromptSuffix() 应添加额外的 system prompt block', () => {
    manager.setSystemPromptSuffix('记忆上下文...', 'memory');
    const messages = manager.build('test');
    const blocks = messages[0].content as ContentBlock[];
    // Block 0: 基础 prompt, Block 1: memory suffix
    expect(blocks.length).toBe(2);
    expect(blocks[1].text).toBe('记忆上下文...');
  });

  it('多个 suffix 应对应多个 blocks', () => {
    manager.setSystemPromptSuffix('记忆上下文', 'memory');
    manager.setSystemPromptSuffix('提醒上下文', 'reminder');
    const messages = manager.build('test');
    const blocks = messages[0].content as ContentBlock[];
    // Block 0: 基础 prompt, Block 1: memory, Block 2: reminder
    expect(blocks.length).toBe(3);
    const texts = blocks.map((b) => b.text);
    expect(texts).toContain('记忆上下文');
    expect(texts).toContain('提醒上下文');
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
    const text = extractSystemText(messages[0].content);
    expect(text).toBe('新的提示词');
  });
});
