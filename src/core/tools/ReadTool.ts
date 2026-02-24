// ============================================================
// M6 工具系统 — ReadTool 读取文件
// ============================================================

import { readFile, access } from 'node:fs/promises';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { middleTruncate, MAX_TOOL_OUTPUT_LENGTH } from '@/core/utils/truncation';

/**
 * 单行格式化后的估算开销：行号前缀 "     N │ " 约 10 字符
 * 按保守估计平均 80 字符/行，MAX_TOOL_OUTPUT_LENGTH / 80 ≈ 375 行
 * 使用 2000 行作为安全上限（覆盖短行场景），超出后走截断逻辑
 */
const MAX_FORMAT_LINES = 2000;

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

  /** ✅ 显式标记为只读工具（可并行执行） */
  readonly readonly = true;

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

      // 限制格式化行数：避免对万行文件做完整 map 后再截断
      const needsTruncation = slice.length > MAX_FORMAT_LINES;
      const formatSlice = needsTruncation ? slice.slice(0, MAX_FORMAT_LINES) : slice;

      // 带行号输出
      const numbered = formatSlice
        .map((line, i) => `${String(startIdx + i + 1).padStart(6)} │ ${line}`)
        .join('\n');

      // 如果格式化时已限制行数，追加提示
      let output = numbered;
      if (needsTruncation) {
        const remaining = slice.length - MAX_FORMAT_LINES;
        output += `\n\n... [文件过大，已省略后续 ${remaining} 行。请使用 offset/limit 参数分页读取，如 offset=${startIdx + MAX_FORMAT_LINES + 1} limit=500]`;
      }

      // 最终截断保护（防止极端长行场景）
      output = middleTruncate(output, MAX_TOOL_OUTPUT_LENGTH);

      return this.success(output, {
        totalLines: lines.length,
        shownLines: formatSlice.length,
        truncated: needsTruncation || output.length < numbered.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`读取文件失败: ${message}`);
    }
  }
}
