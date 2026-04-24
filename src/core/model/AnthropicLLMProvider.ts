// ============================================================
// AnthropicLLMProvider - Anthropic API Provider
// ============================================================

import { LLMProvider, GenerateOptions } from './LLMProvider';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'AnthropicLLMProvider' });

export class AnthropicLLMProvider implements LLMProvider {
  private client?: Anthropic;
  private modelId: string;
  private defaultSystemPrompt?: string;
  private apiKey: string;
  private baseURL?: string;

  constructor(modelId: string, apiKey: string, baseURL?: string, systemPrompt?: string) {
    this.modelId = modelId.replace('[CL]', ''); // 移除 [CL] 前缀
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.defaultSystemPrompt = systemPrompt;
  }

  async init(): Promise<void> {
    log.info(`[AnthropicLLMProvider] Initializing client for model: ${this.modelId}`);

    this.client = new Anthropic({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
    });

    log.info('[AnthropicLLMProvider] Client initialized successfully');
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<string> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized');
    }

    try {
      const systemPrompt = options?.systemPrompt ?? this.defaultSystemPrompt;
      const maxTokens = options?.maxTokens ?? 128;
      const temperature = options?.temperature ?? 0.3;

      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: prompt },
      ];

      const response = await this.client.messages.create({
        model: this.modelId,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages,
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text content in response');
      }

      return textContent.text;
    } catch (error: any) {
      log.error(`[AnthropicLLMProvider] Generate failed: ${error.message}`);
      throw error;
    }
  }

  isAvailable(): boolean {
    return this.client !== undefined;
  }

  getModelId(): string {
    return this.modelId;
  }

  async dispose(): Promise<void> {
    this.client = undefined;
  }
}
