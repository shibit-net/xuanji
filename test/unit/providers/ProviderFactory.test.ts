import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderFactory } from '@/providers/ProviderFactory';
import type { ILLMProvider, StreamEvent, ProviderConfig, Message, ToolSchema } from '@/types';

/** 创建 mock Provider */
function createMockProvider(name: string, supportedModels: string[]): ILLMProvider {
  return {
    name,
    models: supportedModels,
    isSupported: (model: string) => supportedModels.some(m => model.includes(m)),
    stream: vi.fn(async function* (): AsyncIterable<StreamEvent> {
      yield { type: 'text_delta', text: 'hello' };
      yield { type: 'end', stopReason: 'end_turn' };
    }),
  };
}

describe('ProviderFactory', () => {
  it('应默认注册 Anthropic Provider', () => {
    const factory = new ProviderFactory();
    const provider = factory.getByName('anthropic');
    expect(provider).toBeDefined();
    expect(provider?.name).toBe('anthropic');
  });

  it('应默认注册 OpenAI Provider', () => {
    const factory = new ProviderFactory();
    const provider = factory.getByName('openai');
    expect(provider).toBeDefined();
    expect(provider?.name).toBe('openai');
  });

  it('getByModel() 应根据 Claude 模型返回 Anthropic Provider', () => {
    const factory = new ProviderFactory();
    const provider = factory.getByModel('claude-sonnet-4');
    expect(provider).toBeDefined();
    expect(provider?.name).toBe('anthropic');
  });

  it('getByModel() 应根据 GPT 模型返回 OpenAI Provider', () => {
    const factory = new ProviderFactory();
    const provider = factory.getByModel('gpt-4o');
    expect(provider).toBeDefined();
    expect(provider?.name).toBe('openai');
  });

  it('getByModel() 未知模型应返回 undefined', () => {
    const factory = new ProviderFactory();
    const provider = factory.getByModel('llama-3');
    expect(provider).toBeUndefined();
  });

  it('register() 应注册新 Provider', () => {
    const factory = new ProviderFactory();
    const mockProvider = createMockProvider('ollama', ['llama-']);
    factory.register(mockProvider);

    expect(factory.getByName('ollama')).toBe(mockProvider);
    expect(factory.getByModel('llama-3')).toBe(mockProvider);
  });

  it('getAll() 应返回所有 Provider', () => {
    const factory = new ProviderFactory();
    const initial = factory.getAll();
    expect(initial.length).toBe(2); // anthropic + openai

    factory.register(createMockProvider('ollama', ['llama-']));
    expect(factory.getAll().length).toBe(3);
  });

  it('getByName() 未注册名称应返回 undefined', () => {
    const factory = new ProviderFactory();
    expect(factory.getByName('nonexistent')).toBeUndefined();
  });
});
