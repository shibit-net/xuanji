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

/** 上下文硬上限（字节）：超过此值自动触发压缩 */
const MAX_CONTEXT_BYTES = 1_000_000; // ~1MB
/** 快照最大数量 */
const MAX_SNAPSHOTS = 10;

/** 归档代理接口：压缩时将旧消息委派给外部存储，返回 LLM 生成的叙事摘要 */
export interface ArchiveDelegate {
  archiveMessages(messages: Message[]): Promise<string>;
}

export class ContextManager {
  private messages: Message[] = [];
  private snapshots: Message[][] = [];
  private tokenCounter: TokenCounter;
  private archiveDelegate: ArchiveDelegate | null = null;

  constructor(maxContextTokens?: number, reservedOutputTokens?: number) {
    this.tokenCounter = new TokenCounter(maxContextTokens, reservedOutputTokens);
  }

  /** 设置归档代理（如 SessionManager），压缩前将旧消息委派出去保存 */
  setArchiveDelegate(delegate: ArchiveDelegate | null): void {
    this.archiveDelegate = delegate;
  }

  getMessages(): Message[] {
    return this.messages;
  }

  addMessage(message: Message): void {
    this.messages.push(message);
  }

  private async checkAndAutoCompress(): Promise<void> {
    // 估算上下文字节数（UTF-8 编码长度），超过硬上限时触发激进压缩
    const byteSize = this.estimateContextBytes();
    if (byteSize > MAX_CONTEXT_BYTES) {
      const oldTokens = this.tokenCounter.estimate(this.messages);
      await this.aggressiveCompress(oldTokens);
      eventBus.emitSync(XuanjiEvent.CONTEXT_COMPRESSION_DONE, {
        originalTokens: oldTokens,
        compressedTokens: this.tokenCounter.estimate(this.messages),
        compressionRatio: 0,
      });
    }
  }

  /** 估算当前上下文的字节数（UTF-8 编码长度） */
  private estimateContextBytes(): number {
    let total = 0;
    for (const msg of this.messages) {
      if (typeof msg.content === 'string') {
        total += Buffer.byteLength(msg.content, 'utf-8');
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.text) total += Buffer.byteLength(block.text, 'utf-8');
          if (block.content) total += Buffer.byteLength(block.content, 'utf-8');
          if (block.input) total += Buffer.byteLength(JSON.stringify(block.input), 'utf-8');
        }
      }
    }
    return total;
  }

  addUserMessage(text: string): void {
    this.messages.push({ role: 'user', content: text });
    // fire-and-forget: addMessage 是同步调用路径，自动压缩异步执行
    this.checkAndAutoCompress().catch(() => {});
  }

  addAssistantMessage(blocks: ContentBlock[]): void {
    this.messages.push({ role: 'assistant', content: blocks });
    this.checkAndAutoCompress().catch(() => {});
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

  /** 压缩最后一条子 agent 的 tool_result：用摘要替换完整输出，释放上下文预算 */
  compressLastSubAgentOutput(summary: string): void {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result' && typeof block.content === 'string' && block.content.includes('[Sub-agent completed]')) {
            // 提取 meta 行（保留执行统计信息）
            const metaMatch = block.content.match(/^\[Sub-agent completed\].*?(?=\n)/);
            const meta = metaMatch ? metaMatch[0] : '[Sub-agent completed]';
            block.content = `${meta}\n\n[📋 执行摘要]\n${summary}`;
            return;
          }
        }
      }
    }
  }

  /** 追加一段内容到 system prompt 末尾。如果 key 已存在则替换不追加。suffix 为空字符串时清除该 key 的内容。 */
  setSystemPromptSuffix(suffix: string, key: string): void {
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      let current = typeof this.messages[0].content === 'string' ? this.messages[0].content : '';
      // 用 key 标记替换：查找已有标记并替换，否则追加
      const marker = `<!-- suffix:${key} -->`;
      const startTag = `${marker}\n`;
      const endTag = `\n<!-- /suffix:${key} -->`;
      const startIdx = current.indexOf(startTag);
      const endIdx = current.indexOf(endTag);
      if (startIdx !== -1 && endIdx !== -1) {
        if (suffix) {
          // 替换已有的 key 内容
          current = current.slice(0, startIdx) + startTag + suffix + current.slice(endIdx);
        } else {
          // 清除该 key 的内容（包括标记）
          current = current.slice(0, startIdx) + current.slice(endIdx + endTag.length);
        }
        this.messages[0] = { role: 'system', content: current };
      } else if (suffix) {
        // 追加新 key
        this.messages[0] = { role: 'system', content: current + '\n\n' + startTag + suffix + endTag };
      }
    }
  }

  /** 按 key 清除 system prompt 中的某些标记内容 */
  clearSystemPromptSuffix(key: string): void {
    // 暂不实现，保留接口
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

    eventBus.emitSync(XuanjiEvent.CONTEXT_COMPRESSION_STARTED, {
      strategy,
      messageCount: this.messages.length,
      originalTokens,
    });

    let result: CompressionResult;
    switch (strategy) {
      case 'aggressive':
        result = await this.aggressiveCompress(originalTokens);
        break;
      case 'summarize_early':
      case 'selective':
      default:
        result = await this.simpleCompress(originalTokens);
        break;
    }

    eventBus.emitSync(XuanjiEvent.CONTEXT_COMPRESSION_DONE, {
      originalTokens: result.originalTokens,
      compressedTokens: result.compressedTokens,
      compressionRatio: result.compressionRatio,
    });

    return result;
  }

  /** 检查消息是否包含 tool_result，用于防止压缩拆散 tool_call/tool_result 对 */
  private isToolResultMessage(msg: Message): boolean {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return false;
    return (msg.content as ContentBlock[]).some(b => b.type === 'tool_result');
  }

  /** 检查消息是否包含 tool_use，用于防止压缩拆散 tool_call/tool_result 对 */
  private isToolUseMessage(msg: Message): boolean {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return false;
    return (msg.content as ContentBlock[]).some(b => b.type === 'tool_use');
  }

  /** 找到指定 tool_result 消息前面最近的 assistant tool_use 消息索引 */
  private findPrecedingToolUse(toolResultIdx: number): number {
    for (let i = toolResultIdx - 1; i >= 1; i--) {
      if (this.isToolUseMessage(this.messages[i])) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 向上调整 boundary，确保 boundary 之后保留的 tool_result 消息
   * 都能找到对应的 tool_use 消息（不被丢弃在 boundary 之前）
   */
  private adjustBoundaryForToolPairs(boundary: number): number {
    let adjusted = boundary;
    for (let i = boundary; i < this.messages.length; i++) {
      if (!this.isToolResultMessage(this.messages[i])) continue;
      const pairIdx = this.findPrecedingToolUse(i);
      if (pairIdx >= 0 && pairIdx < adjusted) {
        adjusted = pairIdx;
      }
    }
    return adjusted;
  }

  private async simpleCompress(originalTokens: number): Promise<CompressionResult> {
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

    // 防止拆散 tool_call/tool_result 对：确保 boundary 之后的 tool_result 都有对应的 tool_use
    boundary = this.adjustBoundaryForToolPairs(boundary);

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

    // 归档旧消息并获取 LLM 生成的叙事摘要
    let summaryText = '';
    if (this.archiveDelegate) {
      summaryText = await this.archiveDelegate.archiveMessages(this.messages.slice(0, boundary));
    }

    const summaryMsg: Message = {
      role: 'user',
      content: summaryText || `[上下文摘要] 之前 ${oldCount} 条消息已压缩。`,
    };
    const compressed = [systemMsg, summaryMsg, ...this.messages.slice(boundary)];
    const compressedTokens = this.tokenCounter.estimate(compressed);

    this.messages = compressed;
    return {
      compressed,
      originalTokens,
      compressedTokens,
      compressionRatio: originalTokens > 0 ? (originalTokens - compressedTokens) / originalTokens : 0,
      summary: summaryText || `压缩了 ${oldCount} 条旧消息`,
    };
  }

  private async aggressiveCompress(originalTokens: number): Promise<CompressionResult> {
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

    // 防止拆散 tool_call/tool_result 对：确保 boundary 之后的 tool_result 都有对应的 tool_use
    boundary = this.adjustBoundaryForToolPairs(boundary);

    const dropped = boundary - 1;
    // 归档旧消息并获取 LLM 生成的叙事摘要
    let summaryText = '';
    if (this.archiveDelegate) {
      summaryText = await this.archiveDelegate.archiveMessages(this.messages.slice(0, boundary));
    }

    const summaryMsg: Message = {
      role: 'user',
      content: summaryText || `[上下文摘要] 之前 ${dropped} 条消息已压缩。`,
    };
    const compressed = [systemMsg, summaryMsg, ...this.messages.slice(boundary)];
    const compressedTokens = this.tokenCounter.estimate(compressed);

    this.messages = compressed;
    return {
      compressed,
      originalTokens,
      compressedTokens,
      compressionRatio: originalTokens > 0 ? (originalTokens - compressedTokens) / originalTokens : 0,
      summary: summaryText || `激进压缩：丢弃 ${dropped} 条旧消息`,
    };
  }

  snapshot(): number {
    this.snapshots.push([...this.messages]);
    // 超过上限时移除最旧的快照
    while (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots.shift();
    }
    return this.snapshots.length - 1;
  }

  rollback(snapshotIndex: number): void {
    if (snapshotIndex >= 0 && snapshotIndex < this.snapshots.length) {
      this.messages = [...this.snapshots[snapshotIndex]];
      this.snapshots = this.snapshots.slice(0, snapshotIndex);
    }
  }

  /**
   * 修复孤立 tool_use 块：扫描全部消息历史，移除没有对应 tool_result 的 tool_use 块。
   *
   * Anthropic API 要求每个 assistant 消息中的 tool_use 块必须在紧随其后的 user
   * 消息中有匹配的 tool_result 块，否则返回 400 错误。
   *
   * 孤立块产生场景：
   * 1. AgentLoop 在 addAssistantMessage 之后、addToolResults 之前被中断
   * 2. 后续消息追加后，孤儿 tool_use 残留在历史中间，repairOrphanedToolUse 的末尾检查会漏掉
   *
   * @returns 被修复的 tool_use id 列表（用于日志）
   */
  repairOrphanedToolUses(): string[] {
    const removedIds: string[] = [];
    let i = 0;

    while (i < this.messages.length) {
      const msg = this.messages[i];
      if (msg.role !== 'assistant' || !Array.isArray(msg.content)) {
        i++;
        continue;
      }

      const content = msg.content as ContentBlock[];
      const toolUseBlocks = content.filter(b => b.type === 'tool_use' && b.id);
      if (toolUseBlocks.length === 0) {
        i++;
        continue;
      }

      const toolUseIds = new Set(toolUseBlocks.map(b => b.id!));

      // 检查下一条消息是否包含匹配的 tool_result
      const next = this.messages[i + 1];
      const hasValidResults = next
        && next.role === 'user'
        && Array.isArray(next.content)
        && toolUseIds.size > 0
        && [...toolUseIds].every(id =>
          (next.content as ContentBlock[]).some(
            b => b.type === 'tool_result' && b.tool_use_id === id,
          ),
        );

      if (!hasValidResults) {
        // 移除孤立的 tool_use 块
        for (const id of toolUseIds) {
          removedIds.push(id);
        }
        const cleaned = content.filter(b => b.type !== 'tool_use' || !b.id);
        if (cleaned.length === 0) {
          // 整个消息只剩 tool_use 块，移除整条消息
          this.messages.splice(i, 1);
          continue; // 不递增 i，继续检查同一位置的下一条消息
        } else {
          this.messages[i] = { ...msg, content: cleaned };
        }
      }
      i++;
    }

    return removedIds;
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
