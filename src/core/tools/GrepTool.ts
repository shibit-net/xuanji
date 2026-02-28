// ============================================================
// M6 工具系统 — GrepTool 内容搜索 (ripgrep + JS fallback)
// ============================================================

import { BaseTool } from './BaseTool';
import type { ToolResult, JSONSchema } from '@/core/types';
import { readFile, stat } from 'node:fs/promises';
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import glob from 'fast-glob';
import { middleTruncate, MAX_TOOL_OUTPUT_LENGTH } from '@/core/utils/truncation';
import { getGrepConfig } from '@/core/config/RuntimeConfig';
import { logger } from '@/core/logger';

const MAX_MATCHES = 500;
const MAX_CONTEXT_LINES = 5;
const MAX_MATCHES_PER_FILE = 50;

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

/** 检测 ripgrep 是否可用（缓存结果） */
let rgAvailable: boolean | null = null;
function isRipgrepAvailable(): boolean {
  if (rgAvailable !== null) return rgAvailable;
  try {
    execSync('rg --version', { stdio: 'ignore' });
    rgAvailable = true;
  } catch {
    rgAvailable = false;
    logger.child({ module: 'GrepTool' }).warn(
      'ripgrep (rg) 未安装，降级到 JS 搜索引擎。建议安装: brew install ripgrep / apt install ripgrep',
    );
  }
  return rgAvailable;
}

/**
 * Grep 内容搜索工具
 *
 * 优先使用 ripgrep (rg) 子进程（Rust 实现，性能优异），
 * 未安装时自动降级到纯 JS 搜索引擎。
 */
export class GrepTool extends BaseTool {
  readonly name = 'grep';
  readonly description = '在文件中搜索文本模式（支持正则表达式）。返回匹配行及其上下文。优先使用 ripgrep 高性能搜索。';
  readonly readonly = true;

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: '搜索模式（正则表达式），如 "function\\s+\\w+" 查找函数定义',
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
      const contextLines = Math.min(context, getGrepConfig()?.maxContextLines ?? MAX_CONTEXT_LINES);

      // 优先使用 ripgrep
      if (isRipgrepAvailable()) {
        return await this.searchWithRipgrep(
          pattern, resolvedPath, globPattern, case_insensitive, output_mode, contextLines,
        );
      }

      // 降级到 JS 搜索
      return await this.searchWithJS(
        pattern, resolvedPath, globPattern, case_insensitive, output_mode, contextLines,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.error(`Grep 搜索失败: ${message}`);
    }
  }

  // ============================================================
  // ripgrep 子进程搜索
  // ============================================================

  private async searchWithRipgrep(
    pattern: string,
    searchPath: string,
    globPattern: string | undefined,
    caseInsensitive: boolean,
    outputMode: OutputMode,
    context: number,
  ): Promise<ToolResult> {
    const args: string[] = [];

    // 基本参数
    args.push('--json'); // JSON Lines 输出格式
    args.push('--max-count', String(getGrepConfig()?.maxMatchesPerFile ?? MAX_MATCHES_PER_FILE));

    if (caseInsensitive) {
      args.push('--case-insensitive');
    }

    if (context > 0 && outputMode === 'content') {
      args.push('--context', String(context));
    }

    if (globPattern) {
      args.push('--glob', globPattern);
    }

    // 默认忽略
    args.push('--glob', '!node_modules');
    args.push('--glob', '!.git');
    args.push('--glob', '!dist');

    // 模式和路径
    args.push(pattern, searchPath);

    return new Promise<ToolResult>((resolve) => {
      const proc = spawn('rg', args, {
        cwd: process.cwd(),
        env: { ...process.env },
      });

      const chunks: Buffer[] = [];
      proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      proc.stderr.on('data', () => {}); // 忽略 stderr

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve(this.error('ripgrep 搜索超时 (60s)'));
      }, 60_000);

      proc.on('close', (exitCode) => {
        clearTimeout(timer);
        const output = Buffer.concat(chunks).toString('utf-8');

        // exitCode 1 = 无匹配（正常），exitCode 2 = 错误
        if (exitCode === 2) {
          resolve(this.error(`ripgrep 错误 (exit ${exitCode})`));
          return;
        }

        try {
          const results = this.parseRipgrepOutput(output, searchPath, outputMode);
          let formattedOutput = this.formatResults(results, outputMode, searchPath);
          formattedOutput = middleTruncate(formattedOutput, MAX_TOOL_OUTPUT_LENGTH);

          resolve(this.success(formattedOutput, {
            totalMatches: results.totalMatches,
            matchedFiles: results.matchedFiles,
            mode: outputMode,
            pattern,
            engine: 'ripgrep',
          }));
        } catch (parseError) {
          const msg = parseError instanceof Error ? parseError.message : String(parseError);
          resolve(this.error(`解析 ripgrep 输出失败: ${msg}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve(this.error(`ripgrep 执行失败: ${err.message}`));
      });
    });
  }

  /**
   * 解析 ripgrep --json 输出
   * 每行一个 JSON 对象，类型有: begin, match, context, end, summary
   */
  private parseRipgrepOutput(
    output: string,
    basePath: string,
    mode: OutputMode,
  ): SearchResults {
    const results: SearchResults = {
      matchedFiles: 0,
      totalMatches: 0,
      matches: [],
    };

    if (!output.trim()) return results;

    // 按文件聚合
    const fileMap = new Map<string, { matches: MatchResult[]; count: number }>();

    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.type === 'match') {
        const filePath = entry.data.path?.text;
        const lineNumber = entry.data.line_number;
        const text = entry.data.lines?.text?.replace(/\n$/, '') ?? '';

        if (!filePath) continue;

        if (!fileMap.has(filePath)) {
          fileMap.set(filePath, { matches: [], count: 0 });
        }
        const file = fileMap.get(filePath)!;
        file.count++;
        results.totalMatches++;

        if (mode === 'content') {
          file.matches.push({
            lineNumber,
            line: text,
          });
        }
      } else if (entry.type === 'context' && mode === 'content') {
        // 上下文行
        const filePath = entry.data.path?.text;
        const lineNumber = entry.data.line_number;
        const text = entry.data.lines?.text?.replace(/\n$/, '') ?? '';

        if (!filePath || !fileMap.has(filePath)) continue;
        const file = fileMap.get(filePath)!;
        const lastMatch = file.matches[file.matches.length - 1];
        if (!lastMatch) continue;

        // 判断是上文还是下文
        if (!lastMatch.context) {
          lastMatch.context = { before: [], after: [] };
        }
        if (lineNumber < lastMatch.lineNumber) {
          lastMatch.context.before.push(text);
        } else if (lineNumber > lastMatch.lineNumber) {
          lastMatch.context.after.push(text);
        }
      }
    }

    // 转换结果
    results.matchedFiles = fileMap.size;
    for (const [filePath, data] of fileMap) {
      if (mode === 'content') {
        results.matches.push({ file: filePath, matches: data.matches });
      } else if (mode === 'files_with_matches') {
        results.matches.push(filePath);
      } else if (mode === 'count') {
        results.matches.push({ file: filePath, count: data.count });
      }
    }

    return results;
  }

  // ============================================================
  // JS 降级搜索引擎 (原有实现)
  // ============================================================

  private async searchWithJS(
    pattern: string,
    resolvedPath: string,
    globPattern: string | undefined,
    caseInsensitive: boolean,
    outputMode: OutputMode,
    contextLines: number,
  ): Promise<ToolResult> {
    const stats = await stat(resolvedPath);
    const flags = caseInsensitive ? 'gi' : 'g';

    // ReDoS 防护：验证正则表达式安全性
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags);
      // 检测潜在的 ReDoS 模式：嵌套量词（如 (a+)+ 、(a|b)*+ 等）
      if (/(\.\*){3,}|(\([^)]*[+*][^)]*\))[+*]|\(\?[^)]+\)\{/.test(pattern)) {
        return this.error(`正则表达式可能导致性能问题（ReDoS 风险）: ${pattern}`);
      }
    } catch (regexErr) {
      return this.error(`无效的正则表达式: ${pattern} — ${regexErr instanceof Error ? regexErr.message : String(regexErr)}`);
    }

    let files: string[];
    let basePath: string;
    if (stats.isFile()) {
      files = [resolvedPath];
      basePath = path.dirname(resolvedPath);
    } else if (stats.isDirectory()) {
      const filePattern = globPattern || '**/*';
      files = await glob(filePattern, {
        cwd: resolvedPath,
        onlyFiles: true,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
        absolute: true,
      });
      basePath = resolvedPath;
    } else {
      return this.error('path 必须是文件或目录');
    }

    const results = await this.searchFilesJS(files, regex, outputMode, contextLines);

    let output = this.formatResults(results, outputMode, basePath);
    output = middleTruncate(output, MAX_TOOL_OUTPUT_LENGTH);

    return this.success(output, {
      totalFiles: files.length,
      matchedFiles: results.matchedFiles,
      totalMatches: results.totalMatches,
      mode: outputMode,
      pattern,
      engine: 'js-fallback',
    });
  }

  private async searchFilesJS(
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
        // 跳过二进制文件：读取前 512 字节检测 NUL 字符
        const fd = await (await import('node:fs/promises')).open(file, 'r');
        try {
          const probe = Buffer.alloc(512);
          const { bytesRead } = await fd.read(probe, 0, 512, 0);
          if (bytesRead > 0 && probe.subarray(0, bytesRead).includes(0)) {
            continue; // 二进制文件，跳过
          }
        } finally {
          await fd.close();
        }

        const content = await readFile(file, 'utf-8');
        const lines = content.split('\n');
        const fileMatches: MatchResult[] = [];
        let fileMatchCount = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          regex.lastIndex = 0;
          if (regex.test(line)) {
            fileMatchCount++;
            results.totalMatches++;

            if (mode === 'content') {
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

              if (fileMatches.length >= (getGrepConfig()?.maxMatchesPerFile ?? MAX_MATCHES_PER_FILE)) break;
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

        if (results.matchedFiles >= (getGrepConfig()?.maxMatches ?? MAX_MATCHES)) break;
      } catch {
        continue;
      }
    }

    return results;
  }

  // ============================================================
  // 格式化输出 (共用)
  // ============================================================

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
          match.context.before.forEach((l, i) => {
            const lineNum = match.lineNumber - match.context!.before.length + i;
            output.push(`${String(lineNum).padStart(6)} │ ${l}`);
          });
        }
        output.push(`${String(match.lineNumber).padStart(6)} │ ${match.line}`);
        if (match.context?.after) {
          match.context.after.forEach((l, i) => {
            const lineNum = match.lineNumber + i + 1;
            output.push(`${String(lineNum).padStart(6)} │ ${l}`);
          });
        }
        output.push('');
      }
    }

    return output.join('\n');
  }
}
