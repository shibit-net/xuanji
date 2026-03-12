import { describe, it, expect } from 'vitest';
import { AnthropicProvider } from '@/core/providers/AnthropicProvider';
import { OpenAIProvider } from '@/core/providers/OpenAIProvider';
import type { ProviderConfig, Message, ToolSchema } from '@/core/types';

describe('Provider API Key Validation', () => {
  describe('AnthropicProvider', () => {
    it('应在 API Key 为空时抛出异常', async () => {
      const provider = new AnthropicProvider();
      const config: ProviderConfig = {
        model: 'claude-sonnet-4',
        apiKey: '', // 空字符串
      };

      const messages: Message[] = [{ role: 'user', content: 'test' }];
      const tools: ToolSchema[] = [];

      // stream 方法返回 AsyncIterator，需要调用 next() 才会执行
      const stream = provider.stream(messages, tools, config);
      
      await expect(stream.next()).rejects.toThrow('未配置 API Key');
    });

    it('应在 API Key 为 undefined 时抛出异常', async () => {
      const provider = new AnthropicProvider();
      const config: ProviderConfig = {
        model: 'claude-sonnet-4',
        apiKey: undefined, // undefined
      };

      const messages: Message[] = [{ role: 'user', content: 'test' }];
      const tools: ToolSchema[] = [];

      const stream = provider.stream(messages, tools, config);
      
      await expect(stream.next()).rejects.toThrow('未配置 API Key');
    });

    it('错误信息应包含配置方式说明', async () => {
      const provider = new AnthropicProvider();
      const config: ProviderConfig = {
        model: 'claude-sonnet-4',
      };

      const messages: Message[] = [{ role: 'user', content: 'test' }];
      const stream = provider.stream(messages, [], config);

      try {
        await stream.next();
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
      
      await expect(stream.next()).rejects.toThrow('未配置 API Key');
    });

    it('应在 API Key 为 undefined 时抛出异常', async () => {
      const provider = new OpenAIProvider();
      const config: ProviderConfig = {
        model: 'gpt-4o',
        apiKey: undefined,
      };

      const messages: Message[] = [{ role: 'user', content: 'test' }];
      const stream = provider.stream(messages, [], config);
      
      await expect(stream.next()).rejects.toThrow('未配置 API Key');
    });

    it('错误信息应包含配置方式说明', async () => {
      const provider = new OpenAIProvider();
      const config: ProviderConfig = {
        model: 'gpt-4o',
      };

      const messages: Message[] = [{ role: 'user', content: 'test' }];
      const stream = provider.stream(messages, [], config);

      try {
        await stream.next();
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
