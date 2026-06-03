/**
 * DOC Parser — .doc (旧版 Word OLE2 二进制格式) → plain text
 *
 * macOS: 使用系统内置 textutil 转换
 * 其他平台: 尝试 antiword
 * 均不可用时返回错误提示
 */

import { execSync } from 'node:child_process';
import type { FileParserResult } from './types';

function tryTextutil(filePath: string): string | null {
  try {
    return execSync(`textutil -convert txt -stdout ${JSON.stringify(filePath)}`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
  } catch {
    return null;
  }
}

function tryAntiword(filePath: string): string | null {
  try {
    return execSync(`antiword ${JSON.stringify(filePath)}`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
  } catch {
    return null;
  }
}

export async function parseDoc(filePath: string): Promise<FileParserResult> {
  const text = tryTextutil(filePath) ?? tryAntiword(filePath);

  if (text === null) {
    throw new Error(
      '无法解析 .doc 文件（旧版 Word 二进制格式）。\n' +
      'macOS: textutil 转换失败，请确认文件未损坏。\n' +
      '其他平台: 请安装 antiword (brew install antiword / apt install antiword)。\n' +
      '替代方案：将 .doc 另存为 .docx 格式后重试。',
    );
  }

  return { content: text };
}
