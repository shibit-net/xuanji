// ============================================================
// M7 LLM Provider — OpenAI GPT 适配器
// ============================================================

import OpenAI from 'openai';
import type { Message, ContentBlock, ToolSchema, ProviderConfig, StreamEvent, TokenUsage, StopReason } from '@/core/types';
import { BaseLLMProvider } from './LLMProvider';
import { logger } from '@/core/logger';

/**
 * OpenAI GPT Provider
 * 支持 GPT-4o, GPT-4, GPT-3.5-turbo, o1, o3 等模型
 * 同时兼容 DeepSeek、Azure OpenAI 等 OpenAI Chat Completions API 兼容服务
 */
export class OpenAIProvider extends BaseLLMProvider {
  readonly name = 'openai';
  readonly models = ['gpt-', 'o1-', 'o3-', 'deepseek-'];
  private log = logger.child({ module: 'OpenAIProvider' });

  private getClient(config: ProviderConfig): OpenAI {
    // 检查 API Key 是否存在（由上层 ProviderManager 负责配置合并）
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new Error('OpenAI Provider: API Key 未配置');
    }

    // OpenAI SDK 标准 baseURL 格式为 https://api.openai.com/v1
    // 自定义代理（如 shibit.net）可能省略 /v1 后缀，这里自动补全
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
    const reasoningBlocks: ContentBlock[] = [];
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
        case 'reasoning':
          reasoningBlocks.push(block);
          break;
        case 'tool_use':
          toolUseBlocks.push(block);
          break;
        case 'tool_result':
          toolResultBlocks.push(block);
          break;
      }
    }

    // === 合并 text 和 thinking 为文本内容 ===
    let combinedText = '';
    if (textBlocks.length > 0) {
      combinedText = textBlocks.map(b => b.text ?? '').join('\n');
    }
    if (thinkingBlocks.length > 0) {
      const thinkingText = thinkingBlocks.map(b => b.thinking ?? '').join('\n');
      if (thinkingText.trim()) {
        const prefix = combinedText.trim() ? '\n' : '';
        combinedText += `${prefix}[思考过程]\n${thinkingText}`;
      }
    }

    // DeepSeek thinking 模式：reasoning_content 必须在后续请求中原样回传
    const reasoningText = reasoningBlocks.map(b => b.reasoning ?? '').join('');

    // Step 1: Assistant 消息（含 tool_calls + reasoning_content）
    // OpenAI 格式要求：如果有 tool_calls，content 可以为 string 或 null
    if (toolUseBlocks.length > 0) {
      const assistantMsg: any = {
        role: 'assistant',
        // reasoning_content 存在时避免 content 为 null（DeepSeek 兼容）
        content: combinedText.trim() || (reasoningText ? '' : null),
        tool_calls: toolUseBlocks.map(block => ({
          id: block.id!,
          type: 'function' as const,
          function: {
            name: block.name!,
            arguments: JSON.stringify(block.input ?? {}),
          },
        })),
      };
      if (reasoningText) {
        assistantMsg.reasoning_content = reasoningText;
      }
      result.push(assistantMsg);
    }

    // Step 2: Tool 消息（tool_result blocks → role: 'tool'）
    // 必须在 assistant tool_calls 之后、user 文本消息之前，确保 API 能正确配对
    for (const block of toolResultBlocks) {
      result.push({
        role: 'tool',
        tool_call_id: block.tool_use_id!,
        content: block.content ?? '',
      });
    }

    // Step 3: User/Assistant 文本消息（无 tool_use 时，含 reasoning_content）
    // 放在 tool 消息之后，避免破坏 assistant(tool_calls) → tool 的紧邻关系
    if (toolUseBlocks.length === 0 && (combinedText.trim() || reasoningText)) {
      const textMsg: any = {
        role: msg.role as 'user' | 'assistant',
        content: combinedText.trim() || '',
      };
      if (reasoningText) {
        textMsg.reasoning_content = reasoningText;
      }
      result.push(textMsg);
    }

    return result;
  }

  async *stream(
    messages: Message[],
    tools: ToolSchema[],
    config: ProviderConfig,
  ): AsyncIterable<StreamEvent> {
    const client = this.getClient(config);
    let openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    try {
      // 分离 system 消息和对话消息
      // system 消息可能携带 ContentBlock[]（结构化 system prompt），需单独提取为纯文本
      const systemMessages = messages.filter((m) => m.role === 'system');
      const chatMessages = messages.filter((m) => m.role !== 'system');

      // 提取 system prompt 文本（兼容 string 和 ContentBlock[] 两种格式）
      // OpenAI 自动缓存前缀匹配的 prompt，无需显式标记
      const systemText = systemMessages
        .map((m) => {
          if (typeof m.content === 'string') return m.content;
          if (Array.isArray(m.content)) {
            return (m.content as ContentBlock[])
              .filter((b) => b.type === 'text' && b.text)
              .map((b) => b.text)
              .join('\n\n');
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');

      // 转换对话消息为 OpenAI 格式
      openaiMessages = [];
      if (systemText) {
        openaiMessages.push({ role: 'system', content: systemText });
      }
      for (const msg of chatMessages) {
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
      // stream_options: 始终发送，大多数 OpenAI 兼容 API（包括代理服务）都支持此参数
      // 不支持的 API 会忽略该参数，不会导致错误
      const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
        model: config.model,
        messages: openaiMessages,
        stream: true,
        ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
        stream_options: { include_usage: true },
        ...(openaiTools ? {
          tools: openaiTools,
          tool_choice: 'auto' as const,         // 显式指定：让模型自主决定是否调用工具
          parallel_tool_calls: true,             // 允许并行工具调用
        } : {}),
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.thinking ? {
          // DeepSeek / OpenAI 思考模式：显式传递 thinking 参数确保行为一致
          // OpenAI SDK 类型未包含此字段，通过 any 传递
          thinking: config.thinking as any,
        } : {}),
      };

      // 调试日志：输出请求摘要（帮助排查工具调用问题）
      this.log.debug(`Request: model=${requestParams.model}, messages=${openaiMessages.length}, tools=${openaiTools?.length ?? 0}`);
      this.log.debug(`Messages: ${JSON.stringify(openaiMessages.map(m => {
        const msg = m as Record<string, unknown>;
        return {
          role: msg.role,
          hasContent: !!msg.content,
          hasToolCalls: !!(msg as any).tool_calls,
          hasReasoning: !!(msg as any).reasoning_content,
          reasoningLen: typeof (msg as any).reasoning_content === 'string' ? (msg as any).reasoning_content.length : 0,
        };
      }))}`);
      // 诊断 + 自动修复：检查 assistant 消息的 reasoning_content 状态（DeepSeek V4 400 错误防护）
      if (config.thinking) {
        const assistantMsgs = openaiMessages.filter(m => m.role === 'assistant');
        const withReasoning = assistantMsgs.filter(m => !!(m as any).reasoning_content);
        const withoutReasoning = assistantMsgs.filter(m => !(m as any).reasoning_content);
        if (withoutReasoning.length > 0 && withReasoning.length > 0) {
          // 混合状态：部分 assistant 消息有 reasoning_content，部分缺失。
          // 这是 DeepSeek V4 400 错误的确定原因，必须修复后才能发送请求。
          // 自动降级：剥离所有 reasoning_content 并禁用 thinking mode。
          const missingIndices: number[] = [];
          openaiMessages.forEach((m, i) => {
            if (m.role === 'assistant' && !(m as any).reasoning_content) {
              missingIndices.push(i);
            }
            if ((m as any).reasoning_content) {
              delete (m as any).reasoning_content;
            }
          });
          delete (requestParams as any).thinking;
          this.log.warn(
            `DeepSeek V4 reasoning_content 混合状态，自动降级：` +
            `${withReasoning.length} 条有 reasoning、${withoutReasoning.length} 条缺失（索引: ${missingIndices.join(',')}），` +
            `已剥离所有 reasoning_content 并禁用 thinking mode`
          );
        } else if (withReasoning.length > 0) {
          this.log.debug(`DeepSeek V4: ${withReasoning.length}/${assistantMsgs.length} assistant messages have reasoning_content`);
        }
      }
      if (openaiTools) {
        this.log.debug(`Tools: ${JSON.stringify(openaiTools.map(t => 'function' in t ? (t as { function: { name: string } }).function.name : 'unknown'))}`);
      }

      // 🔧 调用 OpenAI Streaming API，支持 AbortSignal
      const stream = await client.chat.completions.create(requestParams, {
        signal: config.signal,
      });

      // 工具调用累积状态
      const toolCallAccumulator: Map<number, {
        id: string;
        name: string;
        arguments: string;
        emitted: boolean;  // 是否已发出 tool_use_end
        garbageDetected: boolean;  // 模型将自然语言误输出为 tool arguments
      }> = new Map();

      let finishReason: string | null = null;
      let chunkCount = 0;
      let receivedEnd = false;

      // 内联错误检测：某些 API（如 DeepSeek）可能将错误信息嵌入流式响应文本
      let earlyTextBuffer = '';

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
            // 内联错误检测：检查前 500 字符是否包含 API 错误信息
            if (earlyTextBuffer.length < 500) {
              earlyTextBuffer += delta.content;
              const detected = this.detectInlineApiError(earlyTextBuffer);
              if (detected) {
                throw new Error(detected);
              }
            }
            yield { type: 'text_delta', text: delta.content };
          }

          // DeepSeek thinking 模式：reasoning_content 必须在后续请求中回传
          // 检查多个可能的位置（不同 API 兼容层可能放在不同地方）
          const reasoningDelta = (delta as any)?.reasoning_content
            || (choice as any)?.message?.reasoning_content
            || (choice as any)?.reasoning_content
            || (chunk as any)?.reasoning_content;
          if (reasoningDelta) {
            this.log.debug(`Captured reasoning_content (${typeof reasoningDelta === 'string' ? reasoningDelta.length + ' chars' : typeof reasoningDelta})`);
            yield { type: 'reasoning_delta', reasoning: typeof reasoningDelta === 'string' ? reasoningDelta : JSON.stringify(reasoningDelta) };
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
                  emitted: false,
                  garbageDetected: false,
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

                // 垃圾检测：累积超过 20 字符后检查是否像自然语言而非 JSON
                // DeepSeek V4 可能在 tool_call 中输出中文自然语言（如"无全局 Error Boundary"）
                if (!acc.garbageDetected && acc.arguments.length >= 20) {
                  const trimmed = acc.arguments.trimStart();
                  const isJsonLike = trimmed.length === 0
                    || trimmed[0] === '{'
                    || trimmed[0] === '['
                    || trimmed[0] === '"'
                    || trimmed[0] === '-' && /\d/.test(trimmed[1] || '')
                    || /\d/.test(trimmed[0]);
                  if (!isJsonLike) {
                    acc.garbageDetected = true;
                    this.log.warn(`ToolCall[${idx}] arguments 检测到自然语言而非 JSON，重定向为文本输出: "${acc.arguments.slice(0, 100)}"`);
                    // 将已累积的垃圾内容作为文本输出
                    yield { type: 'text_delta', text: acc.arguments };
                  }
                }

                if (acc.garbageDetected) {
                  // 继续将后续 arguments 作为文本输出
                  yield { type: 'text_delta', text: tc.function.arguments };
                } else {
                  yield { type: 'tool_use_delta', text: tc.function.arguments };
                }
              }
            }
          }

          // 结束原因
          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
            receivedEnd = true;

            // 正常结束时：发出所有已累积的工具调用并标记为 emitted
            // 防止后面的"流中断恢复"逻辑重复 emit
            if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
              for (const [, acc] of toolCallAccumulator) {
                if (acc.emitted) continue;
                acc.emitted = true;
                let input: Record<string, unknown> = {};
                if (acc.garbageDetected) {
                  // 模型幻觉：arguments 是自然语言，不是合法 JSON
                  input = {
                    _hallucinated: true,
                    _raw_text: acc.arguments?.substring(0, 500) ?? '',
                  };
                } else {
                  try {
                    input = JSON.parse(acc.arguments || '{}');
                  } catch {
                    input = {
                      _parse_error: true,
                      _raw_input: acc.arguments?.substring(0, 500) ?? '',
                      _error_message: `工具参数 JSON 解析失败（已接收 ${acc.arguments?.length ?? 0} 字符），可能是流传输被截断`,
                    };
                  }
                }
                yield {
                  type: 'tool_use_end',
                  toolCall: { id: acc.id, name: acc.name, input },
                };
              }
            }
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

      // 流中断恢复：发出尚未 emit 的工具调用（即使参数不完整）
      for (const [, acc] of toolCallAccumulator) {
        if (acc.emitted) continue; // 跳过已发出的
        acc.emitted = true;
        let input: Record<string, unknown> = {};
        if (acc.garbageDetected) {
          input = {
            _hallucinated: true,
            _raw_text: acc.arguments?.substring(0, 500) ?? '',
          };
        } else {
          try {
            input = JSON.parse(acc.arguments || '{}');
          } catch {
            input = {
              _parse_error: true,
              _raw_input: acc.arguments?.substring(0, 500) ?? '',
              _error_message: `工具参数 JSON 解析失败（已接收 ${acc.arguments?.length ?? 0} 字符），可能是流传输被截断`,
            };
          }
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
      const hasToolCalls = toolCallAccumulator.size > 0;
      const stopReason: StopReason = (finishReason === 'tool_calls' || hasToolCalls) ? 'tool_use'
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

      // 记录原始错误详情（SDK 错误对象包含 status、error body、code、param、type 等）
      const errAny = err as any;
      this.log.error(`API 调用失败: status=${errAny?.status}, code=${errAny?.code}, param=${errAny?.param}, type=${errAny?.type}`);
      if (errAny?.error) {
        this.log.error(`API 原始错误体: ${JSON.stringify(errAny.error)}`);
      }

      // 增强错误信息
      if (errorMessage.includes('status code') || errorMessage.includes('Bad Request') || errorMessage.includes('400')) {
        // 详细诊断日志：记录每条消息的 reasoning_content 状态
        const msgDiag = openaiMessages.map((m, i) => {
          const msg = m as Record<string, unknown>;
          const hasReasoning = !!(msg as any).reasoning_content;
          const reasoningLen = typeof (msg as any).reasoning_content === 'string' ? (msg as any).reasoning_content.length : 0;
          const hasToolCalls = !!(msg as any).tool_calls;
          const contentLen = typeof msg.content === 'string' ? msg.content.length : (msg.content ? JSON.stringify(msg.content).length : 0);
          return `[${i}] role=${msg.role} contentLen=${contentLen} hasToolCalls=${hasToolCalls} hasReasoning=${hasReasoning} reasoningLen=${reasoningLen}`;
        });
        this.log.error(`400 错误消息诊断 (共 ${openaiMessages.length} 条):\n${msgDiag.join('\n')}`);

        // 诊断：检查 reasoning_content 缺失情况
        if (config.thinking) {
          const assistantMsgs = openaiMessages
            .map((m, i) => ({ msg: m as any, idx: i }))
            .filter(({ msg }) => msg.role === 'assistant');
          const withReasoning = assistantMsgs.filter(({ msg }) => !!msg.reasoning_content);
          const withoutReasoning = assistantMsgs.filter(({ msg }) => !msg.reasoning_content);
          this.log.error(`reasoning_content 诊断: ${assistantMsgs.length} 条 assistant 消息, ${withReasoning.length} 条有 reasoning_content, ${withoutReasoning.length} 条缺失`);
          if (withoutReasoning.length > 0) {
            this.log.error(`缺失 reasoning_content 的 assistant 消息索引: ${withoutReasoning.map(m => m.idx).join(', ')}`);
          }
          if (withReasoning.length > 0) {
            this.log.error(`有 reasoning_content 的 assistant 消息索引: ${withReasoning.map(m => m.idx).join(', ')}`);
          }
        }

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

      const wrappedError = new Error(errorMessage);
      if (err instanceof Error) {
        wrappedError.name = err.name;
        if ('status' in err) (wrappedError as any).status = (err as any).status;
        if ('code' in err) (wrappedError as any).code = (err as any).code;
      }
      throw wrappedError;
    }
  }

  /**
   * 检测 API 错误信息是否被嵌入到流式响应文本中
   *
   * 某些 OpenAI 兼容 API（如 DeepSeek）在遇到错误时可能返回 200 OK，
   * 但将错误信息嵌入在 SSE 流中的第一个 text delta 里。
   */
  private detectInlineApiError(text: string): string | null {
    if (text.includes('reasoning_content') && text.includes('thinking mode')) {
      return `DeepSeek API 错误：reasoning_content 未正确回传。原始响应: ${text.slice(0, 200)}`;
    }

    const statusMatch = text.match(/^(\d{3})\s/);
    if (statusMatch) {
      const code = parseInt(statusMatch[1], 10);
      if (code >= 400) {
        return `API 返回错误 (${code}): ${text.slice(0, 300)}`;
      }
    }

    if (/^(error|Error|ERROR)[\s:]+/.test(text)) {
      return `API 返回错误: ${text.slice(0, 300)}`;
    }

    return null;
  }
}
