// ============================================================
// M2 Agent — Token 管理器
// ============================================================

import type { Message, TokenUsage } from '@/core/types';

/**
 * Token 管理器
 * 负责 Token 计数估算、窗口裁剪
 */
export class TokenManager {
  /** 模型最大上下文窗口 */
  private maxContextTokens: number;

  /** 预留给输出的 token */
  private reservedOutputTokens: number;

  /** 累计 token 用量 */
  private totalUsage: TokenUsage = { input: 0, output: 0 };

  constructor(maxContextTokens = 200_000, reservedOutputTokens = 8192) {
    this.maxContextTokens = maxContextTokens;
    this.reservedOutputTokens = reservedOutputTokens;
  }

  /**
   * 估算消息数组的 token 数 (粗略估计: 1 token ≈ 4 字符)
   */
  estimateTokens(messages: Message[]): number {
    let totalChars = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalChars += msg.content.length;
      } else {
        for (const block of msg.content) {
          totalChars += (block.text ?? '').length;
          totalChars += (block.content ?? '').length;
          totalChars += JSON.stringify(block.input ?? '').length;
        }
      }
    }
    return Math.ceil(totalChars / 4);
  }

  /**
   * 裁剪消息使其适合上下文窗口
   * 保留 system prompt (第一条) 和最近的消息
   */
  fitWindow(messages: Message[]): Message[] {
    const maxInputTokens = this.maxContextTokens - this.reservedOutputTokens;

    if (this.estimateTokens(messages) <= maxInputTokens) {
      return messages;
    }

    // 保留 system prompt
    const systemMsg = messages[0];
    const rest = messages.slice(1);

    // 从最新消息开始保留
    const kept: Message[] = [];
    let tokenCount = this.estimateTokens([systemMsg]);

    for (let i = rest.length - 1; i >= 0; i--) {
      const msgTokens = this.estimateTokens([rest[i]]);
      if (tokenCount + msgTokens > maxInputTokens) break;
      kept.unshift(rest[i]);
      tokenCount += msgTokens;
    }

    return [systemMsg, ...kept];
  }

  /**
   * 记录 token 用量
   */
  recordUsage(usage: TokenUsage): void {
    this.totalUsage.input += usage.input;
    this.totalUsage.output += usage.output;
    this.totalUsage.cacheRead = (this.totalUsage.cacheRead ?? 0) + (usage.cacheRead ?? 0);
    this.totalUsage.cacheWrite = (this.totalUsage.cacheWrite ?? 0) + (usage.cacheWrite ?? 0);
  }

  /**
   * 获取累计用量
   */
  getTotalUsage(): TokenUsage {
    return { ...this.totalUsage };
  }

  /**
   * 重置累计用量
   */
  reset(): void {
    this.totalUsage = { input: 0, output: 0 };
  }
}
