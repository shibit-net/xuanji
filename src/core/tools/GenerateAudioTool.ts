// ============================================================
// 媒体生成工具 — 文生音频 (generate_audio)
// ============================================================

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ToolResult, JSONSchema } from '@/shared/types/tools';
import type { ToolMediaGenConfig } from '@/shared/types/config';
import { AbstractMediaGenTool } from './AbstractMediaGenTool';
import { getAdapter } from './adapters/AdapterFactory';

/**
 * 文生音频工具
 *
 * LLM 传入文本内容 → 工具调用配置的平台 API → 返回音频
 * 支持 TTS 语音合成和纯音乐生成
 *
 * 语音合成: prompt 为要朗读的文本，voice 指定音色
 * 纯音乐: instrumental=true，prompt 为音乐风格描述
 */
export class GenerateAudioTool extends AbstractMediaGenTool {
  readonly name = 'generate_audio';
  readonly toolConfigName = 'generate_audio';
  readonly mediaType = 'audio' as const;
  readonly displayUnit = '段';
  readonly description =
    'Generate audio/speech from text. Required: prompt. Optional: voice, duration, instrumental, model.';

  readonly input_schema: JSONSchema = {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: {
        type: 'string',
        description: 'Text to convert to speech, or musical description if instrumental',
      },
      voice: {
        type: 'string',
        description: 'Voice persona (e.g. zh_female_qingxin, longxiaochun). Default: config default',
      },
      duration: {
        type: 'integer',
        description: 'Audio duration hint in seconds',
      },
      instrumental: {
        type: 'boolean',
        description: 'Whether to generate instrumental music instead of speech (default: false)',
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
    return null;
  }

  protected async doExecute(
    input: Record<string, unknown>,
    cfg: ToolMediaGenConfig,
  ): Promise<ToolResult> {
    const adapter = getAdapter(cfg.provider);

    if (!adapter.generateAudio) {
      return this.error(
        `当前平台 (${cfg.provider}) 暂不支持音频生成。请切换至 ark 或 bailian。`,
      );
    }

    const blocks = await adapter.generateAudio(input as any, cfg);

    // 保存音频到磁盘
    const fmt = (input.output_format as string) || 'mp3';
    const dir = process.cwd();
    mkdirSync(dir, { recursive: true });
    const paths: string[] = [];

    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].data) {
        const filename = `generated_audio_${Date.now()}_${i}.${fmt}`;
        const filepath = join(dir, filename);
        writeFileSync(filepath, Buffer.from(blocks[i].data, 'base64'));
        paths.push(filepath);
      }
    }

    const urlInfo = blocks.filter(b => b.url).map(b => b.url).join(', ');
    const fileInfo = paths.length > 0 ? `\n文件路径: ${paths.join(', ')}` : '';
    const urlExtra = urlInfo ? `\n音频 URL: ${urlInfo}` : '';

    return {
      content: `成功生成 ${blocks.length} 段音频。${fileInfo}${urlExtra}`,
      isError: false,
      contentBlocks: blocks,
    };
  }
}
