/**
 * ============================================================
 * XML Parser — .xml → 格式化缩进文本
 * ============================================================
 * XML 格式化为缩进文本，便于 LLM 阅读。
 */

import { readFile } from 'node:fs/promises';
import type { FileParserResult } from './types';

/**
 * 简易 XML 格式化（不依赖外部库）
 */
function formatXml(xml: string): string {
  let formatted = '';
  let indent = 0;
  const lines: string[] = [];

  // 移除多余空白
  const cleaned = xml
    .replace(/>\s+</g, '><')
    .replace(/<!--[\s\S]*?-->/g, '') // 移除注释
    .trim();

  let i = 0;
  while (i < cleaned.length) {
    if (cleaned[i] === '<') {
      const close = cleaned.indexOf('>', i);
      if (close === -1) break;
      const tag = cleaned.slice(i, close + 1);

      if (tag.startsWith('</')) {
        indent = Math.max(0, indent - 1);
        lines.push('  '.repeat(indent) + tag);
      } else if (tag.endsWith('/>') || tag.startsWith('<!')) {
        lines.push('  '.repeat(indent) + tag);
      } else {
        lines.push('  '.repeat(indent) + tag);
        indent++;
      }
      i = close + 1;
    } else {
      // 文本内容
      const nextTag = cleaned.indexOf('<', i);
      const text = nextTag === -1 ? cleaned.slice(i) : cleaned.slice(i, nextTag);
      if (text.trim()) {
        lines.push('  '.repeat(indent) + text.trim());
      }
      i = nextTag === -1 ? cleaned.length : nextTag;
    }
  }

  // 对于简单 XML，如果行数太多，截断中间部分
  if (lines.length > 500) {
    const head = lines.slice(0, 200);
    const tail = lines.slice(lines.length - 100);
    formatted = head.join('\n') + `\n\n... [${lines.length - 300} lines omitted] ...\n\n` + tail.join('\n');
  } else {
    formatted = lines.join('\n');
  }

  return formatted;
}

export async function parseXml(filePath: string): Promise<FileParserResult> {
  const raw = await readFile(filePath, 'utf-8');
  const formatted = formatXml(raw);

  return {
    content: '```xml\n' + formatted + '\n```',
  };
}
