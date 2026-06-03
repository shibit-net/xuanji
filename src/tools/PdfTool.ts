/**
 * PdfTool — PDF 读取与操作工具
 *
 * 支持四种操作：
 * - read:          提取文本内容（通过 pdf-parse）
 * - metadata:      获取文档信息（页数、标题、作者等）
 * - extract_pages: 提取指定页面生成新 PDF
 * - merge:         合并多个 PDF 文件
 */

import { readFile, writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import type { JSONSchema, ToolResult } from '@/infrastructure/core-types';
import { BaseTool } from './BaseTool';
import { middleTruncate, getMaxToolOutputLength } from '@/shared/utils/truncation';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'PdfTool' });

export class PdfTool extends BaseTool {
  readonly name = 'pdf';
  readonly description = [
    'Read and manipulate PDF files. Supports eight operations:',
    '',
    '=== READING ===',
    '',
    '1. read — Extract text content from a PDF file.',
    '   pdf({ operation: "read", file_path: "/path/to/file.pdf" })',
    '   pdf({ operation: "read", file_path: "/path/to/file.pdf", pages: "1-5" })',
    '',
    '2. metadata — Get PDF document information (page count, title, author, etc.).',
    '   pdf({ operation: "metadata", file_path: "/path/to/file.pdf" })',
    '',
    '3. extract_pages — Extract specific pages into a new PDF file.',
    '   pdf({ operation: "extract_pages", file_path: "/path/to/file.pdf", pages: "1-3,5", output_path: "/path/to/output.pdf" })',
    '',
    '4. merge — Merge multiple PDF files into one.',
    '   pdf({ operation: "merge", input_paths: ["/path/to/a.pdf", "/path/to/b.pdf"], output_path: "/path/to/merged.pdf" })',
    '',
    '=== PAGE OPERATIONS ===',
    '',
    '5. delete_pages — Delete specific pages from a PDF.',
    '   pdf({ operation: "delete_pages", file_path: "/path/to/file.pdf", pages: "2,4", output_path: "/path/to/output.pdf" })',
    '',
    '6. rotate_pages — Rotate specific pages by 90/180/270 degrees.',
    '   pdf({ operation: "rotate_pages", file_path: "/path/to/file.pdf", pages: "1-3", angle: 90, output_path: "/path/to/output.pdf" })',
    '',
    '=== ANNOTATION & FORMS ===',
    '',
    '7. add_text — Overlay text at a specific position on a page.',
    '   pdf({ operation: "add_text", file_path: "/path/to/file.pdf", page: 1, x: 50, y: 700, text: "DRAFT", font_size: 24, output_path: "/path/to/output.pdf" })',
    '   NOTE: This draws new text on top of existing content. It does NOT delete or replace existing text.',
    '',
    '8. fill_form — Fill PDF form fields.',
    '   pdf({ operation: "fill_form", file_path: "/path/to/file.pdf", fields: [{ name: "Name", value: "John" }], output_path: "/path/to/output.pdf" })',
    '',
    'Page range format: "1-5" (range), "3" (single page), "1-3,5,7-9" (mixed).',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['read', 'metadata', 'extract_pages', 'merge', 'delete_pages', 'rotate_pages', 'add_text', 'fill_form'],
        description: 'The operation to perform on the PDF file(s).',
      },
      file_path: {
        type: 'string',
        description: 'Path to the PDF file (required for read, metadata, extract_pages).',
      },
      pages: {
        type: 'string',
        description: 'Page range string. For read: limit text extraction to these pages. For extract_pages: which pages to extract. Format: "1-5", "3", "1,3,5-7".',
      },
      input_paths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of PDF file paths to merge (required for merge).',
      },
      output_path: {
        type: 'string',
        description: 'Output file path for the resulting PDF (required for extract_pages, merge, delete_pages, rotate_pages, add_text, fill_form).',
      },
      page: {
        type: 'number',
        description: 'Page number (1-based) for add_text overlay.',
      },
      x: { type: 'number', description: 'X coordinate for add_text (from left).' },
      y: { type: 'number', description: 'Y coordinate for add_text (from bottom).' },
      text: { type: 'string', description: 'Text to overlay for add_text.' },
      font_size: { type: 'number', description: 'Font size for add_text (default: 12).' },
      angle: {
        type: 'string',
        enum: ['90', '180', '270'],
        description: 'Rotation angle for rotate_pages (90, 180, or 270).',
      },
      fields: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Form field name.' },
            value: { type: 'string', description: 'Value to fill.' },
          },
        },
        description: 'Array of { name, value } for fill_form.',
      },
    },
    required: ['operation'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const operation = input.operation as string;

    switch (operation) {
      case 'read':
        return this.handleRead(input);
      case 'metadata':
        return this.handleMetadata(input);
      case 'extract_pages':
        return this.handleExtractPages(input);
      case 'merge':
        return this.handleMerge(input);
      case 'delete_pages':
        return this.handleDeletePages(input);
      case 'rotate_pages':
        return this.handleRotatePages(input);
      case 'add_text':
        return this.handleAddText(input);
      case 'fill_form':
        return this.handleFillForm(input);
      default:
        return this.formatError({
          type: '参数错误',
          message: `不支持的操作: ${operation}`,
          reason: `operation 必须是 read / metadata / extract_pages / merge / delete_pages / rotate_pages / add_text / fill_form 之一，当前值: ${operation}`,
          solutions: [
            '使用 "read" 提取 PDF 文本内容',
            '使用 "metadata" 获取 PDF 文档信息',
            '使用 "extract_pages" 提取指定页面',
            '使用 "merge" 合并多个 PDF',
          ],
          example: 'pdf({ operation: "read", file_path: "/path/to/file.pdf" })',
        });
    }
  }

  // ============================================================
  // read — 提取文本
  // ============================================================

  private async handleRead(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input.file_path as string | undefined;
    if (!filePath) {
      return this.formatError({
        type: '参数错误',
        message: '缺少 file_path',
        reason: 'read 操作必须提供 PDF 文件路径。',
        solutions: ['提供 file_path 参数指向要读取的 PDF 文件'],
        example: 'pdf({ operation: "read", file_path: "/path/to/file.pdf" })',
      });
    }

    try {
      const [{ PDFParse }, { createRequire }, { pathToFileURL }] = await Promise.all([
        import('pdf-parse'),
        import('node:module'),
        import('node:url'),
      ]);
      const req = createRequire(import.meta.url);
      const workerPath = pathToFileURL(req.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
      PDFParse.setWorker(workerPath);
      const dataBuffer = await readFile(filePath);

      const parser = new PDFParse({ data: new Uint8Array(dataBuffer) });
      try {
        const textResult = await parser.getText();
        const totalPages = textResult.pages.length;
        const pages = input.pages as string | undefined;

        if (totalPages > 50 && !pages) {
          return this.formatError({
            type: '参数错误',
            message: `PDF 共 ${totalPages} 页，超过 50 页限制，请指定 pages 参数`,
            reason: '大 PDF 文件（>50 页）必须指定页码范围，避免输出过长。',
            solutions: [
              `指定页码范围，如 pages: "1-10"`,
              `先通过 metadata 操作查看总页数，再分批读取`,
            ],
            example: `pdf({ operation: "read", file_path: "${filePath}", pages: "1-10" })`,
          });
        }

        let text: string;
        if (pages) {
          const { start, end } = this.parsePageRange(pages, totalPages);
          text = textResult.pages
            .filter((_, i) => i + 1 >= start && i + 1 <= end)
            .map((p) => p.text)
            .join('\n');
        } else {
          text = textResult.text;
        }

        const fullLen = text.length;
        text = middleTruncate(text, getMaxToolOutputLength());
        const truncated = fullLen !== text.length;

        const header = `[PDF] ${filePath} (${totalPages} 页${pages ? `, 范围: ${pages}` : ''}${truncated ? `, 内容已截断` : ''})`;
        return this.success(`${header}\n\n${text}`, {
          type: 'pdf',
          operation: 'read',
          totalPages,
          pages: pages ?? `1-${totalPages}`,
        });
      } finally {
        await parser.destroy();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('password')) {
        return this.error(`PDF 需要密码，请解密后重试: ${filePath}`);
      }
      return this.error(`PDF 读取失败: ${message}`);
    }
  }

  // ============================================================
  // metadata — 获取文档信息
  // ============================================================

  private async handleMetadata(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input.file_path as string | undefined;
    if (!filePath) {
      return this.formatError({
        type: '参数错误',
        message: '缺少 file_path',
        reason: 'metadata 操作必须提供 PDF 文件路径。',
        solutions: ['提供 file_path 参数指向要查看的 PDF 文件'],
        example: 'pdf({ operation: "metadata", file_path: "/path/to/file.pdf" })',
      });
    }

    try {
      const { PDFDocument } = await import('pdf-lib');
      const dataBuffer = await readFile(filePath);
      const pdfDoc = await PDFDocument.load(dataBuffer, { ignoreEncryption: true });

      const fileSize = statSync(filePath).size;

      const lines: string[] = [
        `[PDF 元数据] ${filePath}`,
        '',
        `页数:           ${pdfDoc.getPageCount()}`,
        `文件大小:       ${this.formatFileSize(fileSize)}`,
        `已加密:         ${pdfDoc.isEncrypted ? '是' : '否'}`,
      ];

      const title = pdfDoc.getTitle();
      const author = pdfDoc.getAuthor();
      const subject = pdfDoc.getSubject();
      const keywords = pdfDoc.getKeywords();
      const creator = pdfDoc.getCreator();
      const producer = pdfDoc.getProducer();
      const creationDate = pdfDoc.getCreationDate();
      const modDate = pdfDoc.getModificationDate();

      if (title) lines.push(`标题:           ${title}`);
      if (author) lines.push(`作者:           ${author}`);
      if (subject) lines.push(`主题:           ${subject}`);
      if (keywords) lines.push(`关键词:         ${keywords}`);
      if (creator) lines.push(`创建工具:       ${creator}`);
      if (producer) lines.push(`PDF 生成器:     ${producer}`);
      if (creationDate) lines.push(`创建时间:       ${creationDate.toISOString()}`);
      if (modDate) lines.push(`修改时间:       ${modDate.toISOString()}`);

      return this.success(lines.join('\n'), {
        type: 'pdf',
        operation: 'metadata',
        pageCount: pdfDoc.getPageCount(),
        fileSize,
        encrypted: pdfDoc.isEncrypted,
        title: title ?? null,
        author: author ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`PDF 元数据读取失败: ${message}`);
    }
  }

  // ============================================================
  // extract_pages — 提取页面到新 PDF
  // ============================================================

  private async handleExtractPages(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input.file_path as string | undefined;
    const pages = input.pages as string | undefined;
    const outputPath = input.output_path as string | undefined;

    if (!filePath || !pages || !outputPath) {
      return this.formatError({
        type: '参数错误',
        message: '缺少必需参数',
        reason: 'extract_pages 操作需要 file_path / pages / output_path 三个参数。',
        solutions: [
          '提供 file_path（源 PDF 路径）',
          '提供 pages（要提取的页码范围，如 "1-3,5"）',
          '提供 output_path（输出 PDF 路径）',
        ],
        example: 'pdf({ operation: "extract_pages", file_path: "/path/to/in.pdf", pages: "1-3,5", output_path: "/path/to/out.pdf" })',
      });
    }

    try {
      const { PDFDocument } = await import('pdf-lib');
      const dataBuffer = await readFile(filePath);
      const srcDoc = await PDFDocument.load(dataBuffer, { ignoreEncryption: true });
      const totalPages = srcDoc.getPageCount();
      const pageIndices = this.parsePageIndices(pages, totalPages);

      if (pageIndices.length === 0) {
        return this.error(`没有匹配到任何页面: ${pages}（总页数: ${totalPages}）`);
      }

      const newDoc = await PDFDocument.create();
      const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
      for (const page of copiedPages) {
        newDoc.addPage(page);
      }

      const pdfBytes = await newDoc.save();
      await writeFile(outputPath, pdfBytes);

      return this.success(
        `已提取 ${pageIndices.length} 页（${pageIndices.map(i => i + 1).join(', ')}）→ ${outputPath}`,
        {
          type: 'pdf',
          operation: 'extract_pages',
          sourceFile: filePath,
          outputPath,
          extractedCount: pageIndices.length,
          totalPages,
          extractedPages: pageIndices.map(i => i + 1),
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`PDF 页面提取失败: ${message}`);
    }
  }

  // ============================================================
  // merge — 合并多个 PDF
  // ============================================================

  private async handleMerge(input: Record<string, unknown>): Promise<ToolResult> {
    const inputPaths = input.input_paths as string[] | undefined;
    const outputPath = input.output_path as string | undefined;

    if (!inputPaths || inputPaths.length < 2 || !outputPath) {
      return this.formatError({
        type: '参数错误',
        message: '缺少必需参数',
        reason: 'merge 操作需要 input_paths（至少 2 个 PDF 文件）和 output_path。',
        solutions: [
          '提供 input_paths 数组，至少包含 2 个 PDF 文件路径',
          '提供 output_path 参数指定合并后的输出路径',
        ],
        example: 'pdf({ operation: "merge", input_paths: ["/path/to/a.pdf", "/path/to/b.pdf"], output_path: "/path/to/merged.pdf" })',
      });
    }

    try {
      const { PDFDocument } = await import('pdf-lib');
      const mergedDoc = await PDFDocument.create();
      const pageCounts: number[] = [];

      for (const fp of inputPaths) {
        const buf = await readFile(fp);
        const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
        pageCounts.push(doc.getPageCount());
        const pages = await mergedDoc.copyPages(doc, doc.getPageIndices());
        for (const page of pages) {
          mergedDoc.addPage(page);
        }
      }

      const pdfBytes = await mergedDoc.save();
      await writeFile(outputPath, pdfBytes);

      const totalPages = mergedDoc.getPageCount();
      const summary = inputPaths.map((fp, i) => `  ${fp} (${pageCounts[i]} 页)`).join('\n');

      return this.success(
        `已合并 ${inputPaths.length} 个 PDF（共 ${totalPages} 页）→ ${outputPath}\n\n源文件:\n${summary}`,
        {
          type: 'pdf',
          operation: 'merge',
          outputPath,
          fileCount: inputPaths.length,
          totalPages,
          sourceFiles: inputPaths,
          pageCounts,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`PDF 合并失败: ${message}`);
    }
  }

  // ============================================================
  // delete_pages — 删除页面
  // ============================================================

  private async handleDeletePages(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input.file_path as string;
    const pages = input.pages as string;
    const outputPath = input.output_path as string;
    if (!filePath || !pages || !outputPath) {
      return this.formatError({
        type: '参数错误',
        message: '缺少必需参数',
        reason: 'delete_pages 操作需要 file_path / pages / output_path。',
        solutions: ['提供 file_path（源 PDF）', '提供 pages（删除范围，如 "2,4"）', '提供 output_path（输出路径）'],
      });
    }

    try {
      const { PDFDocument } = await import('pdf-lib');
      const buf = await readFile(filePath);
      const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
      const totalPages = pdfDoc.getPageCount();
      const removeSet = new Set(this.parsePageIndices(pages, totalPages));

      const newDoc = await PDFDocument.create();
      const keepIndices = Array.from({ length: totalPages }, (_, i) => i)
        .filter(i => !removeSet.has(i));
      if (keepIndices.length === 0) {
        return this.error('不能删除所有页面。');
      }
      const copiedPages = await newDoc.copyPages(pdfDoc, keepIndices);
      for (const page of copiedPages) newDoc.addPage(page);

      const pdfBytes = await newDoc.save();
      await writeFile(outputPath, pdfBytes);

      return this.success(
        `已删除 ${removeSet.size} 页（${pages}）→ ${outputPath}（剩余 ${keepIndices.length} 页）`,
        { type: 'pdf', operation: 'delete_pages', outputPath, deletedCount: removeSet.size, remainingPages: keepIndices.length, totalPages },
      );
    } catch (err) {
      return this.error(`删除页面失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ============================================================
  // rotate_pages — 旋转页面
  // ============================================================

  private async handleRotatePages(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input.file_path as string;
    const pages = input.pages as string | undefined;
    const angle = parseInt(input.angle as string) || 90;
    const outputPath = input.output_path as string;
    if (!filePath || !outputPath) {
      return this.formatError({
        type: '参数错误',
        message: '缺少必需参数',
        reason: 'rotate_pages 操作需要 file_path / output_path',
        solutions: ['提供 file_path 和 output_path'],
      });
    }
    if (![90, 180, 270].includes(angle)) {
      return this.error(`旋转角度必须是 90 / 180 / 270，当前值: ${angle}`);
    }

    try {
      const { PDFDocument } = await import('pdf-lib');
      const buf = await readFile(filePath);
      const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
      const totalPages = pdfDoc.getPageCount();
      const targetIndices = pages
        ? this.parsePageIndices(pages, totalPages)
        : Array.from({ length: totalPages }, (_, i) => i);

      for (const idx of targetIndices) {
        const page = pdfDoc.getPage(idx);
        const currentRotation = page.getRotation().angle;
        page.setRotation({ angle: ((currentRotation + angle) % 360) } as any);
      }

      const pdfBytes = await pdfDoc.save();
      await writeFile(outputPath, pdfBytes);

      const pagesDesc = pages || `1-${totalPages}`;
      return this.success(
        `已旋转 ${targetIndices.length} 页（${pagesDesc}）${angle}° → ${outputPath}`,
        { type: 'pdf', operation: 'rotate_pages', outputPath, pageCount: targetIndices.length, angle },
      );
    } catch (err) {
      return this.error(`旋转页面失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ============================================================
  // add_text — 叠加文本
  // ============================================================

  private async handleAddText(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input.file_path as string;
    const pageNum = input.page as number;
    const x = input.x as number | undefined;
    const y = input.y as number | undefined;
    const text = input.text as string | undefined;
    const fontSize = (input.font_size as number) || 12;
    const outputPath = input.output_path as string;
    if (!filePath || !pageNum || x === undefined || y === undefined || !text || !outputPath) {
      return this.formatError({
        type: '参数错误',
        message: '缺少必需参数',
        reason: 'add_text 操作需要 file_path / page / x / y / text / output_path。',
        solutions: ['提供所有必需参数', 'x/y 是 PDF 坐标（从页面左下角计算）'],
      });
    }

    try {
      const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
      const buf = await readFile(filePath);
      const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
      const totalPages = pdfDoc.getPageCount();
      if (pageNum < 1 || pageNum > totalPages) {
        return this.error(`页码 ${pageNum} 超出范围（总页数: ${totalPages}）。`);
      }

      const page = pdfDoc.getPage(pageNum - 1);
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      page.drawText(text, { x, y, size: fontSize, font, color: rgb(0, 0, 0) });

      const pdfBytes = await pdfDoc.save();
      await writeFile(outputPath, pdfBytes);

      return this.success(
        `已在第 ${pageNum} 页 (${x}, ${y}) 叠加文本 "${text}" → ${outputPath}`,
        { type: 'pdf', operation: 'add_text', outputPath, page: pageNum, x, y, fontSize },
      );
    } catch (err) {
      return this.error(`叠加文本失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ============================================================
  // fill_form — 填充表单
  // ============================================================

  private async handleFillForm(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input.file_path as string;
    const fields = input.fields as Array<{ name: string; value: string }> | undefined;
    const outputPath = input.output_path as string;
    if (!filePath || !fields?.length || !outputPath) {
      return this.formatError({
        type: '参数错误',
        message: '缺少必需参数',
        reason: 'fill_form 操作需要 file_path / fields / output_path。',
        solutions: ['提供 fields 数组，每项含 name 和 value'],
      });
    }

    try {
      const { PDFDocument } = await import('pdf-lib');
      const buf = await readFile(filePath);
      const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
      const form = pdfDoc.getForm();
      const filled: string[] = [];
      const notFound: string[] = [];

      for (const field of fields) {
        try {
          const f = form.getTextField(field.name);
          f.setText(field.value);
          filled.push(field.name);
        } catch {
          try {
            const f = form.getDropdown(field.name);
            f.select(field.value);
            filled.push(field.name);
          } catch {
            notFound.push(field.name);
          }
        }
      }

      const pdfBytes = await pdfDoc.save();
      await writeFile(outputPath, pdfBytes);

      let msg = `已填充 ${filled.length} 个表单字段 → ${outputPath}`;
      if (filled.length > 0) msg += `\n已填充: ${filled.join(', ')}`;
      if (notFound.length > 0) msg += `\n⚠️ 未找到字段: ${notFound.join(', ')}（不是文本字段或下拉框，或名称不匹配）`;

      return this.success(
        msg,
        { type: 'pdf', operation: 'fill_form', outputPath, filled: filled.length, notFound: notFound.length },
      );
    } catch (err) {
      return this.error(`填充表单失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ============================================================
  // 工具方法
  // ============================================================

  /**
   * 解析页码范围字符串，返回 { start, end }（1-based，两端包含）
   */
  private parsePageRange(pages: string, totalPages: number): { start: number; end: number } {
    const match = pages.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) {
      throw new Error(`无效的页码范围: ${pages}，格式如 "1-5", "3", "10-20"`);
    }
    const start = Math.max(1, parseInt(match[1], 10));
    const end = Math.min(totalPages, match[2] ? parseInt(match[2], 10) : start);
    if (start > end) {
      throw new Error(`起始页 ${start} 大于结束页 ${end}`);
    }
    return { start, end };
  }

  /**
   * 解析页面选择字符串，返回 0-based 索引数组
   * 支持: "1-5", "3", "1,3,5-7", "1-3,5,7-9"
   */
  private parsePageIndices(pages: string, totalPages: number): number[] {
    const indices = new Set<number>();
    const parts = pages.split(',').map(s => s.trim());

    for (const part of parts) {
      const match = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!match) {
        throw new Error(`无效的页码格式: "${part}"，应为单个数字（如 "3"）或范围（如 "1-5"）`);
      }
      const start = Math.max(1, parseInt(match[1], 10));
      const end = Math.min(totalPages, match[2] ? parseInt(match[2], 10) : start);
      for (let i = start; i <= end; i++) {
        indices.add(i - 1); // 转换为 0-based
      }
    }

    return Array.from(indices).sort((a, b) => a - b);
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
