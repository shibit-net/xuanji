// ============================================================
// LocalLlamaAdapter — 本地 GGUF 模型 Provider
// 封装 LocalModelLoader，实现 ILLMProvider 接口
// ============================================================

import type { Message, ToolSchema, ProviderConfig, StreamEvent, ILLMProvider } from '@/core/types';
import { LocalModelLoader } from '@/core/agent/dispatch/LocalModelLoader';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'LocalLlamaAdapter' });

// 本地可用模型列表（预置）
export const LOCAL_LLAMA_MODELS = [
  'qwen2.5-0.5b-q4',
  'qwen2.5-1.5b-q4',
  'chatglm3-6b-q4',
  'chatglm3-6b-q3',
  'glm4-9b-q4',
] as const;

export type LocalLlamaModelType = typeof LOCAL_LLAMA_MODELS[number];

const MODEL_IDS: Record<LocalLlamaModelType, string> = {
  'qwen2.5-0.5b-q4': 'hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:qwen2.5-0.5b-instruct-q4_k_m.gguf',
  'qwen2.5-1.5b-q4': 'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:qwen2.5-1.5b-instruct-q4_k_m.gguf',
  'chatglm3-6b-q4': 'hf:mradermacher/chatglm3-6b-GGUF:chatglm3-6b.Q4_K_M.gguf',
  'chatglm3-6b-q3': 'hf:mradermacher/chatglm3-6b-GGUF:chatglm3-6b.Q3_K_M.gguf',
  'glm4-9b-q4': 'hf:mradermacher/glm-4-9b-chat-GGUF:glm-4-9b-chat.Q4_K_M.gguf',
};

export class LocalLlamaAdapter implements ILLMProvider {
  readonly name = 'local-llama';
  readonly models: string[] = [...LOCAL_LLAMA_MODELS];

  private loaders = new Map<string, LocalModelLoader>();

  isSupported(model: string): boolean {
    if (model.endsWith('.gguf')) return true;
    return LOCAL_LLAMA_MODELS.includes(model as LocalLlamaModelType);
  }

  private getLoader(model: string, systemPrompt?: string): LocalModelLoader {
    const key = `${model}::${systemPrompt ?? ''}`;
    if (!this.loaders.has(key)) {
      let modelId: string;
      if (model.endsWith('.gguf')) {
        modelId = `file:${model}`;
      } else {
        modelId = MODEL_IDS[model as LocalLlamaModelType];
        if (!modelId) throw new Error(`未知本地模型: ${model}`);
      }
      this.loaders.set(key, new LocalModelLoader({ modelId, systemPrompt }));
    }
    return this.loaders.get(key)!;
  }

  async *stream(
    messages: Message[],
    _tools: ToolSchema[],
    config: ProviderConfig,
  ): AsyncIterable<StreamEvent> {
    const model = config.model;
    if (!this.isSupported(model)) {
      yield { type: 'error', error: new Error(`本地模型不支持: ${model}`) };
      return;
    }

    // 提取 system prompt 和最后一条用户消息
    const systemMsg = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role === 'user');
    const lastUser = userMessages[userMessages.length - 1];
    if (!lastUser) {
      yield { type: 'error', error: new Error('没有用户消息') };
      return;
    }

    const userText = typeof lastUser.content === 'string'
      ? lastUser.content
      : (lastUser.content as any[]).filter(b => b.type === 'text').map((b: any) => b.text).join('');

    const systemPrompt = systemMsg
      ? (typeof systemMsg.content === 'string' ? systemMsg.content : undefined)
      : undefined;

    try {
      const loader = this.getLoader(model, systemPrompt);
      const result = await loader.generate(userText, {
        maxTokens: config.maxTokens ?? 512,
        temperature: config.temperature ?? 0.3,
      });

      yield { type: 'text_delta', text: result };
      yield { type: 'end', stopReason: 'end_turn' };
    } catch (err: any) {
      log.error('本地模型推理失败', err.message);
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
    }
  }
}
