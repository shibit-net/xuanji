// ============================================================
// RetrieveMemoryTool — 记忆检索工具
// ============================================================
//
// 让 LLM 主动检索相关历史记忆
// 主要用于子 Agent，让其根据任务需要自主决定是否需要上下文

import type { Tool, ToolSchema, ToolResult } from '@/core/types';
import type { IMemoryStore } from '@/memory/types';
import type { MemoryEntry } from '@/memory/types';
import { logger } from '@/core/logger';

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
    },
    required: ['query' as const],
  };

  private memoryStore: IMemoryStore | null = null;

  /**
   * 设置记忆存储（依赖注入）
   */
  setMemoryStore(store: IMemoryStore): void {
    this.memoryStore = store;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    const maxResults = Math.min((input.maxResults as number) ?? 3, 10);
    const minConfidence = (input.minConfidence as number) ?? 0.65;

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

      // 检索相关记忆
      const memories = await this.memoryStore.retrieve(query, {
        maxResults,
        minConfidence,
        scope: 'all',
      });

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
   */
  private formatMemories(memories: MemoryEntry[], query: string): string {
    const parts: string[] = [];

    parts.push(`## 📚 Relevant Memories (${memories.length})`);
    parts.push(`Query: "${query}"\n`);

    // 按 category 分组
    const timeline = memories.filter((m) => m.category === 'timeline');
    const topic = memories.filter((m) => m.category === 'topic');
    const fact = memories.filter((m) => m.category === 'fact');

    // Timeline: 历史会话摘要
    if (timeline.length > 0) {
      parts.push('### 📅 Historical Conversations');
      timeline.forEach((m, idx) => {
        const timeAgo = this.formatTimeAgo(m.createdAt);
        const preview = m.content.slice(0, 200).replace(/\n/g, ' ');
        parts.push(`${idx + 1}. [${timeAgo}] ${preview}`);
        if (m.content.length > 200) {
          parts.push(`   ...`);
        }
      });
      parts.push('');
    }

    // Topic: 用户偏好、项目知识
    if (topic.length > 0) {
      parts.push('### 🏷️ User Preferences & Project Knowledge');
      topic.forEach((m, idx) => {
        const preview = m.content.slice(0, 150).replace(/\n/g, ' ');
        parts.push(`${idx + 1}. ${preview}`);
        if (m.content.length > 150) {
          parts.push(`   ...`);
        }
      });
      parts.push('');
    }

    // Fact: 技能、代码片段
    if (fact.length > 0) {
      parts.push('### 📌 Skills & Code Snippets');
      fact.forEach((m, idx) => {
        const preview = m.content.slice(0, 150).replace(/\n/g, ' ');
        parts.push(`${idx + 1}. ${preview}`);
        if (m.content.length > 150) {
          parts.push(`   ...`);
        }
      });
      parts.push('');
    }

    // 添加置信度信息
    const avgConfidence = memories.reduce((sum, m) => sum + m.confidence, 0) / memories.length;
    parts.push(`> Avg relevance: ${(avgConfidence * 100).toFixed(1)}%`);

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
