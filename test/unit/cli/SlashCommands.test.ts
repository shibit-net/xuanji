import { describe, it, expect } from 'vitest';
import { parseSlashCommand } from '@/adapters/cli/SlashCommands';

describe('SlashCommands', () => {
  describe('parseSlashCommand()', () => {
    it('应解析无参数斜杠命令', () => {
      const result = parseSlashCommand('/help');
      expect(result).toEqual({ name: '/help', args: '' });
    });

    it('应解析带参数斜杠命令', () => {
      const result = parseSlashCommand('/model claude-opus-4');
      expect(result).toEqual({ name: '/model', args: 'claude-opus-4' });
    });

    it('应处理前后空格', () => {
      const result = parseSlashCommand('  /exit  ');
      expect(result).toEqual({ name: '/exit', args: '' });
    });

    it('非斜杠开头应返回 null', () => {
      expect(parseSlashCommand('hello')).toBeNull();
      expect(parseSlashCommand('not a command')).toBeNull();
    });

    it('空字符串应返回 null', () => {
      expect(parseSlashCommand('')).toBeNull();
      expect(parseSlashCommand('  ')).toBeNull();
    });

    it('应保留参数中的空格', () => {
      const result = parseSlashCommand('/say hello world foo');
      expect(result).toEqual({ name: '/say', args: 'hello world foo' });
    });
  });
});
