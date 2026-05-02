/**
 * ContextManager — 对话上下文管理器
 *
 * 职责：消息构建、token 预算、快照回滚、上下文压缩。
 */

import type { Message, ContentBlock, ToolResult, CompressionResult, TokenUsage } from '@/core/types';
import { TokenCounter } from './TokenCounter';
import { eventBus } from '@/core/events/EventBus';
import { XuanjiEvent } from '@/core/events/events';

export type CompressionStrategy = 'summarize_early' | 'aggressive' | 'selective';

export type BudgetStatus =
  | { level: 'green'; usagePercent: number }
  | { level: 'yellow'; usagePercent: number; suggestion: string }
  | { level: 'red'; usagePercent: number; requiredAction: 'compress' | 'truncate' };

const YELLOW_THRESHOLD = 0.7;
const RED_THRESHOLD = 0.9;

export class ContextManager {
  private messages: Message[] = [];
  private snapshots: Message[][] = [];
  private tokenCounter: TokenCounter;

  constructor(maxContextTokens?: number, reservedOutputTokens?: number) {
    this.tokenCounter = new TokenCounter(maxContextTokens, reservedOutputTokens);
  }

  getMessages(): Message[] {
    return this.messages;
  }

  addMessage(message: Message): void {
    this.messages.push(message);
  }

  addUserMessage(text: string): void {
    this.messages.push({ role: 'user', content: text });
  }

  addAssistantMessage(blocks: ContentBlock[]): void {
    this.messages.push({ role: 'assistant', content: blocks });
  }

  addToolResults(results: Map<string, ToolResult>): void {
    const content: ContentBlock[] = [];
    for (const [id, result] of results) {
      content.push({
        type: 'tool_result',
        tool_use_id: id,
        content: result.content,
        is_error: result.isError,
      });
    }
    this.messages.push({ role: 'user', content });
  }

  setSystemPromptSuffix(suffix: string, _key: string): void {
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      const current = typeof this.messages[0].content === 'string' ? this.messages[0].content : '';
      if (suffix) {
        this.messages[0] = { role: 'system', content: current + '\n\n' + suffix };
      }
    }
  }

  replaceMessages(messages: Message[]): void {
    this.messages = messages;
  }

  appendTextToLastMessage(text: string): boolean {
    if (this.messages.length === 0) return false;
    const last = this.messages[this.messages.length - 1];
    if (last.role === 'user') {
      if (typeof last.content === 'string') {
        last.content = last.content + '\n\n[用户补充] ' + text;
      } else if (Array.isArray(last.content)) {
        last.content.push({ type: 'text', text: '\n\n[用户补充] ' + text });
      }
      return true;
    }
    return false;
  }

  getHistoryLength(): number {
    return this.messages.length;
  }

  getHistory(): Message[] {
    return this.messages;
  }

  getTokenUsage(): TokenUsage {
    return this.tokenCounter.getTotalUsage();
  }

  updateSystemPrompt(prompt: string): void {
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages[0] = { role: 'system', content: prompt };
    } else {
      this.messages.unshift({ role: 'system', content: prompt });
    }
  }

  setSystemPrompt(prompt: string): void {
    this.updateSystemPrompt(prompt);
  }

  checkBudget(): BudgetStatus {
    const estimated = this.tokenCounter.estimate(this.messages);
    const maxInput = this.tokenCounter.getMaxInputTokens();
    const pct = maxInput > 0 ? estimated / maxInput : 0;

    if (pct >= RED_THRESHOLD) {
      return { level: 'red', usagePercent: pct, requiredAction: 'compress' };
    }
    if (pct >= YELLOW_THRESHOLD) {
      return {
        level: 'yellow',
        usagePercent: pct,
        suggestion: `上下文已达 ${Math.round(pct * 100)}%，建议提前压缩`,
      };
    }
    return { level: 'green', usagePercent: pct };
  }

  async compress(strategy: CompressionStrategy): Promise<CompressionResult> {
    const originalTokens = this.tokenCounter.estimate(this.messages);

    eventBus.emit(XuanjiEvent.CONTEXT_COMPRESSION_STARTED, {
      strategy,
      messageCount: this.messages.length,
      originalTokens,
    });

    let result: CompressionResult;
    switch (strategy) {
      case 'aggressive':
        result = this.aggressiveCompress(originalTokens);
        break;
      case 'summarize_early':
      case 'selective':
      default:
        result = this.simpleCompress(originalTokens);
        break;
    }

    eventBus.emit(XuanjiEvent.CONTEXT_COMPRESSION_DONE, {
      originalTokens: result.originalTokens,
      compressedTokens: result.compressedTokens,
      compressionRatio: result.compressionRatio,
    });

    return result;
  }

  private simpleCompress(originalTokens: number): CompressionResult {
    // 保留 system prompt + 最近 10 轮用户对话
    const systemMsg = this.messages[0];
    if (!systemMsg || this.messages.length < 10) {
      return {
        compressed: [...this.messages],
        originalTokens,
        compressedTokens: originalTokens,
        compressionRatio: 0,
        summary: '',
      };
    }

    // 从后往前数 10 个 user 消息
    let userCount = 0;
    let boundary = 1;
    for (let i = this.messages.length - 1; i >= 1; i--) {
      if (this.messages[i].role === 'user') {
        userCount++;
        if (userCount >= 10) { boundary = i; break; }
      }
    }

    const oldCount = boundary - 1;
    if (oldCount <= 0) {
      return {
        compressed: [...this.messages],
        originalTokens,
        compressedTokens: originalTokens,
        compressionRatio: 0,
        summary: '',
      };
    }

    const summaryMsg: Message = {
      role: 'user',
      content: `[上下文摘要] 之前 ${oldCount} 条消息已压缩。`,
    };
    const compressed = [systemMsg, summaryMsg, ...this.messages.slice(boundary)];
    const compressedTokens = this.tokenCounter.estimate(compressed);

    this.messages = compressed;
    return {
      compressed,
      originalTokens,
      compressedTokens,
      compressionRatio: originalTokens > 0 ? (originalTokens - compressedTokens) / originalTokens : 0,
      summary: `压缩了 ${oldCount} 条旧消息`,
    };
  }

  private aggressiveCompress(originalTokens: number): CompressionResult {
    const systemMsg = this.messages[0];
    if (!systemMsg || this.messages.length < 6) {
      return {
        compressed: [...this.messages],
        originalTokens,
        compressedTokens: originalTokens,
        compressionRatio: 0,
        summary: '',
      };
    }

    // 只保留 system + 最近 2 轮用户对话
    let userCount = 0;
    let boundary = 1;
    for (let i = this.messages.length - 1; i >= 1; i--) {
      if (this.messages[i].role === 'user') {
        userCount++;
        if (userCount >= 2) { boundary = i; break; }
      }
    }

    const dropped = boundary - 1;
    const compressed = [systemMsg, ...this.messages.slice(boundary)];
    const compressedTokens = this.tokenCounter.estimate(compressed);

    this.messages = compressed;
    return {
      compressed,
      originalTokens,
      compressedTokens,
      compressionRatio: originalTokens > 0 ? (originalTokens - compressedTokens) / originalTokens : 0,
      summary: `激进压缩：丢弃 ${dropped} 条旧消息`,
    };
  }

  snapshot(): number {
    this.snapshots.push([...this.messages]);
    return this.snapshots.length - 1;
  }

  rollback(snapshotIndex: number): void {
    if (snapshotIndex >= 0 && snapshotIndex < this.snapshots.length) {
      this.messages = [...this.snapshots[snapshotIndex]];
      this.snapshots = this.snapshots.slice(0, snapshotIndex);
    }
  }

  clear(): void {
    const systemMsg = this.messages.length > 0 && this.messages[0].role === 'system'
      ? [this.messages[0]]
      : [];
    this.messages = systemMsg;
  }

  getTokenCount(): number {
    return this.tokenCounter.estimate(this.messages);
  }

  recordUsage(usage: TokenUsage): void {
    this.tokenCounter.recordUsage(usage);
  }

  getUsage(): TokenUsage {
    return this.tokenCounter.getTotalUsage();
  }
}
