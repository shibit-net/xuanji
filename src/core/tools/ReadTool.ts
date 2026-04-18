// ============================================================
// M6 工具系统 — ReadTool 读取文件
// ============================================================

import { readFile, access, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { middleTruncate, getMaxToolOutputLength } from '@/shared/utils/truncation';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ReadTool' });

/**
 * 单行格式化后的估算开销：行号前缀 "     N │ " 约 10 字符
 * 按保守估计平均 80 字符/行，MAX_TOOL_OUTPUT_LENGTH / 80 ≈ 375 行
 * 使用 2000 行作为安全上限（覆盖短行场景），超出后走截断逻辑
 */
const MAX_FORMAT_LINES = 2000;

/** 支持的图片扩展名 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

/** MIME 类型映射 */
const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

/**
 * 读取文件工具
 *
 * 支持：
 * - 文本文件：带行号输出
 * - PDF 文件：提取文本内容（支持 pages 参数指定页码范围）
 * - 图片文件：返回 base64 编码（可被 Vision 模型识别）
 */
export class ReadTool extends BaseTool {
  readonly name = 'read_file';
  readonly description = [
    'Read file content. Supports text, PDF, and image files.',
    '',
    '# Supported File Types',
    '- Text files: Output with line numbers, supports offset/limit pagination for large files',
    '- PDF files: Extract text content, large PDFs (>10 pages) require pages parameter',
    '- Image files (PNG/JPG/GIF/WebP): Return base64 encoding, readable by Vision models',
    '',
    '# Use Cases',
    '✓ Must read before modifying files to understand existing code structure',
    '✓ View config files, log files, documentation',
    '✓ Analyze image content (requires Vision model support)',
    '✓ Large files (>2000 lines) use offset/limit for pagination',
    '',
    '# Parameter Examples',
    '- Read entire file: read_file({ path: "src/main.ts" })',
    '- Paginated read: read_file({ path: "large.log", offset: 1000, limit: 500 })',
    '- Read PDF pages: read_file({ path: "doc.pdf", pages: "1-5" })',
    '',
    '# Important Notes',
    '✗ Do NOT use bash cat (read_file has line numbers, formatting, truncation protection)',
    '✗ Do NOT re-read files already in conversation history',
  ].join('\n');
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path or path relative to project root',
      },
      offset: {
        type: 'number',
        description: 'Starting line number (1-based), omit to read from beginning (text files only)',
      },
      limit: {
        type: 'number',
        description: 'Number of lines to read, omit to read all (text files only)',
      },
      pages: {
        type: 'string',
        description: 'PDF page range, e.g. "1-5", "3", "10-20". Required for PDFs >20 pages. Max 20 pages per call.',
      },
    },
    required: ['path'],
  };

  /** 只读工具（可并行执行） */
  readonly readonly = true;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input.path as string;
    const offset = (input.offset as number | undefined) ?? 1;
    const limit = input.limit as number | undefined;
    const pages = input.pages as string | undefined;

    log.debug(`Reading file: ${filePath}`, { offset, limit, pages });

    try {
      // 检查文件是否存在
      try {
        await access(filePath);
      } catch {
        log.warn(`File not found: ${filePath}`);
        return this.error(`文件不存在: ${filePath}`);
      }

      const ext = path.extname(filePath).toLowerCase();

      // PDF 文件
      if (ext === '.pdf') {
        log.debug(`Reading PDF file: ${filePath}`);
        return this.readPDF(filePath, pages);
      }

      // 图片文件
      if (IMAGE_EXTENSIONS.has(ext)) {
        log.debug(`Reading image file: ${filePath}`);
        return this.readImage(filePath, ext);
      }

      // 文本文件（原有逻辑）
      const result = await this.readText(filePath, offset, limit);
      log.info(`File read successfully: ${filePath}`, {
        size: result.content.length,
        truncated: result.content.includes('[truncated]')
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Failed to read file: ${filePath}`, { error: message });
      return this.error(`读取文件失败: ${message}`);
    }
  }

  // ============================================================
  // 文本文件读取
  // ============================================================

  /** 大文件阈值（超过此值使用流式读取） */
  private static readonly LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB

  private async readText(filePath: string, offset: number, limit: number | undefined): Promise<ToolResult> {
    const fileStats = await stat(filePath);

    // 大文件使用流式读取
    if (fileStats.size > ReadTool.LARGE_FILE_THRESHOLD) {
      return this.readTextStream(filePath, offset, limit, fileStats.size);
    }

    const text = await readFile(filePath, 'utf-8');
    const lines = text.split('\n');

    // 切片
    const startIdx = Math.max(0, offset - 1);
    const endIdx = limit ? startIdx + limit : lines.length;
    const slice = lines.slice(startIdx, endIdx);

    // 限制格式化行数
    const needsTruncation = slice.length > MAX_FORMAT_LINES;
    const formatSlice = needsTruncation ? slice.slice(0, MAX_FORMAT_LINES) : slice;

    // 带行号输出
    const numbered = formatSlice
      .map((line, i) => `${String(startIdx + i + 1).padStart(6)} │ ${line}`)
      .join('\n');

    let output = numbered;
    if (needsTruncation) {
      const remaining = slice.length - MAX_FORMAT_LINES;
      output += `\n\n... [文件过大，已省略后续 ${remaining} 行。请使用 offset/limit 参数分页读取，如 offset=${startIdx + MAX_FORMAT_LINES + 1} limit=500]`;
    }

    output = middleTruncate(output, getMaxToolOutputLength());

    return this.success(output, {
      totalLines: lines.length,
      shownLines: formatSlice.length,
      truncated: needsTruncation || output.length < numbered.length,
      type: 'text',
    });
  }

  /**
   * 大文件流式读取（按行，避免一次性加载到内存）
   */
  private async readTextStream(
    filePath: string, offset: number, limit: number | undefined, fileSize: number,
  ): Promise<ToolResult> {
    const effectiveLimit = limit ?? MAX_FORMAT_LINES;
    const startIdx = Math.max(0, offset - 1);
    const lines: string[] = [];
    let lineNum = 0;
    let totalLines = 0;

    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      totalLines++;
      if (lineNum >= startIdx && lines.length < effectiveLimit) {
        lines.push(line);
      }
      lineNum++;
      // 如果已收集够行数且不需要计总行数，提前退出
      if (lines.length >= effectiveLimit && limit !== undefined) {
        rl.close();
        break;
      }
    }

    const numbered = lines
      .map((line, i) => `${String(startIdx + i + 1).padStart(6)} │ ${line}`)
      .join('\n');

    let output = middleTruncate(numbered, getMaxToolOutputLength());
    const sizeMB = Math.round(fileSize / 1024 / 1024);
    output = `[大文件: ${sizeMB}MB, 流式读取]\n${output}`;

    return this.success(output, {
      totalLines: totalLines || '未知',
      shownLines: lines.length,
      truncated: true,
      type: 'text',
      streamRead: true,
    });
  }

  // ============================================================
  // PDF 文件读取
  // ============================================================

  private async readPDF(filePath: string, pages?: string): Promise<ToolResult> {
    try {
      const { PDFParse } = await import('pdf-parse');
      const dataBuffer = await readFile(filePath);

      const parser = new PDFParse({ data: new Uint8Array(dataBuffer) });
      const textResult = await parser.getText();
      const totalPages = textResult.pages.length;

      // 大 PDF 必须指定页码范围
      if (totalPages > 20 && !pages) {
        await parser.destroy();
        return this.error(
          `PDF 共 ${totalPages} 页，超过 20 页限制。请使用 pages 参数指定页码范围，如 pages: "1-5"。`,
        );
      }

      let text: string;
      if (pages) {
        const { start, end } = this.parsePageRange(pages, totalPages);
        // 按页提取文本
        text = textResult.pages
          .filter((_, i) => i + 1 >= start && i + 1 <= end)
          .map((p) => p.text)
          .join('\n');
      } else {
        text = textResult.text;
      }

      await parser.destroy();

      text = middleTruncate(text, getMaxToolOutputLength());

      return this.success(
        `[PDF] ${filePath} (${totalPages} 页)\n${pages ? `页码范围: ${pages}\n` : ''}\n${text}`,
        {
          type: 'pdf',
          totalPages,
          pages: pages ?? `1-${totalPages}`,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('password')) {
        return this.error(`PDF 需要密码，请解密后重试: ${filePath}`);
      }
      return this.error(`PDF 读取失败: ${message}`);
    }
  }

  private parsePageRange(pages: string, totalPages: number): { start: number; end: number } {
    const match = pages.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) {
      throw new Error(`无效的页码范围: ${pages}，格式如 "1-5", "3", "10-20"`);
    }

    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : start;

    if (start < 1 || end < start || end > totalPages) {
      throw new Error(`页码范围超出 (1-${totalPages}): ${pages}`);
    }

    if (end - start + 1 > 20) {
      throw new Error(`每次最多读取 20 页，当前范围 ${end - start + 1} 页`);
    }

    return { start, end };
  }

  // ============================================================
  // 图片文件读取
  // ============================================================

  private async readImage(filePath: string, ext: string): Promise<ToolResult> {
    // 先检查大小，防止超大文件导致 OOM
    const fileStats = await stat(filePath);
    const sizeKB = Math.round(fileStats.size / 1024);
    if (fileStats.size > 20 * 1024 * 1024) {
      const sizeStr = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)}MB` : `${sizeKB}KB`;
      return this.error(`图片文件过大 (${sizeStr})，超过 20MB 限制`);
    }

    const imageBuffer = await readFile(filePath);
    const base64 = imageBuffer.toString('base64');
    const mimeType = MIME_MAP[ext] ?? 'application/octet-stream';

    return {
      content: `[Image] ${filePath} (${sizeKB}KB, ${mimeType})`,
      isError: false,
      metadata: {
        type: 'image',
        mimeType,
        sizeKB,
        base64Length: base64.length,
      },
      // 结构化 Vision content block，Anthropic API 可直接识别
      contentBlocks: [{
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType,
          data: base64,
        },
      }],
    };
  }
}
