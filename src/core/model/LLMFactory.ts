// ============================================================
// LLMFactory - LLM Provider 工厂
// ============================================================

import { LLMProvider } from './LLMProvider';
import { LocalLLMProvider } from './LocalLLMProvider';
import { AnthropicLLMProvider } from './AnthropicLLMProvider';
import { logger } from '@/core/logger';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const log = logger.child({ module: 'LLMFactory' });

// 向上查找 xuanji 项目根目录
function findProjectRoot(startDir: string): string {
  let current = startDir;
  while (current !== path.dirname(current)) {
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'xuanji') {
          return current;
        }
      } catch {}
    }
    current = path.dirname(current);
  }
  return process.cwd();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = findProjectRoot(__dirname);
const MODEL_DIR = path.join(PROJECT_ROOT, '.xuanji', 'models');

export interface LLMConfig {
  provider: {
    adapter: 'local-llama' | 'anthropic' | 'openai';
    baseURL?: string;
    apiKey?: string;
  };
  model: {
    primary: string;
    maxTokens?: number;
    temperature?: number;
  };
  systemPrompt?: string;
}

// 本地模型 ID 到文件名的映射
const LOCAL_MODEL_FILES: Record<string, string> = {
  'qwen2.5-0.5b-q4': 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
  'qwen2.5-1.5b-q4': 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  'chatglm3-6b-q4': 'chatglm3-6b.Q4_K_M.gguf',
  'chatglm3-6b-q3': 'chatglm3-6b.Q3_K_M.gguf',
  'glm4-9b-q4': 'glm-4-9b-chat.Q4_K_M.gguf',
};

// 本地模型 ID 到 HuggingFace URI 的映射（用于下载）
const LOCAL_MODEL_URIS: Record<string, string> = {
  'qwen2.5-0.5b-q4': 'hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:qwen2.5-0.5b-instruct-q4_k_m.gguf',
  'qwen2.5-1.5b-q4': 'hf:Qwen/Qwen2.5-1.5B-Instruct-GGUF:qwen2.5-1.5b-instruct-q4_k_m.gguf',
  'chatglm3-6b-q4': 'hf:mradermacher/chatglm3-6b-GGUF:chatglm3-6b.Q4_K_M.gguf',
  'chatglm3-6b-q3': 'hf:mradermacher/chatglm3-6b-GGUF:chatglm3-6b.Q3_K_M.gguf',
  'glm4-9b-q4': 'hf:mradermacher/glm-4-9b-chat-GGUF:glm-4-9b-chat.Q4_K_M.gguf',
};

/**
 * LLM Provider 工厂
 * 根据配置创建对应的 LLM Provider
 */
export class LLMFactory {
  /**
   * 创建 LLM Provider
   */
  static create(config: LLMConfig): LLMProvider {
    const { adapter, baseURL, apiKey } = config.provider;
    const { primary: modelId } = config.model;
    const { systemPrompt } = config;

    log.info(`[LLMFactory] Creating provider: adapter=${adapter}, model=${modelId}`);

    switch (adapter) {
      case 'local-llama': {
        // 将简短 ID 转换为完整 URI
        let fullModelId = modelId;

        if (LOCAL_MODEL_FILES[modelId]) {
          // 检查本地文件是否真的存在
          const filename = LOCAL_MODEL_FILES[modelId];
          const localPath = path.join(MODEL_DIR, filename);

          if (fs.existsSync(localPath)) {
            // 文件存在，使用 file: 前缀
            fullModelId = `file:${filename}`;
            log.info(`[LLMFactory] Using local model file: ${fullModelId}`);
          } else if (LOCAL_MODEL_URIS[modelId]) {
            // 文件不存在，使用 HF URI（会自动下载）
            fullModelId = LOCAL_MODEL_URIS[modelId];
            log.info(`[LLMFactory] Local file not found, using HF model URI: ${fullModelId}`);
          } else {
            throw new Error(`Model file not found and no HF URI available: ${modelId}`);
          }
        } else if (LOCAL_MODEL_URIS[modelId]) {
          // 如果本地没有，使用 HF URI（会自动下载）
          fullModelId = LOCAL_MODEL_URIS[modelId];
          log.info(`[LLMFactory] Using HF model URI: ${fullModelId}`);
        } else if (!modelId.startsWith('file:') && !modelId.startsWith('hf:')) {
          // 如果既不是已知 ID，也不是完整 URI，报错
          throw new Error(`Unknown model ID: ${modelId}. Please use a known model ID or full URI (file: or hf:)`);
        }

        return new LocalLLMProvider(fullModelId, systemPrompt);
      }

      case 'anthropic':
        if (!apiKey) {
          throw new Error('Anthropic API key is required');
        }
        return new AnthropicLLMProvider(modelId, apiKey, baseURL, systemPrompt);

      case 'openai':
        // TODO: 实现 OpenAI Provider
        throw new Error('OpenAI provider not implemented yet');

      default:
        throw new Error(`Unsupported provider adapter: ${adapter}`);
    }
  }

  /**
   * 从 Agent 配置创建 LLM Provider
   */
  static createFromAgentConfig(agentConfig: any): LLMProvider {
    const config: LLMConfig = {
      provider: {
        adapter: agentConfig.provider?.adapter || 'local-llama',
        baseURL: agentConfig.provider?.baseURL,
        apiKey: agentConfig.provider?.apiKey,
      },
      model: {
        primary: agentConfig.model?.primary,
        maxTokens: agentConfig.model?.maxTokens,
        temperature: agentConfig.model?.temperature,
      },
      systemPrompt: agentConfig.systemPrompt,
    };

    return LLMFactory.create(config);
  }
}
