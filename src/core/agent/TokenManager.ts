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
   * 估算消息数组的 token 数
   * 中文/CJK 字符约 1.5 tokens/字，ASCII 约 0.25 tokens/字
   */
  estimateTokens(messages: Message[]): number {
    let totalTokens = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        totalTokens += TokenManager.estimateStringTokens(msg.content);
      } else {
        for (const block of msg.content) {
          totalTokens += TokenManager.estimateStringTokens(block.text ?? '');
          totalTokens += TokenManager.estimateStringTokens(block.content ?? '');
          totalTokens += TokenManager.estimateStringTokens(JSON.stringify(block.input ?? ''));
        }
      }
    }
    return Math.ceil(totalTokens);
  }

  /**
   * 估算字符串的 token 数（区分 CJK 和 ASCII）
   */
  static estimateStringTokens(text: string): number {
    if (!text) return 0;
    let cjkChars = 0;
    let asciiChars = 0;
    for (const char of text) {
      const code = char.codePointAt(0)!;
      if (
        (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK 统一汉字
        (code >= 0x3400 && code <= 0x4DBF) ||   // CJK 统一汉字扩展 A
        (code >= 0x3000 && code <= 0x303F) ||   // CJK 符号和标点
        (code >= 0xFF00 && code <= 0xFFEF) ||   // 全角 ASCII/半角片假名
        (code >= 0x3040 && code <= 0x309F) ||   // 日文平假名
        (code >= 0x30A0 && code <= 0x30FF) ||   // 日文片假名
        (code >= 0xAC00 && code <= 0xD7AF)      // 韩文音节
      ) {
        cjkChars++;
      } else {
        asciiChars++;
      }
    }
    // CJK: ~1.5 tokens/字符, ASCII: ~0.25 tokens/字符
    return cjkChars * 1.5 + asciiChars / 4;
  }

  /**
   * 裁剪消息使其适合上下文窗口
   * 保留 system prompt (第一条) 和最近的消息
   *
   * 关键约束：保证 tool_use/tool_result 配对完整性
   * assistant(tool_use) 必须与后续 user(tool_result) 成对出现，
   * 否则 Anthropic API 会返回 400 错误。
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

    // 保证 tool_use/tool_result 配对完整性
    // 如果第一条保留消息是 tool_result（user 消息中包含 tool_result block），
    // 需要一并保留其前面的 assistant(tool_use) 消息
    while (kept.length > 0) {
      const first = kept[0];
      if (first.role === 'user' && Array.isArray(first.content)) {
        const hasToolResult = first.content.some((b: { type: string }) => b.type === 'tool_result');
        if (hasToolResult) {
          // 找到 kept 在 rest 中的起始索引
          const restIdx = rest.indexOf(first);
          if (restIdx > 0 && rest[restIdx - 1].role === 'assistant') {
            const assistant = rest[restIdx - 1];
            // 检查 assistant 中所有 tool_use 是否都有对应 tool_result 在 kept 中
            const toolUseIds = new Set<string>();
            if (Array.isArray(assistant.content)) {
              for (const block of assistant.content) {
                if (block.type === 'tool_use' && block.id) toolUseIds.add(block.id);
              }
            }
            // 收集 kept 中所有 tool_result 的 tool_use_id
            const toolResultIds = new Set<string>();
            for (const msg of kept) {
              if (msg.role === 'user' && Array.isArray(msg.content)) {
                for (const block of msg.content) {
                  if (block.type === 'tool_result' && block.tool_use_id) toolResultIds.add(block.tool_use_id);
                }
              }
            }
            // 检查完整性：所有 tool_use 都有对应的 tool_result
            const allMatched = [...toolUseIds].every(id => toolResultIds.has(id));
            if (allMatched) {
              kept.unshift(assistant);
              break;
            } else {
              // 不完整，丢弃这条 tool_result，继续检查下一条
              kept.shift();
              continue;
            }
          } else {
            // 找不到配对的 assistant，移除这条孤立的 tool_result
            kept.shift();
            continue;
          }
        }
      }
      break;
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
   * 获取最大输入 token 数（上下文窗口 - 预留输出）
   */
  getMaxInputTokens(): number {
    return this.maxContextTokens - this.reservedOutputTokens;
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
