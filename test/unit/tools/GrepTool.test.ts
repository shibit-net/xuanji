import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GrepTool } from '@/core/tools/GrepTool';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('GrepTool', () => {
  let tool: GrepTool;
  let testDir: string;

  beforeEach(async () => {
    tool = new GrepTool();
    testDir = join(tmpdir(), `xuanji-test-grep-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    // 创建测试文件
    await writeFile(
      join(testDir, 'test.ts'),
      'export function hello() {\n  console.log("Hello");\n}\n\nexport function world() {\n  console.log("World");\n}',
    );
    await writeFile(join(testDir, 'other.ts'), 'const x = 123;\nconst y = 456;');
    await writeFile(join(testDir, 'readme.md'), '# Title\nfunction doc()');
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('应有正确的工具名和 Schema', () => {
    expect(tool.name).toBe('grep');
    expect(tool.readonly).toBe(true);
    expect(tool.input_schema.required).toContain('pattern');
    expect(tool.input_schema.required).toContain('path');
  });

  it('应查找匹配的文件（files_with_matches 模式）', async () => {
    const result = await tool.execute({
      pattern: 'function',
      path: testDir,
      output_mode: 'files_with_matches',
    });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('test.ts');
    expect(result.content).toContain('readme.md');
    expect(result.content).not.toContain('other.ts');
    expect(result.metadata?.matchedFiles).toBe(2);
  });

  it('应默认使用 files_with_matches 模式', async () => {
    const result = await tool.execute({
      pattern: 'function',
      path: testDir,
    });
    expect(result.isError).toBe(false);
    expect(result.metadata?.mode).toBe('files_with_matches');
  });

  it('应显示匹配内容（content 模式）', async () => {
    const result = await tool.execute({
      pattern: 'function',
      path: join(testDir, 'test.ts'),
      output_mode: 'content',
    });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('export function hello');
    expect(result.content).toContain('export function world');
    expect(result.metadata?.totalMatches).toBe(2);
  });

  it('应支持正则表达式', async () => {
    const result = await tool.execute({
      pattern: 'function\\s+\\w+',
      path: join(testDir, 'test.ts'),
      output_mode: 'content',
    });
    expect(result.isError).toBe(false);
    expect(result.metadata?.totalMatches).toBeGreaterThanOrEqual(2);
  });

  it('应支持忽略大小写', async () => {
    const result = await tool.execute({
      pattern: 'function',
      path: testDir,
      output_mode: 'files_with_matches',
    });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('test.ts');
  });

  it('大小写不匹配时不应返回结果', async () => {
    const result = await tool.execute({
      pattern: 'FUNCTION',
      path: join(testDir, 'test.ts'),
      case_insensitive: false,
      output_mode: 'files_with_matches',
    });
    expect(result.isError).toBe(false);
    expect(result.content).not.toContain('test.ts');
  });

  it('应显示匹配计数（count 模式）', async () => {
    const result = await tool.execute({
      pattern: 'function',
      path: testDir,
      output_mode: 'count',
    });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('test.ts: 2');
    expect(result.content).toContain('readme.md: 1');
  });

  it('应支持 glob 过滤', async () => {
    const result = await tool.execute({
      pattern: 'function',
      path: testDir,
      glob: '*.ts',
      output_mode: 'files_with_matches',
    });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('test.ts');
    expect(result.content).not.toContain('readme.md');
  });

  it('应支持上下文显示', async () => {
    const result = await tool.execute({
      pattern: 'console',
      path: join(testDir, 'test.ts'),
      output_mode: 'content',
      context: 1,
    });
    expect(result.isError).toBe(false);
    // 应包含匹配项和上下文
    expect(result.content).toContain('console');
  });

  it('未找到匹配时应返回提示', async () => {
    const result = await tool.execute({
      pattern: 'nonexistent_pattern_xyz',
      path: testDir,
      output_mode: 'files_with_matches',
    });
    expect(result.isError).toBe(false);
    expect(result.content).toBe('未找到匹配项');
    expect(result.metadata?.matchedFiles).toBe(0);
  });

  it('搜索单个文件时应正常工作', async () => {
    const result = await tool.execute({
      pattern: 'const',
      path: join(testDir, 'other.ts'),
      output_mode: 'content',
    });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('const x');
    expect(result.content).toContain('const y');
    expect(result.metadata?.totalMatches).toBe(2);
  });

  it('路径不存在时应返回错误', async () => {
    const result = await tool.execute({
      pattern: 'test',
      path: join(testDir, 'nonexistent'),
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('ripgrep 错误');
  });

  it('content 模式输出应包含行号', async () => {
    const result = await tool.execute({
      pattern: 'function',
      path: join(testDir, 'test.ts'),
      output_mode: 'content',
    });
    expect(result.isError).toBe(false);
    // 应包含行号格式
    expect(result.content).toMatch(/\d+\s*│/);
  });
});
