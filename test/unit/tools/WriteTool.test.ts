import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WriteTool } from '@/core/tools/WriteTool';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('WriteTool', () => {
  let tool: WriteTool;
  let testDir: string;

  beforeEach(async () => {
    tool = new WriteTool();
    testDir = join(tmpdir(), `xuanji-test-write-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('应有正确的工具名和 schema', () => {
    expect(tool.name).toBe('write_file');
    expect(tool.description).toBeTruthy();
    expect(tool.input_schema.required).toContain('path');
    expect(tool.input_schema.required).toContain('content');
  });

  it('应成功写入文件', async () => {
    const filePath = join(testDir, 'output.txt');
    const content = 'Hello, World!\n第二行';

    const result = await tool.execute({ path: filePath, content });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('已写入');
    expect(result.content).toContain('2 行');

    // 验证文件内容
    const written = await readFile(filePath, 'utf-8');
    expect(written).toBe(content);
  });

  it('应自动创建不存在的父目录', async () => {
    const filePath = join(testDir, 'nested', 'deep', 'dir', 'file.txt');
    const content = 'nested content';

    const result = await tool.execute({ path: filePath, content });
    expect(result.isError).toBe(false);

    const written = await readFile(filePath, 'utf-8');
    expect(written).toBe(content);
  });

  it('应覆盖已存在的文件', async () => {
    const filePath = join(testDir, 'existing.txt');
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(filePath, 'old content', 'utf-8');

    const result = await tool.execute({ path: filePath, content: 'new content' });
    expect(result.isError).toBe(false);

    const written = await readFile(filePath, 'utf-8');
    expect(written).toBe('new content');
  });

  it('应正确报告字符数', async () => {
    const filePath = join(testDir, 'count.txt');
    const content = 'abcde';

    const result = await tool.execute({ path: filePath, content });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('5 字符');
  });
});
