// ============================================================
// M6 工具系统 — EditTool 编辑文件
// ============================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';

/**
 * 编辑文件工具 (精确字符串替换)
 */
export class EditTool extends BaseTool {
  readonly name = 'edit_file';
  readonly description = '对文件进行精确的字符串替换。需要提供要查找的原始字符串和替换后的新字符串。原始字符串必须在文件中唯一匹配。';
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径',
      },
      old_string: {
        type: 'string',
        description: '要被替换的原始字符串 (必须在文件中唯一存在)',
      },
      new_string: {
        type: 'string',
        description: '替换后的新字符串',
      },
    },
    required: ['path', 'old_string', 'new_string'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const path = input.path as string;
    const oldStr = input.old_string as string;
    const newStr = input.new_string as string;

    try {
      // 检查文件是否存在
      try {
        await access(path);
      } catch {
        return this.error(`文件不存在: ${path}`);
      }

      const content = await readFile(path, 'utf-8');

      // 检查匹配次数
      const occurrences = content.split(oldStr).length - 1;
      if (occurrences === 0) {
        return this.error(`未找到匹配的字符串:\n${oldStr}`);
      }
      if (occurrences > 1) {
        return this.error(`找到 ${occurrences} 处匹配，old_string 必须唯一匹配。请提供更多上下文使其唯一。`);
      }

      // 执行替换
      const newContent = content.replace(oldStr, newStr);
      await writeFile(path, newContent, 'utf-8');

      return this.success(`已编辑 ${path}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`编辑文件失败: ${message}`);
    }
  }
}
