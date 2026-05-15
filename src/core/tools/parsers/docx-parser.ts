/**
 * ============================================================
 * DOCX Parser — .docx → Markdown
 * ============================================================
 * 使用 mammoth 库将 Word 文档转换为 Markdown。
 */

import mammoth from 'mammoth';
import type { FileParserResult } from './types';

export async function parseDocx(filePath: string): Promise<FileParserResult> {
  const result = await mammoth.convertToMarkdown({ path: filePath });
  const content = result.value;

  // 如果 message 中有转换警告，追加到内容中
  const warnings = result.messages
    .filter(m => m.type === 'warning')
    .map(m => m.message);

  let output = content;
  if (warnings.length > 0) {
    output += `\n\n> ⚠️ 转换警告:\n${warnings.map(w => `> - ${w}`).join('\n')}`;
  }

  return { content: output };
}
