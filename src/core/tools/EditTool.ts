// ============================================================
// M6 工具系统 — EditTool 编辑文件
// ============================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { DiffRenderer } from '@/shared/utils/DiffRenderer';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'EditTool' });

/**
 * 编辑文件工具 (精确字符串替换)
 */
export class EditTool extends BaseTool {
  readonly name = 'edit_file';
  readonly description = [
    'Edit a file by replacing exact text. Preferred over write_file for modifications.',
    '',
    'old_string must match file content exactly (including indentation, spaces, newlines).',
    'Always read_file first to find the exact text to replace.',
    'Use replace_all=true to replace all occurrences.',
  ].join('\n');
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path',
      },
      old_string: {
        type: 'string',
        description: 'Original string to be replaced (must be unique in file by default)',
      },
      new_string: {
        type: 'string',
        description: 'New string after replacement',
      },
      replace_all: {
        type: 'boolean',
        description: 'Whether to replace all matches (default false, only replace unique match). Set to true for batch variable renaming.',
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

    log.debug(`Editing file: ${path}`, { replaceAll, oldLength: oldStr.length, newLength: newStr.length });

    // 路径穿越保护：禁止编辑敏感系统目录
    if (this.isSensitivePath(path)) {
      log.warn(`Sensitive path blocked: ${path}`);
      return this.error(`安全限制: 不允许编辑路径 "${path}"。该路径位于受保护的系统或用户目录。`);
    }

    try {
      // 检查文件是否存在
      try {
        await access(path);
      } catch {
        log.warn(`File not found: ${path}`);
        return this.error(`文件不存在: ${path}`);
      }

      const content = await readFile(path, 'utf-8');

      // 二进制文件检测：包含 NUL 字节则拒绝编辑
      if (content.includes('\0')) {
        log.warn(`Binary file rejected: ${path}`);
        return this.error('无法编辑二进制文件');
      }

      // 空 old_string 无意义（会匹配所有位置）
      if (oldStr.length === 0) {
        log.warn('Empty old_string rejected');
        return this.error('old_string 不能为空。如需创建新文件，请使用 write_file 工具。');
      }

      // 检查匹配次数
      const occurrences = content.split(oldStr).length - 1;
      if (occurrences === 0) {
        log.warn(`No match found in ${path}`);
        return this.error(`未找到匹配的字符串:\n${oldStr}`);
      }

      // 非全局替换时要求唯一匹配
      if (!replaceAll && occurrences > 1) {
        log.warn(`Multiple matches found in ${path}: ${occurrences}`);
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

      // ✨ 生成 diff 预览
      const diffPreview = DiffRenderer.renderPreview(content, newContent, path);
      const stats = DiffRenderer.getStats(content, newContent);

      await writeFile(path, newContent, 'utf-8');

      log.info(`File edited successfully: ${path}`, {
        occurrences,
        replaceAll,
        added: stats.added,
        removed: stats.removed
      });

      const countInfo = replaceAll && occurrences > 1
        ? ` (共替换 ${occurrences} 处)`
        : '';

      // 返回结果包含 diff 预览
      const result = this.success(
        `已编辑 ${path}${countInfo}\n\n${diffPreview}`,
        { ...stats, filePath: path }
      );

      // 添加文件变更信息
      result.fileChanges = [{
        filePath: path,
        operation: 'edit',
        stats: { added: stats.added, removed: stats.removed, unchanged: stats.unchanged },
        diffContent: DiffRenderer.renderLines(content, newContent, true, true),
        size: { lines: newContent.split('\n').length, chars: newContent.length }
      }];

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`编辑文件失败: ${message}`);
    }
  }
}
