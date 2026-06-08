/**
 * TokenCounter — 字符级 token 估算
 *
 * CJK 约 1.5 tokens/字，ASCII 约 0.25 tokens/字。
 */

import type { Message, TokenUsage } from '@/infrastructure/core-types';

export class TokenCounter {
  private maxContextTokens: number;
  private reservedOutputTokens: number;
  private totalUsage: TokenUsage = { input: 0, output: 0 };

  /** API 最近一次返回的真实 input token 数（含 tool schema 等开销） */
  private lastActualInputTokens = 0;

  constructor(maxContextTokens = 1_000_000, reservedOutputTokens = 8192) {
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
          // DeepSeek/OpenAI reasoning_content 需回传，计入预算
          total += TokenCounter.estimateString(block.thinking ?? '');
          total += TokenCounter.estimateString(block.reasoning ?? '');
        }
      }
    }
    return Math.ceil(total);
  }

  /**
   * 字符级 token 估算，按字符类别分别加权：
   * - CJK 字符：~1.5 tokens/字（中/日/韩语，通常每字一个 token）
   * - 英文字母 (a-zA-Z)：~0.3 tokens/字（自然语言 ~3-4 chars/token）
   * - 数字 (0-9)：~0.5 tokens/字（数字串通常紧凑，但短数字常独立成 token）
   * - 空白字符：不计（tokenizer 合并到相邻 token）
   * - 标点/符号/括号/引号：~0.85 tokens/字（在 JSON/代码中常独立成 token）
   */
  static estimateString(text: string): number {
    if (!text) return 0;

    const CJK_RANGES = [
      [0x4E00, 0x9FFF], // CJK Unified
      [0x3400, 0x4DBF], // CJK Extension A
      [0x3000, 0x303F], // CJK Punctuation
      [0xFF00, 0xFFEF], // Halfwidth/Fullwidth
      [0x3040, 0x309F], // Hiragana
      [0x30A0, 0x30FF], // Katakana
      [0xAC00, 0xD7AF], // Hangul
    ] as const;

    let cjk = 0;
    let alpha = 0;
    let digit = 0;
    let special = 0;
    // whitespace not counted (tokenizer merges it with adjacent tokens)

    for (const char of text) {
      const code = char.codePointAt(0)!;

      if (CJK_RANGES.some(([lo, hi]) => code >= lo && code <= hi)) {
        cjk++;
        continue;
      }
      if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
        continue; // whitespace: free
      }
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
        alpha++;
      } else if (code >= 48 && code <= 57) {
        digit++;
      } else {
        special++;
      }
    }

    return cjk * 1.5 + alpha * 0.3 + digit * 0.5 + special * 0.85;
  }

  getMaxInputTokens(): number {
    return this.maxContextTokens - this.reservedOutputTokens;
  }

  recordUsage(usage: TokenUsage): void {
    this.totalUsage.input += usage.input;
    this.totalUsage.output += usage.output;
    this.totalUsage.cacheRead = (this.totalUsage.cacheRead ?? 0) + (usage.cacheRead ?? 0);
    this.totalUsage.cacheWrite = (this.totalUsage.cacheWrite ?? 0) + (usage.cacheWrite ?? 0);
    if (usage.input > 0) {
      this.lastActualInputTokens = usage.input;
    }
  }

  /**
   * 返回校准后的 token 估算值：
   * - 如果 API 返回过真实 input token 数，以此为准（含 tool schema 等开销）
   * - 取 Math.max 防止压缩后启发式估计低于旧的 API 值
   * - 真实值不可用时回退到纯启发式估计
   */
  getCalibratedEstimate(messages: Message[]): number {
    const estimated = this.estimate(messages);
    if (this.lastActualInputTokens > 0) {
      return Math.max(this.lastActualInputTokens, estimated);
    }
    return estimated;
  }

  /** 压缩后清零 API 基线，防止旧的（压缩前）高值污染后续预算检查 */
  resetActualBaseline(): void {
    this.lastActualInputTokens = 0;
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
