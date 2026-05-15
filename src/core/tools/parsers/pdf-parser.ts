/**
 * PDF Parser — .pdf → plain text
 *
 * 使用 pdf-parse 库提取 PDF 文本内容。
 */

import { readFile } from 'node:fs/promises';
import type { FileParserResult } from './types';

export async function parsePdf(filePath: string): Promise<FileParserResult> {
  const { PDFParse } = await import('pdf-parse');
  const dataBuffer = await readFile(filePath);

  const parser = new PDFParse({ data: new Uint8Array(dataBuffer) });
  try {
    const textResult = await parser.getText();
    const totalPages = textResult.pages.length;
    return {
      content: textResult.text,
      metadata: { pages: totalPages },
    };
  } finally {
    await parser.destroy();
  }
}
