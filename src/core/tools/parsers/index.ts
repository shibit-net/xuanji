/**
 * ============================================================
 * File Parsers — 统一解析器映射和导出
 * ============================================================
 * 所有文件解析器按需动态 import（懒加载），避免启动时阻塞。
 * 每个解析器接收文件路径，返回格式化后的 Markdown 文本。
 */

import type { FileParser } from './types';

export type ParserLoader = () => Promise<FileParser>;

/**
 * 文件扩展名 → 解析器加载器映射
 * 在 ReadTool.execute 中根据 ext 查找并调用
 */
export const FORMAT_PARSERS: Record<string, ParserLoader> = {
  // Office
  '.docx': () => import('./docx-parser').then(m => m.parseDocx),
  '.xlsx': () => import('./xlsx-parser').then(m => m.parseXlsx),
  '.xls':  () => import('./xlsx-parser').then(m => m.parseXls),
  '.csv':  () => import('./xlsx-parser').then(m => m.parseCsv),
  '.tsv':  () => import('./xlsx-parser').then(m => m.parseTsv),
  '.pptx': () => import('./pptx-parser').then(m => m.parsePptx),

  // Ebook
  '.epub': () => import('./epub-parser').then(m => m.parseEpub),
  '.rtf':  () => import('./rtf-parser').then(m => m.parseRtf),

  // Notebook
  '.ipynb': () => import('./ipynb-parser').then(m => m.parseIpynb),

  // Config / Data
  '.xml':  () => import('./xml-parser').then(m => m.parseXml),
  '.toml': () => import('./toml-parser').then(m => m.parseToml),
  '.ini':  () => import('./ini-parser').then(m => m.parseIni),
  '.cfg':  () => import('./ini-parser').then(m => m.parseIni),

  // Database
  '.db':     () => import('./db-parser').then(m => m.parseDatabase),
  '.sqlite': () => import('./db-parser').then(m => m.parseDatabase),
  '.sqlite3':() => import('./db-parser').then(m => m.parseDatabase),

  // LaTeX
  '.tex':  () => import('./tex-parser').then(m => m.parseLatex),
};
