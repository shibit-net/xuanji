/**
 * StreamPipeline — LLM 响应流处理管道
 *
 * 职责：流读取 → 解析(text/thinking/tool_call/usage) → 分发 → 重试
 */

import type { ILLMProvider, Message, ToolSchema, ToolCall, TokenUsage } from '@/core/types';
import type { StreamEvent } from '@/shared/types/provider';
import type { ProviderConfig } from '@/shared/types/provider';
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
    this.currentStream = null;
  }

  async execute(
    messages: Message[],
    toolSchemas: ToolSchema[],
    options?: { signal?: AbortSignal; maxRetries?: number; config?: ProviderConfig },
  ): Promise<StreamResult> {
    const maxRetries = options?.maxRetries ?? 3;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (options?.signal?.aborted) throw new Error('Aborted');
      try {
        const stream = this.provider.stream(messages, toolSchemas, options?.config || { model: '' });
        this.currentStream = stream;
        return await this.processStream(stream, options?.signal);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        log.warn(`Stream attempt ${attempt + 1}/${maxRetries + 1} failed: ${lastError.message}`);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, attempt), 10000)));
        }
      } finally {
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
    const toolMap = new Map<string, { name: string; input: Record<string, unknown> }>();

    for await (const event of stream) {
      if (this.interruptChecker() || signal?.aborted) throw new Error('Interrupted');

      switch (event.type) {
        case 'text_delta':
          fullText += event.text || '';
          this.callbacks.onText?.(event.text || '');
          break;

        case 'thinking_delta':
          this.callbacks.onThinking?.(event.thinking || '');
          break;

        case 'thinking_start':
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
          break;

        case 'error':
          throw new Error(event.error?.message || 'Stream error');

        default:
          break;
      }
    }

    for (const [id, tc] of toolMap) {
      toolCalls.push({ id, name: tc.name, input: tc.input });
    }
    if (fullText) contentBlocks.push({ type: 'text', text: fullText });

    return { contentBlocks, toolCalls, stopReason, usage, text: fullText };
  }
}
