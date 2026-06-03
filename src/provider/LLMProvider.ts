// ============================================================
// M7 LLM Provider — Provider 抽象基类
// ============================================================

import type { Message, ToolSchema, ProviderConfig, StreamEvent, ILLMProvider } from '@/infrastructure/core-types';

/**
 * LLM Provider 抽象基类
 * 所有具体 Provider 继承此类
 */
export abstract class BaseLLMProvider implements ILLMProvider {
  abstract readonly name: string;
  abstract readonly models: string[];

  abstract stream(
    messages: Message[],
    tools: ToolSchema[],
    config: ProviderConfig,
  ): AsyncIterable<StreamEvent>;

  isSupported(model: string): boolean {
    return this.models.some((m) => model.includes(m));
  }
}
