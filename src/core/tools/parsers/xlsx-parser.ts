/**
 * ============================================================
 * XLSX/CSV/TSV Parser — 电子表格 → 表格 Markdown
 * ============================================================
 * 使用 SheetJS (xlsx) 库解析 Excel 和 CSV/TSV 文件。
 * 输出格式为 LLM 友好的 Markdown 表格。
 */

import { readFile } from 'node:fs/promises';
import * as XLSX from 'xlsx';
import type { FileParserResult } from './types';

/** SheetJS 读取选项 */
const READ_OPTIONS: XLSX.ParsingOptions = {
  cellDates: true,
  dateNF: 'yyyy-mm-dd',
  dense: false,
};

/**
 * 将单个 sheet 渲染为 Markdown 表格
 */
function renderSheet(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  maxRows: number = 200,
): string {
  const lines: string[] = [];
  const ref = sheet['!ref'];
  if (!ref) {
    lines.push(`> Sheet "${sheetName}": 空`);
    lines.push('');
    return lines.join('\n');
  }

  const range = XLSX.utils.decode_range(ref);
  const totalRows = range.e.r - range.s.r + 1;
  const totalCols = range.e.c - range.s.c + 1;

  lines.push(`### ${sheetName} (${totalRows} 行 × ${totalCols} 列)`);
  lines.push('');

  // 将 sheet 转为二维数组
  const data = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as (string | number | Date)[][];

  if (data.length === 0) {
    lines.push('(空)');
    lines.push('');
    return lines.join('\n');
  }

  // 取限制行数
  const displayData = data.slice(0, maxRows + 1); // +1 包含表头
  const header = data[0] ?? [];

  // 构建 Markdown 表格
  const colCount = header.length;

  // 表头行
  lines.push('| ' + header.map(h => String(h ?? '')).join(' | ') + ' |');
  // 分隔行
  lines.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');
  // 数据行
  for (let i = 1; i < displayData.length; i++) {
    const row = displayData[i]!;
    lines.push('| ' + Array.from({ length: colCount }, (_, ci) => String(row[ci] ?? '')).join(' | ') + ' |');
  }

  // 如果数据被截断
  if (totalRows > maxRows) {
    lines.push('');
    lines.push(`> ... 还有 ${totalRows - maxRows} 行未显示。`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * 解析 .xlsx 文件
 */
export async function parseXlsx(filePath: string): Promise<FileParserResult> {
  const workbook = XLSX.readFile(filePath, READ_OPTIONS);
  return renderWorkbook(workbook, 'EXCEL');
}

/**
 * 解析 .xls 文件（旧格式）
 */
export async function parseXls(filePath: string): Promise<FileParserResult> {
  const workbook = XLSX.readFile(filePath, { ...READ_OPTIONS, type: 'file' });
  return renderWorkbook(workbook, 'EXCEL');
}

/**
 * 解析 .csv 文件
 */
export async function parseCsv(filePath: string): Promise<FileParserResult> {
  const raw = await readFile(filePath, 'utf-8');
  const workbook = XLSX.read(raw, { ...READ_OPTIONS, type: 'string' });
  return renderWorkbook(workbook, 'CSV');
}

/**
 * 解析 .tsv 文件
 */
export async function parseTsv(filePath: string): Promise<FileParserResult> {
  const raw = await readFile(filePath, 'utf-8');
  const workbook = XLSX.read(raw, {
    ...READ_OPTIONS,
    type: 'string',
    FS: '\t',       // 字段分隔符
  });
  return renderWorkbook(workbook, 'TSV');
}

/**
 * 渲染整个 workbook 为 Markdown
 */
function renderWorkbook(workbook: XLSX.WorkBook, format: string): FileParserResult {
  const sheetNames = workbook.SheetNames;
  const parts: string[] = [];

  parts.push(`[${format}] ${workbook.Props?.Title || ''}`);
  parts.push(`${sheetNames.length} sheet(s): ${sheetNames.join(', ')}`);
  parts.push('');

  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name]!;
    parts.push(renderSheet(sheet, name));
  }

  return { content: parts.join('\n') };
}
