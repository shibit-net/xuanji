// ============================================================
// send_file_to_user 工具 — 将文件/图片发送给用户并在对话框中展示
// 本地对话：返回 contentBlocks → agent:tool-end → EventAdapter → ImageBlock 展示
// 远端平台：通过 platform:send-file → agent-bridge → IPC → PlatformAdapter 发送
// ============================================================

import { existsSync, statSync, readFileSync } from 'fs';
import { extname } from 'path';
import { BaseTool } from './BaseTool';
import type { ToolResult, JSONSchema } from '@/core/types';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const MIME_MAP: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
};

export class SendFileTool extends BaseTool {
  readonly name = 'send_file_to_user';
  readonly description = `将文件或图片发送给用户，调用后图片/文件会直接展示在用户对话框中。用户说"发我"、"给我看"时使用本工具。write_file 生成图片/文件后也必须调用本工具。`;
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: '要发送的文件绝对路径' },
      message: { type: 'string', description: '可选，随文件一起发送的文字说明' },
    },
    required: ['filePath'],
  };

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const filePath = input.filePath as string;
    const message = input.message as string | undefined;

    if (!filePath) {
      return this.error('缺少 filePath 参数。请提供要发送的文件绝对路径。');
    }

    if (!existsSync(filePath)) {
      return this.error(`文件不存在: ${filePath}。请确认文件路径是否正确，文件是否已生成。`);
    }

    const stat = statSync(filePath);
    if (!stat.isFile()) {
      return this.error(`路径不是文件: ${filePath}`);
    }

    if (stat.size > MAX_FILE_SIZE) {
      return this.error(
        `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，上限 ${MAX_FILE_SIZE / 1024 / 1024}MB。请压缩后再发送。`
      );
    }

    const ext = extname(filePath).toLowerCase();
    const isImage = IMAGE_EXTS.has(ext);

    // 1) platform:send-file：远端平台发送
    eventBus.emitSync('platform:send-file', {
      filePath,
      isImage,
      message,
      timestamp: Date.now(),
    });

    // 2) AGENT_FILE_CHANGES：文件变更通知（远端 ConversationHub 展示）
    eventBus.emitSync(XuanjiEvent.AGENT_FILE_CHANGES, {
      changes: [{ filePath }],
    });

    const fileType = isImage ? '图片' : '文件';
    const sizeStr = stat.size > 1024 * 1024
      ? `${(stat.size / 1024 / 1024).toFixed(1)}MB`
      : `${(stat.size / 1024).toFixed(0)}KB`;

    const result: ToolResult = {
      content: `已发送给用户，用户已在对话框中看到。${message || ''}`,
      isError: false,
      metadata: { filePath, size: stat.size, isImage },
    };

    // 3) contentBlocks：图片用 ImageBlock，其他文件用 FileBlock 卡片展示
    if (isImage) {
      const buffer = readFileSync(filePath);
      const base64 = buffer.toString('base64');
      result.contentBlocks = [{
        type: 'image',
        mimeType: MIME_MAP[ext] || 'image/png',
        data: base64,
      }];
    } else {
      result.contentBlocks = [{
        type: 'file',
        fileName: filePath.split('/').pop() || filePath,
        filePath,
        fileSize: stat.size,
      }];
    }

    return result;
  }
}
