import { describe, it, expect, beforeEach } from 'vitest';
import { IgnoreFilter } from '@/permission/policies/IgnoreFilter';

describe('IgnoreFilter', () => {
  let filter: IgnoreFilter;
  const projectRoot = '/project';

  beforeEach(() => {
    filter = new IgnoreFilter(projectRoot);
  });

  describe('addRule / isIgnored', () => {
    it('应匹配 .env 文件', () => {
      filter.addRule('.env');
      expect(filter.isIgnored('/project/.env')).toBe(true);
    });

    it('应匹配 .env.* 文件', () => {
      filter.addRule('.env.*');
      expect(filter.isIgnored('/project/.env.local')).toBe(true);
      expect(filter.isIgnored('/project/.env.production')).toBe(true);
    });

    it('应匹配通配符模式', () => {
      filter.addRule('*.key');
      expect(filter.isIgnored('/project/server.key')).toBe(true);
      expect(filter.isIgnored('/project/certs/ca.key')).toBe(true);
    });

    it('应匹配目录模式', () => {
      filter.addRule('node_modules/');
      expect(filter.isIgnored('/project/node_modules/pkg/index.js')).toBe(true);
    });

    it('不匹配的文件应返回 false', () => {
      filter.addRule('.env');
      expect(filter.isIgnored('/project/src/index.ts')).toBe(false);
    });

    it('项目外路径应返回 false', () => {
      filter.addRule('.env');
      // 项目外路径的 relative 会带 ..，ignore 库通常不匹配
      expect(filter.isIgnored('/other-project/.env')).toBe(false);
    });
  });

  describe('addRules', () => {
    it('应批量添加规则', () => {
      filter.addRules(['.env', '*.key', 'node_modules/']);
      expect(filter.isIgnored('/project/.env')).toBe(true);
      expect(filter.isIgnored('/project/server.key')).toBe(true);
      expect(filter.isIgnored('/project/node_modules/pkg')).toBe(true);
    });
  });

  describe('loadFromFile', () => {
    it('加载不存在的文件应不报错', async () => {
      await expect(filter.loadFromFile('/nonexistent/path')).resolves.not.toThrow();
    });
  });
});
