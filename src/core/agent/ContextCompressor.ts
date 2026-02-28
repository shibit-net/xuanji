// ============================================================
// M2 Agent — 上下文压缩器
// ============================================================

import type {
  Message,
  ContentBlock,
  CompressorConfig,
  MessageGroup,
  CompressionResult,
  ILLMProvider,
  ProviderConfig,
} from '@/core/types';
import type { TokenManager } from './TokenManager';
import { logger } from '@/core/logger';
import type { HookRegistry } from '@/hooks/HookRegistry';

/** 决策关键词模式（中文） */
const DECISION_PATTERNS_ZH = /(?:选择|决定|采用|使用|改为|切换到|迁移到|升级到)\s*[^\n。]{3,}/g;

/** 决策关键词模式（英文） */
const DECISION_PATTERNS_EN = /(?:decided?\s+to|chose?\s+to|switched?\s+to|adopted?|using)\s+[^\n.]{3,}/gi;

/** 默认压缩器配置 */
export const DEFAULT_COMPRESSOR_CONFIG: CompressorConfig = {
  enabled: true,
  keepRecentRounds: 5,
  compressionThreshold: 0.8,
  minMessagesToCompress: 10,
  summaryMaxLength: 2000,
};

/** LLM 结构化压缩 Prompt */
const COMPRESSION_PROMPT = `You are a conversation compressor for an AI coding assistant. Compress the following conversation into a structured summary using the EXACT template below. Write in the SAME LANGUAGE as the conversation.

## Template (fill each section, skip if empty):

**1. Primary Request & Intent**
[What the user asked for and why, in 1-2 sentences]

**2. Implementation Path**
[Key technical decisions, approaches chosen, architecture patterns]

**3. Key Files Modified/Created**
[Exact file paths with brief description of changes, max 10]

**4. Errors & Fixes**
[Errors encountered and how they were resolved]

**5. Current Progress**
[What's done, what's in progress, what remains]

**6. User Preferences**
[Coding style, tool preferences, workflow preferences discovered]

**7. Important Context**
[Constraints, environment details, dependencies, configurations]

**8. Open Questions**
[Unresolved decisions, pending user input needed]

Rules:
- Keep total summary under 1500 characters
- Preserve EXACT file paths, command names, error messages, and variable names
- Use bullet points within sections for clarity
- Skip sections that have no relevant content
- Do NOT include greetings, acknowledgments, or filler
- Output the structured summary directly, no markdown code blocks wrapping it`;

/**
 * 上下文压缩器
 *
 * 在 TokenManager 硬截断之前，智能压缩旧消息为摘要，保留关键信息。
 *
 * 压缩策略：
 * 1. system prompt — 永不压缩
 * 2. 最近 N 轮对话 — 保持完整
 * 3. 中间旧消息 — 压缩为摘要（user/assistant 消息对 → 摘要，连续工具调用 → 聚合）
 *
 * 支持 LLM 语义压缩（优先）和规则压缩（降级）。
 */
export class ContextCompressor {
  private log = logger.child({ module: 'ContextCompressor' });
  private config: CompressorConfig;
  private provider: ILLMProvider | null = null;
  private providerConfig: ProviderConfig | null = null;
  private hookRegistry: HookRegistry | null = null;

  constructor(config?: Partial<CompressorConfig>) {
    this.config = { ...DEFAULT_COMPRESSOR_CONFIG, ...config };
  }

  /**
   * 注入 LLM Provider（启用 LLM 语义压缩）
   */
  setProvider(provider: ILLMProvider, config: ProviderConfig): void {
    this.provider = provider;
    this.providerConfig = config;
  }

  /** 注入 HookRegistry */
  setHookRegistry(hookRegistry: HookRegistry): void {
    this.hookRegistry = hookRegistry;
  }

  /**
   * 压缩消息数组（异步版本，支持 LLM 压缩）
   * @param customInstruction 用户自定义保留指令（如 "特别保留文件路径和错误信息"）
   */
  async compressAsync(messages: Message[], tokenManager: TokenManager, customInstruction?: string): Promise<CompressionResult> {
    const originalTokens = tokenManager.estimateTokens(messages);

    if (!this.shouldCompress(messages, tokenManager)) {
      return {
        compressed: messages,
        originalTokens,
        compressedTokens: originalTokens,
        compressionRatio: 0,
        summary: '',
      };
    }

    // 触发 PreCompact Hook
    if (this.hookRegistry) {
      this.hookRegistry.emit('PreCompact', {
        originalTokens,
      }).catch(() => {});
    }

    const systemMsg = messages[0];
    if (!systemMsg) {
      return {
        compressed: messages,
        originalTokens,
        compressedTokens: originalTokens,
        compressionRatio: 0,
        summary: '',
      };
    }
    const rest = messages.slice(1);
    const recentBoundary = this.findRecentBoundary(rest, this.config.keepRecentRounds);
    const oldMessages = rest.slice(0, recentBoundary);
    const recentMessages = rest.slice(recentBoundary);

    if (oldMessages.length === 0) {
      return {
        compressed: messages,
        originalTokens,
        compressedTokens: originalTokens,
        compressionRatio: 0,
        summary: '',
      };
    }

    const groups = this.groupMessages(oldMessages);

    // 优先使用 LLM 语义压缩，失败降级到规则压缩
    let summaryText: string;
    if (this.provider && this.providerConfig) {
      summaryText = await this.buildSummaryWithLLM(oldMessages, customInstruction);
    } else {
      summaryText = this.buildSummary(groups, oldMessages);
    }

    const summaryMessage: Message = {
      role: 'user',
      content: summaryText.slice(0, this.config.summaryMaxLength),
    };

    const compressed = [systemMsg, summaryMessage, ...recentMessages];
    const compressedTokens = tokenManager.estimateTokens(compressed);
    const compressionRatio = originalTokens > 0
      ? (originalTokens - compressedTokens) / originalTokens
      : 0;

    const roundRange = this.describeCompressedRange(groups);

    this.log.info(
      `Compressed ${oldMessages.length} messages → 1 summary ` +
      `(${originalTokens} → ${compressedTokens} tokens, ${Math.round(compressionRatio * 100)}%)`,
    );

    // 触发 PostCompact Hook
    if (this.hookRegistry) {
      this.hookRegistry.emit('PostCompact', {
        originalTokens,
        compressedTokens,
      }).catch(() => {});
    }

    return {
      compressed,
      originalTokens,
      compressedTokens,
      compressionRatio,
      summary: roundRange,
    };
  }

  /**
   * 压缩消息数组（同步版本，仅规则压缩，向后兼容）
   */
  compress(messages: Message[], tokenManager: TokenManager): CompressionResult {
    const originalTokens = tokenManager.estimateTokens(messages);

    // 不需要压缩的情况
    if (!this.shouldCompress(messages, tokenManager)) {
      return {
        compressed: messages,
        originalTokens,
        compressedTokens: originalTokens,
        compressionRatio: 0,
        summary: '',
      };
    }

    // 分离 system prompt
    const systemMsg = messages[0];
    if (!systemMsg) {
      return {
        compressed: messages,
        originalTokens,
        compressedTokens: originalTokens,
        compressionRatio: 0,
        summary: '',
      };
    }
    const rest = messages.slice(1);

    // 计算保留最近 N 轮的消息边界
    const recentBoundary = this.findRecentBoundary(rest, this.config.keepRecentRounds);
    const oldMessages = rest.slice(0, recentBoundary);
    const recentMessages = rest.slice(recentBoundary);

    // 如果没有可压缩的旧消息，直接返回
    if (oldMessages.length === 0) {
      return {
        compressed: messages,
        originalTokens,
        compressedTokens: originalTokens,
        compressionRatio: 0,
        summary: '',
      };
    }

    // 对旧消息进行分组
    const groups = this.groupMessages(oldMessages);

    // 生成摘要
    const summaryText = this.buildSummary(groups, oldMessages);

    // 创建摘要消息（作为 user 消息注入，让 LLM 理解上下文）
    const summaryMessage: Message = {
      role: 'user',
      content: summaryText.slice(0, this.config.summaryMaxLength),
    };

    // 组装压缩后的消息
    const compressed = [systemMsg, summaryMessage, ...recentMessages];
    const compressedTokens = tokenManager.estimateTokens(compressed);
    const compressionRatio = originalTokens > 0
      ? (originalTokens - compressedTokens) / originalTokens
      : 0;

    // 计算被压缩的轮次范围
    const roundRange = this.describeCompressedRange(groups);

    this.log.info(
      `Compressed ${oldMessages.length} messages → 1 summary ` +
      `(${originalTokens} → ${compressedTokens} tokens, ${Math.round(compressionRatio * 100)}%)`,
    );

    return {
      compressed,
      originalTokens,
      compressedTokens,
      compressionRatio,
      summary: roundRange,
    };
  }

  /**
   * 检查是否需要压缩
   */
  shouldCompress(messages: Message[], tokenManager: TokenManager): boolean {
    if (!this.config.enabled) return false;

    // 消息数量不足
    if (messages.length < this.config.minMessagesToCompress) return false;

    // Token 数量未超过阈值
    const maxInputTokens = tokenManager.getMaxInputTokens();
    const estimatedTokens = tokenManager.estimateTokens(messages);
    if (estimatedTokens < maxInputTokens * this.config.compressionThreshold) return false;

    // 检查是否有可压缩消息（排除 system prompt 和最近 N 轮）
    const rest = messages.slice(1);
    const recentBoundary = this.findRecentBoundary(rest, this.config.keepRecentRounds);
    return recentBoundary > 0;
  }

  // ────────── LLM 语义压缩 ──────────

  /**
   * 使用 LLM 生成语义摘要，失败降级到规则摘要
   */
  private async buildSummaryWithLLM(oldMessages: Message[], customInstruction?: string): Promise<string> {
    try {
      const conversationText = this.messagesToText(oldMessages);
      // 限制输入长度，避免 LLM 调用过大
      const truncated = conversationText.slice(0, 12000);

      // 拼接自定义保留指令
      let prompt = COMPRESSION_PROMPT;
      if (customInstruction) {
        prompt += `\n\n**IMPORTANT — User's custom retention instruction:**\n${customInstruction}\nPrioritize preserving information related to this instruction.`;
      }

      const messages: Message[] = [
        { role: 'user', content: `${prompt}\n\n---\n\n${truncated}` },
      ];

      const stream = this.provider!.stream(messages, [], {
        ...this.providerConfig!,
        maxTokens: 1500,
        temperature: 0.2,
      });

      let responseText = '';
      for await (const event of stream) {
        if (event.type === 'text_delta' && event.text) {
          responseText += event.text;
        }
      }

      if (responseText.trim().length > 20) {
        this.log.debug(`LLM compression generated ${responseText.length} chars summary`);
        return `[上下文摘要 - AI 生成]\n${responseText.trim()}`;
      }

      // LLM 返回太短，降级
      this.log.warn('LLM compression returned too short, falling back to rule-based');
    } catch (err) {
      this.log.warn('LLM compression failed, falling back to rule-based:', err);
    }

    // 降级到规则压缩
    const groups = this.groupMessages(oldMessages);
    return this.buildSummary(groups, oldMessages);
  }

  /**
   * 将消息数组转为可读文本（供 LLM 分析）
   */
  private messagesToText(messages: Message[]): string {
    const lines: string[] = [];
    for (const msg of messages) {
      const text = this.getMessageText(msg);
      if (text) {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        lines.push(`${role}: ${text.slice(0, 500)}`);
      }
      // 提取工具调用信息
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use' && block.name) {
            const input = block.input ? JSON.stringify(block.input).slice(0, 200) : '';
            lines.push(`  [Tool: ${block.name}] ${input}`);
          }
        }
      }
    }
    return lines.join('\n');
  }

  // ────────── 消息分组 ──────────

  /**
   * 将旧消息分组为 conversation 或 tool_sequence
   */
  groupMessages(messages: Message[]): MessageGroup[] {
    const groups: MessageGroup[] = [];
    let i = 0;

    while (i < messages.length) {
      const msg = messages[i]!;

      // 检查是否是工具调用序列（assistant 含 tool_use + 紧跟 user 含 tool_result）
      if (msg.role === 'assistant' && this.hasToolUse(msg)) {
        const seqStart = i;
        // 收集连续的工具调用-结果对
        while (i < messages.length) {
          const current = messages[i]!;
          if (current.role === 'assistant' && this.hasToolUse(current)) {
            i++;
            // 收集对应的 tool_result（user 消息）
            if (i < messages.length && messages[i]!.role === 'user' && this.hasToolResult(messages[i]!)) {
              i++;
            }
          } else {
            break;
          }
        }
        groups.push({
          type: 'tool_sequence',
          startIndex: seqStart,
          endIndex: i - 1,
          messages: messages.slice(seqStart, i),
        });
        continue;
      }

      // 对话消息（user + assistant 对）
      if (msg.role === 'user' || msg.role === 'assistant') {
        const convStart = i;
        // 收集连续的对话消息（非工具调用）
        while (i < messages.length) {
          const current = messages[i]!;
          if (current.role === 'assistant' && this.hasToolUse(current)) break;
          if (current.role === 'user' && this.hasToolResult(current)) break;
          i++;
        }
        if (i > convStart) {
          groups.push({
            type: 'conversation',
            startIndex: convStart,
            endIndex: i - 1,
            messages: messages.slice(convStart, i),
          });
          continue;
        }
      }

      // 其他未分类消息，作为单独的 conversation 组
      groups.push({
        type: 'conversation',
        startIndex: i,
        endIndex: i,
        messages: [msg],
      });
      i++;
    }

    return groups;
  }

  // ────────── 摘要生成 ──────────

  /**
   * 根据分组生成压缩摘要
   */
  private buildSummary(groups: MessageGroup[], allOldMessages: Message[]): string {
    const parts: string[] = [];

    // 标题
    const roundCount = this.countConversationRounds(allOldMessages);
    parts.push(`[上下文摘要] 以下是之前 ${roundCount} 轮对话的压缩摘要：\n`);

    // 提取关键信息
    const userNeeds = this.extractUserNeeds(allOldMessages);
    if (userNeeds.length > 0) {
      parts.push(`用户需求: ${userNeeds.join('; ')}`);
    }

    const decisions = this.extractDecisions(allOldMessages);
    if (decisions.length > 0) {
      parts.push(`关键决策: ${decisions.join('; ')}`);
    }

    const filePaths = this.extractFilePaths(allOldMessages);
    if (filePaths.length > 0) {
      parts.push(`涉及文件: ${filePaths.join(', ')}`);
    }

    // 工具调用聚合
    const toolSummary = this.aggregateToolCalls(allOldMessages);
    if (toolSummary) {
      parts.push(`工具使用: ${toolSummary}`);
    }

    return parts.join('\n');
  }

  /**
   * 提取用户需求（从 user 消息中提取前几条核心需求）
   */
  private extractUserNeeds(messages: Message[]): string[] {
    const needs: string[] = [];
    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      const text = this.getMessageText(msg);
      if (!text || text.length < 5) continue;
      // 跳过纯工具结果消息
      if (this.hasToolResult(msg)) continue;
      needs.push(text.slice(0, 150));
      if (needs.length >= 3) break;
    }
    return needs;
  }

  /**
   * 提取关键决策（正则匹配"决定/采用/选择"等）
   */
  private extractDecisions(messages: Message[]): string[] {
    const decisions: string[] = [];
    const allText = messages
      .map((m) => this.getMessageText(m))
      .filter(Boolean)
      .join('\n');

    const zhMatches = allText.match(DECISION_PATTERNS_ZH);
    if (zhMatches) {
      for (const match of zhMatches.slice(0, 3)) {
        decisions.push(match.trim());
      }
    }

    const enMatches = allText.match(DECISION_PATTERNS_EN);
    if (enMatches) {
      for (const match of enMatches.slice(0, 2)) {
        decisions.push(match.trim());
      }
    }

    return decisions.slice(0, 5);
  }

  /**
   * 从工具调用中提取涉及的文件路径
   */
  private extractFilePaths(messages: Message[]): string[] {
    const paths = new Set<string>();
    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block.type === 'tool_use' && block.input) {
          const path = block.input['file_path'] ?? block.input['path'] ?? block.input['filePath'];
          if (typeof path === 'string') paths.add(path);
        }
        if (block.type === 'tool_result' && block.content) {
          // 从 tool_result 内容中提取文件路径引用
          const fileMatch = block.content.match(/(?:^|\s)((?:[\w.-]+\/)+[\w.-]+\.\w+)/);
          if (fileMatch?.[1]) paths.add(fileMatch[1]);
        }
      }
    }
    return [...paths].slice(0, 10);
  }

  /**
   * 聚合工具调用统计
   */
  private aggregateToolCalls(messages: Message[]): string {
    const toolStats = new Map<string, { count: number; files: Set<string> }>();

    for (const msg of messages) {
      if (!Array.isArray(msg.content)) continue;
      for (const block of msg.content) {
        if (block.type !== 'tool_use' || !block.name) continue;
        const existing = toolStats.get(block.name) ?? { count: 0, files: new Set() };
        existing.count++;
        const path = block.input?.['file_path'] ?? block.input?.['path'];
        if (typeof path === 'string') existing.files.add(path);
        toolStats.set(block.name, existing);
      }
    }

    if (toolStats.size === 0) return '';

    const parts: string[] = [];
    for (const [name, stats] of toolStats) {
      parts.push(`${name} (${stats.count}次)`);
    }
    return parts.join(', ');
  }

  // ────────── 工具方法 ──────────

  /**
   * 找到最近 N 轮对话的起始边界（从末尾往回数 N 个 user 消息）
   */
  private findRecentBoundary(messages: Message[], keepRounds: number): number {
    let userCount = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === 'user' && !this.hasToolResult(messages[i]!)) {
        userCount++;
        if (userCount >= keepRounds) {
          return i;
        }
      }
    }
    // 不足 N 轮，不压缩
    return 0;
  }

  /**
   * 计算对话轮次数（以 user 消息为准，排除纯 tool_result）
   */
  private countConversationRounds(messages: Message[]): number {
    let count = 0;
    for (const msg of messages) {
      if (msg.role === 'user' && !this.hasToolResult(msg)) {
        count++;
      }
    }
    return count;
  }

  /**
   * 检查消息是否包含 tool_use 块
   */
  private hasToolUse(msg: Message): boolean {
    if (!Array.isArray(msg.content)) return false;
    return msg.content.some((b) => b.type === 'tool_use');
  }

  /**
   * 检查消息是否包含 tool_result 块
   */
  private hasToolResult(msg: Message): boolean {
    if (!Array.isArray(msg.content)) return false;
    return msg.content.some((b) => b.type === 'tool_result');
  }

  /**
   * 提取消息中的文本内容
   */
  private getMessageText(msg: Message): string {
    if (typeof msg.content === 'string') return msg.content;
    return msg.content
      .filter((b): b is ContentBlock & { text: string } => b.type === 'text' && !!b.text)
      .map((b) => b.text)
      .join('\n');
  }

  /**
   * 描述被压缩的范围
   */
  private describeCompressedRange(groups: MessageGroup[]): string {
    if (groups.length === 0) return '';
    const totalMessages = groups.reduce((sum, g) => sum + g.messages.length, 0);
    const convGroups = groups.filter((g) => g.type === 'conversation');
    const toolGroups = groups.filter((g) => g.type === 'tool_sequence');
    const parts: string[] = [`压缩了 ${totalMessages} 条消息`];
    if (convGroups.length > 0) parts.push(`${convGroups.length} 组对话`);
    if (toolGroups.length > 0) parts.push(`${toolGroups.length} 组工具调用`);
    return parts.join(', ');
  }
}
