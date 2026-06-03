/**
 * DocToDocxTool — 将旧版 .doc 转换为 .docx
 *
 * 跨平台策略:
 *   macOS:   textutil -convert docx  (系统内置，零依赖)
 *   Windows: pandoc  (需安装，可便携打包)
 *   其他:     尝试 pandoc → antiword 文本提取
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, basename, extname } from 'node:path';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'DocToDocxTool' });
const isWindows = process.platform === 'win32';

interface Converter {
  name: string;
  convert: (input: string, output: string) => string; // returns command
  check: () => boolean;
}

function buildConverters(): Converter[] {
  const list: Converter[] = [];

  // macOS: textutil
  list.push({
    name: 'textutil',
    convert: (input, output) => `textutil -convert docx ${JSON.stringify(input)} -output ${JSON.stringify(output)}`,
    check: () => {
      try {
        execSync('which textutil', { stdio: 'ignore', timeout: 3000 });
        return true;
      } catch {
        return false;
      }
    },
  });

  // Cross-platform: pandoc
  list.push({
    name: 'pandoc',
    convert: (input, output) => `pandoc ${JSON.stringify(input)} -o ${JSON.stringify(output)}`,
    check: () => {
      try {
        const cmd = isWindows ? 'where pandoc' : 'which pandoc';
        execSync(cmd, { stdio: 'ignore', timeout: 3000 });
        return true;
      } catch {
        return false;
      }
    },
  });

  // Windows: Word COM automation (last resort, requires Word installed)
  if (isWindows) {
    list.push({
      name: 'word_com',
      convert: (input, output) => {
        const script = `
          $word = New-Object -ComObject Word.Application
          $word.Visible = $false
          $doc = $word.Documents.Open('${input.replace(/'/g, "''")}')
          $doc.SaveAs2('${output.replace(/'/g, "''")}', 16)  # 16 = wdFormatXMLDocument
          $doc.Close()
          $word.Quit()
          [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
        `;
        return `powershell -NoProfile -Command ${JSON.stringify(script)}`;
      },
      check: () => true, // assume PowerShell is available on Windows
    });
  }

  return list;
}

export class DocToDocxTool extends BaseTool {
  readonly name = 'doc_to_docx';
  readonly description = [
    'Convert old .doc files (Word 97-2004 binary format) to .docx.',
    'Use this whenever the user provides a .doc file to read or edit — convert first, then use read_file or docx_edit on the resulting .docx.',
    '',
    '=== USAGE ===',
    'doc_to_docx({ operation: "convert", file_path: "/path/to/file.doc" })',
    '',
    'A new .docx file will be created in the same directory.',
    '',
    '=== PLATFORM SUPPORT ===',
    'macOS:   Uses built-in textutil (always available).',
    'Windows: Tries pandoc, then Word COM automation (requires Word installed).',
    'Linux:   Requires pandoc (apt install pandoc).',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['convert'],
        description: 'Always "convert".',
      },
      file_path: {
        type: 'string',
        description: 'Path to the .doc file.',
      },
      output_path: {
        type: 'string',
        description: 'Optional output path for the .docx file. Default: same directory, same name, .docx extension.',
      },
    },
    required: ['operation', 'file_path'],
  };

  readonly readonly = false;

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const operation = input.operation as string;
    if (operation !== 'convert') {
      return this.formatError({
        type: '参数错误',
        message: `不支持的操作: ${operation}`,
        reason: 'operation 目前仅支持 "convert"。',
        solutions: ['使用 convert 操作转换 .doc 到 .docx'],
      });
    }

    const rawPath = input.file_path as string | undefined;
    if (!rawPath || typeof rawPath !== 'string') {
      return this.error('缺少 file_path 参数。请提供 .doc 文件路径。');
    }
    const filePath = resolve(rawPath);
    const ext = extname(filePath).toLowerCase();
    if (ext !== '.doc') {
      return this.error(`仅支持 .doc 文件（旧版 Word 格式），当前文件扩展名: ${ext}。对于 .docx 文件无需转换。`);
    }
    if (!existsSync(filePath)) {
      return this.error(`文件不存在: ${filePath}`);
    }

    const outputPath = resolve(
      (input.output_path as string) ||
        filePath.replace(/\.doc$/i, '.docx')
    );

    // Build converter list each time to reflect current system state
    const converters = buildConverters();
    const available = converters.filter(c => c.check());

    if (available.length === 0) {
      const platformHint = isWindows
        ? 'Windows: 安装 pandoc (choco install pandoc) 或确保已安装 Microsoft Word。'
        : 'Linux: 安装 pandoc (apt install pandoc)。';
      return this.error(
        `未找到可用的 .doc 转换器。\n\n${platformHint}\n\n` +
        '替代方案: 手动将 .doc 另存为 .docx 格式后重试。'
      );
    }

    const lastError: string[] = [];
    for (const converter of available) {
      try {
        log.info(`Trying converter: ${converter.name} for ${filePath}`);
        const cmd = converter.convert(filePath, outputPath);
        execSync(cmd, { timeout: 60000, stdio: 'pipe' });

        if (existsSync(outputPath)) {
          return this.success(
            `已转换: ${filePath} → ${outputPath} (使用 ${converter.name})`,
            { operation: 'convert', converter: converter.name, inputPath: filePath, outputPath },
          );
        }
        lastError.push(`${converter.name}: 命令执行完成但未生成输出文件`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastError.push(`${converter.name}: ${msg}`);
        log.warn(`Converter ${converter.name} failed`, { error: msg });
      }
    }

    return this.error(
      `所有转换器均失败:\n${lastError.map(e => `  - ${e}`).join('\n')}\n\n` +
      '建议: 手动将 .doc 另存为 .docx 格式。'
    );
  }
}
