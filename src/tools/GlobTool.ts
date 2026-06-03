// ============================================================
// M6 工具系统 — GlobTool 文件路径查找
// ============================================================

import { BaseTool } from './BaseTool';
import type { ToolResult, JSONSchema } from '@/infrastructure/core-types';
import glob from 'fast-glob';
import path from 'node:path';
import { middleTruncate, getMaxToolOutputLength } from '@/shared/utils/truncation';
import { getGlobConfig } from '@/infrastructure/config/RuntimeConfig';

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
    'Find files by glob pattern. Supports wildcards: * (any chars), ** (recursive dirs), ? (single char). Examples: "**/*.ts" for all TS files, "src/**/test/*.spec.ts" for test files.';
  readonly readonly = true; // ✅ 只读工具，可并行执行

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description:
          'Glob pattern, e.g. "**/*.ts" finds all TS files, "src/**/*.test.ts" finds test files',
      },
      path: {
        type: 'string',
        description: 'Search root directory (defaults to current working directory)',
      },
      ignore: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Exclude patterns array, e.g. ["**/node_modules/**", "**/dist/**"] (node_modules/.git already excluded by default)',
      },
    },
    required: ['pattern'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const { pattern, path: searchPath, ignore: userIgnore } = input as unknown as GlobInput;
      const cwd = searchPath ? path.resolve(searchPath) : ((input._cwd as string) || process.cwd());

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
      const maxFiles = getGlobConfig()?.maxFiles ?? MAX_FILES;
      const truncated = sortedFiles.length > maxFiles;
      const displayFiles = truncated ? sortedFiles.slice(0, maxFiles) : sortedFiles;

      // 构建输出
      let output = displayFiles.join('\n');

      if (truncated) {
        output += `\n\n[已截断：找到 ${sortedFiles.length} 个文件，仅显示前 ${maxFiles} 个]`;
      }

      // 输出长度截断
      output = middleTruncate(output, getMaxToolOutputLength());

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
