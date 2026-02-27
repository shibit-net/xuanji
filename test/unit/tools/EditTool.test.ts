import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EditTool } from '@/core/tools/EditTool';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('EditTool', () => {
  let tool: EditTool;
  let testDir: string;

  beforeEach(async () => {
    tool = new EditTool();
    testDir = join(tmpdir(), `xuanji-test-edit-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('应有正确的工具名和 schema', () => {
    expect(tool.name).toBe('edit_file');
    expect(tool.description).toBeTruthy();
    expect(tool.input_schema.required).toContain('path');
    expect(tool.input_schema.required).toContain('old_string');
    expect(tool.input_schema.required).toContain('new_string');
  });

  it('应成功替换唯一匹配的字符串', async () => {
    const filePath = join(testDir, 'edit.txt');
    await writeFile(filePath, 'const name = "old";\nconst age = 20;', 'utf-8');

    const result = await tool.execute({
      path: filePath,
      old_string: 'const name = "old"',
      new_string: 'const name = "new"',
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain('已编辑');

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('const name = "new"');
    expect(content).toContain('const age = 20');
  });

  it('文件不存在时应返回错误', async () => {
    const result = await tool.execute({
      path: join(testDir, 'nonexistent.txt'),
      old_string: 'foo',
      new_string: 'bar',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('文件不存在');
  });

  it('未找到匹配字符串时应返回错误', async () => {
    const filePath = join(testDir, 'nomatch.txt');
    await writeFile(filePath, 'hello world', 'utf-8');

    const result = await tool.execute({
      path: filePath,
      old_string: 'not found string',
      new_string: 'replacement',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('未找到匹配');
  });

  it('多处匹配时应返回错误', async () => {
    const filePath = join(testDir, 'multi.txt');
    await writeFile(filePath, 'foo bar foo baz foo', 'utf-8');

    const result = await tool.execute({
      path: filePath,
      old_string: 'foo',
      new_string: 'qux',
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('3 处匹配');
    expect(result.content).toContain('唯一');
    expect(result.content).toContain('replace_all');
  });

  describe('replace_all 模式', () => {
    it('replace_all: true 应替换所有匹配项', async () => {
      const filePath = join(testDir, 'replace-all.txt');
      await writeFile(filePath, 'foo bar\nfoo baz\nfoo qux', 'utf-8');

      const result = await tool.execute({
        path: filePath,
        old_string: 'foo',
        new_string: 'hello',
        replace_all: true,
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('已编辑');
      expect(result.content).toContain('共替换 3 处');

      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('hello bar\nhello baz\nhello qux');
    });

    it('replace_all: true 单次匹配时也应正常工作', async () => {
      const filePath = join(testDir, 'replace-one.txt');
      await writeFile(filePath, 'foo bar baz', 'utf-8');

      const result = await tool.execute({
        path: filePath,
        old_string: 'foo',
        new_string: 'hello',
        replace_all: true,
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('已编辑');

      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('hello bar baz');
    });

    it('replace_all: true 未找到匹配时应报错', async () => {
      const filePath = join(testDir, 'no-match-all.txt');
      await writeFile(filePath, 'hello world', 'utf-8');

      const result = await tool.execute({
        path: filePath,
        old_string: 'not-found',
        new_string: 'replacement',
        replace_all: true,
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('未找到匹配');
    });

    it('replace_all: false（默认）多处匹配时应报错', async () => {
      const filePath = join(testDir, 'default-multi.txt');
      await writeFile(filePath, 'aaa bbb aaa', 'utf-8');

      const result = await tool.execute({
        path: filePath,
        old_string: 'aaa',
        new_string: 'ccc',
        replace_all: false,
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('2 处匹配');
    });

    it('replace_all: true 应支持多行字符串替换', async () => {
      const filePath = join(testDir, 'multiline-all.txt');
      await writeFile(filePath, 'const x = 1;\nconst y = 2;\nconst z = 3;', 'utf-8');

      const result = await tool.execute({
        path: filePath,
        old_string: 'const',
        new_string: 'let',
        replace_all: true,
      });

      expect(result.isError).toBe(false);
      expect(result.content).toContain('共替换 3 处');

      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('let x = 1;\nlet y = 2;\nlet z = 3;');
    });
  });

  it('应处理多行替换', async () => {
    const filePath = join(testDir, 'multiline.txt');
    const original = 'function hello() {\n  console.log("hi");\n}';
    await writeFile(filePath, original, 'utf-8');

    const result = await tool.execute({
      path: filePath,
      old_string: 'function hello() {\n  console.log("hi");\n}',
      new_string: 'function hello() {\n  console.log("hello world!");\n}',
    });

    expect(result.isError).toBe(false);
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('hello world!');
  });

  it('应保留文件中未匹配的部分', async () => {
    const filePath = join(testDir, 'preserve.txt');
    await writeFile(filePath, 'line1\nline2\nline3', 'utf-8');

    await tool.execute({
      path: filePath,
      old_string: 'line2',
      new_string: 'replaced',
    });

    const content = await readFile(filePath, 'utf-8');
    expect(content).toBe('line1\nreplaced\nline3');
  });
});
