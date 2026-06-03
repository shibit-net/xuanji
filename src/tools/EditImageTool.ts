// ============================================================
// 媒体生成工具 — 图片编辑 (edit_image)
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ToolResult, JSONSchema } from '@/shared/types/tools';
import type { ToolMediaGenConfig } from '@/shared/types/config';
import { AbstractMediaGenTool } from './AbstractMediaGenTool';
import { getAdapter } from './adapters/AdapterFactory';

/**
 * 图片编辑工具
 *
 * LLM 传入原图 + 编辑描述 → 工具调用配置的平台 API → 返回编辑后的图片
 * 当前豆包仅支持 repaint 操作。
 */
export class EditImageTool extends AbstractMediaGenTool {
  readonly name = 'edit_image';
  readonly toolConfigName = 'edit_image';
  readonly mediaType = 'image' as const;
  readonly displayUnit = '张';
  readonly description =
    'Edit images via repaint. Required: prompt, source_image. Optional: mask, model.';

  readonly input_schema: JSONSchema = {
    type: 'object',
    required: ['prompt', 'source_image'],
    properties: {
      prompt: {
        type: 'string',
        description: 'Description of the desired edit',
      },
      source_image: {
        type: 'string',
        description: 'Base64 source image, local file path, or URL to edit',
      },
      mask: {
        type: 'string',
        description: 'Base64 mask image specifying the area to edit (optional, full image if omitted)',
      },
      operation: {
        type: 'string',
        enum: ['repaint'],
        description: 'Edit operation (current platform only supports repaint)',
      },
      model: {
        type: 'string',
        description: 'Model name override',
      },
    },
  };

  protected validateInput(input: Record<string, unknown>): ToolResult | null {
    const base = super.validateInput(input);
    if (base) return base;
    if (!input.source_image) {
      return this.error('source_image 参数不能为空。请提供要编辑的图片。');
    }
    return null;
  }

  protected async doExecute(
    input: Record<string, unknown>,
    cfg: ToolMediaGenConfig,
  ): Promise<ToolResult> {
    // 支持本地文件路径：自动读取并转为 base64
    const source = input.source_image as string;
    if (this.isLocalPath(source)) {
      if (!existsSync(source)) {
        return this.error(`文件不存在: ${source}`);
      }
      const buf = readFileSync(source);
      const ext = source.split('.').pop()?.toLowerCase() || 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                 : ext === 'webp' ? 'image/webp'
                 : 'image/png';
      input.source_image = `data:${mime};base64,${buf.toString('base64')}`;
    }

    const adapter = getAdapter(cfg.provider);
    const op = (input.operation as string) || 'repaint';
    const blocks = await adapter.editImage(input as any, cfg, op);

    // 保存编辑结果到本地
    const imgDir = process.cwd();
    mkdirSync(imgDir, { recursive: true });
    const fmt = 'png';
    const filename = `edited_${Date.now()}.${fmt}`;
    const filepath = join(imgDir, filename);
    writeFileSync(filepath, Buffer.from(blocks[0].data, 'base64'));

    return {
      content: `图片编辑完成。\n文件路径: ${filepath}\n\n💡 请使用 send_file_to_user 将结果发送给用户。`,
      isError: false,
    };
  }

  /** 判断是否为本地文件路径（非 URL，非 data: URI） */
  private isLocalPath(source: string): boolean {
    return !source.startsWith('http://') && !source.startsWith('https://') && !source.startsWith('data:');
  }
}
