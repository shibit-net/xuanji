/**
 * ============================================================
 * RTF Parser — .rtf → 纯文本
 * ============================================================
 * RTF 是富文本格式，核心是提取纯文本内容。
 * 简易解析：移除 RTF 控制字和分组，保留花括号外的文本。
 */

import { readFile } from 'node:fs/promises';
import type { FileParserResult } from './types';

/**
 * 简易 RTF 转纯文本
 * 不依赖外部库，适用于常见 RTF 文件
 */
function rtfToText(rtf: string): string {
  // 如果是二进制 RTF 或压缩的，直接放弃
  if (rtf.charCodeAt(0) !== 0x7b) { // 不以 { 开头
    throw new Error('无法解析的 RTF 格式');
  }

  let text = rtf;

  // 步骤 1: 移除 Unicode 转义序列 {\u...}
  text = text.replace(/\\u(\d+)/g, (_, code) => {
    return String.fromCharCode(parseInt(code, 10));
  });

  // 步骤 2: 移除 RTF 控制字（以 \ 开头）
  text = text.replace(/\\([a-z]+)(-?\d+)?/gi, '');

  // 步骤 3: 移除分组标记 { }
  text = text.replace(/[{}]/g, '');

  // 步骤 4: 移除 RTF 特殊字符转义
  text = text.replace(/\\'[0-9a-f]{2}/gi, ''); // 十六进制转义

  // 步骤 5: 规范化空白
  text = text.replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();

  return text;
}

export async function parseRtf(filePath: string): Promise<FileParserResult> {
  const raw = await readFile(filePath, 'utf-8');
  const text = rtfToText(raw);

  return {
    content: text,
    metadata: { charCount: text.length },
  };
}
