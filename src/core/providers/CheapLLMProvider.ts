/**
 * CheapLLMProvider — 轻量 LLM 封装
 *
 * 将 ILLMProvider 的流式 API 封装为简单的 complete(prompt): string 接口，
 * 供 MemoryManager、EpisodicMemory、LearnEngine 等后台模块使用。
 *
 * 使用独立的低 temperature + 低 maxTokens 配置，适合提取、总结等结构化输出任务。
 */
import type { ILLMProvider, ProviderConfig } from '@/shared/types';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'CheapLLMProvider' });

export interface CheapLLM {
  complete(prompt: string): Promise<string>;
}

export class CheapLLMProvider implements CheapLLM {
  private config: ProviderConfig;

  constructor(
    private provider: ILLMProvider,
    config?: Partial<ProviderConfig>,
  ) {
    this.config = {
      model: config?.model || provider.models[0] || '',
      temperature: config?.temperature ?? 0.3,
      maxTokens: config?.maxTokens ?? 1024,
      apiKey: config?.apiKey,
      baseURL: config?.baseURL,
    };
  }

  /**
   * 非流式调用：将 prompt 作为单条 user message 发送，收集所有 text_delta 后拼接返回。
   */
  async complete(prompt: string): Promise<string> {
    const messages = [{ role: 'user' as const, content: prompt }];

    try {
      const stream = this.provider.stream(messages, [], this.config);
      let result = '';

      for await (const event of stream) {
        if (event.type === 'text_delta' && event.text) {
          result += event.text;
        } else if (event.type === 'error') {
          throw event.error instanceof Error ? event.error : new Error('CheapLLM stream error');
        }
      }

      return result.trim();
    } catch (err) {
      // 降级：如果流式调用失败，记录并返回空字符串
      // MemoryManager / LearnEngine 都有 JSON.parse 失败后的 fallback 逻辑
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`CheapLLM complete() failed: ${msg}`);
      throw err;
    }
  }
}
