/**
 * ============================================================
 * INI/CFG Parser — .ini/.cfg → 结构化文本
 * ============================================================
 * INI 格式文件解析，支持 sections、key=value、注释。
 */

import { readFile } from 'node:fs/promises';
import type { FileParserResult } from './types';

export async function parseIni(filePath: string): Promise<FileParserResult> {
  const raw = await readFile(filePath, 'utf-8');
  return {
    content: '```ini\n' + raw + '\n```',
    metadata: { lines: raw.split('\n').length },
  };
}
