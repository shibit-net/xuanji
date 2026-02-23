import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReadTool } from '@/core/tools/ReadTool';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ReadTool', () => {
  let tool: ReadTool;
  let testDir: string;

  beforeEach(async () => {
    tool = new ReadTool();
    testDir = join(tmpdir(), `xuanji-test-read-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('应有正确的工具名和 schema', () => {
    expect(tool.name).toBe('read_file');
    expect(tool.description).toBeTruthy();
    expect(tool.input_schema.required).toContain('path');
  });

  it('应成功读取文件内容', async () => {
    const filePath = join(testDir, 'test.txt');
    await writeFile(filePath, 'line1\nline2\nline3', 'utf-8');

    const result = await tool.execute({ path: filePath });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('line1');
    expect(result.content).toContain('line2');
    expect(result.content).toContain('line3');
    expect(result.metadata?.totalLines).toBe(3);
  });

  it('应支持 offset 和 limit 参数', async () => {
    const filePath = join(testDir, 'multiline.txt');
    await writeFile(filePath, 'a\nb\nc\nd\ne', 'utf-8');

    const result = await tool.execute({ path: filePath, offset: 2, limit: 2 });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('b');
    expect(result.content).toContain('c');
    expect(result.content).not.toContain('│ a');
    expect(result.content).not.toContain('│ d');
    expect(result.metadata?.shownLines).toBe(2);
  });

  it('文件不存在时应返回错误', async () => {
    const result = await tool.execute({ path: join(testDir, 'nonexistent.txt') });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('文件不存在');
  });

  it('应输出带行号的内容', async () => {
    const filePath = join(testDir, 'numbered.txt');
    await writeFile(filePath, 'hello\nworld', 'utf-8');

    const result = await tool.execute({ path: filePath });
    expect(result.isError).toBe(false);
    // 应包含行号格式 "     1 │ hello"
    expect(result.content).toMatch(/\d+\s*│\s*hello/);
    expect(result.content).toMatch(/\d+\s*│\s*world/);
  });

  it('应处理空文件', async () => {
    const filePath = join(testDir, 'empty.txt');
    await writeFile(filePath, '', 'utf-8');

    const result = await tool.execute({ path: filePath });
    expect(result.isError).toBe(false);
  });

  it('offset 超出范围应返回空内容', async () => {
    const filePath = join(testDir, 'short.txt');
    await writeFile(filePath, 'only one line', 'utf-8');

    const result = await tool.execute({ path: filePath, offset: 100 });
    expect(result.isError).toBe(false);
    expect(result.metadata?.shownLines).toBe(0);
  });
});
