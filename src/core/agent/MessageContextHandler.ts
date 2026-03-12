// ============================================================
// MessageContextHandler — 消息上下文处理
// ============================================================
//
// 处理消息压缩、Token 窗口管理、Thinking 通知

import type { Message } from '@/core/types';
import type { TokenManager } from './TokenManager';
import type { ContextCompressor } from './ContextCompressor';
import type { MessageManager } from './MessageManager';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'MessageContextHandler' });

/**
 * 上下文处理结果
 */
export interface ContextProcessResult {
  /** 处理后的消息列表 */
  messages: Message[];
  /** 是否进行了压缩 */
  compressed: boolean;
  /** 压缩信息（如果有） */
  compressionInfo?: {
    originalTokens: number;
    compressedTokens: number;
    ratio: number;
  };
}

/**
 * MessageContextHandler — 消息上下文处理器
 */
export class MessageContextHandler {
  constructor(
    private contextCompressor: ContextCompressor,
    private tokenManager: TokenManager,
    private messageManager: MessageManager,
  ) {}

  /**
   * 处理消息上下文（压缩 + 窗口裁剪）
   */
  async processContext(
    messages: Message[],
    callbacks?: {
      onInfo?: (message: string) => void;
      onThinking?: (thinking: string) => void;
    },
  ): Promise<ContextProcessResult> {
    // 主动通知 UI 进入 thinking 状态
    callbacks?.onThinking?.('');

    // 智能压缩（在硬截断之前，支持 LLM 语义压缩）
    const compressionResult = await this.contextCompressor.compressAsync(
      messages,
      this.tokenManager,
    );
    
    let processedMessages = compressionResult.compressed;
    let compressed = false;
    let compressionInfo: ContextProcessResult['compressionInfo'];

    if (compressionResult.compressionRatio > 0) {
      compressed = true;
      compressionInfo = {
        originalTokens: compressionResult.originalTokens,
        compressedTokens: compressionResult.compressedTokens,
        ratio: compressionResult.compressionRatio,
      };

      // 同步压缩结果到 MessageManager，防止下轮循环通过 getMessages() 恢复为未压缩版本
      this.messageManager.replaceMessages(processedMessages.slice(1)); // 去掉 system prompt

      const savedTokens = compressionResult.originalTokens - compressionResult.compressedTokens;
      const ratioPercent = Math.round(compressionResult.compressionRatio * 100);
      
      callbacks?.onInfo?.(
        `📦 压缩了 ${savedTokens} tokens (${ratioPercent}% 压缩率)`
      );

      log.debug(
        `Context compressed: ${compressionResult.originalTokens} → ${compressionResult.compressedTokens} tokens`
      );
    }

    // Token 窗口裁剪（兜底保护）
    processedMessages = this.tokenManager.fitWindow(processedMessages);

    return {
      messages: processedMessages,
      compressed,
      compressionInfo,
    };
  }

  /**
   * 记录迭代信息
   */
  logIteration(
    currentIteration: number,
    maxIterations: number,
    running: boolean,
    messageCount: number,
  ): void {
    const maxDisplay = maxIterations === Infinity ? '∞' : maxIterations;
    log.debug(
      `Iteration ${currentIteration}/${maxDisplay}, running=${running}, messages=${messageCount}`
    );
  }
}
