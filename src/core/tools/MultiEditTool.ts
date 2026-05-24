// ============================================================
// M6 工具系统 — MultiEditTool 批量编辑
// ============================================================

import { readFile, writeFile, access } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { DiffRenderer } from '@/shared/utils/DiffRenderer';

/**
 * 单个编辑操作
 */
interface EditOperation {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

/**
 * 文件编辑结果
 */
interface FileEditResult {
  path: string;
  stats: { added: number; removed: number; unchanged: number };
  diffPreview: string;
  diffContent: string; // 添加 diffContent 字段
}

interface FileEditError {
  path: string;
  error: string;
}

/**
 * MultiEdit 批量编辑工具
 *
 * 单次调用对多个文件/多处位置进行编辑，减少 API 往返
 */
export class MultiEditTool extends BaseTool {
  readonly name = 'multi_edit';
  readonly description = [
    'Batch edit multiple files or multiple locations in a single call.',
    'More efficient than calling edit_file multiple times.',
    'Each operation follows the same rules as edit_file — old_string must match exactly.',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'File path',
            },
            old_string: {
              type: 'string',
              description: 'The original string to be replaced',
            },
            new_string: {
              type: 'string',
              description: 'The new string to replace with',
            },
            replace_all: {
              type: 'boolean',
              description: 'Whether to replace all occurrences (default false)',
            },
          },
          required: ['path', 'old_string', 'new_string'],
        },
        description: 'Array of edit operations',
      },
    },
    required: ['edits'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const edits = input.edits;

    // 输入校验
    if (!Array.isArray(edits) || edits.length === 0) {
      return this.error('edits 必须为非空数组');
    }

    // 校验每个元素的必需字段
    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      if (!edit || typeof edit !== 'object') {
        return this.error(`edits[${i}] 不是有效的对象`);
      }
      if (typeof edit.path !== 'string' || !edit.path) {
        return this.error(`edits[${i}].path 缺失或不是字符串`);
      }
      if (typeof edit.old_string !== 'string') {
        return this.error(`edits[${i}].old_string 缺失或不是字符串`);
      }
      if (typeof edit.new_string !== 'string') {
        return this.error(`edits[${i}].new_string 缺失或不是字符串`);
      }
    }

    const validEdits = edits as EditOperation[];

    // Step 1: 预检查所有文件
    for (const edit of validEdits) {
      const path = resolve(edit.path);

      // 路径穿越保护
      if (this.isSensitivePath(path)) {
        return this.error(`安全限制: 不允许编辑路径 "${path}"`);
      }

      try {
        await access(path);
      } catch {
        return this.error(`文件不存在: ${edit.path}`);
      }
    }

    // Step 2: 按文件分组
    const groupedByFile = new Map<string, EditOperation[]>();
    for (const edit of validEdits) {
      const path = resolve(edit.path);
      if (!groupedByFile.has(path)) {
        groupedByFile.set(path, []);
      }
      groupedByFile.get(path)!.push(edit);
    }

    // Step 3: 并行处理不同文件
    const results = await Promise.all(
      Array.from(groupedByFile.entries()).map(
        ([path, fileEdits]) => this.processFile(path, fileEdits),
      ),
    );

    // Step 4: 汇总结果
    const successes: FileEditResult[] = [];
    const errors: FileEditError[] = [];

    for (const result of results) {
      if ('error' in result) {
        errors.push(result as FileEditError);
      } else {
        successes.push(result as FileEditResult);
      }
    }

    if (errors.length > 0) {
      const errorLines = errors.map((e) => `✗ ${basename(e.path)}: ${e.error}`).join('\n');

      if (successes.length > 0) {
        const successLines = successes
          .map((r) => `✓ ${basename(r.path)} (${DiffRenderer.formatStats(r.stats)})`)
          .join('\n');
        const diffDetails = successes
          .map((r) => r.diffPreview)
          .filter(Boolean)
          .join('\n\n');
        const successInfo = diffDetails
          ? `成功:\n${successLines}\n\n${diffDetails}`
          : `成功:\n${successLines}`;
        return this.error(
          `部分编辑失败:\n\n${successInfo}\n\n失败:\n${errorLines}`,
        );
      }
      return this.error(`编辑失败:\n${errorLines}`);
    }

    // 全部成功
    const summary = successes
      .map((r) => `✓ ${basename(r.path)} (${DiffRenderer.formatStats(r.stats)})`)
      .join('\n');

    const totalAdded = successes.reduce((sum, r) => sum + r.stats.added, 0);
    const totalRemoved = successes.reduce((sum, r) => sum + r.stats.removed, 0);

    // 附加每个文件的 diff 预览
    const diffDetails = successes
      .map((r) => r.diffPreview)
      .filter(Boolean)
      .join('\n\n');
    const output = diffDetails
      ? `成功编辑 ${successes.length} 个文件:\n${summary}\n\n${diffDetails}`
      : `成功编辑 ${successes.length} 个文件:\n${summary}`;

    const result = this.success(
      output,
      {
        filesChanged: successes.length,
        totalAdded,
        totalRemoved,
      },
    );

    // 添加文件变更信息
    result.fileChanges = successes.map((r) => ({
      filePath: r.path,
      operation: 'edit' as const,
      stats: { added: r.stats.added, removed: r.stats.removed, unchanged: r.stats.unchanged },
      diffContent: r.diffContent,
    }));

    return result;
  }

  /**
   * 处理单个文件的所有编辑操作（串行应用）
   */
  private async processFile(
    path: string,
    fileEdits: EditOperation[],
  ): Promise<FileEditResult | FileEditError> {
    try {
      let content = await readFile(path, 'utf-8');
      const oldContent = content;

      // 二进制文件检测
      if (content.includes('\0')) {
        return { path, error: '无法编辑二进制文件' };
      }

      // 串行应用同文件的多个编辑
      for (const edit of fileEdits) {
        if (edit.old_string.length === 0) {
          return { path, error: 'old_string 不能为空' };
        }

        const occurrences = content.split(edit.old_string).length - 1;

        if (occurrences === 0) {
          return { path, error: `未找到匹配的字符串: ${edit.old_string.slice(0, 50)}...` };
        }

        if (!edit.replace_all && occurrences > 1) {
          return {
            path,
            error: `"${edit.old_string.slice(0, 50)}..." 有 ${occurrences} 处匹配，请使用 replace_all: true`,
          };
        }

        content = edit.replace_all
          ? content.replaceAll(edit.old_string, edit.new_string)
          : content.replace(edit.old_string, edit.new_string);
      }

      // 生成 diff 和统计
      const diffPreview = DiffRenderer.renderPreview(oldContent, content, path);
      const diffContent = DiffRenderer.renderLines(oldContent, content, true, true);
      const stats = DiffRenderer.getStats(oldContent, content);

      // 写入文件
      await writeFile(path, content, 'utf-8');

      return { path, stats, diffPreview, diffContent };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { path, error: message };
    }
  }
}
