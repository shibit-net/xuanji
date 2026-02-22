// ============================================================
// M7 LLM Provider — Anthropic Claude 适配器
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import type { Message, ToolSchema, ProviderConfig, StreamEvent, TokenUsage } from '@/types';
import { BaseLLMProvider } from './LLMProvider';

/**
 * Anthropic Claude Provider
 */
export class AnthropicProvider extends BaseLLMProvider {
  readonly name = 'anthropic';
  readonly models = ['claude-'];

  private getClient(config: ProviderConfig): Anthropic {
    return new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeout ?? 120_000,
    });
  }

  async *stream(
    messages: Message[],
    tools: ToolSchema[],
    config: ProviderConfig,
  ): AsyncIterable<StreamEvent> {
    const client = this.getClient(config);

    // 分离 system prompt 和普通消息
    const systemMessages = messages.filter((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    const systemPrompt = systemMessages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('\n');

    // 构造 Anthropic API 请求参数
    const params: Anthropic.MessageCreateParamsStreaming = {
      model: config.model,
      max_tokens: config.maxTokens || 16384,
      stream: true,
      messages: chatMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content as string,
      })),
      ...(systemPrompt ? { system: systemPrompt } : {}),
      ...(tools.length > 0 ? {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        })),
      } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    };

    const stream = client.messages.stream(params);

    // 当前 tool_use 块 JSON 累积
    let currentToolId: string | undefined;
    let currentToolName: string | undefined;
    let currentToolInput = '';

    for await (const event of stream) {
      switch (event.type) {
        case 'content_block_start': {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            currentToolId = block.id;
            currentToolName = block.name;
            currentToolInput = '';
            yield {
              type: 'tool_use_start',
              toolCall: { id: block.id, name: block.name, input: {} },
            };
          }
          break;
        }

        case 'content_block_delta': {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            yield { type: 'text_delta', text: delta.text };
          } else if (delta.type === 'thinking_delta') {
            yield { type: 'thinking_delta', thinking: delta.thinking };
          } else if (delta.type === 'input_json_delta') {
            currentToolInput += delta.partial_json;
            yield { type: 'tool_use_delta', text: delta.partial_json };
          }
          break;
        }

        case 'content_block_stop': {
          if (currentToolId && currentToolName) {
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(currentToolInput || '{}');
            } catch {
              // JSON 解析失败，使用空对象
            }
            yield {
              type: 'tool_use_end',
              toolCall: { id: currentToolId, name: currentToolName, input },
            };
            currentToolId = undefined;
            currentToolName = undefined;
            currentToolInput = '';
          }
          break;
        }

        case 'message_delta': {
          const usage: TokenUsage = {
            input: 0,
            output: event.usage?.output_tokens ?? 0,
          };
          yield {
            type: 'end',
            stopReason: event.delta.stop_reason === 'tool_use' ? 'tool_use' :
                        event.delta.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn',
            usage,
          };
          break;
        }

        case 'message_start': {
          const msgUsage = event.message.usage;
          yield {
            type: 'usage',
            usage: {
              input: msgUsage?.input_tokens ?? 0,
              output: msgUsage?.output_tokens ?? 0,
              cacheRead: (msgUsage as unknown as Record<string, unknown>)?.cache_read_input_tokens as number | undefined,
              cacheWrite: (msgUsage as unknown as Record<string, unknown>)?.cache_creation_input_tokens as number | undefined,
            },
          };
          break;
        }
      }
    }
  }
}
