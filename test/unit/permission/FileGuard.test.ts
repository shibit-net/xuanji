import { describe, it, expect } from 'vitest';
import { FileGuard } from '@/permission/guards/FileGuard';
import { PolicyEngine } from '@/permission/policies/PolicyEngine';
import type { PermissionConfig } from '@/core/types';

function createDefaultPolicy(overrides?: Partial<PermissionConfig>): PolicyEngine {
  return new PolicyEngine({
    fileWrite: 'ask',
    fileRead: 'always',
    bashExec: 'ask',
    allowedCommands: [],
    deniedCommands: [],
    allowedPaths: [],
    deniedPaths: [],
    ...overrides,
  });
}

describe('FileGuard', () => {
  const guard = new FileGuard();

  describe('系统关键路径', () => {
    it('写入 /etc/passwd 应标记为 danger', () => {
      const result = guard.check('write_file', { file_path: '/etc/passwd' }, createDefaultPolicy());
      expect(result).not.toBeNull();
      expect(result!.riskLevel).toBe('danger');
      expect(result!.category).toBe('fileWrite');
      expect(result!.description).toContain('System path');
    });

    it('读取 /etc/hosts 应标记为 danger', () => {
      const result = guard.check('read_file', { file_path: '/etc/hosts' }, createDefaultPolicy());
      expect(result).not.toBeNull();
      expect(result!.riskLevel).toBe('danger');
      expect(result!.category).toBe('fileRead');
    });

    it('写入 /bin/sh 应标记为 danger', () => {
      const result = guard.check('write_file', { file_path: '/bin/sh' }, createDefaultPolicy());
      expect(result).not.toBeNull();
      expect(result!.riskLevel).toBe('danger');
    });
  });

  describe('敏感文件', () => {
    it('写入 .env 应标记为 danger', () => {
      const result = guard.check('write_file', { file_path: '/project/.env' }, createDefaultPolicy());
      expect(result).not.toBeNull();
      expect(result!.riskLevel).toBe('danger');
      expect(result!.category).toBe('fileWrite');
    });

    it('读取 .env 应标记为 warn', () => {
      const result = guard.check('read_file', { file_path: '/project/.env' }, createDefaultPolicy());
      expect(result).not.toBeNull();
      expect(result!.riskLevel).toBe('warn');
      expect(result!.category).toBe('fileRead');
    });

    it('写入 id_rsa 应标记为 danger', () => {
      const result = guard.check('write_file', { file_path: '/home/user/.ssh/id_rsa' }, createDefaultPolicy());
      expect(result).not.toBeNull();
      expect(result!.riskLevel).toBe('danger');
    });

    it('写入 .env.production 应标记为 danger', () => {
      const result = guard.check('write_file', { file_path: '/project/.env.production' }, createDefaultPolicy());
      expect(result).not.toBeNull();
      expect(result!.riskLevel).toBe('danger');
    });
  });

  describe('黑名单', () => {
    it('黑名单路径应标记为 danger', () => {
      const policy = createDefaultPolicy({ deniedPaths: ['**/node_modules/**'] });
      const result = guard.check('write_file', { file_path: '/project/node_modules/pkg/index.js' }, policy);
      expect(result).not.toBeNull();
      expect(result!.riskLevel).toBe('danger');
      expect(result!.description).toContain('deny list');
    });
  });

  describe('白名单', () => {
    it('白名单路径应标记为 safe', () => {
      const policy = createDefaultPolicy({ allowedPaths: ['/project/src/'] });
      const result = guard.check('write_file', { file_path: '/project/src/index.ts' }, policy);
      expect(result).not.toBeNull();
      expect(result!.riskLevel).toBe('safe');
    });
  });

  describe('项目外写入', () => {
    it('项目外写入应标记为 warn', () => {
      // cwd 是当前项目目录，写入不同目录
      const result = guard.check('write_file', { file_path: '/tmp/test.txt' }, createDefaultPolicy());
      expect(result).not.toBeNull();
      expect(result!.riskLevel).toBe('warn');
      expect(result!.description).toContain('outside project');
    });
  });

  describe('安全操作', () => {
    it('读取普通文件应标记为 safe', () => {
      const result = guard.check('read_file', { file_path: process.cwd() + '/src/index.ts' }, createDefaultPolicy());
      expect(result).not.toBeNull();
      expect(result!.riskLevel).toBe('safe');
    });
  });

  describe('无文件路径', () => {
    it('无路径工具应返回 null', () => {
      const result = guard.check('unknown_tool', {}, createDefaultPolicy());
      expect(result).toBeNull();
    });
  });
});
