/**
 * DocxEditTool — Word 往返编辑（Round-trip via Markdown）
 *
 * DOCX → mammoth → Markdown → LLM 修改 → docx 库 → New DOCX
 *
 * 限制：
 * - 往返过程会丢失复杂排版（多栏、文本框、嵌入对象）
 * - 图片在 mammoth → Markdown 转换中会丢失
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, basename, extname } from 'node:path';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { middleTruncate, getMaxToolOutputLength } from '@/shared/utils/truncation';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'DocxEditTool' });

export class DocxEditTool extends BaseTool {
  readonly name = 'docx_edit';
  readonly description = [
    'Edit existing Word (.docx) files via round-trip Markdown conversion. Use this when the user asks to modify the content of a .docx file: extract to Markdown, edit the text, then regenerate the .docx. For .doc (old format), use doc_to_docx first. For creating new files from scratch, use generate_document.',
    '',
    '=== HOW IT WORKS ===',
    '',
    '1. Use extract_markdown to get the document content as Markdown.',
    '2. Edit the Markdown in your response (no tool needed — just output the new Markdown).',
    '3. Use apply_markdown to regenerate the .docx from the edited Markdown.',
    '',
    '=== OPERATIONS ===',
    '',
    '1. extract_markdown — Convert .docx to Markdown text.',
    '   docx_edit({ operation: "extract_markdown", file_path: "/path/to/file.docx" })',
    '',
    '2. apply_markdown — Generate .docx from Markdown.',
    '   docx_edit({ operation: "apply_markdown", file_path: "/path/to/file.docx", content: "# Title\\n\\nNew paragraph..." })',
    '   docx_edit({ operation: "apply_markdown", file_path: "/path/to/new_file.docx", content: "..." })',
    '',
    '=== LIMITATIONS ===',
    '- Complex formatting (columns, text boxes, embedded objects) will be lost.',
    '- Images embedded in the original .docx are NOT preserved during round-trip.',
    '- Tables, headings, bold/italic, code blocks, and lists ARE preserved.',
    '- For .doc files (old format), use doc_to_docx tool to convert first.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['extract_markdown', 'apply_markdown'],
        description: 'extract_markdown: DOCX → Markdown. apply_markdown: Markdown → DOCX.',
      },
      file_path: {
        type: 'string',
        description: 'Path to the .docx file.',
      },
      content: {
        type: 'string',
        description: 'Markdown content for apply_markdown.',
      },
    },
    required: ['operation', 'file_path'],
  };

  readonly readonly = false;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const operation = input.operation as string;
    const rawPath = input.file_path as string | undefined;
    if (!rawPath || typeof rawPath !== 'string') {
      return this.error('缺少 file_path 参数。请提供 .docx 文件路径。');
    }
    const filePath = resolve(rawPath);

    switch (operation) {
      case 'extract_markdown':
        return this.extractMarkdown(filePath);
      case 'apply_markdown':
        return this.applyMarkdown(filePath, input.content as string | undefined);
      default:
        return this.formatError({
          type: '参数错误',
          message: `不支持的操作: ${operation}`,
          reason: 'operation 必须是 extract_markdown 或 apply_markdown。',
          solutions: ['使用 extract_markdown 提取 Markdown', '使用 apply_markdown 生成 DOCX'],
        });
    }
  }

  // ============================================================
  // extract_markdown — DOCX → Markdown
  // ============================================================

  private async extractMarkdown(filePath: string): Promise<ToolResult> {
    const ext = extname(filePath).toLowerCase();
    if (ext !== '.docx') {
      return this.error(`文件必须是 .docx 格式（当前: ${ext}）。对于 .doc 文件，请使用 doc_to_docx 工具先转换。`);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mammothModule: any = await import('mammoth');
      const mammoth = mammothModule.default || mammothModule;
      const result = await mammoth.convertToMarkdown({ path: filePath });

      const content = result.value;
      const warnings = (result.messages || [])
        .filter((m: { type: string; message: string }) => m.type === 'warning')
        .map((m: { message: string }) => m.message);

      const truncated = middleTruncate(content, getMaxToolOutputLength());
      const isTruncated = truncated !== content;

      let output = `[Extracted from ${basename(filePath)}`;
      if (isTruncated) {
        output += ` — 文件过大已截断，共 ${content.length} 字符，仅显示前 ${getMaxToolOutputLength()} 字符。请用 read_file 分段读取完整内容`;
      }
      output += `]\n\n${truncated}`;
      if (warnings.length > 0) {
        output += `\n\n> ⚠️ 转换警告:\n${warnings.map((w: string) => `> - ${w}`).join('\n')}`;
      }

      return this.success(output, {
        operation: 'extract_markdown',
        filePath,
        size: content.length,
        truncated: isTruncated,
        warnings: warnings.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('no such file')) {
        return this.error(`文件不存在: ${filePath}`);
      }
      log.error(`extract_markdown failed: ${filePath}`, { error: message });
      return this.error(`提取 Markdown 失败: ${message}`);
    }
  }

  // ============================================================
  // apply_markdown — Markdown → DOCX
  // ============================================================

  private async applyMarkdown(filePath: string, content?: string): Promise<ToolResult> {
    if (!content) {
      return this.formatError({
        type: '参数错误',
        message: '缺少 content',
        reason: 'apply_markdown 需要提供 Markdown 内容。',
        solutions: ['先通过 extract_markdown 获取内容，编辑后传入 content 参数'],
      });
    }

    if (this.isSensitivePath(filePath)) {
      return this.error(`安全限制: 不允许写入路径 "${filePath}"。`);
    }

    try {
      await mkdir(dirname(filePath), { recursive: true }).catch(() => {});

      const buffer = await this.markdownToDocxBuffer(content);

      await writeFile(filePath, buffer);
      const sizeKB = (buffer.length / 1024).toFixed(1);

      return this.success(
        `已生成 Word 文档: ${filePath} (${sizeKB}KB)`,
        { operation: 'apply_markdown', filePath, format: 'docx', sizeBytes: buffer.length },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`apply_markdown failed: ${filePath}`, { error: message });
      return this.error(`生成 DOCX 失败: ${message}`);
    }
  }

  /**
   * 将 Markdown 转换为 DOCX Buffer。
   * 复用 OfficeGenerateTool 的 Markdown→DOCX 逻辑，保持一致性。
   */
  private async markdownToDocxBuffer(content: string): Promise<Buffer> {
    const {
      Document, Packer, Paragraph, TextRun, HeadingLevel,
      Table, TableRow, TableCell,
      BorderStyle,
    } = await import('docx');

    const children: any[] = [];
    const lines = content.split('\n');
    let inTable = false;
    let tableHeaders: string[] = [];
    let tableRows: string[][] = [];
    let inCodeBlock = false;
    let codeLines: string[] = [];

    const flushTable = () => {
      if (inTable) {
        children.push(...this.renderDocxTable(tableHeaders, tableRows, { Table, TableRow: TableRow, TableCell: TableCell, Paragraph: Paragraph, TextRun: TextRun }));
        tableHeaders = [];
        tableRows = [];
        inTable = false;
      }
    };

    for (const rawLine of lines) {
      const trimmed = rawLine.trimEnd();

      // 代码块
      if (trimmed.startsWith('```')) {
        flushTable();
        if (inCodeBlock) {
          children.push(new Paragraph({
            spacing: { before: 120, after: 120 },
            border: {
              top: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
              left: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
              right: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
            },
            shading: { type: 'clear', fill: 'F5F5F5' },
            children: codeLines.map((l: string) => new TextRun({ text: l, font: 'Courier New', size: 18 })),
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
        flushTable();
        children.push(new Paragraph({ spacing: { after: 120 } }));
        continue;
      }

      // 表格行
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        if (/^\|[\s\-:|]+\|$/.test(trimmed)) continue; // 分隔行
        const cells = trimmed.split('|').slice(1, -1).map((c: string) => c.trim());
        if (!inTable) {
          inTable = true;
          tableHeaders = cells;
        } else {
          tableRows.push(cells);
        }
        continue;
      }

      flushTable();

      // 标题
      if (trimmed.startsWith('### ')) {
        children.push(new Paragraph({
          text: trimmed.slice(4), heading: HeadingLevel.HEADING_3,
          spacing: { before: 240, after: 120 },
        }));
      } else if (trimmed.startsWith('## ')) {
        children.push(new Paragraph({
          text: trimmed.slice(3), heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 120 },
        }));
      } else if (trimmed.startsWith('# ')) {
        children.push(new Paragraph({
          text: trimmed.slice(2), heading: HeadingLevel.HEADING_1,
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
        children.push(new Paragraph({ text, numbering: { reference: 'default', level: 0 } }));
      } else {
        children.push(new Paragraph({
          spacing: { after: 120 },
          children: this.parseInlineMarkdown(trimmed, TextRun),
        }));
      }
    }

    flushTable();
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
        children: codeLines.map((l: string) => new TextRun({ text: l, font: 'Courier New', size: 18 })),
      }));
    }

    if (children.length === 0) {
      children.push(new Paragraph({ text: '(Empty document)' }));
    }

    const doc = new Document({
      title: 'Document',
      styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
      sections: [{ children }],
    });
    return Buffer.from(await Packer.toBuffer(doc));
  }

  private parseInlineMarkdown(text: string, TR: any): any[] {
    const runs: any[] = [];
    const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        runs.push(new TR({ text: text.slice(lastIndex, match.index) }));
      }
      if (match[2]) {
        runs.push(new TR({ text: match[2], bold: true }));
      } else if (match[3]) {
        runs.push(new TR({ text: match[3], italics: true }));
      } else if (match[4]) {
        runs.push(new TR({ text: match[4], font: 'Courier New', size: 18 }));
      }
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      runs.push(new TR({ text: text.slice(lastIndex) }));
    }

    return runs.length > 0 ? runs : [new TR({ text })];
  }

  private renderDocxTable(
    headers: string[], rows: string[][],
    { Table, TableRow, TableCell, Paragraph, TextRun }: any,
  ): any[] {
    const tblRows: any[] = [];

    if (headers.length > 0) {
      tblRows.push(new TableRow({
        tableHeader: true,
        children: headers.map((h: string) => new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
          shading: { type: 'clear', fill: 'E0E0E0' },
        })),
      }));
    }

    for (const row of rows) {
      tblRows.push(new TableRow({
        children: row.map((c: string) => new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: String(c ?? '') })] })],
        })),
      }));
    }

    const table = new Table({ rows: tblRows });
    return [
      new Paragraph({ spacing: { before: 120 } }),
      table,
      new Paragraph({ spacing: { after: 120 } }),
    ];
  }
}
