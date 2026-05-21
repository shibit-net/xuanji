/**
 * StreamPipeline — LLM 响应流处理管道
 *
 * 职责：流读取 → 解析(text/thinking/tool_call/usage) → 分发 → 重试
 */

import type { ILLMProvider, Message, ToolSchema, ToolCall, TokenUsage } from '@/core/types';
import type { StreamEvent } from '@/shared/types/provider';
import type { ProviderConfig } from '@/shared/types/provider';
import { isContentTooLargeError } from '@/core/providers/RetryPolicy';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'StreamPipeline' });

export interface StreamCallbacks {
  onText?: (text: string) => void;
  onThinking?: (thinking: string) => void;
  onToolStart?: (id: string, name: string, input: Record<string, unknown>) => void;
  onToolDelta?: (id: string, name: string, receivedBytes: number) => void;
  onUsage?: (usage: TokenUsage) => void;
}

export interface StreamResult {
  contentBlocks: Array<{ type: string; text?: string; [key: string]: any }>;
  toolCalls: ToolCall[];
  stopReason: string;
  usage: TokenUsage;
  text: string;
}

export class StreamPipeline {
  private callbacks: StreamCallbacks = {};
  private currentStream: AsyncIterable<StreamEvent> | null = null;
  private interruptChecker: () => boolean = () => false;
  private provider: ILLMProvider;

  constructor(provider: ILLMProvider) {
    this.provider = provider;
  }

  on(callbacks: StreamCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  setInterruptChecker(checker: () => boolean): void {
    this.interruptChecker = checker;
  }

  abort(): void {
    if (this.currentStream && typeof (this.currentStream as any).return === 'function') {
      (this.currentStream as any).return();
    }
    this.currentStream = null;
  }

  async execute(
    messages: Message[],
    toolSchemas: ToolSchema[],
    options?: {
      signal?: AbortSignal;
      maxRetries?: number;
      config?: ProviderConfig;
      /** 当检测到上下文过长错误时调用，返回 true 表示已压缩可重试 */
      onContentTooLarge?: () => Promise<boolean>;
    },
  ): Promise<StreamResult> {
    const maxRetries = options?.maxRetries ?? 3;
    let lastError: Error | null = null;

    log.info(`[DIAG] StreamPipeline.execute: calling provider.stream, model=${options?.config?.model} provider=${this.provider?.name || 'unknown'} msgCount=${messages.length} toolCount=${toolSchemas.length}`);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (options?.signal?.aborted) throw new Error('Aborted');
      try {
        const stream = this.provider.stream(messages, toolSchemas, options?.config || { model: '' });
        this.currentStream = stream;
        return await this.processStream(stream, options?.signal);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // 中断/终止错误不重试
        if (lastError.message === 'Interrupted' || lastError.name === 'AbortError') {
          throw lastError;
        }

        // 上下文过长错误：自动压缩后重试
        if (isContentTooLargeError(lastError) && options?.onContentTooLarge) {
          log.warn(`Content too large detected, attempting auto-compression before retry ${attempt + 1}`);
          const compressed = await options.onContentTooLarge();
          if (compressed) {
            log.info(`Context compressed, retrying stream`);
          }
        }

        log.warn(`Stream attempt ${attempt + 1}/${maxRetries + 1} failed: ${lastError.message}`);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 10000)));
        }
      } finally {
        if (this.currentStream && typeof (this.currentStream as any).return === 'function') {
          (this.currentStream as any).return();
        }
        this.currentStream = null;
      }
    }
    throw lastError ?? new Error('Stream execution failed');
  }

  private async processStream(
    stream: AsyncIterable<StreamEvent>,
    signal?: AbortSignal,
  ): Promise<StreamResult> {
    const contentBlocks: any[] = [];
    const toolCalls: ToolCall[] = [];
    let stopReason = 'end_turn';
    const usage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let fullText = '';
    let fullThinking = '';
    let fullReasoning = '';
    let thinkingSignature: string | undefined;
    const toolMap = new Map<string, { name: string; input: Record<string, unknown> }>();

    for await (const event of stream) {
      if (this.interruptChecker() || signal?.aborted) throw new Error('Interrupted');

      switch (event.type) {
        case 'text_delta':
          fullText += event.text || '';
          this.callbacks.onText?.(event.text || '');
          break;

        case 'thinking_delta':
          fullThinking += event.thinking || '';
          thinkingSignature = event.signature || thinkingSignature;
          this.callbacks.onThinking?.(event.thinking || '');
          break;

        case 'thinking_start':
          break;

        case 'reasoning_delta':
          fullReasoning += event.reasoning || '';
          // DeepSeek/OpenAI reasoning_content 等同于 Anthropic thinking，路由到 onThinking
          this.callbacks.onThinking?.(event.reasoning || '');
          if (event.signature) thinkingSignature = event.signature;
          break;

        case 'tool_use_start': {
          const tc = event.toolCall;
          if (tc && tc.id) {
            toolMap.set(tc.id, { name: tc.name || 'unknown', input: (tc.input as Record<string, unknown>) || {} });
            this.callbacks.onToolStart?.(tc.id, tc.name || 'unknown', (tc.input as Record<string, unknown>) || {});
          }
          break;
        }

        case 'tool_use_delta':
          if (event.toolCall?.id && event.toolCall?.input) {
            const id = event.toolCall.id;
            const existing = toolMap.get(id);
            if (existing) {
              existing.input = event.toolCall.input as Record<string, unknown>;
            }
            this.callbacks.onToolDelta?.(id, existing?.name || '', 0);
          }
          break;

        case 'tool_use_end':
          if (event.toolCall?.id && event.toolCall?.input) {
            const id = event.toolCall.id;
            const existing = toolMap.get(id);
            if (existing) {
              existing.input = event.toolCall.input as Record<string, unknown>;
              this.callbacks.onToolStart?.(id, existing.name, existing.input);
            }
          }
          break;

        case 'usage':
          if (event.usage) {
            Object.assign(usage, event.usage);
            this.callbacks.onUsage?.(usage);
          }
          break;

        case 'end':
          stopReason = event.stopReason || 'end_turn';
          if (event.usage) {
            if (event.usage.input > 0) usage.input = event.usage.input;
            if (event.usage.output > 0) usage.output = event.usage.output;
            if (event.usage.cacheRead) usage.cacheRead = event.usage.cacheRead;
            if (event.usage.cacheWrite) usage.cacheWrite = event.usage.cacheWrite;
            this.callbacks.onUsage?.(usage);
          }
          break;

        case 'error':
          throw new Error(event.error?.message || 'Stream error');

        default:
          break;
      }
    }

    // 按顺序添加 ContentBlock：thinking → reasoning → text → tool_use
    // DeepSeek thinking 模式要求 reasoning_content 必须在后续请求中原样回传
    if (fullThinking) contentBlocks.push({ type: 'thinking', thinking: fullThinking, signature: thinkingSignature });
    if (fullReasoning) contentBlocks.push({ type: 'reasoning', reasoning: fullReasoning, signature: thinkingSignature });
    if (fullText) contentBlocks.push({ type: 'text', text: fullText });
    for (const [id, tc] of toolMap) {
      toolCalls.push({ id, name: tc.name, input: tc.input });
      // 同时添加 tool_use ContentBlock，确保 assistant 消息携带完整的工具调用信息
      // OpenAI 格式转换时依赖此块生成 tool_calls，后续 tool_result 才能正确配对
      contentBlocks.push({ type: 'tool_use', id, name: tc.name, input: tc.input });
    }

    // 诊断日志：确认 contentBlocks 中包含 reasoning 和 tool_use 块
    const blockTypes = contentBlocks.map(b => b.type);
    log.info(`StreamPipeline result: textLen=${fullText.length}, thinkingLen=${fullThinking.length}, reasoningLen=${fullReasoning.length}, toolCalls=${toolCalls.length}, blockTypes=[${blockTypes.join(', ')}]`);

    return { contentBlocks, toolCalls, stopReason, usage, text: fullText };
  }
}
