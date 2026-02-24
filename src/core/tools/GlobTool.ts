// ============================================================
// M6 工具系统 — GlobTool 文件路径查找
// ============================================================

import { BaseTool } from './BaseTool';
import type { ToolResult, JSONSchema } from '@/core/types';
import glob from 'fast-glob';
import path from 'node:path';
import { middleTruncate, MAX_TOOL_OUTPUT_LENGTH } from '@/core/utils/truncation';

const MAX_FILES = 1000; // 最多返回文件数

interface GlobInput {
  pattern: string;
  path?: string;
  ignore?: string[];
}

/**
 * Glob 文件查找工具
 * 使用 glob 模式查找文件路径，支持通配符匹配
 */
export class GlobTool extends BaseTool {
  readonly name = 'glob';
  readonly description =
    '使用 glob 模式查找文件路径。支持通配符：* (任意字符), ** (递归目录), ? (单字符), [abc] (字符集)';
  readonly readonly = true; // ✅ 只读工具，可并行执行

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description:
          'glob 模式，如 "**/*.ts" 查找所有 TS 文件，"src/**/*.test.ts" 查找测试文件',
      },
      path: {
        type: 'string',
        description: '搜索根目录（默认为当前工作目录）',
      },
      ignore: {
        type: 'array',
        items: { type: 'string' },
        description:
          '排除模式数组，如 ["**/node_modules/**", "**/dist/**"]（默认已排除 node_modules/.git）',
      },
    },
    required: ['pattern'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const { pattern, path: searchPath, ignore: userIgnore } = input as unknown as GlobInput;
      const cwd = searchPath ? path.resolve(searchPath) : process.cwd();

      // 默认排除常见目录
      const defaultIgnore = [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/.DS_Store',
      ];

      const ignore = userIgnore ? [...defaultIgnore, ...userIgnore] : defaultIgnore;

      // 执行 glob 搜索
      const files = await glob(pattern, {
        cwd,
        ignore,
        onlyFiles: true,
        dot: false, // 不包含隐藏文件（除非显式指定）
        absolute: false, // 返回相对路径
      });

      // 排序（字母顺序）
      const sortedFiles = files.sort();

      // 截断保护
      const truncated = sortedFiles.length > MAX_FILES;
      const displayFiles = truncated ? sortedFiles.slice(0, MAX_FILES) : sortedFiles;

      // 构建输出
      let output = displayFiles.join('\n');

      if (truncated) {
        output += `\n\n[已截断：找到 ${sortedFiles.length} 个文件，仅显示前 ${MAX_FILES} 个]`;
      }

      // 输出长度截断
      output = middleTruncate(output, MAX_TOOL_OUTPUT_LENGTH);

      return this.success(output, {
        totalMatches: sortedFiles.length,
        shownMatches: displayFiles.length,
        truncated,
        pattern,
        cwd,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.error(`Glob 搜索失败: ${message}`);
    }
  }
}
