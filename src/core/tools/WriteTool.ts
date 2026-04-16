// ============================================================
// M6 工具系统 — WriteTool 写入文件
// ============================================================

import { dirname, resolve } from 'node:path';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';
import { DiffRenderer } from '../utils/DiffRenderer';

/**
 * 写入文件工具
 */
export class WriteTool extends BaseTool {
  readonly name = 'write_file';
  readonly description = [
    'Write content to specified file. Overwrites if file exists, creates directory if not exists.',
    '',
    '# Use Cases',
    '✓ Create new files (config, code, documentation)',
    '✓ Complete rewrite of existing files (use with caution)',
    '✓ Small file creation (<5KB)',
    '',
    '# Guidelines',
    '1. Prefer edit_file for modifying existing files (only sends diff, safer)',
    '2. Must read_file first before overwriting existing files to confirm current content',
    '3. Verify target directory is correct before creating new files',
    '4. Do NOT proactively create README.md or docs unless explicitly requested',
    '5. For large files (>5KB), use bash heredoc instead',
    '',
    '# Parameter Examples',
    '- Create new file: write_file({ path: "src/utils/helper.ts", content: "export function..." })',
    '- Create config: write_file({ path: ".eslintrc.json", content: "{\\"rules\\": {...}}" })',
    '',
    '# Important Notes',
    '✗ Do NOT write files containing passwords, API keys, or sensitive info',
    '✗ Do NOT overwrite existing files (unless confirmed complete rewrite is needed)',
    '✗ Do NOT use for modifying existing files (should use edit_file)',
  ].join('\n');
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute path or path relative to project root',
      },
      content: {
        type: 'string',
        description: 'Content to write to file',
      },
    },
    required: ['path', 'content'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const rawPath = input.path as string;
    const content = input.content as string;
    const path = resolve(rawPath);

    // 路径穿越保护：禁止写入敏感系统目录
    if (this.isSensitivePath(path)) {
      return this.error(`安全限制: 不允许写入路径 "${path}"。该路径位于受保护的系统或用户目录。`);
    }

    try {
      // 确保父目录存在
      const dir = dirname(path);
      await mkdir(dir, { recursive: true });

      // 检查文件是否已存在（用于生成 diff）
      let existingContent: string | null = null;
      try {
        await access(path);
        existingContent = await readFile(path, 'utf-8');
      } catch {
        // 文件不存在，创建新文件
      }

      // 写入文件
      await writeFile(path, content, 'utf-8');

      const lines = content.split('\n').length;

      // 如果文件已存在，生成 diff 预览
      if (existingContent !== null) {
        const diffPreview = DiffRenderer.renderPreview(existingContent, content, path);
        const stats = DiffRenderer.getStats(existingContent, content);
        return this.success(
          `已写入 ${path} (${lines} 行, ${content.length} 字符)\n\n${diffPreview}`,
          { ...stats, lines, chars: content.length, filePath: path }
        );
      }

      return this.success(`已写入 ${path} (${lines} 行, ${content.length} 字符)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`写入文件失败: ${message}`);
    }
  }
}
