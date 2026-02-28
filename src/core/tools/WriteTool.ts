// ============================================================
// M6 工具系统 — WriteTool 写入文件
// ============================================================

import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { JSONSchema, ToolResult } from '@/core/types';
import { BaseTool } from './BaseTool';

/**
 * 写入文件工具
 */
export class WriteTool extends BaseTool {
  readonly name = 'write_file';
  readonly description = [
    '写入内容到指定文件。如果文件已存在则覆盖，如果目录不存在则自动创建。',
    '',
    '# 使用指南',
    '- 修改已有文件时优先使用 edit_file (仅发送差异), 仅在创建新文件或完全重写时使用 write_file',
    '- 写入已有文件前必须先用 read_file 读取, 确认了解当前内容',
    '- 不要主动创建 README.md 或其他文档文件, 除非用户明确要求',
    '- 不要写入含有密码、API Key 等敏感信息的文件',
    '- 创建新文件前, 先确认目标目录是否正确',
  ].join('\n');
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件的绝对路径或相对于项目根目录的路径',
      },
      content: {
        type: 'string',
        description: '要写入的文件内容',
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

      // 写入文件
      await writeFile(path, content, 'utf-8');

      const lines = content.split('\n').length;
      return this.success(`已写入 ${path} (${lines} 行, ${content.length} 字符)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.error(`写入文件失败: ${message}`);
    }
  }
}
