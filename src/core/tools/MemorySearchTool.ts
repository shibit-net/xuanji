// ============================================================
// M6 工具系统 — MemorySearchTool 检索记忆
// ============================================================

import type { JSONSchema, ToolResult } from '@/core/types';
import type { IMemoryStore, MemoryEntryType } from '@/memory/types';
import { BaseTool } from './BaseTool';
import { logger } from '@/core/logger';

const log = logger.child({ module: 'memory-search-tool' });

/**
 * MemorySearchTool — LLM 主动检索记忆
 *
 * 允许 LLM 在对话过程中主动调用此工具检索历史记忆。
 * 适用场景：
 * - 用户询问推荐时（"推荐午餐" → 检索饮食偏好）
 * - 用户提及某人时（"Alice 喜欢什么" → 检索人际关系）
 * - 用户询问过去决策（"我之前选了什么" → 检索决策记录）
 */
export class MemorySearchTool extends BaseTool {
  readonly name = 'memory_search';
  readonly description = [
    'Search long-term memory for relevant information from past conversations.',
    '',
    'Use this BEFORE answering questions that may depend on user context:',
    '- Recommendations (food, books, tools, etc.)',
    '- Questions about user preferences or habits',
    '- Mentions of people by name (search for relationship info)',
    '- Questions about past decisions or lessons learned',
    '',
    'Example queries:',
    '- "food preferences" → find user\'s food likes/dislikes',
    '- "Alice" → find info about Alice (relationship, preferences)',
    '- "TypeScript decision" → find past decisions about TypeScript',
    '- "authentication error" → find how auth errors were resolved',
  ].join('\n');

  readonly input_schema: JSONSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: [
          'Search query (keywords or natural language).',
          'Examples:',
          '- "food preferences spicy"',
          '- "Alice birthday"',
          '- "authentication error resolution"',
          '- "TypeScript decision"',
        ].join('\n'),
      },
      type: {
        type: 'string',
        enum: [
          'user_preference',
          'user_fact',
          'relationship',
          'important_date',
          'decision',
          'session_summary',
          'tool_pattern',
          'error_resolution',
        ],
        description: [
          'Filter by memory type (optional).',
          'Use when you know the specific type you need:',
          '- user_preference: For recommendations based on likes/dislikes',
          '- relationship: When user mentions a person',
          '- important_date: When user asks about dates/deadlines',
          '- decision: When user asks about past choices',
        ].join('\n'),
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default 10)',
      },
    },
    required: ['query'],
  };

  /** 只读工具：不修改状态 */
  readonly readonly = true;

  private memoryManager: IMemoryStore | null = null;

  /**
   * 注入记忆管理器（由 ChatSession 调用）
   */
  setMemoryManager(manager: IMemoryStore): void {
    this.memoryManager = manager;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const query = input.query as string;
    const typeFilter = input.type as MemoryEntryType | undefined;
    const limit = (input.limit as number | undefined) ?? 10;

    if (!query?.trim()) {
      return this.error('Parameter "query" is required and cannot be empty');
    }

    if (limit < 1 || limit > 50) {
      return this.error('Parameter "limit" must be between 1 and 50');
    }

    if (!this.memoryManager) {
      return this.error('Memory system is not available');
    }

    try {
      const results = await this.memoryManager.retrieve(query, {
        maxResults: limit,
        minConfidence: 0.6,
        types: typeFilter ? [typeFilter] : undefined,
      });

      if (results.length === 0) {
        log.debug(`No memories found for query: "${query}"`);
        return this.success('No relevant memories found.', {
          query,
          count: 0,
          typeFilter,
        });
      }

      // 格式化输出
      const formatted = results
        .map((r, i) => {
          const typeLabel = this.getTypeLabel(r.type);
          const keywordsStr = r.keywords.join(', ');
          const confidenceStr = (r.confidence * 100).toFixed(0);
          return [
            `[${i + 1}] **${typeLabel}** (${confidenceStr}% confidence)`,
            `    ${r.content}`,
            `    Keywords: ${keywordsStr}`,
            `    Last accessed: ${new Date(r.lastAccessedAt).toLocaleDateString()}`,
          ].join('\n');
        })
        .join('\n\n');

      log.debug(`Found ${results.length} memories for query: "${query}"`);

      return this.success(
        `Found ${results.length} relevant memories:\n\n${formatted}`,
        {
          query,
          count: results.length,
          types: [...new Set(results.map((r) => r.type))],
          avgConfidence: results.reduce((sum, r) => sum + r.confidence, 0) / results.length,
        },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Failed to search memories:', err);
      return this.error(`Failed to search memories: ${message}`);
    }
  }

  /**
   * 获取类型标签
   */
  private getTypeLabel(type: MemoryEntryType): string {
    const labels: Record<MemoryEntryType, string> = {
      session_summary: 'Session',
      decision: 'Decision',
      tool_pattern: 'Tool Pattern',
      error_resolution: 'Error Resolution',
      user_preference: 'User Preference',
      project_fact: 'Project Fact',
      user_fact: 'User Fact',
      relationship: 'Relationship',
      important_date: 'Important Date',
      agent_knowledge: 'Agent Knowledge',
      lesson_learned: 'Lesson Learned',
      reusable_pattern: 'Reusable Pattern',
      unfinished_task: 'Unfinished Task',
    };
    return labels[type] ?? type;
  }
}
