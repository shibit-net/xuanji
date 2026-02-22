import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EditTool } from '@/tools/EditTool';
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
