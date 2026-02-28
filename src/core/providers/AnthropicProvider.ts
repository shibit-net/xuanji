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

    // 构建 system prompt blocks（支持 Prompt Caching）
    // MessageManager 输出结构化 ContentBlock[]，区分稳定基础部分和动态后缀
    const systemBlocks = this.buildSystemBlocks(systemMessages);

    // 构造 Anthropic API 请求参数
    const params: Anthropic.MessageCreateParamsStreaming = {
      model: config.model,
      max_tokens: config.maxTokens || 65536,
      stream: true,
      messages: chatMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        // Anthropic API 原生支持 content 为 string 或 ContentBlock[]
        // 直接传递，无需 cast（类型兼容）
        content: m.content as string | Anthropic.MessageParam['content'],
      })),
      ...(systemBlocks.length > 0 ? { system: systemBlocks } : {}),
      ...(tools.length > 0 ? {
        tools: tools.map((t, i) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
          // 在最后一个工具上添加缓存断点（Anthropic 最多支持 4 个断点，LIFO 匹配）
          ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
        })),
      } : {}),
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    };

    // 调试日志
    this.log.debug(`Request: model=${params.model}, max_tokens=${params.max_tokens}, messages=${chatMessages.length}, tools=${tools.length}`);

    let timeoutCheckInterval: NodeJS.Timeout | undefined; // 提升到外层，确保清理

    try {
      const stream = client.messages.stream(params);

      // 当前 tool_use 块 JSON 累积
      let currentToolId: string | undefined;
      let currentToolName: string | undefined;
      let currentToolInput = '';
      let receivedEnd = false;
      let eventCount = 0;
      const eventTypeCounts: Record<string, number> = {};

      // 应用层超时保护：per-event 超时（防止 SDK 超时盲区导致卡住）
      //
      // 问题背景：
      // @anthropic-ai/sdk 的 timeout 配置只覆盖初始 HTTP 请求阶段，一旦响应头返回，
      // 超时定时器就被 clearTimeout，之后的流式数据读取完全没有超时保护。
      // 如果代理层或网络层在流传输中途静默断开连接（不发送 error 事件），
      // ReadableStream 会正常 EOF，导致 for await 循环正常退出，但消息不完整。
      //
      // 解决方案：
      // 在应用层实现 per-event 超时：如果超过 N 秒没有收到新事件，主动 abort stream。
      // 这样可以在代理层/网络层卡住时及时中止，触发恢复逻辑。
      const PER_EVENT_TIMEOUT_MS = 30_000; // 30 秒未收到新事件视为超时
      let lastEventTime = Date.now();
      let perEventTimedOut = false;
      timeoutCheckInterval = setInterval(() => {
        const elapsed = Date.now() - lastEventTime;
        if (elapsed > PER_EVENT_TIMEOUT_MS) {
          this.log.warn(`Per-event timeout: ${elapsed}ms elapsed since last event, aborting stream`);
          perEventTimedOut = true;
          stream.controller.abort(); // 主动中止流
        }
      }, 5000); // 每 5 秒检查一次

      try {
        for await (const event of stream) {
          lastEventTime = Date.now(); // 重置超时计时器
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
        if (streamErr instanceof Error && streamErr.name === 'AbortError') {
          // 超时或用户中止 — 走恢复逻辑
          this.log.warn(`Stream aborted: ${streamErr.message}`);
        } else {
          // 网络错误等 — 重新抛出触发重试
          throw streamErr;
        }
      }

      // 流提前结束的恢复处理
      if (!receivedEnd) {
        this.log.warn(`Stream ended without message_delta event. totalEvents=${eventCount}, eventTypes=${JSON.stringify(eventTypeCounts)}, hasOpenToolUse=${!!(currentToolId && currentToolName)}, toolInputSize=${currentToolInput?.length ?? 0}`);

        // 如果是 per-event 超时导致的中断，抛出明确的超时错误让 RetryPolicy 处理
        if (perEventTimedOut) {
          // 先发出已累积的工具调用（如果有）
          if (currentToolId && currentToolName) {
            yield {
              type: 'tool_use_end',
              toolCall: {
                id: currentToolId,
                name: currentToolName,
                input: {
                  _truncated: true,
                  _raw_input: currentToolInput?.substring(0, 500) ?? '',
                  _error_message: `流传输超时：工具 "${currentToolName}" 的参数在接收 ${currentToolInput?.length ?? 0} 字符后超时中断`,
                },
              },
            };
          }
          throw new Error('Stream per-event timeout: no data received for 30 seconds');
        }

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

      throw new Error(errorMessage);
    } finally {
      // 确保清理超时检查定时器
      if (timeoutCheckInterval) {
        clearInterval(timeoutCheckInterval);
      }
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
        // 结构化模式：第一个 block 标记缓存（基础 prompt，稳定）
        // 后续 blocks 不标记（动态后缀，每轮可能变化）
        const textBlocks = msg.content.filter(
          (b) => b.type === 'text' && b.text,
        );
        for (let i = 0; i < textBlocks.length; i++) {
          blocks.push({
            type: 'text',
            text: textBlocks[i].text!,
            // 仅在第一个 block（基础 system prompt）上标记缓存
            ...(i === 0 ? { cache_control: { type: 'ephemeral' } } : {}),
          });
        }
      }
    }

    return blocks;
  }
}
