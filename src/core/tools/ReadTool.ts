// ============================================================
// M6 工具系统 — ReadTool 读取文件
// ============================================================

import { readFile, stat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { middleTruncate, getMaxToolOutputLength } from '@/shared/utils/truncation';
import { logger } from '@/core/logger';
import { FORMAT_PARSERS } from './parsers';
import type { ParserLoader } from './parsers';

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
    'Read file contents for your own analysis. Supports text files (with line numbers) and PDFs.',
    'For images: only returns file metadata (path, size, format). You CANNOT see image pixel content from this tool.',
    'If you need to analyze an image visually, ask the user to describe it or paste it directly into the chat.',
    'To send/display a file to the user, use the send_file_to_user tool instead.',
    '',
    'For large files use offset/limit to read specific sections.',
    'For directories, use list_directory instead.',
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
      // Check if file exists
      try {
        const fileStats = await stat(filePath);
        if (fileStats.isDirectory()) {
          // Directory: auto-list contents to help agent locate files
          return this.readDirectory(filePath);
        }
      } catch {
        log.warn(`File not found: ${filePath}`);
        // File not found: give clear search suggestions
        const dirPath = path.dirname(filePath);
        const baseName = path.basename(filePath);
        return this.error(
          `File not found: ${filePath}\n\n` +
          `Suggestions:\n` +
          `1. Use glob to search for related files: glob({ pattern: "**/${baseName}" })\n` +
          `2. View parent directory contents: read_file({ path: "${dirPath}" })\n` +
          `3. Use list_directory to browse project structure`
        );
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

      // 特殊格式文件（Office / Ebook / Notebook / Config / DB / LaTeX）
      const parserLoader: ParserLoader | undefined = FORMAT_PARSERS[ext];
      if (parserLoader) {
        log.debug(`Reading ${ext} file via parser: ${filePath}`);
        const parser = await parserLoader();
        const result = await parser(filePath);
        const output = middleTruncate(result.content, getMaxToolOutputLength());
        return this.success(
          `[${ext.toUpperCase()}] ${filePath}\n\n${output}`,
          { type: ext.slice(1), ...result.metadata }
        );
      }

      // Text file (original logic)
      const result = await this.readText(filePath, offset, limit);
      log.info(`File read successfully: ${filePath}`, {
        size: result.content.length,
        truncated: result.content.includes('[truncated]')
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Failed to read file: ${filePath}`, { error: message });
      return this.error(`Failed to read file: ${message}`);
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
      output += `\n\n... [File too large, omitted ${remaining} remaining lines. Use offset/limit to paginate, e.g. offset=${startIdx + MAX_FORMAT_LINES + 1} limit=500]`;
    }

    output = middleTruncate(output, getMaxToolOutputLength());

    return this.success(output, {
      totalLines: lines.length,
      shownLines: formatSlice.length,
      truncated: needsTruncation || output.length < numbered.length,
      type: 'text',
    });
  }

  // ============================================================
  // 目录读取（智能降级：read_file 传入目录时自动列出内容）
  // ============================================================

  private async readDirectory(dirPath: string): Promise<ToolResult> {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const dirs: string[] = [];
      const files: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push(`📁 ${entry.name}/`);
        } else if (entry.isSymbolicLink()) {
          files.push(`🔗 ${entry.name}`);
        } else {
          files.push(`📄 ${entry.name}`);
        }
      }

      const listing = [
        `[Directory] ${dirPath}`,
        `${entries.length} entries (${dirs.length} dirs, ${files.length} files)`,
        '',
        ...dirs.sort(),
        ...files.sort(),
      ].join('\n');

      const output = middleTruncate(listing, getMaxToolOutputLength());

      return this.success(output, {
        type: 'directory',
        totalEntries: entries.length,
        directoryCount: dirs.length,
        fileCount: files.length,
        path: dirPath,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`Failed to read directory: ${message}`);
    }
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
    output = `[Large file: ${sizeMB}MB, stream read]\n${output}`;

    return this.success(output, {
      totalLines: totalLines || 'unknown',
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

      // Large PDF must specify page range
      if (totalPages > 20 && !pages) {
        await parser.destroy();
        return this.error(
          `PDF has ${totalPages} pages, exceeding the 20-page limit. Use the pages parameter to specify a page range, e.g. pages: "1-5".`,
        );
      }

      let text: string;
      if (pages) {
        const { start, end } = this.parsePageRange(pages, totalPages);
        // Extract text by page
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
        `[PDF] ${filePath} (${totalPages} pages)\n${pages ? `Page range: ${pages}\n` : ''}\n${text}`,
        {
          type: 'pdf',
          totalPages,
          pages: pages ?? `1-${totalPages}`,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('password')) {
        return this.error(`PDF is password-protected, please decrypt and retry: ${filePath}`);
      }
      return this.error(`PDF read failed: ${message}`);
    }
  }

  private parsePageRange(pages: string, totalPages: number): { start: number; end: number } {
    const match = pages.match(/^(\d+)(?:-(\d+))?$/);
    if (!match) {
      throw new Error(`Invalid page range: ${pages}, format: "1-5", "3", "10-20"`);
    }

    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : start;

    if (start < 1 || end < start || end > totalPages) {
      throw new Error(`Page range out of bounds (1-${totalPages}): ${pages}`);
    }

    if (end - start + 1 > 20) {
      throw new Error(`Max 20 pages per read, current range is ${end - start + 1} pages`);
    }

    return { start, end };
  }

  // ============================================================
  // 图片文件读取
  // ============================================================

  private async readImage(filePath: string, ext: string): Promise<ToolResult> {
    // Check file size first to prevent OOM
    const fileStats = await stat(filePath);
    const sizeKB = Math.round(fileStats.size / 1024);
    if (fileStats.size > 20 * 1024 * 1024) {
      const sizeStr = sizeKB > 1024 ? `${(sizeKB / 1024).toFixed(1)}MB` : `${sizeKB}KB`;
      return this.error(`Image file too large (${sizeStr}), exceeds 20MB limit`);
    }

    const imageBuffer = await readFile(filePath);
    const base64 = imageBuffer.toString('base64');
    const mimeType = MIME_MAP[ext] ?? 'application/octet-stream';

    return {
      content: `[Image file — NOT analyzed] ${filePath} (${sizeKB}KB, ${mimeType})\n\n` +
        `You CANNOT see this image's visual content. You only have the file path and metadata above.\n` +
        `Do NOT describe, analyze, or interpret what you think is in this image.\n` +
        `If the user needs image analysis, ask them to describe the content or paste the relevant text.`,
      isError: false,
      metadata: {
        type: 'image',
        mimeType,
        sizeKB,
        base64Length: base64.length,
      },
      // Flat-format contentBlocks, shared between frontend and backend
      contentBlocks: [{
        type: 'image',
        mimeType,
        data: base64,
      }],
    };
  }
}
