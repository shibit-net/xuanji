/**
 * TokenCounter — 字符级 token 估算
 *
 * CJK 约 1.5 tokens/字，ASCII 约 0.25 tokens/字。
 */

import type { Message, TokenUsage } from '@/core/types';

export class TokenCounter {
  private maxContextTokens: number;
  private reservedOutputTokens: number;
  private totalUsage: TokenUsage = { input: 0, output: 0 };

  constructor(maxContextTokens = 200_000, reservedOutputTokens = 8192) {
    this.maxContextTokens = maxContextTokens;
    this.reservedOutputTokens = reservedOutputTokens;
  }

  estimate(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        total += TokenCounter.estimateString(msg.content);
      } else {
        for (const block of msg.content) {
          total += TokenCounter.estimateString(block.text ?? '');
          total += TokenCounter.estimateString(block.content ?? '');
          total += TokenCounter.estimateString(JSON.stringify(block.input ?? ''));
        }
      }
    }
    return Math.ceil(total);
  }

  static estimateString(text: string): number {
    if (!text) return 0;
    let cjk = 0;
    let ascii = 0;
    for (const char of text) {
      const code = char.codePointAt(0)!;
      if (
        (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x3000 && code <= 0x303F) ||
        (code >= 0xFF00 && code <= 0xFFEF) ||
        (code >= 0x3040 && code <= 0x309F) ||
        (code >= 0x30A0 && code <= 0x30FF) ||
        (code >= 0xAC00 && code <= 0xD7AF)
      ) {
        cjk++;
      } else {
        ascii++;
      }
    }
    return cjk * 1.5 + ascii / 4;
  }

  getMaxInputTokens(): number {
    return this.maxContextTokens - this.reservedOutputTokens;
  }

  recordUsage(usage: TokenUsage): void {
    this.totalUsage.input += usage.input;
    this.totalUsage.output += usage.output;
    this.totalUsage.cacheRead = (this.totalUsage.cacheRead ?? 0) + (usage.cacheRead ?? 0);
    this.totalUsage.cacheWrite = (this.totalUsage.cacheWrite ?? 0) + (usage.cacheWrite ?? 0);
  }

  getTotalUsage(): TokenUsage {
    return { ...this.totalUsage };
  }

  reset(): void {
    this.totalUsage = { input: 0, output: 0 };
  }

  restoreUsage(usage: TokenUsage): void {
    this.totalUsage = { ...usage };
  }
}
