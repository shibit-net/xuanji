// ============================================================
// LocalLLMProvider - 本地模型 Provider
// ============================================================

import { LLMProvider, GenerateOptions } from './LLMProvider';
import { LocalModelLoader } from '../agent/dispatch/LocalModelLoader';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'LocalLLMProvider' });

export class LocalLLMProvider implements LLMProvider {
  private modelLoader?: LocalModelLoader;
  private modelId: string;
  private defaultSystemPrompt?: string;

  constructor(modelId: string, systemPrompt?: string) {
    this.modelId = modelId;
    this.defaultSystemPrompt = systemPrompt;
  }

  async init(): Promise<void> {
    log.info(`[LocalLLMProvider] Initializing model: ${this.modelId}`);

    try {
      this.modelLoader = new LocalModelLoader({
        modelId: this.modelId,
        systemPrompt: this.defaultSystemPrompt,
      });

      const isDownloaded = this.modelLoader.isDownloaded();
      if (isDownloaded) {
        await this.modelLoader.load();
        log.info('[LocalLLMProvider] Model loaded successfully');
      } else {
        log.info('[LocalLLMProvider] Model not downloaded, starting background download');
        this.modelLoader.predownload().then(() => {
          log.info('[LocalLLMProvider] Download completed, loading to memory');
          return this.modelLoader!.load();
        }).catch((err) => {
          log.warn(`[LocalLLMProvider] Background download failed: ${err.message}`);
          // 下载失败，清理 modelLoader
          this.modelLoader = undefined;
        });
      }
    } catch (error: any) {
      log.error(`[LocalLLMProvider] Initialization failed: ${error.message}`);
      this.modelLoader = undefined;
      throw error;
    }
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    if (!this.modelLoader || !this.modelLoader.isLoaded()) {
      throw new Error('Local model not loaded');
    }

    return this.modelLoader.generate(prompt, {
      maxTokens: options?.maxTokens ?? 128,
      temperature: options?.temperature ?? 0.3,
    });
  }

  isAvailable(): boolean {
    return this.modelLoader?.isLoaded() ?? false;
  }

  getModelId(): string {
    return this.modelId;
  }

  async dispose(): Promise<void> {
    if (this.modelLoader) {
      await this.modelLoader.unload();
      this.modelLoader = undefined;
    }
  }
}
