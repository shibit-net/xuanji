/**
 * ============================================================
 * LaTeX Parser — .tex → 格式化预览
 * ============================================================
 * .tex 本质是文本文件，但包含 LaTeX 命令标记。
 * 输出代码块 + 编译提示。
 */

import { readFile } from 'node:fs/promises';
import type { FileParserResult } from './types';

export async function parseLatex(filePath: string): Promise<FileParserResult> {
  const raw = await readFile(filePath, 'utf-8');
  const lines = raw.split('\n');

  return {
    content: '```latex\n' + raw + '\n```',
    metadata: { lines: lines.length },
  };
}
