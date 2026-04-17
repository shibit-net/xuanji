// ============================================================
// RetrieveMemoryTool — 记忆检索工具（3.0 增强版）
// ============================================================
//
// 让 LLM 主动检索相关历史记忆
// 3.0 新增：支持决策点驱动的智能检索
// 主要用于子 Agent，让其根据任务需要自主决定是否需要上下文

import type { Tool, ToolSchema, ToolResult } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { MemoryEntry, RetrievedMemory } from '@/memory/types';
import { logger } from '@/core/logger';
import { DecisionPointDetector } from '@/memory/DecisionPointDetector';
import type { DecisionPointMemoryRetriever } from '@/memory/DecisionPointMemoryRetriever';

const log = logger.child({ module: 'RetrieveMemoryTool' });

/**
 * 记忆检索工具
 *
 * 用途：
 * - 子 Agent 根据任务需要主动检索记忆
 * - LLM 自主判断是否需要历史上下文
 * - 用户引用历史时（"像上次那样"）
 */
export class RetrieveMemoryTool implements Tool {
  name = 'retrieve_memory';
  readonly = true; // 只读工具，可并行执行

  description = `Retrieve relevant memories from past conversations and user preferences.

**When to use**:
- User mentions previous work: "like last time", "as before", "my usual style"
- Need context about user preferences or project setup
- Solving similar problems to previous ones
- User asks to continue/modify previous work

**When NOT to use**:
- Task is completely new and self-contained
- User explicitly wants a fresh approach
- No reference to past conversations

**Returns**: Formatted memory entries organized by category (Timeline/Topic/Fact).`;

  input_schema = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string' as const,
        description: 'Search query describing what memories to retrieve (e.g., "user coding preferences", "previous Python scripts", "project architecture decisions")',
      },
      maxResults: {
        type: 'number' as const,
        description: 'Maximum number of memories to retrieve (default: 3, max: 10)',
        default: 3,
      },
      minConfidence: {
        type: 'number' as const,
        description: 'Minimum relevance score (0-1, default: 0.65)',
        default: 0.65,
      },
      useDecisionPoint: {
        type: 'boolean' as const,
        description: 'Use decision-point driven retrieval (default: true)',
        default: true,
      },
    },
    required: ['query' as const],
  };

  private memoryStore: IMemoryStore | null = null;
  private decisionPointRetriever: DecisionPointMemoryRetriever | null = null;
  private decisionPointDetector: DecisionPointDetector;

  constructor() {
    this.decisionPointDetector = new DecisionPointDetector();
  }

  /**
   * 设置记忆存储（依赖注入）
   */
  setMemoryStore(store: IMemoryStore): void {
    this.memoryStore = store;
  }

  /**
   * 设置决策点检索器（依赖注入）
   */
  setDecisionPointRetriever(retriever: DecisionPointMemoryRetriever): void {
    this.decisionPointRetriever = retriever;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    const maxResults = Math.min((input.maxResults as number) ?? 3, 10);
    const minConfidence = (input.minConfidence as number) ?? 0.65;
    const useDecisionPoint = (input.useDecisionPoint as boolean) ?? true;

    if (!this.memoryStore) {
      log.warn('Memory store not available');
      return {
        content: '❌ Memory system is not available.',
        isError: true,
      };
    }

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return {
        content: '❌ Invalid query: query must be a non-empty string.',
        isError: true,
      };
    }

    try {
      const startTime = Date.now();

      let memories: MemoryEntry[] | RetrievedMemory[];

      // 3.0 新增：决策点驱动检索
      if (useDecisionPoint && this.decisionPointRetriever) {
        log.debug('使用决策点驱动检索');

        // 检测决策点
        const decisionPoints = await this.decisionPointDetector.detect({
          userMessage: query,
        });

        if (decisionPoints.length > 0) {
          // 使用决策点检索器
          const retrievedMemories = await this.decisionPointRetriever.retrieve({
            decisionPoints,
            userMessage: query,
            currentScene: 'memory-retrieval',
          });

          // 过滤：只返回适用性 >= minConfidence 的记忆
          memories = retrievedMemories.filter(m => m.applicability >= minConfidence);

          log.info(`决策点检索返回 ${memories.length} 条记忆`);
        } else {
          log.debug('未检测到决策点，降级到传统检索');
          memories = await this.memoryStore.retrieve(query, {
            maxResults,
            minConfidence,
            scope: 'all',
          });
        }
      } else {
        // 传统检索（向后兼容）
        log.debug('使用传统检索');
        memories = await this.memoryStore.retrieve(query, {
          maxResults,
          minConfidence,
          scope: 'all',
        });
      }

      // 限制结果数量
      memories = memories.slice(0, maxResults);

      const durationMs = Date.now() - startTime;

      if (memories.length === 0) {
        log.debug(`No memories found for query: "${query.slice(0, 50)}"`);
        return {
          content: `ℹ️ No relevant memories found for: "${query}"`,
          isError: false,
        };
      }

      // 格式化记忆
      const formatted = this.formatMemories(memories, query);

      log.info(
        `Retrieved ${memories.length} memories for query "${query.slice(0, 50)}" in ${durationMs}ms`
      );

      return {
        content: formatted,
        isError: false,
      };
    } catch (error) {
      log.error('Memory retrieval failed:', error);
      return {
        content: `❌ Failed to retrieve memories: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  /**
   * 格式化记忆条目（OpenClaw 风格分类）
   * 3.0 增强：支持 RetrievedMemory 类型，显示适用性评分
   */
  private formatMemories(memories: (MemoryEntry | RetrievedMemory)[], query: string): string {
    const parts: string[] = [];

    parts.push(`## 📚 Relevant Memories (${memories.length})`);
    parts.push(`Query: "${query}"\n`);

    // 🆕 添加重要提示：这是长期记忆，还需要检查当前会话
    parts.push(`⚠️ **Important**: These are long-term memories from past conversations.`);
    parts.push(`If the user is asking about recent events, also check the **current conversation history** above.\n`);

    // 检查是否是 RetrievedMemory（带适用性评分）
    const hasApplicability = memories.length > 0 && 'applicability' in memories[0];

    // 按约束级别和适用性分组
    const mustMemories = memories.filter(m => m.constraint === 'must');
    const shouldMemories = memories.filter(m => m.constraint === 'should');
    const mayMemories = memories.filter(m => m.constraint === 'may' || !m.constraint);

    // Must 级别记忆（硬约束）
    if (mustMemories.length > 0) {
      parts.push('### 🔴 Must Follow (Hard Constraints)');
      mustMemories.forEach((m, idx) => {
        const preview = m.content.slice(0, 200).replace(/\n/g, ' ');
        const applicability = hasApplicability ? ` [${((m as RetrievedMemory).applicability * 100).toFixed(0)}%]` : '';
        parts.push(`${idx + 1}. ${preview}${applicability}`);
        if (hasApplicability && (m as RetrievedMemory).reason) {
          parts.push(`   💡 ${(m as RetrievedMemory).reason}`);
        }
        if (m.content.length > 200) {
          parts.push(`   ...`);
        }
      });
      parts.push('');
    }

    // Should 级别记忆（强烈建议）
    if (shouldMemories.length > 0) {
      parts.push('### 🟡 Should Consider (Strong Recommendations)');
      shouldMemories.forEach((m, idx) => {
        const preview = m.content.slice(0, 200).replace(/\n/g, ' ');
        const applicability = hasApplicability ? ` [${((m as RetrievedMemory).applicability * 100).toFixed(0)}%]` : '';
        parts.push(`${idx + 1}. ${preview}${applicability}`);
        if (hasApplicability && (m as RetrievedMemory).reason) {
          parts.push(`   💡 ${(m as RetrievedMemory).reason}`);
        }
        if (m.content.length > 200) {
          parts.push(`   ...`);
        }
      });
      parts.push('');
    }

    // May 级别记忆（参考）
    if (mayMemories.length > 0) {
      parts.push('### 🟢 May Reference (Optional Context)');
      mayMemories.forEach((m, idx) => {
        const preview = m.content.slice(0, 150).replace(/\n/g, ' ');
        const applicability = hasApplicability ? ` [${((m as RetrievedMemory).applicability * 100).toFixed(0)}%]` : '';
        parts.push(`${idx + 1}. ${preview}${applicability}`);
        if (m.content.length > 150) {
          parts.push(`   ...`);
        }
      });
      parts.push('');
    }

    // 添加统计信息
    if (hasApplicability) {
      const avgApplicability = memories.reduce((sum, m) => sum + (m as RetrievedMemory).applicability, 0) / memories.length;
      parts.push(`> Avg applicability: ${(avgApplicability * 100).toFixed(1)}%`);
    } else {
      const avgConfidence = memories.reduce((sum, m) => sum + m.confidence, 0) / memories.length;
      parts.push(`> Avg relevance: ${(avgConfidence * 100).toFixed(1)}%`);
    }

    return parts.join('\n');
  }

  /**
   * 格式化时间距离（友好的时间显示）
   */
  private formatTimeAgo(isoDate: string): string {
    try {
      const now = Date.now();
      const then = new Date(isoDate).getTime();
      const diffMs = now - then;

      const minute = 60 * 1000;
      const hour = 60 * minute;
      const day = 24 * hour;
      const week = 7 * day;

      if (diffMs < hour) {
        const mins = Math.floor(diffMs / minute);
        return mins <= 1 ? 'just now' : `${mins}m ago`;
      } else if (diffMs < day) {
        const hours = Math.floor(diffMs / hour);
        return `${hours}h ago`;
      } else if (diffMs < week) {
        const days = Math.floor(diffMs / day);
        return `${days}d ago`;
      } else {
        const weeks = Math.floor(diffMs / week);
        return `${weeks}w ago`;
      }
    } catch {
      return 'recently';
    }
  }
}
