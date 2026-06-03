// ============================================================
// Image Generation Provider
// 适配 OpenAI images/generations 兼容 API（含火山引擎豆包 Seedream）
// ============================================================
// 这是纯图片生成 Provider，不处理对话/工具调用。
// 从最后一条 user 消息提取 prompt 文本，调用 images/generations API，
// 通过 image_delta 事件返回生成的图片。
// ============================================================

import type { Message, ContentBlock, ProviderConfig, StreamEvent, ILLMProvider } from '@/core/types';
import { logger } from '@/infrastructure/logger';

const log = logger.child({ module: 'ImageGenProvider' });

/** 从 prompt 中提取 "size" 参数 */
function extractSize(text: string): string {
  const match = text.match(/\b(1K|2K|4K|1024|2048|4096)\b/);
  if (match) {
    const v = match[1];
    if (v === '1K' || v === '1024') return '1024x1024';
    if (v === '2K' || v === '2048') return '2048x2048';
    if (v === '4K' || v === '4096') return '4096x4096';
  }
  return '2048x2048';
}

export class ImageGenProvider implements ILLMProvider {
  readonly name = 'openai-image';
  readonly models = ['doubao-seedream', 'dall-e', 'seedream'];

  isSupported(model: string): boolean {
    return this.models.some((m) => model.includes(m));
  }

  async *stream(
    messages: Message[],
    _tools: never,
    config: ProviderConfig,
  ): AsyncIterable<StreamEvent> {
    // 只校验 apiKey
    if (!config.apiKey || config.apiKey.trim() === '') {
      yield { type: 'error', error: new Error('ImageGen Provider: API Key not configured') };
      return;
    }

    // 从最后一条 user 消息提取 prompt
    let prompt = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role !== 'user') continue;
      if (typeof msg.content === 'string') {
        prompt = msg.content;
      } else if (Array.isArray(msg.content)) {
        prompt = (msg.content as ContentBlock[])
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n');
      }
      if (prompt.trim()) break;
    }

    if (!prompt.trim()) {
      yield { type: 'error', error: new Error('ImageGen Provider: no user message found to extract prompt') };
      return;
    }

    // 从 prompt 中提取 size 指令（如果有），然后清理 prompt
    const size = extractSize(prompt);
    const cleanPrompt = prompt.replace(/\b(1K|2K|4K|1024|2048|4096)\b/g, '').trim();

    // 构建 baseURL
    let baseURL = config.baseURL || 'https://api.openai.com/v1';
    // 确保 baseURL 包含 /v1
    if (!/\/v\d+\/?$/.test(baseURL)) {
      baseURL = baseURL.replace(/\/+$/, '') + '/v1';
    }

    try {
      const response = await fetch(`${baseURL}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          prompt: cleanPrompt,
          size,
          response_format: 'b64_json',
          n: 1,
          watermark: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Image generation API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as any;
      const imageData = data.data?.[0];
      if (!imageData?.b64_json) {
        throw new Error('API response missing image data (b64_json)');
      }

      yield {
        type: 'image_delta',
        image: {
          data: imageData.b64_json,
          mimeType: 'image/png',
        },
      };

      yield { type: 'end', stopReason: 'end_turn' };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error(`Image generation failed: ${error.message}`);
      yield { type: 'error', error };
    }
  }
}
