// ============================================================
// M7 LLM Provider — Anthropic Claude 适配器
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import type { Message, ToolSchema, ProviderConfig, StreamEvent, TokenUsage, ContentBlock } from '@/core/types';
import { BaseLLMProvider } from './LLMProvider';
import { logger } from '@/core/logger';

/** Anthropic Messages API 支持的图片 MIME 类型 */
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** 检测 API 错误是否为 image 不支持（纯文本模型会拒绝 image 块） */
function isVisionRejectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /image_url|image input|do not support image|unknown variant.*image/i.test(msg);
}

/**
 * Anthropic Claude Provider
 */
export class AnthropicProvider extends BaseLLMProvider {
  readonly name = 'anthropic';
  readonly models = ['claude-'];
  private log = logger.child({ module: 'AnthropicProvider' });

  private getClient(config: ProviderConfig): Anthropic {
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new Error('Anthropic Provider: API Key 未配置');
    }

    const timeout = config.timeout ?? 600_000;

    // 检测是否使用第三方代理服务
    const isThirdPartyProxy = config.baseURL &&
      !config.baseURL.includes('api.anthropic.com') &&
      !config.baseURL.includes('bedrock');

    // 为第三方代理服务创建兼容的 fetch 函数
    // 某些代理服务会拒绝 Anthropic SDK 的默认 User-Agent
    const customFetch: typeof fetch | undefined = isThirdPartyProxy
      ? async (url, init) => {
          const headers = new Headers(init?.headers);

          // 移除可能导致代理服务拒绝的 User-Agent
          headers.delete('user-agent');
          headers.delete('User-Agent');

          // 确保 anthropic-version 头存在
          if (!headers.has('anthropic-version')) {
            headers.set('anthropic-version', '2023-06-01');
          }

          return fetch(url, {
            ...init,
            headers,
          });
        }
      : undefined;

    return new Anthropic({
      apiKey: config.apiKey,
      authToken: config.apiKey, // 同时设 authToken，防止环境变量 ANTHROPIC_AUTH_TOKEN 覆盖
      baseURL: config.baseURL,
      timeout,
      ...(customFetch ? { fetch: customFetch } : {}),
    });
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
        return;
      } catch (err) {
        // Vision 降级重试：非 vision 模型拒绝 image → 转为 [Image: ...] 文本重试
        if (attempt === 0 && !forceTextOnly && isVisionRejectionError(err)) {
          this.log.info(`检测到 ${config.model} 不支持 image，已将图片降级为文本描述并重试`);
          forceTextOnly = true;
          continue;
        }
        throw err;
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
    // 图片块转为 Anthropic source 格式，forceTextOnly 时全部降级为文本
    const convertAnthropicContent = (content: Message['content']) => {
      if (typeof content === 'string') return content;
      if (!Array.isArray(content)) return content;
      return content.map((block: ContentBlock) => {
        if (block.type === 'image') {
          if (!forceTextOnly && SUPPORTED_IMAGE_TYPES.has(block.mimeType || '')) {
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: block.mimeType || 'image/png',
                data: block.data || '',
              },
            };
          }
          return { type: 'text' as const, text: `[Image: ${block.name || block.mimeType || 'image'}]` };
        }
        if (block.type === 'audio') {
          return { type: 'text' as const, text: `[Audio file: ${block.name || 'audio'}]` };
        }
        if (block.type === 'video') {
          return { type: 'text' as const, text: `[Video file: ${block.name || 'video'}]` };
        }
        if (block.type === 'reasoning') {
          return {
            type: 'thinking' as const,
            thinking: (block as any).reasoning || '',
            ...((block as any).signature ? { signature: (block as any).signature } : {}),
          };
        }
        return block as any;
      });
    };

    const client = this.getClient(config);

    // 分离 system prompt 和普通消息
    const systemMessages = messages.filter((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    // 构建 system prompt blocks（支持 Prompt Caching）
    // MessageManager 输出结构化 ContentBlock[]，区分稳定基础部分和动态后缀
    const systemBlocks = this.buildSystemBlocks(systemMessages);

    // 构造 Anthropic API 请求参数
    const params = {
      model: config.model,
      max_tokens: config.maxTokens ?? 8192,
      stream: true,
      messages: chatMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        // Anthropic API 原生支持 content 为 string 或 ContentBlock[]
        // 图片 ContentBlock 需转为 Anthropic 的 {type:'image', source:{...}} 格式
        content: convertAnthropicContent(m.content),
      })),
      ...(systemBlocks.length > 0 ? { system: systemBlocks } : {}),
      ...(tools.length > 0 ? {
        tools: tools.map((t, index) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
          // 🆕 Phase 1 优化：只在最后一个工具上标记缓存（工具列表作为整体缓存）
          // Anthropic 支持最多 4 个缓存断点，工具 + system 共用
          // ⚠️ 重要：不能给每个工具都标记缓存，会导致缓存断点数超限 → API 429 错误
          ...(index === tools.length - 1 ? {
            cache_control: { type: 'ephemeral' as const },
          } : {}),
        })),
      } : {}),
      // ❌ Extended Thinking 模式下不支持 temperature 参数（必须为 1）
      // 当启用 thinking 时，不传 temperature 参数
      ...(config.temperature !== undefined && !config.thinking ? { temperature: config.temperature } : {}),
    };

    // 🆕 P0 优化：Extended Thinking 支持
    // adaptive 模式：直连 Anthropic 官方 API 时透传；经代理/Bedrock 时降级为 enabled
    // Bedrock 只支持 'disabled' | 'enabled'，不支持 'adaptive'
    // budget_tokens 自动计算：取 adjustedMaxTokens 的 30%，平衡思考深度和输出空间
    if (config.thinking) {
      const isDirectAnthropic = !config.baseURL
        || config.baseURL.includes('api.anthropic.com');

      // 自动计算 budget_tokens：显式配置优先，否则取 max_tokens 的 30%
      const autoBudget = config.maxTokens ? Math.floor(config.maxTokens * 0.3) : 1024;
      const budgetTokens = config.thinking.budgetTokens ?? autoBudget;

      (params as any).thinking = (config.thinking.type === 'adaptive' && isDirectAnthropic)
        ? { type: 'adaptive', effort: config.thinking.effort ?? 'medium' }
        : { type: 'enabled', budget_tokens: budgetTokens };

      this.log.debug(`Thinking 参数: ${JSON.stringify((params as any).thinking)}, isDirectAnthropic: ${isDirectAnthropic}, baseURL: ${config.baseURL}`);
    } else {
      this.log.debug('config.thinking 未配置');
    }

    // 调试日志：统计缓存断点数量
    let cacheBreakpoints = 0;
    if (Array.isArray(params.system)) {
      cacheBreakpoints += params.system.filter((b: any) => b.cache_control).length;
    }
    if (params.tools) {
      cacheBreakpoints += (params.tools as any[]).filter((t: any) => t.cache_control).length;
    }
    this.log.debug(`Request: model=${params.model}, max_tokens=${(params as any).max_tokens ?? '未设置'}, messages=${chatMessages.length}, tools=${tools.length}, cache_breakpoints=${cacheBreakpoints}`);

    // 🆕 打印完整请求体用于调试
    // 设置环境变量 DEBUG_FULL_REQUEST=1 可以查看完整请求体（包括 prompt 内容）
    if (process.env.DEBUG_FULL_REQUEST === '1') {
      this.log.debug('=== 完整请求体 ===');
      this.log.debug(JSON.stringify({
        model: params.model,
        max_tokens: (params as any).max_tokens,
        stream: params.stream,
        temperature: params.temperature,
        thinking: (params as any).thinking,
        system: params.system,
        messages: chatMessages.map(m => ({
          role: m.role,
          content: m.content
        })),
        tools: params.tools?.map(t => ({
          name: (t as any).name,
          description: (t as any).description,
          cache_control: (t as any).cache_control
        }))
      }, null, 2));
      this.log.debug('=== 请求体结束 ===');
    }

    // 打印请求结构摘要
    this.log.debug(`Request structure: {
  model: "${params.model}",
  max_tokens: ${(params as any).max_tokens ?? '未设置'},
  stream: ${params.stream},
  system: ${Array.isArray(params.system) ? `[${params.system.length} blocks]` : 'undefined'},
  messages: ${JSON.stringify(chatMessages.map(m => ({
    role: m.role,
    contentType: typeof m.content,
    contentLength: typeof m.content === 'string' ? m.content.length : (m.content as any[])?.length
  })))},
  tools: ${params.tools ? `[${(params.tools as any[]).length} tools]` : 'undefined'},
  temperature: ${params.temperature ?? 'undefined'}
}`);

    try {
      // 🔧 支持 AbortSignal：传递给 Anthropic SDK
      const stream = client.messages.stream(params as any, {
        signal: config.signal,
      });

      // 当前 tool_use 块 JSON 累积
      let currentToolId: string | undefined;
      let currentToolName: string | undefined;
      let currentToolInput = '';
      let receivedEnd = false;
      let eventCount = 0;
      const eventTypeCounts: Record<string, number> = {};

      try {
        for await (const event of stream) {
          eventCount++;
          eventTypeCounts[event.type] = (eventTypeCounts[event.type] ?? 0) + 1;
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
              } else if (block.type === 'thinking') {
                yield {
                  type: 'thinking_start',
                  signature: block.signature,
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
                  // JSON 解析失败：将截断的原始 JSON 作为错误信息传递，而非静默吞掉
                  input = {
                    _parse_error: true,
                    _raw_input: currentToolInput?.substring(0, 500) ?? '',
                    _error_message: `工具参数 JSON 解析失败（已接收 ${currentToolInput?.length ?? 0} 字符），可能是流传输被截断`,
                  };
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
              const stopReason = event.delta.stop_reason === 'tool_use' ? 'tool_use' :
                            event.delta.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn';

              // 调试日志：流结束摘要
              this.log.debug(`Stream end: stop_reason=${event.delta.stop_reason}, mapped=${stopReason}, output_tokens=${event.usage?.output_tokens ?? 'N/A'}, totalEvents=${eventCount}, eventTypes=${JSON.stringify(eventTypeCounts)}, hasOpenToolUse=${!!(currentToolId && currentToolName)}, toolInputSize=${currentToolInput?.length ?? 0}`);

              receivedEnd = true;

              // max_tokens 截断：如果有未完成的 tool_use 块，将其作为截断的工具调用 yield 出去
              if (stopReason === 'max_tokens' && currentToolId && currentToolName) {
                yield {
                  type: 'tool_use_end',
                  toolCall: {
                    id: currentToolId,
                    name: currentToolName,
                    input: {
                      _truncated: true,
                      _raw_input: currentToolInput?.substring(0, 500) ?? '',
                      _error_message: `输出 token 达到上限 (max_tokens)，工具 "${currentToolName}" 的参数被截断（已接收 ${currentToolInput?.length ?? 0} 字符）`,
                    },
                  },
                };
                currentToolId = undefined;
                currentToolName = undefined;
                currentToolInput = '';
              }

              const usage: TokenUsage = {
                input: 0,
                output: event.usage?.output_tokens ?? 0,
              };
              yield {
                type: 'end',
                stopReason,
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
      } catch (streamErr) {
        if (streamErr instanceof Error && (
          streamErr.name === 'AbortError' ||
          streamErr.name === 'APIUserAbortError' ||
          streamErr.message.includes('aborted')
        )) {
          // 超时或用户中止 — 走恢复逻辑
          this.log.warn(`Stream aborted: ${streamErr.message}`);
        } else {
          // 网络错误等 — 重新抛出触发重试
          throw streamErr;
        }
      }

      // 流提前结束的恢复处理（静默 EOF：代理层断开但无 error 事件）
      if (!receivedEnd) {
        this.log.warn(`Stream ended without message_delta event. totalEvents=${eventCount}, eventTypes=${JSON.stringify(eventTypeCounts)}, hasOpenToolUse=${!!(currentToolId && currentToolName)}, toolInputSize=${currentToolInput?.length ?? 0}`);

        // 如果有未完成的工具调用，合成截断错误事件
        if (currentToolId && currentToolName) {
          yield {
            type: 'tool_use_end',
            toolCall: {
              id: currentToolId,
              name: currentToolName,
              input: {
                _truncated: true,
                _raw_input: currentToolInput?.substring(0, 500) ?? '',
                _error_message: `流传输中断：工具 "${currentToolName}" 的参数在接收 ${currentToolInput?.length ?? 0} 字符后被截断（代理层连接提前关闭）`,
              },
            },
          };
          currentToolId = undefined;
          currentToolName = undefined;
          currentToolInput = '';
        }

        // 合成 end 事件，标记为 interrupted 表示流传输中断（非正常 max_tokens）
        yield {
          type: 'end',
          stopReason: 'interrupted',
          usage: { input: 0, output: 0 },
        };
      }
    } catch (err) {
      // 调试日志：捕获到异常
      this.log.error(`Stream error: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof Error && err.stack) {
        this.log.debug(`Stack: ${err.stack.split('\n').slice(0, 5).join('\n')}`);
      }

      // 捕获并增强错误信息
      let errorMessage = err instanceof Error ? err.message : String(err);

      // 🆕 超时错误特殊处理
      const isTimeout = errorMessage.includes('timeout') ||
                       errorMessage.includes('aborted') ||
                       errorMessage.includes('ETIMEDOUT');

      if (isTimeout) {
        errorMessage = `⏱️  请求超时 (${Math.round((config.timeout ?? 600_000) / 1000)}s)\n\n` +
          `可能原因:\n` +
          `1. 网络连接不稳定\n` +
          `2. LLM 响应时间过长（Extended Thinking 模式下可能需要更长时间）\n` +
          `3. 代理服务超时（如使用中转 API）\n\n` +
          `建议:\n` +
          `- 在配置文件中增加 timeout 值（当前: ${config.timeout ?? 600_000}ms）\n` +
          `- 检查网络连接和代理设置\n` +
          `- 减少 Extended Thinking 的 budget_tokens\n\n` +
          `原始错误: ${errorMessage}`;
      } else if (errorMessage.includes('status code') || errorMessage.includes('authentication') || errorMessage.includes('APIError')) {
        errorMessage += `\n\n调试信息:\n` +
          `- Provider: anthropic\n` +
          `- 模型: ${config.model}\n` +
          `- Base URL: ${config.baseURL || 'https://api.anthropic.com'}\n` +
          `- 消息数: ${messages.length}\n` +
          `- 工具数: ${tools.length}\n\n` +
          `常见原因:\n` +
          `1. API Key 无效或过期\n` +
          `2. 模型名称错误（请检查 config.json 中的 model 字段）\n` +
          `3. baseURL 配置错误（如使用代理服务）\n` +
          `4. API 服务暂时不可用（请稍后重试）`;
      }

      // 保留原始错误的 name/status/code 属性，确保 RetryPolicy 能正确判断是否重试
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
   * 构建 Anthropic system prompt blocks（支持 Prompt Caching）
   *
   * 缓存策略：
   * - 当 system content 为 ContentBlock[]（结构化模式）时：
   *   在第一个 block（基础 system prompt，跨轮次稳定）上设置缓存断点，
   *   后续 blocks（memory/reminder 等动态内容）不标记缓存。
   *   这样基础 prompt 前缀匹配率更高，缓存命中率更好。
   *
   * - 当 system content 为 string（兼容模式）时：
   *   整个字符串作为一个 block 标记缓存。
   *
   * Anthropic 的 ephemeral 缓存有效期 5 分钟，按前缀匹配。
   * 最多支持 4 个缓存断点，按 LIFO 顺序匹配。
   */
  private buildSystemBlocks(
    systemMessages: Message[],
  ): Anthropic.TextBlockParam[] {
    const blocks: Anthropic.TextBlockParam[] = [];

    for (const msg of systemMessages) {
      if (typeof msg.content === 'string') {
        // 兼容纯字符串模式：整体标记缓存
        if (msg.content) {
          blocks.push({
            type: 'text',
            text: msg.content,
            cache_control: { type: 'ephemeral' },
          });
        }
      } else if (Array.isArray(msg.content)) {
        // 结构化模式：所有非最后一个 block 标记缓存（Phase 1 优化）
        // 最后一个 block 不缓存（可能是动态后缀，如 memory/reminder）
        const textBlocks = msg.content.filter(
          (b) => b.type === 'text' && b.text,
        );
        for (let i = 0; i < textBlocks.length; i++) {
          const isLast = i === textBlocks.length - 1;
          blocks.push({
            type: 'text',
            text: textBlocks[i].text!,
            // 🆕 优化：所有非最后一个 block 都标记缓存
            ...(!isLast ? { cache_control: { type: 'ephemeral' } } : {}),
          });
        }
      }
    }

    return blocks;
  }

}
