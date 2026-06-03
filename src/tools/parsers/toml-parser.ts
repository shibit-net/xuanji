/**
 * ============================================================
 * TOML Parser — .toml → 格式化文本
 * ============================================================
 * TOML 文件解析，输出格式化的键值对。
 */

import { readFile } from 'node:fs/promises';
import type { FileParserResult } from './types';

export async function parseToml(filePath: string): Promise<FileParserResult> {
  const raw = await readFile(filePath, 'utf-8');
  // TOML 本身对人类友好，我们主要做格式化输出
  // 标准格式已足够 LLM 理解
  return {
    content: '```toml\n' + raw + '\n```',
    metadata: { lines: raw.split('\n').length },
  };
}
