import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlashCommandRegistry } from '@/adapters/cli/SlashCommandRegistry';

describe('SlashCommandRegistry', () => {
  let registry: SlashCommandRegistry;

  beforeEach(() => {
    registry = new SlashCommandRegistry();
  });

  describe('register()', () => {
    it('应注册命令', () => {
      registry.register({
        name: '/test',
        description: '测试命令',
        handler: async () => {},
      });
      expect(registry.has('/test')).toBe(true);
      expect(registry.size).toBe(1);
    });

    it('应自动补全 / 前缀', () => {
      registry.register({
        name: 'test',
        description: '测试命令',
        handler: async () => {},
      });
      expect(registry.has('/test')).toBe(true);
    });

    it('应支持批量注册', () => {
      registry.registerBulk([
        { name: '/a', description: 'A', handler: async () => {} },
        { name: '/b', description: 'B', handler: async () => {} },
        { name: '/c', description: 'C', handler: async () => {} },
      ]);
      expect(registry.size).toBe(3);
    });

    it('重复注册应覆盖', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      registry.register({ name: '/test', description: 'v1', handler: handler1 });
      registry.register({ name: '/test', description: 'v2', handler: handler2 });

      expect(registry.size).toBe(1);
      expect(registry.get('/test')?.description).toBe('v2');
    });
  });

  describe('execute()', () => {
    it('应执行已注册的命令', async () => {
      const handler = vi.fn();
      registry.register({ name: '/test', description: '测试', handler });

      await registry.execute('/test', 'arg1 arg2');
      expect(handler).toHaveBeenCalledWith('arg1 arg2');
    });

    it('未注册的命令应抛出错误', async () => {
      await expect(registry.execute('/unknown', '')).rejects.toThrow('未知命令');
    });

    it('应支持不带 / 前缀执行', async () => {
      const handler = vi.fn();
      registry.register({ name: '/test', description: '测试', handler });

      await registry.execute('test', 'args');
      expect(handler).toHaveBeenCalledWith('args');
    });
  });

  describe('unregister()', () => {
    it('应注销命令', () => {
      registry.register({ name: '/test', description: '测试', handler: async () => {} });
      expect(registry.has('/test')).toBe(true);

      registry.unregister('/test');
      expect(registry.has('/test')).toBe(false);
    });
  });

  describe('getAll()', () => {
    it('应返回按名称排序的命令列表', () => {
      registry.registerBulk([
        { name: '/zeta', description: 'Zeta', handler: async () => {} },
        { name: '/alpha', description: 'Alpha', handler: async () => {} },
        { name: '/beta', description: 'Beta', handler: async () => {} },
      ]);

      const all = registry.getAll();
      expect(all.map((c) => c.name)).toEqual(['/alpha', '/beta', '/zeta']);
    });
  });

  describe('formatHelp()', () => {
    it('应格式化帮助信息', () => {
      registry.registerBulk([
        { name: '/exit', description: '退出程序', handler: async () => {} },
        { name: '/help', description: '显示帮助', handler: async () => {} },
      ]);

      const help = registry.formatHelp();
      expect(help).toContain('/exit');
      expect(help).toContain('退出程序');
      expect(help).toContain('/help');
      expect(help).toContain('显示帮助');
    });

    it('无命令时应返回提示', () => {
      const help = registry.formatHelp();
      expect(help).toContain('没有已注册的命令');
    });
  });

  describe('getNames()', () => {
    it('应返回排序的命令名称列表', () => {
      registry.registerBulk([
        { name: '/c', description: 'C', handler: async () => {} },
        { name: '/a', description: 'A', handler: async () => {} },
      ]);

      expect(registry.getNames()).toEqual(['/a', '/c']);
    });
  });
});
