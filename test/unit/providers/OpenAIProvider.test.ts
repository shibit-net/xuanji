import { describe, it, expect, vi } from 'vitest';
import { OpenAIProvider } from '@/provider/OpenAIProvider';
import type { ProviderConfig, StreamEvent, Message, ToolSchema } from '@/infrastructure/core-types';

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider();
  });

  it('应有正确的 Provider 名称', () => {
    expect(provider.name).toBe('openai');
  });

  it('应支持 GPT 系列模型', () => {
    expect(provider.isSupported('gpt-4o')).toBe(true);
    expect(provider.isSupported('gpt-4')).toBe(true);
    expect(provider.isSupported('gpt-3.5-turbo')).toBe(true);
    expect(provider.isSupported('gpt-4o-mini')).toBe(true);
  });

  it('应支持 o1/o3 系列模型', () => {
    expect(provider.isSupported('o1-preview')).toBe(true);
    expect(provider.isSupported('o3-mini')).toBe(true);
  });

  it('应不支持 Claude 模型', () => {
    expect(provider.isSupported('claude-sonnet-4')).toBe(false);
    expect(provider.isSupported('claude-haiku-3.5')).toBe(false);
  });

  it('models 数组应包含 gpt- 前缀', () => {
    expect(provider.models).toContain('gpt-');
    expect(provider.models).toContain('o1-');
    expect(provider.models).toContain('o3-');
  });
});
