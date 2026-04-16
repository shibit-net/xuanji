import { describe, it, expect } from 'vitest';
import { AnthropicProvider } from '@/core/providers/AnthropicProvider';
import { OpenAIProvider } from '@/core/providers/OpenAIProvider';
import type { ProviderConfig, Message, ToolSchema } from '@/core/types';

/** 消费 AsyncIterable 直到抛出异常或结束 */
async function consumeStream(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of stream) { /* consume */ }
}

describe('Provider API Key Validation', () => {
  describe('AnthropicProvider', () => {
    it('应在 API Key 为空时抛出异常', async () => {
      const provider = new AnthropicProvider();
      const config: ProviderConfig = {
        model: 'claude-sonnet-4',
        apiKey: '',
      };

      const messages: Message[] = [{ role: 'user', content: 'test' }];
      const tools: ToolSchema[] = [];

      const stream = provider.stream(messages, tools, config);
      await expect(consumeStream(stream)).rejects.toThrow('未配置 API Key');
    });

    it('应在 API Key 为 undefined 时抛出异常', async () => {
      const provider = new AnthropicProvider();
      const config: ProviderConfig = {
        model: 'claude-sonnet-4',
        apiKey: undefined,
      };

      const messages: Message[] = [{ role: 'user', content: 'test' }];
      const tools: ToolSchema[] = [];

      const stream = provider.stream(messages, tools, config);
      await expect(consumeStream(stream)).rejects.toThrow('未配置 API Key');
    });

    it('错误信息应包含配置方式说明', async () => {
      const provider = new AnthropicProvider();
      const config: ProviderConfig = {
        model: 'claude-sonnet-4',
      };

      const messages: Message[] = [{ role: 'user', content: 'test' }];
      const stream = provider.stream(messages, [], config);

      try {
        await consumeStream(stream);
        expect.fail('应该抛出异常');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('环境变量');
        expect(message).toContain('全局配置');
        expect(message).toContain('项目配置');
        expect(message).toContain('XUANJI_API_KEY');
      }
    });
  });

  describe('OpenAIProvider', () => {
    it('应在 API Key 为空时抛出异常', async () => {
      const provider = new OpenAIProvider();
      const config: ProviderConfig = {
        model: 'gpt-4o',
        apiKey: '',
      };

      const messages: Message[] = [{ role: 'user', content: 'test' }];
      const stream = provider.stream(messages, [], config);
      await expect(consumeStream(stream)).rejects.toThrow('未配置 API Key');
    });

    it('应在 API Key 为 undefined 时抛出异常', async () => {
      const provider = new OpenAIProvider();
      const config: ProviderConfig = {
        model: 'gpt-4o',
        apiKey: undefined,
      };

      const messages: Message[] = [{ role: 'user', content: 'test' }];
      const stream = provider.stream(messages, [], config);
      await expect(consumeStream(stream)).rejects.toThrow('未配置 API Key');
    });

    it('错误信息应包含配置方式说明', async () => {
      const provider = new OpenAIProvider();
      const config: ProviderConfig = {
        model: 'gpt-4o',
      };

      const messages: Message[] = [{ role: 'user', content: 'test' }];
      const stream = provider.stream(messages, [], config);

      try {
        await consumeStream(stream);
        expect.fail('应该抛出异常');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).toContain('环境变量');
        expect(message).toContain('全局配置');
        expect(message).toContain('项目配置');
        expect(message).toContain('XUANJI_API_KEY');
      }
    });
  });
});
