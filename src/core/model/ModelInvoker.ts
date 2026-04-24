// ============================================================
// ModelInvoker - 统一的模型调用层
// ============================================================

import { LocalModelLoader } from '../agent/dispatch/LocalModelLoader';
import { logger } from '@/core/logger';
import Anthropic from '@anthropic-ai/sdk';

const log = logger.child({ module: 'ModelInvoker' });

export interface ModelConfig {
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

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
}

/**
 * 统一的模型调用器
 * 根据配置自动选择本地模型或远程 API
 */
export class ModelInvoker {
  private config: ModelConfig;
  private localLoader?: LocalModelLoader;
  private anthropicClient?: Anthropic;

  constructor(config: ModelConfig) {
    this.config = config;
  }

  /**
   * 初始化模型
   */
  async init(): Promise<void> {
    const { adapter } = this.config.provider;

    if (adapter === 'local-llama') {
      await this.initLocalModel();
    } else if (adapter === 'anthropic') {
      this.initAnthropicClient();
    } else {
      throw new Error(`Unsupported provider adapter: ${adapter}`);
    }
  }

  /**
   * 初始化本地模型
   */
  private async initLocalModel(): Promise<void> {
    const modelId = this.config.model.primary;
    log.info(`[ModelInvoker] Initializing local model: ${modelId}`);

    this.localLoader = new LocalModelLoader({
      modelId,
      systemPrompt: this.config.systemPrompt,
    });

    // 检查模型是否已下载
    const isDownloaded = this.localLoader.isDownloaded();
    if (isDownloaded) {
      await this.localLoader.load();
      log.info('[ModelInvoker] Local model loaded successfully');
    } else {
      log.info('[ModelInvoker] Local model not downloaded, starting background download');
      this.localLoader.predownload().then(() => {
        log.info('[ModelInvoker] Model download completed, loading to memory');
        return this.localLoader!.load();
      }).catch((err) => {
        log.warn(`[ModelInvoker] Background download failed: ${err.message}`);
      });
    }
  }

  /**
   * 初始化 Anthropic 客户端
   */
  private initAnthropicClient(): void {
    const { baseURL, apiKey } = this.config.provider;

    if (!apiKey) {
      throw new Error('Anthropic API key is required');
    }

    this.anthropicClient = new Anthropic({
      apiKey,
      baseURL,
    });

    log.info('[ModelInvoker] Anthropic client initialized');
  }

  /**
   * 生成文本
   */
  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    const { adapter } = this.config.provider;

    if (adapter === 'local-llama') {
      return this.generateWithLocalModel(prompt, options);
    } else if (adapter === 'anthropic') {
      return this.generateWithAnthropic(prompt, options);
    } else {
      throw new Error(`Unsupported provider adapter: ${adapter}`);
    }
  }

  /**
   * 使用本地模型生成
   */
  private async generateWithLocalModel(prompt: string, options?: GenerateOptions): Promise<string> {
    if (!this.localLoader || !this.localLoader.isLoaded()) {
      throw new Error('Local model not loaded');
    }

    return this.localLoader.generate(prompt, {
      maxTokens: options?.maxTokens ?? this.config.model.maxTokens ?? 128,
      temperature: options?.temperature ?? this.config.model.temperature ?? 0.3,
    });
  }

  /**
   * 使用 Anthropic API 生成
   */
  private async generateWithAnthropic(prompt: string, options?: GenerateOptions): Promise<string> {
    if (!this.anthropicClient) {
      throw new Error('Anthropic client not initialized');
    }

    const modelName = this.config.model.primary.replace('[CL]', '');
    const maxTokens = options?.maxTokens ?? this.config.model.maxTokens ?? 128;
    const temperature = options?.temperature ?? this.config.model.temperature ?? 0.3;

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: prompt },
    ];

    const response = await this.anthropicClient.messages.create({
      model: modelName,
      max_tokens: maxTokens,
      temperature,
      system: this.config.systemPrompt,
      messages,
    });

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in response');
    }

    return textContent.text;
  }

  /**
   * 检查模型是否可用
   */
  isAvailable(): boolean {
    const { adapter } = this.config.provider;

    if (adapter === 'local-llama') {
      return this.localLoader?.isLoaded() ?? false;
    } else if (adapter === 'anthropic') {
      return this.anthropicClient !== undefined;
    }

    return false;
  }

  /**
   * 获取当前模型标识
   */
  getCurrentModel(): string {
    return this.config.model.primary;
  }

  /**
   * 卸载模型
   */
  async dispose(): Promise<void> {
    if (this.localLoader) {
      await this.localLoader.unload();
      this.localLoader = undefined;
    }
    this.anthropicClient = undefined;
  }
}
