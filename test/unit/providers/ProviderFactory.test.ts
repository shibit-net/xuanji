import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderFactory } from '@/core/providers/ProviderFactory';
import type { ILLMProvider, StreamEvent, ProviderConfig, Message, ToolSchema } from '@/core/types';

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
  it('懒加载模式下未注册 Provider 应返回 undefined', () => {
    const factory = new ProviderFactory();
    expect(factory.getByName('anthropic')).toBeUndefined();
    expect(factory.getByName('openai')).toBeUndefined();
  });

  it('register() 应注册新 Provider 并可通过 getByModel 查找', () => {
    const factory = new ProviderFactory();
    const mockProvider = createMockProvider('anthropic', ['claude-']);
    factory.register(mockProvider);

    expect(factory.getByName('anthropic')).toBe(mockProvider);
    expect(factory.getByModel('claude-sonnet-4')).toBe(mockProvider);
  });

  it('register() 应注册新 Provider', () => {
    const factory = new ProviderFactory();
    const mockProvider = createMockProvider('ollama', ['llama-']);
    factory.register(mockProvider);

    expect(factory.getByName('ollama')).toBe(mockProvider);
    expect(factory.getByModel('llama-3')).toBe(mockProvider);
  });

  it('getAll() 应返回所有已注册 Provider', () => {
    const factory = new ProviderFactory();
    expect(factory.getAll().length).toBe(0); // 懒加载，初始为空

    factory.register(createMockProvider('ollama', ['llama-']));
    expect(factory.getAll().length).toBe(1);
  });

  it('getByName() 未注册名称应返回 undefined', () => {
    const factory = new ProviderFactory();
    expect(factory.getByName('nonexistent')).toBeUndefined();
  });
});
