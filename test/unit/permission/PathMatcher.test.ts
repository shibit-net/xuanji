import { describe, it, expect } from 'vitest';
import { PathMatcher, globToRegex } from '@/permission/policies/PathMatcher';

describe('globToRegex', () => {
  it('应匹配 ** 任意层级', () => {
    const regex = globToRegex('**/.env');
    expect(regex.test('/home/user/project/.env')).toBe(true);
    expect(regex.test('/root/.env')).toBe(true);
    expect(regex.test('.env')).toBe(true);
  });

  it('应匹配 * 单层级', () => {
    const regex = globToRegex('/tmp/*.log');
    expect(regex.test('/tmp/app.log')).toBe(true);
    expect(regex.test('/tmp/sub/app.log')).toBe(false);
  });

  it('应匹配 ? 单字符', () => {
    const regex = globToRegex('/tmp/file?.txt');
    expect(regex.test('/tmp/file1.txt')).toBe(true);
    expect(regex.test('/tmp/fileAB.txt')).toBe(false);
  });

  it('应匹配 **/.env.* 模式', () => {
    const regex = globToRegex('**/.env.*');
    expect(regex.test('/project/.env.local')).toBe(true);
    expect(regex.test('/project/.env.production')).toBe(true);
  });
});

describe('PathMatcher', () => {
  const matcher = new PathMatcher();

  describe('matches', () => {
    it('精确匹配', () => {
      expect(matcher.matches('/etc/passwd', '/etc/passwd')).toBe(true);
      expect(matcher.matches('/etc/shadow', '/etc/passwd')).toBe(false);
    });

    it('前缀匹配 (末尾斜杠)', () => {
      expect(matcher.matches('/etc/nginx/nginx.conf', '/etc/')).toBe(true);
      expect(matcher.matches('/home/user/file.txt', '/etc/')).toBe(false);
    });

    it('前缀匹配 — 精确目录路径', () => {
      expect(matcher.matches('/etc', '/etc/')).toBe(true);
    });

    it('Glob 模式匹配', () => {
      expect(matcher.matches('/project/.env', '**/.env')).toBe(true);
      expect(matcher.matches('/project/.env.local', '**/.env.*')).toBe(true);
      expect(matcher.matches('/project/src/id_rsa', '**/id_rsa')).toBe(true);
    });

    it('Glob *.pem 匹配', () => {
      expect(matcher.matches('/home/user/cert.pem', '**/*.pem')).toBe(true);
      expect(matcher.matches('/home/user/cert.txt', '**/*.pem')).toBe(false);
    });
  });

  describe('matchesAny', () => {
    it('应匹配列表中任意一个', () => {
      const patterns = ['/etc/', '/bin/', '**/.env'];
      expect(matcher.matchesAny('/etc/hosts', patterns)).toBe(true);
      expect(matcher.matchesAny('/project/.env', patterns)).toBe(true);
      expect(matcher.matchesAny('/home/user/file.txt', patterns)).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('清空缓存后仍能正常工作', () => {
      matcher.matches('/test/file.log', '**/*.log');
      matcher.clearCache();
      expect(matcher.matches('/test/file.log', '**/*.log')).toBe(true);
    });
  });
});
