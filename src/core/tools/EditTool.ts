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
  readonly description = '对文件进行精确的字符串替换。需要提供要查找的原始字符串和替换后的新字符串。默认情况下原始字符串必须在文件中唯一匹配，使用 replace_all=true 可替换所有匹配项。';
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径',
      },
      old_string: {
        type: 'string',
        description: '要被替换的原始字符串 (默认必须在文件中唯一存在)',
      },
      new_string: {
        type: 'string',
        description: '替换后的新字符串',
      },
      replace_all: {
        type: 'boolean',
        description: '是否替换所有匹配项（默认 false，仅替换唯一匹配）。设为 true 时可用于批量重命名变量等场景。',
        default: false,
      },
    },
    required: ['path', 'old_string', 'new_string'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const path = input.path as string;
    const oldStr = input.old_string as string;
    const newStr = input.new_string as string;
    const replaceAll = (input.replace_all as boolean) ?? false;

    try {
      // 检查文件是否存在
      try {
        await access(path);
      } catch {
        return this.error(`文件不存在: ${path}`);
      }

      const content = await readFile(path, 'utf-8');

      // 空 old_string 无意义（会匹配所有位置）
      if (oldStr.length === 0) {
        return this.error('old_string 不能为空。如需创建新文件，请使用 write_file 工具。');
      }

      // 检查匹配次数
      const occurrences = content.split(oldStr).length - 1;
      if (occurrences === 0) {
        return this.error(`未找到匹配的字符串:\n${oldStr}`);
      }

      // 非全局替换时要求唯一匹配
      if (!replaceAll && occurrences > 1) {
        // 找到所有匹配位置的行号和上下文
        const lines = content.split('\n');
        const matchLines: { lineNum: number; context: string }[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(oldStr.split('\n')[0])) {
            matchLines.push({
              lineNum: i + 1,
              context: lines[i].trim().slice(0, 80),
            });
          }
        }
        const locations = matchLines
          .map((m) => `  行 ${m.lineNum}: ${m.context}`)
          .join('\n');
        return this.error(
          `找到 ${occurrences} 处匹配，old_string 必须唯一。匹配位置:\n${locations}\n\n请提供更多上下文使其唯一，或使用 replace_all: true 替换所有匹配。`,
        );
      }

      // 执行替换
      const newContent = replaceAll
        ? content.replaceAll(oldStr, newStr)
        : content.replace(oldStr, newStr);
      await writeFile(path, newContent, 'utf-8');

      const countInfo = replaceAll && occurrences > 1
        ? ` (共替换 ${occurrences} 处)`
        : '';
      return this.success(`已编辑 ${path}${countInfo}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`编辑文件失败: ${message}`);
    }
  }
}
