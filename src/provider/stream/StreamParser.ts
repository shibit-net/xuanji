/**
 * StreamParser — 流事件解析器
 *
 * 将原始 StreamEvent 解析为结构化输出（text/thinking/tool_call/usage）。
 */
import { logger } from '@/infrastructure/logger';
import type { StreamEvent } from '@/shared/types/provider';
import type { ToolCall, TokenUsage } from '@/core/types';
import type { StreamParserConfig } from './types';
import type { StreamCallbacks } from './StreamPipeline';

const log = logger.child({ module: 'StreamParser' });

interface ParseState {
  text: string;
  thinking: string;
  toolCalls: Map<string, { name: string; input: Record<string, unknown> }>;
  stopReason: string;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export class StreamParser {
  private config: StreamParserConfig;
  private callbacks: StreamCallbacks;

  constructor(config: StreamParserConfig = {}, callbacks: StreamCallbacks = {}) {
    this.config = { maxToolCalls: 50, maxThinkingTokens: 100_000, parsePartialJson: true, ...config };
    this.callbacks = callbacks;
  }

  parseEvent(event: StreamEvent, state: ParseState): void {
    switch (event.type) {
      case 'text_delta':
        state.text += event.text || '';
        this.callbacks.onText?.(event.text || '');
        break;

      case 'thinking_delta':
        state.thinking += event.thinking || '';
        if (state.thinking.length < (this.config.maxThinkingTokens ?? 100_000)) {
          this.callbacks.onThinking?.(event.thinking || '');
        }
        break;

      case 'thinking_start':
        break;

      case 'reasoning_delta':
        state.thinking += event.reasoning || '';
        break;

      case 'tool_use_start': {
        const tc = event.toolCall;
        if (tc && tc.id) {
          state.toolCalls.set(tc.id, { name: tc.name || 'unknown', input: (tc.input as Record<string, unknown>) || {} });
          this.callbacks.onToolStart?.(tc.id, tc.name || 'unknown', (tc.input as Record<string, unknown>) || {});
        }
        break;
      }

      case 'tool_use_delta':
        if (event.toolCall?.id && event.toolCall?.input) {
          const id = event.toolCall.id;
          state.toolCalls.set(id, {
            name: state.toolCalls.get(id)?.name || 'unknown',
            input: event.toolCall.input as Record<string, unknown>,
          });
          this.callbacks.onToolDelta?.(id, state.toolCalls.get(id)?.name || '', 0);
        }
        break;

      case 'tool_use_end':
        if (event.toolCall?.id) {
          const updated: ToolCall = {
            id: event.toolCall.id,
            name: state.toolCalls.get(event.toolCall.id)?.name || 'unknown',
            input: (event.toolCall.input as Record<string, unknown>) || {},
          };
          // Emit tool start again with finalized input
          this.callbacks.onToolStart?.(updated.id, updated.name, updated.input);
        }
        break;

      case 'usage':
        if (event.usage) {
          Object.assign(state.usage, event.usage);
          this.callbacks.onUsage?.(state.usage as TokenUsage);
        }
        break;

      case 'end':
        state.stopReason = event.stopReason || 'end_turn';
        break;

      case 'error':
        log.warn(`Stream error: ${event.error?.message || 'unknown'}`);
        break;

      default:
        log.debug(`Unknown stream event type: ${(event as any).type}`);
    }
  }

  createInitialState(): ParseState {
    return {
      text: '',
      thinking: '',
      toolCalls: new Map(),
      stopReason: 'end_turn',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
  }

  reset(): void {
    this.callbacks = {};
  }
}
