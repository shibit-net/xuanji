import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NotebookEditTool } from '@/core/tools/NotebookEditTool';
import { writeFile, unlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('NotebookEditTool', () => {
  const tool = new NotebookEditTool();
  let testPath: string;

  const makeNotebook = (cells: Array<{ cell_type: string; source: string[] }>) => ({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: cells.map((c) => ({
      cell_type: c.cell_type,
      source: c.source,
      metadata: {},
      ...(c.cell_type === 'code' ? { outputs: [], execution_count: null } : {}),
    })),
  });

  beforeEach(async () => {
    testPath = join(tmpdir(), `test-${Date.now()}.ipynb`);
    const nb = makeNotebook([
      { cell_type: 'code', source: ['print("hello")\n'] },
      { cell_type: 'markdown', source: ['# Title\n'] },
      { cell_type: 'code', source: ['x = 1\n', 'y = 2\n'] },
    ]);
    await writeFile(testPath, JSON.stringify(nb), 'utf-8');
  });

  afterEach(async () => {
    try { await unlink(testPath); } catch { /* ignore */ }
  });

  it('应有正确的工具名', () => {
    expect(tool.name).toBe('notebook_edit');
    expect(tool.readonly).toBe(false);
  });

  it('应替换单元格内容', async () => {
    const result = await tool.execute({
      notebook_path: testPath,
      cell_number: 0,
      edit_mode: 'replace',
      new_source: 'print("world")',
    });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('已替换单元格 0');

    const nb = JSON.parse(await readFile(testPath, 'utf-8'));
    expect(nb.cells[0].source).toEqual(['print("world")']);
  });

  it('应插入新单元格', async () => {
    const result = await tool.execute({
      notebook_path: testPath,
      cell_number: 1,
      edit_mode: 'insert',
      cell_type: 'code',
      new_source: 'import os',
    });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('插入');

    const nb = JSON.parse(await readFile(testPath, 'utf-8'));
    expect(nb.cells.length).toBe(4);
    expect(nb.cells[1].source).toEqual(['import os']);
  });

  it('应删除单元格', async () => {
    const result = await tool.execute({
      notebook_path: testPath,
      cell_number: 1,
      edit_mode: 'delete',
      new_source: '',
    });
    expect(result.isError).toBe(false);
    expect(result.content).toContain('已删除单元格 1');

    const nb = JSON.parse(await readFile(testPath, 'utf-8'));
    expect(nb.cells.length).toBe(2);
  });

  it('非 .ipynb 文件应返回错误', async () => {
    const result = await tool.execute({
      notebook_path: '/tmp/test.txt',
      new_source: 'test',
    });
    expect(result.isError).toBe(true);
  });

  it('cell_number 超范围应返回错误', async () => {
    const result = await tool.execute({
      notebook_path: testPath,
      cell_number: 99,
      edit_mode: 'replace',
      new_source: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('超出范围');
  });
});
