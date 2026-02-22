// ============================================================
// M7 LLM Provider — OpenAI GPT 适配器
// ============================================================

import OpenAI from 'openai';
import type { Message, ToolSchema, ProviderConfig, StreamEvent, TokenUsage } from '@/core/types';
import { BaseLLMProvider } from './LLMProvider';

/**
 * OpenAI GPT Provider
 * 支持 GPT-4o, GPT-4, GPT-3.5-turbo 等模型
 */
export class OpenAIProvider extends BaseLLMProvider {
  readonly name = 'openai';
  readonly models = ['gpt-', 'o1-', 'o3-'];

  private getClient(config: ProviderConfig): OpenAI {
    return new OpenAI({
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

    // 构造 OpenAI API 消息格式
    const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    // 添加 system 消息
    for (const msg of systemMessages) {
      if (typeof msg.content === 'string' && msg.content) {
        openaiMessages.push({ role: 'system', content: msg.content });
      }
    }

    // 添加对话消息
    for (const msg of chatMessages) {
      if (typeof msg.content === 'string') {
        openaiMessages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      } else {
        // ContentBlock[] — 需要转换
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            openaiMessages.push({
              role: msg.role as 'user' | 'assistant',
              content: block.text,
            });
          } else if (block.type === 'tool_use') {
            // LLM 的工具调用 → assistant message with tool_calls
            openaiMessages.push({
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: block.id!,
                type: 'function',
                function: {
                  name: block.name!,
                  arguments: JSON.stringify(block.input ?? {}),
                },
              }],
            });
          } else if (block.type === 'tool_result') {
            // 工具执行结果 → tool message
            openaiMessages.push({
              role: 'tool',
              tool_call_id: block.tool_use_id!,
              content: block.content ?? '',
            });
          }
        }
      }
    }

    // 构造 tools 参数
    const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined =
      tools.length > 0
        ? tools.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.input_schema as unknown as Record<string, unknown>,
            },
          }))
        : undefined;

    // 调用 OpenAI Streaming API
    const stream = await client.chat.completions.create({
      model: config.model,
      messages: openaiMessages,
      ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
      stream: true,
      stream_options: { include_usage: true },
      ...(openaiTools ? { tools: openaiTools } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    });

    // 工具调用累积状态
    const toolCallAccumulator: Map<number, {
      id: string;
      name: string;
      arguments: string;
    }> = new Map();

    let finishReason: string | null = null;

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];

      if (choice) {
        const delta = choice.delta;

        // 文本内容
        if (delta?.content) {
          yield { type: 'text_delta', text: delta.content };
        }

        // 工具调用
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;

            if (!toolCallAccumulator.has(idx)) {
              // 新的工具调用开始
              toolCallAccumulator.set(idx, {
                id: tc.id ?? `tc-${idx}`,
                name: tc.function?.name ?? '',
                arguments: '',
              });

              if (tc.function?.name) {
                yield {
                  type: 'tool_use_start',
                  toolCall: {
                    id: tc.id ?? `tc-${idx}`,
                    name: tc.function.name,
                    input: {},
                  },
                };
              }
            }

            // 累积参数 JSON
            const acc = toolCallAccumulator.get(idx)!;
            if (tc.function?.name && !acc.name) {
              acc.name = tc.function.name;
            }
            if (tc.function?.arguments) {
              acc.arguments += tc.function.arguments;
              yield { type: 'tool_use_delta', text: tc.function.arguments };
            }
          }
        }

        // 结束原因
        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }

      // usage 统计 (在最后一个 chunk 中)
      if (chunk.usage) {
        const usage: TokenUsage = {
          input: chunk.usage.prompt_tokens,
          output: chunk.usage.completion_tokens,
        };
        yield { type: 'usage', usage };
      }
    }

    // 发出所有完成的工具调用
    for (const [, acc] of toolCallAccumulator) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(acc.arguments || '{}');
      } catch {
        // JSON 解析失败
      }
      yield {
        type: 'tool_use_end',
        toolCall: { id: acc.id, name: acc.name, input },
      };
    }

    // 发出结束事件
    const stopReason = finishReason === 'tool_calls' ? 'tool_use'
      : finishReason === 'length' ? 'max_tokens'
      : 'end_turn';

    yield {
      type: 'end',
      stopReason,
      usage: { input: 0, output: 0 },
    };
  }
}
