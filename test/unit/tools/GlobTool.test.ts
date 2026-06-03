import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GlobTool } from '@/tools/GlobTool';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('GlobTool', () => {
  let tool: GlobTool;
  let testDir: string;

  beforeEach(async () => {
    tool = new GlobTool();
    testDir = join(tmpdir(), `xuanji-test-glob-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // 创建测试文件结构
    await mkdir(join(testDir, 'src'), { recursive: true });
    await mkdir(join(testDir, 'test'), { recursive: true });
    await mkdir(join(testDir, 'src/utils'), { recursive: true });
    await writeFile(join(testDir, 'src/index.ts'), 'export {}');
    await writeFile(join(testDir, 'src/util.ts'), 'export {}');
    await writeFile(join(testDir, 'src/utils/helper.ts'), 'export {}');
    await writeFile(join(testDir, 'test/index.test.ts'), 'test()');
    await writeFile(join(testDir, 'package.json'), '{}');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('应有正确的工具名和 Schema', () => {
    expect(tool.name).toBe('glob');
    expect(tool.readonly).toBe(true);
    expect(tool.input_schema.required).toContain('pattern');
  });

  it('应查找所有 TS 文件', async () => {
    const result = await tool.execute({ pattern: '**/*.ts', path: testDir });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('src/index.ts');
    expect(result.content).toContain('src/util.ts');
    expect(result.content).toContain('src/utils/helper.ts');
    expect(result.content).toContain('test/index.test.ts');
    expect(result.metadata?.totalMatches).toBe(4);
  });

  it('应支持目录过滤', async () => {
    const result = await tool.execute({ pattern: 'src/**/*.ts', path: testDir });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('src/index.ts');
    expect(result.content).toContain('src/util.ts');
    expect(result.content).not.toContain('test/index.test.ts');
    expect(result.metadata?.totalMatches).toBe(3);
  });

  it('应支持精确文件名匹配', async () => {
    const result = await tool.execute({ pattern: '**/package.json', path: testDir });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('package.json');
    expect(result.metadata?.totalMatches).toBe(1);
  });

  it('应排除 node_modules 目录', async () => {
    // 创建 node_modules 中的文件
    await mkdir(join(testDir, 'node_modules/pkg'), { recursive: true });
    await writeFile(join(testDir, 'node_modules/pkg/index.ts'), 'export {}');

    const result = await tool.execute({ pattern: '**/*.ts', path: testDir });
    expect(result.isError).toBe(false);
    expect(result.content).not.toContain('node_modules');
  });

  it('应支持自定义排除模式', async () => {
    const result = await tool.execute({
      pattern: '**/*.ts',
      path: testDir,
      ignore: ['**/test/**'],
    });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('src/index.ts');
    expect(result.content).not.toContain('test/index.test.ts');
  });

  it('无匹配时应返回空内容', async () => {
    const result = await tool.execute({ pattern: '**/*.py', path: testDir });
    expect(result.isError).toBe(false);
    expect(result.content).toBe('');
    expect(result.metadata?.totalMatches).toBe(0);
  });

  it('应使用当前目录当 path 未提供', async () => {
    const result = await tool.execute({ pattern: '*.md' });
    expect(result.isError).toBe(false);
  });

  it('应按字母顺序排序结果', async () => {
    const result = await tool.execute({ pattern: 'src/*.ts', path: testDir });
    expect(result.isError).toBe(false);
    const files = result.content.split('\n').filter(Boolean);
    expect(files[0]).toBe('src/index.ts');
    expect(files[1]).toBe('src/util.ts');
  });
});
