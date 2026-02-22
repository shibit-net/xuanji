import { describe, it, expect, vi } from 'vitest';
import { parseSlashCommand, createBuiltinCommands } from '@/cli/SlashCommands';

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

  describe('createBuiltinCommands()', () => {
    it('应创建 5 个内置命令', () => {
      const callbacks = {
        onClear: vi.fn(),
        onExit: vi.fn(),
        onHelp: vi.fn(),
        onReset: vi.fn(),
        onCost: vi.fn(),
      };

      const commands = createBuiltinCommands(callbacks);
      expect(commands).toHaveLength(5);

      const names = commands.map(c => c.name);
      expect(names).toContain('/help');
      expect(names).toContain('/clear');
      expect(names).toContain('/reset');
      expect(names).toContain('/cost');
      expect(names).toContain('/exit');
    });

    it('所有命令应有描述', () => {
      const callbacks = {
        onClear: vi.fn(),
        onExit: vi.fn(),
        onHelp: vi.fn(),
        onReset: vi.fn(),
        onCost: vi.fn(),
      };

      const commands = createBuiltinCommands(callbacks);
      for (const cmd of commands) {
        expect(cmd.description).toBeTruthy();
      }
    });

    it('命令 handler 应调用对应的回调', () => {
      const callbacks = {
        onClear: vi.fn(),
        onExit: vi.fn(),
        onHelp: vi.fn(),
        onReset: vi.fn(),
        onCost: vi.fn(),
      };

      const commands = createBuiltinCommands(callbacks);

      // 调用每个 handler
      const helpCmd = commands.find(c => c.name === '/help')!;
      helpCmd.handler('');
      expect(callbacks.onHelp).toHaveBeenCalled();

      const exitCmd = commands.find(c => c.name === '/exit')!;
      exitCmd.handler('');
      expect(callbacks.onExit).toHaveBeenCalled();
    });
  });
});
