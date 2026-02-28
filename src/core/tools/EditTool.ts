// ============================================================
// M6 工具系统 — EditTool 编辑文件
// ============================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';

/**
 * 编辑文件工具 (精确字符串替换)
 */
export class EditTool extends BaseTool {
  readonly name = 'edit_file';
  readonly description = [
    '对文件进行精确的字符串替换。',
    '',
    '# 使用指南',
    '- 编辑前必须先用 read_file 读取文件内容，确保了解当前代码结构',
    '- old_string 必须与文件内容完全匹配 (包括缩进和空格)',
    '- 如果 old_string 匹配多处, 需要提供更多上下文使其唯一, 或使用 replace_all=true',
    '- replace_all=true 适合变量重命名等批量替换场景',
    '- 优先使用 edit_file 而非 write_file 修改已有文件 — 仅发送差异, 更安全高效',
    '- 不要添加未被要求的注释、文档或类型注解',
    '- 删除代码时直接删除, 不要留"// removed"注释或未使用的变量',
  ].join('\n');
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
    const rawPath = input.path as string;
    const oldStr = input.old_string as string;
    const newStr = input.new_string as string;
    const replaceAll = (input.replace_all as boolean) ?? false;
    const path = resolve(rawPath);

    // 路径穿越保护：禁止编辑敏感系统目录
    if (this.isSensitivePath(path)) {
      return this.error(`安全限制: 不允许编辑路径 "${path}"。该路径位于受保护的系统或用户目录。`);
    }

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
        const matchLines: { lineNum: number; context: string }[] = [];
        let searchFrom = 0;
        while (true) {
          const idx = content.indexOf(oldStr, searchFrom);
          if (idx === -1) break;
          // 计算行号：idx 之前有多少个 \n
          const lineNum = content.slice(0, idx).split('\n').length;
          const lineContent = content.split('\n')[lineNum - 1] ?? '';
          matchLines.push({
            lineNum,
            context: lineContent.trim().slice(0, 80),
          });
          searchFrom = idx + 1;
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
