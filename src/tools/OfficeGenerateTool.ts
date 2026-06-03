/**
 * ============================================================
 * OfficeGenerateTool — 生成 Office 文档 (.docx / .xlsx)
 * ============================================================
 * 根据 LLM 提供的结构化内容生成 Word 或 Excel 文档。
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'OfficeGenerateTool' });

interface SheetData {
  name: string;
  headers: string[];
  rows: string[][];
}

export class OfficeGenerateTool extends BaseTool {
  readonly name = 'generate_document';
  readonly description = [
    'Create NEW .docx or .xlsx files from scratch. Use this when generating a document from content (markdown for docx, rows for xlsx). To EDIT an existing file, use xlsx_edit or docx_edit instead.',
    '',
    '=== USAGE ===',
    '',
    'For .docx (Word):',
    '  Provide content as Markdown. Supports headings, paragraphs,',
    '  bold/italic, code, tables, lists.',
    '',
    '  Example: generate_document({',
    '    "output_path": "report.docx",',
    '    "content": "# Title\\n\\nParagraph with **bold** text.\\n\\n## Section\\n- Item 1\\n- Item 2"',
    '  })',
    '',
    'For .xlsx (Excel):',
    '  Provide sheets array with headers and rows.',
    '',
    '  Example: generate_document({',
    '    "output_path": "data.xlsx",',
    '    "sheets": [{',
    '      "name": "Sheet1",',
    '      "headers": ["Name", "Age", "City"],',
    '      "rows": [["Alice", "30", "NYC"], ["Bob", "25", "SF"]]',
    '    }]',
    '  })',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      output_path: {
        type: 'string',
        description: 'Output file path. Must end with .docx or .xlsx',
      },
      format: {
        type: 'string',
        enum: ['docx', 'xlsx'],
        description: 'Target format (auto-detected from output_path if omitted)',
      },
      // Word content
      content: {
        type: 'string',
        description: 'Content in Markdown format (for .docx output). Supports # ## ### headings, **bold**, *italic*, `code`, tables, lists.',
      },
      // Excel content
      sheets: {
        type: 'array',
        description: 'Array of sheet definitions (for .xlsx output)',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Sheet name (max 31 chars)' },
            headers: {
              type: 'array',
              items: { type: 'string' },
              description: 'Column headers',
            },
            rows: {
              type: 'array',
              items: {
                type: 'array',
                items: { type: 'string' },
              },
              description: 'Data rows. Each row must match headers length.',
            },
          },
        },
      },
    },
    required: ['output_path'],
  };

  readonly readonly = false; // 写工具

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const rawPath = input.output_path as string;
    const outputPath = resolve(rawPath);

    if (this.isSensitivePath(outputPath)) {
      return this.error(`安全限制: 不允许写入路径 "${outputPath}"。`);
    }

    // 自动检测格式
    const ext = outputPath.toLowerCase().endsWith('.docx') ? 'docx'
      : outputPath.toLowerCase().endsWith('.xlsx') ? 'xlsx'
      : input.format as string | undefined;

    if (!ext || (ext !== 'docx' && ext !== 'xlsx')) {
      return this.error('输出文件路径必须以 .docx 或 .xlsx 结尾，或指定 format 参数。');
    }

    // 确保父目录存在
    try {
      await mkdir(dirname(outputPath), { recursive: true });
    } catch { /* 目录已存在 */ }

    try {
      if (ext === 'docx') {
        return await this.generateDocx(outputPath, input.content as string | undefined);
      } else {
        return await this.generateXlsx(outputPath, input.sheets as SheetData[] | undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Failed to generate document: ${outputPath}`, { error: message });
      return this.error(`文档生成失败: ${message}`);
    }
  }

  /**
   * 生成 .docx 文档
   */
  private async generateDocx(outputPath: string, content?: string): Promise<ToolResult> {
    const {
      Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
      AlignmentType, BorderStyle,
    } = await import('docx');

    const children: any[] = [];

    if (content) {
      const lines = content.split('\n');
      let inTable = false;
      let tableHeaders: string[] = [];
      let tableRows: string[][] = [];
      let inCodeBlock = false;
      let codeLines: string[] = [];

      for (const rawLine of lines) {
        const trimmed = rawLine.trimEnd();

        // 代码块开始/结束
        if (trimmed.startsWith('```')) {
          if (inCodeBlock) {
            // 结束代码块
            children.push(new Paragraph({
              spacing: { before: 120, after: 120 },
              border: {
                top: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
                left: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
                right: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
              },
              shading: { type: 'clear', fill: 'F5F5F5' },
              children: codeLines.map(line => new TextRun({ text: line, font: 'Courier New', size: 18 })),
            }));
            codeLines = [];
            inCodeBlock = false;
          } else {
            inCodeBlock = true;
          }
          continue;
        }

        if (inCodeBlock) {
          codeLines.push(trimmed);
          continue;
        }

        // 空行
        if (!trimmed) {
          if (inTable) {
            children.push(...this.renderDocxTable(tableHeaders, tableRows, { Table, TableRow, TableCell, Paragraph, TextRun }));
            tableHeaders = [];
            tableRows = [];
            inTable = false;
          }
          children.push(new Paragraph({ spacing: { after: 120 } }));
          continue;
        }

        // 表格行
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
          if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue; // 分隔行

          const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
          if (!inTable) {
            inTable = true;
            tableHeaders = cells;
          } else {
            tableRows.push(cells);
          }
          continue;
        }

        if (inTable) {
          children.push(...this.renderDocxTable(tableHeaders, tableRows, { Table, TableRow, TableCell, Paragraph, TextRun }));
          tableHeaders = [];
          tableRows = [];
          inTable = false;
        }

        // 标题
        if (trimmed.startsWith('### ')) {
          children.push(new Paragraph({
            text: trimmed.slice(4),
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 240, after: 120 },
          }));
        } else if (trimmed.startsWith('## ')) {
          children.push(new Paragraph({
            text: trimmed.slice(3),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 120 },
          }));
        } else if (trimmed.startsWith('# ')) {
          children.push(new Paragraph({
            text: trimmed.slice(2),
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 360, after: 120 },
          }));
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          children.push(new Paragraph({
            spacing: { after: 60 },
            bullet: { level: 0 },
            children: this.parseInlineMarkdown(trimmed.slice(2), TextRun),
          }));
        } else if (/^\d+\.\s/.test(trimmed)) {
          const text = trimmed.replace(/^\d+\.\s+/, '');
          children.push(new Paragraph({
            spacing: { after: 60 },
          }));
          children.push(new Paragraph({
            text,
            numbering: { reference: 'default', level: 0 },
          }));
        } else {
          children.push(new Paragraph({
            spacing: { after: 120 },
            children: this.parseInlineMarkdown(trimmed, TextRun),
          }));
        }
      }

      // 关闭未关闭的表格/代码块
      if (inTable) children.push(...this.renderDocxTable(tableHeaders, tableRows, { Table, TableRow, TableCell, Paragraph, TextRun }));
      if (inCodeBlock && codeLines.length > 0) {
        children.push(new Paragraph({
          spacing: { before: 120, after: 120 },
          border: {
            top: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
            left: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
            right: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
          },
          shading: { type: 'clear', fill: 'F5F5F5' },
          children: codeLines.map(line => new TextRun({ text: line, font: 'Courier New', size: 18 })),
        }));
      }
    } else {
      children.push(new Paragraph({ text: '(Empty document)' }));
    }

    const doc = new Document({
      title: 'Generated Document',
      styles: {
        default: {
          document: {
            run: { font: 'Calibri', size: 22 },
          },
        },
      },
      sections: [{ children }],
    });

    const buffer = await Packer.toBuffer(doc);
    await writeFile(outputPath, buffer);

    return this.success(
      `已生成 Word 文档: ${outputPath} (${(buffer.length / 1024).toFixed(1)}KB)`,
      { filePath: outputPath, format: 'docx', sizeBytes: buffer.length }
    );
  }

  /**
   * 解析行内 Markdown：**bold** *italic* `code`
   */
  private parseInlineMarkdown(text: string, TextRun: any): any[] {
    const runs: any[] = [];
    const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        runs.push(new TextRun({ text: text.slice(lastIndex, match.index) }));
      }
      if (match[2]) {
        runs.push(new TextRun({ text: match[2], bold: true }));
      } else if (match[3]) {
        runs.push(new TextRun({ text: match[3], italics: true }));
      } else if (match[4]) {
        runs.push(new TextRun({ text: match[4], font: 'Courier New', size: 18 }));
      }
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      runs.push(new TextRun({ text: text.slice(lastIndex) }));
    }

    return runs.length > 0 ? runs : [new TextRun({ text })];
  }

  /**
   * 渲染 docx 表格
   */
  private renderDocxTable(
    headers: string[],
    rows: string[][],
    docx: { Table: any; TableRow: any; TableCell: any; Paragraph: any; TextRun: any },
  ): any[] {
    const { Table, TableRow: TblRow, TableCell: TblCell, Paragraph: P, TextRun: TR } = docx;

    const tblRows: any[] = [];

    if (headers.length > 0) {
      tblRows.push(new TblRow({
        tableHeader: true,
        children: headers.map(h => new TblCell({
          children: [new P({ children: [new TR({ text: h, bold: true })] })],
          shading: { type: 'clear', fill: 'E0E0E0' },
        })),
      }));
    }

    for (const row of rows) {
      tblRows.push(new TblRow({
        children: row.map(c => new TblCell({
          children: [new P({ children: [new TR({ text: String(c ?? '') })] })],
        })),
      }));
    }

    const table = new Table({ rows: tblRows });
    return [
      new P({ spacing: { before: 120 } }),
      table as any,
      new P({ spacing: { after: 120 } }) as any,
    ];
  }

  /**
   * 生成 .xlsx 文档
   */
  private async generateXlsx(outputPath: string, sheets?: SheetData[]): Promise<ToolResult> {
    const XLSX = await import('xlsx');

    const workbook = XLSX.utils.book_new();

    if (!sheets || sheets.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([['(empty)']]);
      XLSX.utils.book_append_sheet(workbook, ws, 'Sheet1');
    } else {
      for (const sheet of sheets) {
        const name = sheet.name.slice(0, 31);
        if (sheet.headers.length > 0) {
          const data = [sheet.headers, ...sheet.rows];
          const ws = XLSX.utils.aoa_to_sheet(data);

          const colWidths = sheet.headers.map((h, ci) => {
            const maxLen = Math.max(
              h.length,
              ...sheet.rows.map(r => String(r[ci] ?? '').length),
            );
            return { wch: Math.min(Math.max(maxLen + 2, 10), 60) };
          });
          ws['!cols'] = colWidths;

          XLSX.utils.book_append_sheet(workbook, ws, name);
        }
      }
    }

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    await writeFile(outputPath, buffer);

    const sheetCount = sheets?.length ?? 1;
    return this.success(
      `已生成 Excel 文档: ${outputPath} (${(buffer.length / 1024).toFixed(1)}KB, ${sheetCount} 个 sheet)`,
      { filePath: outputPath, format: 'xlsx', sizeBytes: buffer.length, sheets: sheetCount }
    );
  }
}
