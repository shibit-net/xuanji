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
  private interruptChecker?: () => boolean;
  
  // 🆕 累积 buffer（用于 fallback 和手动 flush）
  private _currentText = '';
  private _currentThinking = '';
  private _currentToolInputBuffer = '';

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

  /** 设置中断检查器（用于立即停止流式消费） */
  setInterruptChecker(checker: () => boolean): void {
    this.interruptChecker = checker;
  }

  /**
   * 🆕 手动 flush 累积的内容（在关键节点调用，如用户追加输入时）
   * 返回当前累积的所有内容，但不清空 buffer
   */
  flush(): { text: string; thinking: string; toolInput: string } {
    return {
      text: this._currentText,
      thinking: this._currentThinking,
      toolInput: this._currentToolInputBuffer,
    };
  }

  /**
   * 🆕 重置累积 buffer（在新一轮开始时调用）
   */
  reset(): void {
    this._currentText = '';
    this._currentThinking = '';
    this._currentToolInputBuffer = '';
  }

  /**
   * 消费流式响应
   */
  async consume(stream: AsyncIterable<StreamEvent>): Promise<ProcessResult> {
    const toolCalls: ToolCall[] = [];
    const contentBlocks: ContentBlock[] = [];
    // 🆕 使用实例变量存储累积内容（支持外部 flush）
    this._currentText = '';
    this._currentThinking = '';
    let stopReason: StopReason = 'end_turn';
    let totalUsage: TokenUsage = { input: 0, output: 0 };

    // 当前 tool_use 块的追踪信息
    let currentToolInputSize = 0;
    let currentToolId: string | undefined;
    let currentToolName: string | undefined;
    // 🆕 重置 tool input buffer
    this._currentToolInputBuffer = '';
    // delta 回调节流：避免大文件流式传输时过于频繁地触发 UI 更新
    let lastDeltaNotifyTime = 0;
    const DELTA_THROTTLE_MS = 500;

    for await (const event of stream) {
      // 立即检查中断标志（优先级最高）
      if (this.interruptChecker?.()) {
        break; // 立即退出循环，停止消费 stream
      }

      switch (event.type) {
        case 'text_delta': {
          if (event.text) {
            this._currentText += event.text;  // 🆕 使用实例变量
            this.textHandler?.(event.text);
          }
          break;
        }

        case 'thinking_delta': {
          console.log('[StreamProcessor] thinking_delta 事件:', event.thinking?.length || 0, '前50字符:', event.thinking?.slice(0, 50) || '');
          if (event.thinking) {
            this._currentThinking += event.thinking;  // 🆕 使用实例变量
            console.log('[StreamProcessor] 调用 thinkingHandler，累计长度:', this._currentThinking.length);
            this.thinkingHandler?.(event.thinking);
          } else {
            console.log('[StreamProcessor] thinking_delta 事件但 event.thinking 为空');
          }
          break;
        }

        case 'tool_use_start': {
          // 工具调用开始：立即通知
          console.log('[StreamProcessor] tool_use_start 事件:', event.toolCall);
          if (event.toolCall?.id && event.toolCall?.name) {
            currentToolId = event.toolCall.id;
            currentToolName = event.toolCall.name;
            currentToolInputSize = 0;
            this._currentToolInputBuffer = '';  // 🆕 重置 buffer
            const toolCall: ToolCall = {
              id: event.toolCall.id,
              name: event.toolCall.name,
              input: event.toolCall.input ?? {},
            };
            console.log('[StreamProcessor] 调用 toolStartHandler:', toolCall);
            this.toolStartHandler?.(toolCall);
          } else {
            console.log('[StreamProcessor] tool_use_start 事件缺少 id 或 name');
          }
          break;
        }

        case 'tool_use_delta': {
          // 工具 input JSON 流式传输中：追踪接收进度
          const deltaText = event.text ?? '';
          const deltaSize = deltaText.length;
          currentToolInputSize += deltaSize;
          // 🆕 累积 JSON 片段（作为 Provider 的 fallback）
          this._currentToolInputBuffer += deltaText;
          
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
            // 🆕 自己解析累积的 JSON（作为 Provider 的 fallback）
            let parsedInput = event.toolCall.input;
            if (!parsedInput && this._currentToolInputBuffer) {
              try {
                parsedInput = JSON.parse(this._currentToolInputBuffer);
              } catch (parseErr) {
                // JSON 解析失败：标记错误但不抛出异常
                parsedInput = { 
                  _parse_error: true, 
                  _raw: this._currentToolInputBuffer.slice(0, 500),  // 只保留前 500 字符
                  _error_message: parseErr instanceof Error ? parseErr.message : String(parseErr),
                };
              }
            }
            
            const toolCall: ToolCall = {
              id: event.toolCall.id,
              name: event.toolCall.name,
              input: parsedInput ?? {},
            };
            toolCalls.push(toolCall);
            this.toolUseHandler?.(toolCall);

            // 清理当前工具追踪
            currentToolId = undefined;
            currentToolName = undefined;
            currentToolInputSize = 0;
            this._currentToolInputBuffer = '';  // 🆕 清空 buffer

            // 先把之前累积的文本作为 content block
            if (this._currentText) {
              contentBlocks.push({ type: 'text', text: this._currentText });
              this._currentText = '';
            }
            if (this._currentThinking) {
              contentBlocks.push({ type: 'thinking', thinking: this._currentThinking });
              this._currentThinking = '';
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
    if (this._currentText) {
      contentBlocks.push({ type: 'text', text: this._currentText });
    }
    if (this._currentThinking) {
      contentBlocks.push({ type: 'thinking', thinking: this._currentThinking });
    }

    return { stopReason, toolCalls, usage: totalUsage, contentBlocks };
  }
}
