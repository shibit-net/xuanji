// ============================================================
// M7 LLM Provider — OpenAI GPT 适配器
// ============================================================

import OpenAI from 'openai';
import type { Message, ContentBlock, ToolSchema, ProviderConfig, StreamEvent, TokenUsage } from '@/core/types';
import { BaseLLMProvider } from './LLMProvider';
import { logger } from '@/core/logger';

/**
 * 判断是否为官方 OpenAI API（而非代理服务）
 * 用于控制是否启用 OpenAI 特有的扩展参数（如 stream_options）
 */
function isOfficialOpenAI(baseURL?: string): boolean {
  if (!baseURL) return true; // 未设置 baseURL 时默认为官方 API
  return baseURL.includes('api.openai.com');
}

/**
 * OpenAI GPT Provider
 * 支持 GPT-4o, GPT-4, GPT-3.5-turbo, o1, o3 等模型
 * 同时兼容 DeepSeek、Azure OpenAI 等 OpenAI Chat Completions API 兼容服务
 */
export class OpenAIProvider extends BaseLLMProvider {
  readonly name = 'openai';
  readonly models = ['gpt-', 'o1-', 'o3-'];
  private log = logger.child({ module: 'OpenAIProvider' });

  private getClient(config: ProviderConfig): OpenAI {
    // OpenAI SDK 标准 baseURL 格式为 https://api.openai.com/v1
    // 自定义代理（如 shibit.net）可能省略 /v1 后缀，这里自动补全
    let baseURL = config.baseURL;
    if (baseURL && !/\/v\d+\/?$/.test(baseURL)) {
      baseURL = baseURL.replace(/\/+$/, '') + '/v1';
    }

    return new OpenAI({
      apiKey: config.apiKey,
      baseURL,
      timeout: config.timeout ?? 120_000,
    });
  }

  /**
   * 转换单个 Message 为 OpenAI 格式
   *
   * 关键设计：
   * 1. 同一 assistant 消息中的多个 tool_use 合并为一个 message with tool_calls
   * 2. text + tool_use 混合时，text 作为 assistant message 的 content 附带 tool_calls
   * 3. tool_result blocks 转为独立的 role:'tool' messages
   * 4. 保持消息顺序：先输出 text/tool_use（assistant），再输出 tool_result（tool）
   */
  private convertMessage(msg: Message): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    // 简单字符串消息（system / user / assistant）
    if (typeof msg.content === 'string') {
      result.push({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      });
      return result;
    }

    // ContentBlock[] — 复杂消息结构
    if (!Array.isArray(msg.content)) {
      return result; // 非法类型，跳过
    }

    const blocks = msg.content as ContentBlock[];

    // 按类型分组处理
    const textBlocks: ContentBlock[] = [];
    const thinkingBlocks: ContentBlock[] = [];
    const toolUseBlocks: ContentBlock[] = [];
    const toolResultBlocks: ContentBlock[] = [];

    for (const block of blocks) {
      switch (block.type) {
        case 'text':
          textBlocks.push(block);
          break;
        case 'thinking':
          thinkingBlocks.push(block);
          break;
        case 'tool_use':
          toolUseBlocks.push(block);
          break;
        case 'tool_result':
          toolResultBlocks.push(block);
          break;
      }
    }

    // === Assistant 消息处理 (text + thinking + tool_use) ===

    // 合并 text 和 thinking 为文本内容
    let combinedText = '';
    if (textBlocks.length > 0) {
      combinedText = textBlocks.map(b => b.text ?? '').join('\n');
    }
    if (thinkingBlocks.length > 0) {
      const thinkingText = thinkingBlocks.map(b => b.thinking ?? '').join('\n');
      if (thinkingText.trim()) {
        // 将 thinking 追加到文本中（OpenAI 无原生 thinking 支持）
        const prefix = combinedText.trim() ? '\n' : '';
        combinedText += `${prefix}[思考过程]\n${thinkingText}`;
      }
    }

    if (toolUseBlocks.length > 0) {
      // text + tool_use 混合 → 单个 assistant message with content + tool_calls
      // OpenAI 格式要求：如果有 tool_calls，content 可以为 string 或 null
      result.push({
        role: 'assistant',
        content: combinedText.trim() || null,
        tool_calls: toolUseBlocks.map(block => ({
          id: block.id!,
          type: 'function' as const,
          function: {
            name: block.name!,
            arguments: JSON.stringify(block.input ?? {}),
          },
        })),
      });
    } else if (combinedText.trim()) {
      // 纯文本消息（无 tool_use）
      result.push({
        role: msg.role as 'user' | 'assistant',
        content: combinedText,
      });
    }

    // === Tool Result 消息处理 ===
    // tool_result blocks → 转为独立的 tool messages
    // 必须在 assistant tool_calls 消息之后
    for (const block of toolResultBlocks) {
      result.push({
        role: 'tool',
        tool_call_id: block.tool_use_id!,
        content: block.content ?? '',
      });
    }

    return result;
  }

  async *stream(
    messages: Message[],
    tools: ToolSchema[],
    config: ProviderConfig,
  ): AsyncIterable<StreamEvent> {
    const client = this.getClient(config);

    try {
      // 转换所有消息为 OpenAI 格式
      const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
      for (const msg of messages) {
        openaiMessages.push(...this.convertMessage(msg));
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

      // 构造请求参数
      // 注意：stream_options 仅在官方 OpenAI API 中支持
      // DeepSeek、Azure 等兼容 API 不支持此参数，会导致 400 错误
      const isOfficial = isOfficialOpenAI(config.baseURL);

      const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        model: config.model,
        messages: openaiMessages,
        stream: true,
        ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
        ...(isOfficial ? { stream_options: { include_usage: true } } : {}),
        ...(openaiTools ? {
          tools: openaiTools,
          tool_choice: 'auto' as const,         // 显式指定：让模型自主决定是否调用工具
          parallel_tool_calls: true,             // 允许并行工具调用
        } : {}),
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      };

      // 调试日志：输出请求摘要（帮助排查工具调用问题）
      this.log.debug(`Request: model=${requestParams.model}, messages=${openaiMessages.length}, tools=${openaiTools?.length ?? 0}`);
      this.log.debug(`Messages: ${JSON.stringify(openaiMessages.map(m => ({ role: m.role, contentType: typeof (m as unknown as Record<string, unknown>).content, hasToolCalls: !!(m as unknown as Record<string, unknown>).tool_calls })))}`);
      if (openaiTools) {
        this.log.debug(`Tools: ${JSON.stringify(openaiTools.map(t => 'function' in t ? (t as { function: { name: string } }).function.name : 'unknown'))}`);
      }

      // 调用 OpenAI Streaming API
      const stream = await client.chat.completions.create(requestParams);

      // 工具调用累积状态
      const toolCallAccumulator: Map<number, {
        id: string;
        name: string;
        arguments: string;
      }> = new Map();

      let finishReason: string | null = null;
      let chunkCount = 0;

      for await (const chunk of stream) {
        chunkCount++;
        const choice = chunk.choices?.[0];

        if (choice) {
          const delta = choice.delta;

          // 调试日志：输出每个 chunk 的关键信息
          if (delta?.tool_calls || choice.finish_reason) {
            this.log.debug(`Chunk#${chunkCount}: finish_reason=${choice.finish_reason}, hasToolCalls=${!!delta?.tool_calls}, toolCalls=${JSON.stringify(delta?.tool_calls)}`);
          }

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

        // usage 统计 (在最后一个 chunk 中，仅官方 OpenAI 支持 stream_options)
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
          // JSON 解析失败：将截断的原始 JSON 作为错误信息传递
          input = {
            _parse_error: true,
            _raw_input: acc.arguments?.substring(0, 500) ?? '',
            _error_message: `工具参数 JSON 解析失败（已接收 ${acc.arguments?.length ?? 0} 字符），可能是流传输被截断`,
          };
        }
        yield {
          type: 'tool_use_end',
          toolCall: { id: acc.id, name: acc.name, input },
        };
      }

      // 调试日志：流结束摘要
      this.log.debug(`Stream done: chunks=${chunkCount}, finishReason=${finishReason}, toolCallsAccumulated=${toolCallAccumulator.size}`);
      for (const [idx, acc] of toolCallAccumulator) {
        this.log.debug(`  ToolCall[${idx}]: id=${acc.id}, name=${acc.name}, argsLen=${acc.arguments.length}`);
      }

      // 发出结束事件
      // 兼容不同 API 的 finish_reason 值：
      // - OpenAI 官方: 'tool_calls'
      // - DeepSeek 等兼容 API: 可能返回 'tool_calls' 或其他变体
      // - 如果有工具调用被累积，即使 finish_reason 不是 'tool_calls' 也视为 tool_use
      const hasToolCalls = toolCallAccumulator.size > 0;
      const stopReason = (finishReason === 'tool_calls' || hasToolCalls) ? 'tool_use'
        : finishReason === 'length' ? 'max_tokens'
        : 'end_turn';

      yield {
        type: 'end',
        stopReason,
        usage: { input: 0, output: 0 },
      };
    } catch (err) {
      // 捕获并增强错误信息
      const errorDetails = {
        provider: 'openai',
        model: config.model,
        baseURL: config.baseURL,
        messageCount: messages.length,
        toolCount: tools.length,
      };

      let errorMessage = err instanceof Error ? err.message : String(err);

      // 增强错误信息
      if (errorMessage.includes('status code') || errorMessage.includes('Bad Request') || errorMessage.includes('400')) {
        errorMessage += `\n\n调试信息:\n` +
          `- Provider: ${errorDetails.provider}\n` +
          `- 模型: ${errorDetails.model}\n` +
          `- Base URL: ${errorDetails.baseURL || 'https://api.openai.com/v1'}\n` +
          `- 消息数: ${errorDetails.messageCount}\n` +
          `- 工具数: ${errorDetails.toolCount}\n\n` +
          `常见原因:\n` +
          `1. API Key 无效或过期\n` +
          `2. 模型名称错误（请检查 config.json 中的 model 字段）\n` +
          `3. baseURL 配置错误（如使用代理服务）\n` +
          `4. API 服务暂时不可用（请稍后重试）`;
      }

      throw new Error(errorMessage);
    }
  }
}
