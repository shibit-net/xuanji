import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFormatter } from '@/adapters/im/MessageFormatter';

describe('MessageFormatter', () => {
  let formatter: MessageFormatter;

  beforeEach(() => {
    formatter = new MessageFormatter();
  });

  // ---- 基础功能 ----

  it('初始状态应无内容', () => {
    expect(formatter.hasContent()).toBe(false);
    expect(formatter.format()).toBe('（无回复内容）');
  });

  it('appendText() 应追加文本', () => {
    formatter.appendText('Hello');
    formatter.appendText(' World');
    expect(formatter.hasContent()).toBe(true);
    expect(formatter.format()).toBe('Hello World');
  });

  it('format() 应 trim 文本', () => {
    formatter.appendText('  Hello  ');
    expect(formatter.format()).toBe('Hello');
  });

  // ---- 工具调用 ----

  it('应格式化成功的工具调用', () => {
    formatter.toolStart('read_file', { path: '/tmp/test.txt' });
    formatter.toolEnd('read_file', 'file content', false);
    formatter.appendText('文件内容已读取');

    const result = formatter.format();
    expect(result).toContain('**工具调用:**');
    expect(result).toContain('✅');
    expect(result).toContain('`read_file`');
    expect(result).toContain('path=/tmp/test.txt');
    expect(result).toContain('文件内容已读取');
  });

  it('应格式化失败的工具调用', () => {
    formatter.toolStart('bash', { command: 'invalid' });
    formatter.toolEnd('bash', 'command not found', true);

    const result = formatter.format();
    expect(result).toContain('❌');
    expect(result).toContain('`bash`');
  });

  it('应格式化多个工具调用', () => {
    formatter.toolStart('read_file', { path: 'a.txt' });
    formatter.toolEnd('read_file', 'ok', false);
    formatter.toolStart('edit_file', { path: 'a.txt', old_string: 'x', new_string: 'y' });
    formatter.toolEnd('edit_file', 'ok', false);
    formatter.appendText('完成');

    const result = formatter.format();
    expect(result).toContain('`read_file`');
    expect(result).toContain('`edit_file`');
    expect(result).toContain('完成');
  });

  // ---- 长文本截断 ----

  it('应截断过长的工具输入参数', () => {
    const longStr = 'a'.repeat(200);
    formatter.toolStart('bash', { command: longStr });
    formatter.toolEnd('bash', 'ok', false);

    const result = formatter.format();
    // 应被截断到 80 字符 + "..."
    expect(result).toContain('...');
    expect(result.indexOf('a'.repeat(81))).toBe(-1);
  });

  // ---- reset ----

  it('reset() 应清空所有内容', () => {
    formatter.appendText('Hello');
    formatter.toolStart('bash', { command: 'ls' });
    formatter.toolEnd('bash', 'ok', false);

    expect(formatter.hasContent()).toBe(true);

    formatter.reset();

    expect(formatter.hasContent()).toBe(false);
    expect(formatter.format()).toBe('（无回复内容）');
  });

  // ---- 仅工具调用无文本 ----

  it('仅工具调用无文本应也能输出', () => {
    formatter.toolStart('read_file', { path: 'test.txt' });
    formatter.toolEnd('read_file', 'ok', false);

    const result = formatter.format();
    expect(result).toContain('**工具调用:**');
    expect(result).toContain('`read_file`');
  });

  // ---- 工具输入为非字符串 ----

  it('应格式化非字符串的工具输入', () => {
    formatter.toolStart('bash', { command: 'ls', timeout: 5000 });
    formatter.toolEnd('bash', 'ok', false);

    const result = formatter.format();
    expect(result).toContain('command=ls');
    expect(result).toContain('timeout=5000');
  });

  // ---- 空输入 ----

  it('空工具输入应正确处理', () => {
    formatter.toolStart('bash', {});
    formatter.toolEnd('bash', 'ok', false);

    const result = formatter.format();
    expect(result).toContain('`bash`');
  });
});
