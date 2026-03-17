// ============================================================
// M4 记忆系统 — 智能记忆刷新（OpenClaw 启发）
// ============================================================

import type { Message, MessageRole } from '@/core/types';
import type { ILLMProvider, ProviderConfig } from '@/core/types';
import type { MemoryEntry, MemoryEntryType } from './types';
import type { MemoryManager } from './MemoryManager';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'intelligent-flush' });

/** 片段分类 */
export type SegmentCategory = 'topic' | 'timeline' | 'discard';

/** 评估片段 */
export interface EvaluationSegment {
  /** 分类：topic（可复用知识）/ timeline（上下文）/ discard（低价值） */
  category: SegmentCategory;
  /** 内容（原始或提取后的） */
  content: string;
  /** 所属主题 ID（仅 topic） */
  topicId?: string;
  /** 记忆类型 */
  memoryType?: MemoryEntryType;
  /** 重要性 */
  importance?: 'high' | 'medium' | 'low';
  /** 置信度（0-1） */
  confidence?: number;
  /** 价值评分（0-100） */
  valueScore?: number;
}

/** 评估结果 */
export interface Evaluation {
  /** 片段列表 */
  segments: EvaluationSegment[];
  /** 总价值评分 */
  totalValue: number;
  /** 评估摘要 */
  summary: string;
}

/** 刷新上下文 */
export interface FlushContext {
  /** 消息历史 */
  messages: Message[];
  /** 当前 token 数 */
  currentTokens: number;
  /** 最大 token 数 */
  maxTokens: number;
  /** 距离上次刷新的时间（毫秒） */
  timeSinceLastFlush: number;
  /** 会话 ID */
  sessionId?: string;
}

/** 刷新配置 */
export interface FlushConfig {
  /** Token 阈值（0-1，默认 0.75） */
  tokenThreshold?: number;
  /** 时间阈值（毫秒，默认 30 分钟） */
  timeThreshold?: number;
  /** 价值评分阈值（0-100，默认 50） */
  valueThreshold?: number;
  /** 自动丢弃低价值内容（默认 true） */
  autoDiscard?: boolean;
  /** 保留最近 N 条消息（默认 5） */
  keepRecentMessages?: number;
}

/**
 * 智能记忆刷新
 *
 * OpenClaw 启发 + LLM 价值评估：
 * - 触发条件：上下文 > 75% 或时间 > 30 分钟
 * - LLM 评估价值
 * - 分类归档：topic（可复用）/ timeline（上下文）/ discard（低价值）
 * - 清理消息历史
 */
export class IntelligentMemoryFlush {
  private llmProvider: ILLMProvider;
  private providerConfig: ProviderConfig;
  private memoryManager: MemoryManager;
  private config: Required<FlushConfig>;

  constructor(
    llmProvider: ILLMProvider,
    providerConfig: ProviderConfig,
    memoryManager: MemoryManager,
    config?: FlushConfig
  ) {
    this.llmProvider = llmProvider;
    this.providerConfig = {
      ...providerConfig,
      model: providerConfig.lightModel || providerConfig.model, // 优先使用轻量模型
      temperature: 0.3,
      maxTokens: 1000,
    };
    this.memoryManager = memoryManager;
    this.config = {
      tokenThreshold: config?.tokenThreshold ?? 0.75,
      timeThreshold: config?.timeThreshold ?? 30 * 60 * 1000, // 30 分钟
      valueThreshold: config?.valueThreshold ?? 50,
      autoDiscard: config?.autoDiscard ?? true,
      keepRecentMessages: config?.keepRecentMessages ?? 5,
    };
  }

  /**
   * 检查并刷新记忆
   *
   * @param context 刷新上下文
   * @returns 是否执行了刷新
   */
  async checkAndFlush(context: FlushContext): Promise<boolean> {
    // 1. 检查触发条件（借鉴 OpenClaw）
    const shouldFlush = this.shouldFlush(context);

    if (!shouldFlush) {
      return false;
    }

    log.info('Triggering intelligent memory flush', {
      currentTokens: context.currentTokens,
      maxTokens: context.maxTokens,
      timeSinceLastFlush: context.timeSinceLastFlush,
    });

    try {
      // 2. LLM 评估价值
      const evaluation = await this.evaluateMemoryValue(context.messages);

      log.debug('Memory evaluation completed', {
        segments: evaluation.segments.length,
        totalValue: evaluation.totalValue,
      });

      // 3. 分类归档
      const stats = await this.archiveSegments(evaluation.segments, context.sessionId);

      // 4. 清理消息历史（保留最近 N 条）
      this.pruneMessages(context.messages, this.config.keepRecentMessages);

      log.info('Memory flushed', stats);

      return true;
    } catch (err) {
      log.warn('Failed to flush memory:', err);
      return false;
    }
  }

  /**
   * 检查是否应该刷新
   */
  private shouldFlush(context: FlushContext): boolean {
    // 触发条件 1: 上下文超过阈值
    const tokenRatio = context.currentTokens / context.maxTokens;
    if (tokenRatio > this.config.tokenThreshold) {
      log.debug(`Token threshold exceeded: ${(tokenRatio * 100).toFixed(1)}%`);
      return true;
    }

    // 触发条件 2: 时间超过阈值
    if (context.timeSinceLastFlush > this.config.timeThreshold) {
      log.debug(`Time threshold exceeded: ${(context.timeSinceLastFlush / 60000).toFixed(1)} min`);
      return true;
    }

    return false;
  }

  /**
   * 使用 LLM 评估记忆价值
   *
   * 分析对话历史，识别：
   * - topic: 可复用的知识（用户偏好、项目事实、工具模式等）
   * - timeline: 需要保留的上下文（重要对话、决策过程）
   * - discard: 低价值内容（闲聊、重复、过时信息）
   */
  private async evaluateMemoryValue(messages: Message[]): Promise<Evaluation> {
    // 构建评估 prompt
    const prompt = this.buildEvaluationPrompt(messages);

    try {
      // 调用 LLM
      let response = '';
      for await (const event of this.llmProvider.stream(
        [{ role: 'user', content: prompt }],
        [],
        this.providerConfig
      )) {
        if (event.type === 'text_delta' && event.text) {
          response += event.text;
        }
      }

      // 解析 LLM 返回的 JSON
      const evaluation = this.parseEvaluation(response);

      log.debug('LLM evaluation successful', {
        segments: evaluation.segments.length,
        topics: evaluation.segments.filter(s => s.category === 'topic').length,
        timeline: evaluation.segments.filter(s => s.category === 'timeline').length,
        discard: evaluation.segments.filter(s => s.category === 'discard').length,
      });

      return evaluation;
    } catch (err) {
      log.warn('LLM evaluation failed, using fallback:', err);
      // 降级：将所有消息归为 timeline
      return this.fallbackEvaluation(messages);
    }
  }

  /**
   * 构建评估 prompt
   */
  private buildEvaluationPrompt(messages: Message[]): string {
    // 将消息转换为易读格式
    const conversation = messages
      .map((m, i) => {
        const role = m.role === 'user' ? 'User' : 'Assistant';
        const content = this.extractTextContent(m);
        return `[${i + 1}] ${role}: ${content}`;
      })
      .join('\n\n');

    return `
请分析以下对话，将内容分类为三类：

1. **topic**（可复用知识）：用户偏好、项目事实、工具使用模式、错误解决方案等
2. **timeline**（重要上下文）：需要保留的对话、决策过程、关键讨论
3. **discard**（低价值内容）：闲聊、重复信息、过时内容、无关紧要的内容

## 对话内容
${conversation}

## 输出格式
请以 JSON 格式输出评估结果，每个片段包含：
- category: "topic" | "timeline" | "discard"
- content: 提取的核心内容（简洁明了，1-2 句话）
- topicId: 主题 ID（仅 topic，如 "user-preferences", "project-knowledge", "debugging" 等）
- memoryType: 记忆类型（仅 topic，如 "user_preference", "project_fact", "tool_pattern", "error_resolution"）
- importance: "high" | "medium" | "low"
- valueScore: 价值评分（0-100）

示例：
\`\`\`json
{
  "segments": [
    {
      "category": "topic",
      "content": "User prefers Bun over npm for package management",
      "topicId": "user-preferences",
      "memoryType": "user_preference",
      "importance": "high",
      "valueScore": 90
    },
    {
      "category": "timeline",
      "content": "Discussed memory system architecture and decided to keep JSONL storage",
      "importance": "medium",
      "valueScore": 70
    },
    {
      "category": "discard",
      "content": "Greeting and small talk",
      "valueScore": 10
    }
  ],
  "totalValue": 85,
  "summary": "Extracted 1 user preference and 1 important decision, discarded 1 low-value segment"
}
\`\`\`

请直接输出 JSON，不要其他解释。
    `.trim();
  }

  /**
   * 解析 LLM 返回的评估结果
   */
  private parseEvaluation(response: string): Evaluation {
    try {
      // 提取 JSON（可能包裹在 ```json ... ``` 中）
      const jsonMatch = response.match(/```json\s*\n([\s\S]*?)\n```/) ||
                        response.match(/```\s*\n([\s\S]*?)\n```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;

      const parsed = JSON.parse(jsonStr.trim());

      // 验证格式
      if (!parsed.segments || !Array.isArray(parsed.segments)) {
        throw new Error('Invalid evaluation format: missing segments array');
      }

      return {
        segments: parsed.segments,
        totalValue: parsed.totalValue || 50,
        summary: parsed.summary || `Evaluated ${parsed.segments.length} segments`,
      };
    } catch (err) {
      log.warn('Failed to parse LLM evaluation:', err);
      throw err;
    }
  }

  /**
   * 降级评估（LLM 失败时）
   */
  private fallbackEvaluation(messages: Message[]): Evaluation {
    const segments: EvaluationSegment[] = messages
      .filter(m => m.role !== 'system') // 跳过系统消息
      .map(m => ({
        category: 'timeline' as const,
        content: this.extractTextContent(m).slice(0, 200), // 截断到 200 字符
        importance: 'medium' as const,
        valueScore: 60,
      }));

    return {
      segments,
      totalValue: 60,
      summary: `Fallback evaluation: ${segments.length} messages archived as timeline`,
    };
  }

  /**
   * 归档片段到记忆系统
   */
  private async archiveSegments(
    segments: EvaluationSegment[],
    sessionId?: string
  ): Promise<{
    total: number;
    topics: number;
    timeline: number;
    discarded: number;
  }> {
    const dayKey = this.getToday();
    const now = new Date().toISOString();
    const stats = { total: 0, topics: 0, timeline: 0, discarded: 0 };

    for (const segment of segments) {
      stats.total++;

      // 跳过低价值内容（discard 类型）
      if (segment.category === 'discard') {
        stats.discarded++;
        continue;
      }

      // 跳过价值评分低于阈值的内容
      if (segment.valueScore && segment.valueScore < this.config.valueThreshold) {
        stats.discarded++;
        continue;
      }

      // 构建记忆条目（只有 topic 和 timeline 两种分类）
      const entry: MemoryEntry = {
        id: `mem-flush-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        category: segment.category as 'topic' | 'timeline', // discard 已被过滤
        type: segment.memoryType || 'session_summary',
        content: segment.content,
        keywords: this.extractKeywords(segment.content),
        source: 'intelligent-flush',
        confidence: segment.confidence || 0.8,
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        metadata: {
          importance: segment.importance || 'medium',
        },
      };

      // 根据分类设置特定字段
      if (segment.category === 'topic') {
        entry.topicId = segment.topicId || 'general';
        stats.topics++;
      } else if (segment.category === 'timeline') {
        entry.dayKey = dayKey;
        entry.sessionId = sessionId;
        stats.timeline++;
      }

      // 保存到记忆系统
      try {
        await this.memoryManager.add(entry);
      } catch (err) {
        log.warn(`Failed to archive segment ${entry.id}:`, err);
      }
    }

    return stats;
  }

  /**
   * 清理消息历史（保留最近 N 条）
   */
  private pruneMessages(messages: Message[], keepCount: number): void {
    if (messages.length <= keepCount) {
      return;
    }

    // 保留最近的 N 条消息
    const toRemove = messages.length - keepCount;
    messages.splice(0, toRemove);

    log.debug(`Pruned ${toRemove} messages, kept ${keepCount}`);
  }

  /**
   * 提取消息的文本内容
   */
  private extractTextContent(message: Message): string {
    if (typeof message.content === 'string') {
      return message.content;
    }

    // ContentBlock[] 格式
    return message.content
      .map(block => {
        if (block.type === 'text' && block.text) {
          return block.text;
        }
        if (block.type === 'thinking' && block.thinking) {
          return `[Thinking: ${block.thinking.slice(0, 100)}...]`;
        }
        if (block.type === 'tool_use' && block.name) {
          return `[Tool: ${block.name}]`;
        }
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }

  /**
   * 提取关键词（简单实现）
   */
  private extractKeywords(text: string): string[] {
    const words = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .split(/\s+/)
      .filter(w => w.length >= 3);

    const stopWords = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'are', 'was', 'has', 'have']);

    return [...new Set(words.filter(w => !stopWords.has(w)))].slice(0, 10);
  }

  /**
   * 获取今天的日期键（格式: "2026-03-16"）
   */
  private getToday(): string {
    return new Date().toISOString().split('T')[0];
  }
}
