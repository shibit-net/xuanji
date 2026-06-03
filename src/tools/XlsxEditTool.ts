/**
 * XlsxEditTool — Excel 单元格/行/sheet 编辑
 *
 * 基于 SheetJS (xlsx) 纯 JS 实现，跨平台。
 * 支持: update_cells / add_rows / delete_rows / add_sheet / delete_sheet / rename_sheet
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { JSONSchema, ToolResult } from '@/infrastructure/core-types';
import { BaseTool } from './BaseTool';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'XlsxEditTool' });

export class XlsxEditTool extends BaseTool {
  readonly name = 'xlsx_edit';
  readonly description = [
    'Edit existing Excel (.xlsx / .xls) files. Use this tool whenever the user asks to modify, update, add data to, or restructure an existing spreadsheet. DO NOT use for reading data (use read_file) or creating new files from scratch (use generate_document).',
    '',
    '=== OPERATIONS ===',
    '',
    '1. update_cells — Update cell values in a sheet.',
    '   xlsx_edit({ operation: "update_cells", file_path: "/path/to/file.xlsx", sheet: "Sheet1", cells: [{ address: "A1", value: "New Title" }, { address: "B2", value: 42 }] })',
    '',
    '2. add_rows — Append rows to the end of a sheet.',
    '   xlsx_edit({ operation: "add_rows", file_path: "/path/to/file.xlsx", sheet: "Sheet1", rows: [["a", "b"], ["c", "d"]] })',
    '',
    '3. delete_rows — Delete rows by range (1-based, inclusive).',
    '   xlsx_edit({ operation: "delete_rows", file_path: "/path/to/file.xlsx", sheet: "Sheet1", start_row: 2, end_row: 5 })',
    '',
    '4. add_sheet — Add a new sheet with optional headers and rows.',
    '   xlsx_edit({ operation: "add_sheet", file_path: "/path/to/file.xlsx", name: "Summary", headers: ["Name", "Value"], rows: [["Total", 100]] })',
    '',
    '5. delete_sheet — Delete a sheet by name.',
    '   xlsx_edit({ operation: "delete_sheet", file_path: "/path/to/file.xlsx", sheet: "Sheet2" })',
    '',
    '6. rename_sheet — Rename a sheet.',
    '   xlsx_edit({ operation: "rename_sheet", file_path: "/path/to/file.xlsx", sheet: "Sheet1", new_name: "Data" })',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['update_cells', 'add_rows', 'delete_rows', 'add_sheet', 'delete_sheet', 'rename_sheet'],
        description: 'The edit operation to perform.',
      },
      file_path: {
        type: 'string',
        description: 'Path to the Excel file.',
      },
      sheet: {
        type: 'string',
        description: 'Sheet name (required for most operations).',
      },
      cells: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            address: { type: 'string', description: 'Cell address, e.g. "A1", "B2".' },
            value: { type: 'string', description: 'New value (string, number, or boolean).' },
          },
        },
        description: 'Array of { address, value } for update_cells.',
      },
      rows: {
        type: 'array',
        items: { type: 'array', items: { type: 'string' } },
        description: '2D array of row data for add_rows or add_sheet.',
      },
      headers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Column headers for add_sheet.',
      },
      start_row: {
        type: 'number',
        description: 'First row to delete (1-based, inclusive).',
      },
      end_row: {
        type: 'number',
        description: 'Last row to delete (1-based, inclusive).',
      },
      name: {
        type: 'string',
        description: 'Sheet name for add_sheet.',
      },
      new_name: {
        type: 'string',
        description: 'New sheet name for rename_sheet.',
      },
    },
    required: ['operation', 'file_path'],
  };

  readonly readonly = false;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const operation = input.operation as string;
    const rawPath = input.file_path as string | undefined;
    if (!rawPath || typeof rawPath !== 'string') {
      return this.error('缺少 file_path 参数。请提供 Excel 文件路径。');
    }
    const filePath = this.resolvePath(rawPath);

    if (this.isSensitivePath(filePath)) {
      return this.error(`安全限制: 不允许编辑路径 "${filePath}"。`);
    }

    switch (operation) {
      case 'update_cells': return this.updateCells(filePath, input);
      case 'add_rows':    return this.addRows(filePath, input);
      case 'delete_rows': return this.deleteRows(filePath, input);
      case 'add_sheet':   return this.addSheet(filePath, input);
      case 'delete_sheet':return this.deleteSheet(filePath, input);
      case 'rename_sheet':return this.renameSheet(filePath, input);
      default:
        return this.formatError({
          type: '参数错误',
          message: `不支持的操作: ${operation}`,
          reason: `operation 必须是 update_cells / add_rows / delete_rows / add_sheet / delete_sheet / rename_sheet 之一。`,
          solutions: ['检查 operation 参数拼写'],
        });
    }
  }

  private resolvePath(p: string): string {
    const { resolve } = require('node:path');
    return resolve(p);
  }

  // ============================================================
  // update_cells
  // ============================================================

  private async updateCells(filePath: string, input: Record<string, unknown>): Promise<ToolResult> {
    const sheetName = input.sheet as string | undefined;
    const cells = input.cells as Array<{ address: string; value: unknown }> | undefined;
    if (!sheetName || !cells?.length) {
      return this.formatError({
        type: '参数错误',
        message: '缺少 sheet 或 cells',
        reason: 'update_cells 需要 sheet 名称和 cells 数组。',
        solutions: ['提供 sheet 参数指定目标 sheet', '提供 cells 数组，每项含 address 和 value'],
      });
    }

    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.readFile(filePath);
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        return this.error(`Sheet "${sheetName}" 不存在。可用 sheets: ${workbook.SheetNames.join(', ')}`);
      }

      const changes: string[] = [];
      for (const cell of cells) {
        const addr = cell.address.toUpperCase();
        const oldCell = sheet[addr];
        const oldValue = oldCell ? oldCell.v : undefined;
        const newValue = cell.value;

        // 根据值类型确定单元格类型
        const t = typeof newValue === 'number' ? 'n'
          : typeof newValue === 'boolean' ? 'b'
          : 's';

        sheet[addr] = { t, v: newValue };
        changes.push(`  ${addr}: ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)}`);
      }

      // 更新 sheet 的 range
      if (!sheet['!ref'] && cells.length > 0) {
        sheet['!ref'] = `${cells[0].address}:${cells[cells.length - 1].address}`;
      }

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: filePath.endsWith('.xls') ? 'biff8' : 'xlsx' });
      await writeFile(filePath, buffer);

      return this.success(
        `已更新 ${cells.length} 个单元格 in "${sheetName}":\n${changes.join('\n')}`,
        { operation: 'update_cells', filePath, sheet: sheetName, count: cells.length },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`update_cells failed: ${filePath}`, { error: message });
      return this.error(`更新单元格失败: ${message}`);
    }
  }

  // ============================================================
  // add_rows
  // ============================================================

  private async addRows(filePath: string, input: Record<string, unknown>): Promise<ToolResult> {
    const sheetName = input.sheet as string | undefined;
    const rows = input.rows as unknown[][] | undefined;
    if (!sheetName || !rows?.length) {
      return this.formatError({
        type: '参数错误',
        message: '缺少 sheet 或 rows',
        reason: 'add_rows 需要 sheet 名称和 rows 数组。',
        solutions: ['提供 sheet 参数指定目标 sheet', '提供 rows 二维数组'],
      });
    }

    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.readFile(filePath);
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        return this.error(`Sheet "${sheetName}" 不存在。可用 sheets: ${workbook.SheetNames.join(', ')}`);
      }

      XLSX.utils.sheet_add_aoa(sheet, rows, { origin: -1 });

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: filePath.endsWith('.xls') ? 'biff8' : 'xlsx' });
      await writeFile(filePath, buffer);

      return this.success(
        `已在 "${sheetName}" 末尾追加 ${rows.length} 行。`,
        { operation: 'add_rows', filePath, sheet: sheetName, rowsAdded: rows.length },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`add_rows failed: ${filePath}`, { error: message });
      return this.error(`追加行失败: ${message}`);
    }
  }

  // ============================================================
  // delete_rows
  // ============================================================

  private async deleteRows(filePath: string, input: Record<string, unknown>): Promise<ToolResult> {
    const sheetName = input.sheet as string | undefined;
    const startRow = (input.start_row as number) ?? 1;
    const endRow = (input.end_row as number) ?? startRow;
    if (!sheetName) {
      return this.formatError({
        type: '参数错误',
        message: '缺少 sheet',
        reason: 'delete_rows 需要 sheet 名称。',
        solutions: ['提供 sheet 参数指定目标 sheet'],
      });
    }
    if (startRow < 1 || endRow < startRow) {
      return this.error(`无效的行范围: ${startRow} - ${endRow}。行号从 1 开始，end_row 必须 >= start_row。`);
    }

    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.readFile(filePath);
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        return this.error(`Sheet "${sheetName}" 不存在。可用 sheets: ${workbook.SheetNames.join(', ')}`);
      }

      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
      const totalRows = range.e.r + 1;
      if (startRow > totalRows) {
        return this.error(`行范围 ${startRow}-${endRow} 超出总行数 ${totalRows}。`);
      }

      // 构建保留的行数据
      const allRows: unknown[][] = [];
      for (let r = range.s.r; r <= range.e.r; r++) {
        const row: unknown[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = sheet[addr];
          row.push(cell ? cell.v : undefined);
        }
        allRows.push(row);
      }

      // 删除指定行（1-based → 0-based）
      const keepRows = allRows.filter((_, i) => {
        const rowNum = i + 1;
        return rowNum < startRow || rowNum > endRow;
      });

      // 重建 sheet
      const newSheet = XLSX.utils.aoa_to_sheet(keepRows);
      // 保留列宽
      if (sheet['!cols']) (newSheet as any)['!cols'] = sheet['!cols'];
      workbook.Sheets[sheetName] = newSheet;

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: filePath.endsWith('.xls') ? 'biff8' : 'xlsx' });
      await writeFile(filePath, buffer);

      const deleted = endRow - startRow + 1;
      return this.success(
        `已删除 "${sheetName}" 的第 ${startRow} 到 ${endRow} 行（共 ${deleted} 行）。`,
        { operation: 'delete_rows', filePath, sheet: sheetName, deleted, startRow, endRow },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`delete_rows failed: ${filePath}`, { error: message });
      return this.error(`删除行失败: ${message}`);
    }
  }

  // ============================================================
  // add_sheet
  // ============================================================

  private async addSheet(filePath: string, input: Record<string, unknown>): Promise<ToolResult> {
    const name = input.name as string | undefined;
    const headers = input.headers as string[] | undefined;
    const rows = input.rows as unknown[][] | undefined;
    if (!name) {
      return this.formatError({
        type: '参数错误',
        message: '缺少 name',
        reason: 'add_sheet 需要指定新 sheet 的名称。',
        solutions: ['提供 name 参数'],
      });
    }

    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.readFile(filePath);

      if (workbook.SheetNames.includes(name)) {
        return this.error(`Sheet "${name}" 已存在。可用 sheets: ${workbook.SheetNames.join(', ')}`);
      }
      if (name.length > 31) {
        return this.error('Sheet 名称不能超过 31 个字符。');
      }

      const data = headers?.length && rows?.length
        ? [headers, ...rows]
        : headers?.length ? [headers] : rows?.length ? rows : [['(empty)']];

      const ws = XLSX.utils.aoa_to_sheet(data);

      if (headers?.length) {
        const colWidths = headers.map((h, ci) => {
          const maxLen = Math.max(h.length, ...((rows || []).map(r => String(r[ci] ?? '').length)));
          return { wch: Math.min(Math.max(maxLen + 2, 10), 60) };
        });
        (ws as any)['!cols'] = colWidths;
      }

      XLSX.utils.book_append_sheet(workbook, ws, name);

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: filePath.endsWith('.xls') ? 'biff8' : 'xlsx' });
      await writeFile(filePath, buffer);

      return this.success(
        `已添加 sheet "${name}"（${data.length} 行 × ${data[0]?.length ?? 0} 列）。`,
        { operation: 'add_sheet', filePath, sheet: name, rows: data.length, cols: data[0]?.length ?? 0 },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`add_sheet failed: ${filePath}`, { error: message });
      return this.error(`添加 sheet 失败: ${message}`);
    }
  }

  // ============================================================
  // delete_sheet
  // ============================================================

  private async deleteSheet(filePath: string, input: Record<string, unknown>): Promise<ToolResult> {
    const sheetName = input.sheet as string | undefined;
    if (!sheetName) {
      return this.formatError({
        type: '参数错误',
        message: '缺少 sheet',
        reason: 'delete_sheet 需要指定要删除的 sheet 名称。',
        solutions: ['提供 sheet 参数'],
      });
    }

    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.readFile(filePath);

      if (!workbook.SheetNames.includes(sheetName)) {
        return this.error(`Sheet "${sheetName}" 不存在。可用 sheets: ${workbook.SheetNames.join(', ')}`);
      }
      if (workbook.SheetNames.length <= 1) {
        return this.error('不能删除唯一 sheet，至少保留一个 sheet。');
      }

      // 移除 sheet
      const idx = workbook.SheetNames.indexOf(sheetName);
      workbook.SheetNames.splice(idx, 1);
      delete workbook.Sheets[sheetName];

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: filePath.endsWith('.xls') ? 'biff8' : 'xlsx' });
      await writeFile(filePath, buffer);

      return this.success(
        `已删除 sheet "${sheetName}"。剩余: ${workbook.SheetNames.join(', ')}`,
        { operation: 'delete_sheet', filePath, deletedSheet: sheetName, remainingSheets: workbook.SheetNames },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`delete_sheet failed: ${filePath}`, { error: message });
      return this.error(`删除 sheet 失败: ${message}`);
    }
  }

  // ============================================================
  // rename_sheet
  // ============================================================

  private async renameSheet(filePath: string, input: Record<string, unknown>): Promise<ToolResult> {
    const sheetName = input.sheet as string | undefined;
    const newName = input.new_name as string | undefined;
    if (!sheetName || !newName) {
      return this.formatError({
        type: '参数错误',
        message: '缺少 sheet 或 new_name',
        reason: 'rename_sheet 需要 sheet 名称和 new_name。',
        solutions: ['提供 sheet 和 new_name 参数'],
      });
    }
    if (newName.length > 31) {
      return this.error('Sheet 名称不能超过 31 个字符。');
    }

    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.readFile(filePath);

      if (!workbook.SheetNames.includes(sheetName)) {
        return this.error(`Sheet "${sheetName}" 不存在。可用 sheets: ${workbook.SheetNames.join(', ')}`);
      }
      if (workbook.SheetNames.includes(newName)) {
        return this.error(`Sheet "${newName}" 已存在，请选择其他名称。`);
      }

      const idx = workbook.SheetNames.indexOf(sheetName);
      workbook.SheetNames[idx] = newName;
      workbook.Sheets[newName] = workbook.Sheets[sheetName];
      delete workbook.Sheets[sheetName];

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: filePath.endsWith('.xls') ? 'biff8' : 'xlsx' });
      await writeFile(filePath, buffer);

      return this.success(
        `已将 sheet "${sheetName}" 重命名为 "${newName}"。`,
        { operation: 'rename_sheet', filePath, oldName: sheetName, newName },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`rename_sheet failed: ${filePath}`, { error: message });
      return this.error(`重命名 sheet 失败: ${message}`);
    }
  }
}
