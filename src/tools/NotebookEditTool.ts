// ============================================================
// M6 工具系统 — NotebookEditTool 编辑 Jupyter Notebook
// ============================================================
//
// 支持对 .ipynb 文件的单元格级编辑:
// - replace: 替换单元格内容
// - insert: 插入新单元格
// - delete: 删除单元格
//

import { readFile, writeFile, access } from 'node:fs/promises';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';

/**
 * Jupyter Notebook 单元格
 */
interface NotebookCell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string[];
  metadata: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
  id?: string;
}

/**
 * Jupyter Notebook 文件结构
 */
interface NotebookDocument {
  nbformat: number;
  nbformat_minor: number;
  metadata: Record<string, unknown>;
  cells: NotebookCell[];
}

/**
 * NotebookEditTool — 编辑 Jupyter Notebook
 */
export class NotebookEditTool extends BaseTool {
  readonly name = 'notebook_edit';
  readonly description = [
    'Edit Jupyter Notebook (.ipynb) cells. Supports replace, insert, and delete operations.',
    'cell_number starts from 0.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      notebook_path: {
        type: 'string',
        description: '.ipynb file path (must be an absolute path)',
      },
      cell_number: {
        type: 'number',
        description: 'Cell number (0-indexed). In insert mode, the insertion position.',
      },
      edit_mode: {
        type: 'string',
        enum: ['replace', 'insert', 'delete'],
        description: 'Edit mode (default replace)',
      },
      cell_type: {
        type: 'string',
        enum: ['code', 'markdown'],
        description: 'Cell type (required for insert mode)',
      },
      new_source: {
        type: 'string',
        description: 'New cell content',
      },
    },
    required: ['notebook_path'],
  };

  readonly readonly = false;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const notebookPath = input.notebook_path as string;
    const cellNumber = input.cell_number as number | undefined;
    const editMode = (input.edit_mode as string) ?? 'replace';
    const cellType = (input.cell_type as string) ?? 'code';
    const newSource = input.new_source as string;

    try {
      // 检查文件存在
      try {
        await access(notebookPath);
      } catch {
        return this.error(`文件不存在: ${notebookPath}`);
      }

      if (!notebookPath.endsWith('.ipynb')) {
        return this.error('文件必须是 .ipynb 格式');
      }

      // 读取并解析 notebook
      const content = await readFile(notebookPath, 'utf-8');
      let notebook: NotebookDocument;
      try {
        notebook = JSON.parse(content);
      } catch {
        return this.error('无法解析 .ipynb 文件（JSON 格式错误）');
      }

      if (!notebook.cells || !Array.isArray(notebook.cells)) {
        return this.error('无效的 notebook 结构（缺少 cells 数组）');
      }

      // delete 模式不需要 new_source
      if (editMode !== 'delete' && !newSource) {
        return this.error(`${editMode} 模式需要提供 new_source 参数`);
      }

      // 将 new_source 转为行数组
      const sourceLines = newSource
        ? newSource.split('\n').map((line, i, arr) =>
            i < arr.length - 1 ? line + '\n' : line,
          )
        : [];

      switch (editMode) {
        case 'replace': {
          if (cellNumber === undefined || cellNumber < 0 || cellNumber >= notebook.cells.length) {
            return this.error(`cell_number 超出范围 (0-${notebook.cells.length - 1})`);
          }
          notebook.cells[cellNumber].source = sourceLines;
          if (cellType) {
            notebook.cells[cellNumber].cell_type = cellType as 'code' | 'markdown';
          }
          // 重置执行状态
          if (notebook.cells[cellNumber].cell_type === 'code') {
            notebook.cells[cellNumber].outputs = [];
            notebook.cells[cellNumber].execution_count = null;
          }
          break;
        }

        case 'insert': {
          const insertAt = cellNumber ?? notebook.cells.length;
          if (insertAt < 0 || insertAt > notebook.cells.length) {
            return this.error(`insert 位置超出范围 (0-${notebook.cells.length})`);
          }
          const newCell: NotebookCell = {
            cell_type: (cellType as 'code' | 'markdown') ?? 'code',
            source: sourceLines,
            metadata: {},
            ...(cellType === 'code' ? { outputs: [], execution_count: null } : {}),
          };
          notebook.cells.splice(insertAt, 0, newCell);
          break;
        }

        case 'delete': {
          if (cellNumber === undefined || cellNumber < 0 || cellNumber >= notebook.cells.length) {
            return this.error(`cell_number 超出范围 (0-${notebook.cells.length - 1})`);
          }
          notebook.cells.splice(cellNumber, 1);
          break;
        }

        default:
          return this.error(`未知编辑模式: ${editMode}`);
      }

      // 写回文件
      await writeFile(notebookPath, JSON.stringify(notebook, null, 1) + '\n', 'utf-8');

      const actionMsg = editMode === 'replace'
        ? `已替换单元格 ${cellNumber}`
        : editMode === 'insert'
          ? `已在位置 ${cellNumber ?? notebook.cells.length - 1} 插入新单元格`
          : `已删除单元格 ${cellNumber}`;

      return this.success(`${actionMsg} (${notebookPath}, 共 ${notebook.cells.length} 个单元格)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.error(`编辑 Notebook 失败: ${msg}`);
    }
  }
}
