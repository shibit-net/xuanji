// ============================================================
// M7 LLM Provider — Anthropic Claude 适配器
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import type { Message, ToolSchema, ProviderConfig, StreamEvent, TokenUsage } from '@/core/types';
import { BaseLLMProvider } from './LLMProvider';
import { logger } from '@/core/logger';

/**
 * Anthropic Claude Provider
 */
export class AnthropicProvider extends BaseLLMProvider {
  readonly name = 'anthropic';
  readonly models = ['claude-'];
  private log = logger.child({ module: 'AnthropicProvider' });

  private getClient(config: ProviderConfig): Anthropic {
    // 显式检查 API Key，不依赖 SDK 的环境变量回退
    if (!config.apiKey || config.apiKey.trim() === '') {
      throw new Error(
        '未配置 API Key。请通过以下方式之一设置：\n' +
        '1. 环境变量: export XUANJI_API_KEY="your-key"\n' +
        '2. 全局配置: 编辑 ~/.xuanji/config.json\n' +
        '3. 项目配置: 编辑 .xuanji/config.json',
      );
    }

    return new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeout ?? 600_000,
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

    // 构建 system prompt blocks（支持 Prompt Caching）
    // MessageManager 输出结构化 ContentBlock[]，区分稳定基础部分和动态后缀
    const systemBlocks = this.buildSystemBlocks(systemMessages);

    // 🆕 动态计算 max_tokens：基于输入内容和模型限制
    const estimatedInputTokens = this.estimateInputTokens(systemBlocks, chatMessages, tools);
    const adjustedMaxTokens = this.calculateMaxTokens(config.model, config.maxTokens || 65536, estimatedInputTokens);

    // 构造 Anthropic API 请求参数
    const params: Anthropic.MessageCreateParamsStreaming = {
      model: config.model,
      max_tokens: adjustedMaxTokens,
      stream: true,
      messages: chatMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        // Anthropic API 原生支持 content 为 string 或 ContentBlock[]
        // 直接传递，无需 cast（类型兼容）
        content: m.content as string | Anthropic.MessageParam['content'],
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
      const autoBudget = Math.floor(adjustedMaxTokens * 0.3);
      const budgetTokens = config.thinking.budgetTokens ?? autoBudget;

      (params as any).thinking = (config.thinking.type === 'adaptive' && isDirectAnthropic)
        ? { type: 'adaptive', effort: config.thinking.effort ?? 'medium' }
        : { type: 'enabled', budget_tokens: budgetTokens };
    }

    // 调试日志：统计缓存断点数量
    let cacheBreakpoints = 0;
    if (Array.isArray(params.system)) {
      cacheBreakpoints += params.system.filter((b: any) => b.cache_control).length;
    }
    if (params.tools) {
      cacheBreakpoints += (params.tools as any[]).filter((t: any) => t.cache_control).length;
    }
    this.log.debug(`Request: model=${params.model}, max_tokens=${params.max_tokens}, messages=${chatMessages.length}, tools=${tools.length}, cache_breakpoints=${cacheBreakpoints}`);

    // 🆕 打印完整请求体用于调试（仅打印结构，不打印完整内容）
    this.log.debug(`Request structure: {
  model: "${params.model}",
  max_tokens: ${params.max_tokens},
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
      const stream = client.messages.stream(params);

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

      if (errorMessage.includes('status code') || errorMessage.includes('authentication') || errorMessage.includes('APIError')) {
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

      // 保留原始错误的 status 属性（如 Anthropic SDK 的 429/500 等），
      // 确保 RetryPolicy.shouldRetry() 能通过 status 码判断是否重试
      const wrappedError = new Error(errorMessage);
      if (err instanceof Error && 'status' in err) {
        (wrappedError as Error & { status: number }).status = (err as Error & { status: number }).status;
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

  /**
   * 估算输入 tokens 数量（粗略估算）
   * 规则：英文 ~4 字符/token，中文 ~1.5 字符/token，JSON ~1.2 字符/token
   */
  private estimateInputTokens(
    systemBlocks: Anthropic.TextBlockParam[],
    chatMessages: Message[],
    tools: ToolSchema[],
  ): number {
    let totalChars = 0;

    // System prompt
    for (const block of systemBlocks) {
      totalChars += block.text?.length || 0;
    }

    // Chat messages
    for (const msg of chatMessages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          totalChars += (block as any).text?.length || (block as any).content?.length || 0;
        }
      }
    }

    // Tools (JSON schema)
    totalChars += JSON.stringify(tools).length;

    // 粗略估算：平均 3 字符/token
    return Math.ceil(totalChars / 3);
  }

  /**
   * 根据模型限制和输入 tokens 动态计算 max_tokens
   *
   * 模型限制：
   * - claude-opus-4: 总 200k，输出最大 16384
   * - claude-sonnet-4/4.5: 总 200k，输出最大 64000
   * - claude-haiku-4/4.5: 总 200k，输出最大 64000
   * - claude-3.5-sonnet: 总 200k，输出最大 8192
   * - claude-3.5-haiku: 总 200k，输出最大 8192
   *
   * 计算公式：
   * max_tokens = min(
   *   用户配置,
   *   模型输出限制,
   *   总上下文窗口 - 输入tokens - 安全边距
   * )
   */
  private calculateMaxTokens(modelName: string, requestedMaxTokens: number, estimatedInputTokens: number): number {
    const normalizedModel = modelName.replace(/^\[.*?\]/, '').toLowerCase();

    // 获取模型限制
    let contextWindow: number;
    let outputLimit: number;

    if (normalizedModel.includes('opus-4')) {
      contextWindow = 200000;
      outputLimit = 16384;
    } else if (normalizedModel.includes('sonnet-4') || normalizedModel.includes('haiku-4')) {
      contextWindow = 200000;
      outputLimit = 64000;
    } else if (normalizedModel.includes('3.5') || normalizedModel.includes('3-5')) {
      contextWindow = 200000;
      outputLimit = 8192;
    } else if (normalizedModel.includes('claude-3')) {
      contextWindow = 200000;
      outputLimit = 4096;
    } else {
      // 未知模型，使用保守值
      contextWindow = 200000;
      outputLimit = 8192;
      this.log.warn(`Unknown model ${modelName}, using conservative limits`);
    }

    // 安全边距（预留给响应元数据等）
    const safetyMargin = 1000;

    // 基于上下文窗口的最大输出
    const contextBasedMax = Math.max(0, contextWindow - estimatedInputTokens - safetyMargin);

    // 取最小值
    const finalMaxTokens = Math.min(requestedMaxTokens, outputLimit, contextBasedMax);

    // 日志记录
    if (finalMaxTokens < requestedMaxTokens) {
      this.log.debug(`max_tokens adjusted: ${requestedMaxTokens} → ${finalMaxTokens} (input: ~${estimatedInputTokens}, context: ${contextWindow}, output_limit: ${outputLimit})`);
    }

    return Math.max(1024, finalMaxTokens); // 至少保证 1024 tokens 输出空间
  }
}
