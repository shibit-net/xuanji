import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AskUserTool, type AskUserHandler, type AskUserRequest } from '@/tools/AskUserTool';

describe('AskUserTool', () => {
  let tool: AskUserTool;
  let mockHandler: AskUserHandler;
  let lastRequest: AskUserRequest | null;

  beforeEach(() => {
    tool = new AskUserTool();
    lastRequest = null;
    mockHandler = vi.fn(async (request: AskUserRequest) => {
      lastRequest = request;
      // 模拟用户选择第一个选项或自由输入
      if (request.options && request.options.length > 0) {
        if (request.multiSelect) {
          return JSON.stringify([request.options[0]]);
        }
        return request.options[0];
      }
      return '用户回复';
    });
    tool.setHandler(mockHandler);
  });

  // ─── 基础功能 ─────────────────────────────────

  it('应有正确的工具名和 Schema', () => {
    expect(tool.name).toBe('ask_user');
    expect(tool.readonly).toBe(true);
    expect(tool.input_schema.properties).toHaveProperty('question');
    expect(tool.input_schema.properties).toHaveProperty('options');
    expect(tool.input_schema.properties).toHaveProperty('multiSelect');
    expect(tool.input_schema.properties).toHaveProperty('default');
  });

  it('应正确传递自由文本问题', async () => {
    const result = await tool.execute({ question: '请选择一个方案' });
    expect(result.isError).toBe(false);
    expect(result.content).toBe('用户回复');
    expect(lastRequest!.question).toBe('请选择一个方案');
    expect(lastRequest!.options).toBeUndefined();
  });

  // ─── 选项模式 ─────────────────────────────────

  it('应传递 options 到 handler', async () => {
    const result = await tool.execute({
      question: '选择模型',
      options: ['Sonnet', 'Opus', 'Haiku'],
    });
    expect(result.isError).toBe(false);
    expect(result.content).toBe('Sonnet');
    expect(lastRequest!.options).toEqual(['Sonnet', 'Opus', 'Haiku']);
    expect(lastRequest!.multiSelect).toBeUndefined();
  });

  it('应传递 multiSelect 到 handler', async () => {
    const result = await tool.execute({
      question: '选择插件',
      options: ['Git', 'Docker', 'Web'],
      multiSelect: true,
    });
    expect(result.isError).toBe(false);
    expect(result.content).toBe(JSON.stringify(['Git']));
    expect(lastRequest!.multiSelect).toBe(true);
  });

  it('应传递 default 到 handler', async () => {
    await tool.execute({
      question: '选择颜色',
      options: ['红', '蓝', '绿'],
      default: '蓝',
    });
    expect(lastRequest!.default).toBe('蓝');
  });

  // ─── 错误处理 ─────────────────────────────────

  it('空问题应返回错误', async () => {
    const result = await tool.execute({ question: '' });
    expect(result.isError).toBe(true);
  });

  it('无 handler 应返回错误', async () => {
    const noHandlerTool = new AskUserTool();
    const result = await noHandlerTool.execute({ question: '测试' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('non-interactive mode');
  });

  it('handler 抛出异常应返回错误', async () => {
    tool.setHandler(async () => { throw new Error('UI 崩溃'); });
    const result = await tool.execute({ question: '测试' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('UI 崩溃');
  });

  it('用户未回复（空字符串）应返回提示', async () => {
    tool.setHandler(async () => '');
    const result = await tool.execute({ question: '测试' });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('User did not respond');
  });
});
