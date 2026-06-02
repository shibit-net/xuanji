/**
 * XLS Parser — 旧版 Excel (.xls) 解析器
 *
 * 策略：
 *   1) SheetJS 社区版（覆盖多数 .xls，无需外部依赖）
 *   2) 内置 Python 运行时（通过 XUANJI_PYTHON_RUNTIME 环境变量定位）
 *   3) 系统 Python（最后回退）
 */

import { execFile } from 'node:child_process';
import { statSync, existsSync } from 'node:fs';
import { promisify } from 'node:util';
import * as XLSX from 'xlsx';
import path from 'node:path';
import type { FileParserResult } from './types';

const execFileAsync = promisify(execFile);

// ======== SheetJS 渲染（与 xlsx-parser.ts 格式一致） ========

const READ_OPTIONS: XLSX.ParsingOptions = {
  cellDates: true,
  dateNF: 'yyyy-mm-dd',
  dense: false,
  type: 'file',
};

function renderWorkbook(workbook: XLSX.WorkBook, format: string): FileParserResult {
  const sheetNames = workbook.SheetNames;
  const parts: string[] = [
    `[${format}] ${workbook.Props?.Title || ''}`,
    `${sheetNames.length} sheet(s): ${sheetNames.join(', ')}`,
    '',
  ];
  for (const name of sheetNames) {
    parts.push(renderSheet(workbook.Sheets[name]!, name));
  }
  return { content: parts.join('\n') };
}

function renderSheet(sheet: XLSX.WorkSheet, sheetName: string, maxRows = 200): string {
  const lines: string[] = [];
  const ref = sheet['!ref'];
  if (!ref) return `> Sheet "${sheetName}": 空\n\n`;

  const range = XLSX.utils.decode_range(ref);
  const totalRows = range.e.r - range.s.r + 1;
  const totalCols = range.e.c - range.s.c + 1;

  lines.push(`### ${sheetName} (${totalRows} 行 x ${totalCols} 列)`, '');

  const data = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1, defval: '', raw: false,
  }) as (string | number | Date)[][];

  if (data.length === 0) return lines.concat('(空)\n').join('\n');

  const header = data[0] ?? [];
  const colCount = header.length;
  const displayData = data.slice(0, maxRows + 1);

  lines.push('| ' + header.map(h => String(h ?? '')).join(' | ') + ' |');
  lines.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');
  for (let i = 1; i < displayData.length; i++) {
    const row = displayData[i]!;
    lines.push('| ' + Array.from({ length: colCount }, (_, ci) => String(row[ci] ?? '')).join(' | ') + ' |');
  }

  if (totalRows > maxRows) {
    lines.push('', `> ... 还有 ${totalRows - maxRows} 行未显示。`);
  }
  lines.push('');
  return lines.join('\n');
}

// ======== Python 回退方案 ========

function findBundledPython(): { python: string; script: string } | null {
  const root = process.env.XUANJI_PYTHON_RUNTIME;
  if (!root) return null;

  const script = path.join(root, 'xls-convert.py');
  const pythonBins = [
    path.join(root, 'python', 'bin', 'python3'),
    path.join(root, 'python', 'bin', 'python3.12'),
    path.join(root, 'bin', 'python3'),
  ];
  for (const python of pythonBins) {
    if (existsSync(python) && existsSync(script)) return { python, script };
  }

  return null;
}

async function pythonAvailable(pythonPath: string): Promise<boolean> {
  try {
    await execFileAsync(pythonPath, ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const PYTHON_INLINE_SCRIPT = `
import sys, os, xlrd
fp = sys.argv[1]
wb = xlrd.open_workbook(fp)
print(f"[EXCEL] {os.path.basename(fp)}")
print(f"{len(wb.sheet_names())} sheet(s): {', '.join(wb.sheet_names())}")
print()
for name in wb.sheet_names():
    sh = wb.sheet_by_name(name)
    nr, nc = sh.nrows, sh.ncols
    print(f"### {name} ({nr} 行 x {nc} 列)")
    print()
    if nr == 0:
        print("(空)")
        print()
        continue
    maxr = min(nr, 201)
    hdr = [str(sh.cell_value(0, c)) for c in range(nc)]
    print('| ' + ' | '.join(hdr) + ' |')
    print('| ' + ' | '.join(['---'] * nc) + ' |')
    for r in range(1, maxr):
        vals = []
        for c in range(nc):
            ct = sh.cell_type(r, c)
            v = sh.cell_value(r, c)
            if ct == xlrd.XL_CELL_DATE:
                dt = xlrd.xldate_as_datetime(v, wb.datemode)
                v = dt.strftime('%Y-%m-%d' if dt.hour == 0 else '%Y-%m-%d %H:%M:%S')
            elif ct == xlrd.XL_CELL_BOOLEAN:
                v = 'TRUE' if v else 'FALSE'
            elif ct == xlrd.XL_CELL_EMPTY:
                v = ''
            elif ct == xlrd.XL_CELL_NUMBER and v == int(v):
                v = str(int(v))
            vals.append(str(v))
        print('| ' + ' | '.join(vals) + ' |')
    if nr - 1 > 200:
        print()
        print(f"> ... 还有 {nr - 1 - 200} 行未显示。")
    print()
`.trim();

async function parseViaPython(filePath: string): Promise<FileParserResult> {
  // 优先使用内置 Python 运行时
  const bundled = findBundledPython();
  if (bundled && (await pythonAvailable(bundled.python))) {
    const { stdout, stderr } = await execFileAsync(bundled.python, [bundled.script, filePath], {
      timeout: 30_000, maxBuffer: 10 * 1024 * 1024,
    });
    if (!stderr) return { content: stdout.trim() };
    throw new Error(stderr.trim());
  }

  // 回退到系统 Python
  if (!(await pythonAvailable('python3'))) {
    throw new Error(
      '无法解析 .xls 文件：SheetJS 不支持此格式，且系统未检测到 Python 3。\n' +
      '请安装 Python 3 (brew install python3) 和 xlrd (pip3 install xlrd) 后再试。',
    );
  }

  const { stdout, stderr } = await execFileAsync('python3', ['-c', PYTHON_INLINE_SCRIPT, filePath], {
    timeout: 30_000, maxBuffer: 10 * 1024 * 1024,
  });
  if (stderr) throw new Error(stderr.trim());
  return { content: stdout.trim() };
}

// ======== 主入口 ========

export async function parseXls(filePath: string): Promise<FileParserResult> {
  // 1) SheetJS 优先（覆盖多数 .xls）
  try {
    const workbook = XLSX.readFile(filePath, READ_OPTIONS);
    if (workbook.SheetNames.length > 0) {
      return renderWorkbook(workbook, 'EXCEL');
    }
  } catch { /* 非致命，回退到 Python */ }

  // 2) Python 回退
  return parseViaPython(filePath);
}
