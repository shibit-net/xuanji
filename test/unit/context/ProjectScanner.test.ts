import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProjectScanner } from '@/context/ProjectScanner';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ProjectScanner', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `xuanji-test-scanner-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should detect Node.js project', () => {
    // 同步创建 package.json
    require('node:fs').writeFileSync(join(testDir, 'package.json'), '{}');

    const scanner = new ProjectScanner();
    const result = scanner.scan(testDir);

    expect(result.type).toBe('node');
    expect(result.rootPath).toBe(testDir);
    expect(result.configFiles).toContain('package.json');
  });

  it('should detect Python project', () => {
    require('node:fs').writeFileSync(join(testDir, 'pyproject.toml'), '');

    const scanner = new ProjectScanner();
    const result = scanner.scan(testDir);

    expect(result.type).toBe('python');
    expect(result.configFiles).toContain('pyproject.toml');
  });

  it('should detect Java project (pom.xml)', () => {
    require('node:fs').writeFileSync(join(testDir, 'pom.xml'), '');

    const scanner = new ProjectScanner();
    const result = scanner.scan(testDir);

    expect(result.type).toBe('java');
    expect(result.configFiles).toContain('pom.xml');
  });

  it('should detect Go project', () => {
    require('node:fs').writeFileSync(join(testDir, 'go.mod'), '');

    const scanner = new ProjectScanner();
    const result = scanner.scan(testDir);

    expect(result.type).toBe('go');
    expect(result.configFiles).toContain('go.mod');
  });

  it('should detect Rust project', () => {
    require('node:fs').writeFileSync(join(testDir, 'Cargo.toml'), '');

    const scanner = new ProjectScanner();
    const result = scanner.scan(testDir);

    expect(result.type).toBe('rust');
    expect(result.configFiles).toContain('Cargo.toml');
  });

  it('should detect git repository', () => {
    require('node:fs').mkdirSync(join(testDir, '.git'));
    require('node:fs').writeFileSync(join(testDir, 'package.json'), '{}');

    const scanner = new ProjectScanner();
    const result = scanner.scan(testDir);

    expect(result.hasGit).toBe(true);
  });

  it('should detect git-only directory (no project config)', () => {
    require('node:fs').mkdirSync(join(testDir, '.git'));

    const scanner = new ProjectScanner();
    const result = scanner.scan(testDir);

    expect(result.hasGit).toBe(true);
    expect(result.type).toBe('unknown');
    expect(result.rootPath).toBe(testDir);
  });

  it('should return unknown for empty directory', () => {
    const scanner = new ProjectScanner();
    const result = scanner.scan(testDir);

    expect(result.type).toBe('unknown');
    expect(result.hasGit).toBe(false);
    expect(result.configFiles).toEqual([]);
  });

  it('should find project root by walking up directories', () => {
    const fs = require('node:fs');
    // 项目根在 testDir，子目录在 testDir/src/lib
    fs.writeFileSync(join(testDir, 'package.json'), '{}');
    fs.mkdirSync(join(testDir, 'src', 'lib'), { recursive: true });

    const scanner = new ProjectScanner();
    const result = scanner.scan(join(testDir, 'src', 'lib'));

    expect(result.type).toBe('node');
    expect(result.rootPath).toBe(testDir);
  });

  it('should stop at max depth 5', () => {
    const fs = require('node:fs');
    // 创建深度 7 的嵌套目录
    const deepDir = join(testDir, 'a', 'b', 'c', 'd', 'e', 'f', 'g');
    fs.mkdirSync(deepDir, { recursive: true });
    // 把 package.json 放在 testDir（深度 > 5）
    fs.writeFileSync(join(testDir, 'package.json'), '{}');

    const scanner = new ProjectScanner();
    const result = scanner.scan(deepDir);

    // 深度 7 > 5，应该找不到
    expect(result.type).toBe('unknown');
  });

  it('should cache results within the same instance', () => {
    require('node:fs').writeFileSync(join(testDir, 'package.json'), '{}');

    const scanner = new ProjectScanner();
    const result1 = scanner.scan(testDir);
    const result2 = scanner.scan(testDir);

    expect(result1).toBe(result2); // 同一引用
  });

  it('should clear cache', () => {
    require('node:fs').writeFileSync(join(testDir, 'package.json'), '{}');

    const scanner = new ProjectScanner();
    const result1 = scanner.scan(testDir);

    scanner.clearCache();
    const result2 = scanner.scan(testDir);

    expect(result1).not.toBe(result2); // 不同引用
    expect(result1).toEqual(result2); // 但内容相同
  });
});
