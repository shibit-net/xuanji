// ============================================================
// LocalLlamaAdapter — 本地 GGUF 模型 Provider
// 封装 LocalModelLoader，实现 ILLMProvider 接口
// ============================================================

import type { Message, ToolSchema, ProviderConfig, StreamEvent, ILLMProvider } from '@/core/types';
import { LocalModelLoader } from '@/agent/dispatch/LocalModelLoader';
import { logger } from '@/infrastructure/logger';
import { homedir } from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const log = logger.child({ module: 'LocalLlamaAdapter' });

const MODEL_DIR = path.join(homedir(), '.xuanji', 'models');

// 预置模型文件名到 ID 的映射（用于去重和显示名）
const PRESET_FILENAMES = new Set([
  'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  'chatglm3-6b.Q4_K_M.gguf',
  'chatglm3-6b.Q3_K_M.gguf',
  'glm-4-9b-chat.Q4_K_M.gguf',
]);

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

/** 扫描模型目录获取用户自行下载的 GGUF 文件名 */
function scanDownloadedModels(): string[] {
  try {
    if (!fs.existsSync(MODEL_DIR)) return [];
    return fs.readdirSync(MODEL_DIR)
      .filter((f) => f.endsWith('.gguf') && !PRESET_FILENAMES.has(f));
  } catch {
    return [];
  }
}

export class LocalLlamaAdapter implements ILLMProvider {
  readonly name = 'local-llama';

  /** 动态模型列表 = 预置 + 扫描到的用户下载模型 */
  get models(): string[] {
    const scanned = scanDownloadedModels();
    return [...LOCAL_LLAMA_MODELS, ...scanned];
  }

  private loaders = new Map<string, LocalModelLoader>();

  isSupported(model: string): boolean {
    // 用户自行下载的 .gguf 文件
    if (model.endsWith('.gguf')) return true;
    // 预置模型
    if ((LOCAL_LLAMA_MODELS as readonly string[]).includes(model)) return true;
    // 扫描到的模型
    const scanned = scanDownloadedModels();
    return scanned.includes(model);
  }

  private getLoader(model: string, systemPrompt?: string, contextSize?: number): LocalModelLoader {
    const key = `${model}::${systemPrompt ?? ''}::ctx${contextSize ?? 0}`;
    if (!this.loaders.has(key)) {
      let modelId: string;
      if (model.endsWith('.gguf')) {
        modelId = `file:${model}`;
      } else {
        modelId = MODEL_IDS[model as LocalLlamaModelType];
        if (!modelId) throw new Error(`未知本地模型: ${model}`);
      }
      this.loaders.set(key, new LocalModelLoader({ modelId, systemPrompt, contextSize }));
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

    // local-llama 不支持工具调用，当 agent 需要工具时立即报错中止
    if (_tools.length > 0) {
      yield {
        type: 'error',
        error: new Error(
          `本地模型 (local-llama) 不支持工具调用（当前需要 ${_tools.length} 个工具）。` +
          `请使用 ollama / vllm / lmstudio 等支持 OpenAI 兼容 API 的本地服务，` +
          `或切换为云端 API provider。`,
        ),
      };
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
      const contextSize = (config as any).contextSize as number | undefined;
      const loader = this.getLoader(model, systemPrompt, contextSize);
      const result = await loader.generate(userText, {
        maxTokens: config.maxTokens ?? 512,
        temperature: config.temperature ?? 0.3,
      });

      yield { type: 'text_delta', text: result };
      yield { type: 'end', stopReason: 'end_turn' };
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`本地模型推理失败: ${msg}`, { stack: err instanceof Error ? err.stack : undefined });
      yield { type: 'error', error: err instanceof Error ? err : new Error(String(err)) };
    }
  }
}
