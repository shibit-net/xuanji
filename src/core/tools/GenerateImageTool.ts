// ============================================================
// 媒体生成工具 — 文生图 (generate_image)
// ============================================================

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ToolResult, JSONSchema } from '@/shared/types/tools';
import type { ToolMediaGenConfig } from '@/shared/types/config';
import { AbstractMediaGenTool } from './AbstractMediaGenTool';
import { getAdapter } from './adapters/AdapterFactory';

/**
 * 文生图工具
 *
 * LLM 传入文本描述 → 工具调用配置的平台 API → 返回图片
 * 结果自动通过 contentBlocks 在前端渲染
 */
export class GenerateImageTool extends AbstractMediaGenTool {
  readonly name = 'generate_image';
  readonly toolConfigName = 'generate_image';
  readonly mediaType = 'image' as const;
  readonly displayUnit = '张';
  readonly description =
    'Generate images from text descriptions. Required: prompt. Optional: size, n, reference_images.';

  readonly input_schema: JSONSchema = {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: {
        type: 'string',
        description: 'Text description of the desired image',
      },
      size: {
        type: 'string',
        enum: ['1K', '2K', '4K'],
        description: 'Image resolution (default: config defaultSize or 2K)',
      },
      n: {
        type: 'integer',
        description: 'Number of images to generate (1-4, default: 1)',
      },
      reference_images: {
        type: 'array',
        items: { type: 'string' },
        description: 'Reference images as base64 strings (max 2)',
      },
      output_format: {
        type: 'string',
        enum: ['png', 'jpg', 'webp'],
        description: 'Output image format (default: png)',
      },
      model: {
        type: 'string',
        description: 'Model name override',
      },
    },
  };

  protected async doExecute(
    input: Record<string, unknown>,
    cfg: ToolMediaGenConfig,
  ): Promise<ToolResult> {
    const adapter = getAdapter(cfg.provider);
    const blocks = await adapter.generateImage(input as any, cfg);

    // 保存图片到磁盘，便于后续工具（如 edit_image）引用
    const imgDir = process.cwd();
    mkdirSync(imgDir, { recursive: true });
    const fmt = (input.output_format as string) || 'png';
    const paths: string[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const filename = `generated_${Date.now()}_${i}.${fmt}`;
      const filepath = join(imgDir, filename);
      writeFileSync(filepath, Buffer.from(blocks[i].data, 'base64'));
      paths.push(filepath);
    }

    return {
      content: `成功生成 ${blocks.length} 张图片。\n文件路径: ${paths.join(', ')}\n\n💡 请使用 send_file_to_user 将结果发送给用户。`,
      isError: false,
    };
  }
}
