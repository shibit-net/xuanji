// ============================================================
// ResultProcessor — Stream 结果处理
// ============================================================
//
// 处理 Stream 结果的验证、end_turn、max_tokens 等情况

import type { Message } from '@/core/types';
import type { ProcessResult } from './StreamProcessor';
import type { MessageManager } from './MessageManager';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'ResultProcessor' });

/**
 * 结果处理选项
 */
export interface ResultProcessOptions {
  /** 是否有待处理的追加消息 */
  hasPendingAppend: boolean;
  /** 回调 */
  callbacks?: {
    onInfo?: (message: string) => void;
  };
}

/**
 * 结果处理结果
 */
export interface ResultProcessResult {
  /** 是否应该继续循环 */
  shouldContinue: boolean;
  /** 是否应该结束循环 */
  shouldBreak: boolean;
  /** 更新后的消息列表（如果有） */
  messages?: Message[];
  /** 结果处理类型 */
  type: 'end_turn' | 'max_tokens' | 'interrupted' | 'continue';
}

/**
 * ResultProcessor — 结果处理器
 */
export class ResultProcessor {
  constructor(private messageManager: MessageManager) {}

  /**
   * 处理 Stream 结果
   */
  processResult(
    result: ProcessResult,
    options: ResultProcessOptions,
  ): ResultProcessResult {
    // 1. 判断是否结束（end_turn 或无工具调用）
    if (result.stopReason === 'end_turn' || result.toolCalls.length === 0) {
      return this.handleEndTurn(result, options.hasPendingAppend);
    }

    // 2. 处理 max_tokens 或 interrupted
    if (result.stopReason === 'max_tokens' || result.stopReason === 'interrupted') {
      return this.handleTruncation(result, options.callbacks);
    }

    // 3. 正常情况：继续执行工具
    return {
      shouldContinue: false,
      shouldBreak: false,
      type: 'continue',
    };
  }

  /**
   * 处理 end_turn
   */
  private handleEndTurn(
    result: ProcessResult,
    hasPendingAppend: boolean,
  ): ResultProcessResult {
    // 有待处理的追加消息时不退出循环
    if (hasPendingAppend) {
      log.info('end_turn but pending append message, continuing loop');

      // 防御性检查：确保 tool_use/tool_result 配对完整
      const pairedCount = this.messageManager.ensureToolResultPairing();
      if (pairedCount > 0) {
        log.warn(`end_turn path: injected ${pairedCount} placeholder tool_result(s)`);
      }

      return {
        shouldContinue: true,
        shouldBreak: false,
        messages: this.messageManager.getMessages(),
        type: 'end_turn',
      };
    }

    log.debug(`Loop ended: stopReason=${result.stopReason}, toolCalls=${result.toolCalls.length}`);
    return {
      shouldContinue: false,
      shouldBreak: true,
      type: 'end_turn',
    };
  }

  /**
   * 处理 max_tokens 或 interrupted 截断
   */
  private handleTruncation(
    result: ProcessResult,
    callbacks?: { onInfo?: (message: string) => void },
  ): ResultProcessResult {
    // 友好提示用户
    const infoMessage = result.stopReason === 'interrupted'
      ? '🔄 流传输中断，正在自动恢复...'
      : '📝 输出内容过多，正在自动分段写入...';
    callbacks?.onInfo?.(infoMessage);

    if (result.toolCalls.length > 0) {
      // 有工具调用：为所有工具生成错误 tool_result，让 LLM 看到并重试
      log.debug(`${result.stopReason}: ${result.toolCalls.length} tool calls present, generating error results`);

      const errorResults = new Map<string, { content: string; isError: boolean }>();
      for (const tc of result.toolCalls) {
        const isTruncated = (tc.input as Record<string, unknown>)?._truncated || (tc.input as Record<string, unknown>)?._parse_error;
        const errorMsg = isTruncated
          ? `[ERROR] Tool call "${tc.name}" failed: output token limit reached, arguments were truncated.`
          : result.stopReason === 'max_tokens'
            ? `[System] Tool call "${tc.name}" was interrupted by max_tokens limit. Please SPLIT into SMALLER operations (write_file max 200 lines, edit_file max 50 lines).`
            : `[ERROR] Tool call "${tc.name}" was not executed: stream was interrupted before completion.`;
        
        const content = isTruncated ? [
          errorMsg,
          ``,
          `The content was too large to fit in a single tool call.`,
          `REQUIRED: Split this into MULTIPLE SMALL tool calls:`,
          `  - Each write_file call: max 200 lines`,
          `  - Each edit_file call: max 50 lines of old_string/new_string`,
          `  - Write the first chunk with write_file, then use edit_file to append remaining chunks`,
          `  - For edit_file append: use the last few lines as old_string, and those lines + new content as new_string`,
        ].join('\n') : errorMsg;

        errorResults.set(tc.id, { content, isError: true });
      }
      this.messageManager.addToolResults(errorResults);
    } else {
      // 没有工具调用：注入用户提示让 LLM 重试
      const systemHint = '[System] Output token limit reached. Split large operations into MULTIPLE SMALL tool calls (write_file max 200 lines, edit_file max 50 lines). DO NOT retry with large content in a single call.';
      const merged = this.messageManager.addUserMessageSafe(systemHint);
      log.debug(`Max tokens system hint ${merged ? 'merged' : 'added'}`);
    }

    // 重建消息继续循环
    return {
      shouldContinue: true,
      shouldBreak: false,
      messages: this.messageManager.getMessages(),
      type: result.stopReason === 'max_tokens' ? 'max_tokens' : 'interrupted',
    };
  }
}
