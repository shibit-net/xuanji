// ============================================================
// M6 工具系统 — GrepTool 内容搜索
// ============================================================

import { BaseTool } from './BaseTool';
import type { ToolResult, JSONSchema } from '@/core/types';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import glob from 'fast-glob';
import { middleTruncate, MAX_TOOL_OUTPUT_LENGTH } from '@/core/utils/truncation';

const MAX_MATCHES = 500; // 最多匹配数
const MAX_CONTEXT_LINES = 5; // 上下文行数限制
const MAX_MATCHES_PER_FILE = 50; // 每个文件最多匹配数

type OutputMode = 'content' | 'files_with_matches' | 'count';

interface GrepInput {
  pattern: string;
  path: string;
  glob?: string;
  case_insensitive?: boolean;
  output_mode?: OutputMode;
  context?: number;
}

interface MatchResult {
  lineNumber: number;
  line: string;
  context?: {
    before: string[];
    after: string[];
  };
}

interface FileMatch {
  file: string;
  matches: MatchResult[];
}

interface SearchResults {
  matchedFiles: number;
  totalMatches: number;
  matches: Array<FileMatch | string | { file: string; count: number }>;
}

/**
 * Grep 内容搜索工具
 * 在文件中搜索文本模式（支持正则表达式）
 */
export class GrepTool extends BaseTool {
  readonly name = 'grep';
  readonly description = '在文件中搜索文本模式（支持正则表达式）。返回匹配行及其上下文。';
  readonly readonly = true; // ✅ 只读工具，可并行执行

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: '搜索模式（JavaScript 正则表达式），如 "function\\s+\\w+" 查找函数定义',
      },
      path: {
        type: 'string',
        description: '搜索路径（文件或目录）',
      },
      glob: {
        type: 'string',
        description: '文件过滤 glob 模式，如 "*.ts" 只搜索 TS 文件（仅在 path 是目录时生效）',
      },
      case_insensitive: {
        type: 'boolean',
        description: '是否忽略大小写（默认 false）',
      },
      output_mode: {
        type: 'string',
        enum: ['content', 'files_with_matches', 'count'],
        description: 'content=显示匹配内容, files_with_matches=仅显示文件名（默认）, count=显示匹配计数',
      },
      context: {
        type: 'number',
        description: '显示匹配行的上下文行数（0-5，默认 0）',
      },
    },
    required: ['pattern', 'path'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const {
        pattern,
        path: searchPath,
        glob: globPattern,
        case_insensitive = false,
        output_mode = 'files_with_matches',
        context = 0,
      } = input as unknown as GrepInput;

      const resolvedPath = path.resolve(searchPath);
      const stats = await stat(resolvedPath);

      // 构建正则表达式
      const flags = case_insensitive ? 'gi' : 'g';
      const regex = new RegExp(pattern, flags);

      // 确定搜索文件列表和基础路径
      let files: string[];
      let basePath: string;
      if (stats.isFile()) {
        files = [resolvedPath];
        basePath = path.dirname(resolvedPath);
      } else if (stats.isDirectory()) {
        const pattern = globPattern || '**/*';
        files = await glob(pattern, {
          cwd: resolvedPath,
          onlyFiles: true,
          ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
          absolute: true,
        });
        basePath = resolvedPath;
      } else {
        return this.error('path 必须是文件或目录');
      }

      // 执行搜索
      const contextLines = Math.min(context, MAX_CONTEXT_LINES);
      const results = await this.searchFiles(files, regex, output_mode, contextLines);

      // 格式化输出
      let output = this.formatResults(results, output_mode, basePath);
      output = middleTruncate(output, MAX_TOOL_OUTPUT_LENGTH);

      return this.success(output, {
        totalFiles: files.length,
        matchedFiles: results.matchedFiles,
        totalMatches: results.totalMatches,
        mode: output_mode,
        pattern,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.error(`Grep 搜索失败: ${message}`);
    }
  }

  private async searchFiles(
    files: string[],
    regex: RegExp,
    mode: OutputMode,
    context: number,
  ): Promise<SearchResults> {
    const results: SearchResults = {
      matchedFiles: 0,
      totalMatches: 0,
      matches: [],
    };

    for (const file of files) {
      try {
        const content = await readFile(file, 'utf-8');
        const lines = content.split('\n');
        const fileMatches: MatchResult[] = [];
        let fileMatchCount = 0;

        // 逐行搜索
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // 重置 regex lastIndex 以确保每行都从头匹配
          regex.lastIndex = 0;
          if (regex.test(line)) {
            fileMatchCount++;
            results.totalMatches++;

            if (mode === 'content') {
              // 提取上下文
              const start = Math.max(0, i - context);
              const end = Math.min(lines.length - 1, i + context);
              fileMatches.push({
                lineNumber: i + 1,
                line,
                context:
                  context > 0
                    ? {
                        before: lines.slice(start, i),
                        after: lines.slice(i + 1, end + 1),
                      }
                    : undefined,
              });

              // 限制每个文件的匹配数
              if (fileMatches.length >= MAX_MATCHES_PER_FILE) break;
            }
          }
        }

        if (fileMatchCount > 0) {
          results.matchedFiles++;
          if (mode === 'content') {
            results.matches.push({ file, matches: fileMatches });
          } else if (mode === 'files_with_matches') {
            results.matches.push(file);
          } else if (mode === 'count') {
            results.matches.push({ file, count: fileMatchCount });
          }
        }

        // 限制总匹配文件数
        if (results.matchedFiles >= MAX_MATCHES) break;
      } catch {
        // 跳过无法读取的文件（如二进制文件）
        continue;
      }
    }

    return results;
  }

  private formatResults(results: SearchResults, mode: OutputMode, basePath: string): string {
    if (results.matchedFiles === 0) {
      return '未找到匹配项';
    }

    if (mode === 'files_with_matches') {
      return (results.matches as string[]).map((f) => path.relative(basePath, f)).join('\n');
    }

    if (mode === 'count') {
      return (results.matches as Array<{ file: string; count: number }>)
        .map((m) => `${path.relative(basePath, m.file)}: ${m.count}`)
        .join('\n');
    }

    // mode === 'content'
    const output: string[] = [];
    for (const fileMatch of results.matches as FileMatch[]) {
      const relPath = path.relative(basePath, fileMatch.file);
      output.push(`\n=== ${relPath} ===`);

      for (const match of fileMatch.matches) {
        if (match.context?.before) {
          // 上文
          match.context.before.forEach((l, i) => {
            const lineNum = match.lineNumber - match.context!.before.length + i;
            output.push(`${String(lineNum).padStart(6)} │ ${l}`);
          });
        }
        // 匹配行
        output.push(`${String(match.lineNumber).padStart(6)} │ ${match.line}`);
        if (match.context?.after) {
          // 下文
          match.context.after.forEach((l, i) => {
            const lineNum = match.lineNumber + i + 1;
            output.push(`${String(lineNum).padStart(6)} │ ${l}`);
          });
        }
        output.push(''); // 空行分隔
      }
    }

    return output.join('\n');
  }
}
