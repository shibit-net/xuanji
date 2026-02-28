// ============================================================
// M2 Agent — 流处理器
// ============================================================

import type { StreamEvent, ToolCall, TokenUsage, StopReason, ContentBlock } from '@/core/types';

/**
 * 流处理结果
 */
export interface ProcessResult {
  /** 停止原因 */
  stopReason: StopReason;
  /** 本轮所有工具调用 */
  toolCalls: ToolCall[];
  /** Token 用量 */
  usage: TokenUsage;
  /** 收集到的 content blocks */
  contentBlocks: ContentBlock[];
}

/**
 * 流处理器
 * 消费 LLM 流式响应，解析事件并分发回调
 */
export class StreamProcessor {
  private textHandler?: (text: string) => void;
  private thinkingHandler?: (thinking: string) => void;
  private toolUseHandler?: (toolCall: ToolCall) => void;
  private toolStartHandler?: (toolCall: ToolCall) => void;
  private toolDeltaHandler?: (id: string, name: string, receivedBytes: number) => void;
  private usageHandler?: (usage: TokenUsage) => void;

  onTextDelta(handler: (text: string) => void): void {
    this.textHandler = handler;
  }

  /** 获取当前 textHandler（供外部包装扩展） */
  getTextHandler(): ((text: string) => void) | undefined {
    return this.textHandler;
  }

  onThinkingDelta(handler: (thinking: string) => void): void {
    this.thinkingHandler = handler;
  }

  onToolUse(handler: (toolCall: ToolCall) => void): void {
    this.toolUseHandler = handler;
  }

  onToolStart(handler: (toolCall: ToolCall) => void): void {
    this.toolStartHandler = handler;
  }

  onToolDelta(handler: (id: string, name: string, receivedBytes: number) => void): void {
    this.toolDeltaHandler = handler;
  }

  onUsage(handler: (usage: TokenUsage) => void): void {
    this.usageHandler = handler;
  }

  /**
   * 消费流式响应
   */
  async consume(stream: AsyncIterable<StreamEvent>): Promise<ProcessResult> {
    const toolCalls: ToolCall[] = [];
    const contentBlocks: ContentBlock[] = [];
    let currentText = '';
    let currentThinking = '';
    let stopReason: StopReason = 'end_turn';
    let totalUsage: TokenUsage = { input: 0, output: 0 };

    // 当前 tool_use 块的追踪信息
    let currentToolInputSize = 0;
    let currentToolId: string | undefined;
    let currentToolName: string | undefined;
    // delta 回调节流：避免大文件流式传输时过于频繁地触发 UI 更新
    let lastDeltaNotifyTime = 0;
    const DELTA_THROTTLE_MS = 500;

    for await (const event of stream) {
      switch (event.type) {
        case 'text_delta': {
          if (event.text) {
            currentText += event.text;
            this.textHandler?.(event.text);
          }
          break;
        }

        case 'thinking_delta': {
          if (event.thinking) {
            currentThinking += event.thinking;
            this.thinkingHandler?.(event.thinking);
          }
          break;
        }

        case 'tool_use_start': {
          // 工具调用开始：立即通知
          if (event.toolCall?.id && event.toolCall?.name) {
            currentToolId = event.toolCall.id;
            currentToolName = event.toolCall.name;
            currentToolInputSize = 0;
            const toolCall: ToolCall = {
              id: event.toolCall.id,
              name: event.toolCall.name,
              input: event.toolCall.input ?? {},
            };
            this.toolStartHandler?.(toolCall);
          }
          break;
        }

        case 'tool_use_delta': {
          // 工具 input JSON 流式传输中：追踪接收进度
          const deltaSize = event.text?.length ?? 0;
          currentToolInputSize += deltaSize;
          if (this.toolDeltaHandler && currentToolId && currentToolName) {
            const now = Date.now();
            if (now - lastDeltaNotifyTime >= DELTA_THROTTLE_MS) {
              lastDeltaNotifyTime = now;
              this.toolDeltaHandler(currentToolId, currentToolName, currentToolInputSize);
            }
          }
          break;
        }

        case 'tool_use_end': {
          if (event.toolCall?.id && event.toolCall?.name) {
            const toolCall: ToolCall = {
              id: event.toolCall.id,
              name: event.toolCall.name,
              input: event.toolCall.input ?? {},
            };
            toolCalls.push(toolCall);
            this.toolUseHandler?.(toolCall);

            // 清理当前工具追踪
            currentToolId = undefined;
            currentToolName = undefined;
            currentToolInputSize = 0;

            // 先把之前累积的文本作为 content block
            if (currentText) {
              contentBlocks.push({ type: 'text', text: currentText });
              currentText = '';
            }
            if (currentThinking) {
              contentBlocks.push({ type: 'thinking', thinking: currentThinking });
              currentThinking = '';
            }
            // 工具调用作为 content block
            contentBlocks.push({
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.input,
            });
          }
          break;
        }

        case 'usage': {
          if (event.usage) {
            totalUsage = {
              input: totalUsage.input + event.usage.input,
              output: totalUsage.output + event.usage.output,
              cacheRead: (totalUsage.cacheRead ?? 0) + (event.usage.cacheRead ?? 0),
              cacheWrite: (totalUsage.cacheWrite ?? 0) + (event.usage.cacheWrite ?? 0),
            };
            this.usageHandler?.(event.usage);
          }
          break;
        }

        case 'end': {
          if (event.stopReason) {
            stopReason = event.stopReason;
          }
          if (event.usage) {
            totalUsage = {
              input: totalUsage.input + event.usage.input,
              output: totalUsage.output + event.usage.output,
              cacheRead: (totalUsage.cacheRead ?? 0) + (event.usage.cacheRead ?? 0),
              cacheWrite: (totalUsage.cacheWrite ?? 0) + (event.usage.cacheWrite ?? 0),
            };
            // end 事件中的 usage 也需要通知外部
            // Anthropic 的 output tokens 通过 message_delta → end 事件报告
            this.usageHandler?.(event.usage);
          }
          break;
        }

        case 'error': {
          throw event.error ?? new Error('LLM 流处理出错');
        }
      }
    }

    // 处理剩余文本
    if (currentText) {
      contentBlocks.push({ type: 'text', text: currentText });
    }
    if (currentThinking) {
      contentBlocks.push({ type: 'thinking', thinking: currentThinking });
    }

    return { stopReason, toolCalls, usage: totalUsage, contentBlocks };
  }
}
