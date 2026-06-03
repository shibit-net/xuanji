// ============================================================
// send_file_to_user 工具 — 将文件/图片发送给用户并在对话框中展示
// 本地对话：返回 contentBlocks → agent:tool-end → EventAdapter → ImageBlock 展示
// 远端平台：通过 platform:send-file → agent-bridge → IPC → PlatformAdapter 发送
// ============================================================

import { existsSync, statSync, readFileSync } from 'fs';
import { extname } from 'path';
import { BaseTool } from './BaseTool';
import type { ToolResult, JSONSchema } from '@/core/types';
import { eventBus } from '@/infrastructure/events/EventBus';
import { XuanjiEvent } from '@/infrastructure/events/events';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.aac', '.flac', '.wma', '.m4a', '.opus']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v']);
const MIME_MAP: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.aac': 'audio/aac',
  '.flac': 'audio/flac', '.wma': 'audio/x-ms-wma', '.m4a': 'audio/mp4', '.opus': 'audio/opus',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv', '.m4v': 'video/mp4',
};

export class SendFileTool extends BaseTool {
  readonly name = 'send_file_to_user';
  readonly description = `Send a file or image to the user. After calling, the image/file will be directly displayed in the user's dialog. Use this tool when the user says "send me" or "show me". Must also call this tool after generating files/images via write_file.`;
  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Absolute path to the file to send' },
      message: { type: 'string', description: 'Optional text description to accompany the file' },
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
    const isAudio = AUDIO_EXTS.has(ext);
    const isVideo = VIDEO_EXTS.has(ext);

    // 1) platform:send-file：远端平台发送
    eventBus.emitSync('platform:send-file', {
      filePath,
      isImage,
      isAudio,
      isVideo,
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

    // 3) contentBlocks：读取文件内容并构造展示块
    let buffer: Buffer;
    try {
      buffer = readFileSync(filePath);
    } catch (readErr) {
      return this.error(`文件读取失败: ${filePath} — ${readErr instanceof Error ? readErr.message : String(readErr)}`);
    }

    const result: ToolResult = {
      content: `已成功发送给用户，用户已在对话框中看到。${message ? '附言: ' + message : ''}`,
      isError: false,
      metadata: { filePath, size: stat.size, isImage },
    };

    if (isImage) {
      const base64 = buffer.toString('base64');
      const mimeType = MIME_MAP[ext] || 'image/png';
      result.contentBlocks = [{ type: 'image', mimeType, data: base64 }];
    } else if (isAudio) {
      const base64 = buffer.toString('base64');
      const mimeType = MIME_MAP[ext] || 'audio/mpeg';
      result.contentBlocks = [{ type: 'audio', mimeType, data: base64 }];
    } else if (isVideo) {
      const base64 = buffer.toString('base64');
      const mimeType = MIME_MAP[ext] || 'video/mp4';
      result.contentBlocks = [{ type: 'video', mimeType, data: base64 }];
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
