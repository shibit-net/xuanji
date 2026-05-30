// ============================================================
// M7 LLM Provider — OpenAI GPT 适配器
// ============================================================

import OpenAI from 'openai';
import type { Message, ContentBlock, ToolSchema, ProviderConfig, StreamEvent, TokenUsage, StopReason } from '@/core/types';
import { BaseLLMProvider } from './LLMProvider';
import { logger } from '@/core/logger';

/** OpenAI Chat Completions API 支持的图片 MIME 类型 */
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** 检测 API 错误是否为 image_url 不支持（DeepSeek 等纯文本模型会拒绝 image_url 块） */
function isVisionRejectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /image_url|unknown variant.*image/i.test(msg);
}

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
  private convertMessage(msg: Message, forceTextOnly = false): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
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
    const imageBlocks: ContentBlock[] = [];
    const audioBlocks: ContentBlock[] = [];
    const videoBlocks: ContentBlock[] = [];

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
        case 'image':
          imageBlocks.push(block);
          break;
        case 'audio':
          audioBlocks.push(block);
          break;
        case 'video':
          videoBlocks.push(block);
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
    if (toolUseBlocks.length === 0 && (combinedText.trim() || reasoningText || imageBlocks.length > 0)) {
      const textMsg: any = {
        role: msg.role as 'user' | 'assistant',
      };
      if (reasoningText) {
        textMsg.reasoning_content = reasoningText;
      }
      // 用户消息含图片时，构造 OpenAI vision 多模态 content 数组
      // Note: OpenAI Chat Completions does not natively support audio/video input,
      // so audio/video blocks are included as text descriptions.
      if (msg.role === 'user' && (imageBlocks.length > 0 || audioBlocks.length > 0 || videoBlocks.length > 0)) {
        const parts: any[] = [];
        if (combinedText.trim()) {
          parts.push({ type: 'text', text: combinedText.trim() });
        }
        for (const img of imageBlocks) {
          if (!forceTextOnly && SUPPORTED_IMAGE_TYPES.has(img.mimeType || '')) {
            parts.push({
              type: 'image_url',
              image_url: {
                url: `data:${img.mimeType || 'image/png'};base64,${img.data || ''}`,
              },
            });
          } else {
            parts.push({ type: 'text', text: `[Image: ${img.name || img.mimeType || 'image'}]` });
          }
        }
        for (const aud of audioBlocks) {
          parts.push({ type: 'text', text: `[Audio file: ${aud.name || 'audio'}]` });
        }
        for (const vid of videoBlocks) {
          parts.push({ type: 'text', text: `[Video file: ${vid.name || 'video'}]` });
        }
        textMsg.content = parts;
      } else {
        textMsg.content = combinedText.trim() || '';
      }
      result.push(textMsg);
    }

    return result;
  }

  /**
   * 构建 OpenAI 消息数组（提取为方法以便 vision 降级重试）
   */
  private buildMessages(
    messages: Message[],
    forceTextOnly: boolean,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

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

    const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (systemText) {
      result.push({ role: 'system', content: systemText });
    }
    for (const msg of chatMessages) {
      result.push(...this.convertMessage(msg, forceTextOnly));
    }
    return result;
  }

  async *stream(
    messages: Message[],
    tools: ToolSchema[],
    config: ProviderConfig,
  ): AsyncIterable<StreamEvent> {
    let forceTextOnly = false;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        yield* this.doStream(messages, tools, config, forceTextOnly);
        return; // 成功，退出重试循环
      } catch (err) {
        // Vision 降级重试：非 vision 模型（如 DeepSeek）拒绝 image_url → 转为 [Image: ...] 文本重试
        if (attempt === 0 && !forceTextOnly && isVisionRejectionError(err)) {
          this.log.info(`检测到 ${config.model} 不支持 image_url，已将图片降级为文本描述并重试`);
          forceTextOnly = true;
          continue;
        }
        // 最终失败：增强错误信息
        throw this.enhanceStreamError(err, config, messages);
      }
    }
  }

  /**
   * 执行一次流式 API 调用（不含重试逻辑）
   */
  private async *doStream(
    messages: Message[],
    tools: ToolSchema[],
    config: ProviderConfig,
    forceTextOnly: boolean,
  ): AsyncIterable<StreamEvent> {
    const client = this.getClient(config);
    let openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
      // 构建消息（首次 forceTextOnly=false，失败降级后重试）
      openaiMessages = this.buildMessages(messages, forceTextOnly);

      // 校验 tool_calls/tool 配对，剔除无法匹配的 tool_calls
      // DeepSeek 等 API 严格要求每个 assistant(tool_calls) 的所有 tool_call_id 都有对应的 tool 消息
      this.validateToolPairing(openaiMessages);

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
      this.log.info(`Request: model=${requestParams.model}, messages=${openaiMessages.length}, tools=${openaiTools?.length ?? 0}`);
      this.log.info(`Messages: ${JSON.stringify(openaiMessages.map(m => {
        const msg = m as unknown as Record<string, unknown>;
        return {
          role: msg.role,
          hasContent: !!msg.content,
          hasToolCalls: !!(msg as any).tool_calls,
          hasReasoning: !!(msg as any).reasoning_content,
          reasoningLen: typeof (msg as any).reasoning_content === 'string' ? (msg as any).reasoning_content.length : 0,
        };
      }))}`);
      // 完整消息体日志（每条消息的 content 前 200 字符、reasoning_content 前 100 字符、tool_calls 名称列表）
      // 用于排查 "Empty input messages" 等 400 错误
      this.log.debug(`requestBody: ${JSON.stringify({
        model: requestParams.model,
        messageCount: openaiMessages.length,
        messages: openaiMessages.map((m, i) => {
          const msg = m as unknown as Record<string, unknown>;
          const content = typeof msg.content === 'string' ? msg.content.substring(0, 200) : (msg.content ? '<content_blocks>' : 'null');
          const reasoning = (msg as any).reasoning_content;
          const reasoningPreview = typeof reasoning === 'string' ? reasoning.substring(0, 100) : (reasoning !== undefined ? '<non-string>' : 'undefined');
          const toolCalls = (msg as any).tool_calls;
          const toolCallInfo = Array.isArray(toolCalls) ? toolCalls.map((tc: any) => ({
            id: tc.id, name: tc.function?.name, argsLen: (tc.function?.arguments || '').length
          })) : undefined;
          return { role: msg.role, content, reasoning: reasoningPreview, toolCalls: toolCallInfo };
        }),
        toolCount: openaiTools?.length ?? 0,
        thinking: requestParams.thinking ? true : false,
      }, null, 2)}`);
      // 诊断 + 自动修复：DeepSeek V4 reasoning_content 400 错误防护
      // 不依赖 config.thinking：DeepSeek V4 可能在未显式配置时也返回 reasoning_content
      {

        const assistantMsgs = openaiMessages.filter(m => m.role === 'assistant');
        const withReasoning = assistantMsgs.filter(m => !!(m as any).reasoning_content);
        const withoutReasoning = assistantMsgs.filter(m => !(m as any).reasoning_content);

        if (withoutReasoning.length > 0) {
          if (withReasoning.length > 0) {
            // 混合状态：部分 assistant 消息有 reasoning_content，部分缺失。
            // DeepSeek V4 要求所有 assistant 消息要么都有 reasoning_content，要么都没有。
            // 给缺失的补上空字符串，而不是剥离已有的。
            openaiMessages.forEach((m) => {
              if (m.role === 'assistant' && !(m as any).reasoning_content) {
                (m as any).reasoning_content = '';
              }
            });
            this.log.warn(
              `DeepSeek V4 reasoning_content 混合状态：${withReasoning.length} 条有 reasoning、${withoutReasoning.length} 条缺失，已补全`
            );
          } else if (config.thinking) {
            // 所有 assistant 消息缺少 reasoning_content 但 thinking 已启用 → 禁用 thinking
            delete (requestParams as any).thinking;
            this.log.warn(
              `DeepSeek V4: thinking 启用但 ${withoutReasoning.length} 条 assistant 消息全部缺少 reasoning_content，` +
              `已禁用 thinking mode`
            );
          }
        } else if (withReasoning.length > 0 && !config.thinking) {
          // thinking 未启用但消息中有 reasoning_content（DeepSeek V4 默认行为）
          // 不剥离 reasoning_content：DeepSeek V4 即使未显式配置 thinking，
          // 也可能默认返回 reasoning_content，下一轮必须回传否则 400 错误
          this.log.info(
            `DeepSeek V4: thinking 未启用但 ${withReasoning.length} 条 assistant 消息含 reasoning_content，保留以兼容 API 要求`
          );
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
            // 调试日志：输出每个 chunk 的关键信息 — 太多了，改为注释
            // this.log.debug(`Chunk#${chunkCount}: finish_reason=${choice.finish_reason}, hasToolCalls=${!!delta?.tool_calls}, toolCalls=${JSON.stringify(delta?.tool_calls)}`);
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
            const signature = (delta as any)?.signature
              || (choice as any)?.message?.signature
              || (chunk as any)?.signature;
            // 这个日志太频繁了，注释掉
            // this.log.debug(`Captured reasoning_content (${typeof reasoningDelta === 'string' ? reasoningDelta.length + ' chars' : typeof reasoningDelta})`);
            yield {
              type: 'reasoning_delta',
              reasoning: typeof reasoningDelta === 'string' ? reasoningDelta : JSON.stringify(reasoningDelta),
              ...(signature ? { signature } : {}),
            };
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
  }

  /**
   * 增强 API 错误信息（诊断 + 中文提示）
   */
  private enhanceStreamError(err: unknown, config: ProviderConfig, messages: Message[]): Error {
    const errorDetails = {
      provider: 'openai',
      model: config.model,
      baseURL: config.baseURL,
      messageCount: messages.length,
    };

    let errorMessage = err instanceof Error ? err.message : String(err);
    const errAny = err as any;
    const isApiError = errAny?.status !== undefined || errAny?.code !== undefined || errAny?.type !== undefined;

    if (isApiError) {
      this.log.error(`API 调用失败: status=${errAny?.status}, code=${errAny?.code}, param=${errAny?.param}, type=${errAny?.type}`);
    } else {
      this.log.error(`API 调用失败 (网络错误): ${errorMessage}`);
    }

    if (isApiError && (errorMessage.includes('status code') || errorMessage.includes('Bad Request') || errorMessage.includes('400'))) {
      errorMessage += `\n\n调试信息:\n` +
        `- Provider: ${errorDetails.provider}\n` +
        `- 模型: ${errorDetails.model}\n` +
        `- Base URL: ${errorDetails.baseURL || 'https://api.openai.com/v1'}\n` +
        `- 消息数: ${errorDetails.messageCount}\n` +
        `\n常见原因:\n` +
        `1. API Key 无效或过期\n` +
        `2. 模型名称错误（请检查 agent 配置文件的 model 字段）\n` +
        `3. baseURL 配置错误（如使用代理服务）\n` +
        `4. API 服务暂时不可用（请稍后重试）`;
    } else if (!isApiError) {
      errorMessage += `\n\n网络连接失败:\n` +
        `- 模型: ${errorDetails.model}\n` +
        `- Base URL: ${errorDetails.baseURL || 'https://api.openai.com/v1'}\n` +
        `- 消息数: ${errorDetails.messageCount}\n` +
        `\n可能原因:\n` +
        `1. 网络连接不可用（请检查网络）\n` +
        `2. Base URL 无法访问（${errorDetails.baseURL || 'API 地址'}）\n` +
        `3. 代理/VPN 配置问题\n` +
        `4. API 服务端不可用或超时`;
    }

    const wrappedError = new Error(errorMessage);
    if (err instanceof Error) {
      wrappedError.name = err.name;
      if ('status' in err) (wrappedError as any).status = (err as any).status;
      if ('code' in err) (wrappedError as any).code = (err as any).code;
    }
    return wrappedError;
  }

  /**
   * 检测 API 错误信息是否被嵌入到流式响应文本中
   *
   * 某些 OpenAI 兼容 API（如 DeepSeek）在遇到错误时可能返回 200 OK，
   * 但将错误信息嵌入在 SSE 流中的第一个 text delta 里。
   */
  /**
   * 校验并修复 OpenAI 消息数组中的 tool_calls/tool 配对。
   *
   * DeepSeek API 严格要求：每个 assistant(tool_calls) 的所有 tool_call_id
   * 必须有对应的 tool 消息响应，且这些 tool 消息必须在下一个 assistant 消息之前。
   * 不满足要求的 tool_calls 会被剔除，防止 400 错误。
   */
  private validateToolPairing(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): void {
    // Pass 1: 收集所有有效 (assistant, tool_call_id) 配对
    const validToolCallIds = new Set<string>();
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] as unknown as Record<string, unknown>;
      if (msg.role !== 'assistant') continue;

      const toolCalls = (msg as any).tool_calls;
      if (!Array.isArray(toolCalls) || toolCalls.length === 0) continue;

      const requiredIds: string[] = toolCalls.map((tc: any) => tc.id);
      const satisfiedIds = new Set<string>();

      for (let j = i + 1; j < messages.length; j++) {
        const next = messages[j] as unknown as Record<string, unknown>;
        if (next.role === 'assistant') break;
        if (next.role === 'tool' && typeof next.tool_call_id === 'string') {
          satisfiedIds.add(next.tool_call_id);
        }
      }

      // 剔除 assistant 中无对应 tool 消息的 tool_calls
      const unmatched = requiredIds.filter(id => !satisfiedIds.has(id));
      if (unmatched.length > 0) {
        this.log.warn(
          `tool_calls/tool 配对校验：索引 [${i}] 的 assistant 消息中 tool_call_id ` +
          `${unmatched.join(', ')} 缺少对应 tool 消息，已剔除`
        );
        (msg as any).tool_calls = toolCalls.filter((tc: any) => !unmatched.includes(tc.id));
        if ((msg as any).tool_calls.length === 0) {
          delete (msg as any).tool_calls;
          if (msg.content === null || msg.content === undefined) {
            msg.content = '';
          }
        }
      }

      // 收集通过校验的 tool_call_ids
      for (const id of satisfiedIds) {
        validToolCallIds.add(id);
      }
    }

    // Pass 2: 删除孤儿 tool 消息（不存在于任何 assistant tool_calls 中的 tool_call_id）
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as unknown as Record<string, unknown>;
      if (msg.role !== 'tool') continue;
      const toolCallId = (msg as any).tool_call_id as string | undefined;
      if (toolCallId && !validToolCallIds.has(toolCallId)) {
        this.log.warn(
          `tool_calls/tool 配对校验：索引 [${i}] 的 tool 消息中 tool_call_id ` +
          `${toolCallId} 无前置 assistant(tool_calls)，已剔除`
        );
        messages.splice(i, 1);
      }
    }
  }

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
