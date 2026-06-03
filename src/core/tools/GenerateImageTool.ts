// ============================================================
// 媒体生成工具 — 文生图 (generate_image)
//
// 底层模型: Doubao Seedream 4.0 / 4.5 / 5.0 lite
// API: POST /api/v3/images/generations (OpenAI 兼容)
//
// 核心能力:
//   文生图 — prompt → 图片
//   图生图 — prompt + image → 编辑/融合图片
//   组图生成 — sequential_image_generation:"auto" → 一组连贯图片
//   多图融合 — image[] → 融合多张参考图生成新图
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
    'Generate images from text descriptions. Supports text-to-image, image-to-image (edit/fusion), ' +
    'and sequential multi-image (storyboard/group) generation. ' +
    'Required: prompt. Optional: size, image, n, sequential_image_generation, max_images, output_format, response_format, model, seed, watermark, web_search, optimize_prompt.';

  readonly input_schema: JSONSchema = {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: {
        type: 'string',
        description: 'Text description of the desired image. Supports natural language or structured descriptions. Max ~300 Chinese characters or ~600 English words.',
      },
      model: {
        type: 'string',
        description: 'Model name override (e.g. doubao-seedream-5-0-260128). Default from config.',
      },
      size: {
        type: 'string',
        description: 'Image resolution: "1K" (only 4.0), "2K", "3K" (only 5.0), "4K", or "WIDTHxHEIGHT" (e.g. "2048x2048"). Default from config or 2K.',
      },
      n: {
        type: 'integer',
        description: 'Number of images to generate. When sequential_image_generation is "auto", this is handled by max_images instead. Default: 1.',
      },
      image: {
        description: 'Reference image(s) for image-to-image or multi-image fusion. Can be a single URL/base64 string, or an array of up to 14 strings. Total images (reference + generated) must not exceed 15.',
        anyOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
      reference_images: {
        type: 'array',
        items: { type: 'string' },
        description: '(Legacy) Reference images as base64 strings. Prefer using the "image" parameter for broader support.',
      },
      sequential_image_generation: {
        type: 'string',
        enum: ['disabled', 'auto'],
        description: 'Sequential/storyboard mode. "auto" generates a coherent set of images from a single prompt. Use with max_images to control count. Default: "disabled".',
      },
      max_images: {
        type: 'integer',
        description: 'Number of images in sequential mode. Only effective when sequential_image_generation is "auto".',
      },
      output_format: {
        type: 'string',
        enum: ['png', 'jpeg'],
        description: 'Output image format. Only 5.0 supports png; 4.0/4.5 always output jpeg. Default: png.',
      },
      response_format: {
        type: 'string',
        enum: ['url', 'b64_json'],
        description: 'Response format: "url" returns download links, "b64_json" returns base64 encoded data. Default: "url".',
      },
      seed: {
        type: 'integer',
        description: 'Random seed for reproducible results. Same prompt + seed = same output.',
      },
      watermark: {
        type: 'boolean',
        description: 'Whether to add "AI生成" watermark. Default: false.',
      },
      web_search: {
        type: 'boolean',
        description: 'Enable web search for real-time information (weather, products, etc.). Only supported by Seedream 5.0 lite. Default: false.',
      },
      optimize_prompt: {
        type: 'string',
        enum: ['standard', 'fast'],
        description: 'Prompt optimization mode. "standard" for quality (default), "fast" for speed. Only Seedream 4.0 supports "fast".',
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
      if (blocks[i].data) {
        writeFileSync(filepath, Buffer.from(blocks[i].data, 'base64'));
      } else if (blocks[i].url) {
        // URL 模式 — 下载保存
        const resp = await fetch(blocks[i].url!);
        if (resp.ok) {
          const buffer = Buffer.from(await resp.arrayBuffer());
          writeFileSync(filepath, buffer);
        }
      }
      paths.push(filepath);
    }

    return {
      content: `成功生成 ${blocks.length} 张图片。\n文件路径: ${paths.join(', ')}\n\n💡 请使用 send_file_to_user 将结果发送给用户。`,
      isError: false,
    };
  }
}
