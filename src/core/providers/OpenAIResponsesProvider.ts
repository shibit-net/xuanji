// ============================================================
// M7 LLM Provider — OpenAI Responses API 适配器
//
// 使用 OpenAI Responses API（client.responses.create）提供能力，
// 支持 GPT-4o image generation、web search 等 Chat Completions
// 不支持的新特性。
// ============================================================

import OpenAI from 'openai';
import type { Message, ContentBlock, ToolSchema, ProviderConfig, StreamEvent, TokenUsage } from '@/core/types';
import { BaseLLMProvider } from './LLMProvider';
import { logger } from '@/core/logger';

/**
 * OpenAI Responses Provider
 *
 * 支持 GPT-4o, GPT-4o-mini, o3, o4-mini 等模型。
 * 通过 Responses API 提供图片生成、web search 等能力。
 */
export class OpenAIResponsesProvider extends BaseLLMProvider {
  readonly name = 'openai-responses';
  readonly models = ['gpt-4o', 'gpt-4o-mini', 'o3-', 'o4-mini'];
  private log = logger.child({ module: 'OpenAIResponsesProvider' });

  private getClient(config: ProviderConfig): OpenAI {
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new Error('OpenAIResponses Provider: API Key not configured');
    }

    let baseURL = config.baseURL;
    if (baseURL && !/\/v\d+\/?$/.test(baseURL)) {
      baseURL = baseURL.replace(/\/+$/, '') + '/v1';
    }

    return new OpenAI({
      apiKey: config.apiKey,
      baseURL,
      timeout: config.timeout ?? 600_000,
    });
  }

  /**
   * 将内部 Message[] 转换为 Responses API 的 input items
   */
  private convertMessagesToInput(
    messages: Message[],
  ): OpenAI.Responses.ResponseInputItem[] {
    const inputItems: OpenAI.Responses.ResponseInputItem[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Responses API 不支持单独的 system message，通过 instructions 参数传递
        continue;
      }

      if (typeof msg.content === 'string') {
        inputItems.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content,
          type: 'message',
        } as OpenAI.Responses.EasyInputMessage);
        continue;
      }

      if (!Array.isArray(msg.content)) continue;

      // ContentBlock[] → Response content parts
      const parts: Array<{ type: string; [key: string]: unknown }> = [];
      for (const block of msg.content as ContentBlock[]) {
        switch (block.type) {
          case 'text':
            if (block.text) parts.push({ type: 'input_text', text: block.text });
            break;
          case 'image':
            if (block.data) {
              parts.push({
                type: 'input_image',
                image_url: `data:${block.mimeType || 'image/png'};base64,${block.data}`,
              });
            } else if (block.imageUrl) {
              parts.push({
                type: 'input_image',
                image_url: block.imageUrl,
              });
            }
            break;
          case 'audio':
            if (block.data) {
              // OpenAI Responses API supports input_audio natively
              parts.push({
                type: 'input_audio',
                audio: { data: `data:${block.mimeType || 'audio/mpeg'};base64,${block.data}` },
              });
            }
            break;
          case 'video':
            // OpenAI Responses API does not natively support video input, use text placeholder
            parts.push({ type: 'input_text', text: `[Video file: ${block.name || 'video'}]` });
            break;
          case 'tool_use':
            // Responses API 使用 function_call 格式
            parts.push({
              type: 'function_call',
              call_id: block.id || '',
              name: block.name || '',
              arguments: JSON.stringify(block.input || {}),
            } as any);
            break;
          case 'tool_result':
            parts.push({
              type: 'function_call_output',
              call_id: block.tool_use_id || '',
              output: block.content || '',
            } as any);
            break;
          case 'thinking':
          case 'reasoning':
            // Drop thinking blocks — Responses API handles its own reasoning
            break;
        }
      }

      if (parts.length > 0) {
        inputItems.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: parts,
          type: 'message',
        } as any);
      }
    }

    return inputItems;
  }

  /**
   * 将内部 ToolSchema[] 转换为 Responses API 的 tools 参数
   */
  private convertTools(
    tools: ToolSchema[],
  ): Array<{ type: 'function'; name: string; description: string; parameters: Record<string, unknown>; strict?: boolean }> {
    if (tools.length === 0) return [];
    return tools.map((t) => ({
      type: 'function' as const,
      name: t.name,
      description: t.description,
      parameters: t.input_schema as unknown as Record<string, unknown>,
    }));
  }

  /**
   * 提取 system prompt 文本
   */
  private extractSystemText(messages: Message[]): string | undefined {
    const parts: string[] = [];
    for (const msg of messages) {
      if (msg.role !== 'system') continue;
      if (typeof msg.content === 'string') {
        parts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            parts.push(block.text);
          }
        }
      }
    }
    const combined = parts.join('\n\n').trim();
    return combined || undefined;
  }

  async *stream(
    messages: Message[],
    tools: ToolSchema[],
    config: ProviderConfig,
  ): AsyncIterable<StreamEvent> {
    const client = this.getClient(config);

    const systemText = this.extractSystemText(messages);
    const chatMessages = messages.filter((m) => m.role !== 'system');
    const inputItems = this.convertMessagesToInput(chatMessages);
    const responseTools = this.convertTools(tools);

    try {
      // 使用非流式 Responses API 获取完整响应
      const response = await (client.responses as any).create({
        model: config.model,
        input: inputItems,
        ...(systemText ? { instructions: systemText } : {}),
        ...(responseTools.length > 0 ? { tools: responseTools } : {}),
        max_output_tokens: config.maxTokens ?? 8192,
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      }) as OpenAI.Responses.Response;

      // 解析 response.output
      let hasImage = false;
      let hasText = false;
      let usage: TokenUsage = { input: 0, output: 0 };

      if (response.usage) {
        usage = {
          input: response.usage.input_tokens || 0,
          output: response.usage.output_tokens || 0,
          cacheRead: (response.usage as any).input_tokens_details?.cached_tokens,
        };
      }

      for (const item of response.output) {
        if (item.type === 'message' && 'content' in item) {
          for (const content of (item as any).content || []) {
            if (content.type === 'output_text') {
              yield { type: 'text_delta', text: content.text || '' };
              hasText = true;
            }
          }
        }

        if (item.type === 'image_generation_call') {
          const gen = item as OpenAI.Responses.ResponseOutputItem.ImageGenerationCall;
          yield {
            type: 'image_delta',
            image: {
              data: gen.result || undefined,
              mimeType: 'image/png',
            },
          };
          hasImage = true;
        }

        if (item.type === 'function_call') {
          yield {
            type: 'tool_use_start',
            toolCall: {
              id: (item as any).call_id || `fc-${Date.now()}`,
              name: (item as any).name || '',
              input: {},
            },
          };
        }

        if (item.type === 'function_call_output') {
          // Responses API 将 function_call 和 function_call_output 分开；
          // 异步产生 tool_use_start → tool_use_end 对
          yield {
            type: 'tool_use_end',
            toolCall: {
              id: (item as any).call_id || '',
              name: '',
              input: {
                _raw_result: (item as any).output || '',
              },
            },
          };
        }
      }

      // 发送 usage 和 end
      yield { type: 'usage', usage };
      yield {
        type: 'end',
        stopReason: hasImage ? 'end_turn' : hasText ? 'end_turn' : 'tool_use',
        usage,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      // 检查是否是 context too large 错误
      if (error.message.includes('context_length') || error.message.includes('maximum context')) {
        throw error;
      }
      yield { type: 'error', error };
    }
  }
}
