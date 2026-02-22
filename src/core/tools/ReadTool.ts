// ============================================================
// M6 工具系统 — ReadTool 读取文件
// ============================================================

import { readFile, access } from 'node:fs/promises';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';

/**
 * 读取文件工具
 */
export class ReadTool extends BaseTool {
  readonly name = 'read_file';
  readonly description = '读取指定文件的内容。支持文本文件。输出带行号的内容。';
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件的绝对路径或相对于项目根目录的路径',
      },
      offset: {
        type: 'number',
        description: '起始行号 (从 1 开始)，不传则从头开始读取',
      },
      limit: {
        type: 'number',
        description: '读取的行数，不传则读取全部',
      },
    },
    required: ['path'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const path = input.path as string;
    const offset = (input.offset as number | undefined) ?? 1;
    const limit = input.limit as number | undefined;

    try {
      // 检查文件是否存在
      try {
        await access(path);
      } catch {
        return this.error(`文件不存在: ${path}`);
      }

      const text = await readFile(path, 'utf-8');
      const lines = text.split('\n');

      // 切片
      const startIdx = Math.max(0, offset - 1);
      const endIdx = limit ? startIdx + limit : lines.length;
      const slice = lines.slice(startIdx, endIdx);

      // 带行号输出
      const numbered = slice
        .map((line, i) => `${String(startIdx + i + 1).padStart(6)} │ ${line}`)
        .join('\n');

      return this.success(numbered, {
        totalLines: lines.length,
        shownLines: slice.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`读取文件失败: ${message}`);
    }
  }
}
