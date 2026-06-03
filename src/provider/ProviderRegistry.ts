// ============================================================
// M7 Provider Registry — 类似 Hermes 的 provider 注册表
//
// 参考 Hermes Agent 的 provider.py 设计：
// - transport: 决定 API 协议 (openai_chat / anthropic_messages / openai_response)
// - baseURL: 各 provider 的 API 端点
// - alias: 用户友好的名称映射
// ============================================================

import type { AppConfig, ILLMProvider } from '@/infrastructure/core-types';
import { logger } from '@/infrastructure/logger';
import { AnthropicProvider } from './AnthropicProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider';
import { GeminiProvider } from './GeminiProvider';
import { LocalLlamaAdapter } from './LocalLlamaAdapter';
import { ImageGenProvider } from './ImageGenProvider';

const log = logger.child({ module: 'ProviderRegistry' });

export type TransportType = 'openai-chat' | 'anthropic-messages' | 'openai-response' | 'gemini-rest' | 'local-llama' | 'openai-image';

export interface ProviderRegistration {
  /** Provider 显示名称 */
  name: string;
  /** API 协议类型 */
  transport: TransportType;
  /** 默认 API Base URL */
  baseURL: string;
  /** 环境变量名称（用于文档提示） */
  envVar?: string;
  /** 是否聚合器（路由到多个模型） */
  isAggregator?: boolean;
}

/**
 * Provider 注册表
 * 类似 Hermes 的 HERMES_OVERLAYS + ALIASES
 *
 * 新增 provider 只需在这里加一行，无需创建新文件。
 * 与 transport 对应的 adapter 代码已复用。
 */
export const PROVIDER_REGISTRY: Record<string, ProviderRegistration> = {
  // ── openai-chat transport（兼容 OpenAI Chat Completions API 格式）──
  'openai': { name: 'OpenAI', transport: 'openai-chat', baseURL: 'https://api.openai.com/v1', isAggregator: true },
  'deepseek': { name: 'DeepSeek', transport: 'openai-chat', baseURL: 'https://api.deepseek.com/v1' },
  'zai': { name: '智谱 AI (Z.ai)', transport: 'openai-chat', baseURL: 'https://open.bigmodel.cn/api/paas/v4' },
  'alibaba': { name: '阿里云 (DashScope)', transport: 'openai-chat', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  'moonshot': { name: 'Moonshot (Kimi)', transport: 'openai-chat', baseURL: 'https://api.moonshot.cn/v1' },
  'xai': { name: 'xAI (Grok)', transport: 'openai-chat', baseURL: 'https://api.x.ai/v1' },
  'nvidia': { name: 'NVIDIA NIM', transport: 'openai-chat', baseURL: 'https://integrate.api.nvidia.com/v1' },
  'minimax': { name: 'MiniMax', transport: 'openai-chat', baseURL: 'https://api.minimax.chat/v1' },
  'hunyuan': { name: '腾讯混元', transport: 'openai-chat', baseURL: 'https://api.hunyuan.cloud.tencent.com/v1' },
  'baidu': { name: '百度文心', transport: 'openai-chat', baseURL: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat' },
  'openrouter': { name: 'OpenRouter', transport: 'openai-chat', baseURL: 'https://openrouter.ai/api/v1', isAggregator: true },
  'together': { name: 'Together AI', transport: 'openai-chat', baseURL: 'https://api.together.xyz/v1', isAggregator: true },
  'fireworks': { name: 'Fireworks AI', transport: 'openai-chat', baseURL: 'https://api.fireworks.ai/inference/v1' },
  'groq': { name: 'Groq', transport: 'openai-chat', baseURL: 'https://api.groq.com/openai/v1' },
  'perplexity': { name: 'Perplexity', transport: 'openai-chat', baseURL: 'https://api.perplexity.ai' },
  'mistral': { name: 'Mistral AI', transport: 'openai-chat', baseURL: 'https://api.mistral.ai/v1' },
  'cohere': { name: 'Cohere', transport: 'openai-chat', baseURL: 'https://api.cohere.ai/v1' },
  'huggingface': { name: 'Hugging Face', transport: 'openai-chat', baseURL: 'https://api-inference.huggingface.co/v1', isAggregator: true },
  'ollama': { name: 'Ollama', transport: 'openai-chat', baseURL: 'http://localhost:11434/v1' },
  'vllm': { name: 'vLLM', transport: 'openai-chat', baseURL: 'http://localhost:8000/v1' },
  'lmstudio': { name: 'LM Studio', transport: 'openai-chat', baseURL: 'http://localhost:1234/v1' },

  // ── anthropic-messages transport ──
  'anthropic': { name: 'Anthropic Claude', transport: 'anthropic-messages', baseURL: 'https://api.anthropic.com/v1' },

  // ── openai-response transport（Responses API）──
  'openai-response': { name: 'OpenAI Responses', transport: 'openai-response', baseURL: 'https://api.openai.com/v1' },

  // ── gemini-rest transport ──
  'gemini': { name: 'Google Gemini', transport: 'gemini-rest', baseURL: 'https://generativelanguage.googleapis.com' },

  // ── local-llama transport ──
  'local-llama': { name: 'Local LLama', transport: 'local-llama', baseURL: '' },

  // ── openai-image transport（文生图）──
  'openai-image': { name: 'OpenAI Image', transport: 'openai-image', baseURL: 'https://api.openai.com/v1' },
  'ark': { name: '火山引擎豆包 (Seedream)', transport: 'openai-image', baseURL: 'https://ark.cn-beijing.volces.com/api/v3' },
};

/**
 * Provider 别名映射
 * 类似 Hermes 的 ALIASES 字典
 */
export const PROVIDER_ALIASES: Record<string, string> = {
  'glm': 'zai',
  'z-ai': 'zai',
  'z.ai': 'zai',
  'zhipu': 'zai',
  'qwen': 'alibaba',
  'dashscope': 'alibaba',
  'aliyun': 'alibaba',
  'kimi': 'moonshot',
  'moonshot': 'moonshot',
  'deep-seek': 'deepseek',
  'grok': 'xai',
  'x-ai': 'xai',
  'nim': 'nvidia',
  'nvidia-nim': 'nvidia',
  'yi': '01-ai',
  'zero-one': '01-ai',
  'claude': 'anthropic',
  'together-ai': 'together',
  'hf': 'huggingface',
  'hugging-face': 'huggingface',
};

/**
 * 解析 provider 别名 → 标准 provider ID
 */
export function resolveProviderId(input: string): string {
  return PROVIDER_ALIASES[input.toLowerCase()] || input.toLowerCase();
}

/**
 * 获取 Provider 注册信息
 */
export function getProviderRegistration(adapter: string): ProviderRegistration | undefined {
  const id = resolveProviderId(adapter);
  return PROVIDER_REGISTRY[id];
}

/**
 * 根据 adapter 名称创建 Provider 实例
 * 现在支持注册表中的所有 provider
 */
export function createProviderByAdapter(adapter?: string): ILLMProvider {
  if (!adapter) {
    throw new Error('Provider adapter 未指定，请在配置页面设置');
  }
  const id = resolveProviderId(adapter);
  const reg = PROVIDER_REGISTRY[id];

  // 如果没有注册信息，使用 OpenAI Chat（多数第三方 API 兼容 OpenAI 协议）
  if (!reg) {
    log.warn(`ProviderRegistry: no registration found for adapter "${adapter}", falling back to OpenAI Chat`);
    return new OpenAIProvider();
  }

  switch (reg.transport) {
    case 'openai-chat':
      return new OpenAIProvider();
    case 'anthropic-messages':
      return new AnthropicProvider();
    case 'openai-response':
      return new OpenAIResponsesProvider();
    case 'gemini-rest':
      return new GeminiProvider();
    case 'local-llama':
      return new LocalLlamaAdapter();
    case 'openai-image':
      return new ImageGenProvider();
    default:
      return new OpenAIProvider();
  }
}
