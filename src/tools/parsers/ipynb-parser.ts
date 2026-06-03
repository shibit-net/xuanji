/**
 * ============================================================
 * IPYNB Parser — .ipynb → 结构化 Markdown
 * ============================================================
 * .ipynb 本质是 JSON 文件，提取 cells 内容并渲染。
 */

import { readFile } from 'node:fs/promises';
import type { FileParserResult } from './types';

interface NotebookCell {
  cell_type: 'markdown' | 'code';
  source: string[];
  outputs?: Array<{
    output_type: string;
    text?: string[];
    data?: Record<string, string[]>;
    name?: string;
  }>;
  execution_count?: number | null;
}

interface Notebook {
  nbformat: number;
  metadata: Record<string, unknown>;
  cells: NotebookCell[];
}

export async function parseIpynb(filePath: string): Promise<FileParserResult> {
  const raw = await readFile(filePath, 'utf-8');
  const nb: Notebook = JSON.parse(raw);

  const lines: string[] = [];
  const cellCount = nb.cells.length;

  lines.push(`[JUPYTER NOTEBOOK] ${cellCount} cells`);
  lines.push('');

  // 基本信息
  const lang = (nb.metadata?.kernelspec as any)?.display_name
    ?? (nb.metadata?.language_info as any)?.name
    ?? 'unknown';
  lines.push(`> Kernel: ${lang}`);
  lines.push('');

  let codeCells = 0;
  let mdCells = 0;

  for (let i = 0; i < nb.cells.length; i++) {
    const cell = nb.cells[i]!;
    const cellNum = i + 1;

    if (cell.cell_type === 'markdown') {
      mdCells++;
      const source = cell.source.join('').trim();
      if (source) {
        lines.push(`--- Cell ${cellNum} [markdown] ---`);
        lines.push('');
        lines.push(source);
        lines.push('');
      }
    } else if (cell.cell_type === 'code') {
      codeCells++;
      const execCount = cell.execution_count ?? '?';
      const source = cell.source.join('');

      lines.push(`--- Cell ${cellNum} [code] (execution #${execCount}) ---`);
      lines.push('');
      if (source.trim()) {
        lines.push('```' + (lang.toLowerCase() || 'python'));
        lines.push(source);
        lines.push('```');
        lines.push('');
      }

      // 输出
      if (cell.outputs && cell.outputs.length > 0) {
        for (const output of cell.outputs) {
          if (output.output_type === 'stream' && output.text) {
            lines.push('```');
            lines.push(output.text.join(''));
            lines.push('```');
            lines.push('');
          } else if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
            // 尝试 text/plain
            if (output.data?.['text/plain']) {
              lines.push('```');
              lines.push(output.data['text/plain'].join(''));
              lines.push('```');
              lines.push('');
            }
            // 如果有 HTML，也注明
            if (output.data?.['text/html']) {
              lines.push('> _(has HTML output)_');
              lines.push('');
            }
            // 如果有图片
            if (output.data?.['image/png']) {
              lines.push('> _(has image output: image/png)_');
              lines.push('');
            }
          } else if (output.output_type === 'error') {
            lines.push('```error');
            lines.push(output.text?.join('') ?? 'Error');
            lines.push('```');
            lines.push('');
          }
        }
      }
    }
  }

  return {
    content: lines.join('\n').trim(),
    metadata: { cellCount, codeCells, mdCells },
  };
}
